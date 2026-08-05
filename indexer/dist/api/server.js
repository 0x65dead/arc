import cors from 'cors';
import express from 'express';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { getSyncStreams, ping } from '../db/repositories.js';
import { createV1Router } from './routes.js';
import { errorHandler, notFoundHandler } from './errors.js';
const log = createLogger('api');
export function createApiServer() {
    const app = express();
    app.disable('x-powered-by');
    app.use(cors({
        origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
        methods: ['GET'],
    }));
    // Request logging at debug level only — an indexer's API is polled
    // continuously by every open browser tab, and logging each hit at info
    // buries anything worth reading.
    app.use((req, _res, next) => {
        log.debug('request', { method: req.method, path: req.path });
        next();
    });
    /**
     * Liveness + readiness.
     *
     * Returns 503 when the database is unreachable, so a load balancer or
     * container orchestrator can act on it. v1 had no health endpoint at all:
     * the only way to discover the database had gone away was for a user to hit
     * a 500 on the page they were looking at.
     */
    app.get('/health', async (_req, res) => {
        try {
            await ping();
        }
        catch (error) {
            log.error('health check failed', { error });
            res.status(503).json({ status: 'unhealthy', database: false });
            return;
        }
        const streams = await getSyncStreams().catch(() => []);
        res.json({
            status: 'ok',
            database: true,
            streams: streams.length,
            indexedBlock: streams.length ? Math.min(...streams.map((s) => s.lastBlock)) : 0,
        });
    });
    const v1 = createV1Router();
    app.use('/api/v1', v1);
    // The unversioned paths the previous frontend used, kept alive so an old
    // deployed bundle keeps working through a rollout. Same handlers — the
    // response shapes are the new ones, which is the point: the shapes v1
    // returned were the bug.
    app.use('/api', v1);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
