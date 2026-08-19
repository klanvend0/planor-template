/**
 * A Supabase-shaped world for the edge functions to run against.
 *
 * The functions are the only part of the backend with no types tying them to
 * the schema and no test double behind them: they build their own client, talk
 * to RevenueCat and to an AI provider, and until now nothing had ever executed
 * one. This starts a local HTTP server that answers the handful of GoTrue and
 * PostgREST routes they use, records every request, and lets a test say what
 * the outside world should reply.
 *
 * It is deliberately literal: real `supabase-js` builds the requests, so a
 * wrong header, a wrong filter or a column that does not exist shows up here
 * the same way it would in production.
 *
 * @module supabase/functions/_tests/harness
 */

/**
 * Deep equality, with a message that names the difference.
 *
 * Local rather than `jsr:@std/assert` so the suite needs nothing but Deno
 * itself — some networks (CI behind a proxy, for one) cannot reach JSR.
 */
export function assertEquals(actual: unknown, expected: unknown, what = ''): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${what ? what + ': ' : ''}expected ${right}, got ${left}`);
  }
}

/** Asserts a condition, for the cases where equality is not the point. */
export function assert(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(what);
}

export type RecordedRequest = {
  method: string;
  path: string;
  search: string;
  headers: Record<string, string>;
  body: unknown;
};

export type Reply = { status?: number; body?: unknown };

/** What the stub should answer, keyed by `METHOD /path` or a route prefix. */
export type Routes = Record<string, Reply | ((request: RecordedRequest) => Reply)>;

export type Harness = {
  url: string;
  requests: RecordedRequest[];
  /** Requests that went to a host other than the stub (RevenueCat, the AI). */
  outbound: RecordedRequest[];
  stop: () => Promise<void>;
};

function match(routes: Routes, request: RecordedRequest): Reply | null {
  const exact = `${request.method} ${request.path}`;
  if (routes[exact]) {
    const route = routes[exact];
    return typeof route === 'function' ? route(request) : route;
  }
  for (const [pattern, route] of Object.entries(routes)) {
    const [method, path] = pattern.split(' ');
    if (
      method === request.method &&
      path.endsWith('*') &&
      request.path.startsWith(path.slice(0, -1))
    ) {
      return typeof route === 'function' ? route(request) : route;
    }
  }
  return null;
}

/**
 * Start the stub.
 *
 * @param routes - What to answer. Unmatched routes get a 404 and are still
 * recorded, so a test can assert on a call it did not expect.
 */
export async function startSupabaseStub(routes: Routes): Promise<Harness> {
  const requests: RecordedRequest[] = [];
  const outbound: RecordedRequest[] = [];

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (request) => {
    const url = new URL(request.url);
    const raw = await request.text();
    const recorded: RecordedRequest = {
      method: request.method,
      path: url.pathname,
      search: url.search,
      headers: Object.fromEntries(request.headers),
      body: raw ? safeJson(raw) : null,
    };
    requests.push(recorded);

    const reply = match(routes, recorded);
    if (!reply) {
      return new Response(JSON.stringify({ message: 'no route', path: url.pathname }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(reply.body ?? null), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const address = server.addr as Deno.NetAddr;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    outbound,
    stop: async () => {
      await server.shutdown();
    },
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Answer calls to hosts the stub does not serve — RevenueCat, the AI provider.
 *
 * Returns a restore function; call it in a `finally` so one test cannot leak a
 * stubbed `fetch` into the next.
 */
export function stubFetch(
  harness: Harness,
  handlers: Record<string, Reply | ((request: RecordedRequest) => Reply)>
): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    // Anything aimed at the stub is a real request; let it through.
    if (url.origin === harness.url) return original(request);

    const raw = await request.text();
    const recorded: RecordedRequest = {
      method: request.method,
      path: `${url.origin}${url.pathname}`,
      search: url.search,
      headers: Object.fromEntries(request.headers),
      body: raw ? safeJson(raw) : null,
    };
    harness.outbound.push(recorded);

    const reply = match(handlers as Routes, recorded);
    if (!reply) {
      return new Response(JSON.stringify({ message: 'unstubbed host' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(reply.body ?? null), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return () => {
    globalThis.fetch = original;
  };
}

/**
 * Import a function module with the environment it should read.
 *
 * Every function ends in `Deno.serve(handler)`, which would bind a port the
 * moment it is imported — and the second import would fail outright. So the
 * import happens with `Deno.serve` swapped for a no-op, and the handler is
 * called directly. What runs is the same code the runtime runs; only the
 * listening socket is missing.
 */
export async function loadFunction<T>(
  path: string,
  environment: Record<string, string>
): Promise<T> {
  for (const [key, value] of Object.entries(environment)) Deno.env.set(key, value);

  const serve = Deno.serve;
  Object.defineProperty(Deno, 'serve', {
    value: () => ({
      finished: Promise.resolve(),
      shutdown: async () => {},
      ref: () => {},
      unref: () => {},
      addr: { transport: 'tcp', hostname: '127.0.0.1', port: 0 },
    }),
    configurable: true,
    writable: true,
  });

  try {
    // A cache-busting query keeps one test's module-level constants (they read
    // the environment at import time) out of the next test's copy.
    const module = await import(`${path}?env=${encodeURIComponent(JSON.stringify(environment))}`);
    return module as T;
  } finally {
    Object.defineProperty(Deno, 'serve', { value: serve, configurable: true, writable: true });
  }
}
