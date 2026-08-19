/**
 * Runs the edge functions' own tests.
 *
 * They are Deno modules that talk to Supabase, RevenueCat and an AI provider,
 * so `npm test` cannot see them at all: nothing in the Node test run imports a
 * single one. `supabase/functions/_tests` starts a local stand-in for the world
 * they call and runs the real handlers against it.
 *
 * Usage:
 *   npm run functions:check
 *
 * Needs Deno (https://deno.land). Without it this prints how to get it and
 * exits 0, so it can sit in a pipeline that does not have it.
 *
 * @module scripts/check_functions
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

if (spawnSync('sh', ['-c', 'command -v deno']).status !== 0) {
  console.log('Deno is not installed, so the edge functions were not checked.');
  console.log('Install it with `curl -fsSL https://deno.land/install.sh | sh`, or run');
  console.log('`npx deno test --config supabase/functions/_tests/deno.json ...` yourself.');
  process.exit(0);
}

const result = spawnSync(
  'deno',
  [
    'test',
    '--config',
    'supabase/functions/_tests/deno.json',
    '--allow-net',
    '--allow-env',
    '--allow-read',
    'supabase/functions/_tests/',
  ],
  { cwd: ROOT, stdio: 'inherit' }
);

process.exit(result.status ?? 1);
