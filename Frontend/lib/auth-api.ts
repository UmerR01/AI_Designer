/**
 * Frontend helper for calling this Next.js app's Route Handlers under `app/api/*`.
 * No CSRF bootstrapping is needed because we use same-origin requests + httpOnly session cookies.
 */

export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function parseErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    // DRF serializer errors: { field: ["msg"] } or { non_field_errors: ["msg"] }
    if (data && typeof data === "object") {
      const nf = (data as any).non_field_errors;
      if (Array.isArray(nf) && typeof nf[0] === "string") return nf[0];
      const firstKey = Object.keys(data)[0];
      const v = (data as any)[firstKey];
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(detail ?? "Request failed.", res.status, detail);
  }
  return (await res.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(detail ?? "Request failed.", res.status, detail);
  }
  return (await res.json()) as T;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(detail ?? "Request failed.", res.status, detail);
  }
  return (await res.json()) as T;
}

let meCache: { value: unknown; expiresAt: number } | null = null;
let meInflight: Promise<unknown> | null = null;

/**
 * Shared, deduped `/api/auth/me` request for client components.
 * This avoids repeated calls when multiple panels mount at once.
 */
export async function getMeCached<T>(options?: { maxAgeMs?: number; force?: boolean }): Promise<T> {
  const maxAgeMs = options?.maxAgeMs ?? 60_000;
  const now = Date.now();

  if (!options?.force && meCache && meCache.expiresAt > now) {
    return meCache.value as T;
  }

  if (!options?.force && meInflight) {
    return (await meInflight) as T;
  }

  meInflight = getJson<T>("/api/auth/me");
  try {
    const value = await meInflight;
    meCache = { value, expiresAt: now + maxAgeMs };
    return value as T;
  } finally {
    meInflight = null;
  }
}

export function clearMeCache() {
  meCache = null;
}

