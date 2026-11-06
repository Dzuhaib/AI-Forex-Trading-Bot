/**
 * Server-side live signal engine for the Untested H1/M30 High-Volume Body + M1 Reversal strategy.
 * - Scans FX/CFD instruments (gold, WTI, majors, BTC) on OANDA data.
 * - Sizes each trade from the connected MT5 account balance (5% risk, per-pair SL, 2R TP).
 * - Watches every open signal against live M1 and S5 candles.
 * - At 50% of TP, moves SL to a 20% TP profit lock and trails it 30% of TP behind the best price.
 * - Executes entries, exits and trailing stops on the logged-in MT5 account.
 * - Dashboard pair selections and the MT5 suffix are persisted across restarts.
 */

import type {
  AccountSummary,
  LiveSignal,
  MarketTicker,
  NearZone,
  Mt5Status,
  PairMutationResult,
  PairsResponse,
  SignalDirection,
  SignalEngineStatus,
  SignalsResponse,
  SignalStatus,
} from './src/types';
import type { Mt5Broker, Mt5SymbolInfo } from './mt5Broker';
import type { DashboardState } from './dashboardState';

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
  initialRiskDistance: number;
  bestPrice: number;
  breakevenActive: boolean;
}

interface SignalExecution {
  signalId: string;
  symbol: string;
  volume: number;
  offset: number;
  ticket: number | null;
  closeRequested: boolean;
  closing: boolean;
  error: string | null;
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
  scanConcurrency: number;
  watchConcurrency: number;
  priceIntervalMs: number;
  maxOpenPerSymbol: number;
  reentryCooldownMs: number;
  leverage: number;
  pairsOverride: string[];
  persistedPairs?: string[];
  persistedSuffix?: string;
  oandaHost: string;
  oandaApiKey: string;
  mt5Broker: Mt5Broker | null;
}

// Supported pairs. Active pairs are managed from the dashboard at runtime.
// OANDA instruments are appended to this catalog after the first successful load.
const PAIR_CATALOG: string[] = [
  'XAUUSD',
  'WTI',
  'BTCUSD',
  'EURUSD',
  'GBPUSD',
  'AUDUSD',
  'NZDUSD',
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'AUDJPY',
  'NZDJPY',
  'CADJPY',
  'CHFJPY',
  'USDCAD',
  'USDCHF',
  'EURCAD',
  'GBPCAD',
  'AUDCAD',
  'NZDCAD',
  'EURCHF',
  'GBPCHF',
  'AUDCHF',
  'NZDCHF',
  'US30',
  'US500',
  'USTEC',
  'UK100',
  'DE30',
  'FR40',
  'EU50',
  'JP225',
  'AUS200',
  'HK50',
  'IN50',
  'TWIX',
  'US2000',
  'ETHUSD',
  'BCHUSD',
  'LTCUSD',
  'XAGUSD',
  'XPTUSD',
  'XPDUSD',
  'XCUUSD',
  'BCO',
  'NATGAS',
  'USB10Y',
  'USB30Y',
  'UK10YB',
  'DE10YB',
];

const PAIR_SET = new Set<string>(PAIR_CATALOG);

const PAIR_LABELS: Record<string, string> = {
  XAUUSD: 'Gold',
  WTI: 'WTI Crude',
  BTCUSD: 'Bitcoin',
  US30: 'US 30',
  US500: 'US 500',
  USTEC: 'US Tech 100',
  UK100: 'UK 100',
  DE30: 'Germany 30',
  FR40: 'France 40',
  EU50: 'Euro 50',
  JP225: 'Japan 225',
  AUS200: 'Australia 200',
  HK50: 'Hong Kong 50',
  IN50: 'India 50',
  TWIX: 'Taiwan Index',
  US2000: 'US 2000',
  ETHUSD: 'Ethereum',
  BCHUSD: 'Bitcoin Cash',
  LTCUSD: 'Litecoin',
  XAGUSD: 'Silver',
  XPTUSD: 'Platinum',
  XPDUSD: 'Palladium',
  XCUUSD: 'Copper',
  BCO: 'Brent Crude',
  NATGAS: 'Natural Gas',
  USB10Y: 'US 10Y Bond',
  USB30Y: 'US 30Y Bond',
  UK10YB: 'UK 10Y Bond',
  DE10YB: 'Germany 10Y Bond',
};

const PAIR_ALIASES: Record<string, string[]> = {
  XAUUSD: ['GOLD', 'XAU'],
  WTI: ['USOIL', 'WTIUSD', 'XTIUSD', 'CRUDOIL'],
  BTCUSD: ['BITCOIN'],
  US30: ['US30USD', 'DOW30', 'DJ30', 'WS30'],
  US500: ['SPX500', 'SP500', 'US500USD'],
  USTEC: ['NAS100', 'NASDAQ100', 'USTEC100', 'USTEC100M', 'US100', 'NDX'],
  UK100: ['FTSE100', 'UK100GBP'],
  DE30: ['GER30', 'GER40', 'DAX', 'DAX40', 'DE40'],
  FR40: ['CAC40', 'FR40EUR'],
  EU50: ['STOXX50', 'EU50EUR'],
  JP225: ['NIKKEI', 'JP225USD'],
  AUS200: ['AU200', 'ASX200'],
  HK50: ['HK33', 'HSI'],
  IN50: ['NIFTY'],
  TWIX: ['TW50'],
  US2000: ['RUSSELL2000'],
  ETHUSD: ['ETH'],
  BCHUSD: ['BCH'],
  LTCUSD: ['LTC'],
  XAGUSD: ['SILVER'],
  XPTUSD: ['PLATINUM'],
  XPDUSD: ['PALLADIUM'],
  XCUUSD: ['COPPER'],
  BCO: ['UKOIL', 'BRENT'],
  NATGAS: ['XNGUSD', 'NGAS'],
  USB10Y: ['US10Y'],
  USB30Y: ['US30Y'],
  UK10YB: ['UK10Y'],
  DE10YB: ['DE10Y'],
};

const PAIR_CATEGORIES: Record<string, string> = {
  XAUUSD: 'metal',
  WTI: 'energy',
  BTCUSD: 'crypto',
  US30: 'index',
  US500: 'index',
  USTEC: 'index',
  UK100: 'index',
  DE30: 'index',
  FR40: 'index',
  EU50: 'index',
  JP225: 'index',
  AUS200: 'index',
  HK50: 'index',
  IN50: 'index',
  TWIX: 'index',
  US2000: 'index',
  ETHUSD: 'crypto',
  BCHUSD: 'crypto',
  LTCUSD: 'crypto',
  XAGUSD: 'metal',
  XPTUSD: 'metal',
  XPDUSD: 'metal',
  XCUUSD: 'metal',
  BCO: 'energy',
  NATGAS: 'energy',
  USB10Y: 'bond',
  USB30Y: 'bond',
  UK10YB: 'bond',
  DE10YB: 'bond',
};

// Broker-style names that resolve to a canonical catalog symbol.
const CANONICAL_ALIASES: Record<string, string> = {
  US30USD: 'US30',
  DOW30: 'US30',
  DJ30: 'US30',
  WS30: 'US30',
  SPX500: 'US500',
  SP500: 'US500',
  US500USD: 'US500',
  NAS100: 'USTEC',
  NASDAQ100: 'USTEC',
  USTEC100: 'USTEC',
  US100: 'USTEC',
  NDX: 'USTEC',
  FTSE100: 'UK100',
  UK100GBP: 'UK100',
  GER30: 'DE30',
  GER40: 'DE30',
  DAX: 'DE30',
  DAX40: 'DE30',
  DE40: 'DE30',
  CAC40: 'FR40',
  FR40EUR: 'FR40',
  STOXX50: 'EU50',
  EU50EUR: 'EU50',
  NIKKEI: 'JP225',
  JP225USD: 'JP225',
  AU200: 'AUS200',
  ASX200: 'AUS200',
  HK33: 'HK50',
  HSI: 'HK50',
  NIFTY: 'IN50',
  TW50: 'TWIX',
  RUSSELL2000: 'US2000',
  GOLD: 'XAUUSD',
  XAU: 'XAUUSD',
  SILVER: 'XAGUSD',
  PLATINUM: 'XPTUSD',
  PALLADIUM: 'XPDUSD',
  COPPER: 'XCUUSD',
  USOIL: 'WTI',
  WTIUSD: 'WTI',
  XTIUSD: 'WTI',
  CRUDOIL: 'WTI',
  UKOIL: 'BCO',
  BRENT: 'BCO',
  XNGUSD: 'NATGAS',
  NGAS: 'NATGAS',
  US10Y: 'USB10Y',
  US30Y: 'USB30Y',
  UK10Y: 'UK10YB',
  DE10Y: 'DE10YB',
  ETH: 'ETHUSD',
  BCH: 'BCHUSD',
  LTC: 'LTCUSD',
};

// Extra MT5-style index variants that share OANDA data but use a different contract size.
const INSTRUMENT_ALIASES: Record<string, string> = {
  US30: 'US30_USD',
  US30X10: 'US30_USD',
  US500: 'SPX500_USD',
  US500X100: 'SPX500_USD',
  USTEC: 'NAS100_USD',
  USTECX100: 'NAS100_USD',
};

const QUOTE_CURRENCY_OVERRIDES: Record<string, string> = {
  UK100: 'GBP',
  DE30: 'EUR',
  FR40: 'EUR',
  EU50: 'EUR',
  AUS200: 'AUD',
  HK50: 'HKD',
};

const DEFAULT_ACTIVE_PAIRS = [
  'XAUUSD',
  'WTI',
  'EURUSD',
  'GBPUSD',
  'BTCUSD',
  'NZDUSD',
  'NZDJPY',
  'GBPJPY',
];

let activeSymbolSuffix = '';

function normalizeSymbolSuffix(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function setActiveSymbolSuffix(value: string): void {
  activeSymbolSuffix = normalizeSymbolSuffix(value);
}

function symbolWithSuffix(base: string, suffix: string): string {
  return `${base}${normalizeSymbolSuffix(suffix)}`;
}

// OANDA data mapping, keyed by the base symbol (suffix is stripped before lookup).
const SYMBOL_INSTRUMENTS: Record<string, string> = {
  XAUUSD: 'XAU_USD',
  WTI: 'WTICO_USD',
  BTCUSD: 'BTC_USD',
  EURUSD: 'EUR_USD',
  GBPUSD: 'GBP_USD',
  AUDUSD: 'AUD_USD',
  NZDUSD: 'NZD_USD',
  USDJPY: 'USD_JPY',
  EURJPY: 'EUR_JPY',
  GBPJPY: 'GBP_JPY',
  AUDJPY: 'AUD_JPY',
  NZDJPY: 'NZD_JPY',
  CADJPY: 'CAD_JPY',
  CHFJPY: 'CHF_JPY',
  USDCAD: 'USD_CAD',
  USDCHF: 'USD_CHF',
  EURCAD: 'EUR_CAD',
  GBPCAD: 'GBP_CAD',
  AUDCAD: 'AUD_CAD',
  NZDCAD: 'NZD_CAD',
  EURCHF: 'EUR_CHF',
  GBPCHF: 'GBP_CHF',
  AUDCHF: 'AUD_CHF',
  NZDCHF: 'NZD_CHF',
  US30: 'US30_USD',
  US500: 'SPX500_USD',
  USTEC: 'NAS100_USD',
  UK100: 'UK100_GBP',
  DE30: 'DE30_EUR',
  FR40: 'FR40_EUR',
  EU50: 'EU50_EUR',
  JP225: 'JP225_USD',
  AUS200: 'AU200_AUD',
  HK50: 'HK33_HKD',
  IN50: 'IN50_USD',
  TWIX: 'TWIX_USD',
  US2000: 'US2000_USD',
  ETHUSD: 'ETH_USD',
  BCHUSD: 'BCH_USD',
  LTCUSD: 'LTC_USD',
  XAGUSD: 'XAG_USD',
  XPTUSD: 'XPT_USD',
  XPDUSD: 'XPD_USD',
  XCUUSD: 'XCU_USD',
  BCO: 'BCO_USD',
  NATGAS: 'NATGAS_USD',
  USB10Y: 'USB10Y_USD',
  USB30Y: 'USB30Y_USD',
  UK10YB: 'UK10YB_GBP',
  DE10YB: 'DE10YB_EUR',
};

// Fetched for USD conversion rates when sizing non-USD-quote pairs.
const QUOTE_RATE_SYMBOLS = ['USDJPY', 'USDCHF', 'USDCAD'];

function registerOandaInstrument(
  instrumentName: string,
  displayName: string,
  pipLocation: unknown
): string {
  const base = baseSymbol(instrumentName);
  if (!base) return '';
  SYMBOL_INSTRUMENTS[base] = instrumentName;

  if (!(base in PIP_SIZE)) {
    const location = Number(pipLocation);
    const pip = Number.isFinite(location) ? 10 ** location : 0.0001;
    PIP_SIZE[base] = pip > 0 ? pip : 0.0001;
  }
  if (!(base in CONTRACT_UNITS)) CONTRACT_UNITS[base] = 100_000;
  if (!(base in STOP_LOSS_DISTANCE)) {
    STOP_LOSS_DISTANCE[base] = (base.endsWith('JPY') ? 3.5 : 2.7) * PIP_SIZE[base];
  }

  PAIR_SET.add(base);
  if (!PAIR_CATALOG.includes(base)) PAIR_CATALOG.push(base);
  if (!PAIR_LABELS[base]) PAIR_LABELS[base] = displayName || base;
  return base;
}

const GRANULARITY_MS: Record<Interval, number> = {
  M1: 60_000,
  M30: 1_800_000,
  H1: 3_600_000,
  S5: 5_000,
};

function normalizeSymbolBody(value: string): string {
  return String(value ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\s-]/g, '')
    .toUpperCase();
}

function baseSymbol(symbol: string): string {
  let value = String(symbol ?? '').trim();
  if (activeSymbolSuffix) {
    const candidates = activeSymbolSuffix.startsWith('.')
      ? [activeSymbolSuffix]
      : [activeSymbolSuffix, `.${activeSymbolSuffix}`];
    candidates.sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      if (
        value.length > candidate.length &&
        value.toUpperCase().endsWith(candidate.toUpperCase())
      ) {
        value = value.slice(0, value.length - candidate.length);
        break;
      }
    }
  }
  return normalizeSymbolBody(value);
}

function normalizePairSymbol(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (PAIR_SET.has(raw)) return raw;
  const base = baseSymbol(raw);
  return PAIR_SET.has(base) ? base : '';
}

function savedPairKey(value: unknown): string {
  return normalizeSymbolBody(String(value ?? '').trim());
}

function toInstrument(symbol: string): string | null {
  return SYMBOL_INSTRUMENTS[baseSymbol(symbol)] ?? null;
}

function resolveCanonical(base: string): string {
  if (PAIR_SET.has(base)) return base;
  return CANONICAL_ALIASES[base] ?? base;
}

function resolveInstrument(base: string): string | null {
  return SYMBOL_INSTRUMENTS[base] ?? INSTRUMENT_ALIASES[base] ?? null;
}

function addPairAlias(base: string, alias: string): void {
  const value = String(alias || '').trim();
  if (!value) return;
  const existing = PAIR_ALIASES[base] ?? [];
  if (!existing.includes(value)) existing.push(value);
  PAIR_ALIASES[base] = existing;
}

function categoryFromPath(path: string): string {
  const lower = String(path || '').toLowerCase();
  if (lower.includes('idx') || lower.includes('index')) return 'index';
  if (lower.includes('crypto')) return 'crypto';
  if (lower.includes('energ')) return 'energy';
  if (lower.includes('stock')) return 'stock';
  if (lower.includes('bond')) return 'bond';
  if (lower.includes('forex')) return 'fx';
  return 'other';
}

function inferMt5Suffix(symbols: Mt5SymbolInfo[]): string {
  const names = symbols.map((row) => row.name.toLowerCase());
  if (names.length === 0) return '';
  const candidates = ['.pro', '.m', '.c', '.a', '.i', 'm', 'c', 'a', 'i'];
  for (const candidate of candidates) {
    const matches = names.filter((name) => name.endsWith(candidate)).length;
    if (matches / names.length >= 0.7) return candidate;
  }
  return '';
}

const STOP_PERCENT_BY_CATEGORY: Record<string, number> = {
  fx: 0.0003,
  metal: 0.001,
  energy: 0.004,
  index: 0.001,
  crypto: 0.0035,
  stock: 0.005,
  bond: 0.003,
  other: 0.002,
};

const HTF_VOL_LOOKBACK = 10;
const HTF_VOL_MULTIPLIER = 1.5;
const M1_VOL_LOOKBACK = 10;
const M1_VOL_MULTIPLIER = 1.2;
const TOUCH_TOLERANCE_PCT = 0.08;
const HTF_CACHE_MS = 90_000;
const MAX_RESOLVED_HISTORY = 400;
const DEFAULT_RISK_BALANCE = 100;
const MIN_LOT_SIZE = 0.01;
const MAX_LOT_SIZE = 100;
const LOT_STEP = 0.01;
const RISK_PERCENT = 5;
const REWARD_RISK_RATIO = 2;
const STOP_LOSS_DISTANCE: Record<string, number> = {
  XAUUSD: 4,
  WTI: 0.4,
  BTCUSD: 260,
  EURUSD: 0.00027,
  GBPUSD: 0.00027,
  AUDUSD: 0.00027,
  NZDUSD: 0.00027,
  USDJPY: 0.035,
  EURJPY: 0.035,
  GBPJPY: 0.035,
  AUDJPY: 0.035,
  NZDJPY: 0.035,
  CADJPY: 0.035,
  CHFJPY: 0.035,
  USDCAD: 0.00027,
  USDCHF: 0.00027,
  EURCAD: 0.00027,
  GBPCAD: 0.00027,
  AUDCAD: 0.00027,
  NZDCAD: 0.00027,
  EURCHF: 0.00027,
  GBPCHF: 0.00027,
  AUDCHF: 0.00027,
  NZDCHF: 0.00027,
  US30: 50,
  US500: 7,
  USTEC: 25,
  UK100: 10,
  DE30: 25,
  FR40: 10,
  EU50: 10,
  JP225: 50,
  AUS200: 10,
  HK50: 50,
  IN50: 30,
  TWIX: 50,
  US2000: 2.5,
  ETHUSD: 8,
  BCHUSD: 2,
  LTCUSD: 1.5,
  XAGUSD: 0.5,
  XPTUSD: 4,
  XPDUSD: 4,
  XCUUSD: 0.05,
  BCO: 0.5,
  NATGAS: 0.02,
  USB10Y: 0.3,
  USB30Y: 0.3,
  UK10YB: 0.3,
  DE10YB: 0.3,
};
const BREAKEVEN_TRIGGER_PCT = 50;
const BREAKEVEN_LOCK_PCT = 20;
const TRAILING_GAP_PCT = 30;
const EMPTY_MT5_STATUS: Mt5Status = {
  state: 'DISCONNECTED',
  connected: false,
  account: null,
  terminal: null,
  positions: [],
  config: null,
  connectedAt: null,
  lastSyncAt: null,
  lastError: null,
};

const CONTRACT_UNITS: Record<string, number> = {
  XAUUSD: 100,
  WTI: 1_000,
  BTCUSD: 1,
  EURUSD: 100_000,
  GBPUSD: 100_000,
  AUDUSD: 100_000,
  NZDUSD: 100_000,
  USDJPY: 100_000,
  EURJPY: 100_000,
  GBPJPY: 100_000,
  AUDJPY: 100_000,
  NZDJPY: 100_000,
  CADJPY: 100_000,
  CHFJPY: 100_000,
  USDCAD: 100_000,
  USDCHF: 100_000,
  EURCAD: 100_000,
  GBPCAD: 100_000,
  AUDCAD: 100_000,
  NZDCAD: 100_000,
  EURCHF: 100_000,
  GBPCHF: 100_000,
  AUDCHF: 100_000,
  NZDCHF: 100_000,
  US30: 1,
  US500: 1,
  USTEC: 1,
  UK100: 1,
  DE30: 1,
  FR40: 1,
  EU50: 1,
  JP225: 1,
  AUS200: 1,
  HK50: 1,
  IN50: 1,
  TWIX: 1,
  US2000: 1,
  ETHUSD: 1,
  BCHUSD: 1,
  LTCUSD: 1,
  XAGUSD: 5_000,
  XPTUSD: 100,
  XPDUSD: 100,
  XCUUSD: 25_000,
  BCO: 1_000,
  NATGAS: 10_000,
  USB10Y: 1,
  USB30Y: 1,
  UK10YB: 1,
  DE10YB: 1,
};

const PIP_SIZE: Record<string, number> = {
  XAUUSD: 0.1,
  WTI: 0.01,
  BTCUSD: 1,
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  AUDUSD: 0.0001,
  NZDUSD: 0.0001,
  USDJPY: 0.01,
  EURJPY: 0.01,
  GBPJPY: 0.01,
  AUDJPY: 0.01,
  NZDJPY: 0.01,
  CADJPY: 0.01,
  CHFJPY: 0.01,
  USDCAD: 0.0001,
  USDCHF: 0.0001,
  EURCAD: 0.0001,
  GBPCAD: 0.0001,
  AUDCAD: 0.0001,
  NZDCAD: 0.0001,
  EURCHF: 0.0001,
  GBPCHF: 0.0001,
  AUDCHF: 0.0001,
  NZDCHF: 0.0001,
  US30: 1,
  US500: 0.1,
  USTEC: 0.1,
  UK100: 0.1,
  DE30: 0.1,
  FR40: 0.1,
  EU50: 0.1,
  JP225: 1,
  AUS200: 1,
  HK50: 1,
  IN50: 1,
  TWIX: 1,
  US2000: 0.1,
  ETHUSD: 0.01,
  BCHUSD: 0.01,
  LTCUSD: 0.01,
  XAGUSD: 0.01,
  XPTUSD: 0.01,
  XPDUSD: 0.01,
  XCUUSD: 0.0001,
  BCO: 0.01,
  NATGAS: 0.001,
  USB10Y: 0.01,
  USB30Y: 0.01,
  UK10YB: 0.01,
  DE10YB: 0.01,
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundLot(value: number): number {
  const stepped = Math.round((value + Number.EPSILON) / LOT_STEP) * LOT_STEP;
  return Math.min(MAX_LOT_SIZE, Math.max(MIN_LOT_SIZE, Number(stepped.toFixed(2))));
}

type QuoteRates = Record<string, number>;

const FALLBACK_QUOTE_RATES: QuoteRates = {
  USDJPY: 150,
  USDCHF: 0.88,
  USDCAD: 1.36,
  USDHKD: 7.8,
  USDSGD: 1.35,
  USDZAR: 18,
  USDTRY: 32,
  USDMXN: 17,
  USDNOK: 10.7,
  USDSEK: 10.5,
  USDPLN: 4,
  USDCZK: 23,
  USDDKK: 6.9,
  USDHUF: 360,
  USDTHB: 36,
  USDCNH: 7.25,
};

const QUOTE_CURRENCIES = [
  'USDT',
  'CNH',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'HKD',
  'SGD',
  'ZAR',
  'TRY',
  'MXN',
  'NOK',
  'SEK',
  'PLN',
  'CZK',
  'DKK',
  'HUF',
  'THB',
  'ILS',
  'BRL',
  'RUB',
  'INR',
];

function quoteCurrency(base: string): string {
  const override = QUOTE_CURRENCY_OVERRIDES[base];
  if (override) return override;
  for (const currency of QUOTE_CURRENCIES) {
    if (base.length > currency.length && base.endsWith(currency)) return currency;
  }
  return 'USD';
}

function quoteRateSymbols(base: string): string[] {
  const quote = quoteCurrency(base);
  if (!quote || quote === 'USD' || quote === 'USDT') return [];
  const direct = `USD${quote}`;
  const inverse = `${quote}USD`;
  const symbols: string[] = [];
  if (SYMBOL_INSTRUMENTS[direct]) symbols.push(direct);
  if (SYMBOL_INSTRUMENTS[inverse]) symbols.push(inverse);
  if (symbols.length === 0) symbols.push(direct);
  return symbols;
}

function quoteRate(symbol: string, rates: QuoteRates): number {
  const quote = quoteCurrency(baseSymbol(symbol));
  if (!quote || quote === 'USD' || quote === 'USDT') return 1;
  const direct = rates[`USD${quote}`];
  if (Number.isFinite(direct) && direct > 0) return direct;
  const inverse = rates[`${quote}USD`];
  if (Number.isFinite(inverse) && inverse > 0) return 1 / inverse;
  return 1;
}

function pipValueUsd(symbol: string, rates: QuoteRates): number {
  const pip = PIP_SIZE[baseSymbol(symbol)] ?? 0.0001;
  const units = CONTRACT_UNITS[baseSymbol(symbol)] ?? 1;
  const rate = quoteRate(symbol, rates);
  return rate > 0 ? (pip * units) / rate : 0;
}

interface EngineStats {
  total: number;
  tp: number;
  sl: number;
  breakeven: number;
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
  count: number,
  fallback?: { broker: Mt5Broker; suffix: string }
): Promise<Kline[] | null> {
  const instrument = toInstrument(symbol);
  if (!instrument) {
    if (!fallback?.broker.isConnected()) return null;
    try {
      const candles = await fallback.broker.fetchCandles(symbol, interval, count);
      return candles.length > 0 ? candles : null;
    } catch {
      return null;
    }
  }
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
  endMs: number,
  fallback?: { broker: Mt5Broker; suffix: string }
): Promise<Kline[]> {
  if (endMs <= startMs) return [];
  const count = Math.ceil((Date.now() - startMs) / 60_000) + 3;
  const batch = await fetchKlines(host, apiKey, symbol, 'M1', count, fallback);
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
    case 'BREAKEVEN_HIT':
      return 'BREAKEVEN HIT (TRAILING STOP)';
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
  private stats: EngineStats = {
    total: 0,
    tp: 0,
    sl: 0,
    breakeven: 0,
    ambiguous: 0,
    expired: 0,
  };
  private executions = new Map<string, SignalExecution>();
  private activePairs: string[] = [];
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
  private lastExecutionError: string | null = null;
  private marketPrices = new Map<string, number>();
  private marketMeta = new Map<string, { changePct: number; quoteVolume: number }>();
  private htfCache = new Map<string, { h1: Kline[]; m30: Kline[]; at: number }>();
  private lastPriceAt: number | null = null;
  private priceSource: 'rest' | null = null;
  private priceLoopActive = false;
  private running = false;
  private targetsSynced = false;
  private scanLoopActive = false;
  private watchLoopActive = false;
  private brokerQueue: Promise<void> = Promise.resolve();
  private instrumentsLoadedAt = 0;
  private instrumentsLoading: Promise<void> | null = null;
  private mt5SymbolsLoadedAt = 0;
  private mt5SymbolsLoading: Promise<void> | null = null;
  private mt5SuffixHint = '';
  private persistedSuffix: string;

  constructor(options: EngineOptions) {
    this.opts = options;
    this.persistedSuffix = normalizeSymbolSuffix(options.persistedSuffix ?? '');
    const requested =
      options.persistedPairs !== undefined
        ? options.persistedPairs
        : options.pairsOverride.length > 0
          ? options.pairsOverride
          : DEFAULT_ACTIVE_PAIRS;
    const normalize = options.persistedPairs !== undefined ? savedPairKey : normalizePairSymbol;
    const seen = new Set<string>();
    for (const value of requested) {
      const base = normalize(value);
      if (!base || seen.has(base)) continue;
      seen.add(base);
      this.activePairs.push(base);
    }
    this.refreshSymbols();
  }

  start(): void {
    if (this.running || !this.opts.enabled) return;
    this.running = true;
    this.startedAt = Date.now();
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    await this.ensurePairsLoaded();
    if (!this.running) return;
    void this.runScanLoop();
    void this.runWatchLoop();
    void this.runPriceLoop();
  }

  stop(): void {
    this.running = false;
  }

  triggerScan(): boolean {
    if (this.scanning || !this.opts.enabled) return false;
    void this.scanOnce();
    return true;
  }

  resetJournal(): void {
    this.signals.clear();
    this.executions.clear();
    this.lastExecutionError = null;
    this.lastTriggerBySymbol.clear();
    this.stats = {
      total: 0,
      tp: 0,
      sl: 0,
      breakeven: 0,
      ambiguous: 0,
      expired: 0,
    };
    this.refreshSymbols();
  }

  private riskBase(): number {
    return this.opts.mt5Broker?.getBalance() ?? DEFAULT_RISK_BALANCE;
  }

  private symbolSuffix(): string {
    const configured = normalizeSymbolSuffix(
      this.opts.mt5Broker?.getStatus().config?.symbolSuffix ?? ''
    );
    if (configured) return configured;
    if (this.persistedSuffix) return this.persistedSuffix;
    return this.mt5SuffixHint;
  }

  setSymbolSuffix(value: unknown): void {
    this.persistedSuffix = normalizeSymbolSuffix(String(value ?? ''));
    this.refreshSymbols();
  }

  async detectAndApplySymbolSuffix(): Promise<string | null> {
    const broker = this.opts.mt5Broker;
    if (!broker?.isConnected()) return null;
    try {
      const symbols = await broker.listSymbols();
      if (symbols.length === 0) return null;
      const suffix = inferMt5Suffix(symbols);
      this.mt5SuffixHint = suffix;
      broker.setSymbolSuffix(suffix);
      this.setSymbolSuffix(suffix);
      return suffix;
    } catch {
      return null;
    }
  }

  private candleFallback(): { broker: Mt5Broker; suffix: string } | undefined {
    return this.opts.mt5Broker
      ? { broker: this.opts.mt5Broker, suffix: this.symbolSuffix() }
      : undefined;
  }

  private async fetchCandles(
    symbol: string,
    interval: Interval,
    count: number
  ): Promise<Kline[] | null> {
    return fetchKlines(
      this.opts.oandaHost,
      this.opts.oandaApiKey,
      symbol,
      interval,
      count,
      this.candleFallback()
    );
  }

  private quoteRates(): QuoteRates {
    const rates: QuoteRates = { ...FALLBACK_QUOTE_RATES };
    for (const [symbol, price] of this.marketPrices) {
      if (price > 0) rates[symbol] = price;
    }
    return rates;
  }

  private riskTargets(symbol: string, balance = this.riskBase()):
    | {
        riskUsd: number;
        rewardUsd: number;
        slDistance: number;
        tpDistance: number;
        lotSize: number;
      }
    | null {
    const base = baseSymbol(symbol);
    const pip = PIP_SIZE[base];
    const slDistance = STOP_LOSS_DISTANCE[base];
    if (!(pip > 0) || !(slDistance > 0)) return null;
    const riskUsd = roundMoney(balance * (RISK_PERCENT / 100));
    if (!(riskUsd > 0)) return null;
    const pipValue = pipValueUsd(symbol, this.quoteRates());
    if (!(pipValue > 0)) return null;
    const slPips = slDistance / pip;
    const lotSize = roundLot(riskUsd / (slPips * pipValue));
    const actualRiskUsd = roundMoney(slPips * pipValue * lotSize);
    const tpDistance = slDistance * REWARD_RISK_RATIO;
    const actualRewardUsd = roundMoney(actualRiskUsd * REWARD_RISK_RATIO);
    return {
      riskUsd,
      rewardUsd: actualRewardUsd,
      slDistance,
      tpDistance,
      lotSize,
    };
  }

  getResponse(): SignalsResponse {
    const now = Date.now();
    const all = [...this.signals.values()];
    const tp = this.stats.tp;
    const sl = this.stats.sl;
    const breakeven = this.stats.breakeven;
    const ambiguous = this.stats.ambiguous;
    const expired = this.stats.expired;
    const open = all.filter((s) => s.status === 'OPEN').length;

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
      breakeven,
      ambiguous,
      expired,
      symbolSource: this.symbolSource,
      lastError: this.lastExecutionError ?? this.lastError,
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
    const marketSymbols = this.symbols;
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

    const mt5Snapshot = this.opts.mt5Broker?.getAccountSnapshot();

    return {
      generatedAt: now,
      status,
      signals: publicSignals,
      nearZones: this.nearZones,
      market,
      account: mt5Snapshot?.account ?? null,
      trades: mt5Snapshot?.trades ?? [],
      mt5: this.opts.mt5Broker?.getStatus() ?? EMPTY_MT5_STATUS,
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
    const symbols = [...new Set([
      ...this.symbols,
      ...[...this.signals.values()]
        .filter((signal) => signal.status === 'OPEN')
        .map((signal) => signal.symbol),
    ])];
    const quoteSymbols = new Set<string>(QUOTE_RATE_SYMBOLS);
    for (const symbol of symbols) {
      for (const rate of quoteRateSymbols(baseSymbol(symbol))) quoteSymbols.add(rate);
    }
    for (const quote of quoteSymbols) {
      if (!symbols.includes(quote)) symbols.push(quote);
    }
    const now = Date.now();
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          if (!toInstrument(symbol) && this.opts.mt5Broker?.isConnected()) {
            const quote = await this.opts.mt5Broker.getQuote(symbol);
            return quote ? { symbol, price: quote.price } : null;
          }
          const candles = await fetchKlines(
            this.opts.oandaHost,
            this.opts.oandaApiKey,
            symbol,
            'S5',
            1,
            this.candleFallback()
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
      const base = baseSymbol(signal.symbol);
      if (!(PIP_SIZE[base] > 0) || !(STOP_LOSS_DISTANCE[base] > 0)) continue;
      const targets = this.riskTargets(signal.symbol);
      if (!targets) continue;
      signal.initialRiskDistance = targets.slDistance;
      const initialStop =
        signal.direction === 'LONG'
          ? signal.entry - targets.slDistance
          : signal.entry + targets.slDistance;
      const trailingStop = signal.breakevenActive
        ? this.trailingStopPrice(signal, targets.tpDistance)
        : initialStop;
      const activeStop = signal.breakevenActive ? signal.stopLoss : initialStop;
      signal.stopLoss =
        signal.direction === 'LONG'
          ? Math.max(initialStop, activeStop, trailingStop)
          : Math.min(initialStop, activeStop, trailingStop);
      signal.takeProfit =
        signal.direction === 'LONG'
          ? signal.entry + targets.tpDistance
          : signal.entry - targets.tpDistance;
      signal.riskPct = Number(((targets.slDistance / signal.entry) * 100).toFixed(3));
      signal.rewardPct = Number(((targets.tpDistance / signal.entry) * 100).toFixed(3));
      signal.roePct = Number((signal.rewardPct * signal.leverage).toFixed(2));
      const execution = this.executions.get(signal.id);
      if (execution && execution.ticket === null) {
        execution.volume = targets.lotSize;
      }
    }
  }

  async ensurePairsLoaded(force = false): Promise<void> {
    const oandaFresh =
      this.instrumentsLoadedAt > 0 &&
      Date.now() - this.instrumentsLoadedAt < 6 * 60 * 60 * 1000;
    if (this.opts.oandaApiKey && (force || !oandaFresh)) {
      if (!this.instrumentsLoading) {
        this.instrumentsLoading = this.loadOandaInstruments().finally(() => {
          this.instrumentsLoading = null;
        });
      }
      await this.instrumentsLoading;
    }

    const broker = this.opts.mt5Broker;
    if (!broker?.isConnected()) return;
    const mt5Fresh =
      this.mt5SymbolsLoadedAt > 0 &&
      Date.now() - this.mt5SymbolsLoadedAt < 10 * 60 * 1000;
    if (!force && mt5Fresh) return;
    if (!this.mt5SymbolsLoading) {
      this.mt5SymbolsLoading = this.loadMt5Symbols().finally(() => {
        this.mt5SymbolsLoading = null;
      });
    }
    await this.mt5SymbolsLoading;
  }

  private async loadMt5Symbols(): Promise<void> {
    const broker = this.opts.mt5Broker;
    if (!broker?.isConnected()) return;
    let symbols: Mt5SymbolInfo[] = [];
    try {
      symbols = await broker.listSymbols();
    } catch {
      return;
    }
    if (symbols.length === 0) return;
    this.mt5SuffixHint = inferMt5Suffix(symbols);
    for (const row of symbols) this.registerMt5Symbol(row);
    this.mt5SymbolsLoadedAt = Date.now();
    this.refreshSymbols();
  }

  private registerMt5Symbol(row: Mt5SymbolInfo): void {
    const rawName = String(row.name ?? '').trim();
    if (!rawName) return;
    let base = baseSymbol(rawName);
    const hint = this.mt5SuffixHint.toLowerCase();
    if (hint && rawName.toLowerCase().endsWith(hint) && rawName.length > hint.length) {
      base = normalizeSymbolBody(rawName.slice(0, rawName.length - hint.length));
    }
    if (!base) return;

    let key = base;
    let instrument = resolveInstrument(base);
    if (!instrument) {
      const canonical = resolveCanonical(base);
      if (PAIR_SET.has(canonical) || resolveInstrument(canonical)) {
        key = canonical;
        instrument = resolveInstrument(canonical);
      }
    }

    if (PAIR_SET.has(key)) {
      addPairAlias(key, rawName);
      addPairAlias(key, row.path);
      if (key === base && row.contractSize > 0) {
        CONTRACT_UNITS[key] = row.contractSize;
      }
      return;
    }

    const category = categoryFromPath(row.path);
    const price = row.mid || row.last || row.bid || row.ask || 0;
    const root = key.replace(/(X10|X100)$/i, '');
    const inheritedStop = STOP_LOSS_DISTANCE[root] ?? STOP_LOSS_DISTANCE[key];
    const percent = STOP_PERCENT_BY_CATEGORY[category] ?? 0.002;
    const fallbackStop = Math.max(Number(row.point) * 500, 0.0001);
    const stopDistance =
      inheritedStop && inheritedStop > 0
        ? inheritedStop
        : price > 0
          ? price * percent
          : fallbackStop;
    const units = row.contractSize > 0 ? row.contractSize : CONTRACT_UNITS[key] ?? 1;

    if (instrument) SYMBOL_INSTRUMENTS[key] = instrument;
    PIP_SIZE[key] = row.point > 0 ? row.point : 0.0001;
    CONTRACT_UNITS[key] = units;
    STOP_LOSS_DISTANCE[key] = stopDistance;
    PAIR_SET.add(key);
    PAIR_CATALOG.push(key);
    PAIR_LABELS[key] = String(row.description || rawName);
    PAIR_CATEGORIES[key] = category;
    PAIR_ALIASES[key] = [rawName, row.path];
    if (/X100$/i.test(key)) {
      addPairAlias(key, key.replace(/X100$/i, '100'));
      addPairAlias(key, `${key.replace(/X100$/i, '')}100M`);
    } else if (/X10$/i.test(key)) {
      addPairAlias(key, key.replace(/X10$/i, '10'));
    }
  }

  private async loadOandaInstruments(): Promise<void> {
    try {
      const accountId = await this.fetchOandaAccountId();
      if (!accountId) return;

      const payload = (await this.fetchOandaWithRetry(
        `${this.opts.oandaHost}/v3/accounts/${encodeURIComponent(accountId)}/instruments`,
        12000,
        3
      )) as { instruments?: Array<Record<string, unknown>> };
      if (!Array.isArray(payload?.instruments) || payload.instruments.length === 0) return;

      let added = 0;
      for (const row of payload.instruments) {
        if (!row || typeof row !== 'object') continue;
        if (String(row.type ?? '') !== 'CURRENCY') continue;
        const name = String(row.name ?? '');
        if (!name) continue;
        const before = PAIR_SET.size;
        registerOandaInstrument(
          name,
          String(row.displayName ?? name),
          row.pipLocation
        );
        if (PAIR_SET.size > before) added += 1;
      }
      this.instrumentsLoadedAt = Date.now();
      if (added > 0) this.refreshSymbols();
    } catch {
      // Keep the built-in catalog when OANDA is temporarily unavailable.
    }
  }

  private async fetchOandaAccountId(): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const accounts = (await fetchOandaJson(
          `${this.opts.oandaHost}/v3/accounts`,
          this.opts.oandaApiKey,
          6000
        )) as { accounts?: Array<{ id?: unknown }> };
        const accountId = accounts?.accounts?.find(
          (account) => typeof account?.id === 'string' && account.id.length > 0
        )?.id;
        if (typeof accountId === 'string' && accountId) return accountId;
      } catch {
        // Retry; OANDA occasionally returns transient gateway errors.
      }
      if (attempt < 2) await sleep(800 * (attempt + 1));
    }
    return null;
  }

  private async fetchOandaWithRetry(
    url: string,
    timeoutMs: number,
    attempts: number
  ): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fetchOandaJson(url, this.opts.oandaApiKey, timeoutMs);
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts - 1) await sleep(800 * (attempt + 1));
    }
    throw lastError instanceof Error ? lastError : new Error('OANDA request failed.');
  }

  refreshSymbols(): void {
    const suffix = this.symbolSuffix();
    setActiveSymbolSuffix(suffix);
    this.symbols = this.activePairs.map((base) => symbolWithSuffix(base, suffix));
    this.symbolSource = 'OANDA';
    this.lastSymbolRefreshAt = Date.now();
  }

  getPairs(): PairsResponse {
    return {
      catalog: PAIR_CATALOG.map((symbol) => ({
        symbol,
        name: PAIR_LABELS[symbol] ?? symbol,
        active: this.activePairs.includes(symbol),
        aliases: PAIR_ALIASES[symbol] ?? [],
        category: PAIR_CATEGORIES[symbol] ?? 'fx',
      })),
      active: [...this.activePairs],
    };
  }

  addPair(value: unknown): PairMutationResult {
    const base = normalizePairSymbol(value);
    if (!base) {
      return {
        ok: false,
        error: 'That pair is not supported.',
        pairs: this.getPairs(),
      };
    }
    if (!this.activePairs.includes(base)) {
      this.activePairs.push(base);
      this.refreshSymbols();
    }
    return { ok: true, pairs: this.getPairs() };
  }

  removePair(value: unknown): PairMutationResult {
    const base = normalizePairSymbol(value) || savedPairKey(value);
    const index = base ? this.activePairs.indexOf(base) : -1;
    if (index === -1) {
      return {
        ok: false,
        error: 'That pair is not active.',
        pairs: this.getPairs(),
      };
    }
    this.activePairs.splice(index, 1);
    this.refreshSymbols();
    return { ok: true, pairs: this.getPairs() };
  }

  private async scanOnce(): Promise<void> {
    if (this.scanning || !this.running) return;
    this.scanning = true;
    this.flushPendingExecutions();
    const started = Date.now();
    try {
      if (this.symbols.length === 0 && this.activePairs.length > 0) {
        this.refreshSymbols();
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
    }
  }

  private async scanPair(symbol: string): Promise<ScanResult> {
    const cached = this.htfCache.get(symbol);
    const now = Date.now();
    const needHtf = !cached || now - cached.at > HTF_CACHE_MS;
    const [m1, m30, h1] = await Promise.all([
      this.fetchCandles(symbol, 'M1', 35),
      needHtf ? this.fetchCandles(symbol, 'M30', 60) : Promise.resolve(cached.m30),
      needHtf ? this.fetchCandles(symbol, 'H1', 60) : Promise.resolve(cached.h1),
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
    const previousVolRatio = m1AvgVol > 0 ? previousCandle.volume / m1AvgVol : 1;
    const startupCutoffMs = Math.ceil(this.startedAt / 60_000) * 60_000;
    const confirmationCandles: Array<[Kline, number]> =
      previousCandle.openTime >= startupCutoffMs ? [[previousCandle, previousVolRatio]] : [];

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
    let triggerRatio = previousVolRatio;
    let triggerCandle = previousCandle;

    for (const zone of demandZones) {
      const upper = zone.bodyTop * (1 + tolerance);
      const lower = zone.bodyBottom * (1 - tolerance * 2);
      for (const [candle, ratio] of confirmationCandles) {
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
        for (const [candle, ratio] of confirmationCandles) {
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
      initialRiskDistance: Math.abs(signal.entry - signal.stopLoss),
      bestPrice: signal.entry,
      breakevenActive: false,
    };

    this.lastTriggerBySymbol.set(signal.symbol, signal.triggerCandleOpen);
    this.signals.set(tracked.id, tracked);
    this.stats.total += 1;
    this.openMt5Execution(tracked);
    this.trimResolvedHistory();
  }

  private openMt5Execution(signal: TrackedSignal): void {
    const broker = this.opts.mt5Broker;
    if (!broker?.isConnected()) return;
    if (this.executions.has(signal.id)) return;
    const targets = this.riskTargets(signal.symbol);
    const execution: SignalExecution = {
      signalId: signal.id,
      symbol: signal.symbol,
      volume: targets?.lotSize ?? MIN_LOT_SIZE,
      offset: 0,
      ticket: null,
      closeRequested: false,
      closing: false,
      error: null,
    };
    this.executions.set(signal.id, execution);
    this.enqueueBroker(() => this.executeMt5Entry(execution));
  }

  private requestExecutionClose(signal: TrackedSignal): void {
    const execution = this.executions.get(signal.id);
    if (!execution) return;
    execution.closeRequested = true;
    this.tryCloseExecution(execution);
  }

  private tryCloseExecution(execution: SignalExecution): void {
    if (!execution.closeRequested || execution.ticket === null || execution.closing) return;
    if (!this.opts.mt5Broker?.isConnected()) return;
    execution.closing = true;
    this.enqueueBroker(() => this.executeMt5Close(execution));
  }

  private flushPendingExecutions(): void {
    if (!this.opts.mt5Broker?.isConnected()) return;
    for (const execution of this.executions.values()) {
      if (execution.closeRequested) this.tryCloseExecution(execution);
    }
  }

  private enqueueBroker(operation: () => Promise<void>): void {
    this.brokerQueue = this.brokerQueue
      .then(operation)
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : 'MT5 execution failed.';
      });
  }

  private async executeMt5Entry(execution: SignalExecution): Promise<void> {
    const broker = this.opts.mt5Broker;
    if (!broker?.isConnected() || execution.ticket !== null) return;
    const signal = this.signals.get(execution.signalId);
    if (!signal) {
      this.executions.delete(execution.signalId);
      return;
    }
    try {
      const quote = await broker.getQuote(signal.symbol);
      if (!quote) {
        throw new Error('MT5 quote unavailable for the broker symbol.');
      }
      execution.offset = quote.price - signal.entry;
      const result = await broker.placeOrder({
        symbol: signal.symbol,
        direction: signal.direction,
        volume: execution.volume,
        sl: signal.stopLoss + execution.offset,
        tp: signal.takeProfit + execution.offset,
      });
      execution.ticket = result.ticket;
      execution.error = null;
      this.lastExecutionError = null;
      this.lastError = null;
      if (execution.closeRequested) this.tryCloseExecution(execution);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MT5 entry failed.';
      execution.error = message;
      this.lastExecutionError = `MT5 ${signal.symbol} entry: ${message}`;
      this.lastError = this.lastExecutionError;
      this.executions.delete(execution.signalId);
    }
  }

  private async executeMt5Close(execution: SignalExecution): Promise<void> {
    const broker = this.opts.mt5Broker;
    const ticket = execution.ticket;
    if (!broker?.isConnected() || ticket === null) {
      execution.closing = false;
      return;
    }
    try {
      const result = await broker.closePosition(ticket);
      this.executions.delete(execution.signalId);
      this.lastError = result.closed ? null : (result.message ?? null);
      this.trimResolvedHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MT5 close failed.';
      execution.error = message;
      execution.closing = false;
      this.lastError = `MT5 ${execution.symbol} close: ${message}`;
    }
  }

  private async executeMt5Modify(
    signal: TrackedSignal,
    execution: SignalExecution
  ): Promise<void> {
    const broker = this.opts.mt5Broker;
    const ticket = execution.ticket;
    if (!broker?.isConnected() || ticket === null) return;
    try {
      const result = await broker.modifyPosition(
        ticket,
        signal.stopLoss + execution.offset,
        signal.takeProfit + execution.offset
      );
      if (result.modified) {
        execution.error = null;
        this.lastError = null;
      } else {
        execution.error = result.message ?? 'MT5 position is no longer open.';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MT5 stop update failed.';
      execution.error = message;
      this.lastError = `MT5 ${signal.symbol} stop update: ${message}`;
    }
  }

  private trimResolvedHistory(): void {
    const resolved = [...this.signals.values()]
      .filter((signal) => signal.status !== 'OPEN' && !this.executions.has(signal.id))
      .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
    const excess = resolved.length - MAX_RESOLVED_HISTORY;
    for (let i = 0; i < excess; i += 1) {
      this.signals.delete(resolved[i].id);
    }
  }

  private async watchOnce(): Promise<void> {
    if (this.watching || !this.running) return;
    this.flushPendingExecutions();
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
        now,
        this.candleFallback()
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
              this.resolveSignal(
                signal,
                this.stopHitStatus(signal),
                signal.stopLoss,
                closed ? candle.closeTime : now
              );
              break;
            }
            this.resolveSignal(signal, 'TP_HIT', signal.takeProfit, closed ? candle.closeTime : now);
            break;
          }

          if (closed) {
            this.updateTrailingStop(signal, candle);
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
      const seconds = await this.fetchCandles(signal.symbol, 'S5', count);
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
            this.resolveSignal(signal, this.stopHitStatus(signal), signal.stopLoss, candle.closeTime);
            break;
          }
          if (hit.tpHit) {
            this.resolveSignal(signal, 'TP_HIT', signal.takeProfit, candle.closeTime);
            break;
          }
          if (candle.closeTime <= now) {
            this.updateTrailingStop(signal, candle);
          }
          signal.livePrice = candle.close;
          signal.liveUpdatedAt = now;
        }
      }
    }
    if (now >= signal.signalMinuteEnd) signal.intraDone = true;
  }

  private applyExtremes(signal: TrackedSignal, candle: Kline): void {
    const risk = signal.initialRiskDistance;
    if (risk <= 0) return;
    const favourable =
      signal.direction === 'LONG' ? candle.high - signal.entry : signal.entry - candle.low;
    const adverse =
      signal.direction === 'LONG' ? signal.entry - candle.low : candle.high - signal.entry;
    signal.mfeR = Math.max(signal.mfeR, favourable / risk);
    signal.maeR = Math.max(signal.maeR, adverse / risk);
  }

  private isBreakevenStop(signal: TrackedSignal): boolean {
    if (!signal.breakevenActive) return false;
    return signal.direction === 'LONG'
      ? signal.stopLoss >= signal.entry
      : signal.stopLoss <= signal.entry;
  }

  private stopHitStatus(signal: TrackedSignal): SignalStatus {
    return this.isBreakevenStop(signal) ? 'BREAKEVEN_HIT' : 'SL_HIT';
  }

  private trailingStopPrice(signal: TrackedSignal, tpDistance: number): number {
    const lock = tpDistance * (BREAKEVEN_LOCK_PCT / 100);
    const gap = tpDistance * (TRAILING_GAP_PCT / 100);
    if (signal.direction === 'LONG') {
      return Math.max(signal.entry + lock, signal.bestPrice - gap);
    }
    return Math.min(signal.entry - lock, signal.bestPrice + gap);
  }

  private updateTrailingStop(signal: TrackedSignal, candle: Kline): void {
    if (signal.status !== 'OPEN') return;
    const tpDistance = Math.abs(signal.takeProfit - signal.entry);
    if (!(tpDistance > 0)) return;

    const favourablePrice = signal.direction === 'LONG' ? candle.high : candle.low;
    signal.bestPrice =
      signal.direction === 'LONG'
        ? Math.max(signal.bestPrice, favourablePrice)
        : Math.min(signal.bestPrice, favourablePrice);

    const progress = Math.abs(signal.bestPrice - signal.entry);
    if (progress < tpDistance * (BREAKEVEN_TRIGGER_PCT / 100)) {
      return;
    }

    const candidate = this.trailingStopPrice(signal, tpDistance);
    const nextStop =
      signal.direction === 'LONG'
        ? Math.max(signal.stopLoss, candidate)
        : Math.min(signal.stopLoss, candidate);

    if (!signal.breakevenActive) {
      signal.breakevenActive = true;
    }
    if (nextStop !== signal.stopLoss) {
      signal.stopLoss = nextStop;
      const execution = this.executions.get(signal.id);
      if (execution && execution.ticket !== null) {
        this.enqueueBroker(() => this.executeMt5Modify(signal, execution));
      }
    }
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
    const seconds = await this.fetchCandles(signal.symbol, 'S5', count);
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
        this.resolveSignal(signal, this.stopHitStatus(signal), signal.stopLoss, second.closeTime);
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
    this.requestExecutionClose(signal);
    if (status === 'TP_HIT') this.stats.tp += 1;
    else if (status === 'SL_HIT') this.stats.sl += 1;
    else if (status === 'BREAKEVEN_HIT') this.stats.breakeven += 1;
    else if (status === 'AMBIGUOUS') this.stats.ambiguous += 1;
    else if (status === 'EXPIRED') this.stats.expired += 1;
    this.trimResolvedHistory();
  }

  private toPublicSignal(signal: TrackedSignal, now: number): LiveSignal {
    const risk = signal.initialRiskDistance;
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
      initialRiskDistance: Number(signal.initialRiskDistance.toPrecision(12)),
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

}

export function createSignalEngineFromEnv(
  mt5Broker: Mt5Broker | null = null,
  persisted: DashboardState = {}
): SignalEngine {
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

  return new SignalEngine({
    enabled: envFlag('SIGNAL_ENGINE_ENABLED', true),
    scanIntervalMs: envNumber('SIGNAL_SCAN_INTERVAL_MS', 25_000),
    watchIntervalMs: envNumber('SIGNAL_WATCH_INTERVAL_MS', 5_000),
    maxTrackHours: envNumber('SIGNAL_MAX_TRACK_HOURS', 24),
    scanConcurrency: Math.round(envNumber('SIGNAL_SCAN_CONCURRENCY', 10)),
    watchConcurrency: Math.round(envNumber('SIGNAL_WATCH_CONCURRENCY', 6)),
    priceIntervalMs: envNumber('SIGNAL_PRICE_INTERVAL_MS', 500),
    leverage: envNumber('SIGNAL_LEVERAGE', 10),
    maxOpenPerSymbol: Math.max(1, Math.round(envNumber('SIGNAL_MAX_OPEN_PER_SYMBOL', 1))),
    reentryCooldownMs: envNumber('SIGNAL_REENTRY_COOLDOWN_MIN', 60) * 60_000,
    pairsOverride,
    persistedPairs: persisted.activePairs,
    persistedSuffix: persisted.mt5SymbolSuffix,
    oandaHost,
    oandaApiKey,
    mt5Broker,
  });
}
