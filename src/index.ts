import 'dotenv/config';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport }   from '@modelcontextprotocol/sdk/server/sse.js';
import express                  from 'express';

import { createServer } from './server.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

if (PORT) {
  // ── HTTP / SSE mode — Railway and cloud deployments ──────────────────────
  console.log(`MCP Server starting on port ${PORT}`);

  const app = express();
  app.use(express.json());

  // Map sessionId → transport so POST /messages can route to the right session
  const sessions = new Map<string, SSEServerTransport>();

  app.get('/health', (_req, res) => {
    console.log('Health check hit');
    res.json({ status: 'ok', transport: 'sse', port: PORT });
  });

  app.get('/sse', async (req, res) => {
    console.log('New SSE connection established');
    const transport = new SSEServerTransport('/messages', res);
    const server    = createServer();

    sessions.set(transport.sessionId, transport);
    res.on('close', () => {
      sessions.delete(transport.sessionId);
      console.log(`SSE session ${transport.sessionId} closed`);
    });

    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
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
