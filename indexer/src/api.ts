import cors from 'cors';
import express from 'express';
import { getActiveListings, getAvailability, getDomainsByOwner, getStats, getSyncStatus } from './db.js';

export function createApiServer() {
  const app = express();
  app.use(cors());

  app.get('/api/stats', async (_req, res) => {
    try {
      const stats = await getStats();
      res.json(stats);
    } catch (err) {
      console.error('[api] /api/stats failed', err);
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  app.get('/api/domains', async (req, res) => {
    const owner = req.query.owner;
    if (typeof owner !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
      res.status(400).json({ error: 'owner query param must be a valid address' });
      return;
    }
    try {
      const domains = await getDomainsByOwner(owner);
      res.json({ domains });
    } catch (err) {
      console.error('[api] /api/domains failed', err);
      res.status(500).json({ error: 'Failed to load domains' });
    }
  });

  app.get('/api/availability', async (req, res) => {
    const name = req.query.name;
    if (typeof name !== 'string' || !/^[a-z0-9-]{1,63}$/.test(name)) {
      res.status(400).json({ error: 'name query param must be a valid label' });
      return;
    }
    try {
      const result = await getAvailability(name);
      res.json(result);
    } catch (err) {
      console.error('[api] /api/availability failed', err);
      res.status(500).json({ error: 'Failed to check availability' });
    }
  });

  app.get('/api/marketplace', async (_req, res) => {
    try {
      const listings = await getActiveListings();
      res.json({ listings });
    } catch (err) {
      console.error('[api] /api/marketplace failed', err);
      res.status(500).json({ error: 'Failed to load marketplace listings' });
    }
  });

  // Lets the frontend show "data as of block N" / flag staleness instead of
  // silently trusting numbers that might be hours out of date if the
  // listener process is down.
  app.get('/api/sync-status', async (_req, res) => {
    try {
      const streams = await getSyncStatus();
      res.json({ streams });
    } catch (err) {
      console.error('[api] /api/sync-status failed', err);
      res.status(500).json({ error: 'Failed to load sync status' });
    }
  });

  return app;
}
