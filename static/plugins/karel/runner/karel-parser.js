// Recursive-descent parser for the classic Pattis Karel language.
//
// Grammar (case-insensitive keywords):
//   program     := [ "WORLD" string ] "BEGINNING-OF-PROGRAM"
//                    { definition ";" } execution "END-OF-PROGRAM"
//   execution   := "BEGINNING-OF-EXECUTION" statements "END-OF-EXECUTION"
//   definition  := "DEFINE-NEW-INSTRUCTION" name "AS" statement
//   statements  := statement { ";" statement }
//   statement   := block | iterate | while | if | call
//   block       := "BEGIN" statements "END"
//   iterate     := "ITERATE" number "TIMES" statement
//   while       := "WHILE" test "DO" statement
//   if          := "IF" test "THEN" statement [ "ELSE" statement ]
//   call        := word                         (primitive or user instruction)
//   test        := [ "NOT" ] testword
//
// ';' is a strict statement separator, with no exceptions for how a statement
// is built: exactly one is required between two statements in a list, and none
// is allowed before the keyword that closes the list (END, ELSE,
// END-OF-EXECUTION). So an ITERATE/WHILE/IF takes a ';' after it when another
// statement follows, whether its branch is a bare instruction or a
// BEGIN...END block. Newlines are insignificant whitespace throughout and
// never substitute for ';'.
//
// The items inside BEGINNING-OF-PROGRAM — the definitions and the execution
// block — are separated by ';' the same way. The ';' is not part of a
// definition; it just happens to follow every one of them, because the
// execution block is always the last item.

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

/**
 * Character span from the start of `startToken` to the end of `endToken`, for
 * highlighting a whole clause (e.g. "ITERATE 3 TIMES") as one execution-trace
 * frame. Falls back to just the start token's own length if the two ended up
 * on different lines, so unusual formatting never yields a negative span.
 */
function spanLength(startToken, endToken) {
  if (startToken.line !== endToken.line) return startToken.value.length;
  return (endToken.column + endToken.value.length) - startToken.column;
}

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

  /** Consume a single ';' separator, or throw if one isn't there. */
  expectSemicolon() {
    if (this.peek().type !== TokenType.SEMICOLON) {
      const t = this.peek();
      throw new KarelSyntaxError(`Expected ';' between statements on line ${t.line}.`, t.line);
    }
    return this.next();
  }

  parseProgram() {

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
    }

    this.expectWord('beginning-of-program');

    const definitions = {};
    while (this.isWord('define-new-instruction')) {
      const def = this.parseDefinition();
      definitions[def.name] = def.body;
      // The ';' separating this definition from the next item, which is either
      // another definition or the execution block — so there is always one.
      // Reported against the line the definition ended on, not the line of
      // whatever follows it, so the marker lands where the ';' is missing.
      if (this.peek().type !== TokenType.SEMICOLON) {
        const line = this.tokens[this.pos - 1].line;
        throw new KarelSyntaxError(`Expected ';' after the end of definition '${def.spelling}' on line ${line}.`, line);
      }
      this.next();
    }

    this.expectWord('beginning-of-execution');
    const body = this.parseStatements();
    this.expectWord('end-of-execution');
    this.expectWord('end-of-program');

    return { worldFile, speedOverride, definitions, body };
  }

  parseDefinition() {
    this.next(); // 'define-new-instruction'
    const nameToken = this.next();
    if (nameToken.type !== TokenType.WORD) {
      throw new KarelSyntaxError(`Expected an instruction name on line ${nameToken.line}.`, nameToken.line);
    }
    this.expectWord('as');
    const body = this.parseStatement();
    // `spelling` keeps the name as written, for error messages; lookups use
    // the lowercased `name` since the language is case-insensitive.
    return { name: nameToken.value.toLowerCase(), spelling: nameToken.value, body };
  }

  /**
   * Parse a ';'-separated list until a terminator keyword or EOF. ';' is a
   * separator, not a terminator: exactly one is required between statements,
   * and none is allowed before the closing keyword. This holds for every kind
   * of statement, control flow included.
   */
  parseStatements() {
    const list = [];
    while (this.peek().type !== TokenType.EOF && !TERMINATORS.has(this.word())) {
      list.push(this.parseStatement());
      if (this.peek().type === TokenType.EOF || TERMINATORS.has(this.word())) break;

      const semicolon = this.expectSemicolon();
      if (this.peek().type === TokenType.EOF || TERMINATORS.has(this.word())) {
        throw new KarelSyntaxError(`Unexpected ';' before the end of a block on line ${semicolon.line}.`, semicolon.line);
      }
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
    return {
      type: 'call',
      name: t.value.toLowerCase(),
      line: t.line,
      column: t.column,
      length: t.value.length,
    };
  }

  parseBlock() {
    this.expectWord('begin');
    const block = this.parseStatements();
    this.expectWord('end');
    return block;
  }

  parseIterate() {
    const iterateToken = this.peek();
    this.expectWord('iterate');
    const countToken = this.next();
    if (countToken.type !== TokenType.NUMBER) {
      throw new KarelSyntaxError(`Expected a number after ITERATE on line ${countToken.line}.`, countToken.line);
    }
    const timesToken = this.peek();
    this.expectWord('times');
    const body = this.parseStatement();
    return {
      type: 'iterate',
      count: countToken.value,
      body,
      line: iterateToken.line,
      column: iterateToken.column,
      length: spanLength(iterateToken, timesToken),
    };
  }

  parseWhile() {
    const whileToken = this.peek();
    this.expectWord('while');
    const test = this.parseTest();
    const doToken = this.peek();
    this.expectWord('do');
    const body = this.parseStatement();
    return {
      type: 'while',
      test,
      body,
      line: whileToken.line,
      column: whileToken.column,
      length: spanLength(whileToken, doToken),
    };
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
