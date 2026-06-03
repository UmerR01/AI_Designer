/** Safe post-login return path (same-origin, relative only). */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.startsWith("/login")) return null;
  return raw;
}

export function loginUrlWithNext(returnPath: string): string {
  const next = safeReturnPath(returnPath);
  if (!next) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}
