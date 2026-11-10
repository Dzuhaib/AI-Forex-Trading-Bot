export type SignalDirection = 'LONG' | 'SHORT';
export type SignalStatus =
  | 'OPEN'
  | 'TP_HIT'
  | 'SL_HIT'
  | 'BREAKEVEN_HIT'
  | 'AMBIGUOUS'
  | 'EXPIRED';

export interface LiveSignal {
  id: string;
  symbol: string;
  direction: SignalDirection;
  status: SignalStatus;
  verdict: string;
  timeframe: 'H1' | 'M30';
  bodyTop: number;
  bodyBottom: number;
  htfVolRatio: number;
  m1VolRatio: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  initialRiskDistance: number;
  riskPct: number;
  rewardPct: number;
  roePct: number;
  leverage: number;
  signalTime: number;
  signalTimeUtc: string;
  resolvedAt: number | null;
  resolvedAtUtc: string | null;
  resolutionPrice: number | null;
  holdMinutes: number | null;
  mfeR: number;
  maeR: number;
  livePrice: number | null;
  liveUpdatedAt: number | null;
  priceChangePct: number;
  unrealizedR: number;
  progressPct: number;
  distanceToTpPct: number;
  distanceToSlPct: number;
  reason: string;
}

export interface NearZone {
  symbol: string;
  timeframe: 'H1' | 'M30';
  type: 'DEMAND' | 'SUPPLY';
  bodyTop: number;
  bodyBottom: number;
  distancePct: number;
  volRatio: number;
}

export interface MarketTicker {
  symbol: string;
  price: number;
  changePct24h: number | null;
  quoteVolume24h: number | null;
  updatedAt: number;
}

export interface PairOption {
  symbol: string;
  name: string;
  active: boolean;
  aliases?: string[];
  category?: string;
}

export interface PairsResponse {
  catalog: PairOption[];
  active: string[];
}

export interface PairMutationResult {
  ok: boolean;
  error?: string;
  pairs: PairsResponse;
}

export type Mt5TradeStatus = 'OPEN' | 'CLOSED';

export interface Mt5Trade {
  id: string;
  signalId: string;
  symbol: string;
  direction: SignalDirection;
  lotSize: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  openedAtUtc: string;
  closedAt: number | null;
  closedAtUtc: string | null;
  exitPrice: number | null;
  status: Mt5TradeStatus;
  outcome: SignalStatus | null;
  pnl: number;
  unrealizedPnl: number;
  balanceAfter: number | null;
  mt5Ticket: number | null;
  mt5Symbol: string | null;
  mt5Volume: number | null;
  executedAt: number | null;
  executionError: string | null;
}

export type Mt5ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export interface Mt5Account {
  login: number;
  name: string;
  server: string;
  company: string;
  currency: string;
  balance: number;
  equity: number;
  profit: number;
  margin: number;
  marginFree: number;
  marginLevel: number | null;
  leverage: number;
  tradeMode: number;
  isDemo: boolean;
  tradeAllowed: boolean;
  tradeExpert: boolean;
  credit: number;
}

export interface Mt5Terminal {
  connected: boolean;
  tradeAllowed: boolean;
  path: string;
  name: string;
  company: string;
  build: number;
}

export interface Mt5Position {
  ticket: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  magic: number;
  comment: string;
  time: number;
}

export interface Mt5ConfigSummary {
  login: number;
  server: string;
  terminalPath: string;
  symbolSuffix: string;
}

export interface Mt5Status {
  state: Mt5ConnectionState;
  connected: boolean;
  account: Mt5Account | null;
  terminal: Mt5Terminal | null;
  positions: Mt5Position[];
  config: Mt5ConfigSummary | null;
  connectedAt: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface DailyPnlEntry {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
}

export interface AccountSummary {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  realizedPnlToday: number;
  realizedPnlWeek: number;
  realizedPnlMonth: number;
  closedTradesToday: number;
  closedTradesWeek: number;
  closedTradesMonth: number;
  openTrades: number;
  closedTrades: number;
  riskPercent: number;
  currency: string;
  dailyPnl: DailyPnlEntry[];
  historyFull: boolean;
  historySyncedAt: number | null;
}

export interface Mt5AccountMeta {
  login: number;
  server: string;
  name: string;
  company: string;
  currency: string;
}

export interface SignalEngineStatus {
  running: boolean;
  startedAt: number;
  lastScanAt: number | null;
  lastWatchAt: number | null;
  lastScanDurationMs: number;
  scanning: boolean;
  watching: boolean;
  scannedPairs: number;
  totalPairs: number;
  scanIntervalMs: number;
  watchIntervalMs: number;
  priceIntervalMs: number;
  lastPriceAt: number | null;
  priceSource: 'websocket' | 'rest' | null;
  openSignals: number;
  totalSignals: number;
  tp: number;
  sl: number;
  breakeven: number;
  ambiguous: number;
  expired: number;
  symbolSource: string;
  lastError: string | null;
}

export interface SignalsResponse {
  generatedAt: number;
  status: SignalEngineStatus;
  signals: LiveSignal[];
  nearZones: NearZone[];
  market: MarketTicker[];
  account: AccountSummary | null;
  riskPercent: number;
  trades: Mt5Trade[];
  mt5: Mt5Status;
}
