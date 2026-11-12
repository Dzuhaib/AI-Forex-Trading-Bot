/**
 * Telegram channel notifier for the signal engine.
 * - Posts every new signal, breakeven move, and final outcome to a Telegram channel.
 * - Uses the Bot API with HTML formatting via plain fetch (no extra dependencies).
 * - Sends are serialized through a queue and retried on failures or rate limits,
 *   so Telegram latency or downtime never blocks the signal engine loops.
 * - Keeps an in-memory feed of every posted message so the dashboard can
 *   mirror the channel in a Telegram-style preview page.
 */

import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Dispatcher } from 'undici';
import { socksDispatcher } from 'fetch-socks';
import fs from 'fs';
import path from 'path';
import type {
  SignalDirection,
  SignalStatus,
  TelegramFeedMessage,
  TelegramFeedResponse,
  TelegramSignalInfo,
} from './src/types';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const FEED_LIMIT = 200;

function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
}
const FEED_DIR = path.join(process.cwd(), 'data');
const FEED_FILE = path.join(FEED_DIR, 'telegram-feed.json');

let proxyDispatcher: Dispatcher | undefined;
let proxyDispatcherUrl: string | undefined;

function proxyUrl(): string | undefined {
  return (
    process.env.TELEGRAM_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

// Tor and most local bridge tools expose SOCKS4/5 proxies, while
// undici's ProxyAgent only speaks HTTP CONNECT — so a socks5:// URL
// must be routed through a SOCKS-aware dispatcher or every send fails.
function isSocksProxyUrl(url: URL): boolean {
  return /^socks4a?$|^socks5h?$/i.test(url.protocol.replace(':', ''));
}

function socksProxyOptions(url: URL): Parameters<typeof socksDispatcher>[0] {
  const isV4 = /^socks4a?$/i.test(url.protocol.replace(':', ''));
  return {
    type: isV4 ? 4 : 5,
    host: url.hostname,
    port: url.port ? Number(url.port) : 1080,
    userId: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

function dispatcher(): Dispatcher | undefined {
  const url = proxyUrl();
  if (!url) return undefined;
  if (proxyDispatcher && proxyDispatcherUrl === url) return proxyDispatcher;
  proxyDispatcher?.close().catch(() => {});
  proxyDispatcherUrl = url;
  const parsed = new URL(url);
  proxyDispatcher = isSocksProxyUrl(parsed)
    ? socksDispatcher(socksProxyOptions(parsed))
    : new ProxyAgent(url);
  return proxyDispatcher;
}

const RESOLUTION_HEADER: Record<SignalStatus, string> = {
  OPEN: '⏳ <b>PENDING</b>',
  TP_HIT: '✅ <b>TAKE PROFIT HIT</b>',
  SL_HIT: '❌ <b>STOP LOSS HIT</b>',
  BREAKEVEN_HIT: '⚖️ <b>BREAKEVEN HIT</b>',
  AMBIGUOUS: '⚠️ <b>CHOPPY EXIT</b>',
  EXPIRED: '⏰ <b>EXPIRED</b>',
};

const RESOLUTION_QUOTES: Partial<Record<SignalStatus, string>> = {
  TP_HIT: 'Another one secured! Stay disciplined, team. 🎯💰',
  SL_HIT: 'No emotions, no revenge trading. Next setup awaits! 🎯',
  BREAKEVEN_HIT: 'Capital protected! Stay patient, next opportunity awaits! 🎯',
};

const BREAKEVEN_QUOTE = 'Risk secured! Let the trade run. 🎯';

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return String(price);
  if (Math.abs(price) >= 1000) return price.toFixed(1);
  if (Math.abs(price) >= 100) return price.toFixed(2);
  if (Math.abs(price) >= 10) return price.toFixed(3);
  return price.toFixed(5);
}

function resultR(info: TelegramSignalInfo): number | null {
  const risk = info.initialRiskDistance;
  const price = info.resolutionPrice;
  if (!(risk > 0) || price === null || price === undefined) return null;
  const move = info.direction === 'LONG' ? price - info.entry : info.entry - price;
  return move / risk;
}

function formatNewSignal(info: TelegramSignalInfo): string {
  return [
    '🆕 <b>NEW SIGNAL</b>',
    '',
    `📊 <b>${escapeHtml(info.symbol)} | ${escapeHtml(info.timeframe)}</b>`,
    `${info.direction === 'LONG' ? '🟢' : '🔴'} <b>${info.direction === 'LONG' ? 'BUY' : 'SELL'}</b>`,
    '',
    `🎯 Entry: <code>${formatPrice(info.entry)}</code>`,
    `🛑 Stop Loss: <code>${formatPrice(info.stopLoss)}</code>`,
    `💰 Take Profit: <code>${formatPrice(info.takeProfit)}</code>`,
    `⚖️ Risk/Reward: <code>1:2</code>`,
    '',
    `📈 Zone: <code>${info.htfVolRatio.toFixed(1)}x</code>`,
    `📊 M1 Volume: <code>${info.m1VolRatio.toFixed(1)}x</code>`,
    '',
    '⏳ Trade Safe &amp; Manage Your Risk..',
  ].join('\n');
}

function formatBreakeven(info: TelegramSignalInfo): string {
  return [
    '🔒 <b>BREAKEVEN ACTIVATED</b>',
    '',
    `📊 Pair: <b>${escapeHtml(info.symbol)}</b>`,
    '🛡️ Stop Loss moved to 50% profit lock (1R).',
    `🛑 New Stop Loss: <code>${formatPrice(info.stopLoss)}</code>`,
    '',
    `<i>${escapeHtml(BREAKEVEN_QUOTE)}</i>`,
  ].join('\n');
}

function lockedProfitPct(info: TelegramSignalInfo): number | null {
  const tpDistance = Math.abs(info.takeProfit - info.entry);
  const locked = info.direction === 'LONG' ? info.stopLoss - info.entry : info.entry - info.stopLoss;
  if (!(tpDistance > 0) || !Number.isFinite(locked)) return null;
  const pct = (locked / tpDistance) * 100;
  return pct > 0.5 ? Math.round(pct) : null;
}

function formatResolution(info: TelegramSignalInfo): string {
  const r = info.resultR ?? resultR(info);
  const lines = [RESOLUTION_HEADER[info.status], '', `📊 Pair: <b>${escapeHtml(info.symbol)}</b>`];
  if (info.resolutionPrice !== null && info.resolutionPrice !== undefined) {
    lines.push(`🚪 Exit Price: <code>${formatPrice(info.resolutionPrice)}</code>`);
  }
  if (r !== null) {
    const icon = r < 0 ? '📉' : r > 0 ? '📈' : '📊';
    lines.push(`${icon} Result: <b>${r > 0 ? '+' : ''}${r.toFixed(2)}R</b>`);
  }
  const locked = lockedProfitPct(info);
  if (locked !== null) {
    lines.push(`🔒 Profit Locked: <b>${locked}% of TP</b>`);
  }
  if (info.holdMinutes !== null && info.holdMinutes !== undefined) {
    lines.push(`⏱ Duration: <code>${formatDuration(info.holdMinutes)}</code>`);
  }
  const quote = RESOLUTION_QUOTES[info.status];
  if (quote) lines.push('', `<i>${escapeHtml(quote)}</i>`);
  return lines.join('\n');
}

export class TelegramNotifier {
  private readonly token: string;
  private readonly chatId: string;
  private queue: Promise<void> = Promise.resolve();
  private feed: TelegramFeedMessage[] = [];
  private feedCounter = 0;
  private chatTitle: string | null = null;
  private chatTitleFetched = false;
  lastError: string | null = null;
  sentCount = 0;

  constructor(token: string, chatId: string) {
    this.token = token;
    this.chatId = chatId;
    this.hydrateFeed();
  }

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  newSignal(signal: TelegramSignalInfo): void {
    this.enqueue(formatNewSignal(signal), 'SIGNAL', signal);
  }

  breakeven(signal: TelegramSignalInfo): void {
    this.enqueue(formatBreakeven(signal), 'BREAKEVEN', signal);
  }

  resolution(signal: TelegramSignalInfo): void {
    const enriched: TelegramSignalInfo = {
      ...signal,
      resultR: signal.resultR ?? resultR(signal),
    };
    this.enqueue(formatResolution(enriched), 'RESULT', enriched);
  }

  getFeed(): TelegramFeedResponse {
    return {
      enabled: this.enabled,
      chatId: this.chatId,
      chatTitle: this.chatTitle,
      messages: [...this.feed],
    };
  }

  async ensureChatTitle(): Promise<void> {
    if (!this.enabled || this.chatTitleFetched) return;
    this.chatTitleFetched = true;
    try {
      const response = await undiciFetch(
        `${apiBase()}/bot${this.token}/getChat?chat_id=${encodeURIComponent(this.chatId)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), dispatcher: dispatcher() }
      );
      if (!response.ok) return;
      const body = (await response.json()) as {
        ok: boolean;
        result?: { title?: string; username?: string };
      };
      if (!body.ok) return;
      this.chatTitle =
        body.result?.title ?? body.result?.username ?? this.chatTitle;
      this.persistFeed();
    } catch {
      // Title stays null; the UI falls back to the chat id.
    }
  }

  private enqueue(
    text: string,
    kind: TelegramFeedMessage['kind'],
    signal: TelegramSignalInfo | null
  ): void {
    if (!this.enabled) return;
    this.queue = this.queue
      .then(() => this.deliver(text, kind, signal))
      .catch(() => {});
  }

  private async deliver(
    text: string,
    kind: TelegramFeedMessage['kind'],
    signal: TelegramSignalInfo | null
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.request('sendMessage', {
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        this.lastError = null;
        this.sentCount += 1;
        this.record(kind, text, 'SENT', signal);
        return;
      } catch (error) {
        if (error instanceof TelegramApiError && error.retryAfterMs > 0) {
          await sleep(error.retryAfterMs * 1000 + 250);
          continue;
        }
        if (attempt < MAX_ATTEMPTS) {
          await sleep(2_000 * attempt);
          continue;
        }
        this.lastError =
          error instanceof Error ? error.message : 'Telegram delivery failed.';
        this.record(kind, text, 'FAILED', signal);
      }
    }
  }

  private record(
    kind: TelegramFeedMessage['kind'],
    text: string,
    status: TelegramFeedMessage['status'],
    signal: TelegramSignalInfo | null
  ): void {
    this.feedCounter += 1;
    this.feed.push({
      id: `tg_${this.feedCounter}`,
      kind,
      status,
      postedAt: status === 'SENT' ? Date.now() : null,
      text,
      signal,
    });
    if (this.feed.length > FEED_LIMIT) {
      this.feed.splice(0, this.feed.length - FEED_LIMIT);
    }
    this.persistFeed();
  }

  private hydrateFeed(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8')) as {
        chatTitle?: unknown;
        messages?: unknown;
      };
      if (typeof raw?.chatTitle === 'string' && raw.chatTitle.trim()) {
        this.chatTitle = raw.chatTitle.trim();
        this.chatTitleFetched = true;
      }
      if (!Array.isArray(raw?.messages)) return;
      const validKinds = new Set(['SIGNAL', 'BREAKEVEN', 'RESULT']);
      const validStatuses = new Set(['SENT', 'FAILED']);
      let maxId = 0;
      for (const entry of raw.messages) {
        const item = entry as Partial<TelegramFeedMessage>;
        if (
          typeof item?.id !== 'string' ||
          !validKinds.has(String(item.kind)) ||
          !validStatuses.has(String(item.status)) ||
          typeof item.text !== 'string'
        ) {
          continue;
        }
        const numericId = Number(item.id.replace(/^tg_/, ''));
        if (Number.isFinite(numericId)) maxId = Math.max(maxId, numericId);
        this.feed.push({
          id: item.id,
          kind: item.kind as TelegramFeedMessage['kind'],
          status: item.status as TelegramFeedMessage['status'],
          postedAt:
            typeof item.postedAt === 'number' && Number.isFinite(item.postedAt)
              ? item.postedAt
              : null,
          text: item.text,
          signal: (item.signal ?? null) as TelegramSignalInfo | null,
        });
      }
      this.feedCounter = maxId;
      if (this.feed.length > FEED_LIMIT) {
        this.feed.splice(0, this.feed.length - FEED_LIMIT);
      }
    } catch {
      // No saved feed yet; start with an empty one.
    }
  }

  private persistFeed(): void {
    try {
      fs.mkdirSync(FEED_DIR, { recursive: true });
      const payload = {
        chatTitle: this.chatTitle,
        messages: this.feed.slice(-FEED_LIMIT),
      };
      fs.writeFileSync(FEED_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } catch {
      // Persistence is best-effort; the live feed keeps working without it.
    }
  }

  private async request(
    method: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const response = await undiciFetch(`${apiBase()}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      dispatcher: dispatcher(),
    });
    let body: {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    } = { ok: false };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = { ok: false, description: `HTTP ${response.status}.` };
    }
    if (response.status === 429) {
      const retryAfter = Math.max(1, body.parameters?.retry_after ?? 2);
      throw new TelegramApiError('Telegram rate limit reached.', retryAfter);
    }
    if (!response.ok || !body.ok) {
      throw new TelegramApiError(body.description ?? `HTTP ${response.status}.`);
    }
  }
}

export class TelegramApiError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = 0) {
    super(message);
    this.name = 'TelegramApiError';
    this.retryAfterMs = retryAfterMs;
  }
}
