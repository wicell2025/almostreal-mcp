// All env reads are deferred into the function body so module import never throws.
// The app can bind to PORT and serve /health even before env vars are configured.

function getEnv() {
  const url   = process.env.SUPABASE_URL;
  const anon  = process.env.SUPABASE_ANON_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN || anon;

  if (!url || !anon) {
    throw new Error(
      'Missing env vars: SUPABASE_URL and SUPABASE_ANON_KEY must be set. ' +
      'Add them in Railway → Variables.',
    );
  }

  return { url, anon, token: token! };
}

export async function callEdgeFunction<T = unknown>(
  name: string,
  body: unknown,
): Promise<T> {
  const { url, anon, token } = getEnv();

  const res = await fetch(`${url}/functions/v1/${name}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      apikey:         anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Edge function "${name}" failed (${res.status}): ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Edge function "${name}" returned non-JSON: ${text}`);
  }
}

export async function poll<T>(opts: {
  check: string;
  body: unknown;
  isDone: (data: unknown) => boolean;
  isFailed?: (data: unknown) => boolean;
  extract: (data: unknown) => T;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<T> {
  const max      = opts.maxAttempts ?? 60;
  const interval = opts.intervalMs  ?? 3000;

  for (let i = 0; i < max; i++) {
    await new Promise(r => setTimeout(r, interval));
    const data = await callEdgeFunction(opts.check, opts.body);

    if (opts.isDone(data)) return opts.extract(data);
    if (opts.isFailed?.(data) ?? (data as any).status === 'failed') {
      throw new Error(`Task failed: ${JSON.stringify(data)}`);
    }
  }

  throw new Error(`Timeout after ${max} attempts waiting for "${opts.check}"`);
}
