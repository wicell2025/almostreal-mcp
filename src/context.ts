import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  userToken:    string;
  mcpSessionId: string;
}

export const requestCtx = new AsyncLocalStorage<RequestContext>();
