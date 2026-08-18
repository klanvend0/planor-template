/**
 * Localization validator.
 *
 * Three failures this catches that TypeScript cannot:
 *   1. a key that exists in one locale and not the other (the app would fall
 *      back to English mid-screen);
 *   2. interpolation placeholders that differ between locales (`%{count}` in one
 *      and nothing in the other renders a literal placeholder to a learner);
 *   3. a key referenced in code that exists in neither dictionary.
 *
 * Usage: node scripts/check_i18n.mts
 *
 * @module scripts/check_i18n
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOCALES = ['en', 'tr'] as const;
const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'stores'];

type Dictionary = Record<string, unknown>;

/** i18n-js plural forms: an object of these is one key, not a nested group. */
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function isPluralGroup(value: object): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => PLURAL_FORMS.has(key));
}

const problems: string[] = [];

/** Flatten a nested dictionary into dotted keys. */
function flatten(value: Dictionary, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      if (isPluralGroup(entry)) {
        // Every plural form shares one key and must share its placeholders.
        flat.set(path, Object.values(entry as Record<string, string>).join(' '));
        continue;
      }
      for (const [nested, text] of flatten(entry as Dictionary, path)) flat.set(nested, text);
    } else if (typeof entry === 'string') {
      flat.set(path, entry);
    }
  }
  return flat;
}

/** The `%{name}` placeholders inside a string, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/%\{(\w+)\}/g)].map((match) => match[1]).sort();
}

/** Every `.ts`/`.tsx` file under the app's source directories. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        walk(path);
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        files.push(path);
      }
    }
  };
  for (const dir of SOURCE_DIRS) {
    try {
      walk(join(ROOT, dir));
    } catch {
      // A source directory that does not exist yet is not a failure.
    }
  }
  return files;
}

function main(): void {
  const dictionaries = new Map<string, Map<string, string>>();
  for (const locale of LOCALES) {
    const raw = JSON.parse(readFileSync(join(ROOT, 'i18n', `${locale}.json`), 'utf8')) as Dictionary;
    dictionaries.set(locale, flatten(raw));
  }

  const [base, ...others] = LOCALES;
  const baseKeys = dictionaries.get(base)!;

  // 1 + 2: every locale carries the same keys, with the same placeholders.
  for (const locale of others) {
    const keys = dictionaries.get(locale)!;

    for (const key of baseKeys.keys()) {
      if (!keys.has(key)) problems.push(`${locale}.json is missing "${key}"`);
    }
    for (const key of keys.keys()) {
      if (!baseKeys.has(key)) problems.push(`${base}.json is missing "${key}"`);
    }

    for (const [key, text] of baseKeys) {
      const other = keys.get(key);
      if (!other) continue;
      const expected = placeholders(text);
      const actual = placeholders(other);
      if (expected.join(',') !== actual.join(',')) {
        problems.push(
          `"${key}" interpolates {${expected.join(', ')}} in ${base} but {${actual.join(', ')}} in ${locale}`
        );
      }
    }
  }

  // 3: keys referenced in code exist. Only literal `t('...')` calls can be
  // checked; template-built keys are cast at the call site and skipped.
  const referenced = new Set<string>();
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/gi)) {
      referenced.add(match[1]);
    }
  }

  for (const key of referenced) {
    if (!baseKeys.has(key)) problems.push(`code references "${key}", which no dictionary defines`);
  }

  console.log(
    `Checked ${LOCALES.length} locales, ${baseKeys.size} keys, ${referenced.size} literal references.`
  );

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`FAILED with ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('Localization is complete and consistent.');
}

main();
