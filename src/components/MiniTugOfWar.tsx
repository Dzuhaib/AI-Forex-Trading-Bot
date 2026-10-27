import type { LiveSignal } from '../types';

function MiniTrader({
  side,
  hoodie,
  hoodieDark,
  hair,
  skin,
}: {
  side: 'left' | 'right';
  hoodie: string;
  hoodieDark: string;
  hair: string;
  skin: string;
}) {
  return (
    <g transform={side === 'right' ? 'translate(324 0) scale(-1 1)' : 'translate(36 0)'}>
      <path
        d="M-6 45 L-7 52"
        stroke="#3a3a3c"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M6 45 L7 52"
        stroke="#3a3a3c"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <ellipse cx="-7" cy="53" rx="4" ry="2" fill="#1d1d1f" />
      <ellipse cx="7" cy="53" rx="4" ry="2" fill="#1d1d1f" />

      <path
        d="M-11 24 C-14 30 -13 40 -10 46 L10 46 C13 40 14 30 11 24 C5 21 -5 21 -11 24Z"
        fill={hoodie}
      />
      <path
        d="M-9 26 C-3 30 3 30 9 26"
        fill="none"
        stroke={hoodieDark}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M-4 31 Q0 34 4 31"
        fill="none"
        stroke={hoodieDark}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.45"
      />

      <circle cx="0" cy="13" r="8.5" fill={skin} />
      <circle cx="-8.5" cy="14" r="2.2" fill={skin} />
      <path
        d="M-8.5 11 C-8 5 -4 3 0 3 C5 3 8 6 8.5 11 C4 8 -4 8 -8.5 11Z"
        fill={hair}
      />

      <circle cx="-3" cy="13" r="0.9" fill="#1d1d1f" />
      <circle cx="3" cy="13" r="0.9" fill="#1d1d1f" />
      <path
        d="M-1.8 16 Q0 17.8 1.8 16"
        fill="none"
        stroke="#1d1d1f"
        strokeWidth="1"
        strokeLinecap="round"
      />

      <path
        d="M9 30 C16 31 22 33 28 33.8"
        fill="none"
        stroke={hoodie}
        strokeWidth="5.2"
        strokeLinecap="round"
      />
      <circle cx="28" cy="34" r="2.7" fill={skin} />
    </g>
  );
}

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
      aria-label={`${signal.symbol} market at ${Math.round(marketPosition * 100)} percent between stop loss and take profit`}
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

      <MiniTrader
        side="left"
        hoodie="#ff3b30"
        hoodieDark="#b81f18"
        hair="#35241f"
        skin="#e9b08a"
      />
      <MiniTrader
        side="right"
        hoodie="#34c759"
        hoodieDark="#137a31"
        hair="#473224"
        skin="#f2c4a2"
      />

      <g className="tug-mini-marker" style={{ transform: `translateX(${offset}px)` }}>
        <circle cx="180" cy="34" r="7" fill="#ffffff" />
        <circle cx="180" cy="34" r="5" fill="#0071e3" />
      </g>
    </svg>
  );
}
