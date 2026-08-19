/**
 * Runs `supabase/__tests__/schema.test.ts` against a real PostgreSQL.
 *
 * The RPCs in the migration are the authority on XP, hearts and streaks, and
 * PL/pgSQL compiles them at call time — a function that raises on every call
 * still installs without complaint. So the only way to know the schema works is
 * to run it. This starts a throwaway cluster, applies the migrations on top of
 * the little that Supabase provides (the `auth` schema, the three roles and
 * their default privileges), hands the DSN to Jest and throws the cluster away.
 *
 * Usage:
 *   npm run db:check                       # a throwaway cluster
 *   SCHEMA_TEST_DSN=postgres://... npm run db:check   # a database you provide
 *
 * Needs a local PostgreSQL server (`initdb`, `pg_ctl`, `psql`). Without one it
 * prints how to install it and exits 0, so it can sit in a pipeline that does
 * not have a database.
 *
 * @module scripts/check_schema
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** What Supabase gives a project before any migration runs. */
const SUPABASE_PRELUDE = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- GoTrue puts the signed-in user's id in the JWT; here it comes from a setting.
create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

function has(binary: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8' }).status === 0;
}

/** The PostgreSQL server binaries, which Debian keeps out of PATH. */
function serverBin(): string | null {
  if (has('initdb') && has('pg_ctl')) return '';
  const versions = existsSync('/usr/lib/postgresql')
    ? readdirSync('/usr/lib/postgresql').sort().reverse()
    : [];
  for (const version of versions) {
    const dir = `/usr/lib/postgresql/${version}/bin`;
    if (existsSync(join(dir, 'initdb'))) return dir;
  }
  return null;
}

function psql(dsn: string, args: string[]): void {
  execFileSync('psql', [dsn, '-v', 'ON_ERROR_STOP=1', '-q', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function applySchema(dsn: string): void {
  const prelude = join(tmpdir(), 'codeling-supabase-prelude.sql');
  writeFileSync(prelude, SUPABASE_PRELUDE);
  psql(dsn, ['-f', prelude]);

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    psql(dsn, ['-f', join(MIGRATIONS, file)]);
  }

  // Supabase's default privileges apply to tables created after they are set;
  // the migrations above ran in the same session, so grant them explicitly too.
  psql(dsn, [
    '-c',
    `grant all on all tables in schema public to anon, authenticated, service_role;
     grant all on all sequences in schema public to anon, authenticated, service_role;`,
  ]);
}

function runJest(dsn: string): number {
  const jest = spawnSync(
    'npx',
    ['jest', '--runTestsByPath', 'supabase/__tests__/schema.test.ts', '--runInBand'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SCHEMA_TEST_DSN: dsn } }
  );
  return jest.status ?? 1;
}

// A database the caller provided: use it as it is, after applying the schema.
const provided = process.env.SCHEMA_TEST_DSN;
if (provided) {
  applySchema(provided);
  process.exit(runJest(provided));
}

const bin = serverBin();
if (!bin && bin !== '') {
  console.log('No local PostgreSQL server found, so the schema was not checked.');
  console.log('Install one (apt install postgresql, or brew install postgresql) or point');
  console.log('SCHEMA_TEST_DSN at a database this may create and drop objects in.');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'codeling-pg-'));
const data = join(dir, 'data');
const port = 5433 + Math.floor(process.pid % 500);

// PostgreSQL refuses to run as root, which is exactly what a container usually
// is. Where there is a `postgres` account, hand the server binaries to it and
// give it the scratch directory; psql itself is happy either way.
const asPostgres = process.getuid?.() === 0 && spawnSync('id', ['-u', 'postgres']).status === 0;
if (asPostgres) execFileSync('chown', ['-R', 'postgres', dir]);

const run = (binary: string, args: string[]) => {
  const path = join(bin, binary);
  if (!asPostgres) return execFileSync(path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const quoted = [path, ...args].map((part) => `'${part.replaceAll("'", `'\\''`)}'`).join(' ');
  return execFileSync('su', ['postgres', '-c', quoted], { stdio: ['ignore', 'ignore', 'pipe'] });
};

let started = false;
try {
  run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust']);
  // A unix socket in the scratch directory: no TCP port to collide with, and
  // nothing reachable from outside this machine.
  run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -h ''`, '-w', 'start']);
  started = true;

  const dsn = `postgres://postgres@localhost:${port}/codeling?host=${dir}`;
  execFileSync(
    'psql',
    [
      `postgres://postgres@localhost:${port}/postgres?host=${dir}`,
      '-q',
      '-c',
      'create database codeling;',
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );

  applySchema(dsn);
  process.exitCode = runJest(dsn);
} catch (error) {
  const detail = error instanceof Error && 'stderr' in error ? String(error.stderr) : String(error);
  console.error('Could not check the schema:', detail.trim() || error);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    } catch {
      // The cluster is in a temporary directory either way.
    }
  }
  rmSync(dir, { recursive: true, force: true });
}
