/**
 * The highlighter, which every screen in the app leans on.
 *
 * A code block that colours a comment as code, or swallows the rest of a
 * snippet because a quote was never closed, is wrong on every question that
 * uses it. The cases below are the ones the question bank actually contains:
 * comments with quotes in them, f-strings, template literals, escapes, and the
 * boundary between a name and the bracket that makes it a call.
 */

import { tokenize, tokenizeLines, type Token, type TokenType } from '@/lib/syntax';

/** The tokens, minus the plain text between them — what a reader would see. */
function coloured(code: string, language: 'python' | 'javascript'): [TokenType, string][] {
  return tokenize(code, language)
    .filter((token: Token) => token.type !== 'plain')
    .map((token: Token) => [token.type, token.text]);
}

/** Nothing may be lost or invented: the tokens have to rebuild the input. */
function rebuilt(code: string, language: 'python' | 'javascript'): string {
  return tokenize(code, language)
    .map((token) => token.text)
    .join('');
}

describe('python', () => {
  it('reads a line of the first lesson the way a learner does', () => {
    expect(coloured('print("Hello")  # say it', 'python')).toEqual([
      ['builtin', 'print'],
      ['punctuation', '('],
      ['string', '"Hello"'],
      ['punctuation', ')'],
      ['comment', '# say it'],
    ]);
  });

  it('keeps a hash inside a string out of the comment', () => {
    expect(coloured('print("# not a comment")', 'python')).toEqual([
      ['builtin', 'print'],
      ['punctuation', '('],
      ['string', '"# not a comment"'],
      ['punctuation', ')'],
    ]);
  });

  it('keeps a quote inside a comment out of the string', () => {
    expect(coloured("# it's fine\nx = 1", 'python')).toEqual([
      ['comment', "# it's fine"],
      ['operator', '='],
      ['number', '1'],
    ]);
  });

  it('takes the f in an f-string with the string it belongs to', () => {
    expect(coloured('name = f"hi {name}"', 'python')).toEqual([
      ['operator', '='],
      ['string', 'f"hi {name}"'],
    ]);
  });

  it('tells a keyword from a builtin from a call', () => {
    expect(coloured('def greet(): return len("ab")', 'python')).toEqual([
      ['keyword', 'def'],
      ['function', 'greet'],
      ['punctuation', '('],
      ['punctuation', ')'],
      ['punctuation', ':'],
      ['keyword', 'return'],
      ['builtin', 'len'],
      ['punctuation', '('],
      ['string', '"ab"'],
      ['punctuation', ')'],
    ]);
  });

  it('does not let an unterminated string eat the next line', () => {
    const tokens = tokenize('x = "oops\ny = 2', 'python');
    const strings = tokens.filter((token) => token.type === 'string');

    expect(strings).toEqual([{ text: '"oops', type: 'string' }]);
    // The line after it is still ordinary code.
    expect(tokens.some((token) => token.type === 'number' && token.text === '2')).toBe(true);
  });

  it('reads an escaped quote as part of the string', () => {
    expect(coloured('print("say \\"hi\\"")', 'python')[2]).toEqual(['string', '"say \\"hi\\""']);
  });

  it('keeps a decimal number in one piece', () => {
    expect(coloured('price = 12.50', 'python')).toEqual([
      ['operator', '='],
      ['number', '12.50'],
    ]);
  });
});

describe('javascript', () => {
  it('colours both comment styles, and neither inside a string', () => {
    expect(coloured('// note\nconst url = "http://x"; /* end */', 'javascript')).toEqual([
      ['comment', '// note'],
      ['keyword', 'const'],
      ['operator', '='],
      ['string', '"http://x"'],
      ['punctuation', ';'],
      ['comment', '/* end */'],
    ]);
  });

  it('lets a template literal run across lines, as the language does', () => {
    expect(coloured('const s = `line\nnext`;', 'javascript')).toEqual([
      ['keyword', 'const'],
      ['operator', '='],
      ['string', '`line\nnext`'],
      ['punctuation', ';'],
    ]);
  });

  it('colours a known method as a builtin, and an unknown one as the call it is', () => {
    // `log` is in the builtin list, and being a builtin wins over being called:
    // console.log should look the same wherever a learner meets it.
    expect(coloured('console.log(1)', 'javascript')).toEqual([
      ['builtin', 'console'],
      ['punctuation', '.'],
      ['builtin', 'log'],
      ['punctuation', '('],
      ['number', '1'],
      ['punctuation', ')'],
    ]);

    expect(coloured('shape.draw(1)', 'javascript')).toEqual([
      ['punctuation', '.'],
      ['function', 'draw'],
      ['punctuation', '('],
      ['number', '1'],
      ['punctuation', ')'],
    ]);
  });

  it('does not treat a python keyword as one', () => {
    // `def` is not a JavaScript word; it is just a name.
    expect(coloured('def = 1', 'javascript')).toEqual([
      ['operator', '='],
      ['number', '1'],
    ]);
  });
});

describe('whatever it is given', () => {
  it.each([
    ['print("Hello")  # say it', 'python'],
    ['x = f"a{b}c" + \'d\'', 'python'],
    ['const s = `a${b}c`; // done', 'javascript'],
    ['/* unclosed', 'javascript'],
    ['"unclosed', 'python'],
    ['', 'python'],
    ['   \n\t', 'javascript'],
    ['👋 = "emoji"', 'python'],
  ] as const)('puts %p back together exactly', (code, language) => {
    expect(rebuilt(code, language)).toBe(code);
  });

  it('splits into one row per line, keeping empty lines', () => {
    const lines = tokenizeLines('a = 1\n\nb = 2', 'python');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual([]);
    expect(lines[2].map((token) => token.text).join('')).toBe('b = 2');
  });
});
