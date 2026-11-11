// Central auth + API helper. The server identifies the user ONLY from the
// login session token (Authorization: Bearer ...) — never from client headers.
const TOKEN_KEY = 'leadflow_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore (private mode etc.)
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// fetch() wrapper that attaches the session token and broadcasts a
// 'leadflow:unauthorized' event on 401 so the app can return to login.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const resp = await fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), ...authHeaders() },
  });
  if (resp.status === 401) {
    window.dispatchEvent(new Event('leadflow:unauthorized'));
  }
  return resp;
}
