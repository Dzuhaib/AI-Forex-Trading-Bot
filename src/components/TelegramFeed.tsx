import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCheck, Eye, RefreshCw, TriangleAlert } from 'lucide-react';
import type {
  SignalDirection,
  SignalStatus,
  TelegramFeedMessage,
  TelegramFeedResponse,
  TelegramSignalInfo,
} from '../types';

const POLL_MS = 5_000;

const RESULT_META: Partial<
  Record<SignalStatus, { title: string; tone: string; icon: string; quote?: string }>
> = {
  TP_HIT: {
    title: 'TAKE PROFIT HIT',
    tone: 'text-[#4fdc8c]',
    icon: '✅',
    quote: 'Another one secured! Stay disciplined, team. 🎯💰',
  },
  SL_HIT: {
    title: 'STOP LOSS HIT',
    tone: 'text-[#ff8b80]',
    icon: '❌',
    quote: 'No emotions, no revenge trading. Next setup awaits! 🎯',
  },
  BREAKEVEN_HIT: {
    title: 'BREAKEVEN HIT',
    tone: 'text-[#c2a5ff]',
    icon: '⚖️',
    quote: 'Capital protected! Stay patient, next opportunity awaits! 🎯',
  },
  AMBIGUOUS: { title: 'CHOPPY EXIT', tone: 'text-[#ffce7b]', icon: '⚠️' },
  EXPIRED: { title: 'EXPIRED', tone: 'text-[#8fa3b3]', icon: '⏰' },
};

const BREAKEVEN_QUOTE = 'Risk secured! Let the trade run. 🎯';

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(1);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 10) return value.toFixed(3);
  return value.toFixed(5);
}

function lockedProfitPct(signal: TelegramSignalInfo): number | null {
  const tpDistance = Math.abs(signal.takeProfit - signal.entry);
  const locked =
    signal.direction === 'LONG' ? signal.stopLoss - signal.entry : signal.entry - signal.stopLoss;
  if (!(tpDistance > 0) || !Number.isFinite(locked)) return null;
  const pct = (locked / tpDistance) * 100;
  return pct > 0.5 ? Math.round(pct) : null;
}

function messageClock(postedAt: number | null, signal: TelegramSignalInfo | null): string {
  const ms = postedAt ?? Date.parse(signal?.resolvedAtUtc ?? signal?.signalTimeUtc ?? '');
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(ms: number): string {
  const today = new Date();
  const day = new Date(ms);
  const isToday =
    today.getFullYear() === day.getFullYear() &&
    today.getMonth() === day.getMonth() &&
    today.getDate() === day.getDate();
  if (isToday) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === day.getFullYear() &&
    yesterday.getMonth() === day.getMonth() &&
    yesterday.getDate() === day.getDate();
  if (isYesterday) return 'Yesterday';
  return day.toLocaleDateString([], { month: 'long', day: 'numeric' });
}

function ValueRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[13px] text-[#8fa3b3]">{label}</span>
      <span className="font-mono text-[13px] font-medium text-[#f5f5f5]">{children}</span>
    </div>
  );
}

function CodeValue({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-[#232e3c] px-1 py-px">{children}</span>;
}

function MessageBubble({
  message,
  channelTitle,
  showChannelName,
}: {
  message: TelegramFeedMessage;
  channelTitle: string;
  showChannelName: boolean;
}) {
  const signal = message.signal;
  const failed = message.status === 'FAILED';
  const meta = signal ? RESULT_META[signal.status] : undefined;
  const directionTone: Record<SignalDirection, string> = {
    LONG: 'text-[#4fdc8c]',
    SHORT: 'text-[#ff8b80]',
  };

  return (
    <div className="flex">
      <div
        className={`relative max-w-[88%] rounded-xl bg-[#182533] px-3 py-2 text-[14px] leading-[1.45] text-[#f5f5f5] shadow-[0_1px_1px_rgba(0,0,0,0.35)] ${
          failed ? 'ring-1 ring-[#ff8b80]/40' : ''
        }`}
      >
        {showChannelName && (
          <div className="mb-0.5 text-[13px] font-semibold text-[#2ea6ff]">{channelTitle}</div>
        )}

        {message.kind === 'SIGNAL' && signal && (
          <>
            <div className="mb-1 text-[15px] font-semibold text-[#2ea6ff]">🆕 NEW SIGNAL</div>
            <div className="text-[15px] font-bold text-[#f5f5f5]">
              📊 {signal.symbol} <span className="font-normal text-[#8fa3b3]">|</span>{' '}
              {signal.timeframe}
            </div>
            <div className={`text-[15px] font-bold ${directionTone[signal.direction]}`}>
              {signal.direction === 'LONG' ? '🟢 BUY' : '🔴 SELL'}
            </div>
            <div className="mt-1.5 space-y-0.5">
              <ValueRow label="🎯 Entry">
                <CodeValue>{formatPrice(signal.entry)}</CodeValue>
              </ValueRow>
              <ValueRow label="🛑 Stop Loss">
                <CodeValue>{formatPrice(signal.stopLoss)}</CodeValue>
              </ValueRow>
              <ValueRow label="💰 Take Profit">
                <CodeValue>{formatPrice(signal.takeProfit)}</CodeValue>
              </ValueRow>
              <ValueRow label="⚖️ Risk/Reward">
                <CodeValue>1:2</CodeValue>
              </ValueRow>
            </div>
            <div className="mt-1.5 space-y-0.5">
              <ValueRow label="📈 Zone">
                <CodeValue>{signal.htfVolRatio.toFixed(1)}x</CodeValue>
              </ValueRow>
              <ValueRow label="📊 M1 Volume">
                <CodeValue>{signal.m1VolRatio.toFixed(1)}x</CodeValue>
              </ValueRow>
            </div>
            <div className="mt-1.5 text-[13px] text-[#8fa3b3]">
              ⏳ Trade Safe &amp; Manage Your Risk..
            </div>
          </>
        )}

        {message.kind === 'BREAKEVEN' && signal && (
          <>
            <div className="mb-1 text-[15px] font-semibold text-[#c2a5ff]">
              🔒 1R REACHED — 50% BOOKED
            </div>
            <div className="text-[15px] font-bold text-[#f5f5f5]">
              📊 Pair: {signal.symbol}
            </div>
            <div className="mt-1 text-[14px] text-[#f5f5f5]">💰 Booked 50% of the position at 1R.</div>
            <div className="mt-0.5 text-[14px] text-[#f5f5f5]">🛑 Stop Loss moved to entry (breakeven).</div>
            {signal.stopLoss !== null && signal.stopLoss !== undefined && (
              <div className="mt-0.5 text-[14px] text-[#f5f5f5]">
                🛑 New Stop Loss: <code className="font-mono">{formatPrice(signal.stopLoss)}</code>
              </div>
            )}
            <div className="mt-1.5 text-[13px] italic text-[#9fb3c2]">{BREAKEVEN_QUOTE}</div>
          </>
        )}

        {message.kind === 'RESULT' && signal && meta && (
          <>
            <div className={`mb-1 text-[15px] font-bold ${meta.tone}`}>
              {meta.icon} {meta.title}
            </div>
            <div className="text-[15px] font-bold text-[#f5f5f5]">
              📊 Pair: {signal.symbol}
            </div>
            <div className="mt-1 space-y-0.5">
              {signal.resolutionPrice !== null && signal.resolutionPrice !== undefined && (
                <ValueRow label="🚪 Exit Price">
                  <CodeValue>{formatPrice(signal.resolutionPrice)}</CodeValue>
                </ValueRow>
              )}
              {signal.resultR !== null && signal.resultR !== undefined && (
                <ValueRow
                  label={signal.resultR < 0 ? '📉 Result' : signal.resultR > 0 ? '📈 Result' : '📊 Result'}
                >
                  <span className={signal.resultR > 0 ? 'text-[#4fdc8c]' : signal.resultR < 0 ? 'text-[#ff8b80]' : ''}>
                    {signal.resultR > 0 ? '+' : ''}
                    {signal.resultR.toFixed(2)}R
                  </span>
                </ValueRow>
              )}
              {lockedProfitPct(signal) !== null && (
                <ValueRow label="🔒 Profit Locked">
                  <span>{lockedProfitPct(signal)}% of TP</span>
                </ValueRow>
              )}
              {signal.holdMinutes !== null && signal.holdMinutes !== undefined && (
                <ValueRow label="⏱ Duration">
                  <CodeValue>{formatDuration(signal.holdMinutes)}</CodeValue>
                </ValueRow>
              )}
            </div>
          </>
        )}

        {message.kind === 'RESULT' && signal && meta?.quote && (
          <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[13px] italic leading-relaxed text-[#9fb3c2]">
            {meta.quote}
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-1.5">
          {failed ? (
            <span
              className="flex items-center gap-1 text-[11px] text-[#ff8b80]"
              title={message.error ?? undefined}
            >
              <TriangleAlert className="h-3 w-3" />
              not delivered{message.error ? `: ${message.error}` : ''}
            </span>
          ) : (
            <>
              <Eye className="h-3 w-3 text-[#6d7d8b]" />
              <span className="text-[11px] text-[#6d7d8b]">1.2K</span>
              <CheckCheck className="h-3.5 w-3.5 text-[#4fb0df]" />
            </>
          )}
          <span className="text-[11px] text-[#6d7d8b]">{messageClock(message.postedAt, signal)}</span>
        </div>
      </div>
    </div>
  );
}

export function TelegramFeed() {
  const [feed, setFeed] = useState<TelegramFeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  const load = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const response = await fetch('/api/telegram/feed', { cache: 'no-store' });
      if (!response.ok) throw new Error('Fetch failed');
      setFeed((await response.json()) as TelegramFeedResponse);
      setError(null);
    } catch {
      setError('Could not reach the Telegram feed.');
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const count = feed?.messages.length ?? 0;
    if (scrollRef.current && count !== lastCountRef.current) {
      lastCountRef.current = count;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feed]);

  const channelTitle = feed?.chatTitle || feed?.chatId || 'Channel';
  const messages = feed?.messages ?? [];

  return (
    <section className="mx-auto w-full max-w-[1200px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
            Telegram Channel
          </h1>
          <p className="text-[13px] text-[#86868b]">
            Live preview of every signal posted to the channel.
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 text-[13px] font-medium text-[#1d1d1f] shadow-sm hover:bg-[#f5f5f7] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-black/[0.1] bg-[#0e1621] shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
        <header className="flex h-[60px] items-center gap-3 border-b border-black/20 bg-[#17212b] px-4">
          <ArrowLeft className="h-5 w-5 text-[#8fa3b3]" />
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #5aa7ef 0%, #6e56cf 100%)' }}
          >
            {(channelTitle.startsWith('@') ? channelTitle.slice(1) : channelTitle)
              .charAt(0)
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-[#f5f5f5]">{channelTitle}</div>
            <div className="text-[12px] text-[#6d7d8b]">
              {feed?.enabled ? 'channel · signals' : 'not connected'}
            </div>
          </div>
          <span
            className={`h-2 w-2 rounded-full ${
              feed?.enabled ? 'bg-[#4fdc8c]' : 'bg-[#6d7d8b]'
            } ${feed?.enabled ? 'animate-pulse' : ''}`}
          />
        </header>

        <div
          ref={scrollRef}
          className="scrollbar-none flex h-[540px] flex-col gap-2 overflow-y-auto px-4 py-4"
        >
          {!feed?.enabled && (
            <div className="m-auto max-w-[340px] rounded-xl bg-[#182533] px-4 py-3 text-center text-[13px] leading-relaxed text-[#8fa3b3]">
              Telegram posting is not configured. Add{' '}
              <code className="text-[#2ea6ff]">TELEGRAM_BOT_TOKEN</code> and{' '}
              <code className="text-[#2ea6ff]">TELEGRAM_CHAT_ID</code> to the .env file and restart
              the server.
            </div>
          )}
          {feed?.enabled && error && (
            <div className="mx-auto rounded-lg bg-[#182533] px-3 py-2 text-[12px] text-[#ff8b80]">
              {error}
            </div>
          )}
          {feed?.enabled && !error && messages.length === 0 && (
            <div className="m-auto text-center text-[13px] text-[#6d7d8b]">
              No signals posted yet. New signals appear here the moment they hit the channel.
            </div>
          )}
          {messages.map((message, index) => {
            const previous = index > 0 ? messages[index - 1] : null;
            const previousDay =
              previous?.postedAt ?? (Date.parse(previous?.signal?.signalTimeUtc ?? '') || null);
            const day = message.postedAt ?? Date.parse(message.signal?.signalTimeUtc ?? '');
            const showDay =
              Number.isFinite(day) &&
              (!previousDay || !Number.isFinite(previousDay) || dayLabel(previousDay) !== dayLabel(day));
            return (
              <React.Fragment key={message.id}>
                {showDay && Number.isFinite(day) && (
                  <div className="mx-auto my-1 rounded-full bg-[#182533]/70 px-3 py-0.5 text-[11px] text-[#8fa3b3]">
                    {dayLabel(day)}
                  </div>
                )}
                <MessageBubble
                  message={message}
                  channelTitle={channelTitle}
                  showChannelName={index === 0 || previous?.kind !== message.kind}
                />
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-[#86868b]">
        Preview only — these messages are delivered by the bot to the real channel. Updates every{' '}
        {POLL_MS / 1000}s.
      </p>
    </section>
  );
}
