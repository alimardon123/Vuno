// The app calls its own routes for fire-and-forget work. Those calls used a
// hardcoded http://localhost:3000, which broke the moment PORT became
// configurable — and would break behind any reverse proxy. Derive it instead.

export function originFrom(req: Request): string {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedHost) return `${forwardedProto ?? 'http'}://${forwardedHost}`;
  return new URL(req.url).origin;
}
