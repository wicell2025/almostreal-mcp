import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { StdioServerTransport }          from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response, NextFunction } from 'express';

import { createServer } from './server.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

if (PORT) {
  // ── HTTP mode — Railway / cloud deployments ───────────────────────────────
  console.log(`MCP Server starting on port ${PORT}`);

  const app = express();
  app.use(express.json());

  // ── CORS — before every route ─────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, mcp-session-id',
    );
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // sessionId → transport for stateful session routing
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  // ── /health ───────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', transport: 'streamable-http', sessions: sessions.size });
  });

  // ── GET /mcp — not used by claude.ai Streamable HTTP (POST-only) ──────────
  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      error: 'Method Not Allowed',
      message: 'Connect via POST /mcp using the MCP Streamable HTTP transport.',
    });
  });

  // ── POST /mcp — all MCP messages ──────────────────────────────────────────
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    console.log(`MCP POST session=${sessionId ?? 'new'}`);

    // Route to an existing session if the header is present and known
    if (sessionId && sessions.has(sessionId)) {
      try {
        await sessions.get(sessionId)!.handleRequest(req, res, req.body);
      } catch (err) {
        console.error('MCP session error:', err);
        if (!res.headersSent) res.status(500).json({ error: String(err) });
      }
      return;
    }

    // New session: create transport + MCP server pair
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
          console.log(`MCP session created: ${id}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          console.log(`MCP session closed: ${transport.sessionId}`);
        }
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP init error:', err);
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  // ── DELETE /mcp — session termination ─────────────────────────────────────
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP DELETE error:', err);
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  app.listen(PORT, () => {
    console.log(`MCP Server listening on port ${PORT}`);
    console.log('Health check endpoint ready at /health');
    console.log('MCP endpoint ready at POST /mcp');
    console.log(`SUPABASE_URL configured:          ${Boolean(process.env.SUPABASE_URL)}`);
    console.log(`SUPABASE_ANON_KEY configured:     ${Boolean(process.env.SUPABASE_ANON_KEY)}`);
    console.log(`SUPABASE_ACCESS_TOKEN configured: ${Boolean(process.env.SUPABASE_ACCESS_TOKEN)}`);
  });
} else {
  // ── stdio mode — Claude Desktop ───────────────────────────────────────────
  const server    = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
