import 'dotenv/config';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport }   from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response, NextFunction } from 'express';

import { createServer } from './server.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

if (PORT) {
  // ── HTTP / SSE mode — Railway and cloud deployments ──────────────────────
  console.log(`MCP Server starting on port ${PORT}`);

  const app = express();
  app.use(express.json());

  // ── CORS — must run before every route ───────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, mcp-session-id',
    );
    // Preflight: respond immediately with 204 No Content
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Map sessionId → transport so POST /messages can route to the right session
  const sessions = new Map<string, SSEServerTransport>();

  app.get('/health', (_req: Request, res: Response) => {
    console.log('Health check hit');
    res.json({ status: 'ok', transport: 'sse', port: PORT });
  });

  app.get('/sse', async (req: Request, res: Response) => {
    console.log('New SSE connection from', req.headers.origin ?? 'unknown origin');

    // Explicit SSE headers — required by the MCP SSE transport spec
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    const transport = new SSEServerTransport('/messages', res);
    const server    = createServer();

    sessions.set(transport.sessionId, transport);
    res.on('close', () => {
      sessions.delete(transport.sessionId);
      console.log(`SSE session ${transport.sessionId} closed`);
    });

    await server.connect(transport);
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessions.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    console.log(`MCP Server listening on port ${PORT}`);
    console.log('Health check endpoint ready at /health');
    console.log('SSE endpoint ready at /sse');
    console.log(`SUPABASE_URL configured: ${Boolean(process.env.SUPABASE_URL)}`);
    console.log(`SUPABASE_ANON_KEY configured: ${Boolean(process.env.SUPABASE_ANON_KEY)}`);
    console.log(`SUPABASE_ACCESS_TOKEN configured: ${Boolean(process.env.SUPABASE_ACCESS_TOKEN)}`);
  });
} else {
  // ── stdio mode — Claude Desktop ───────────────────────────────────────────
  const server    = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
