import type { FastifyInstance } from 'fastify';

/**
 * HTTP caching for mobile & web clients (addendum §caching):
 *  - ETag + conditional requests (304) are provided by @fastify/etag.
 *  - This adds sensible default Cache-Control so intermediaries and clients
 *    can revalidate cheaply without ever caching authenticated payloads on
 *    shared caches.
 *
 * Reads (GET) get `private, no-cache` — the response body may be cached by the
 * client but MUST be revalidated (the ETag makes that a cheap 304). Mutations
 * and auth endpoints get `no-store`. Any route may override by setting its own
 * Cache-Control before send.
 */
export function installCaching(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    // Never touch caching semantics for streamed binaries or already-set values.
    if (reply.getHeader('cache-control')) return payload;

    const isRead = request.method === 'GET' || request.method === 'HEAD';
    const isAuth = request.url.includes('/auth/');

    if (isRead && !isAuth) {
      reply.header('Cache-Control', 'private, no-cache');
      reply.header('Vary', 'Authorization, Cookie');
    } else {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });
}
