import type { LiveSignal } from '../types';
import { BeastGlyph } from './MarketBeasts';

export function MiniTugOfWar({ signal }: { signal: LiveSignal }) {
  const span = signal.takeProfit - signal.stopLoss;
  const live = signal.livePrice ?? signal.entry;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const entryPosition = span === 0 ? 0.5 : clamp((signal.entry - signal.stopLoss) / span);
  const marketPosition = span === 0 ? 0.5 : clamp((live - signal.stopLoss) / span);
  const plotX = (position: number) => 72 + position * 216;
  const entryX = plotX(entryPosition);
  const offset = plotX(marketPosition) - 180;

  return (
    <svg
      viewBox="0 0 360 64"
      className="mt-3 block w-full"
      role="img"
      aria-label={`${signal.symbol} market at ${Math.round(marketPosition * 100)} percent between the red bear stop loss and green bull take profit`}
    >
      <rect x="8" y="52" width="56" height="9" rx="4.5" fill="#ffe9e7" />
      <rect x="296" y="52" width="56" height="9" rx="4.5" fill="#e4f7e9" />

      <path
        d="M64 34 L296 34"
        stroke="#e5e5ea"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d={`M${entryX} 29 L${entryX} 39`}
        stroke="#1d1d1f"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.45"
      />

      <BeastGlyph
        kind="bear"
        animated
        transform="translate(13 3) scale(0.56) rotate(2 48 48)"
      />
      <BeastGlyph
        kind="bull"
        animated
        flip
        transform="translate(292 3) scale(0.56) rotate(-2 48 48)"
      />

      <g className="tug-mini-marker" style={{ transform: `translateX(${offset}px)` }}>
        <circle cx="180" cy="34" r="7" fill="#ffffff" />
        <circle cx="180" cy="34" r="5" fill="#0071e3" />
      </g>
    </svg>
  );
}
