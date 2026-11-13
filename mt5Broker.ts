import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import readline from 'readline';
import {
  loadAccountHistory,
  mergeAccountDeals,
  saveAccountHistory,
  type Mt5DealRecord,
} from './mt5HistoryStore';
import type {
  AccountSummary,
  Mt5Trade,
  Mt5Account,
  Mt5Position,
  Mt5Status,
  Mt5Terminal,
  DailyPnlEntry,
  SignalStatus,
} from './src/types';

// Must stay in sync with MAGIC in mt5_bridge.py — identifies positions opened by this bot.
export const MT5_POSITION_MAGIC = 20261030;

type BridgeResponse = {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

class Mt5Bridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: readline.Interface | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stderrTail: string[] = [];

  start(): void {
    if (this.child) return;
    const python = (process.env.MT5_PYTHON ?? 'python').trim() || 'python';
    const script = path.resolve(process.cwd(), 'mt5_bridge.py');
    const child = spawn(python, ['-u', script], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.stderrTail = [];

    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (!text) return;
      this.stderrTail.push(text);
      if (this.stderrTail.length > 12) this.stderrTail.shift();
    });
    child.on('error', (error) => {
      this.failAll(new Error(`Could not start the MT5 bridge: ${error.message}`));
      this.cleanup();
    });
    child.on('exit', (code) => {
      const detail = this.stderrTail.join('\n').trim();
      this.failAll(
        new Error(
          detail
            ? `MT5 bridge stopped (code ${code}): ${detail}`
            : `MT5 bridge stopped (code ${code}).`
        )
      );
      this.cleanup();
    });
  }

  request<T>(command: string, payload: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    this.start();
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(new Error('MT5 bridge is not writable.'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MT5 bridge timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, cmd: command, payload })}\n`);
    });
  }

  stop(): void {
    const child = this.child;
    this.cleanup();
    if (!child) return;
    try {
      child.stdin.end();
      child.kill();
    } catch {
      // Ignore process cleanup errors.
    }
  }

  private handleLine(line: string): void {
    const text = line.trim();
    if (!text) return;
    let response: BridgeResponse;
    try {
      response = JSON.parse(text) as BridgeResponse;
    } catch {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve(response.data);
      return;
    }
    pending.reject(new Error(response.error ?? 'MT5 bridge request failed.'));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private cleanup(): void {
    this.reader?.close();
    this.reader = null;
    this.child = null;
  }
}

export type Mt5ConnectInput = {
  login?: unknown;
  password?: unknown;
  server?: unknown;
  terminalPath?: unknown;
  symbolSuffix?: unknown;
};

export type Mt5OrderInput = {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  volume: number;
  sl: number;
  tp: number;
  slDistance?: number;
  tpDistance?: number;
  deviation?: number;
};

export type Mt5OrderResult = {
  ticket: number;
  order: number;
  deal: number;
  symbol: string;
  volume: number;
  price: number;
  retcode: number;
  comment: string;
};

export type Mt5PairTpSlStats = {
  symbol: string;
  tp: number;
  sl: number;
  breakeven: number;
  expired: number;
  total: number;
};

export type Mt5MutationResult = {
  ok: boolean;
  error?: string;
  status: Mt5Status;
};

export type Mt5SymbolInfo = {
  name: string;
  path: string;
  description: string;
  digits: number;
  point: number;
  contractSize: number;
  volumeMin: number;
  volumeStep: number;
  tradeMode: number;
  stopsLevel: number;
  bid: number;
  ask: number;
  last: number;
  mid: number;
  time: number;
};

export type Mt5Candle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Mt5Deal = Mt5DealRecord;

const HISTORY_DAYS_LIMIT = 5;
const HISTORY_TTL_MS = 30_000;
const DAILY_PNL_DAYS = 30;
const SYNC_FAILURE_LIMIT = 3;
const RECONNECT_DELAY_MS = 15_000;
const MT5_RISK_PERCENT = 3;
const DEAL_REASON_SL = 4;
const DEAL_REASON_TP = 5;
const DEAL_REASON_STOPOUT = 6;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function weightedPrice(deals: Mt5Deal[], fallback = 0): number {
  const total = deals.reduce((sum, deal) => sum + Math.abs(deal.volume), 0);
  if (total <= 0) return fallback;
  return deals.reduce((sum, deal) => sum + deal.price * Math.abs(deal.volume), 0) / total;
}

function sumVolume(deals: Mt5Deal[]): number {
  return deals.reduce((sum, deal) => sum + Math.abs(deal.volume), 0);
}

const DISCONNECTED_STATUS: Mt5Status = {
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

export class Mt5Broker {
  private bridge: Mt5Bridge | null = null;
  private status: Mt5Status = { ...DISCONNECTED_STATUS };
  private pollTimer: NodeJS.Timeout | null = null;
  private pollBusy = false;
  private connecting = false;
  private syncFailures = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private history: Mt5Deal[] = [];
  private historyByLogin = new Map<number, Mt5Deal[]>();
  private fullHistoryLoaded = new Set<number>();
  private historyFetchedAt = 0;
  private historySyncAt = 0;
  private closedTradeCache: {
    positionsKey: string;
    closedTrades: Mt5Trade[];
    allTrades: Mt5Trade[];
    dailyPnl: DailyPnlEntry[];
  } | null = null;

  isConnected(): boolean {
    return this.status.state === 'CONNECTED' && this.status.account !== null;
  }

  getStatus(): Mt5Status {
    return {
      ...this.status,
      positions: [...this.status.positions],
    };
  }

  getBalance(): number | null {
    return this.isConnected() ? (this.status.account?.balance ?? null) : null;
  }

  private setHistory(deals: Mt5Deal[]): void {
    this.history = deals;
    this.closedTradeCache = null;
  }

  private async syncFullHistory(login: number): Promise<Mt5Deal[]> {
    if (!this.bridge) return this.history;
    try {
      const history = await this.bridge.request<{ deals: Mt5Deal[] }>(
        'history',
        { days: 'all' },
        120_000
      );
      const merged = mergeAccountDeals(this.history, history.deals);
      this.fullHistoryLoaded.add(login);
      saveAccountHistory(login, this.status.account?.server ?? '', merged);
      return merged;
    } catch {
      // Fall back to the store-backed history and remember it is not complete.
      return this.history;
    }
  }

  getAccountSnapshot(): { account: AccountSummary; trades: Mt5Trade[] } | null {
    const mt5Account = this.status.account;
    if (!this.isConnected() || !mt5Account) return null;

    const openTickets = new Set(this.status.positions.map((position) => position.ticket));
    const openTrades = this.status.positions.map((position) => this.mapOpenPosition(position));
    const closedInfo = this.getClosedTrades(openTickets);
    const closedTrades = closedInfo.closedTrades;
    const trades = [
      ...openTrades,
      ...closedTrades.filter(
        (trade) => !openTrades.some((open) => open.mt5Ticket === trade.mt5Ticket)
      ),
    ].sort((a, b) => {
      if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
      if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
      return (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt);
    });

    const realizedPnl = roundMoney(
      closedTrades.reduce((sum, trade) => sum + trade.pnl, 0)
    );
    const unrealizedPnl = roundMoney(
      openTrades.reduce((sum, trade) => sum + trade.unrealizedPnl, 0)
    );
    const now = Date.now();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    const periodStats = (since: number) => {
      const inPeriod = closedTrades.filter((trade) => (trade.closedAt ?? 0) >= since);
      return {
        pnl: roundMoney(inPeriod.reduce((sum, trade) => sum + trade.pnl, 0)),
        count: inPeriod.length,
      };
    };
    const today = periodStats(startOfToday.getTime());
    const week = periodStats(startOfWeek.getTime());
    const month = periodStats(startOfMonth.getTime());

    const account: AccountSummary = {
      balance: roundMoney(mt5Account.balance),
      equity: roundMoney(mt5Account.equity),
      unrealizedPnl,
      realizedPnl,
      realizedPnlToday: today.pnl,
      realizedPnlWeek: week.pnl,
      realizedPnlMonth: month.pnl,
      closedTradesToday: today.count,
      closedTradesWeek: week.count,
      closedTradesMonth: month.count,
      openTrades: openTrades.length,
      closedTrades: closedTrades.length,
      riskPercent: MT5_RISK_PERCENT,
      currency: mt5Account.currency || 'USD',
      dailyPnl: closedInfo.dailyPnl,
      historyFull: this.currentLogin() !== null && this.fullHistoryLoaded.has(this.currentLogin() as number),
      historySyncedAt: this.historySyncAt || null,
    };

    return { account, trades };
  }

  getPairTpSlStats(): Mt5PairTpSlStats[] {
    const openTickets = new Set(this.status.positions.map((position) => position.ticket));
    const closedTrades = this.getClosedTrades(openTickets).closedTrades;
    const bySymbol = new Map<string, Mt5PairTpSlStats>();
    for (const trade of closedTrades) {
      const entry = bySymbol.get(trade.symbol) ?? {
        symbol: trade.symbol,
        tp: 0,
        sl: 0,
        breakeven: 0,
        expired: 0,
        total: 0,
      };
      entry.total += 1;
      if (trade.outcome === 'TP_HIT') entry.tp += 1;
      else if (trade.outcome === 'SL_HIT') entry.sl += 1;
      else if (trade.outcome === 'BREAKEVEN_HIT') entry.breakeven += 1;
      else if (trade.outcome === 'EXPIRED') entry.expired += 1;
      bySymbol.set(trade.symbol, entry);
    }
    return [...bySymbol.values()].sort(
      (a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol)
    );
  }

  private currentLogin(): number | null {
    const login = this.status.account?.login;
    return typeof login === 'number' && login > 0 ? login : null;
  }

  private buildDailyPnl(closedTrades: Mt5Trade[]): DailyPnlEntry[] {
    const buckets = new Map<string, DailyPnlEntry>();
    const cutoff = Date.now() - DAILY_PNL_DAYS * 86_400_000;
    for (const trade of closedTrades) {
      if (trade.status !== 'CLOSED') continue;
      const closedAt = trade.closedAt ?? 0;
      if (!closedAt || closedAt < cutoff) continue;
      const date = new Date(closedAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')}`;
      const entry = buckets.get(key) ?? { date: key, pnl: 0, trades: 0, wins: 0 };
      entry.pnl += trade.pnl;
      entry.trades += 1;
      if (trade.pnl > 0) entry.wins += 1;
      buckets.set(key, entry);
    }
    return [...buckets.values()]
      .map((entry) => ({ ...entry, pnl: roundMoney(entry.pnl) }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, DAILY_PNL_DAYS);
  }

  private getClosedTrades(openTickets: Set<number>): {
    closedTrades: Mt5Trade[];
    dailyPnl: DailyPnlEntry[];
  } {
    const positionsKey = [...openTickets].sort((a, b) => a - b).join(',');
    if (this.closedTradeCache && this.closedTradeCache.positionsKey === positionsKey) {
      return { closedTrades: this.closedTradeCache.closedTrades, dailyPnl: this.closedTradeCache.dailyPnl };
    }
    const closedTrades = this.mapClosedTrades(openTickets);
    const dailyPnl = this.buildDailyPnl(closedTrades);
    this.closedTradeCache = { positionsKey, closedTrades, allTrades: [], dailyPnl };
    return { closedTrades, dailyPnl };
  }

  private mapOpenPosition(position: Mt5Position): Mt5Trade {
    return {
      id: `mt5-open-${position.ticket}`,
      signalId: `mt5-open-${position.ticket}`,
      symbol: position.symbol,
      direction: position.type === 'BUY' ? 'LONG' : 'SHORT',
      lotSize: position.volume,
      entryPrice: position.priceOpen,
      stopLoss: position.sl,
      takeProfit: position.tp,
      openedAt: position.time,
      openedAtUtc: new Date(position.time).toISOString(),
      closedAt: null,
      closedAtUtc: null,
      exitPrice: null,
      status: 'OPEN',
      outcome: null,
      pnl: 0,
      unrealizedPnl: roundMoney(position.profit + position.swap),
      balanceAfter: null,
      mt5Ticket: position.ticket,
      mt5Symbol: position.symbol,
      mt5Volume: position.volume,
      executedAt: position.time,
      executionError: null,
    };
  }

  private mapClosedTrades(openTickets: Set<number>): Mt5Trade[] {
    const groups = new Map<number, Mt5Deal[]>();
    for (const deal of this.history) {
      if (openTickets.has(deal.positionId)) continue;
      const group = groups.get(deal.positionId);
      if (group) {
        group.push(deal);
      } else {
        groups.set(deal.positionId, [deal]);
      }
    }

    const trades: Mt5Trade[] = [];
    for (const [positionId, deals] of groups) {
      const inDeals = deals.filter((deal) => deal.entry === 0);
      const outDeals = deals.filter((deal) => deal.entry !== 0);
      if (outDeals.length === 0) continue;

      const inVolume = sumVolume(inDeals);
      const outVolume = sumVolume(outDeals);
      const totalVolume = inVolume > 0 ? inVolume : outVolume;

      const inDeal = inDeals[0];
      // The final exit deal decides the outcome reason, not the first one.
      const outDeal = outDeals.reduce(
        (latest, deal) => (deal.time >= latest.time ? deal : latest),
        outDeals[0]
      );
      const direction = inDeal
        ? inDeal.type === 'BUY'
          ? 'LONG'
          : 'SHORT'
        : outDeal.type === 'BUY'
          ? 'SHORT'
          : 'LONG';

      const entryPrice = weightedPrice(
        inDeals.length > 0 ? inDeals : outDeals,
        outDeal.price
      );
      const exitPrice = weightedPrice(outDeals, outDeal.price);
      const pnl = roundMoney(
        deals.reduce(
          (sum, deal) => sum + deal.profit + deal.swap + deal.commission + deal.fee,
          0
        )
      );
      const openedAt = Math.min(...deals.map((deal) => deal.time));
      const closedAt = Math.max(...outDeals.map((deal) => deal.time));
      const symbol = outDeal.symbol || deals[0].symbol;
      const priceMove = (exitPrice - entryPrice) * (direction === 'LONG' ? 1 : -1);
      const breakevenTolerance = Math.abs(entryPrice) * 0.00001;
      const nearEntry = Math.abs(priceMove) <= breakevenTolerance;
      const reason = outDeal.reason;
      const manualClose = reason >= 0 && reason <= 3; // client / mobile / web / expert closes
      const outcome: SignalStatus =
        reason === DEAL_REASON_TP
          ? 'TP_HIT'
          : reason === DEAL_REASON_SL
            ? priceMove > -breakevenTolerance
              ? 'BREAKEVEN_HIT'
              : 'SL_HIT'
            : reason === DEAL_REASON_STOPOUT
              ? 'SL_HIT'
              : nearEntry
                ? 'BREAKEVEN_HIT'
                : manualClose
                  ? priceMove > 0
                    ? 'EXPIRED'
                    : 'SL_HIT'
                  : priceMove > 0
                    ? 'TP_HIT'
                    : 'SL_HIT';

      trades.push({
        id: `mt5-close-${positionId}`,
        signalId: `mt5-close-${positionId}`,
        symbol,
        direction,
        lotSize: roundMoney(totalVolume),
        entryPrice,
        stopLoss: 0,
        takeProfit: 0,
        openedAt,
        openedAtUtc: new Date(openedAt).toISOString(),
        closedAt,
        closedAtUtc: new Date(closedAt).toISOString(),
        exitPrice,
        status: 'CLOSED',
        outcome,
        pnl,
        unrealizedPnl: 0,
        balanceAfter: null,
        mt5Ticket: positionId,
        mt5Symbol: symbol,
        mt5Volume: roundMoney(totalVolume),
        executedAt: openedAt,
        executionError: null,
      });
    }

    return trades.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  }

  async connect(input: Mt5ConnectInput): Promise<Mt5MutationResult> {
    if (this.connecting) {
      return { ok: false, error: 'An MT5 connection is already in progress.', status: this.getStatus() };
    }
    const login = Number(input.login);
    const password = String(input.password ?? '');
    const server = String(input.server ?? '').trim();
    const terminalPath = String(input.terminalPath ?? '').trim();
    const symbolSuffix = String(input.symbolSuffix ?? '').trim();
    if (!Number.isInteger(login) || login <= 0) {
      return { ok: false, error: 'Enter a valid MT5 account number.', status: this.getStatus() };
    }
    if (!password) {
      return { ok: false, error: 'Enter the MT5 password.', status: this.getStatus() };
    }
    if (!server) {
      return { ok: false, error: 'Enter the MT5 server name.', status: this.getStatus() };
    }

    this.connecting = true;
    this.stopPolling();
    this.clearReconnectTimer();
    if (this.bridge) {
      try {
        await this.bridge.request('disconnect', {}, 5_000);
      } catch {
        // The old bridge is replaced below.
      }
      this.bridge.stop();
      this.bridge = null;
    }

    this.history = this.historyByLogin.get(login) ?? loadAccountHistory(login);
    this.historyByLogin.set(login, this.history);
    this.closedTradeCache = null;
    this.historyFetchedAt = 0;
    this.status = {
      ...DISCONNECTED_STATUS,
      state: 'CONNECTING',
      connected: false,
      config: { login, server, terminalPath, symbolSuffix },
    };

    const bridge = new Mt5Bridge();
    try {
      const connected = await bridge.request<{
        account: Mt5Account;
        terminal: Mt5Terminal;
      }>(
        'connect',
        { login, password, server, terminalPath },
        60_000
      );
      const positions = await bridge.request<{ positions: Mt5Position[] }>(
        'positions',
        {},
        20_000
      );
      this.bridge = bridge;
      this.setHistory(await this.syncFullHistory(login));
      this.historySyncAt = Date.now();
      this.historyFetchedAt = Date.now();
      this.historyByLogin.set(login, this.history);
      this.syncFailures = 0;
      this.status = {
        state: 'CONNECTED',
        connected: true,
        account: connected.account,
        terminal: connected.terminal,
        positions: positions.positions,
        config: { login, server, terminalPath, symbolSuffix },
        connectedAt: Date.now(),
        lastSyncAt: Date.now(),
        lastError: null,
      };
      this.startPolling();
      return { ok: true, status: this.getStatus() };
    } catch (error) {
      bridge.stop();
      this.bridge = null;
      this.status = {
        ...DISCONNECTED_STATUS,
        state: 'ERROR',
        config: { login, server, terminalPath, symbolSuffix },
        lastError: error instanceof Error ? error.message : 'MT5 connection failed.',
      };
      return { ok: false, error: this.status.lastError ?? 'MT5 connection failed.', status: this.getStatus() };
    } finally {
      this.connecting = false;
    }
  }

  async autoConnect(terminalPath = '', symbolSuffix = ''): Promise<Mt5MutationResult> {
    if (this.connecting) {
      return { ok: false, error: 'An MT5 connection is already in progress.', status: this.getStatus() };
    }
    if (this.isConnected()) {
      return { ok: true, status: this.getStatus() };
    }

    this.connecting = true;
    this.stopPolling();
    this.clearReconnectTimer();
    if (this.bridge) {
      try {
        await this.bridge.request('disconnect', {}, 5_000);
      } catch {
        // The old bridge is replaced below.
      }
      this.bridge.stop();
      this.bridge = null;
    }

    this.history = [];
    this.historyFetchedAt = 0;
    this.status = {
      ...DISCONNECTED_STATUS,
      state: 'CONNECTING',
      config: { login: 0, server: '', terminalPath, symbolSuffix },
    };

    const bridge = new Mt5Bridge();
    try {
      const attached = await bridge.request<{
        account: Mt5Account;
        terminal: Mt5Terminal;
      }>('attach', { terminalPath }, 60_000);
      const login = attached.account.login;
      this.history = this.historyByLogin.get(login) ?? loadAccountHistory(login);
      this.historyByLogin.set(login, this.history);
      this.closedTradeCache = null;
      this.historyFetchedAt = 0;

      const positions = await bridge.request<{ positions: Mt5Position[] }>(
        'positions',
        {},
        20_000
      );
      this.bridge = bridge;
      this.setHistory(await this.syncFullHistory(login));
      this.historySyncAt = Date.now();
      this.historyFetchedAt = Date.now();
      this.historyByLogin.set(login, this.history);
      this.syncFailures = 0;
      this.status = {
        state: 'CONNECTED',
        connected: true,
        account: attached.account,
        terminal: attached.terminal,
        positions: positions.positions,
        config: {
          login,
          server: attached.account.server,
          terminalPath,
          symbolSuffix,
        },
        connectedAt: Date.now(),
        lastSyncAt: Date.now(),
        lastError: null,
      };
      this.startPolling();
      return { ok: true, status: this.getStatus() };
    } catch (error) {
      bridge.stop();
      this.bridge = null;
      this.status = {
        ...DISCONNECTED_STATUS,
        state: 'ERROR',
        config: { login: 0, server: '', terminalPath, symbolSuffix },
        lastError: error instanceof Error ? error.message : 'MT5 auto-connect failed.',
      };
      return { ok: false, error: this.status.lastError ?? 'MT5 auto-connect failed.', status: this.getStatus() };
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<Mt5MutationResult> {
    this.stopPolling();
    this.clearReconnectTimer();
    const bridge = this.bridge;
    this.bridge = null;
    this.history = [];
    this.historyFetchedAt = 0;
    this.closedTradeCache = null;
    this.syncFailures = 0;
    if (bridge) {
      try {
        await bridge.request('disconnect', {}, 5_000);
      } catch {
        // The bridge is stopped below regardless.
      }
      bridge.stop();
    }
    this.status = { ...DISCONNECTED_STATUS };
    return { ok: true, status: this.getStatus() };
  }

  setSymbolSuffix(value: unknown): Mt5MutationResult {
    if (!this.status.config) {
      return { ok: false, error: 'Connect an MT5 account first.', status: this.getStatus() };
    }
    const symbolSuffix = String(value ?? '').trim();
    this.status = {
      ...this.status,
      config: { ...this.status.config, symbolSuffix },
    };
    return { ok: true, status: this.getStatus() };
  }

  async listSymbols(): Promise<Mt5SymbolInfo[]> {
    if (!this.isConnected() || !this.bridge) return [];
    const data = await this.bridge.request<{ symbols: Mt5SymbolInfo[] }>('symbols', {}, 30_000);
    return Array.isArray(data?.symbols) ? data.symbols : [];
  }

  async fetchCandles(symbol: string, interval: string, count: number): Promise<Mt5Candle[]> {
    if (!this.isConnected() || !this.bridge) return [];
    const data = await this.bridge.request<{ candles: Mt5Candle[] }>(
      'candles',
      {
        symbol,
        suffix: this.status.config?.symbolSuffix ?? '',
        interval,
        count,
      },
      30_000
    );
    return Array.isArray(data?.candles) ? data.candles : [];
  }

  async getQuote(symbol: string): Promise<{ price: number; time: number } | null> {
    if (!this.isConnected() || !this.bridge) return null;
    const data = await this.bridge.request<{ price: number; time: number }>(
      'quote',
      {
        symbol,
        suffix: this.status.config?.symbolSuffix ?? '',
      },
      15_000
    );
    return data && Number.isFinite(data.price) && data.price > 0 ? data : null;
  }

  async placeOrder(order: Mt5OrderInput): Promise<Mt5OrderResult> {
    if (!this.isConnected() || !this.bridge) {
      throw new Error('Connect an MT5 account before sending orders.');
    }
    if (!this.status.terminal?.tradeAllowed) {
      throw new Error('MT5 Algo Trading is disabled. Turn it on in the terminal first.');
    }
    const data = await this.bridge.request<Mt5OrderResult>(
      'place',
      {
        symbol: order.symbol,
        direction: order.direction === 'LONG' ? 'BUY' : 'SELL',
        volume: order.volume,
        sl: order.sl,
        tp: order.tp,
        slDistance: order.slDistance,
        tpDistance: order.tpDistance,
        deviation: order.deviation ?? 20,
        suffix: this.status.config?.symbolSuffix ?? '',
        dedupe: 1,
      },
      60_000
    );
    void this.sync();
    return data;
  }

  async closePosition(
    ticket: number,
    volume?: number
  ): Promise<{ closed: boolean; ticket: number; price?: number; message?: string }> {
    if (!this.isConnected() || !this.bridge) {
      throw new Error('MT5 is not connected.');
    }
    const payload: Record<string, unknown> = { ticket };
    if (volume && volume > 0) payload.volume = volume;
    const result = await this.bridge.request<{ closed: boolean; ticket: number; price?: number; message?: string }>(
      'close',
      payload,
      60_000
    );
    void this.sync();
    return result;
  }

  async modifyPosition(ticket: number, sl: number, tp: number): Promise<{ modified: boolean; ticket: number; message?: string }> {
    if (!this.isConnected() || !this.bridge) {
      throw new Error('MT5 is not connected.');
    }
    const result = await this.bridge.request<{ modified: boolean; ticket: number; message?: string }>(
      'modify',
      { ticket, sl, tp },
      30_000
    );
    void this.sync();
    return result;
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.sync(), 10_000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async sync(): Promise<void> {
    if (this.pollBusy || !this.isConnected() || !this.bridge) return;
    this.pollBusy = true;
    const bridge = this.bridge;
    try {
      const [account, positions] = await Promise.all([
        bridge.request<{ account: Mt5Account; terminal: Mt5Terminal }>('account', {}, 20_000),
        bridge.request<{ positions: Mt5Position[] }>('positions', {}, 20_000),
      ]);
      if (Date.now() - this.historyFetchedAt > HISTORY_TTL_MS) {
        this.historyFetchedAt = Date.now();
        const login = this.currentLogin();
        if (login !== null) {
          try {
            const incremental = await bridge.request<{ deals: Mt5Deal[] }>(
              'history',
              { days: HISTORY_DAYS_LIMIT },
              30_000
            );
            const merged = mergeAccountDeals(this.history, incremental.deals);
            if (merged.length !== this.history.length) {
              this.setHistory(merged);
              saveAccountHistory(login, this.status.account?.server ?? '', merged);
              this.historySyncAt = Date.now();
            }
          } catch {
            // Keep the previous history snapshot if the broker call fails.
          }
        }
      }
      this.syncFailures = 0;
      this.status = {
        ...this.status,
        state: 'CONNECTED',
        connected: true,
        account: account.account,
        terminal: account.terminal,
        positions: positions.positions,
        lastSyncAt: Date.now(),
        lastError: null,
      };
    } catch (error) {
      this.syncFailures += 1;
      const message = error instanceof Error ? error.message : 'MT5 account sync failed.';
      this.status = {
        ...this.status,
        connected: this.isConnected() && this.syncFailures < SYNC_FAILURE_LIMIT,
        lastError: message,
      };
      if (this.syncFailures >= SYNC_FAILURE_LIMIT) {
        this.stopPolling();
        this.status = { ...this.status, state: 'ERROR', connected: false };
        this.scheduleReconnect();
      }
    } finally {
      this.pollBusy = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.connecting) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isConnected() || this.connecting) return;
      const config = this.status.config;
      this.status = {
        ...this.status,
        state: 'CONNECTING',
        connected: false,
        lastError: 'MT5 connection lost. Reconnecting...',
      };
      void this.autoConnect(config?.terminalPath ?? '', config?.symbolSuffix ?? '').then(
        (result) => {
          if (result.ok) return;
          this.scheduleReconnect();
        }
      );
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
