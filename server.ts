import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { createSignalEngineFromEnv } from './signalEngine';

dotenv.config();

const MUTATION_LIMIT = 30;
const MUTATION_WINDOW_MS = 60_000;
const mutationBuckets = new Map<string, { count: number; resetAt: number }>();

function blockUnsafeMutation(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      res.status(403).json({ error: 'Request blocked.' });
      return;
    }
    if (originHost !== req.get('host')) {
      res.status(403).json({ error: 'Request blocked.' });
      return;
    }
  }

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    res.status(403).json({ error: 'Request blocked.' });
    return;
  }

  const now = Date.now();
  const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const bucket = mutationBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    mutationBuckets.set(key, { count: 1, resetAt: now + MUTATION_WINDOW_MS });
    next();
    return;
  }
  if (bucket.count >= MUTATION_LIMIT) {
    res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    return;
  }
  bucket.count += 1;
  next();
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const signalEngine = createSignalEngineFromEnv();

  app.disable('x-powered-by');
  app.set('json escape', true);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path.startsWith('/api/')) {
      blockUnsafeMutation(req, res, next);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/signals', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(signalEngine.getResponse());
  });

  app.post('/api/signals/scan', (_req, res) => {
    const triggered = signalEngine.triggerScan();
    res.status(triggered ? 202 : 409).json({
      ok: triggered,
      message: triggered ? 'Scan triggered.' : 'A scan is already running.',
    });
  });

  app.post('/api/account/withdraw', (req, res) => {
    const result = signalEngine.withdraw((req.body ?? {}) as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  app.post('/api/account/add-balance', (req, res) => {
    const result = signalEngine.addBalance((req.body ?? {}) as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  app.post('/api/account/lot-size', (req, res) => {
    const result = signalEngine.updateLotSize((req.body ?? {}) as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    signalEngine.start();
  });
}

startServer();
