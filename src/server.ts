import { Server }          from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { generateImage,  generateImageSchema  } from './tools/generate_image.js';
import { generateVideo,  generateVideoSchema  } from './tools/generate_video.js';
import { enhanceImage,   enhanceImageSchema   } from './tools/enhance_image.js';
import { runWorkflow,    runWorkflowSchema    } from './tools/run_workflow.js';
import { getAuthSession }                        from './auth.js';
import { requestCtx }                            from './context.js';

const BASE_URL = process.env.BASE_URL ?? 'https://almostreal-production.up.railway.app';
const LOGIN_URL = `${BASE_URL}/login`;

const TOOLS: Tool[] = [
  {
    name:        'generate_image',
    description: 'Generate an image from a text prompt using AI models (Gemini, GPT-Image, SeeDream, MiniMax, Kling).',
    inputSchema: generateImageSchema as unknown as Tool['inputSchema'],
  },
  {
    name:        'generate_video',
    description: 'Generate a short video clip from a text prompt, optionally from a source image (image-to-video).',
    inputSchema: generateVideoSchema as unknown as Tool['inputSchema'],
  },
  {
    name:        'enhance_image',
    description: 'Enhance an existing image: upscale resolution, restore face details, or remove background.',
    inputSchema: enhanceImageSchema as unknown as Tool['inputSchema'],
  },
  {
    name:        'run_workflow',
    description: 'Execute a saved almostreal workflow by its ID, optionally overriding prompt inputs.',
    inputSchema: runWorkflowSchema as unknown as Tool['inputSchema'],
  },
];

/**
 * @param getSessionId - returns the current MCP session ID (may be undefined in stdio mode)
 */
export function createServer(getSessionId?: () => string | undefined): Server {
  const server = new Server(
    { name: 'almostreal-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    // ── Auth check (HTTP mode only) ───────────────────────────────────────────
    const mcpSessionId = getSessionId?.();
    if (mcpSessionId) {
      const session = getAuthSession(mcpSessionId);
      if (!session) {
        return {
          content: [{
            type: 'text',
            text: `Not authenticated. Please sign in to almostreal first:\n${LOGIN_URL}\n\nAfter signing in, reconnect this MCP server.`,
          }],
          isError: true,
        };
      }

      // Run the tool with the user's JWT in async context.
      return requestCtx.run({ userToken: session.access_token, mcpSessionId }, () =>
        dispatchTool(name, args),
      );
    }

    // stdio mode — no auth, service-role client used.
    return dispatchTool(name, args);
  });

  return server;
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    let result: unknown;

    switch (name) {
      case 'generate_image': {
        const url = await generateImage(args as any);
        result = { image_url: url };
        break;
      }
      case 'generate_video': {
        const url = await generateVideo(args as any);
        result = { video_url: url };
        break;
      }
      case 'enhance_image': {
        const url = await enhanceImage(args as any);
        result = { image_url: url };
        break;
      }
      case 'run_workflow': {
        result = await runWorkflow(args as any);
        break;
      }
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
