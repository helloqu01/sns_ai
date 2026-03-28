const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"]);

export const isLoopbackHostname = (hostname: string) => LOOPBACK_HOSTNAMES.has(hostname);

export const isDevAuthBypassConfigured = () =>
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS !== "false";

export const isDevAuthBypassActive = (hostname: string) =>
  isDevAuthBypassConfigured() && isLoopbackHostname(hostname);
