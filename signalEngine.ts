/**
 * Server-side live signal engine for the Untested H1/M30 High-Volume Body + M1 Reversal strategy.
 * - Scans OANDA FX/CFD instruments (FX majors + crosses, gold, WTI, BTC).
 * - Risks 3% of the current account balance per trade with a 2:1 reward-to-risk target.
 * - Watches every open signal against live M1 and S5 candles.
 * - Simulates a configurable account with a global lot size per signal.
 * - Persists signals, trades and outcomes so restarts keep history.
 */

import fs from 'fs';
import path from 'path';
import type {
  AccountSummary,
  DummyTrade,
  LiveSignal,
  MarketTicker,
  NearZone,
  SignalDirection,
  SignalEngineStatus,
  SignalsResponse,
  SignalStatus,
  Withdrawal,
  WithdrawalMethod,
} from './src/types';

type Timeframe = 'H1' | 'M30';
type ZoneType = 'DEMAND' | 'SUPPLY';
type Interval = 'M1' | 'M30' | 'H1' | 'S5';

interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

interface Zone {
  timeframe: Timeframe;
  type: ZoneType;
  bodyTop: number;
  bodyBottom: number;
  volRatio: number;
  distancePct: number;
  openTime: number;
}

interface TrackedSignal extends LiveSignal {
  triggerCandleOpen: number;
  signalMinuteEnd: number;
  nextCandleOpen: number;
  intraDone: boolean;
}

interface ScanResult {
  ok: boolean;
  near: NearZone | null;
  signal: NewSignal | null;
}

interface NewSignal {
  id: string;
  symbol: string;
  direction: SignalDirection;
  timestampMs: number;
  timeframe: Timeframe;
  bodyTop: number;
  bodyBottom: number;
  htfVolRatio: number;
  m1VolRatio: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPct: number;
  rewardPct: number;
  roePct: number;
  leverage: number;
  triggerCandleOpen: number;
  reason: string;
}

interface EngineOptions {
  enabled: boolean;
  scanIntervalMs: number;
  watchIntervalMs: number;
  maxTrackHours: number;
  stateFile: string;
  scanConcurrency: number;
  watchConcurrency: number;
  priceIntervalMs: number;
  maxOpenPerSymbol: number;
  reentryCooldownMs: number;
  leverage: number;
  pairsOverride: string[];
  oandaHost: string;
  oandaApiKey: string;
}

const SYMBOL_INSTRUMENTS: Record<string, string> = {
  XAUUSD: 'XAU_USD',
  EURUSD: 'EUR_USD',
  GBPUSD: 'GBP_USD',
  AUDUSD: 'AUD_USD',
  NZDUSD: 'NZD_USD',
  USDJPY: 'USD_JPY',
  EURJPY: 'EUR_JPY',
  GBPJPY: 'GBP_JPY',
  USDCHF: 'USD_CHF',
  GBPCHF: 'GBP_CHF',
  AUDCHF: 'AUD_CHF',
  AUDCAD: 'AUD_CAD',
  BTCUSD: 'BTC_USD',
  XTIUSD: 'WTICO_USD',
};

const OANDA_DEFAULT_SYMBOLS = Object.keys(SYMBOL_INSTRUMENTS);

const GRANULARITY_MS: Record<Interval, number> = {
  M1: 60_000,
  M30: 1_800_000,
  H1: 3_600_000,
  S5: 5_000,
};

function toInstrument(symbol: string): string | null {
  const key = symbol.replace(/[_\s-]/g, '').toUpperCase();
  return SYMBOL_INSTRUMENTS[key] ?? null;
}

const HTF_VOL_LOOKBACK = 10;
const HTF_VOL_MULTIPLIER = 1.5;
const M1_VOL_LOOKBACK = 10;
const M1_VOL_MULTIPLIER = 1.2;
const TOUCH_TOLERANCE_PCT = 0.08;
const HTF_CACHE_MS = 90_000;
const MAX_RESOLVED_HISTORY = 400;
const STARTING_BALANCE = 100;
const DUMMY_LOT_SIZE = 0.02;
const MIN_LOT_SIZE = 0.01;
const MAX_LOT_SIZE = 100;
const RISK_PERCENT = 3;
const REWARD_RISK_RATIO = 2;
const MAX_TRADE_HISTORY = 500;
const ACCOUNT_CURRENCY = 'USD';

const CONTRACT_UNITS: Record<string, number> = {
  XAUUSD: 100,
  EURUSD: 100_000,
  GBPUSD: 100_000,
  AUDUSD: 100_000,
  NZDUSD: 100_000,
  USDJPY: 100_000,
  EURJPY: 100_000,
  GBPJPY: 100_000,
  USDCHF: 100_000,
  GBPCHF: 100_000,
  AUDCHF: 100_000,
  AUDCAD: 100_000,
  BTCUSD: 1,
  XTIUSD: 1_000,
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface QuoteRates {
  USDJPY: number;
  USDCHF: number;
  USDCAD: number;
}

const FALLBACK_QUOTE_RATES: QuoteRates = {
  USDJPY: 150,
  USDCHF: 0.88,
  USDCAD: 1.36,
};

function quoteRate(symbol: string, rates: QuoteRates): number {
  if (symbol.endsWith('JPY')) return rates.USDJPY;
  if (symbol.endsWith('CHF')) return rates.USDCHF;
  if (symbol.endsWith('CAD')) return rates.USDCAD;
  return 1;
}

function tradePnl(
  symbol: string,
  direction: SignalDirection,
  lotSize: number,
  entryPrice: number,
  exitPrice: number,
  rates: QuoteRates
): number {
  const units = (CONTRACT_UNITS[symbol] ?? 1) * lotSize;
  const diff = direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
  const rate = quoteRate(symbol, rates);
  return roundMoney(rate > 0 ? (diff * units) / rate : diff * units);
}

function normalizeMobileAccount(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(2);
  if (digits.startsWith('92') && digits.length === 12) digits = `0${digits.slice(2)}`;
  return digits;
}

function withdrawalReference(method: WithdrawalMethod): string {
  const prefix = method === 'JAZZCASH' ? 'JC' : 'EP';
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

interface EngineStats {
  total: number;
  tp: number;
  sl: number;
  ambiguous: number;
  expired: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOandaJson(url: string, apiKey: string, timeoutMs = 7000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'oanda-live-signal-engine/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchKlines(
  host: string,
  apiKey: string,
  symbol: string,
  interval: Interval,
  count: number
): Promise<Kline[] | null> {
  const instrument = toInstrument(symbol);
  if (!instrument) return null;
  const limit = Math.max(1, Math.min(Math.ceil(count), 5000));
  const params = new URLSearchParams({
    granularity: interval,
    count: String(limit),
    price: 'M',
  });
  const raw = (await fetchOandaJson(
    `${host}/v3/instruments/${instrument}/candles?${params.toString()}`,
    apiKey,
    6000
  )) as { candles?: unknown[] };

  if (!Array.isArray(raw?.candles)) return null;
  const step = GRANULARITY_MS[interval];
  const candles: Kline[] = [];
  for (const item of raw.candles) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const openTime = Date.parse(String(row.time ?? ''));
    if (!Number.isFinite(openTime)) continue;
    const mid = row.mid as Record<string, unknown> | undefined;
    if (!mid) continue;
    const open = Number(mid.o);
    const high = Number(mid.h);
    const low = Number(mid.l);
    const close = Number(mid.c);
    if (![open, high, low, close].every((value) => Number.isFinite(value))) continue;
    candles.push({
      openTime,
      open,
      high,
      low,
      close,
      volume: Number(row.volume ?? 0),
      closeTime: openTime + step,
    });
  }
  return candles;
}

async function fetchKlinesWindow(
  host: string,
  apiKey: string,
  symbol: string,
  startMs: number,
  endMs: number
): Promise<Kline[]> {
  if (endMs <= startMs) return [];
  const count = Math.ceil((Date.now() - startMs) / 60_000) + 3;
  const batch = await fetchKlines(host, apiKey, symbol, 'M1', count);
  if (!batch) return [];
  return batch.filter((candle) => candle.openTime >= startMs && candle.openTime <= endMs);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function averageVolume(candles: Kline[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to; i += 1) {
    if (i >= 0 && i < candles.length) {
      sum += candles[i].volume;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function findUntestedHtfBodyZones(candles: Kline[], timeframe: Timeframe, currentPrice: number): Zone[] {
  const zones: Zone[] = [];
  const n = candles.length;
  if (n <= HTF_VOL_LOOKBACK + 2) return zones;

  for (let i = HTF_VOL_LOOKBACK; i < n - 1; i += 1) {
    const candle = candles[i];
    const avgVol = averageVolume(candles, i - HTF_VOL_LOOKBACK, i);
    if (avgVol <= 0) continue;
    const volRatio = candle.volume / avgVol;
    if (volRatio < HTF_VOL_MULTIPLIER) continue;

    const bodyTop = Math.max(candle.open, candle.close);
    const bodyBottom = Math.min(candle.open, candle.close);
    if (bodyTop <= bodyBottom) continue;

    let leftAbove = false;
    let testedFromAbove = false;
    let leftBelow = false;
    let testedFromBelow = false;

    for (let k = i + 1; k < n - 1; k += 1) {
      const sub = candles[k];
      if (!leftAbove) {
        if (sub.low > bodyTop) leftAbove = true;
      } else if (sub.low <= bodyTop) {
        testedFromAbove = true;
      }
      if (!leftBelow) {
        if (sub.high < bodyBottom) leftBelow = true;
      } else if (sub.high >= bodyBottom) {
        testedFromBelow = true;
      }
    }

    if (i === n - 2) {
      if (currentPrice > bodyTop) leftAbove = true;
      if (currentPrice < bodyBottom) leftBelow = true;
    }

    if (leftAbove && !testedFromAbove && currentPrice >= bodyBottom * 0.997) {
      const distancePct =
        currentPrice >= bodyTop ? ((currentPrice - bodyTop) / currentPrice) * 100 : 0;
      zones.push({
        timeframe,
        type: 'DEMAND',
        bodyTop,
        bodyBottom,
        volRatio,
        distancePct,
        openTime: candle.openTime,
      });
    } else if (leftBelow && !testedFromBelow && currentPrice <= bodyTop * 1.003) {
      const distancePct =
        currentPrice <= bodyBottom ? ((bodyBottom - currentPrice) / currentPrice) * 100 : 0;
      zones.push({
        timeframe,
        type: 'SUPPLY',
        bodyTop,
        bodyBottom,
        volRatio,
        distancePct,
        openTime: candle.openTime,
      });
    }
  }

  return zones;
}

function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

function verdictFor(status: SignalStatus): string {
  switch (status) {
    case 'TP_HIT':
      return 'FOLLOWED SIGNAL (TP HIT)';
    case 'SL_HIT':
      return 'WENT AGAINST SIGNAL (SL HIT)';
    case 'AMBIGUOUS':
      return 'CHOPPY (TP + SL SAME CANDLE)';
    case 'EXPIRED':
      return 'NO FOLLOW-THROUGH (EXPIRED)';
    default:
      return 'PENDING';
  }
}



export class SignalEngine {
  private readonly opts: EngineOptions;
  private signals = new Map<string, TrackedSignal>();
  private lastTriggerBySymbol = new Map<string, number>();
  private stats: EngineStats = { total: 0, tp: 0, sl: 0, ambiguous: 0, expired: 0 };
  private startingBalance = STARTING_BALANCE;
  private balance = STARTING_BALANCE;
  private lotSize = DUMMY_LOT_SIZE;
  private trades = new Map<string, DummyTrade>();
  private withdrawals: Withdrawal[] = [];
  private symbols: string[] = [];
  private symbolSource = 'default-static';
  private lastSymbolRefreshAt = 0;
  private nearZones: NearZone[] = [];
  private startedAt = 0;
  private lastScanAt: number | null = null;
  private lastWatchAt: number | null = null;
  private lastScanDurationMs = 0;
  private scannedPairs = 0;
  private scanning = false;
  private watching = false;
  private lastError: string | null = null;
  private marketPrices = new Map<string, number>();
  private marketMeta = new Map<string, { changePct: number; quoteVolume: number }>();
  private htfCache = new Map<string, { h1: Kline[]; m30: Kline[]; at: number }>();
  private lastPriceAt: number | null = null;
  private priceSource: 'rest' | null = null;
  private priceLoopActive = false;
  private running = false;
  private targetsSynced = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private scanLoopActive = false;
  private watchLoopActive = false;

  constructor(options: EngineOptions) {
    this.opts = options;
  }

  start(): void {
    if (this.running || !this.opts.enabled) return;
    this.running = true;
    this.startedAt = Date.now();
    this.loadState();
    void this.runScanLoop();
    void this.runWatchLoop();
    void this.runPriceLoop();
  }

  stop(): void {
    this.running = false;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveState();
  }

  triggerScan(): boolean {
    if (this.scanning || !this.opts.enabled) return false;
    void this.scanOnce();
    return true;
  }

  withdraw(input: {
    method?: unknown;
    accountNumber?: unknown;
    accountTitle?: unknown;
    amount?: unknown;
  }):
    | { ok: true; withdrawal: Withdrawal; balance: number }
    | { ok: false; error: string } {
    const method = String(input.method ?? '').trim().toUpperCase();
    if (method !== 'JAZZCASH' && method !== 'EASYPAISA') {
      return { ok: false, error: 'Choose JazzCash or Easypaisa as the payout method.' };
    }

    const accountTitle = String(input.accountTitle ?? '').trim().replace(/\s+/g, ' ');
    if (accountTitle.length < 3 || accountTitle.length > 60) {
      return { ok: false, error: 'Enter the account holder name (3-60 characters).' };
    }

    const accountNumber = normalizeMobileAccount(String(input.accountNumber ?? ''));
    if (!/^03\d{9}$/.test(accountNumber)) {
      return {
        ok: false,
        error: 'Enter a valid 11-digit mobile account number, e.g. 03001234567.',
      };
    }

    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Enter a withdrawal amount greater than zero.' };
    }
    if (amount > this.balance) {
      return {
        ok: false,
        error: `Amount exceeds the available balance of $${this.balance.toFixed(2)}.`,
      };
    }

    this.balance = roundMoney(this.balance - amount);
    const requestedAt = Date.now();
    const withdrawal: Withdrawal = {
      id: `wd_${requestedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      method: method as WithdrawalMethod,
      accountNumber,
      accountTitle,
      amount,
      status: 'PAID',
      reference: withdrawalReference(method as WithdrawalMethod),
      requestedAt,
      requestedAtUtc: isoUtc(requestedAt),
      balanceAfter: this.balance,
    };
    this.withdrawals.unshift(withdrawal);
    if (this.withdrawals.length > MAX_TRADE_HISTORY) {
      this.withdrawals.length = MAX_TRADE_HISTORY;
    }
    this.saveState();
    return { ok: true, withdrawal, balance: this.balance };
  }

  addBalance(input: { amount?: unknown }):
    | { ok: true; balance: number; startingBalance: number }
    | { ok: false; error: string } {
    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Enter an amount greater than zero.' };
    }
    if (amount > 1_000_000) {
      return { ok: false, error: 'The maximum single deposit is $1,000,000.' };
    }
    this.startingBalance = roundMoney(this.startingBalance + amount);
    this.balance = roundMoney(this.balance + amount);
    this.saveState();
    return { ok: true, balance: this.balance, startingBalance: this.startingBalance };
  }

  updateLotSize(input: { lotSize?: unknown }):
    | { ok: true; lotSize: number; updatedTrades: number }
    | { ok: false; error: string } {
    const raw = Number(input.lotSize);
    if (!Number.isFinite(raw) || raw < MIN_LOT_SIZE || raw > MAX_LOT_SIZE) {
      return {
        ok: false,
        error: `Choose a lot size between ${MIN_LOT_SIZE.toFixed(2)} and ${MAX_LOT_SIZE.toFixed(2)}.`,
      };
    }
    const next = Math.round(raw * 100) / 100;
    this.lotSize = next;
    let updatedTrades = 0;

    for (const trade of this.trades.values()) {
      if (trade.status !== 'OPEN') continue;
      const targets = this.riskTargets(trade.symbol);
      if (!targets) continue;
      trade.lotSize = next;
      trade.stopLoss =
        trade.direction === 'LONG'
          ? trade.entryPrice - targets.slDistance
          : trade.entryPrice + targets.slDistance;
      trade.takeProfit =
        trade.direction === 'LONG'
          ? trade.entryPrice + targets.tpDistance
          : trade.entryPrice - targets.tpDistance;
      updatedTrades += 1;
    }

    for (const signal of this.signals.values()) {
      if (signal.status !== 'OPEN') continue;
      const targets = this.riskTargets(signal.symbol);
      if (!targets) continue;
      signal.stopLoss =
        signal.direction === 'LONG'
          ? signal.entry - targets.slDistance
          : signal.entry + targets.slDistance;
      signal.takeProfit =
        signal.direction === 'LONG'
          ? signal.entry + targets.tpDistance
          : signal.entry - targets.tpDistance;
      signal.riskPct = Number(((targets.slDistance / signal.entry) * 100).toFixed(3));
      signal.rewardPct = Number(((targets.tpDistance / signal.entry) * 100).toFixed(3));
      signal.roePct = Number((signal.rewardPct * signal.leverage).toFixed(2));
    }

    this.saveState();
    return { ok: true, lotSize: this.lotSize, updatedTrades };
  }

  private quoteRates(): QuoteRates {
    const usdjpy = this.marketPrices.get('USDJPY');
    const usdchf = this.marketPrices.get('USDCHF');
    const audusd = this.marketPrices.get('AUDUSD');
    const audcad = this.marketPrices.get('AUDCAD');
    const derivedCad =
      audusd && audcad && audusd > 0 && audcad > 0 ? audcad / audusd : null;
    return {
      USDJPY: usdjpy && usdjpy > 0 ? usdjpy : FALLBACK_QUOTE_RATES.USDJPY,
      USDCHF: usdchf && usdchf > 0 ? usdchf : FALLBACK_QUOTE_RATES.USDCHF,
      USDCAD: derivedCad ?? FALLBACK_QUOTE_RATES.USDCAD,
    };
  }

  private priceDistanceForUsd(symbol: string, usd: number): number {
    const units = (CONTRACT_UNITS[symbol] ?? 1) * this.lotSize;
    if (units <= 0) return 0;
    return (usd * quoteRate(symbol, this.quoteRates())) / units;
  }

  private riskTargets(symbol: string):
    | { riskUsd: number; rewardUsd: number; slDistance: number; tpDistance: number }
    | null {
    const riskUsd = roundMoney(this.balance * (RISK_PERCENT / 100));
    if (!(riskUsd > 0)) return null;
    const rewardUsd = roundMoney(riskUsd * REWARD_RISK_RATIO);
    const slDistance = this.priceDistanceForUsd(symbol, riskUsd);
    const tpDistance = this.priceDistanceForUsd(symbol, rewardUsd);
    if (!(slDistance > 0) || !(tpDistance > 0)) return null;
    return { riskUsd, rewardUsd, slDistance, tpDistance };
  }

  getResponse(): SignalsResponse {
    const now = Date.now();
    const all = [...this.signals.values()];
    const tp = this.stats.tp;
    const sl = this.stats.sl;
    const ambiguous = this.stats.ambiguous;
    const expired = this.stats.expired;
    const open = all.filter((s) => s.status === 'OPEN').length;
    const decided = tp + sl;

    const status: SignalEngineStatus = {
      running: this.running,
      startedAt: this.startedAt,
      lastScanAt: this.lastScanAt,
      lastWatchAt: this.lastWatchAt,
      lastScanDurationMs: this.lastScanDurationMs,
      scanning: this.scanning,
      watching: this.watching,
      scannedPairs: this.scannedPairs,
      totalPairs: this.symbols.length,
      scanIntervalMs: this.opts.scanIntervalMs,
      watchIntervalMs: this.opts.watchIntervalMs,
      priceIntervalMs: this.opts.priceIntervalMs,
      lastPriceAt: this.lastPriceAt,
      priceSource: this.priceSource,
      openSignals: open,
      totalSignals: this.stats.total,
      tp,
      sl,
      ambiguous,
      expired,
      winRatePct: decided > 0 ? Number(((tp / decided) * 100).toFixed(2)) : 0,
      symbolSource: this.symbolSource,
      lastError: this.lastError,
    };

    const publicSignals = all
      .map((signal) => this.toPublicSignal(signal, now))
      .sort((a, b) => {
        if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
        if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
        if (a.status === 'OPEN' && b.status === 'OPEN') return b.signalTime - a.signalTime;
        return (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0);
      });

    const market: MarketTicker[] = [];
    const marketSymbols = this.symbols.length > 0 ? this.symbols : OANDA_DEFAULT_SYMBOLS;
    for (const symbol of marketSymbols) {
      const price = this.marketPrices.get(symbol);
      if (price === undefined) continue;
      const meta = this.marketMeta.get(symbol);
      market.push({
        symbol,
        price,
        changePct24h: meta ? meta.changePct : null,
        quoteVolume24h: meta ? meta.quoteVolume : null,
        updatedAt: this.lastPriceAt ?? now,
      });
    }

    const rates = this.quoteRates();
    const trades: DummyTrade[] = [...this.trades.values()]
      .map((trade) => {
        if (trade.status === 'CLOSED') return { ...trade, unrealizedPnl: 0 };
        const live = this.marketPrices.get(trade.symbol) ?? trade.entryPrice;
        return {
          ...trade,
          unrealizedPnl: tradePnl(
            trade.symbol,
            trade.direction,
            trade.lotSize,
            trade.entryPrice,
            live,
            rates
          ),
        };
      })
      .sort((a, b) => {
        if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
        if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
        return (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt);
      });

    const unrealizedPnl = roundMoney(
      trades.reduce((sum, trade) => (trade.status === 'OPEN' ? sum + trade.unrealizedPnl : sum), 0)
    );
    const withdrawnTotal = roundMoney(
      this.withdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0)
    );
    const account: AccountSummary = {
      startingBalance: this.startingBalance,
      balance: this.balance,
      equity: roundMoney(this.balance + unrealizedPnl),
      unrealizedPnl,
      realizedPnl: roundMoney(this.balance - this.startingBalance + withdrawnTotal),
      withdrawnTotal,
      openTrades: trades.filter((trade) => trade.status === 'OPEN').length,
    closedTrades: trades.filter((trade) => trade.status === 'CLOSED').length,
    lotSize: this.lotSize,
      currency: ACCOUNT_CURRENCY,
    };

    return {
      generatedAt: now,
      status,
      signals: publicSignals,
      nearZones: this.nearZones,
      market,
      account,
      trades,
      withdrawals: [...this.withdrawals].sort((a, b) => b.requestedAt - a.requestedAt),
    };
  }

  private async runScanLoop(): Promise<void> {
    if (this.scanLoopActive) return;
    this.scanLoopActive = true;
    while (this.running) {
      await this.scanOnce();
      await sleep(this.opts.scanIntervalMs);
    }
    this.scanLoopActive = false;
  }

  private async runWatchLoop(): Promise<void> {
    if (this.watchLoopActive) return;
    this.watchLoopActive = true;
    while (this.running) {
      await this.watchOnce();
      await sleep(this.opts.watchIntervalMs);
    }
    this.watchLoopActive = false;
  }

  private async runPriceLoop(): Promise<void> {
    if (this.priceLoopActive) return;
    this.priceLoopActive = true;
    while (this.running) {
      await this.refreshMarketPrices();
      await sleep(this.opts.priceIntervalMs);
    }
    this.priceLoopActive = false;
  }

  private async refreshMarketPrices(): Promise<void> {
    const symbols = this.symbols.length > 0 ? this.symbols : OANDA_DEFAULT_SYMBOLS;
    const now = Date.now();
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const candles = await fetchKlines(
            this.opts.oandaHost,
            this.opts.oandaApiKey,
            symbol,
            'S5',
            1
          );
          const last = candles?.[candles.length - 1];
          return last && Number.isFinite(last.close) && last.close > 0
            ? { symbol, price: last.close }
            : null;
        } catch {
          return null;
        }
      })
    );

    let updated = 0;
    for (const result of results) {
      if (!result) continue;
      this.marketPrices.set(result.symbol, result.price);
      updated += 1;
    }
    if (updated === 0) return;

    this.lastPriceAt = now;
    this.priceSource = 'rest';
    for (const signal of this.signals.values()) {
      if (signal.status !== 'OPEN') continue;
      const price = this.marketPrices.get(signal.symbol);
      if (price === undefined) continue;
      signal.livePrice = price;
      signal.liveUpdatedAt = now;
    }
    if (!this.targetsSynced) {
      this.targetsSynced = true;
      this.applyRiskTargets();
    }
  }

  private applyRiskTargets(): void {
    for (const signal of this.signals.values()) {
      if (signal.status !== 'OPEN') continue;
      if (!SYMBOL_INSTRUMENTS[signal.symbol]) continue;
      const targets = this.riskTargets(signal.symbol);
      if (!targets) continue;
      signal.stopLoss =
        signal.direction === 'LONG'
          ? signal.entry - targets.slDistance
          : signal.entry + targets.slDistance;
      signal.takeProfit =
        signal.direction === 'LONG'
          ? signal.entry + targets.tpDistance
          : signal.entry - targets.tpDistance;
      signal.riskPct = Number(((targets.slDistance / signal.entry) * 100).toFixed(3));
      signal.rewardPct = Number(((targets.tpDistance / signal.entry) * 100).toFixed(3));
      signal.roePct = Number((signal.rewardPct * signal.leverage).toFixed(2));
      const trade = this.trades.get(signal.id);
      if (trade && trade.status === 'OPEN') {
        trade.lotSize = this.lotSize;
        trade.stopLoss = signal.stopLoss;
        trade.takeProfit = signal.takeProfit;
      }
    }
    this.scheduleSave();
  }

  private async refreshSymbols(): Promise<void> {
    const wanted = new Set(
      this.opts.pairsOverride.map((symbol) => toInstrument(symbol)).filter(Boolean)
    );
    const override = OANDA_DEFAULT_SYMBOLS.filter((symbol) => wanted.has(toInstrument(symbol)));
    this.symbols = override.length > 0 ? override : OANDA_DEFAULT_SYMBOLS;
    this.symbolSource = 'OANDA';
    this.lastSymbolRefreshAt = Date.now();
  }

  private async scanOnce(): Promise<void> {
    if (this.scanning || !this.running) return;
    this.scanning = true;
    const started = Date.now();
    try {
      if (this.symbols.length === 0) {
        await this.refreshSymbols();
      }

      const pairs = this.symbols;
      const results = await mapLimit(pairs, this.opts.scanConcurrency, async (symbol) => {
        try {
          return await this.scanPair(symbol);
        } catch {
          return { ok: false, near: null, signal: null } as ScanResult;
        }
      });

      this.scannedPairs = results.filter((r) => r.ok).length;
      this.nearZones = results
        .map((r) => r.near)
        .filter((z): z is NearZone => z !== null)
        .sort((a, b) => a.distancePct - b.distancePct)
        .slice(0, 15);

      for (const result of results) {
        if (result.signal) this.addSignal(result.signal);
      }

      this.lastScanAt = Date.now();
      this.lastScanDurationMs = this.lastScanAt - started;
      this.lastError = null;
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.scanning = false;
      this.scheduleSave();
    }
  }

  private async scanPair(symbol: string): Promise<ScanResult> {
    const cached = this.htfCache.get(symbol);
    const now = Date.now();
    const needHtf = !cached || now - cached.at > HTF_CACHE_MS;
    const [m1, m30, h1] = await Promise.all([
      fetchKlines(this.opts.oandaHost, this.opts.oandaApiKey, symbol, 'M1', 35),
      needHtf
        ? fetchKlines(this.opts.oandaHost, this.opts.oandaApiKey, symbol, 'M30', 60)
        : Promise.resolve(cached.m30),
      needHtf
        ? fetchKlines(this.opts.oandaHost, this.opts.oandaApiKey, symbol, 'H1', 60)
        : Promise.resolve(cached.h1),
    ]);

    if (!m1 || !m30 || !h1 || m1.length < 20 || m30.length < 20 || h1.length < 20) {
      return { ok: false, near: null, signal: null };
    }
    if (needHtf) this.htfCache.set(symbol, { h1, m30, at: now });

    const currentCandle = m1[m1.length - 1];
    const previousCandle = m1[m1.length - 2];
    const price = currentCandle.close;
    const lastDay = h1.slice(-24);
    const dayOpen = lastDay[0]?.open ?? price;
    this.marketMeta.set(symbol, {
      changePct: dayOpen > 0 ? ((price - dayOpen) / dayOpen) * 100 : 0,
      quoteVolume: lastDay.reduce((sum, candle) => sum + candle.volume, 0),
    });
    const m1AvgVol = averageVolume(m1, m1.length - 1 - M1_VOL_LOOKBACK, m1.length - 1);
    const currentVolRatio = m1AvgVol > 0 ? currentCandle.volume / m1AvgVol : 1;
    const previousVolRatio = m1AvgVol > 0 ? previousCandle.volume / m1AvgVol : 1;

    const zones = [
      ...findUntestedHtfBodyZones(h1, 'H1', price),
      ...findUntestedHtfBodyZones(m30, 'M30', price),
    ].sort((a, b) => a.distancePct - b.distancePct);

    const nearest = zones[0];
    const near: NearZone | null = nearest
      ? {
          symbol,
          timeframe: nearest.timeframe,
          type: nearest.type,
          bodyTop: nearest.bodyTop,
          bodyBottom: nearest.bodyBottom,
          distancePct: Number(nearest.distancePct.toFixed(3)),
          volRatio: Number(nearest.volRatio.toFixed(2)),
        }
      : null;

    const demandZones = zones.filter((z) => z.type === 'DEMAND');
    const supplyZones = zones.filter((z) => z.type === 'SUPPLY');
    const tolerance = TOUCH_TOLERANCE_PCT / 100;

    let triggeredZone: Zone | null = null;
    let direction: SignalDirection | null = null;
    let triggerRatio = currentVolRatio;
    let triggerCandle = currentCandle;

    for (const zone of demandZones) {
      const upper = zone.bodyTop * (1 + tolerance);
      const lower = zone.bodyBottom * (1 - tolerance * 2);
      for (const [candle, ratio] of [
        [currentCandle, currentVolRatio],
        [previousCandle, previousVolRatio],
      ] as Array<[Kline, number]>) {
        const touched = candle.low <= upper && candle.high >= lower;
        const isGreen = candle.close > candle.open && candle.close >= zone.bodyBottom;
        if (touched && isGreen && ratio >= M1_VOL_MULTIPLIER) {
          triggeredZone = zone;
          direction = 'LONG';
          triggerRatio = ratio;
          triggerCandle = candle;
          break;
        }
      }
      if (triggeredZone) break;
    }

    if (!triggeredZone) {
      for (const zone of supplyZones) {
        const lower = zone.bodyBottom * (1 - tolerance);
        const upper = zone.bodyTop * (1 + tolerance * 2);
        for (const [candle, ratio] of [
          [currentCandle, currentVolRatio],
          [previousCandle, previousVolRatio],
        ] as Array<[Kline, number]>) {
          const touched = candle.high >= lower && candle.low <= upper;
          const isRed = candle.close < candle.open && candle.close <= zone.bodyTop;
          if (touched && isRed && ratio >= M1_VOL_MULTIPLIER) {
            triggeredZone = zone;
            direction = 'SHORT';
            triggerRatio = ratio;
            triggerCandle = candle;
            break;
          }
        }
        if (triggeredZone) break;
      }
    }

    if (!triggeredZone || !direction) {
      return { ok: true, near, signal: null };
    }

    if (this.lastTriggerBySymbol.get(symbol) === triggerCandle.openTime) {
      return { ok: true, near, signal: null };
    }

    const hasOpen = [...this.signals.values()].some(
      (s) => s.symbol === symbol && s.status === 'OPEN'
    );
    if (hasOpen) {
      return { ok: true, near, signal: null };
    }

    const targets = this.riskTargets(symbol);
    if (!targets) return { ok: true, near, signal: null };
    const stopLoss =
      direction === 'LONG' ? price - targets.slDistance : price + targets.slDistance;
    const takeProfit =
      direction === 'LONG' ? price + targets.tpDistance : price - targets.tpDistance;

    const riskPct = (targets.slDistance / price) * 100;
    const rewardPct = (targets.tpDistance / price) * 100;
    const roePct = rewardPct * this.opts.leverage;
    const timestampMs = Date.now();
    const id = `${symbol}-${triggerCandle.openTime}-${direction}`;

    return {
      ok: true,
      near,
      signal: {
        id,
        symbol,
        direction,
        timestampMs,
        timeframe: triggeredZone.timeframe,
        bodyTop: triggeredZone.bodyTop,
        bodyBottom: triggeredZone.bodyBottom,
        htfVolRatio: Number(triggeredZone.volRatio.toFixed(2)),
        m1VolRatio: Number(triggerRatio.toFixed(2)),
        entry: price,
        stopLoss,
        takeProfit,
        riskPct: Number(riskPct.toFixed(3)),
        rewardPct: Number(rewardPct.toFixed(3)),
        roePct: Number(roePct.toFixed(2)),
        leverage: this.opts.leverage,
        triggerCandleOpen: triggerCandle.openTime,
        reason:
          `${symbol} touched untested ${triggeredZone.timeframe} ${triggeredZone.type.toLowerCase()} body ` +
          `(${triggeredZone.volRatio.toFixed(1)}x HTF volume, ${triggeredZone.bodyBottom.toPrecision(6)}-` +
          `${triggeredZone.bodyTop.toPrecision(6)}) and printed a ${triggerRatio.toFixed(1)}x volume M1 reversal candle.`,
      },
    };
  }

  private hasRecentSignal(signal: NewSignal): boolean {
    const cutoff = signal.timestampMs - this.opts.reentryCooldownMs;
    for (const existing of this.signals.values()) {
      if (existing.symbol !== signal.symbol) continue;
      if (existing.signalTime >= cutoff) return true;
    }
    return false;
  }

  private addSignal(signal: NewSignal): void {
    if (this.signals.has(signal.id)) return;
    if (this.lastTriggerBySymbol.get(signal.symbol) === signal.triggerCandleOpen) return;
    if (this.hasRecentSignal(signal)) return;
    const openForSymbol = [...this.signals.values()].filter(
      (s) => s.symbol === signal.symbol && s.status === 'OPEN'
    ).length;
    if (openForSymbol >= this.opts.maxOpenPerSymbol) return;

    const signalMinuteEnd = Math.floor(signal.timestampMs / 60_000) * 60_000 + 60_000;
    const tracked: TrackedSignal = {
      id: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      status: 'OPEN',
      verdict: verdictFor('OPEN'),
      timeframe: signal.timeframe,
      bodyTop: signal.bodyTop,
      bodyBottom: signal.bodyBottom,
      htfVolRatio: signal.htfVolRatio,
      m1VolRatio: signal.m1VolRatio,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      riskPct: signal.riskPct,
      rewardPct: signal.rewardPct,
      roePct: signal.roePct,
      leverage: signal.leverage,
      signalTime: signal.timestampMs,
      signalTimeUtc: isoUtc(signal.timestampMs),
      resolvedAt: null,
      resolvedAtUtc: null,
      resolutionPrice: null,
      holdMinutes: null,
      mfeR: 0,
      maeR: 0,
      livePrice: signal.entry,
      liveUpdatedAt: signal.timestampMs,
      priceChangePct: 0,
      unrealizedR: 0,
      progressPct: 0,
      distanceToTpPct: 0,
      distanceToSlPct: 0,
      reason: signal.reason,
      triggerCandleOpen: signal.triggerCandleOpen,
      signalMinuteEnd,
      nextCandleOpen: signalMinuteEnd,
      intraDone: false,
    };

    this.lastTriggerBySymbol.set(signal.symbol, signal.triggerCandleOpen);
    this.signals.set(tracked.id, tracked);
    this.stats.total += 1;
    this.openDummyTrade(tracked);
    this.trimResolvedHistory();
    this.scheduleSave();
  }

  private openDummyTrade(signal: TrackedSignal): void {
    if (this.trades.has(signal.id)) return;
    this.trades.set(signal.id, {
      id: signal.id,
      signalId: signal.id,
      symbol: signal.symbol,
    direction: signal.direction,
    lotSize: this.lotSize,
    entryPrice: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      openedAt: signal.signalTime,
      openedAtUtc: signal.signalTimeUtc,
      closedAt: null,
      closedAtUtc: null,
      exitPrice: null,
      status: 'OPEN',
      outcome: null,
      pnl: 0,
      unrealizedPnl: 0,
      balanceAfter: null,
    });
  }

  private closeDummyTrade(
    signal: TrackedSignal,
    status: SignalStatus,
    price: number,
    atMs: number
  ): void {
    const trade = this.trades.get(signal.id);
    if (!trade || trade.status !== 'OPEN') return;
    const pnl = tradePnl(
      trade.symbol,
      trade.direction,
      trade.lotSize,
      trade.entryPrice,
      price,
      this.quoteRates()
    );
    this.balance = roundMoney(this.balance + pnl);
    trade.status = 'CLOSED';
    trade.outcome = status;
    trade.closedAt = atMs;
    trade.closedAtUtc = isoUtc(atMs);
    trade.exitPrice = price;
    trade.pnl = pnl;
    trade.unrealizedPnl = 0;
    trade.balanceAfter = this.balance;
    this.trimTradeHistory();
  }

  private trimTradeHistory(): void {
    const closed = [...this.trades.values()]
      .filter((trade) => trade.status === 'CLOSED')
      .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    const excess = closed.length - MAX_TRADE_HISTORY;
    for (let i = 0; i < excess; i += 1) {
      this.trades.delete(closed[i].id);
    }
  }

  private trimResolvedHistory(): void {
    const resolved = [...this.signals.values()]
      .filter((signal) => signal.status !== 'OPEN')
      .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
    const excess = resolved.length - MAX_RESOLVED_HISTORY;
    for (let i = 0; i < excess; i += 1) {
      this.signals.delete(resolved[i].id);
    }
  }

  private async watchOnce(): Promise<void> {
    if (this.watching || !this.running) return;
    const groups = new Map<string, TrackedSignal[]>();
    for (const signal of this.signals.values()) {
      if (signal.status !== 'OPEN') continue;
      const existing = groups.get(signal.symbol);
      if (existing) existing.push(signal);
      else groups.set(signal.symbol, [signal]);
    }
    if (groups.size === 0) {
      this.lastWatchAt = Date.now();
      return;
    }
    this.watching = true;
    try {
      await mapLimit([...groups.entries()], this.opts.watchConcurrency, async ([symbol, signals]) => {
        try {
          await this.watchSymbolGroup(symbol, signals);
        } catch {
          return;
        }
      });
      this.lastWatchAt = Date.now();
    } finally {
      this.watching = false;
    }
  }

  private async watchSymbolGroup(symbol: string, signals: TrackedSignal[]): Promise<void> {
    const now = Date.now();
    const maxTrackMs = this.opts.maxTrackHours * 3_600_000;

    for (const signal of signals) {
      if (signal.status === 'OPEN' && !signal.intraDone) {
        await this.watchFirstMinute(signal, now);
      }
    }

    const active = signals.filter((signal) => signal.status === 'OPEN');
    if (active.length === 0) return;

    const start = Math.min(...active.map((signal) => signal.nextCandleOpen));
    if (now > start) {
      const candles = await fetchKlinesWindow(
        this.opts.oandaHost,
        this.opts.oandaApiKey,
        symbol,
        start,
        now
      );
      for (const signal of active) {
        if (signal.status !== 'OPEN') continue;
        const deadline = signal.signalTime + maxTrackMs;
        for (const candle of candles) {
          if (signal.status !== 'OPEN') break;
          if (candle.openTime < signal.nextCandleOpen) continue;
          if (candle.openTime >= deadline + 60_000) break;

          const closed = candle.closeTime < now;
          this.applyExtremes(signal, candle);
          const hit = this.hitLevels(signal, candle);

          if (hit.slHit || hit.tpHit) {
            if (hit.slHit && hit.tpHit) {
              await this.resolveIntraMinute(signal, candle, closed ? candle.closeTime : now);
              break;
            }
            if (hit.slHit) {
              this.resolveSignal(signal, 'SL_HIT', signal.stopLoss, closed ? candle.closeTime : now);
              break;
            }
            this.resolveSignal(signal, 'TP_HIT', signal.takeProfit, closed ? candle.closeTime : now);
            break;
          }

          signal.livePrice = candle.close;
          signal.liveUpdatedAt = now;

          if (closed) {
            signal.nextCandleOpen = candle.openTime + 60_000;
          } else {
            break;
          }
        }
      }
    }

    for (const signal of active) {
      if (signal.status === 'OPEN' && now >= signal.signalTime + maxTrackMs) {
        this.resolveSignal(signal, 'EXPIRED', signal.livePrice ?? signal.entry, now);
      }
    }
  }

  private async watchFirstMinute(signal: TrackedSignal, now: number): Promise<void> {
    const end = Math.min(now, signal.signalMinuteEnd);
    if (end > signal.signalTime) {
      const count = Math.ceil((Date.now() - signal.signalTime) / 5000) + 2;
      const seconds = await fetchKlines(
        this.opts.oandaHost,
        this.opts.oandaApiKey,
        signal.symbol,
        'S5',
        count
      );
      const window = seconds?.filter(
        (candle) => candle.openTime >= signal.signalTime && candle.openTime <= end
      );
      if (window && window.length > 0) {
        for (const candle of window) {
          this.applyExtremes(signal, candle);
          const hit = this.hitLevels(signal, candle);
          if (hit.slHit && hit.tpHit) {
            this.resolveSignal(signal, 'AMBIGUOUS', candle.close, candle.closeTime);
            break;
          }
          if (hit.slHit) {
            this.resolveSignal(signal, 'SL_HIT', signal.stopLoss, candle.closeTime);
            break;
          }
          if (hit.tpHit) {
            this.resolveSignal(signal, 'TP_HIT', signal.takeProfit, candle.closeTime);
            break;
          }
          signal.livePrice = candle.close;
          signal.liveUpdatedAt = now;
        }
      }
    }
    if (now >= signal.signalMinuteEnd) signal.intraDone = true;
  }

  private applyExtremes(signal: TrackedSignal, candle: Kline): void {
    const risk = Math.abs(signal.entry - signal.stopLoss);
    if (risk <= 0) return;
    const favourable =
      signal.direction === 'LONG' ? candle.high - signal.entry : signal.entry - candle.low;
    const adverse =
      signal.direction === 'LONG' ? signal.entry - candle.low : candle.high - signal.entry;
    signal.mfeR = Math.max(signal.mfeR, favourable / risk);
    signal.maeR = Math.max(signal.maeR, adverse / risk);
  }

  private hitLevels(
    signal: TrackedSignal,
    candle: Kline
  ): { slHit: boolean; tpHit: boolean } {
    if (signal.direction === 'LONG') {
      return {
        slHit: candle.low <= signal.stopLoss,
        tpHit: candle.high >= signal.takeProfit,
      };
    }
    return {
      slHit: candle.high >= signal.stopLoss,
      tpHit: candle.low <= signal.takeProfit,
    };
  }

  private async resolveIntraMinute(
    signal: TrackedSignal,
    candle: Kline,
    endMs: number
  ): Promise<boolean> {
    const limit = Math.min(endMs, candle.closeTime);
    const count = Math.ceil((Date.now() - candle.openTime) / 5000) + 2;
    const seconds = await fetchKlines(
      this.opts.oandaHost,
      this.opts.oandaApiKey,
      signal.symbol,
      'S5',
      count
    );
    const window = seconds?.filter(
      (item) => item.openTime >= candle.openTime && item.openTime <= limit
    );
    if (!window) return false;
    for (const second of window) {
      const hit = this.hitLevels(signal, second);
      if (hit.slHit && hit.tpHit) {
        this.resolveSignal(signal, 'AMBIGUOUS', second.close, second.closeTime);
        return true;
      }
      if (hit.slHit) {
        this.resolveSignal(signal, 'SL_HIT', signal.stopLoss, second.closeTime);
        return true;
      }
      if (hit.tpHit) {
        this.resolveSignal(signal, 'TP_HIT', signal.takeProfit, second.closeTime);
        return true;
      }
    }
    this.resolveSignal(signal, 'AMBIGUOUS', candle.close, endMs);
    return true;
  }

  private resolveSignal(
    signal: TrackedSignal,
    status: SignalStatus,
    price: number,
    atMs: number
  ): void {
    if (signal.status !== 'OPEN') return;
    signal.status = status;
    signal.verdict = verdictFor(status);
    signal.resolutionPrice = price;
    signal.resolvedAt = atMs;
    signal.resolvedAtUtc = isoUtc(atMs);
    signal.livePrice = price;
    signal.liveUpdatedAt = atMs;
    signal.holdMinutes = Number(((atMs - signal.signalTime) / 60_000).toFixed(2));
    this.closeDummyTrade(signal, status, price, atMs);
    if (status === 'TP_HIT') this.stats.tp += 1;
    else if (status === 'SL_HIT') this.stats.sl += 1;
    else if (status === 'AMBIGUOUS') this.stats.ambiguous += 1;
    else if (status === 'EXPIRED') this.stats.expired += 1;
    this.trimResolvedHistory();
    this.scheduleSave();
  }

  private toPublicSignal(signal: TrackedSignal, now: number): LiveSignal {
    const risk = Math.abs(signal.entry - signal.stopLoss);
    const live = signal.livePrice ?? signal.entry;
    const directionalMove =
      signal.direction === 'LONG' ? live - signal.entry : signal.entry - live;
    const unrealizedR = risk > 0 ? directionalMove / risk : 0;
    const targetDistance =
      signal.direction === 'LONG'
        ? signal.takeProfit - signal.entry
        : signal.entry - signal.takeProfit;
    const progressPct =
      targetDistance !== 0 ? Number(((directionalMove / targetDistance) * 100).toFixed(2)) : 0;
    const priceChangePct = signal.entry !== 0 ? (directionalMove / signal.entry) * 100 : 0;
    const distanceToTpPct =
      signal.direction === 'LONG'
        ? ((signal.takeProfit - live) / live) * 100
        : ((live - signal.takeProfit) / live) * 100;
    const distanceToSlPct =
      signal.direction === 'LONG'
        ? ((live - signal.stopLoss) / live) * 100
        : ((signal.stopLoss - live) / live) * 100;

    return {
      id: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      status: signal.status,
      verdict: signal.verdict,
      timeframe: signal.timeframe,
      bodyTop: signal.bodyTop,
      bodyBottom: signal.bodyBottom,
      htfVolRatio: signal.htfVolRatio,
      m1VolRatio: signal.m1VolRatio,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      riskPct: signal.riskPct,
      rewardPct: signal.rewardPct,
      roePct: signal.roePct,
      leverage: signal.leverage,
      signalTime: signal.signalTime,
      signalTimeUtc: signal.signalTimeUtc,
      resolvedAt: signal.resolvedAt,
      resolvedAtUtc: signal.resolvedAtUtc,
      resolutionPrice: signal.resolutionPrice,
      holdMinutes: signal.holdMinutes,
      mfeR: Number(signal.mfeR.toFixed(3)),
      maeR: Number(signal.maeR.toFixed(3)),
      livePrice: Number(live.toPrecision(12)),
      liveUpdatedAt: signal.liveUpdatedAt,
      priceChangePct: Number(priceChangePct.toFixed(3)),
      unrealizedR: Number(unrealizedR.toFixed(3)),
      progressPct,
      distanceToTpPct: Number(distanceToTpPct.toFixed(3)),
      distanceToSlPct: Number(distanceToSlPct.toFixed(3)),
      reason: signal.reason,
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveState();
    }, 1500);
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.opts.stateFile);
      fs.mkdirSync(dir, { recursive: true });
      const payload = {
        version: 6,
        dataSource: 'oanda',
        savedAt: Date.now(),
        stats: this.stats,
        startingBalance: this.startingBalance,
        balance: this.balance,
        lotSize: this.lotSize,
        signals: [...this.signals.values()],
        trades: [...this.trades.values()],
        withdrawals: this.withdrawals,
        lastTriggerBySymbol: Object.fromEntries(this.lastTriggerBySymbol),
      };
      const tmp = `${this.opts.stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmp, this.opts.stateFile);
    } catch (error) {
      console.error('Signal state save failed:', error);
    }
  }

  private loadState(): void {
    if (!fs.existsSync(this.opts.stateFile)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.opts.stateFile, 'utf8')) as {
        dataSource?: string;
        signals?: unknown[];
        trades?: unknown[];
        withdrawals?: unknown[];
        lastTriggerBySymbol?: Record<string, unknown>;
        stats?: Partial<EngineStats>;
        startingBalance?: number;
        balance?: number;
        lotSize?: number;
      };
      if (raw.dataSource !== 'oanda') {
        this.signals.clear();
        this.lastTriggerBySymbol.clear();
        this.stats = { total: 0, tp: 0, sl: 0, ambiguous: 0, expired: 0 };
        this.trades.clear();
        this.withdrawals = [];
        this.balance = this.startingBalance;
        return;
      }
      const storedStarting = Number(raw.startingBalance);
      if (Number.isFinite(storedStarting) && storedStarting > 0) {
        this.startingBalance = storedStarting;
      }
      const storedBalance = Number(raw.balance);
      this.balance = Number.isFinite(storedBalance) ? storedBalance : this.startingBalance;
      const storedLotSize = Number(raw.lotSize);
      if (
        Number.isFinite(storedLotSize) &&
        storedLotSize >= MIN_LOT_SIZE &&
        storedLotSize <= MAX_LOT_SIZE
      ) {
        this.lotSize = Math.round(storedLotSize * 100) / 100;
      }
      if (Array.isArray(raw.trades)) {
        for (const item of raw.trades) {
          const trade = this.normalizeStoredTrade(item);
          if (!trade) continue;
          if (trade.status === 'OPEN' && !SYMBOL_INSTRUMENTS[trade.symbol]) continue;
          this.trades.set(trade.id, trade);
        }
      }
      for (const trade of this.trades.values()) {
        if (trade.status === 'OPEN') trade.lotSize = this.lotSize;
      }
      if (Array.isArray(raw.withdrawals)) {
        for (const item of raw.withdrawals) {
          const withdrawal = this.normalizeStoredWithdrawal(item);
          if (withdrawal) this.withdrawals.push(withdrawal);
        }
        this.withdrawals.sort((a, b) => b.requestedAt - a.requestedAt);
      }
      if (Array.isArray(raw.signals)) {
        for (const item of raw.signals) {
          const tracked = this.normalizeStoredSignal(item);
          if (tracked && toInstrument(tracked.symbol)) this.signals.set(tracked.id, tracked);
        }
      }
      if (raw.lastTriggerBySymbol && typeof raw.lastTriggerBySymbol === 'object') {
        for (const [symbol, value] of Object.entries(raw.lastTriggerBySymbol)) {
          if (!toInstrument(symbol)) continue;
          const ms = Number(value);
          if (Number.isFinite(ms)) this.lastTriggerBySymbol.set(symbol, ms);
        }
      }
      const newestOpen = new Map<string, TrackedSignal>();
      for (const signal of this.signals.values()) {
        if (signal.status !== 'OPEN') continue;
        const current = newestOpen.get(signal.symbol);
        if (!current || signal.signalTime > current.signalTime) {
          newestOpen.set(signal.symbol, signal);
        }
      }
      const now = Date.now();
      for (const signal of this.signals.values()) {
        if (signal.status !== 'OPEN' || newestOpen.get(signal.symbol) === signal) continue;
        signal.status = 'EXPIRED';
        signal.verdict = verdictFor('EXPIRED');
        signal.resolutionPrice = signal.entry;
        signal.resolvedAt = now;
        signal.resolvedAtUtc = isoUtc(now);
        signal.livePrice = signal.entry;
        signal.liveUpdatedAt = now;
        signal.holdMinutes = Number(((now - signal.signalTime) / 60_000).toFixed(2));
      }
      const derived: EngineStats = { total: 0, tp: 0, sl: 0, ambiguous: 0, expired: 0 };
      for (const signal of this.signals.values()) {
        derived.total += 1;
        if (signal.status === 'TP_HIT') derived.tp += 1;
        else if (signal.status === 'SL_HIT') derived.sl += 1;
        else if (signal.status === 'AMBIGUOUS') derived.ambiguous += 1;
        else if (signal.status === 'EXPIRED') derived.expired += 1;
      }
      const stored = raw.stats;
      this.stats = {
        total: Math.max(Number(stored?.total) || 0, derived.total),
        tp: Math.max(Number(stored?.tp) || 0, derived.tp),
        sl: Math.max(Number(stored?.sl) || 0, derived.sl),
        ambiguous: Math.max(Number(stored?.ambiguous) || 0, derived.ambiguous),
        expired: Math.max(Number(stored?.expired) || 0, derived.expired),
      };
      this.syncTradesWithSignals();
    } catch (error) {
      console.error('Signal state load failed:', error);
    }
  }

  private syncTradesWithSignals(): void {
    const ordered = [...this.signals.values()].sort(
      (a, b) => (a.resolvedAt ?? a.signalTime) - (b.resolvedAt ?? b.signalTime)
    );
    for (const signal of ordered) {
      const trade = this.trades.get(signal.id);
      if (!trade) {
        this.openDummyTrade(signal);
        if (signal.status === 'OPEN') continue;
        const opened = this.trades.get(signal.id);
        if (!opened) continue;
        const exit = signal.resolutionPrice ?? signal.entry;
        const at = signal.resolvedAt ?? signal.signalTime;
        const pnl = tradePnl(
          opened.symbol,
          opened.direction,
          opened.lotSize,
          opened.entryPrice,
          exit,
          this.quoteRates()
        );
        this.balance = roundMoney(this.balance + pnl);
        opened.status = 'CLOSED';
        opened.outcome = signal.status;
        opened.closedAt = at;
        opened.closedAtUtc = isoUtc(at);
        opened.exitPrice = exit;
        opened.pnl = pnl;
        opened.unrealizedPnl = 0;
        opened.balanceAfter = this.balance;
        continue;
      }
      if (trade.status === 'OPEN' && signal.status !== 'OPEN') {
        this.closeDummyTrade(
          signal,
          signal.status,
          signal.resolutionPrice ?? signal.entry,
          signal.resolvedAt ?? signal.signalTime
        );
      }
    }
    this.trimTradeHistory();
  }

  private normalizeStoredTrade(item: unknown): DummyTrade | null {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    const symbol = String(raw.symbol ?? '').toUpperCase();
    if (!toInstrument(symbol)) return null;
    const id = String(raw.id ?? raw.signalId ?? '');
    const openedAt = Number(raw.openedAt);
    const entryPrice = Number(raw.entryPrice);
    if (!id || !Number.isFinite(openedAt) || !Number.isFinite(entryPrice)) return null;
    const status = raw.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
    const direction = raw.direction === 'SHORT' ? 'SHORT' : 'LONG';
    const lotSize = Number(raw.lotSize);
    const closedAt = raw.closedAt === null || raw.closedAt === undefined ? null : Number(raw.closedAt);
    return {
      id,
      signalId: String(raw.signalId ?? id),
      symbol,
      direction,
        lotSize: Number.isFinite(lotSize) && lotSize > 0 ? lotSize : this.lotSize,
      entryPrice,
      stopLoss: Number(raw.stopLoss ?? 0),
      takeProfit: Number(raw.takeProfit ?? 0),
      openedAt,
      openedAtUtc: String(raw.openedAtUtc ?? isoUtc(openedAt)),
      closedAt: Number.isFinite(closedAt as number) ? (closedAt as number) : null,
      closedAtUtc: raw.closedAtUtc ? String(raw.closedAtUtc) : null,
      exitPrice:
        raw.exitPrice === null || raw.exitPrice === undefined ? null : Number(raw.exitPrice),
      status,
      outcome: (raw.outcome as SignalStatus | null) ?? null,
      pnl: Number(raw.pnl ?? 0),
      unrealizedPnl: Number(raw.unrealizedPnl ?? 0),
      balanceAfter:
        raw.balanceAfter === null || raw.balanceAfter === undefined
          ? null
          : Number(raw.balanceAfter),
    };
  }

  private normalizeStoredWithdrawal(item: unknown): Withdrawal | null {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    const method = raw.method === 'JAZZCASH' || raw.method === 'EASYPAISA' ? raw.method : null;
    const id = String(raw.id ?? '');
    const requestedAt = Number(raw.requestedAt);
    const amount = Number(raw.amount);
    if (!method || !id || !Number.isFinite(requestedAt) || !Number.isFinite(amount)) return null;
    return {
      id,
      method,
      accountNumber: String(raw.accountNumber ?? ''),
      accountTitle: String(raw.accountTitle ?? ''),
      amount,
      status: 'PAID',
      reference: String(raw.reference ?? ''),
      requestedAt,
      requestedAtUtc: String(raw.requestedAtUtc ?? isoUtc(requestedAt)),
      balanceAfter: Number(raw.balanceAfter ?? 0),
    };
  }

  private normalizeStoredSignal(item: unknown): TrackedSignal | null {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    const required = ['id', 'symbol', 'direction', 'entry', 'stopLoss', 'takeProfit', 'signalTime'];
    for (const key of required) {
      if (raw[key] === undefined || raw[key] === null) return null;
    }
    const signalTime = Number(raw.signalTime);
    if (!Number.isFinite(signalTime)) return null;
    const signalMinuteEnd = Math.floor(signalTime / 60_000) * 60_000 + 60_000;
    const status = (raw.status as SignalStatus) ?? 'OPEN';
    const direction = raw.direction === 'SHORT' ? 'SHORT' : 'LONG';
    const tracked: TrackedSignal = {
      id: String(raw.id),
      symbol: String(raw.symbol),
      direction,
      status,
      verdict: String(raw.verdict ?? verdictFor(status)),
      timeframe: raw.timeframe === 'M30' ? 'M30' : 'H1',
      bodyTop: Number(raw.bodyTop ?? 0),
      bodyBottom: Number(raw.bodyBottom ?? 0),
      htfVolRatio: Number(raw.htfVolRatio ?? 0),
      m1VolRatio: Number(raw.m1VolRatio ?? 0),
      entry: Number(raw.entry),
      stopLoss: Number(raw.stopLoss),
      takeProfit: Number(raw.takeProfit),
      riskPct: Number(raw.riskPct ?? 0),
      rewardPct: Number(raw.rewardPct ?? 0),
      roePct: Number(raw.roePct ?? 0),
      leverage: Number(raw.leverage ?? this.opts.leverage),
      signalTime,
      signalTimeUtc: String(raw.signalTimeUtc ?? isoUtc(signalTime)),
      resolvedAt: raw.resolvedAt === null || raw.resolvedAt === undefined ? null : Number(raw.resolvedAt),
      resolvedAtUtc: raw.resolvedAtUtc ? String(raw.resolvedAtUtc) : null,
      resolutionPrice:
        raw.resolutionPrice === null || raw.resolutionPrice === undefined
          ? null
          : Number(raw.resolutionPrice),
      holdMinutes:
        raw.holdMinutes === null || raw.holdMinutes === undefined ? null : Number(raw.holdMinutes),
      mfeR: Number(raw.mfeR ?? 0),
      maeR: Number(raw.maeR ?? 0),
      livePrice: raw.livePrice === null || raw.livePrice === undefined ? null : Number(raw.livePrice),
      liveUpdatedAt:
        raw.liveUpdatedAt === null || raw.liveUpdatedAt === undefined
          ? null
          : Number(raw.liveUpdatedAt),
      priceChangePct: Number(raw.priceChangePct ?? 0),
      unrealizedR: Number(raw.unrealizedR ?? 0),
      progressPct: Number(raw.progressPct ?? 0),
      distanceToTpPct: Number(raw.distanceToTpPct ?? 0),
      distanceToSlPct: Number(raw.distanceToSlPct ?? 0),
      reason: String(raw.reason ?? ''),
      triggerCandleOpen: Number(raw.triggerCandleOpen ?? Math.floor(signalTime / 60_000) * 60_000),
      signalMinuteEnd,
      nextCandleOpen: Number(raw.nextCandleOpen ?? signalMinuteEnd),
      intraDone: raw.intraDone === undefined ? Date.now() >= signalMinuteEnd : Boolean(raw.intraDone),
    };
    return tracked;
  }
}

export function createSignalEngineFromEnv(): SignalEngine {
  const pairsOverride = (process.env.SIGNAL_PAIRS ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const environment = (process.env.OANDA_ENVIRONMENT ?? 'practice').trim().toLowerCase();
  const oandaHost =
    environment === 'live'
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com';
  const oandaApiKey = (process.env.OANDA_API_KEY ?? '').trim();

  const stateFile = path.resolve(
    process.cwd(),
    process.env.SIGNAL_STATE_FILE ?? path.join('data', 'live_signals_state.json')
  );

  return new SignalEngine({
    enabled: envFlag('SIGNAL_ENGINE_ENABLED', true),
    scanIntervalMs: envNumber('SIGNAL_SCAN_INTERVAL_MS', 25_000),
    watchIntervalMs: envNumber('SIGNAL_WATCH_INTERVAL_MS', 5_000),
    maxTrackHours: envNumber('SIGNAL_MAX_TRACK_HOURS', 24),
    stateFile,
    scanConcurrency: Math.round(envNumber('SIGNAL_SCAN_CONCURRENCY', 10)),
    watchConcurrency: Math.round(envNumber('SIGNAL_WATCH_CONCURRENCY', 6)),
    priceIntervalMs: envNumber('SIGNAL_PRICE_INTERVAL_MS', 500),
    leverage: envNumber('SIGNAL_LEVERAGE', 10),
    maxOpenPerSymbol: Math.max(1, Math.round(envNumber('SIGNAL_MAX_OPEN_PER_SYMBOL', 1))),
    reentryCooldownMs: envNumber('SIGNAL_REENTRY_COOLDOWN_MIN', 60) * 60_000,
    pairsOverride,
    oandaHost,
    oandaApiKey,
  });
}
