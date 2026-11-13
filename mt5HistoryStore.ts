import fs from 'fs';
import path from 'path';

export interface Mt5DealRecord {
  positionId: number;
  ticket: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  volume: number;
  price: number;
  profit: number;
  swap: number;
  commission: number;
  fee: number;
  entry: number;
  time: number;
  comment: string;
  magic: number;
  reason: number;
}

interface HistoryFile {
  login: number;
  server: string;
  savedAt: number;
  deals: Mt5DealRecord[];
}

const STATE_DIR = path.join(process.cwd(), 'data');

function historyFile(login: number): string {
  return path.join(STATE_DIR, `mt5-history-${login}.json`);
}

function normalizeDeal(raw: unknown): Mt5DealRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const deal = raw as Record<string, unknown>;
  const positionId = Number(deal.positionId);
  const ticket = Number(deal.ticket);
  if (!Number.isFinite(positionId) || positionId <= 0) return null;
  if (!Number.isFinite(ticket) || ticket <= 0) return null;
  const symbol = String(deal.symbol ?? '').trim();
  if (!symbol) return null;
  return {
    positionId,
    ticket,
    symbol,
    type: deal.type === 'SELL' ? 'SELL' : 'BUY',
    volume: Number(deal.volume) || 0,
    price: Number(deal.price) || 0,
    profit: Number(deal.profit) || 0,
    swap: Number(deal.swap) || 0,
    commission: Number(deal.commission) || 0,
    fee: Number(deal.fee) || 0,
    entry: Number(deal.entry) || 0,
    time: Number(deal.time) || 0,
    comment: String(deal.comment ?? ''),
    magic: Number(deal.magic) || 0,
    reason: Number.isFinite(Number(deal.reason)) ? Number(deal.reason) : -1,
  };
}

export function loadAccountHistory(login: number): Mt5DealRecord[] {
  try {
    const raw = fs.readFileSync(historyFile(login), 'utf8');
    const parsed = JSON.parse(raw) as HistoryFile;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.deals)) return [];
    const byTicket = new Map<number, Mt5DealRecord>();
    for (const deal of parsed.deals) {
      const normalized = normalizeDeal(deal);
      if (normalized) byTicket.set(normalized.ticket, normalized);
    }
    return [...byTicket.values()];
  } catch {
    return [];
  }
}

export function saveAccountHistory(
  login: number,
  server: string,
  deals: Mt5DealRecord[]
): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file: HistoryFile = {
    login,
    server: server || '',
    savedAt: Date.now(),
    deals: [...deals].sort((a, b) => a.time - b.time),
  };
  const tmp = `${historyFile(login)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(file)}\n`, 'utf8');
  try {
    fs.renameSync(tmp, historyFile(login));
  } catch {
    fs.copyFileSync(tmp, historyFile(login));
    try {
      fs.unlinkSync(tmp);
    } catch {
      // The rename may have succeeded after all.
    }
  }
}

export function mergeAccountDeals(
  existing: Mt5DealRecord[],
  incoming: Mt5DealRecord[]
): Mt5DealRecord[] {
  const byTicket = new Map<number, Mt5DealRecord>();
  for (const deal of existing) {
    byTicket.set(deal.ticket, deal);
  }
  for (const deal of incoming) {
    const cached = byTicket.get(deal.ticket);
    if (!cached) {
      byTicket.set(deal.ticket, deal);
      continue;
    }
    const isEntry = (deal: Mt5DealRecord): boolean => deal.entry === 0;
    if (isEntry(cached) && !isEntry(deal)) byTicket.set(deal.ticket, deal);
  }
  return [...byTicket.values()].sort((a, b) => a.time - b.time);
}

export function listAccountHistoryLogins(): number[] {
  try {
    return fs
      .readdirSync(STATE_DIR)
      .filter((name) => /^mt5-history-\d+\.json$/.test(name))
      .map((name) => Number(name.match(/\d+/)?.[0] ?? 0))
      .filter((login) => login > 0);
  } catch {
    return [];
  }
}
