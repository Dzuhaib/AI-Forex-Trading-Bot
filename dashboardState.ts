import fs from 'fs';
import path from 'path';
import type { Mt5AccountMeta } from './src/types';

export interface DashboardState {
  activePairs?: string[];
  mt5SymbolSuffix?: string;
  riskPercent?: number;
  mt5Accounts?: Mt5AccountMeta[];
}

const STATE_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(STATE_DIR, 'dashboard-state.json');

function normalizeAccountKey(account: Mt5AccountMeta): string {
  return `${account.login}@${account.server.trim().toUpperCase()}`;
}

export function saveMt5Account(account: Mt5AccountMeta): void {
  const current = readState();
  const existing: Mt5AccountMeta[] = Array.isArray(current.mt5Accounts)
    ? current.mt5Accounts
    : [];
  const byKey = new Map(existing.map((entry) => [normalizeAccountKey(entry), entry]));
  byKey.set(normalizeAccountKey(account), {
    ...byKey.get(normalizeAccountKey(account)),
    ...account,
  });
  saveDashboardState({ mt5Accounts: [...byKey.values()] });
}

function readState(): DashboardState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as DashboardState;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadDashboardState(): DashboardState {
  const state = readState();
  const result: DashboardState = {};
  if (Array.isArray(state.activePairs)) {
    result.activePairs = state.activePairs
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
  }
  if (typeof state.mt5SymbolSuffix === 'string') {
    result.mt5SymbolSuffix = state.mt5SymbolSuffix.trim();
  }
  if (typeof state.riskPercent === 'number' && Number.isFinite(state.riskPercent)) {
    result.riskPercent = state.riskPercent;
  }
  if (Array.isArray(state.mt5Accounts)) {
    const accounts: Mt5AccountMeta[] = [];
    for (const entry of state.mt5Accounts) {
      const login = Number(entry?.login);
      const server = String(entry?.server ?? '').trim();
      if (!Number.isInteger(login) || login <= 0 || !server) continue;
      accounts.push({
        login,
        server,
        name: String(entry?.name ?? ''),
        company: String(entry?.company ?? ''),
        currency: String(entry?.currency ?? ''),
      });
    }
    result.mt5Accounts = accounts;
  }
  return result;
}

export function saveDashboardState(patch: Partial<DashboardState>): void {
  const current = readState();
  const next: DashboardState = {
    activePairs: Array.isArray(patch.activePairs)
      ? patch.activePairs.map((value) => String(value ?? '').trim()).filter(Boolean)
      : current.activePairs,
    mt5SymbolSuffix:
      typeof patch.mt5SymbolSuffix === 'string'
        ? patch.mt5SymbolSuffix.trim()
        : current.mt5SymbolSuffix,
    riskPercent:
      typeof patch.riskPercent === 'number' && Number.isFinite(patch.riskPercent)
        ? patch.riskPercent
        : current.riskPercent,
    mt5Accounts: Array.isArray(patch.mt5Accounts) ? patch.mt5Accounts : current.mt5Accounts,
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
