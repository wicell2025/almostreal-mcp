import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { StdioServerTransport }          from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response, NextFunction } from 'express';

import { createServer }                                        from './server.js';
import { setAuthSession, deleteAuthSession, getAuthSession }   from './auth.js';

const PORT    = process.env.PORT     ? parseInt(process.env.PORT, 10) : null;
const BASE_URL = process.env.BASE_URL ?? 'https://almostreal-production.up.railway.app';

// ── Login HTML page ───────────────────────────────────────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AlmostReal — Sign In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0a0a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e5e5e5;
    }
    .card {
      width: 100%;
      max-width: 360px;
      padding: 40px 32px;
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
    }
    .logo {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
      color: #fff;
    }
    .subtitle {
      font-size: 13px;
      color: #666;
      margin-bottom: 32px;
      line-height: 1.5;
    }
    label {
      display: block;
      font-size: 12px;
      color: #888;
      margin-bottom: 6px;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }
    input {
      display: block;
      width: 100%;
      padding: 10px 12px;
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 8px;
      color: #e5e5e5;
      font-size: 14px;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #7c5cfc; }
    button[type="submit"] {
      width: 100%;
      padding: 11px;
      background: #7c5cfc;
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      margin-top: 4px;
    }
    button[type="submit"]:hover { background: #6b4de6; }
    #status {
      margin-top: 16px;
      font-size: 13px;
      color: #888;
      text-align: center;
      min-height: 20px;
    }
    #status.error { color: #f87171; }
    #status.success { color: #4ade80; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">AlmostReal</div>
    <p class="subtitle">Sign in to connect your account to Claude's MCP tools.</p>
    <form id="form">
      <label for="email">Email</label>
      <input id="email" type="email" name="email" required autocomplete="email" />
      <label for="password">Password</label>
      <input id="password" type="password" name="password" required autocomplete="current-password" />
      <input type="hidden" id="mcp_session" name="mcp_session" value="" />
      <button type="submit">Sign In</button>
    </form>
    <div id="status"></div>
  </div>
  <script>
    // Grab mcp_session from query string and put it in the hidden field.
    const params = new URLSearchParams(location.search);
    document.getElementById('mcp_session').value = params.get('mcp_session') ?? '';

    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('status');
      status.textContent = 'Signing in…';
      status.className = '';

      const body = {
        email:       document.getElementById('email').value,
        password:    document.getElementById('password').value,
        mcp_session: document.getElementById('mcp_session').value,
      };

      try {
        const res = await fetch('/auth/sign-in', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Sign-in failed');

        status.className = 'success';
        status.textContent = 'Signed in! You can close this tab and reconnect Claude.';
      } catch (err) {
        status.className = 'error';
        status.textContent = err.message;
      }
    });
  </script>
</body>
</html>`;

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

  // ── GET /login — sign-in UI ───────────────────────────────────────────────
  app.get('/login', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(LOGIN_HTML);
  });

  // ── POST /auth/sign-in — email/password → store JWT by mcp_session ────────
  app.post('/auth/sign-in', async (req: Request, res: Response) => {
    const { email, password, mcp_session } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const supabaseUrl  = process.env.SUPABASE_URL!;
    const supabaseAnon = process.env.SUPABASE_ANON_KEY!;

    if (!supabaseUrl || !supabaseAnon) {
      res.status(500).json({ error: 'Server not configured (missing Supabase env vars)' });
      return;
    }

    try {
      const authUrl = `${supabaseUrl}/auth/v1/token?grant_type=password`;
      console.log(`[auth] POST ${authUrl} (apikey length=${supabaseAnon.length})`);

      const authRes = await fetch(authUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':        supabaseAnon,
        },
        body: JSON.stringify({ email, password }),
      });

      const raw = await authRes.json() as any;
      console.log(`[auth] sign-in response status=${authRes.status} body=${JSON.stringify(raw)}`);

      if (!authRes.ok || !raw.access_token) {
        res.status(401).json({ error: raw.error_description ?? raw.msg ?? raw.error ?? 'Authentication failed' });
        return;
      }

      const { access_token, refresh_token, expires_in } = raw;

      if (mcp_session) {
        setAuthSession(mcp_session, {
          access_token,
          refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + (expires_in ?? 3600),
        });
        console.log(`[auth] session authenticated: mcp_session=${mcp_session} user=${raw.user?.email}`);
      }

      res.json({ ok: true, user: raw.user?.email });
    } catch (err) {
      console.error('[auth] sign-in error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /auth/status — check whether an mcp_session is authenticated ──────
  app.get('/auth/status', (req: Request, res: Response) => {
    const { mcp_session } = req.query as Record<string, string>;
    if (!mcp_session) {
      res.status(400).json({ error: 'mcp_session query param required' });
      return;
    }
    const session = getAuthSession(mcp_session);
    res.json({ authenticated: Boolean(session) });
  });

  // ── GET /mcp — not used by claude.ai Streamable HTTP (POST-only) ──────────
  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      error:   'Method Not Allowed',
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
          deleteAuthSession(transport.sessionId);
          console.log(`MCP session closed: ${transport.sessionId}`);
        }
      };

      // Pass a getter so server.ts can look up the session ID at call time.
      const server = createServer(() => transport.sessionId);
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
    console.log(`Login page:                           ${BASE_URL}/login`);
    console.log('Health check endpoint ready at /health');
    console.log('MCP endpoint ready at POST /mcp');
    console.log(`SUPABASE_URL configured:              ${Boolean(process.env.SUPABASE_URL)}`);
    console.log(`SUPABASE_ANON_KEY configured:         ${Boolean(process.env.SUPABASE_ANON_KEY)}`);
    console.log(`SUPABASE_SERVICE_ROLE_KEY configured: ${Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}`);
  });
} else {
  // ── stdio mode — Claude Desktop ───────────────────────────────────────────
  const server    = createServer(); // no auth in stdio mode
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
