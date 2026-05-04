/**
 * Standalone test — run with:
 *   npx ts-node --esm src/test-edge.ts
 *
 * Requires .env in project root with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import 'dotenv/config';
import { getSupabase } from './client.js';

async function main() {
  console.log('--- env check ---');
  console.log('SUPABASE_URL:              ', process.env.SUPABASE_URL ?? '(not set)');
  console.log('SUPABASE_ANON_KEY:         ', process.env.SUPABASE_ANON_KEY ? '(set)' : '(not set)');
  console.log('SUPABASE_SERVICE_ROLE_KEY: ', process.env.SUPABASE_SERVICE_ROLE_KEY ? '(set)' : '(not set)');

  console.log('\n--- calling generate-image ---');

  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke('generate-image', {
    body: {
      prompt:       'test noir portrait',
      model:        'gemini-flash',
      aspect_ratio: '1:1',
      size:         'square_1024',
    },
  });

  console.log('\n--- raw data ---');
  console.log(JSON.stringify(data, null, 2));

  console.log('\n--- raw error ---');
  if (error) {
    console.log('error.name:              ', error.name);
    console.log('error.message:           ', error.message);
    console.log('error.context?.status:   ', (error as any).context?.status);
    console.log('error.context (full):');
    try {
      const ctx = (error as any).context;
      if (ctx?.text) console.log(await ctx.text());
      else console.log(JSON.stringify(ctx, null, 2));
    } catch {
      console.log(String(error));
    }
  } else {
    console.log('(no error)');
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
