import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { AccountSummary, Mt5Trade, SignalsResponse } from '../types';
import { BearIcon, BullIcon } from './MarketBeasts';
import { Mt5AccountPanel } from './Mt5AccountPanel';

const HISTORY_PAGE_SIZE = 10;

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function accountMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '—';
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(5);
  return value.toFixed(6);
}

function pnlClass(value: number): string {
  if (value > 0) return 'text-[#1d8f3a]';
  if (value < 0) return 'text-[#d70015]';
  return 'text-[#6e6e73]';
}

function pnlTintStyle(value: number): React.CSSProperties {
  if (!Number.isFinite(value) || value === 0) return {};
  const positive = value > 0;
  const magnitude = Math.min(1, Math.abs(value) / 60);
  const alpha = 0.05 + magnitude * 0.22;
  const accent = 0.25 + magnitude * 0.45;
  const rgb = positive ? '52, 199, 89' : '255, 59, 48';
  return {
    backgroundImage: `linear-gradient(90deg, rgba(${rgb}, ${alpha}) 0%, rgba(${rgb}, ${
      alpha * 0.2
    }) 100%)`,
    borderColor: `rgba(${rgb}, ${accent})`,
    boxShadow: `inset 3px 0 0 rgba(${rgb}, ${accent})`,
    transition: 'background-image 400ms ease, border-color 400ms ease, box-shadow 400ms ease',
  };
}

function clock(ms: number | null): string {
  if (!ms) return '—';
  const date = new Date(ms);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;
}

function duration(from: number, to: number | null, now: number): string {
  const end = to ?? now;
  const minutes = Math.max(0, (end - from) / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${Math.round(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function AccountCard({
  label,
  value,
  accent,
  icon,
  style,
}: {
  label: string;
  value: string;
  accent: string;
  icon: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#86868b] sm:text-[11px]">
          {label}
        </span>
        <span className="text-[#aeaeb2]">{icon}</span>
      </div>
      <div
        className={`mt-2.5 text-[22px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[24px] ${accent}`}
      >
        {value}
      </div>
    </div>
  );
}

function OutcomeBadge({ trade }: { trade: Mt5Trade }) {
  if (trade.status === 'OPEN') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0071e3]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#0071e3]" />
        Open
      </span>
    );
  }
  if (!trade.outcome) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#86868b]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#aeaeb2]" />
        Closed
      </span>
    );
  }
  const outcome = trade.outcome;
  const meta =
    outcome === 'TP_HIT'
      ? { label: 'TP hit', text: 'text-[#1d8f3a]', dot: 'bg-[#34c759]' }
      : outcome === 'SL_HIT'
        ? { label: 'SL hit', text: 'text-[#d70015]', dot: 'bg-[#ff3b30]' }
        : outcome === 'BREAKEVEN_HIT'
          ? { label: 'Breakeven hit', text: 'text-[#6e56cf]', dot: 'bg-[#af52de]' }
          : outcome === 'AMBIGUOUS'
            ? { label: 'Ambiguous', text: 'text-[#a05a00]', dot: 'bg-[#ff9f0a]' }
            : { label: 'Expired', text: 'text-[#86868b]', dot: 'bg-[#aeaeb2]' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function TradeTable({
  trades,
  now,
  empty,
  showClose,
}: {
  trades: Mt5Trade[];
  now: number;
  empty: string;
  showClose: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-black/[0.06] text-left text-[12px]">
          <thead className="bg-[#fafafa] text-[10px] uppercase tracking-[0.06em] text-[#86868b]">
            <tr>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 text-right font-medium">Lots</th>
              <th className="px-4 py-3 text-right font-medium">Entry</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  <BearIcon size={12} />
                  SL
                </span>
              </th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  <BullIcon size={12} />
                  TP
                </span>
              </th>
              <th className="px-4 py-3 text-right font-medium">Exit</th>
              <th className="px-4 py-3 text-right font-medium">P&amp;L</th>
              <th className="px-4 py-3 text-right font-medium">
                {showClose ? 'Balance' : 'Duration'}
              </th>
              <th className="px-4 py-3 font-medium">Outcome</th>
              <th className="px-4 py-3 text-right font-medium">Opened</th>
              {showClose && <th className="px-4 py-3 text-right font-medium">Closed</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.05]">
            {trades.length === 0 && (
              <tr>
                <td
                  colSpan={showClose ? 12 : 11}
                  className="px-4 py-10 text-center text-[12px] text-[#86868b]"
                >
                  {empty}
                </td>
              </tr>
            )}
            {trades.map((trade) => {
              const isLong = trade.direction === 'LONG';
              const displayPnl = trade.status === 'OPEN' ? trade.unrealizedPnl : trade.pnl;
              return (
                <tr
                  key={trade.id}
                  style={trade.status === 'OPEN' ? pnlTintStyle(displayPnl) : undefined}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="font-semibold text-[#1d1d1f]">{trade.symbol}</div>
                    {trade.mt5Ticket !== null ? (
                      <div className="mt-0.5 text-[9px] font-normal text-[#86868b]">
                        MT5 #{trade.mt5Ticket}
                      </div>
                    ) : trade.executionError ? (
                      <div className="mt-0.5 max-w-[150px] truncate text-[9px] font-normal text-[#d70015]">
                        MT5 failed
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        isLong ? 'text-[#1d8f3a]' : 'text-[#d70015]'
                      }`}
                    >
                      {isLong ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {isLong ? 'Long' : 'Short'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#6e6e73]">
                    {trade.lotSize.toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#1d1d1f]">
                    {price(trade.entryPrice)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#d70015]">
                    {price(trade.stopLoss)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#1d8f3a]">
                    {price(trade.takeProfit)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#1d1d1f]">
                    {trade.exitPrice === null ? 'Live' : price(trade.exitPrice)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${pnlClass(
                      displayPnl
                    )}`}
                  >
                    {money(displayPnl)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#6e6e73]">
                    {showClose
                      ? trade.balanceAfter === null
                        ? '—'
                        : money(trade.balanceAfter)
                      : duration(trade.openedAt, null, now)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <OutcomeBadge trade={trade} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-[10px] tabular-nums text-[#86868b]">
                    {clock(trade.openedAt)}
                  </td>
                  {showClose && (
                    <td className="whitespace-nowrap px-4 py-3 text-right text-[10px] tabular-nums text-[#86868b]">
                      {clock(trade.closedAt)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeCards({
  trades,
  now,
  empty,
  showClose,
}: {
  trades: Mt5Trade[];
  now: number;
  empty: string;
  showClose: boolean;
}) {
  if (trades.length === 0) {
    return (
      <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-10 text-center text-[12px] text-[#86868b]">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {trades.map((trade) => {
        const isLong = trade.direction === 'LONG';
        const displayPnl = trade.status === 'OPEN' ? trade.unrealizedPnl : trade.pnl;

        return (
          <div
            key={trade.id}
            style={trade.status === 'OPEN' ? pnlTintStyle(displayPnl) : undefined}
            className="rounded-2xl border border-black/[0.06] bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[#1d1d1f]">{trade.symbol}</span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                      isLong ? 'text-[#1d8f3a]' : 'text-[#d70015]'
                    }`}
                  >
                    {isLong ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-[#86868b]">
                  {trade.lotSize.toFixed(2)} lots ·{' '}
                  {showClose
                    ? clock(trade.closedAt)
                    : duration(trade.openedAt, null, now)}
                  {trade.mt5Ticket !== null && ` · MT5 #${trade.mt5Ticket}`}
                </div>
                {trade.executionError && (
                  <div className="mt-1 text-[9px] text-[#d70015]">MT5: {trade.executionError}</div>
                )}
              </div>
              <div className="text-right">
                <div className={`text-[15px] font-semibold tabular-nums ${pnlClass(displayPnl)}`}>
                  {money(displayPnl)}
                </div>
                <div className="mt-1 flex justify-end">
                  <OutcomeBadge trade={trade} />
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-[11px]">
              <div>
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">Entry</div>
                <div className="mt-0.5 font-medium tabular-nums text-[#1d1d1f]">
                  {price(trade.entryPrice)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">Exit</div>
                <div className="mt-0.5 font-medium tabular-nums text-[#1d1d1f]">
                  {trade.exitPrice === null ? 'Live' : price(trade.exitPrice)}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.06em] text-[#86868b]">
                  <BearIcon size={10} />
                  SL
                </div>
                <div className="mt-0.5 font-medium tabular-nums text-[#d70015]">
                  {price(trade.stopLoss)}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.06em] text-[#86868b]">
                  <BullIcon size={10} />
                  TP
                </div>
                <div className="mt-0.5 font-medium tabular-nums text-[#1d8f3a]">
                  {price(trade.takeProfit)}
                </div>
              </div>
            </div>

            {showClose && trade.balanceAfter !== null && (
              <div className="mt-2 flex items-center justify-between text-[10px] text-[#86868b]">
                <span>Balance</span>
                <span className="font-medium text-[#1d1d1f]">{money(trade.balanceAfter)}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Date(year, month - 1, day).toLocaleDateString();
}

export const TradesViewer: React.FC = () => {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [historyPage, setHistoryPage] = useState(1);
  const [riskDraft, setRiskDraft] = useState('');
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/signals', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData((await response.json()) as SignalsResponse);
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

  const trades = data?.trades ?? [];
  const account: AccountSummary | null = data?.account ?? null;
  const mt5 = data?.mt5 ?? null;
  const mt5Account = mt5?.connected ? mt5.account : null;
  const mt5Connected = Boolean(mt5Account);
  const riskPercent = data?.riskPercent ?? account?.riskPercent ?? 5;
  const openTrades = useMemo(() => trades.filter((trade) => trade.status === 'OPEN'), [trades]);
  const closedTrades = useMemo(
    () =>
      trades
        .filter((trade) => trade.status === 'CLOSED')
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [trades]
  );

  const historyPageCount = Math.max(1, Math.ceil(closedTrades.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const pagedClosedTrades = useMemo(
    () =>
      closedTrades.slice(
        (currentHistoryPage - 1) * HISTORY_PAGE_SIZE,
        currentHistoryPage * HISTORY_PAGE_SIZE
      ),
    [closedTrades, currentHistoryPage]
  );

  useEffect(() => {
    setHistoryPage(1);
  }, [mt5Connected]);

  useEffect(() => {
    setRiskDraft(String(riskPercent));
  }, [riskPercent]);

  const updateRisk = async () => {
    setRiskError(null);
    const value = Number(riskDraft);
    if (!Number.isFinite(value) || value < 0.1 || value > 100) {
      setRiskError('Enter a risk percentage between 0.1 and 100.');
      return;
    }
    setRiskBusy(true);
    try {
      const response = await fetch('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskPercent: value }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; riskPercent?: number; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (HTTP ${response.status}).`);
      }
      if (typeof payload?.riskPercent === 'number') {
        setRiskDraft(String(payload.riskPercent));
      }
      await load();
    } catch (err) {
      setRiskError(err instanceof Error ? err.message : 'Updating the risk percentage failed.');
    } finally {
      setRiskBusy(false);
    }
  };

  const mt5Label =
    mt5Connected
      ? `MT5 · #${mt5Account?.login}`
      : mt5?.state === 'CONNECTING'
        ? 'MT5 connecting...'
        : 'MT5 not connected';

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-[#86868b]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                mt5Connected ? 'bg-[#34c759]' : 'bg-[#aeaeb2]'
              }`}
            />
            {mt5Label}
          </div>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[#1d1d1f] sm:text-[34px]">
            Trades
          </h1>
          <p className="mt-1.5 text-[13px] text-[#6e6e73]">
            Auto lots · {riskPercent}% balance risk · per-pair SL · 2R TP
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
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-[#fff8eb] px-4 py-3.5 text-[12px] text-[#8a5300] ring-1 ring-inset ring-[#ff9f0a]/25 sm:px-5 sm:py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <div className="font-medium">Connection issue</div>
            <div className="mt-0.5 text-[#8a5300]/80">{error}</div>
          </div>
        </div>
      )}

      {!mt5Connected && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-[#fff8eb] px-4 py-3.5 text-[12px] text-[#8a5300] ring-1 ring-inset ring-[#ff9f0a]/25 sm:px-5 sm:py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <div className="font-medium">
              {mt5?.state === 'ERROR' ? 'MT5 connection failed' : 'Waiting for MT5'}
            </div>
            <div className="mt-0.5 text-[#8a5300]/80">
              {mt5?.lastError ??
                'Open MetaTrader 5 and log in to your account. The bot attaches to that account automatically.'}
            </div>
          </div>
        </div>
      )}

      <Mt5AccountPanel mt5={mt5} onChanged={load} />

      <div className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5f5f7] text-[#1d1d1f]">
            <Activity className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
            Position sizing
          </h2>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[#86868b] sm:text-[12px]">
          Automatic from the connected MT5 account balance. Minimum 0.01 lot.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">Risk</div>
            <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">
              {riskPercent}%
            </div>
          </div>
          <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.06em] text-[#86868b]">
              <BearIcon size={10} />
              SL
            </div>
            <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">
              Per pair
            </div>
          </div>
          <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.06em] text-[#86868b]">
              <BullIcon size={10} />
              TP
            </div>
            <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">2R</div>
          </div>
          <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">RR</div>
            <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">1:2</div>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void updateRisk();
          }}
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <label className="block sm:max-w-[220px]">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#86868b]">
              Risk per trade (%)
            </span>
            <div className="mt-1 flex items-center gap-2 rounded-xl bg-[#f5f5f7] px-3">
              <input
                value={riskDraft}
                onChange={(event) => setRiskDraft(event.target.value)}
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                inputMode="decimal"
                disabled={riskBusy}
                className="h-10 w-full bg-transparent text-[13px] tabular-nums text-[#1d1d1f] focus:outline-none disabled:opacity-50"
              />
              <span className="text-[12px] font-medium text-[#86868b]">%</span>
            </div>
          </label>
          <button
            type="submit"
            disabled={riskBusy}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-5 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-40"
          >
            {riskBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Apply risk
          </button>
        </form>
        {riskError && (
          <div className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[#d70015]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>{riskError}</span>
          </div>
        )}
      </div>

      {mt5Connected && mt5Account ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
          <AccountCard
            label="MT5 balance"
            value={accountMoney(mt5Account.balance, mt5Account.currency)}
            accent="text-[#1d1d1f]"
            icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="MT5 equity"
            value={accountMoney(mt5Account.equity, mt5Account.currency)}
            accent="text-[#1d1d1f]"
            icon={<Activity className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Floating P&L"
            value={accountMoney(mt5Account.profit, mt5Account.currency)}
            accent={pnlClass(mt5Account.profit)}
            style={pnlTintStyle(mt5Account.profit)}
            icon={<TrendingUp className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Free margin"
            value={accountMoney(mt5Account.marginFree, mt5Account.currency)}
            accent="text-[#1d1d1f]"
            icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Margin used"
            value={accountMoney(mt5Account.margin, mt5Account.currency)}
            accent="text-[#1d1d1f]"
            icon={<Activity className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Broker positions"
            value={String(mt5?.positions.length ?? 0)}
            accent="text-[#1d1d1f]"
            icon={<Activity className="h-4 w-4" strokeWidth={1.7} />}
          />
        </div>
      ) : null}

      {mt5Connected && account && (account.dailyPnl ?? []).length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
                Daily P&L
              </h2>
              <span className="text-[11px] text-[#86868b]">{account.dailyPnl.length} days</span>
            </div>
            {!account.historyFull && (
              <span className="text-[10px] text-[#86868b]">
                Loading full account history...
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-black/[0.06] text-left text-[12px]">
                <thead className="bg-[#fafafa] text-[10px] uppercase tracking-[0.06em] text-[#86868b]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Day</th>
                    <th className="px-4 py-3 text-right font-medium">Closed trades</th>
                    <th className="px-4 py-3 text-right font-medium">Win rate</th>
                    <th className="px-4 py-3 text-right font-medium">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {account.dailyPnl.map((entry) => (
                    <tr key={entry.date}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-[#1d1d1f]">
                        {formatDay(entry.date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[#6e6e73]">
                        {entry.trades}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[#6e6e73]">
                        {entry.trades > 0 ? `${Math.round((entry.wins / entry.trades) * 100)}%` : '—'}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums ${pnlClass(
                          entry.pnl
                        )}`}
                      >
                        {money(entry.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-2 text-right text-[10px] text-[#86868b]">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3" />
              Daily P&L updates automatically with every history sync.
            </span>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
            {mt5Connected ? 'MT5 open positions' : 'Open trades'}
          </h2>
          <span className="text-[11px] text-[#86868b]">{openTrades.length}</span>
        </div>
        <div className="md:hidden">
          <TradeCards
            trades={openTrades}
            now={now}
            empty={loading ? 'Loading...' : mt5Connected ? 'No open MT5 positions.' : 'No open trades.'}
            showClose={false}
          />
        </div>
        <div className="hidden md:block">
          <TradeTable
            trades={openTrades}
            now={now}
            empty={
              loading
                ? 'Loading...'
                : mt5Connected
                  ? 'No open MT5 positions.'
                  : 'No open trades.'
            }
            showClose={false}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
            {mt5Connected ? 'MT5 history' : 'History'}
          </h2>
          <span className="text-[11px] text-[#86868b]">{closedTrades.length}</span>
        </div>
        <div className="md:hidden">
          <TradeCards
            trades={pagedClosedTrades}
            now={now}
            empty={
              loading
                ? 'Loading...'
                : mt5Connected
                  ? 'No closed MT5 trades.'
                  : 'No closed trades.'
            }
            showClose
          />
        </div>
        <div className="hidden md:block">
          <TradeTable
            trades={pagedClosedTrades}
            now={now}
            empty={
              loading
                ? 'Loading...'
                : mt5Connected
                  ? 'No closed MT5 trades.'
                  : 'No closed trades.'
            }
            showClose
          />
        </div>
        {closedTrades.length > HISTORY_PAGE_SIZE && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#86868b]">
              Showing {(currentHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}–
              {Math.min(currentHistoryPage * HISTORY_PAGE_SIZE, closedTrades.length)} of{' '}
              {closedTrades.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHistoryPage(Math.max(1, currentHistoryPage - 1))}
                disabled={currentHistoryPage <= 1}
                className="inline-flex h-8 items-center justify-center rounded-full bg-white px-3.5 text-[11px] font-medium text-[#1d1d1f] ring-1 ring-inset ring-black/10 active:opacity-70 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-[11px] tabular-nums text-[#86868b]">
                Page {currentHistoryPage} of {historyPageCount}
              </span>
              <button
                type="button"
                onClick={() => setHistoryPage(Math.min(historyPageCount, currentHistoryPage + 1))}
                disabled={currentHistoryPage >= historyPageCount}
                className="inline-flex h-8 items-center justify-center rounded-full bg-white px-3.5 text-[11px] font-medium text-[#1d1d1f] ring-1 ring-inset ring-black/10 active:opacity-70 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
        {mt5Connected && (
          <div className="mt-2 flex items-center justify-end text-[10px] text-[#86868b]">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3" />
              History synced from the broker every 30 seconds.
            </span>
          </div>
        )}
      </section>
    </div>
  );
};
