export type SignalDirection = 'LONG' | 'SHORT';
export type SignalStatus = 'OPEN' | 'TP_HIT' | 'SL_HIT' | 'AMBIGUOUS' | 'EXPIRED';

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

export type DummyTradeStatus = 'OPEN' | 'CLOSED';

export interface DummyTrade {
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
  status: DummyTradeStatus;
  outcome: SignalStatus | null;
  pnl: number;
  unrealizedPnl: number;
  balanceAfter: number | null;
}

export interface AccountSummary {
  startingBalance: number;
  balance: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  withdrawnTotal: number;
  openTrades: number;
  closedTrades: number;
  riskPercent: number;
  stopPips: number;
  takeProfitPips: number;
  currency: string;
}

export type WithdrawalMethod = 'JAZZCASH' | 'EASYPAISA';

export interface Withdrawal {
  id: string;
  method: WithdrawalMethod;
  accountNumber: string;
  accountTitle: string;
  amount: number;
  status: 'PAID';
  reference: string;
  requestedAt: number;
  requestedAtUtc: string;
  balanceAfter: number;
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
  ambiguous: number;
  expired: number;
  winRatePct: number;
  symbolSource: string;
  lastError: string | null;
}

export interface SignalsResponse {
  generatedAt: number;
  status: SignalEngineStatus;
  signals: LiveSignal[];
  nearZones: NearZone[];
  market: MarketTicker[];
  account: AccountSummary;
  trades: DummyTrade[];
  withdrawals: Withdrawal[];
}
