import { callEdgeFunction } from '../client.js';

export const enhanceImageSchema = {
  type: 'object',
  properties: {
    image_url: {
      type: 'string',
      description: 'Publicly-accessible URL of the image to enhance.',
    },
    operation: {
      type: 'string',
      enum: ['upscale', 'restore_face', 'remove_background'],
      description:
        'Enhancement operation to apply. ' +
        'upscale: increase resolution (2× or 4×). ' +
        'restore_face: fix face details and clarity. ' +
        'remove_background: make background transparent.',
    },
    scale: {
      type: 'number',
      enum: [2, 4],
      description: 'Upscale factor — only used when operation is "upscale". Default: 2.',
      default: 2,
    },
  },
  required: ['image_url', 'operation'],
} as const;

interface Args {
  image_url: string;
  operation: 'upscale' | 'restore_face' | 'remove_background';
  scale?: number;
}

export async function enhanceImage(args: Args): Promise<string> {
  switch (args.operation) {
    case 'upscale': {
      const data = await callEdgeFunction<any>('upscale-image', {
        image_url: args.image_url,
        scale:     args.scale ?? 2,
      });
      if (!data.success) throw new Error(data.error ?? 'Upscale failed');
      return data.image_url as string;
    }

    case 'restore_face': {
      const data = await callEdgeFunction<any>('restore-face', {
        image_url: args.image_url,
      });
      if (!data.success) throw new Error(data.error ?? 'Face restoration failed');
      return data.image_url as string;
    }

    case 'remove_background': {
      const data = await callEdgeFunction<any>('remove-background', {
        image_url: args.image_url,
      });
      if (!data.success) throw new Error(data.error ?? 'Background removal failed');
      return data.image_url as string;
    }

    default:
      throw new Error(`Unknown operation: ${args.operation}`);
  }
}
