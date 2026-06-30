// Recursive-descent parser for the classic Pattis Karel language.
//
// Grammar (case-insensitive keywords):
//   program     := [ "WORLD" string ] "BEGINNING-OF-PROGRAM"
//                    { definition } "BEGINNING-OF-EXECUTION"
//                    statements "END-OF-EXECUTION" "END-OF-PROGRAM"
//   definition  := ("DEFINE" | "DEFINE-NEW-INSTRUCTION") name "AS" statement
//   statement   := block | iterate | while | if | call
//   block       := "BEGIN" statements "END"
//   iterate     := "ITERATE" number "TIMES" statement
//   while       := "WHILE" test "DO" statement
//   if          := "IF" test "THEN" statement [ "ELSE" statement ]
//   call        := word                         (primitive or user instruction)
//   test        := [ "NOT" ] testword
// Statements are separated/terminated by ';' (lenient: extra/trailing ok).

import { TokenType, KarelSyntaxError } from './karel-lexer.js';

// Keywords that terminate a statement list.
const TERMINATORS = new Set(['end', 'end-of-execution', 'end-of-program', 'else']);

// Recognised test keywords mapped to a { fn, negate } pair the interpreter runs
// against the world. Both positive and negative spellings are first-class.
const TESTS = {
  'front-is-clear': { fn: 'frontIsClear', negate: false },
  'front-is-blocked': { fn: 'frontIsClear', negate: true },
  'left-is-clear': { fn: 'leftIsClear', negate: false },
  'left-is-blocked': { fn: 'leftIsClear', negate: true },
  'right-is-clear': { fn: 'rightIsClear', negate: false },
  'right-is-blocked': { fn: 'rightIsClear', negate: true },
  'next-to-a-beeper': { fn: 'nextToABeeper', negate: false },
  'not-next-to-a-beeper': { fn: 'nextToABeeper', negate: true },
  'any-beepers-in-beeper-bag': { fn: 'anyBeepersInBag', negate: false },
  'no-beepers-in-beeper-bag': { fn: 'anyBeepersInBag', negate: true },
  'facing-north': { fn: 'facingNorth', negate: false },
  'not-facing-north': { fn: 'facingNorth', negate: true },
  'facing-south': { fn: 'facingSouth', negate: false },
  'not-facing-south': { fn: 'facingSouth', negate: true },
  'facing-east': { fn: 'facingEast', negate: false },
  'not-facing-east': { fn: 'facingEast', negate: true },
  'facing-west': { fn: 'facingWest', negate: false },
  'not-facing-west': { fn: 'facingWest', negate: true },
};

export const PRIMITIVES = new Set(['move', 'turnleft', 'pickbeeper', 'putbeeper', 'turnoff']);

export function parse(tokens) {
  return new Parser(tokens).parseProgram();
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }

  /** Lowercased value of the current token if it is a word, else null. */
  word() {
    const t = this.peek();
    return t.type === TokenType.WORD ? t.value.toLowerCase() : null;
  }

  isWord(kw) { return this.word() === kw; }

  matchWord(kw) {
    if (this.isWord(kw)) { this.next(); return true; }
    return false;
  }

  expectWord(kw) {
    if (!this.matchWord(kw)) {
      const t = this.peek();
      throw new KarelSyntaxError(`Expected '${kw}' but found '${t.value}' on line ${t.line}.`, t.line);
    }
  }

  /** Consume any run of statement separators. */
  skipSemicolons() {
    while (this.peek().type === TokenType.SEMICOLON) this.next();
  }

  parseProgram() {
    this.skipSemicolons();

    let worldFile = null;
    let speedOverride = null;

    // Optional WORLD / SPEED directives (either order) before the program body.
    while (this.isWord('world') || this.isWord('speed')) {
      if (this.matchWord('world')) {
        const t = this.next();
        if (t.type !== TokenType.STRING) {
          throw new KarelSyntaxError(`Expected a quoted world filename after WORLD on line ${t.line}.`, t.line);
        }
        worldFile = t.value;
      } else {
        this.next(); // consume SPEED
        const t = this.next();
        const mode = t.type === TokenType.WORD ? t.value.toLowerCase() : null;
        if (!['slow', 'slower', 'slowest', 'fast'].includes(mode)) {
          throw new KarelSyntaxError(`Expected SLOW or FAST after SPEED on line ${t.line}.`, t.line);
        }
        speedOverride = mode;
      }
      this.skipSemicolons();
    }

    this.expectWord('beginning-of-program');

    const definitions = {};
    this.skipSemicolons();
    while (this.isWord('define') || this.isWord('define-new-instruction')) {
      const def = this.parseDefinition();
      definitions[def.name] = def.body;
      this.skipSemicolons();
    }

    this.expectWord('beginning-of-execution');
    const body = this.parseStatements();
    this.expectWord('end-of-execution');
    this.skipSemicolons();
    this.expectWord('end-of-program');

    return { worldFile, speedOverride, definitions, body };
  }

  parseDefinition() {
    this.next(); // 'define' or 'define-new-instruction'
    const nameToken = this.next();
    if (nameToken.type !== TokenType.WORD) {
      throw new KarelSyntaxError(`Expected an instruction name on line ${nameToken.line}.`, nameToken.line);
    }
    this.expectWord('as');
    const body = this.parseStatement();
    return { name: nameToken.value.toLowerCase(), body };
  }

  /** Parse a ';'-separated list until a terminator keyword or EOF. */
  parseStatements() {
    const list = [];
    this.skipSemicolons();
    while (this.peek().type !== TokenType.EOF && !TERMINATORS.has(this.word())) {
      list.push(this.parseStatement());
      this.skipSemicolons();
    }
    return { type: 'block', body: list };
  }

  parseStatement() {
    const w = this.word();

    if (w === 'begin') return this.parseBlock();
    if (w === 'iterate') return this.parseIterate();
    if (w === 'while') return this.parseWhile();
    if (w === 'if') return this.parseIf();

    // Otherwise it is a primitive or user-defined instruction call.
    const t = this.next();
    if (t.type !== TokenType.WORD) {
      throw new KarelSyntaxError(`Expected an instruction but found '${t.value}' on line ${t.line}.`, t.line);
    }
    return { type: 'call', name: t.value.toLowerCase(), line: t.line };
  }

  parseBlock() {
    this.expectWord('begin');
    const block = this.parseStatements();
    this.expectWord('end');
    return block;
  }

  parseIterate() {
    this.expectWord('iterate');
    const countToken = this.next();
    if (countToken.type !== TokenType.NUMBER) {
      throw new KarelSyntaxError(`Expected a number after ITERATE on line ${countToken.line}.`, countToken.line);
    }
    this.expectWord('times');
    const body = this.parseStatement();
    return { type: 'iterate', count: countToken.value, body };
  }

  parseWhile() {
    this.expectWord('while');
    const test = this.parseTest();
    this.expectWord('do');
    const body = this.parseStatement();
    return { type: 'while', test, body };
  }

  parseIf() {
    this.expectWord('if');
    const test = this.parseTest();
    this.expectWord('then');
    const thenBranch = this.parseStatement();
    let elseBranch = null;
    if (this.matchWord('else')) {
      elseBranch = this.parseStatement();
    }
    return { type: 'if', test, then: thenBranch, else: elseBranch };
  }

  parseTest() {
    let negate = false;
    if (this.matchWord('not')) negate = true;

    const t = this.next();
    if (t.type !== TokenType.WORD) {
      throw new KarelSyntaxError(`Expected a condition on line ${t.line}.`, t.line);
    }
    const spec = TESTS[t.value.toLowerCase()];
    if (!spec) {
      throw new KarelSyntaxError(`Unknown condition '${t.value}' on line ${t.line}.`, t.line);
    }
    return { fn: spec.fn, negate: spec.negate !== negate };
  }
}
