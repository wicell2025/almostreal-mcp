export interface UserSession {
  access_token:  string;
  refresh_token: string;
  expires_at:    number; // unix seconds
}

// mcpSessionId → authenticated user session
const authSessions = new Map<string, UserSession>();

export function setAuthSession(mcpSessionId: string, session: UserSession): void {
  authSessions.set(mcpSessionId, session);
}

export function getAuthSession(mcpSessionId: string): UserSession | null {
  const s = authSessions.get(mcpSessionId);
  if (!s) return null;
  if (s.expires_at && s.expires_at < Date.now() / 1000 + 60) {
    authSessions.delete(mcpSessionId);
    return null;
  }
  return s;
}

export function deleteAuthSession(mcpSessionId: string): void {
  authSessions.delete(mcpSessionId);
}
