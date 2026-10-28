import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Loader2,
  Plus,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  AccountSummary,
  DummyTrade,
  SignalsResponse,
  Withdrawal,
  WithdrawalMethod,
} from '../types';

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(5);
  return value.toFixed(6);
}

function pnlClass(value: number): string {
  if (value > 0) return 'text-[#1d8f3a]';
  if (value < 0) return 'text-[#d70015]';
  return 'text-[#6e6e73]';
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

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: (T & { error?: string }) | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new Error(
        `Server returned an invalid response (HTTP ${response.status}). Restart the dev server so the new account route is loaded.`
      );
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (HTTP ${response.status}).`);
  }
  if (!payload) throw new Error('Server returned an empty response.');
  return payload;
}

const PROVIDERS: Record<WithdrawalMethod, { name: string; mark: string; logo: string }> = {
  JAZZCASH: {
    name: 'JazzCash',
    mark: 'J',
    logo: 'bg-[#ff3b30]',
  },
  EASYPAISA: {
    name: 'Easypaisa',
    mark: 'e',
    logo: 'bg-[#34c759]',
  },
};

function ProviderLogo({ method, compact = false }: { method: WithdrawalMethod; compact?: boolean }) {
  const provider = PROVIDERS[method];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`flex items-center justify-center rounded-lg font-semibold text-white ${provider.logo} ${
          compact ? 'h-5 w-5 text-[10px]' : 'h-8 w-8 text-[14px]'
        }`}
      >
        {provider.mark}
      </span>
      <span
        className={`font-semibold tracking-[-0.01em] text-[#1d1d1f] ${
          compact ? 'text-[10px]' : 'text-[14px]'
        }`}
      >
        {provider.name}
      </span>
    </span>
  );
}

function maskAccount(value: string): string {
  if (value.length !== 11) return value;
  return `${value.slice(0, 4)} **** ${value.slice(-4)}`;
}

function AccountCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5">
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

function OutcomeBadge({ trade }: { trade: DummyTrade }) {
  if (trade.status === 'OPEN') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0071e3]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#0071e3]" />
        Open
      </span>
    );
  }
  const outcome = trade.outcome ?? 'EXPIRED';
  const meta =
    outcome === 'TP_HIT'
      ? { label: 'TP hit', text: 'text-[#1d8f3a]', dot: 'bg-[#34c759]' }
      : outcome === 'SL_HIT'
        ? { label: 'SL hit', text: 'text-[#d70015]', dot: 'bg-[#ff3b30]' }
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
  trades: DummyTrade[];
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
              <th className="px-4 py-3 text-right font-medium">SL</th>
              <th className="px-4 py-3 text-right font-medium">TP</th>
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
                <tr key={trade.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-[#1d1d1f]">
                    {trade.symbol}
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
  trades: DummyTrade[];
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
          <div key={trade.id} className="rounded-2xl border border-black/[0.06] bg-white p-4">
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
                </div>
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
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">SL</div>
                <div className="mt-0.5 font-medium tabular-nums text-[#d70015]">
                  {price(trade.stopLoss)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">TP</div>
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

function WithdrawalCards({
  withdrawals,
  loading,
}: {
  withdrawals: Withdrawal[];
  loading: boolean;
}) {
  if (withdrawals.length === 0) {
    return (
      <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-10 text-center text-[12px] text-[#86868b]">
        {loading ? 'Loading...' : 'No withdrawals yet.'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {withdrawals.map((withdrawal) => (
        <div
          key={withdrawal.id}
          className="rounded-2xl border border-black/[0.06] bg-white p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <ProviderLogo method={withdrawal.method} compact />
            <div className="text-right">
              <div className="text-[14px] font-semibold tabular-nums text-[#1d8f3a]">
                {money(withdrawal.amount)}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[#1d8f3a]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#34c759]" />
                Paid
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px]">
            <div className="font-medium text-[#1d1d1f]">{withdrawal.accountTitle}</div>
            <div className="mt-0.5 text-[10px] tabular-nums text-[#86868b]">
              {maskAccount(withdrawal.accountNumber)}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[#86868b]">
            <span className="font-mono">{withdrawal.reference}</span>
            <span className="tabular-nums">{clock(withdrawal.requestedAt)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-[#86868b]">
            <span>Balance after</span>
            <span className="font-medium text-[#1d1d1f]">{money(withdrawal.balanceAfter)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function WithdrawModal({
  balance,
  onClose,
  onSuccess,
}: {
  balance: number;
  onClose: () => void;
  onSuccess: (withdrawal: Withdrawal) => void;
}) {
  const [method, setMethod] = useState<WithdrawalMethod>('JAZZCASH');
  const [accountTitle, setAccountTitle] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/account/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          accountTitle,
          accountNumber,
          amount: Number(amount),
        }),
      });
      const text = await response.text();
      let payload: { withdrawal?: Withdrawal; error?: string } = {};
      if (text) {
        try {
          payload = JSON.parse(text) as { withdrawal?: Withdrawal; error?: string };
        } catch {
          throw new Error(
            `Server returned an invalid response (HTTP ${response.status}). Restart the dev server so the new withdrawal route is loaded.`
          );
        }
      }
      if (!response.ok || !payload.withdrawal) {
        throw new Error(
          payload.error ??
            (response.status === 404
              ? 'Withdrawal API not found. Restart the dev server so the new route is loaded.'
              : 'Withdrawal could not be processed.')
        );
      }
      onSuccess(payload.withdrawal);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Withdrawal could not be processed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-[20px] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.18)] ring-1 ring-black/10">
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 text-[#1d1d1f]" strokeWidth={1.7} />
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
                Withdraw balance
              </h2>
            </div>
            <p className="mt-1 text-[12px] text-[#86868b]">
              Available to withdraw{' '}
              <span className="font-medium text-[#1d1d1f]">{money(balance)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f5f7] text-[#6e6e73] active:opacity-70"
            aria-label="Close withdrawal dialog"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#86868b]">
              Payout method
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.keys(PROVIDERS) as WithdrawalMethod[]).map((value) => {
                const active = method === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMethod(value)}
                    className={`rounded-xl px-3 py-3 text-left ring-1 ring-inset ${
                      active ? 'bg-white ring-[#1d1d1f]' : 'bg-[#f5f5f7] ring-transparent'
                    }`}
                  >
                    <ProviderLogo method={value} />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="withdraw-title"
              className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#86868b]"
            >
              Account title
            </label>
            <input
              id="withdraw-title"
              value={accountTitle}
              onChange={(event) => setAccountTitle(event.target.value)}
              placeholder="Full name on the wallet"
              maxLength={60}
              autoComplete="name"
              className="mt-2 w-full rounded-xl border border-transparent bg-[#f5f5f7] px-3.5 py-2.5 text-[16px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none sm:text-[14px]"
            />
          </div>

          <div>
            <label
              htmlFor="withdraw-number"
              className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#86868b]"
            >
              Mobile account number
            </label>
            <input
              id="withdraw-number"
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              placeholder="03001234567"
              inputMode="tel"
              maxLength={16}
              className="mt-2 w-full rounded-xl border border-transparent bg-[#f5f5f7] px-3.5 py-2.5 text-[16px] tracking-wide text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none sm:text-[14px]"
            />
            <div className="mt-1.5 text-[11px] text-[#86868b]">
              11-digit mobile wallet number.
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="withdraw-amount"
                className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#86868b]"
              >
                Amount
              </label>
              <button
                type="button"
                onClick={() => setAmount(balance.toFixed(2))}
                className="text-[11px] font-medium text-[#0071e3] active:opacity-70"
              >
                Withdraw all
              </button>
            </div>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-[#86868b]">
                $
              </span>
              <input
                id="withdraw-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                type="number"
                min="0.01"
                max={balance}
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-xl border border-transparent bg-[#f5f5f7] py-2.5 pl-7 pr-3.5 text-[16px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none sm:text-[14px]"
              />
            </div>
          </div>

          {formError && (
            <div className="flex items-start gap-2 rounded-xl bg-[#fff2f2] px-3.5 py-3 text-[11px] text-[#d70015]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-full bg-[#f5f5f7] px-4 text-[13px] font-medium text-[#1d1d1f] active:opacity-70 sm:h-9"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50 sm:h-9"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
              {submitting ? 'Processing' : `Withdraw via ${PROVIDERS[method].name}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WithdrawSuccess({
  withdrawal,
  onClose,
}: {
  withdrawal: Withdrawal;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[20px] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.18)] ring-1 ring-black/10">
        <div className="px-5 py-6 text-center sm:px-6 sm:py-7">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#34c759]">
            <CheckCircle2 className="h-7 w-7 text-white" strokeWidth={1.8} />
          </span>
          <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
            Withdrawal sent
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-[#6e6e73]">
            {money(withdrawal.amount)} has been sent to your {PROVIDERS[withdrawal.method].name}{' '}
            wallet.
          </p>

          <div className="mt-6 space-y-3 rounded-2xl bg-[#f5f5f7] px-4 py-4 text-left text-[12px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#86868b]">Payout method</span>
              <ProviderLogo method={withdrawal.method} compact />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#86868b]">Account</span>
              <span className="font-medium text-[#1d1d1f]">
                {withdrawal.accountTitle} · {maskAccount(withdrawal.accountNumber)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#86868b]">Reference</span>
              <span className="font-mono text-[10px] font-medium text-[#1d1d1f]">
                {withdrawal.reference}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#86868b]">New balance</span>
              <span className="font-semibold text-[#1d1d1f]">
                {money(withdrawal.balanceAfter)}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="mt-6 h-10 w-full rounded-full bg-[#1d1d1f] text-[14px] font-medium text-white active:opacity-70"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export const DummyTradesViewer: React.FC = () => {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [receipt, setReceipt] = useState<Withdrawal | null>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [settingsBusy, setSettingsBusy] = useState<'balance' | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

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
  const withdrawals = data?.withdrawals ?? [];
  const openTrades = useMemo(() => trades.filter((trade) => trade.status === 'OPEN'), [trades]);
  const closedTrades = useMemo(
    () =>
      trades
        .filter((trade) => trade.status === 'CLOSED')
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [trades]
  );
  const handleAddBalance = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(balanceInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSettingsNotice({ tone: 'error', text: 'Enter an amount greater than zero.' });
      return;
    }
    setSettingsBusy('balance');
    setSettingsNotice(null);
    try {
      const result = await postJson<{ balance: number; startingBalance: number }>(
        '/api/account/add-balance',
        { amount }
      );
      setBalanceInput('');
      setSettingsNotice({
        tone: 'success',
        text: `Added ${money(amount)}. New balance ${money(result.balance)}.`,
      });
      await load();
    } catch (err) {
      setSettingsNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Balance could not be updated.',
      });
    } finally {
      setSettingsBusy(null);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-[#86868b]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#34c759]" />
            Simulated account
          </div>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[#1d1d1f] sm:text-[34px]">
            Trades
          </h1>
          <p className="mt-1.5 text-[13px] text-[#6e6e73]">
            Auto lot · {account?.riskPercent ?? 5}% balance risk · 40p SL · 80p TP
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            onClick={() => setShowWithdraw(true)}
            disabled={!account || account.balance <= 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-40 sm:h-9"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Withdraw
          </button>
          <button
            onClick={() => void load()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-[#1d1d1f] ring-1 ring-inset ring-black/10 active:opacity-70 sm:h-9"
          >
            <Activity className="h-3.5 w-3.5" />
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

      <section className="grid gap-2.5 sm:gap-3 lg:grid-cols-2">
        <form
          onSubmit={(event) => void handleAddBalance(event)}
          className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5f5f7] text-[#1d1d1f]">
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
              Add balance
            </h2>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[#86868b] sm:text-[12px]">
            Add simulated funds.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-[#86868b]">
                $
              </span>
              <input
                aria-label="Amount to add"
                value={balanceInput}
                onChange={(event) => setBalanceInput(event.target.value)}
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                disabled={!account || settingsBusy !== null}
                className="h-[42px] w-full rounded-xl border border-transparent bg-[#f5f5f7] py-2.5 pl-7 pr-3.5 text-[16px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none disabled:opacity-50 sm:text-[14px]"
              />
            </div>
            <button
              type="submit"
              disabled={!account || settingsBusy !== null}
              className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] px-4 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-40 sm:w-auto"
            >
              {settingsBusy === 'balance' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add balance
            </button>
          </div>
        </form>

        <div className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5f5f7] text-[#1d1d1f]">
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
              Position sizing
            </h2>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[#86868b] sm:text-[12px]">
            Automatic from the current balance. Minimum 0.01 lot.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">Risk</div>
              <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">
                {account?.riskPercent ?? 5}%
              </div>
            </div>
            <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">SL</div>
              <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">
                {account?.stopPips ?? 40}p
              </div>
            </div>
            <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">TP</div>
              <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">
                {account?.takeProfitPips ?? 80}p
              </div>
            </div>
            <div className="rounded-xl bg-[#f5f5f7] px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.06em] text-[#86868b]">RR</div>
              <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#1d1d1f]">
                1:2
              </div>
            </div>
          </div>
        </div>
      </section>

      {settingsNotice && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-2xl px-5 py-3.5 text-[12px] ring-1 ring-inset ${
            settingsNotice.tone === 'success'
              ? 'bg-[#f0faf1] text-[#1d8f3a] ring-[#34c759]/20'
              : 'bg-[#fff2f2] text-[#d70015] ring-[#ff3b30]/20'
          }`}
        >
          {settingsNotice.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          )}
          <span>{settingsNotice.text}</span>
        </div>
      )}

      {account && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
          <AccountCard
            label="Balance"
            value={money(account.balance)}
            accent="text-[#1d1d1f]"
            icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Equity"
            value={money(account.equity)}
            accent="text-[#1d1d1f]"
            icon={<Activity className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Open P&L"
            value={money(account.unrealizedPnl)}
            accent={pnlClass(account.unrealizedPnl)}
            icon={<TrendingUp className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Realized P&L"
            value={money(account.realizedPnl)}
            accent={pnlClass(account.realizedPnl)}
            icon={<TrendingUp className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Withdrawn"
            value={money(account.withdrawnTotal)}
            accent="text-[#a05a00]"
            icon={<ArrowDownToLine className="h-4 w-4" strokeWidth={1.7} />}
          />
          <AccountCard
            label="Trades"
            value={`${account.openTrades} / ${account.closedTrades}`}
            accent="text-[#1d1d1f]"
            icon={<Activity className="h-4 w-4" strokeWidth={1.7} />}
          />
        </div>
      )}

      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
            Open trades
          </h2>
          <span className="text-[11px] text-[#86868b]">{openTrades.length}</span>
        </div>
        <div className="md:hidden">
          <TradeCards
            trades={openTrades}
            now={now}
            empty={loading ? 'Loading...' : 'No open trades.'}
            showClose={false}
          />
        </div>
        <div className="hidden md:block">
          <TradeTable
            trades={openTrades}
            now={now}
            empty={loading ? 'Loading...' : 'No open trades.'}
            showClose={false}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
            Withdrawals
          </h2>
          <span className="text-[11px] text-[#86868b]">{withdrawals.length}</span>
        </div>
        <div className="md:hidden">
          <WithdrawalCards withdrawals={withdrawals} loading={loading} />
        </div>
        <div className="hidden overflow-hidden rounded-2xl border border-black/[0.06] bg-white md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-black/[0.06] text-left text-[12px]">
              <thead className="bg-[#fafafa] text-[10px] uppercase tracking-[0.06em] text-[#86868b]">
                <tr>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 text-right font-medium">Balance after</th>
                  <th className="px-4 py-3 text-right font-medium">Requested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {withdrawals.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[12px] text-[#86868b]">
                      {loading ? 'Loading...' : 'No withdrawals yet.'}
                    </td>
                  </tr>
                )}
                {withdrawals.map((withdrawal) => (
                  <tr key={withdrawal.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <ProviderLogo method={withdrawal.method} compact />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-medium text-[#1d1d1f]">{withdrawal.accountTitle}</div>
                      <div className="mt-0.5 text-[10px] tabular-nums text-[#86868b]">
                        {maskAccount(withdrawal.accountNumber)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-[#1d8f3a]">
                      {money(withdrawal.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#1d8f3a]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#34c759]" />
                        Paid
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[10px] text-[#6e6e73]">
                      {withdrawal.reference}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#1d1d1f]">
                      {money(withdrawal.balanceAfter)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-[10px] tabular-nums text-[#86868b]">
                      {clock(withdrawal.requestedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
            History
          </h2>
          <span className="text-[11px] text-[#86868b]">{closedTrades.length}</span>
        </div>
        <div className="md:hidden">
          <TradeCards
            trades={closedTrades}
            now={now}
            empty={loading ? 'Loading...' : 'No closed trades.'}
            showClose
          />
        </div>
        <div className="hidden md:block">
          <TradeTable
            trades={closedTrades}
            now={now}
            empty={loading ? 'Loading...' : 'No closed trades.'}
            showClose
          />
        </div>
      </section>

      {showWithdraw && account && (
        <WithdrawModal
          balance={account.balance}
          onClose={() => setShowWithdraw(false)}
          onSuccess={(withdrawal) => {
            setShowWithdraw(false);
            setReceipt(withdrawal);
            void load();
          }}
        />
      )}

      {receipt && <WithdrawSuccess withdrawal={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
};
