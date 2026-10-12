/**
 * `next start`, with the server's upload window raised first
 * (server-timeouts.cjs). Arguments are passed to Next as given:
 * `node scripts/start.cjs start -p 3000`.
 */
require('./server-timeouts.cjs');
require('next/dist/bin/next');
