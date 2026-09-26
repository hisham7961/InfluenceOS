/**
 * Headers the web tier relays to the API so the API sees the real visitor:
 * the address the reverse proxy recorded (rate limits, session list, audit
 * log) and the request id (one id across proxy, web and API logs). The API
 * only trusts these from a private-network hop.
 */
export function forwardedHeaders(incoming: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['x-forwarded-for', 'x-real-ip', 'x-request-id', 'user-agent']) {
    const value = incoming.get(name);
    if (value) out[name] = value;
  }
  return out;
}

/**
 * A refresh answered 400/401/403 means the refresh token is no good: the
 * session is over. Anything else (API restarting mid-deploy, 5xx, rate
 * limited, network error) is temporary, and the session must survive it.
 */
export function refreshWasRejected(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}
