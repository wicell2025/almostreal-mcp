const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY!;
const USER_TOKEN    = process.env.SUPABASE_ACCESS_TOKEN || SUPABASE_ANON;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
}

export async function callEdgeFunction<T = unknown>(
  name: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${USER_TOKEN}`,
      apikey:         SUPABASE_ANON,
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

    if (opts.isDone(data))                              return opts.extract(data);
    if (opts.isFailed?.(data) ?? (data as any).status === 'failed') {
      throw new Error(`Task failed: ${JSON.stringify(data)}`);
    }
  }

  throw new Error(`Timeout after ${max} attempts waiting for "${opts.check}"`);
}
