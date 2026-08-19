# Question Bank Authoring Contract

Every unit lives in a single JSON file: `content/<course>/unit_<NN>.json`
(`<course>` is `python` or `javascript`, `<NN>` is zero-padded, e.g. `unit_01.json`).

The file is validated at build time and at runtime by the Zod schema in `lib/content_schema.ts`.
Anything that fails validation is a bug in the content file, not in the schema.

## Localized text

`Localized` is always an object with **both** locales:

```json
{ "en": "English text", "tr": "Türkçe metin" }
```

Turkish must be natural, idiomatic Turkish written by someone who codes — not a literal
word-by-word translation. Keep programming keywords (`print`, `for`, `return`, `list`) in
English inside Turkish sentences, because that is how Turkish developers speak.

## Unit file shape

```jsonc
{
  "id": "py-u01", // "<course-prefix>-u<NN>", prefix: py | js
  "courseId": "python", // "python" | "javascript"
  "index": 1, // 1-based, matches the filename
  "title": { "en": "...", "tr": "..." }, // <= 40 chars per locale
  "description": { "en": "...", "tr": "..." }, // 60-120 chars per locale
  "lessons": [/* exactly 4 lessons */],
}
```

## Lesson shape

```jsonc
{
  "id": "py-u01-l1", // "<unit-id>-l<n>"
  "index": 1, // 1-based within the unit
  "title": { "en": "...", "tr": "..." }, // <= 32 chars per locale
  "concept": {
    "headline": { "en": "...", "tr": "..." }, // <= 60 chars, the one idea being taught
    "body": { "en": "...", "tr": "..." }, // 180-420 chars, plain language, no markdown
    "example": {
      "code": "print(\"hi\")", // 1-6 lines, runnable on its own
      "caption": { "en": "...", "tr": "..." }, // <= 90 chars
    },
  },
  "questions": [
    /* exactly 6 questions, in this order:
                    multiple_choice, multiple_choice, fill_blank,
                    type_code, spot_bug | order_lines, explain_code */
  ],
}
```

## Common question fields

| field         | type                           | notes                                              |
| ------------- | ------------------------------ | -------------------------------------------------- |
| `id`          | string                         | `"<lesson-id>-q<n>"`                               |
| `type`        | enum                           | see below                                          |
| `difficulty`  | `"easy" \| "medium" \| "hard"` | drives XP (10 / 15 / 25)                           |
| `prompt`      | Localized                      | the instruction shown above the question           |
| `explanation` | Localized                      | 80-220 chars, shown after answering, teaches _why_ |

Difficulty must rise across the unit: lesson 1 is mostly `easy`, lesson 4 contains at
least two `hard` questions.

## `multiple_choice`

```jsonc
{
  "id": "py-u01-l1-q1",
  "type": "multiple_choice",
  "difficulty": "easy",
  "prompt": { "en": "What does this code print?", "tr": "Bu kod ne yazdırır?" },
  "code": "print(2 + 3)", // optional, omit or null when there is no snippet
  "options": [
    // exactly 4, ids "a".."d", exactly one correct
    { "id": "a", "text": { "en": "5", "tr": "5" } },
    { "id": "b", "text": { "en": "23", "tr": "23" } },
    { "id": "c", "text": { "en": "2 + 3", "tr": "2 + 3" } },
    { "id": "d", "text": { "en": "An error", "tr": "Bir hata" } },
  ],
  "answerId": "a",
  "explanation": { "en": "...", "tr": "..." },
}
```

Options that are pure code or pure values use the same string for `en` and `tr`.
Distractors must be _plausible_ — the mistakes a beginner actually makes — never filler.

## `fill_blank`

```jsonc
{
  "type": "fill_blank",
  "difficulty": "easy",
  "prompt": { "en": "Complete the code so it prints Hello.", "tr": "..." },
  "codeTemplate": "print(___)", // 1-2 "___" placeholders, in order
  "blanks": [{ "id": "1", "answer": "\"Hello\"", "distractors": ["Hello", "'Hello", "print"] }],
  "verify": { "stdout": "Hello\n" }, // optional; see "Verification" below
  "explanation": { "en": "...", "tr": "..." },
}
```

The app builds a shuffled token bank out of every answer + every distractor, so
distractors must be short tokens (<= 32 chars) that look like they could belong.

## `type_code`

```jsonc
{
  "type": "type_code",
  "difficulty": "medium",
  "prompt": { "en": "Write a line that prints the value of name.", "tr": "..." },
  "code": "name = \"Ada\"", // optional context shown above the input
  "expected": "print(name)", // the canonical answer
  "acceptable": ["print( name )"], // optional extra accepted spellings
  "verify": { "stdout": "Ada\n" }, // optional; runs code + "\n" + expected
  "explanation": { "en": "...", "tr": "..." },
}
```

Answers are compared after normalizing whitespace and quote style, so do not add
variants that differ only by spacing or by `'` vs `"`.

## `spot_bug`

```jsonc
{
  "type": "spot_bug",
  "difficulty": "medium",
  "prompt": { "en": "Which line is wrong?", "tr": "Hangi satır hatalı?" },
  "codeLines": ["age = 20", "print(agee)"], // 2-6 lines, one is wrong
  "buggyLineIndex": 1, // 0-based
  "fix": "print(age)", // the corrected line
  "verify": { "raises": "NameError" }, // optional; see below
  "explanation": { "en": "...", "tr": "..." },
}
```

Use this type for the "notice the missing/misspelled variable" questions: an undefined
name, a typo'd variable, a wrong operator, a missing colon, a value used before assignment.

## `order_lines`

```jsonc
{
  "type": "order_lines",
  "difficulty": "medium",
  "prompt": { "en": "Put the lines in the right order.", "tr": "..." },
  "lines": ["total = 0", "for n in [1, 2, 3]:", "    total += n", "print(total)"],
  "verify": { "stdout": "6\n" },
  "explanation": { "en": "...", "tr": "..." },
}
```

`lines` are stored in the CORRECT order; the app shuffles them. 3-5 lines.
Indentation is significant and is part of the line text.

## `explain_code` (premium, AI-graded)

```jsonc
{
  "type": "explain_code",
  "difficulty": "medium",
  "prompt": { "en": "In 100-200 characters, explain what this code does.", "tr": "..." },
  "code": {
    "en": "# Adds up every price in the cart\ntotal = 0\nfor price in cart:\n    total += price",
    "tr": "# Sepetteki her fiyatı toplar\ntotal = 0\nfor price in cart:\n    total += price",
  },
  "keyPoints": {
    "en": ["starts the total at zero", "loops over every price", "accumulates into total"],
    "tr": ["toplamı sıfırdan başlatır", "her fiyatı gezer", "total üzerinde biriktirir"],
  },
  "sampleAnswer": { "en": "...", "tr": "..." }, // 100-200 chars, the model answer
  "explanation": { "en": "...", "tr": "..." },
}
```

`code` is localized because the COMMENTS inside it are written in the learner's language,
while identifiers and keywords stay in English. Only the comments differ between locales.
`keyPoints` are the rubric the grader scores against: 2-4 short, checkable claims.

## Verification

The optional `verify` block is executed by `npm run content:check`, which really runs the
snippet with `python3` / `node`:

- `fill_blank` — the template with every `___` replaced by its `answer`
- `type_code` — `code` (if any) followed by `expected`
- `order_lines` — `lines` joined with newlines
- `spot_bug` — `codeLines` joined with newlines, expected to fail with `raises`

Provide `verify` whenever the snippet is self-contained. Omit it when the snippet needs
input, uses randomness, or refers to a variable that is not defined in the snippet.
`stdout` must include the trailing newline that `print` / `console.log` emits.

## Rules that get content rejected

1. Any code that does not parse (`python3 -c compile` / `node --check`).
2. A `verify.stdout` that does not match what the code really prints.
3. A `multiple_choice` with more or fewer than 4 options, or with a duplicated option.
4. Missing `tr` or `en` on any localized field.
5. Identical `en` and `tr` on a _sentence_ field (code and bare values may match).
6. Teaching anything the course has not introduced yet — a unit may only rely on itself
   and the units before it.
7. Emoji, markdown, or HTML inside any content string.
8. Copy outside the character budgets above. Every one of them is enforced by
   `npm run content:check`, per locale: unit title <= 40, unit description 60-120,
   lesson title <= 32, headline <= 60, body 180-420, caption <= 90, explanation
   80-220, `sampleAnswer` 100-200, `fill_blank` distractor <= 32.
