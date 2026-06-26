// Tokenizer for the classic Pattis Karel language.
//
// Karel keywords and instruction names are hyphenated words
// (BEGINNING-OF-PROGRAM, front-is-clear, turnLeft), so a "word" token allows
// letters, digits, hyphens and underscores. Matching is case-insensitive; the
// parser lowercases word values. The only literals are integers (ITERATE n
// TIMES) and a quoted string (WORLD "file"). Statements are separated by ';'.
// Comments: { ... } block comments and // line comments.

export const TokenType = {
  WORD: 'WORD',
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  SEMICOLON: 'SEMICOLON',
  EOF: 'EOF',
};

export class KarelSyntaxError extends Error {}

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const isWordStart = (c) => /[A-Za-z_]/.test(c);
  const isWordPart = (c) => /[A-Za-z0-9_-]/.test(c);

  while (i < n) {
    const c = source[i];

    // Newlines (for error line numbers) and whitespace.
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }

    // Line comment.
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    // Block comment { ... }.
    if (c === '{') {
      i++;
      while (i < n && source[i] !== '}') {
        if (source[i] === '\n') line++;
        i++;
      }
      i++; // consume closing '}'
      continue;
    }

    if (c === ';') {
      tokens.push({ type: TokenType.SEMICOLON, value: ';', line });
      i++;
      continue;
    }

    if (c === '"') {
      i++;
      let str = '';
      while (i < n && source[i] !== '"') {
        if (source[i] === '\n') line++;
        str += source[i++];
      }
      if (i >= n) throw new KarelSyntaxError(`Unterminated string on line ${line}.`);
      i++; // consume closing quote
      tokens.push({ type: TokenType.STRING, value: str, line });
      continue;
    }

    if (/[0-9]/.test(c)) {
      let num = '';
      while (i < n && /[0-9]/.test(source[i])) num += source[i++];
      tokens.push({ type: TokenType.NUMBER, value: parseInt(num, 10), line });
      continue;
    }

    if (isWordStart(c)) {
      let word = '';
      while (i < n && isWordPart(source[i])) word += source[i++];
      tokens.push({ type: TokenType.WORD, value: word, line });
      continue;
    }

    throw new KarelSyntaxError(`Unexpected character '${c}' on line ${line}.`);
  }

  tokens.push({ type: TokenType.EOF, value: null, line });
  return tokens;
}
