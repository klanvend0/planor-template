/**
 * Tiny syntax highlighter.
 *
 * Every screen in the app is mostly code, so the snippets have to look like an
 * editor rather than a paragraph. A full parser would be overkill (and a large
 * dependency for a phone), so this tokenizes the small subset of Python and
 * JavaScript the courses actually teach.
 *
 * Colors are not decided here — the token type is returned and the theme maps it
 * to a color, which keeps light and dark honest.
 *
 * @module lib/syntax
 */

export type TokenType =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'builtin'
  | 'function'
  | 'operator'
  | 'punctuation'
  | 'plain';

export type Token = {
  text: string;
  type: TokenType;
};

export type SyntaxLanguage = 'python' | 'javascript';

const PYTHON_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  'True',
  'False',
]);

const PYTHON_BUILTINS = new Set([
  'abs',
  'bool',
  'dict',
  'enumerate',
  'float',
  'input',
  'int',
  'len',
  'list',
  'max',
  'min',
  'print',
  'range',
  'round',
  'sorted',
  'str',
  'sum',
  'tuple',
  'type',
  'zip',
]);

const JS_KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'of',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'yield',
  'true',
  'false',
  'null',
  'undefined',
]);

const JS_BUILTINS = new Set([
  'Array',
  'Boolean',
  'console',
  'Date',
  'JSON',
  'Math',
  'Number',
  'Object',
  'String',
  'parseInt',
  'parseFloat',
  'isNaN',
  'push',
  'pop',
  'map',
  'filter',
  'length',
  'log',
  'toFixed',
  'join',
  'slice',
  'split',
  'includes',
]);

const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~']);
const PUNCTUATION_CHARS = new Set(['(', ')', '[', ']', '{', '}', ',', ':', ';', '.']);

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;

/**
 * Tokenize one snippet.
 *
 * @param code - Source to highlight; newlines are preserved as plain tokens.
 * @param language - Which keyword table to use.
 * @returns Tokens in source order; concatenating `text` reproduces the input.
 */
export function tokenize(code: string, language: SyntaxLanguage): Token[] {
  const keywords = language === 'python' ? PYTHON_KEYWORDS : JS_KEYWORDS;
  const builtins = language === 'python' ? PYTHON_BUILTINS : JS_BUILTINS;

  const tokens: Token[] = [];
  let index = 0;
  let buffer = '';

  const flush = () => {
    if (buffer) {
      tokens.push({ text: buffer, type: 'plain' });
      buffer = '';
    }
  };

  const push = (text: string, type: TokenType) => {
    flush();
    tokens.push({ text, type });
  };

  while (index < code.length) {
    const char = code[index];
    const rest = code.slice(index);

    // Comments
    if (
      (language === 'python' && char === '#') ||
      (language === 'javascript' && rest.startsWith('//'))
    ) {
      const end = code.indexOf('\n', index);
      const stop = end === -1 ? code.length : end;
      push(code.slice(index, stop), 'comment');
      index = stop;
      continue;
    }

    if (language === 'javascript' && rest.startsWith('/*')) {
      const end = code.indexOf('*/', index + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(code.slice(index, stop), 'comment');
      index = stop;
      continue;
    }

    // Strings, including Python f-strings and JS template literals
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      let end = index + 1;
      while (end < code.length) {
        if (code[end] === '\\') {
          end += 2;
          continue;
        }
        if (code[end] === quote) {
          end += 1;
          break;
        }
        if (code[end] === '\n' && quote !== '`') {
          break;
        }
        end += 1;
      }
      push(code.slice(index, end), 'string');
      index = end;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(char)) {
      let end = index;
      while (end < code.length && /[0-9._]/.test(code[end])) end += 1;
      push(code.slice(index, end), 'number');
      index = end;
      continue;
    }

    // Identifiers, keywords, builtins and call targets
    if (IDENTIFIER_START.test(char)) {
      let end = index;
      while (end < code.length && IDENTIFIER_PART.test(code[end])) end += 1;
      const word = code.slice(index, end);

      // An f-string prefix belongs to the string that follows it.
      if (
        language === 'python' &&
        /^[fFrRbB]{1,2}$/.test(word) &&
        (code[end] === '"' || code[end] === "'")
      ) {
        const quote = code[end];
        let stringEnd = end + 1;
        while (stringEnd < code.length) {
          if (code[stringEnd] === '\\') {
            stringEnd += 2;
            continue;
          }
          if (code[stringEnd] === quote) {
            stringEnd += 1;
            break;
          }
          if (code[stringEnd] === '\n') break;
          stringEnd += 1;
        }
        push(code.slice(index, stringEnd), 'string');
        index = stringEnd;
        continue;
      }

      let type: TokenType = 'plain';
      if (keywords.has(word)) type = 'keyword';
      else if (builtins.has(word)) type = 'builtin';
      else if (code[end] === '(') type = 'function';

      push(word, type);
      index = end;
      continue;
    }

    if (OPERATOR_CHARS.has(char)) {
      push(char, 'operator');
      index += 1;
      continue;
    }

    if (PUNCTUATION_CHARS.has(char)) {
      push(char, 'punctuation');
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return tokens;
}

/** Tokenize a snippet line by line, for widgets that render one row per line. */
export function tokenizeLines(code: string, language: SyntaxLanguage): Token[][] {
  return code.split('\n').map((line) => tokenize(line, language));
}
