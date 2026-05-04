import 'dotenv/config';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport }   from '@modelcontextprotocol/sdk/server/sse.js';
import express                  from 'express';

import { createServer } from './server.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

if (PORT) {
  // ── HTTP / SSE mode — for Railway and cloud deployments ──────────────────
  const app = express();
  app.use(express.json());

  // Map sessionId → transport so /messages can route back to the right session
  const sessions = new Map<string, SSEServerTransport>();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', transport: 'sse' });
  });

  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    const server    = createServer();

    sessions.set(transport.sessionId, transport);
    res.on('close', () => sessions.delete(transport.sessionId));

    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId  = req.query.sessionId as string;
    const transport  = sessions.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    process.stderr.write(`almostreal-mcp listening on port ${PORT} (SSE transport)\n`);
  });
} else {
  // ── stdio mode — for Claude Desktop ──────────────────────────────────────
  const server    = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
