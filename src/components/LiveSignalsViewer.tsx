import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Crosshair,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  LiveSignal,
  MarketTicker,
  NearZone,
  SignalEngineStatus,
  SignalsResponse,
  SignalStatus,
} from '../types';
import { MiniTugOfWar } from './MiniTugOfWar';

type SignalFilter = 'ALL' | 'OPEN' | 'TP' | 'SL' | 'OTHER';

const STATUS_META: Record<SignalStatus, { label: string; text: string; dot: string }> = {
  OPEN: { label: 'Live', text: 'text-[#0071e3]', dot: 'bg-[#0071e3]' },
  TP_HIT: { label: 'TP hit', text: 'text-[#1d8f3a]', dot: 'bg-[#34c759]' },
  SL_HIT: { label: 'SL hit', text: 'text-[#d70015]', dot: 'bg-[#ff3b30]' },
  AMBIGUOUS: { label: 'Ambiguous', text: 'text-[#a05a00]', dot: 'bg-[#ff9f0a]' },
  EXPIRED: { label: 'Expired', text: 'text-[#86868b]', dot: 'bg-[#aeaeb2]' },
};

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatNotional(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function timeAgo(ms: number | null, now: number): string {
  if (!ms) return 'waiting';
  const diff = Math.max(0, now - ms);
  if (diff < 1000) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function formatHold(minutes: number | null): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function formatClock(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function directionClass(direction: 'LONG' | 'SHORT'): string {
  return direction === 'LONG' ? 'text-[#1d8f3a]' : 'text-[#d70015]';
}

function signalR(signal: LiveSignal): number {
  if (signal.status === 'OPEN') return signal.unrealizedR;
  const risk = Math.abs(signal.entry - signal.stopLoss);
  if (!risk) return 0;
  const direction = signal.direction === 'LONG' ? 1 : -1;
  const exit = signal.resolutionPrice ?? signal.livePrice ?? signal.entry;
  return ((exit - signal.entry) * direction) / risk;
}

function StatusBadge({ status }: { status: SignalStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function StatCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#86868b] sm:text-[11px]">
          {label}
        </span>
        {icon && <span className="text-[#aeaeb2]">{icon}</span>}
      </div>
      <div
        className={`mt-2.5 text-[22px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[28px] ${
          accent ?? 'text-[#1d1d1f]'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function RangeBar({ signal }: { signal: LiveSignal }) {
  return (
    <div className="mt-3">
      <MiniTugOfWar signal={signal} />
      <div className="mt-2 flex items-center justify-between text-[10px] tabular-nums sm:text-[11px]">
        <span className="text-[#d70015]">SL {formatPrice(signal.stopLoss)}</span>
        <span className="text-[#86868b]">Entry {formatPrice(signal.entry)}</span>
        <span className="text-[#1d8f3a]">TP {formatPrice(signal.takeProfit)}</span>
      </div>
    </div>
  );
}

function SignalCard({ signal, now }: { signal: LiveSignal; now: number }) {
  const isLong = signal.direction === 'LONG';
  const isOpen = signal.status === 'OPEN';
  const live = signal.livePrice ?? signal.entry;
  const liveMove = isLong ? live - signal.entry : signal.entry - live;
  const livePositive = liveMove >= 0;
  const resolvedPrice = signal.resolutionPrice ?? live;
  const resultR = signalR(signal);

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
              {signal.symbol}
            </span>
            <span className="text-[10px] text-[#86868b]">{signal.timeframe}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${directionClass(
                signal.direction
              )}`}
            >
              {isLong ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {isLong ? 'Long' : 'Short'}
            </span>
            <span className="text-[11px] text-[#86868b]">
              {signal.htfVolRatio.toFixed(1)}x / {signal.m1VolRatio.toFixed(1)}x
            </span>
          </div>
        </div>
        <StatusBadge status={signal.status} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-[#86868b]">{isOpen ? 'Live price' : 'Exit price'}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[#1d1d1f] sm:text-[30px]">
              ${formatPrice(isOpen ? live : resolvedPrice)}
            </span>
            {isOpen && (
              <span
                className={`text-[12px] font-medium tabular-nums ${
                  livePositive ? 'text-[#1d8f3a]' : 'text-[#d70015]'
                }`}
              >
                {formatPct(signal.priceChangePct)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-[#86868b]">{isOpen ? 'Open' : 'Result'}</div>
          <div
            className={`mt-1 text-[16px] font-semibold tabular-nums ${
              resultR > 0
                ? 'text-[#1d8f3a]'
                : resultR < 0
                  ? 'text-[#d70015]'
                  : 'text-[#1d1d1f]'
            }`}
          >
            {formatSigned(resultR)}R
          </div>
        </div>
      </div>

      <RangeBar signal={signal} />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[#f5f5f7] px-2.5 py-2.5 sm:px-3">
          <div className="text-[10px] text-[#86868b]">Stop</div>
          <div className="mt-0.5 text-[11px] font-medium tabular-nums text-[#d70015] sm:text-[12px]">
            ${formatPrice(signal.stopLoss)}
          </div>
        </div>
        <div className="rounded-xl bg-[#f5f5f7] px-2.5 py-2.5 sm:px-3">
          <div className="text-[10px] text-[#86868b]">Entry</div>
          <div className="mt-0.5 text-[11px] font-medium tabular-nums text-[#1d1d1f] sm:text-[12px]">
            ${formatPrice(signal.entry)}
          </div>
        </div>
        <div className="rounded-xl bg-[#f5f5f7] px-2.5 py-2.5 sm:px-3">
          <div className="text-[10px] text-[#86868b]">Target</div>
          <div className="mt-0.5 text-[11px] font-medium tabular-nums text-[#1d8f3a] sm:text-[12px]">
            ${formatPrice(signal.takeProfit)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3 text-[10px] text-[#86868b] sm:text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          {formatSigned(signal.mfeR)}R / {signal.maeR.toFixed(2)}R
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          {isOpen ? timeAgo(signal.signalTime, now) : formatHold(signal.holdMinutes)}
        </span>
      </div>
    </div>
  );
}

function SignalHistoryCards({ signals, now }: { signals: LiveSignal[]; now: number }) {
  if (signals.length === 0) {
    return (
      <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-10 text-center text-[12px] text-[#86868b]">
        No signals match this filter.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {signals.map((signal) => {
        const isLong = signal.direction === 'LONG';
        const isOpen = signal.status === 'OPEN';
        const resultR = signalR(signal);
        const live = signal.livePrice ?? signal.resolutionPrice ?? signal.entry;

        return (
          <div key={signal.id} className="rounded-2xl border border-black/[0.06] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[#1d1d1f]">{signal.symbol}</span>
                  <span className="text-[10px] text-[#86868b]">{signal.timeframe}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[#86868b]">
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${directionClass(
                      signal.direction
                    )}`}
                  >
                    {isLong ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {isLong ? 'Long' : 'Short'}
                  </span>
                  <span>·</span>
                  <span>{formatClock(signal.signalTime)}</span>
                </div>
              </div>
              <div className="text-right">
                <StatusBadge status={signal.status} />
                <div
                  className={`mt-1 text-[14px] font-semibold tabular-nums ${
                    resultR > 0
                      ? 'text-[#1d8f3a]'
                      : resultR < 0
                        ? 'text-[#d70015]'
                        : 'text-[#6e6e73]'
                  }`}
                >
                  {formatSigned(resultR)}R
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-[11px]">
              <div>
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">Entry</div>
                <div className="mt-0.5 font-medium tabular-nums text-[#1d1d1f]">
                  ${formatPrice(signal.entry)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">SL</div>
                <div className="mt-0.5 font-medium tabular-nums text-[#d70015]">
                  ${formatPrice(signal.stopLoss)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">TP</div>
                <div className="mt-0.5 font-medium tabular-nums text-[#1d8f3a]">
                  ${formatPrice(signal.takeProfit)}
                </div>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between text-[10px] text-[#86868b]">
              <span>{isOpen ? `Live $${formatPrice(live)}` : `Exit $${formatPrice(live)}`}</span>
              <span>{isOpen ? timeAgo(signal.signalTime, now) : formatHold(signal.holdMinutes)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MarketTile({ ticker }: { ticker: MarketTicker }) {
  const change = ticker.changePct24h;
  const positive = (change ?? 0) >= 0;

  return (
    <div className="rounded-xl bg-[#f5f5f7] px-3 py-3">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[12px] font-semibold text-[#1d1d1f]">{ticker.symbol}</span>
        <span
          className={`text-[11px] font-medium tabular-nums ${
            positive ? 'text-[#1d8f3a]' : 'text-[#d70015]'
          }`}
        >
          {formatPct(change)}
        </span>
      </div>
      <div className="mt-1 text-[14px] font-semibold tabular-nums text-[#1d1d1f] sm:text-[15px]">
        ${formatPrice(ticker.price)}
      </div>
      <div className="mt-0.5 text-[10px] text-[#86868b]">
        {formatNotional(ticker.quoteVolume24h)} 24h
      </div>
    </div>
  );
}

function NearZoneCard({ zone }: { zone: NearZone }) {
  const isDemand = zone.type === 'DEMAND';
  return (
    <div className="flex min-w-[190px] flex-col rounded-xl border border-black/[0.06] bg-white px-4 py-3 sm:min-w-[200px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[#1d1d1f]">{zone.symbol}</span>
        <span className="text-[10px] text-[#86868b]">{zone.timeframe}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${
            isDemand ? 'text-[#1d8f3a]' : 'text-[#d70015]'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${isDemand ? 'bg-[#34c759]' : 'bg-[#ff3b30]'}`}
          />
          {zone.type === 'DEMAND' ? 'Demand' : 'Supply'}
        </span>
        <span className="text-[10px] font-medium tabular-nums text-[#86868b]">
          {zone.distancePct.toFixed(2)}%
        </span>
      </div>
      <div className="mt-1.5 text-[10px] tabular-nums text-[#86868b]">
        ${formatPrice(zone.bodyBottom)} – ${formatPrice(zone.bodyTop)}
      </div>
    </div>
  );
}

function StatusPanel({ status, now }: { status: SignalEngineStatus; now: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-black/[0.06] bg-white px-4 py-3 text-[11px] text-[#6e6e73] sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 sm:px-5 sm:py-3.5">
      <span
        className={`inline-flex items-center gap-1.5 font-medium ${
          status.running ? 'text-[#1d8f3a]' : 'text-[#d70015]'
        }`}
      >
        {status.running ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        {status.running ? 'Online' : 'Offline'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-[#86868b]" />
        {status.scannedPairs}/{status.totalPairs} pairs
      </span>
      <span className="inline-flex items-center gap-1.5">
        <RefreshCw
          className={`h-3.5 w-3.5 text-[#86868b] ${status.scanning ? 'animate-spin' : ''}`}
        />
        {timeAgo(status.lastScanAt, now)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Crosshair className="h-3.5 w-3.5 text-[#86868b]" />
        {status.watching ? 'watching' : timeAgo(status.lastWatchAt, now)}
      </span>
      <span className="hidden items-center gap-1.5 sm:inline-flex">
        <Zap className="h-3.5 w-3.5 text-[#86868b]" />
        prices {timeAgo(status.lastPriceAt, now)}
      </span>
    </div>
  );
}

export const LiveSignalsViewer: React.FC = () => {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SignalFilter>('ALL');
  const [scanBusy, setScanBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/signals', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as SignalsResponse;
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach the signal engine');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  const triggerScan = async () => {
    setScanBusy(true);
    try {
      await fetch('/api/signals/scan', { method: 'POST' });
      await load();
    } catch {
      setError('Could not trigger a manual scan');
    } finally {
      window.setTimeout(() => setScanBusy(false), 1500);
    }
  };

  const status = data?.status;
  const signals = data?.signals ?? [];
  const nearZones = data?.nearZones ?? [];
  const market = data?.market ?? [];
  const openSignals = useMemo(() => signals.filter((signal) => signal.status === 'OPEN'), [signals]);

  const filteredSignals = useMemo(() => {
    if (filter === 'ALL') return signals;
    if (filter === 'OPEN') return signals.filter((signal) => signal.status === 'OPEN');
    if (filter === 'TP') return signals.filter((signal) => signal.status === 'TP_HIT');
    if (filter === 'SL') return signals.filter((signal) => signal.status === 'SL_HIT');
    return signals.filter((signal) => !['OPEN', 'TP_HIT', 'SL_HIT'].includes(signal.status));
  }, [filter, signals]);

  const tapeTotals = useMemo(
    () => ({
      total: signals.length,
      tp: signals.filter((signal) => signal.status === 'TP_HIT').length,
      sl: signals.filter((signal) => signal.status === 'SL_HIT').length,
      open: signals.filter((signal) => signal.status === 'OPEN').length,
      ambiguous: signals.filter((signal) => signal.status === 'AMBIGUOUS').length,
      expired: signals.filter((signal) => signal.status === 'EXPIRED').length,
    }),
    [signals]
  );

  const engineTotals = useMemo(
    () =>
      status
        ? {
            total: status.totalSignals,
            tp: status.tp,
            sl: status.sl,
            open: status.openSignals,
            ambiguous: status.ambiguous,
            expired: status.expired,
          }
        : tapeTotals,
    [status, tapeTotals]
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[#1d1d1f] sm:text-[34px]">
            Live Signals
          </h1>
          <p className="mt-1.5 text-[13px] leading-5 text-[#6e6e73]">
            Forex and CFD signals. 5% balance risk · 40p SL · 80p TP.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            onClick={() => void load()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-[#1d1d1f] ring-1 ring-inset ring-black/10 active:opacity-70 sm:h-9"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            onClick={() => void triggerScan()}
            disabled={scanBusy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50 sm:h-9"
          >
            <Crosshair className={`h-3.5 w-3.5 ${scanBusy ? 'animate-pulse' : ''}`} />
            {scanBusy ? 'Scanning' : 'Scan'}
          </button>
        </div>
      </div>

      {status && <StatusPanel status={status} now={now} />}

      {data?.account && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
                Account
              </h2>
              <span className="text-[11px] text-[#86868b]">
                {data.account.riskPercent}% risk · {data.account.stopPips}p SL
              </span>
            </div>
            <span className="text-[11px] text-[#86868b]">
              {data.account.openTrades} open · {data.account.closedTrades} closed
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
            <StatCard
              label="Balance"
              value={formatMoney(data.account.balance)}
              icon={<Wallet className="h-4 w-4" strokeWidth={1.7} />}
            />
            <StatCard
              label="Equity"
              value={formatMoney(data.account.equity)}
              icon={<Activity className="h-4 w-4" strokeWidth={1.7} />}
            />
            <StatCard
              label="Open P&L"
              value={formatMoney(data.account.unrealizedPnl)}
              accent={data.account.unrealizedPnl >= 0 ? 'text-[#1d8f3a]' : 'text-[#d70015]'}
              icon={<TrendingUp className="h-4 w-4" strokeWidth={1.7} />}
            />
            <StatCard
              label="Realized P&L"
              value={formatMoney(data.account.realizedPnl)}
              accent={data.account.realizedPnl >= 0 ? 'text-[#1d8f3a]' : 'text-[#d70015]'}
              icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
            />
          </div>
        </section>
      )}

      {(error || status?.lastError) && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-[#fff8eb] px-4 py-3.5 text-[12px] text-[#8a5300] ring-1 ring-inset ring-[#ff9f0a]/25 sm:px-5 sm:py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <div className="font-medium">{error ? 'Connection issue' : 'Engine warning'}</div>
            <div className="mt-0.5 text-[#8a5300]/80">{error ?? status?.lastError}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <StatCard
          label="Open"
          value={loading ? '—' : engineTotals.open}
          icon={<Activity className="h-4 w-4" strokeWidth={1.7} />}
        />
        <StatCard
          label="TP"
          value={loading ? '—' : engineTotals.tp}
          accent={engineTotals.tp > 0 ? 'text-[#1d8f3a]' : undefined}
          icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
        />
        <StatCard
          label="SL"
          value={loading ? '—' : engineTotals.sl}
          accent={engineTotals.sl > 0 ? 'text-[#d70015]' : undefined}
          icon={<XCircle className="h-4 w-4" strokeWidth={1.7} />}
        />
        <StatCard
          label="Win rate"
          value={loading ? '—' : `${status?.winRatePct?.toFixed(1) ?? '0.0'}%`}
          icon={<TrendingUp className="h-4 w-4" strokeWidth={1.7} />}
        />
        <StatCard
          label="Ambiguous"
          value={loading ? '—' : engineTotals.ambiguous}
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.7} />}
        />
        <StatCard
          label="Expired"
          value={loading ? '—' : engineTotals.expired}
          icon={<Clock className="h-4 w-4" strokeWidth={1.7} />}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
              Market
            </h2>
            <span className="text-[11px] text-[#86868b]">{market.length}</span>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] ${
              status?.priceSource === 'rest'
                ? 'text-[#a05a00]'
                : status?.priceSource
                  ? 'text-[#1d8f3a]'
                  : 'text-[#86868b]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status?.priceSource === 'rest'
                  ? 'bg-[#ff9f0a]'
                  : status?.priceSource
                    ? 'bg-[#34c759]'
                    : 'bg-[#aeaeb2]'
              }`}
            />
            {status?.priceSource === 'rest' ? 'Polling' : status?.priceSource ? 'Live' : 'Connecting'}
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white p-2.5 sm:max-h-72 sm:p-3">
          {market.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {market.map((ticker) => (
                <MarketTile key={ticker.symbol} ticker={ticker} />
              ))}
            </div>
          ) : (
            <div className="px-3 py-10 text-center text-[12px] text-[#86868b]">
              Waiting for prices.
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
              Open positions
            </h2>
            <span className="text-[11px] text-[#86868b]">{openSignals.length}</span>
          </div>
        </div>

        {openSignals.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3 xl:grid-cols-3">
            {openSignals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} now={now} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-4 py-12 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f7]">
              <Crosshair className="h-5 w-5 text-[#86868b]" strokeWidth={1.7} />
            </span>
            <div className="text-[13px] font-medium text-[#1d1d1f]">
              {loading ? 'Connecting' : 'Scanning for setups'}
            </div>
            <div className="text-[11px] text-[#86868b]">
              New signals appear here automatically.
            </div>
          </div>
        )}
      </section>

      {nearZones.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
              Approaching zones
            </h2>
            <span className="text-[11px] text-[#86868b]">{nearZones.length}</span>
          </div>
          <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
            {nearZones.map((zone) => (
              <NearZoneCard
                key={`${zone.symbol}-${zone.timeframe}-${zone.type}-${zone.bodyTop}`}
                zone={zone}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
            History
          </h2>
          <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-full bg-[#e8e8ed] p-1">
            {(
              [
                ['ALL', `All ${tapeTotals.total}`],
                ['OPEN', `Open ${tapeTotals.open}`],
                ['TP', `TP ${tapeTotals.tp}`],
                ['SL', `SL ${tapeTotals.sl}`],
                ['OTHER', `Other ${tapeTotals.ambiguous + tapeTotals.expired}`],
              ] as Array<[SignalFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] ${
                  filter === value
                    ? 'bg-white font-semibold text-[#1d1d1f]'
                    : 'font-medium text-[#6e6e73]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="md:hidden">
          <SignalHistoryCards signals={filteredSignals} now={now} />
        </div>

        <div className="hidden overflow-hidden rounded-2xl border border-black/[0.06] bg-white md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-black/[0.06] text-left text-[12px]">
              <thead className="bg-[#fafafa] text-[10px] uppercase tracking-[0.06em] text-[#86868b]">
                <tr>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Side</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Entry</th>
                  <th className="px-4 py-3 text-right font-medium">SL</th>
                  <th className="px-4 py-3 text-right font-medium">TP</th>
                  <th className="px-4 py-3 text-right font-medium">Live / exit</th>
                  <th className="px-4 py-3 text-right font-medium">R</th>
                  <th className="px-4 py-3 text-right font-medium">MFE / MAE</th>
                  <th className="px-4 py-3 text-right font-medium">Hold</th>
                  <th className="px-4 py-3 text-right font-medium">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {filteredSignals.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-[12px] text-[#86868b]">
                      No signals match this filter.
                    </td>
                  </tr>
                )}
                {filteredSignals.map((signal) => {
                  const isLong = signal.direction === 'LONG';
                  const isOpen = signal.status === 'OPEN';
                  const resultR = signalR(signal);
                  return (
                    <tr key={signal.id}>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-semibold text-[#1d1d1f]">{signal.symbol}</div>
                        <div className="mt-0.5 text-[10px] text-[#86868b]">
                          {signal.timeframe} · {signal.htfVolRatio.toFixed(1)}x · M1{' '}
                          {signal.m1VolRatio.toFixed(1)}x
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${directionClass(
                            signal.direction
                          )}`}
                        >
                          {isLong ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          {isLong ? 'Long' : 'Short'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={signal.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#1d1d1f]">
                        ${formatPrice(signal.entry)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#d70015]">
                        ${formatPrice(signal.stopLoss)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#1d8f3a]">
                        ${formatPrice(signal.takeProfit)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        <span className={isOpen ? 'text-[#0071e3]' : 'text-[#1d1d1f]'}>
                          ${formatPrice(signal.livePrice ?? signal.resolutionPrice)}
                        </span>
                        {isOpen && (
                          <span
                            className={`ml-1 text-[10px] ${
                              signal.priceChangePct >= 0 ? 'text-[#1d8f3a]' : 'text-[#d70015]'
                            }`}
                          >
                            {formatPct(signal.priceChangePct)}
                          </span>
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${
                          resultR > 0
                            ? 'text-[#1d8f3a]'
                            : resultR < 0
                              ? 'text-[#d70015]'
                              : 'text-[#6e6e73]'
                        }`}
                      >
                        {formatSigned(resultR)}R
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#6e6e73]">
                        {formatSigned(signal.mfeR)}R / {signal.maeR.toFixed(2)}R
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#6e6e73]">
                        {isOpen ? timeAgo(signal.signalTime, now) : formatHold(signal.holdMinutes)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-[10px] tabular-nums text-[#86868b]">
                        <div>{formatClock(signal.signalTime)}</div>
                        <div>{new Date(signal.signalTime).toLocaleDateString()}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
};
