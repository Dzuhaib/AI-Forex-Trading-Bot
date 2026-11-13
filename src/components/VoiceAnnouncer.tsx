import React, { useEffect, useRef } from 'react';
import type { Mt5Trade, SignalStatus } from '../types';
import { announce, isVoiceEnabled, unlockVoice } from '../lib/voiceState';

const POLL_MS = 2000;

function spokenSymbol(symbol: string): string {
  const [base = '', ...suffixParts] = symbol.toUpperCase().split('.');
  const suffix = suffixParts.join('').replace(/[^A-Z0-9]/g, '');
  let rest = base.replace(/[^A-Z0-9]/g, '');
  const tokens: string[] = [];
  while (rest.length > 3) {
    tokens.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  if (rest) tokens.push(rest);
  return [tokens.join(' '), suffix].filter(Boolean).join(' ');
}

function spokenOutcome(outcome: SignalStatus | null): string {
  switch (outcome) {
    case 'TP_HIT':
      return 'take profit hit';
    case 'SL_HIT':
      return 'stop loss hit';
    case 'BREAKEVEN_HIT':
      return 'breakeven hit';
    case 'AMBIGUOUS':
      return 'closed ambiguous';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'closed';
  }
}

function spokenMoney(value: number): string {
  const sign = value < 0 ? 'a loss of' : 'a profit of';
  return `${sign} $${Math.abs(value).toFixed(2)}`;
}

function isExecuted(trade: Mt5Trade): boolean {
  return trade.mt5Ticket !== null && !trade.executionError;
}

function handleTrade(trade: Mt5Trade, hydrated: boolean, seen: Set<string>): void {
  const key = trade.id;

  if (trade.status === 'OPEN' && isExecuted(trade)) {
    if (seen.has(key)) return;
    seen.add(key);
    if (hydrated) {
      const side = trade.direction === 'LONG' ? 'long' : 'short';
      announce(
        `Trade executed: ${spokenSymbol(trade.symbol)}, ${side}, ${trade.lotSize.toFixed(2)} lots.`
      );
    }
    return;
  }

  if (trade.status === 'CLOSED') {
    const closeKey = `closed:${key}`;
    if (seen.has(closeKey)) return;
    if (!seen.has(key)) {
      seen.add(key);
    }
    seen.add(closeKey);
    if (hydrated && isExecuted(trade)) {
      announce(
        `Trade closed: ${spokenSymbol(trade.symbol)}, ${spokenOutcome(trade.outcome)}, ${spokenMoney(trade.pnl)}.`
      );
    }
  }
}

export const VoiceAnnouncer: React.FC = () => {
  const openedSeen = useRef<Set<string>>(new Set());
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const response = await fetch('/api/signals', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { trades?: Mt5Trade[] };
        if (cancelled) return;
        const trades = payload.trades ?? [];
        for (const trade of trades) {
          handleTrade(trade, hydrated.current, openedSeen.current);
        }
        hydrated.current = true;
      } catch {
        // network issues are surfaced by the dashboards; voice stays quiet
      }
    };

    const timer = window.setInterval(() => void poll(), POLL_MS);
    void poll();

    const unlock = (): void => {
      if (isVoiceEnabled()) unlockVoice();
    };
    window.addEventListener('pointerdown', unlock, { once: true });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', unlock);
    };
  }, []);

  return null;
};
