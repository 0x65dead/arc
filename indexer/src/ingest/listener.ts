import { ethers } from 'ethers';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { provider } from '../chain/provider.js';
import { processLog, processLogs, toNormalized } from './processor.js';

const log = createLogger('listener');

/**
 * Live tail.
 *
 * The listener exists for latency only: it writes rows for blocks at the head
 * so a registration shows up in the API within seconds. It deliberately never
 * touches `sync_state` — head blocks can still be reorged out, and a
 * checkpoint that has advanced past a reorged range is one that will never be
 * re-read. Durability is the backfill's job, which only ever checkpoints
 * behind `confirmations`. Every write is idempotent and ordering-guarded, so
 * the two overlapping is harmless.
 *
 * v1 required a websocket URL and refused to start without one. Here it is
 * optional: with no `RPC_WS_URL` the listener polls instead, which is slower
 * to react but otherwise identical.
 */

const ADDRESSES = [config.contracts.controller, config.contracts.registrar, config.contracts.market];

export interface Listener {
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// WebSocket subscription
// ---------------------------------------------------------------------------

function startWebsocketListener(url: string): Listener {
  let stopped = false;
  let current: ethers.WebSocketProvider | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let attempt = 0;

  function connect(): void {
    if (stopped) return;

    const wsProvider = new ethers.WebSocketProvider(url);
    current = wsProvider;

    void wsProvider.on({ address: ADDRESSES }, (entry: ethers.Log) => {
      // Errors are swallowed per-log on purpose: the reconcile pass re-reads
      // this range from the checkpoint and will apply anything missed here.
      void processLog(toNormalized(entry)).catch((error) => {
        log.error('failed to apply live log', { tx: entry.transactionHash, error });
      });
    });

    const socket = (
      wsProvider as unknown as {
        websocket?: { on: (event: string, cb: (...args: unknown[]) => void) => void };
      }
    ).websocket;

    socket?.on('open', () => {
      attempt = 0;
      log.info('subscribed', { addresses: ADDRESSES.length });
    });

    socket?.on('error', (error: unknown) => {
      log.error('websocket error', { error });
    });

    socket?.on('close', () => {
      if (stopped) return;
      attempt += 1;
      const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
      log.warn('websocket closed, reconnecting', { attempt, delayMs });
      // Reconnects in place rather than exiting. The original called
      // process.exit(1) and assumed a supervisor would restart it — on any
      // plain `node dist/index.js` a dropped socket took the API down with it.
      reconnectTimer = setTimeout(connect, delayMs);
    });
  }

  connect();

  return {
    async stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      await current?.destroy();
    },
  };
}

// ---------------------------------------------------------------------------
// Polling fallback
// ---------------------------------------------------------------------------

function startPollingListener(): Listener {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let cursor: number | null = null;

  async function tick(): Promise<void> {
    const head = await provider.getBlockNumber();
    if (cursor === null) {
      cursor = head;
      return;
    }
    if (head <= cursor) return;

    const from = cursor + 1;
    const logs = await provider.getLogs({ address: ADDRESSES, fromBlock: from, toBlock: head });
    if (logs.length > 0) {
      await processLogs(logs.map(toNormalized));
    }
    cursor = head;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      tick()
        .catch((error) => log.error('poll failed', { error }))
        .finally(schedule);
    }, config.pollIntervalMs);
  }

  log.info('no websocket configured — polling instead', { intervalMs: config.pollIntervalMs });
  schedule();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function startListener(): Listener {
  return config.rpc.ws ? startWebsocketListener(config.rpc.ws) : startPollingListener();
}
