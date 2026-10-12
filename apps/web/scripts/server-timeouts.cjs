/**
 * Loaded before `next start` (see the "start" script), so it applies to the
 * server Next creates.
 *
 * Uploads pass through this server on their way to the API (the BFF), and
 * Node gives a request 5 minutes to arrive in full by default — a large
 * video on a slow connection was cut off and answered 408. Allow as long as
 * an upload link is valid (15 minutes, signUploadTicket) and a minute more.
 * Slow-request protection otherwise stays as it is: the headers must still
 * arrive within Node's 60 seconds.
 */
const http = require('node:http');

const UPLOAD_WINDOW_MS = 16 * 60 * 1000;

const createServer = http.createServer;
http.createServer = function createServerWithUploadWindow(...args) {
  const server = createServer.apply(this, args);
  server.requestTimeout = UPLOAD_WINDOW_MS;
  return server;
};
