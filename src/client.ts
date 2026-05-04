import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { requestCtx } from './context.js';

// Service-role singleton — used as fallback only.
let _serviceClient: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
      'Add them in Railway → Variables.',
    );
  }

  _serviceClient = createClient(url, key, { auth: { persistSession: false } });
  return _serviceClient;
}

export function getSupabase(): SupabaseClient {
  const ctx = requestCtx.getStore();
  if (ctx?.userToken) {
    // Per-user client scoped to their JWT — edge functions see a real user context.
    const url = process.env.SUPABASE_URL!;
    const anon = process.env.SUPABASE_ANON_KEY!;
    return createClient(url, anon, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${ctx.userToken}` } },
    });
  }
  return getServiceClient();
}

export async function callEdgeFunction<T = unknown>(
  name: string,
  body: unknown,
): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, {
    body: body as Record<string, unknown>,
  });

  if (error) {
    // Pull out as much detail as possible for Railway logs
    const status  = (error as any).context?.status  ?? 'unknown';
    const detail  = (error as any).context?.body    ?? error.message;
    console.error(`[edge-fn] "${name}" failed — status=${status} body=${detail}`);
    throw new Error(`Edge function "${name}" failed (${status}): ${detail}`);
  }

  return data as T;
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
