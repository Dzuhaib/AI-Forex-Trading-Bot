import fs from 'fs';
import path from 'path';

export interface DashboardState {
  activePairs?: string[];
  mt5SymbolSuffix?: string;
}

const STATE_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(STATE_DIR, 'dashboard-state.json');

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
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
