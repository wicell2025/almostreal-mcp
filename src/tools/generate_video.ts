import { callEdgeFunction, poll } from '../client.js';

export const generateVideoSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: 'Text description of the video to generate.',
    },
    model: {
      type: 'string',
      description:
        'Model ID. Supported: kling-2.0 (default), kling-1.5, kling-1.0.',
      default: 'kling-2.0',
    },
    image_url: {
      type: 'string',
      description:
        'Optional publicly-accessible URL of a source image for image-to-video generation.',
    },
    aspect_ratio: {
      type: 'string',
      enum: ['16:9', '9:16', '1:1'],
      description: 'Output aspect ratio. Default: 16:9.',
      default: '16:9',
    },
    duration: {
      type: 'number',
      description: 'Clip duration in seconds. Supported values: 5 or 10. Default: 5.',
      default: 5,
    },
  },
  required: ['prompt'],
} as const;

interface Args {
  prompt: string;
  model?: string;
  image_url?: string;
  aspect_ratio?: string;
  duration?: number;
}

export async function generateVideo(args: Args): Promise<string> {
  const model       = args.model        ?? 'kling-2.0';
  const ratio       = args.aspect_ratio ?? '16:9';
  const duration    = args.duration     ?? 5;

  // UI model IDs → Kling API model IDs
  const apiModel = model === 'kling-2.0' ? 'kling-v2'
    : model === 'kling-1.5'              ? 'kling-v1-5'
    :                                      'kling-v1';

  const body: Record<string, unknown> = {
    prompt:       args.prompt,
    model:        apiModel,
    aspect_ratio: ratio,
    duration:     duration,
    mode:         'std',
  };
  if (args.image_url) {
    body.image_url = args.image_url;
  }

  const create = await callEdgeFunction<any>('generate-video-kling', body);
  if (!create.success || !create.task_id) {
    throw new Error(create.error ?? 'Kling video task creation failed');
  }

  const videoUrl = await poll<string>({
    check:   'check-video-status-kling',
    body:    { task_id: create.task_id },
    isDone:  (d: any) => d.status === 'completed' && Boolean(d.video_url),
    isFailed:(d: any) => d.status === 'failed',
    extract: (d: any) => d.video_url as string,
    maxAttempts: 90,  // videos can take up to 4–5 min
    intervalMs:  5000,
  });

  return videoUrl;
}
