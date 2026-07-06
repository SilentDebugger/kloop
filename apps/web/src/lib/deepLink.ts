/**
 * Handoff from web auth pages into the mobile app. Universal links aren't
 * feasible for generic self-hosted domains, so we use the app's custom scheme
 * and pass the server origin along for workspace bootstrap.
 */
export function isMobileUserAgent(): boolean {
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function appDeepLink(path: "auth/verify" | "auth/invite", token: string | null): string | null {
  if (!token) return null;
  const q = new URLSearchParams({ token, server: window.location.origin });
  return `kloop://${path}?${q.toString()}`;
}
