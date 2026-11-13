import React, { useEffect, useState } from 'react';
import { Speech, Volume2, VolumeX } from 'lucide-react';
import { LiveSignalsViewer } from './components/LiveSignalsViewer';
import { TradesViewer } from './components/TradesViewer';
import { TelegramFeed } from './components/TelegramFeed';
import { VoiceAnnouncer } from './components/VoiceAnnouncer';
import { announce, isVoiceEnabled, setVoiceEnabled, subscribeVoice } from './lib/voiceState';

type Tab = 'LIVE_SIGNALS' | 'TRADES' | 'TELEGRAM';

const NAV_ITEMS: Array<{ tab: Tab; label: string }> = [
  { tab: 'LIVE_SIGNALS', label: 'Live Signals' },
  { tab: 'TRADES', label: 'Trades' },
  { tab: 'TELEGRAM', label: 'Telegram' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('LIVE_SIGNALS');
  const [voiceOn, setVoiceOn] = useState<boolean>(() => isVoiceEnabled());

  useEffect(() => subscribeVoice(() => setVoiceOn(isVoiceEnabled())), []);

  return (
    <div className="flex min-h-dvh flex-col bg-[#f5f5f7] font-sans text-[#1d1d1f]">
      <header className="sticky top-0 z-50 border-b border-black/[0.08] bg-white">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-8">
          <div className="flex h-[60px] items-center justify-between gap-4 sm:h-[68px]">
            <button
              onClick={() => setActiveTab('LIVE_SIGNALS')}
              className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#1d1d1f] text-[11px] font-semibold tracking-[-0.02em] text-white">
                FX
              </span>
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
                Forex Trading Bot
              </span>
            </button>
              <button
                onClick={() => announce('Voice test. The system is scanning for levels to execute trades.')}
                title="Test voice announcement"
                aria-label="Test voice announcement"
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 active:opacity-70 ${
                  voiceOn ? 'bg-white text-[#1d1d1f]' : 'bg-white text-[#aeaeb2]'
                }`}
              >
                <Speech className="h-4 w-4" />
              </button>
              <button
                onClick={() => setVoiceEnabled(!isVoiceEnabled())}
              title={voiceOn ? 'Voice assistant on — click to mute' : 'Voice assistant muted — click to unmute'}
              aria-label={voiceOn ? 'Mute voice assistant' : 'Unmute voice assistant'}
              aria-pressed={voiceOn}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 active:opacity-70 ${
                voiceOn ? 'bg-[#1d1d1f] text-white' : 'bg-white text-[#86868b]'
              }`}
            >
              {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>

          <nav className="scrollbar-none flex gap-6 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.tab;
              return (
                <button
                  key={item.tab}
                  onClick={() => setActiveTab(item.tab)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative shrink-0 whitespace-nowrap py-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 ${
                    active ? 'font-semibold text-[#1d1d1f]' : 'font-normal text-[#86868b]'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#1d1d1f]" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
        {activeTab === 'LIVE_SIGNALS' ? (
          <LiveSignalsViewer />
        ) : activeTab === 'TRADES' ? (
          <TradesViewer />
        ) : (
          <TelegramFeed />
        )}
      </main>
      <VoiceAnnouncer />

      <footer className="mx-auto flex w-full max-w-[1200px] flex-col items-start justify-between gap-1 border-t border-black/[0.06] px-4 py-5 text-[11px] text-[#86868b] sm:flex-row sm:items-center sm:px-8 sm:py-6">
        <span>Forex Trading Bot</span>
        <span>Signal tracking · MT5 trade execution</span>
      </footer>
    </div>
  );
}
