import 'dotenv/config';
import { ethers } from 'ethers';
import { runBackfill } from './backfill.js';
import { startListener } from './listener.js';
import { createApiServer } from './api.js';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'ALCHEMY_HTTP_URL',
  'ALCHEMY_WSS_URL',
  'CONTROLLER_ADDRESS',
  'REGISTRAR_ADDRESS',
  'MARKET_ADDRESS'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key} (see .env.example)`);
    process.exit(1);
  }
}

async function main() {
  const httpProvider = new ethers.JsonRpcProvider(process.env.ALCHEMY_HTTP_URL);

  console.log('[startup] running backfill to catch up on-chain history...');
  await runBackfill(httpProvider);

  console.log('[startup] starting live listener...');
  startListener(process.env.ALCHEMY_WSS_URL!);

  const port = Number(process.env.PORT ?? '8787');
  const app = createApiServer();
  // Explicit 0.0.0.0 rather than relying on the default, so this is reachable
  // from other devices on the same network (e.g. a phone's browser hitting a
  // LAN IP) and not silently restricted to localhost-only.
  app.listen(port, '0.0.0.0', () => {
    console.log(`[startup] API listening on 0.0.0.0:${port}`);
  });

  // Re-run backfill periodically as a safety net in case the live listener's
  // websocket silently drops without triggering the close handler, or the
  // process was down for a while before restarting.
  const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(() => {
    runBackfill(httpProvider).catch((err) => console.error('[reconcile] backfill pass failed', err));
  }, RECONCILE_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[startup] fatal error', err);
  process.exit(1);
});
