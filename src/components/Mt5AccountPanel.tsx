import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  PlugZap,
  Server,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { Mt5AccountMeta, Mt5Status } from '../types';

interface Mt5AccountsResponse {
  accounts: Mt5AccountMeta[];
  passwordKnown: number[];
}

async function postJson<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
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
      throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (HTTP ${response.status}).`);
  }
  if (!payload) throw new Error('Server returned an empty response.');
  return payload;
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

function pnlClass(value: number): string {
  if (value > 0) return 'text-[#1d8f3a]';
  if (value < 0) return 'text-[#d70015]';
  return 'text-[#6e6e73]';
}

export function Mt5AccountPanel({
  mt5,
  onChanged,
}: {
  mt5: Mt5Status | null;
  onChanged: () => void | Promise<void>;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [terminalPath, setTerminalPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<Mt5AccountsResponse | null>(null);
  const [switchTarget, setSwitchTarget] = useState<Mt5AccountMeta | null>(null);
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetch('/api/mt5/accounts', { cache: 'no-store' });
      if (response.ok) setKnownAccounts((await response.json()) as Mt5AccountsResponse);
    } catch {
      // The saved-account list is optional; keep the previous one.
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const connected = Boolean(mt5?.connected && mt5.account);
  const account = mt5?.account ?? null;
  const config = mt5?.config ?? null;

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await postJson('/api/mt5/connect', {
        login: Number(login),
        password,
        server,
        terminalPath,
      });
      setPassword('');
      await onChanged();
      await loadAccounts();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'MT5 connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setFormError(null);
    setBusy(true);
    try {
      await postJson('/api/mt5/disconnect');
      await onChanged();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'MT5 disconnect failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitSwitch = async (target: Mt5AccountMeta, suppliedPassword: string) => {
    setSwitchError(null);
    setSwitchBusy(true);
    try {
      await postJson('/api/mt5/switch', {
        login: target.login,
        server: target.server,
        password: suppliedPassword,
      });
      setSwitchTarget(null);
      setSwitchPassword('');
      await onChanged();
      await loadAccounts();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : 'Switching accounts failed.');
    } finally {
      setSwitchBusy(false);
    }
  };

  const startSwitch = (target: Mt5AccountMeta) => {
    setSwitchError(null);
    if (knownAccounts?.passwordKnown.includes(target.login)) {
      void submitSwitch(target, '');
    } else {
      setSwitchTarget(target);
      setSwitchPassword('');
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
      <div className="flex flex-col gap-3 border-b border-black/[0.06] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              connected ? 'bg-[#e7f8eb] text-[#1d8f3a]' : 'bg-[#f5f5f7] text-[#6e6e73]'
            }`}
          >
            <PlugZap className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
                MetaTrader 5
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${
                  connected
                    ? 'bg-[#e7f8eb] text-[#1d8f3a]'
                    : mt5?.state === 'ERROR'
                      ? 'bg-[#fff2f2] text-[#d70015]'
                      : 'bg-[#f5f5f7] text-[#86868b]'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connected
                      ? 'bg-[#34c759]'
                      : mt5?.state === 'ERROR'
                        ? 'bg-[#ff3b30]'
                        : 'bg-[#aeaeb2]'
                  }`}
                />
                {connected ? 'Connected' : mt5?.state === 'CONNECTING' ? 'Connecting' : 'Disconnected'}
              </span>
            </div>
              <p className="mt-1 text-[11px] leading-5 text-[#86868b] sm:text-[12px]">
                {connected
                  ? 'New signals are executed on this MT5 account. SL, TP and strategy stay unchanged.'
                  : 'The bot attaches to the MT5 account logged into your terminal automatically, or connect manually below.'}
              </p>
          </div>
        </div>
        {connected && (
          <button
            onClick={() => void disconnect()}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 text-[11px] font-medium text-[#1d1d1f] ring-1 ring-inset ring-black/[0.06] active:opacity-70 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
            Disconnect
          </button>
        )}
      </div>

      {(formError || mt5?.lastError) && (
        <div className="flex items-start gap-2 px-4 pt-3 text-[11px] leading-5 text-[#d70015] sm:px-5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span>{formError ?? mt5?.lastError}</span>
        </div>
      )}

      {knownAccounts && knownAccounts.accounts.length > 0 && (
        <div className="border-b border-black/[0.06] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.06em] text-[#86868b]">
            <ArrowLeftRight className="h-3 w-3" />
            Saved accounts
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {knownAccounts.accounts.map((saved) => {
              const isCurrent = account?.login === saved.login && connected;
              return (
                <div
                  key={`${saved.login}@${saved.server}`}
                  className="flex items-center gap-3 rounded-xl bg-[#f5f5f7] px-3 py-2"
                >
                  <div>
                    <div className="text-[11px] font-semibold text-[#1d1d1f]">
                      {saved.name || 'MT5 account'} #{saved.login}
                    </div>
                    <div className="text-[9px] text-[#6e6e73]">{saved.server}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isCurrent) startSwitch(saved);
                    }}
                    disabled={isCurrent || switchBusy || busy}
                    className={`inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[10px] font-medium ring-1 ring-inset active:opacity-70 disabled:opacity-50 ${
                      isCurrent
                        ? 'bg-white text-[#86868b] ring-black/[0.06]'
                        : 'bg-white text-[#0071e3] ring-black/10'
                    }`}
                  >
                    {switchBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowLeftRight className="h-3 w-3" />
                    )}
                    {isCurrent ? 'Current' : 'Switch'}
                  </button>
                </div>
              );
            })}
          </div>
          {switchTarget && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (switchTarget) void submitSwitch(switchTarget, switchPassword);
              }}
              className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <input
                value={switchPassword}
                onChange={(event) => setSwitchPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder={`Password for #${switchTarget.login}`}
                disabled={switchBusy}
                className="h-9 w-full max-w-[260px] rounded-xl border border-transparent bg-[#f5f5f7] px-3 text-[12px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={switchBusy}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#1d1d1f] px-4 text-[12px] font-medium text-white active:opacity-70 disabled:opacity-40"
              >
                {switchBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                Unlock and switch
              </button>
            </form>
          )}
          {switchError && (
            <div className="mt-1.5 pb-1 text-[11px] leading-5 text-[#d70015]">{switchError}</div>
          )}
        </div>
      )}

      {connected && account ? (
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f5f5f7] px-3.5 py-3">
            <div>
              <div className="text-[13px] font-semibold text-[#1d1d1f]">{account.name || 'MT5 Account'}</div>
              <div className="mt-0.5 text-[10px] text-[#6e6e73]">
                #{account.login} · {account.server} · {account.company}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[9px] font-medium">
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[#1d8f3a] ring-1 ring-inset ring-black/[0.05]">
                <ShieldCheck className="h-3 w-3" />
                {account.isDemo ? 'DEMO' : 'LIVE'}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-inset ring-black/[0.05] ${
                  mt5?.terminal?.tradeAllowed ? 'text-[#1d8f3a]' : 'text-[#a05a00]'
                }`}
              >
                <Terminal className="h-3 w-3" />
                Algo {mt5?.terminal?.tradeAllowed ? 'on' : 'off'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[#6e6e73] ring-1 ring-inset ring-black/[0.05]">
                <Server className="h-3 w-3" />
                1:{account.leverage}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                label: 'Balance',
                value: accountMoney(account.balance, account.currency),
                tone: 'text-[#1d1d1f]',
                icon: <Wallet className="h-3.5 w-3.5" strokeWidth={1.8} />,
              },
              {
                label: 'Equity',
                value: accountMoney(account.equity, account.currency),
                tone: 'text-[#1d1d1f]',
                icon: <Activity className="h-3.5 w-3.5" strokeWidth={1.8} />,
              },
              {
                label: 'Floating P&L',
                value: accountMoney(account.profit, account.currency),
                tone: pnlClass(account.profit),
                icon: <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.8} />,
              },
              {
                label: 'Free margin',
                value: accountMoney(account.marginFree, account.currency),
                tone: 'text-[#1d1d1f]',
                icon: <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} />,
              },
            ].map((item) => (
              <div key={item.label} className="rounded-xl bg-[#f5f5f7] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.06em] text-[#86868b]">
                  {item.label}
                  <span className="text-[#aeaeb2]">{item.icon}</span>
                </div>
                <div className={`mt-1 text-[14px] font-semibold tabular-nums ${item.tone}`}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#86868b]">
            <span>
              Symbol suffix:{' '}
              <span className="font-medium text-[#1d1d1f]">
                {config?.symbolSuffix || 'none'}
              </span>{' '}
              <span className="text-[#aeaeb2]">(auto-detected)</span>
            </span>
            <span>
              Margin used:{' '}
              <span className="font-medium text-[#1d1d1f]">
                {accountMoney(account.margin, account.currency)}
              </span>
            </span>
            <span>
              Open positions:{' '}
              <span className="font-medium text-[#1d1d1f]">{mt5?.positions.length ?? 0}</span>
            </span>
          </div>

          {mt5?.positions && mt5.positions.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-black/[0.06]">
              <div className="border-b border-black/[0.05] bg-[#fafafa] px-3 py-2 text-[9px] font-medium uppercase tracking-[0.06em] text-[#86868b]">
                Broker positions
              </div>
              <div className="divide-y divide-black/[0.05]">
                {mt5.positions.slice(0, 8).map((position) => (
                  <div
                    key={position.ticket}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[10px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#1d1d1f]">{position.symbol}</span>
                      <span
                        className={`font-medium ${
                          position.type === 'BUY' ? 'text-[#1d8f3a]' : 'text-[#d70015]'
                        }`}
                      >
                        {position.type}
                      </span>
                      <span className="tabular-nums text-[#6e6e73]">{position.volume.toFixed(2)}</span>
                      <span className="font-mono text-[#86868b]">#{position.ticket}</span>
                    </div>
                    <span className={`font-semibold tabular-nums ${pnlClass(position.profit)}`}>
                      {accountMoney(position.profit, account.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={connect} className="space-y-3 px-4 py-4 sm:px-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#86868b]">
                Account number
              </span>
              <input
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                type="text"
                inputMode="numeric"
                autoComplete="username"
                placeholder="12345678"
                disabled={busy}
                className="mt-1 h-10 w-full rounded-xl border border-transparent bg-[#f5f5f7] px-3 text-[13px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#86868b]">
                Password
              </span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="MT5 password"
                disabled={busy}
                className="mt-1 h-10 w-full rounded-xl border border-transparent bg-[#f5f5f7] px-3 text-[13px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#86868b]">
                Server
              </span>
              <input
                value={server}
                onChange={(event) => setServer(event.target.value)}
                type="text"
                placeholder="MetaQuotes-Demo"
                disabled={busy}
                className="mt-1 h-10 w-full rounded-xl border border-transparent bg-[#f5f5f7] px-3 text-[13px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#86868b]">
              Terminal path <span className="normal-case tracking-normal">(optional)</span>
            </span>
            <input
              value={terminalPath}
              onChange={(event) => setTerminalPath(event.target.value)}
              type="text"
              placeholder="Auto-detect, or C:\Program Files\MetaTrader 5\terminal64.exe"
              disabled={busy}
              className="mt-1 h-10 w-full rounded-xl border border-transparent bg-[#f5f5f7] px-3 text-[13px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none disabled:opacity-50"
            />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-[10px] leading-4 text-[#86868b]">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span>
                MT5 only. The broker symbol suffix is detected automatically. Password is
                kept in server memory and is never saved to disk.
              </span>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-5 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
              Connect account
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
