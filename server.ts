import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { spawn } from 'child_process';
import net from 'net';
import dotenv from 'dotenv';
import { createSignalEngineFromEnv } from './signalEngine';
import { Mt5Broker } from './mt5Broker';
import { loadDashboardState, saveDashboardState, saveMt5Account } from './dashboardState';
import { listAccountHistoryLogins } from './mt5HistoryStore';
import {
  getGeminiApiKey,
  normalizeAnnouncementText,
  synthesizeAnnouncement,
} from './geminiVoice';

dotenv.config();

function ensureTorRunning(): void {
  const proxy = (process.env.TELEGRAM_PROXY_URL ?? '').trim();
  if (!proxy.includes('127.0.0.1:9050')) return;
  const probe = net.connect(9050, '127.0.0.1');
  probe.once('connect', () => {
    probe.destroy();
    console.log('Tor SOCKS proxy already running on 127.0.0.1:9050.');
  });
  probe.once('error', () => {
    probe.destroy();
    const torExe = path.resolve('tor', 'tor', 'tor.exe');
    const torrc = path.resolve('tor', 'torrc');
    try {
      const child = spawn(torExe, ['-f', torrc], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      child.on('error', (error) => console.error(`Failed to start Tor: ${error.message}`));
      console.log('Starting Tor SOCKS proxy on 127.0.0.1:9050 (ready in 1-3 minutes)...');
    } catch (error) {
      console.error('Failed to start Tor:', error);
    }
  });
}

ensureTorRunning();

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
  const PORT = Number(process.env.PORT) || 5000;
  const mt5Broker = new Mt5Broker();
  const persisted = loadDashboardState();
  const mt5Credentials = new Map<
    number,
    { password: string; server: string; terminalPath: string }
  >();
  const signalEngine = createSignalEngineFromEnv(mt5Broker, persisted);

  const rememberMT5Credentials = (
    login: number,
    password: string,
    server: string,
    terminalPath: string
  ): void => {
    if (!Number.isInteger(login) || login <= 0 || !password) return;
    mt5Credentials.set(login, { password, server, terminalPath });
  };

  const applyDetectedSuffix = async (): Promise<string | null> => {
    const detected = await signalEngine.detectAndApplySymbolSuffix();
    if (detected !== null) {
      saveDashboardState({ mt5SymbolSuffix: detected });
      return detected;
    }
    const fallback = loadDashboardState().mt5SymbolSuffix ?? process.env.MT5_SYMBOL_SUFFIX ?? '';
    if (fallback) {
      mt5Broker.setSymbolSuffix(fallback);
      signalEngine.setSymbolSuffix(fallback);
    }
    return null;
  };

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

  app.get('/api/telegram/feed', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await signalEngine.telegramFeed());
    } catch {
      res.status(500).json({ error: 'Fetching the Telegram feed failed.' });
    }
  });

  app.post('/api/signals/scan', (_req, res) => {
    const triggered = signalEngine.triggerScan();
    res.status(triggered ? 202 : 409).json({
      ok: triggered,
      message: triggered ? 'Scan triggered.' : 'A scan is already running.',
    });
  });

  app.get('/api/pairs', async (_req, res) => {
    await signalEngine.ensurePairsLoaded();
    res.set('Cache-Control', 'no-store');
    res.json(signalEngine.getPairs());
  });

  app.post('/api/pairs/add', async (req, res) => {
    await signalEngine.ensurePairsLoaded();
    const body = req.body ?? {};
    let result = signalEngine.addPair(body.symbol);
    if (!result.ok) {
      await signalEngine.ensurePairsLoaded(true);
      result = signalEngine.addPair(body.symbol);
    }
    if (result.ok) {
      saveDashboardState({ activePairs: result.pairs.active });
      signalEngine.triggerScan();
    }
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/pairs/remove', async (req, res) => {
    await signalEngine.ensurePairsLoaded();
    const body = req.body ?? {};
    let result = signalEngine.removePair(body.symbol);
    if (!result.ok) {
      await signalEngine.ensurePairsLoaded(true);
      result = signalEngine.removePair(body.symbol);
    }
    if (result.ok) {
      saveDashboardState({ activePairs: result.pairs.active });
      signalEngine.triggerScan();
    }
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.get('/api/mt5/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(mt5Broker.getStatus());
  });

  app.get('/api/mt5/accounts', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const state = loadDashboardState();
    res.json({
      accounts: state.mt5Accounts ?? [],
      passwordKnown: [...mt5Credentials.keys()],
      historyAccounts: listAccountHistoryLogins(),
    });
  });

  app.post('/api/mt5/switch', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const login = Number(body.login);
      if (!Number.isInteger(login) || login <= 0) {
        res.status(400).json({ error: 'Enter a valid account number.' });
        return;
      }
      const state = loadDashboardState();
      const saved = (state.mt5Accounts ?? []).find((account) => account.login === login);
      const provided = String(body.password ?? '');
      const remembered = mt5Credentials.get(login);
      const password = provided || remembered?.password || '';
      if (!password) {
        res.status(400).json({ error: 'Enter the MT5 password to switch accounts.' });
        return;
      }
      const serverValue = String(body.server ?? '').trim() || remembered?.server || saved?.server || '';
      const terminalPath =
        String(body.terminalPath ?? '').trim() || remembered?.terminalPath || '';
      const result = await mt5Broker.connect({
        login,
        password,
        server: serverValue,
        terminalPath,
        symbolSuffix: '',
      });
      if (result.ok) {
        rememberMT5Credentials(
          login,
          password,
          String(result.status.config?.server ?? serverValue),
          terminalPath
        );
        if (result.status.account) {
          const account = result.status.account;
          saveMt5Account({
            login,
            server: String(account.server ?? serverValue),
            name: String(account.name ?? ''),
            company: String(account.company ?? ''),
            currency: String(account.currency ?? ''),
          });
        }
        signalEngine.resetJournal();
        await applyDetectedSuffix();
        await signalEngine.ensurePairsLoaded(true);
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch {
      res.status(500).json({ error: 'Switching MT5 accounts failed unexpectedly.' });
    }
  });

  app.post('/api/mt5/connect', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await mt5Broker.connect({ ...body, symbolSuffix: '' });
      if (result.ok) {
        const account = result.status.account;
        const login = Number(body.login);
        rememberMT5Credentials(
          login,
          String(body.password ?? ''),
          String(result.status.config?.server ?? ''),
          String(body.terminalPath ?? '')
        );
        if (account) {
          saveMt5Account({
            login: account.login,
            server: account.server,
            name: account.name,
            company: account.company,
            currency: account.currency,
          });
        }
        signalEngine.resetJournal();
        await applyDetectedSuffix();
        await signalEngine.ensurePairsLoaded(true);
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch {
      res.status(500).json({ error: 'MT5 connection failed unexpectedly.' });
    }
  });

  app.post('/api/mt5/disconnect', async (_req, res) => {
    try {
      const result = await mt5Broker.disconnect();
      res.json(result);
    } catch {
      res.status(500).json({ error: 'MT5 disconnect failed unexpectedly.' });
    }
  });

  app.post('/api/mt5/symbol-suffix', (req, res) => {
    try {
      const result = mt5Broker.setSymbolSuffix((req.body ?? {}).symbolSuffix);
      if (result.ok) {
        const suffix = String(result.status.config?.symbolSuffix ?? '').trim();
        saveDashboardState({ mt5SymbolSuffix: suffix });
        signalEngine.setSymbolSuffix(suffix);
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch {
      res.status(500).json({ error: 'Updating the symbol suffix failed unexpectedly.' });
    }
  });

  app.post('/api/risk', (req, res) => {
    try {
      const raw = Number((req.body ?? {}).riskPercent);
      if (!Number.isFinite(raw) || raw < 0.1 || raw > 100) {
        res.status(400).json({ error: 'Risk percentage must be between 0.1 and 100.' });
        return;
      }
      const riskPercent = signalEngine.setRiskPercent(raw);
      saveDashboardState({ riskPercent });
      res.json({ ok: true, riskPercent });
    } catch {
      res.status(500).json({ error: 'Updating the risk percentage failed unexpectedly.' });
    }
  });

  app.post('/api/voice/announce', async (req, res) => {
    const body = (req.body ?? {}) as { text?: unknown };
    const text = normalizeAnnouncementText(body.text);
    if (text.length < 3 || text.length > 300) {
      res.status(400).json({ error: 'Announcement text must be 3-300 characters.' });
      return;
    }
    if (!getGeminiApiKey()) {
      res.status(503).json({ error: 'Voice announcement is not configured.' });
      return;
    }
    try {
      const { buffer, cacheHit } = await synthesizeAnnouncement(text);
      res.set('Content-Type', 'audio/wav');
      res.set('Cache-Control', 'no-store');
      if (cacheHit) res.set('X-Voice-Cache', 'hit');
      res.send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.error(`Voice announcement failed: ${message}`);
      res.status(502).json({ error: 'Voice generation failed.' });
    }
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
    console.log('Attaching to the logged-in MT5 account...');
    void mt5Broker
      .autoConnect(process.env.MT5_TERMINAL_PATH ?? '', '')
      .then(async (result) => {
        if (result.ok) {
          console.log(`MT5 account #${result.status.account?.login ?? ''} connected.`);
          await applyDetectedSuffix();
          await signalEngine.ensurePairsLoaded(true);
        } else {
          console.error(`MT5 auto-connect failed: ${result.error ?? 'unknown error'}`);
        }
      });
    signalEngine.start();
  });
}

startServer();
