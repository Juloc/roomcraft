export interface AuthUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface AuthSession {
  setupRequired: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

export async function getAuthSession(): Promise<AuthSession> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Loading session failed with HTTP ${response.status}.`);
  return (await response.json()) as AuthSession;
}

export async function setupAdmin(username: string, password: string): Promise<AuthSession> {
  return submitCredentials("/api/auth/setup", username, password);
}

export async function login(username: string, password: string): Promise<AuthSession> {
  return submitCredentials("/api/auth/login", username, password);
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Logout failed with HTTP ${response.status}.`);
}

async function submitCredentials(
  url: string,
  username: string,
  password: string,
): Promise<AuthSession> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? (response.status === 401 ? "Username or password is incorrect." : `Request failed with HTTP ${response.status}.`));
  }

  return (await response.json()) as AuthSession;
}
