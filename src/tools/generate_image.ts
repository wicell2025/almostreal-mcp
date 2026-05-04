import { callEdgeFunction, poll } from '../client.js';

// Models that accept a compound size like "2K-16:9"
const RESOLUTION_MODELS = new Set([
  'gemini-3-pro-image',
  'seedream-4-5',
  'seedream-4-0',
]);

// Map workflow aspect ratio to Gemini size string
function toGeminiSize(size: string): string {
  if (size.includes('16:9')) return 'horizontal_16_9';
  if (size.includes('9:16')) return 'vertical_9_16';
  return 'square_1024'; // 1:1, 4:3, bare resolution keys
}

export const generateImageSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: 'Text description of the image to generate.',
    },
    model: {
      type: 'string',
      description:
        'Model ID. Supported: gemini-flash (default), gemini-3-pro-image, ' +
        'gpt-image-1, gpt-image-1.5, gpt-image-1-mini, ' +
        'seedream-4-5, seedream-4-0, minimax-image-01, ' +
        'kling-2.0, kling-1.5, kling-1.0.',
      default: 'gemini-flash',
    },
    aspect_ratio: {
      type: 'string',
      enum: ['1:1', '16:9', '9:16', '4:3'],
      description: 'Output aspect ratio. Default: 1:1.',
      default: '1:1',
    },
    resolution: {
      type: 'string',
      enum: ['1K', '2K', '4K'],
      description:
        'Output resolution — only honoured for gemini-3-pro-image, seedream-4-5, seedream-4-0.',
    },
    reference_image_url: {
      type: 'string',
      description: 'Optional publicly-accessible URL of a reference image.',
    },
  },
  required: ['prompt'],
} as const;

interface Args {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  reference_image_url?: string;
}

export async function generateImage(args: Args): Promise<string> {
  console.log('[generate_image] called with args:', JSON.stringify(args));
  try {
    return await _generateImage(args);
  } catch (err) {
    console.error('[generate_image] FAILED');
    console.error('[generate_image] error type:   ', err instanceof Error ? err.constructor.name : typeof err);
    console.error('[generate_image] error message:', err instanceof Error ? err.message : String(err));
    try { console.error('[generate_image] full error:   ', JSON.stringify(err, Object.getOwnPropertyNames(err))); } catch {}
    throw err;
  }
}

async function _generateImage(args: Args): Promise<string> {
  const model = args.model ?? 'gemini-flash';
  const ratio = args.aspect_ratio ?? '1:1';

  const size = RESOLUTION_MODELS.has(model) && args.resolution
    ? (ratio === '1:1' ? args.resolution : `${args.resolution}-${ratio}`)
    : ratio;

  // ── BytePlus SeeDream ─────────────────────────────────────────────────────
  if (model.startsWith('seedream')) {
    const data = await callEdgeFunction<any>('generate-image-seedream', {
      prompt: args.prompt,
      model,
      size,
    });
    if (!data.success || !data.image_url) throw new Error(data.error ?? 'SeeDream generation failed');
    return data.image_url as string;
  }

  // ── OpenAI GPT-Image ──────────────────────────────────────────────────────
  if (model.startsWith('gpt-image')) {
    const data = await callEdgeFunction<any>('generate-image-openai', {
      prompt: args.prompt,
      model,
      size: ratio, // OpenAI uses aspect ratio directly
    });
    if (!data.success || !data.image_url) throw new Error(data.error ?? 'OpenAI generation failed');
    return data.image_url as string;
  }

  // ── MiniMax ───────────────────────────────────────────────────────────────
  if (model.startsWith('minimax')) {
    const data = await callEdgeFunction<any>('generate-image-minimax', {
      prompt: args.prompt,
      size: ratio,
    });
    if (!data.image_url) throw new Error(data.error ?? 'MiniMax generation failed');
    return data.image_url as string;
  }

  // ── Kling (async / poll) ──────────────────────────────────────────────────
  if (model.startsWith('kling')) {
    // UI model IDs (kling-2.0) → API model IDs (kling-v2)
    const apiModel = model === 'kling-2.0' ? 'kling-v2'
      : model === 'kling-1.5'              ? 'kling-v1-5'
      :                                      'kling-v1';

    const create = await callEdgeFunction<any>('generate-image-kling', {
      prompt:       args.prompt,
      model:        apiModel,
      aspect_ratio: ratio,
      image_count:  1,
    });
    if (!create.success || !create.task_id) throw new Error(create.error ?? 'Kling task creation failed');

    const result = await poll<string>({
      check:  'check-image-status-kling',
      body:   { task_id: create.task_id },
      isDone: (d: any) => d.status === 'succeed' && d.images?.length > 0,
      extract: (d: any) => d.images[0].url as string,
    });
    return result;
  }

  // ── Gemini (default) ──────────────────────────────────────────────────────
  const apiModel   = model === 'gemini-3-pro-image' ? 'gemini-flash' : model;
  const geminiSize = toGeminiSize(size);

  const body: Record<string, unknown> = {
    prompt: args.prompt,
    model:  apiModel,
    size:   geminiSize,
  };
  if (args.reference_image_url) {
    body.reference_images = [args.reference_image_url];
  }

  const data = await callEdgeFunction<any>('generate-image', body);
  if (!data.success || !data.image) throw new Error(data.error ?? 'Gemini generation failed');
  return data.image.image_url as string;
}
