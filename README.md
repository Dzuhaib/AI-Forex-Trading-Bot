<p align="center">
  <img src="./assets/banner.png" alt="Forex Trading Bot - live OANDA signals, analytics, and risk-managed automation" width="100%" />
</p>

<div align="center">

# Forex Trading Bot

**A full-stack Forex signal engine with optional MetaTrader 5 demo execution, powered by live OANDA market data.**

Signals · Risk management · Live analytics · Trade journal · MT5 execution

<br />

[![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=111111)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

[![OANDA](https://img.shields.io/badge/OANDA-v20-00A3E0?style=for-the-badge)](https://developer.oanda.com/)
[![Risk](https://img.shields.io/badge/risk-5%25%20of%20balance-FF3B30?style=for-the-badge)](#risk-model)
[![Reward](https://img.shields.io/badge/reward-1%3A2%20RR-34C759?style=for-the-badge)](#risk-model)
[![Mode](https://img.shields.io/badge/mode-MT5%20demo-0071E3?style=for-the-badge)](#important-limitations)

<br />

<img src="https://skillicons.dev/icons?i=nodejs,typescript,react,vite,express,tailwind,git,github&perline=8" alt="Node.js, TypeScript, React, Vite, Express, Tailwind CSS, Git, GitHub" />

</div>

---

## Overview

**Forex Trading Bot** is a self-hosted Forex dashboard that turns live OANDA price data into actionable, risk-defined trade ideas. It scans 14 FX, metal, energy, and crypto instruments, detects high-volume untested supply and demand zones, confirms entries with M1 reversal volume, and tracks each idea through take profit, stop loss, ambiguity, or expiry.

The app combines a real-time signal engine with a polished React interface and a broker-backed trade journal. Execution and account data are MT5-only: the dashboard does not create simulated or paper trades. When a MetaTrader 5 demo account is connected, balance, equity, positions, and closed deals come from that broker account. It is designed as an educational and research platform for building disciplined, risk-first trading workflows.

> **This is a demo trading system.** Signals are generated from live OANDA market data. When connected, new signals are also executed on a MetaTrader 5 demo account. Real MT5 accounts are rejected by the broker layer.

---

## Why This Project

Most signal dashboards stop at a marker on a chart. This project focuses on the full workflow:

- **Risk-defined signals** — every trade targets **5% of the current account balance**.
- **Per-instrument 2R targets** — each pair has a fixed stop distance, with take profit at **2× the stop**.
- **Live market context** — current price, entry, stop, target, R multiple, and progress.
- **A visual trade state** — each open signal includes a compact SL-vs-TP tug-of-war scene with the live market marker and entry point.
- **A broker-backed account** — balance, equity, floating PnL, open positions, and closed deals come from the connected MT5 demo account. Nothing is simulated locally.
- **Operational safety** — same-origin mutation checks, rate limiting, JSON body limits, and hardened response headers.

---

## Features

### Signal engine

- 8 instruments: `XAUUSD`, `WTI`, `EURUSD`, `GBPUSD`, `BTCUSD`, `NZDUSD`, `NZDJPY`, and `GBPJPY`.
- H1 and M30 body-zone detection using high-volume candles.
- M1 reversal confirmation with relative volume expansion.
- Live S5 price refresh for open positions.
- One open position per symbol by default.
- 60-minute same-symbol re-entry cooldown.
- Automatic TP, SL, ambiguous-candle, and 24-hour expiry resolution.
- Duplicate signal protection and historical outcome tracking.

### MT5 demo execution

- Optional MetaTrader 5 login from the Trades page.
- Demo accounts only; real accounts are rejected before any order is sent.
- New signals place market orders with the engine's SL and TP on the MT5 side.
- Trailing-stop changes are mirrored to the open MT5 position.
- Balance, equity, margin, floating PnL, open positions, and closed MT5 deals drive the dashboard account and trade journal.
- Passwords stay in server memory only and are never written to disk or logs.
- Existing tracked signals are not back-filled to MT5 when you connect.

### Risk model

- **Risk per trade:** 5% of the current account balance; the connected MT5 demo balance is used for new entries when available.
- **Stop loss:** fixed **per-instrument distance**.
- **Take profit:** **2× the stop distance**.
- **Risk-to-reward ratio:** exactly **1:2**.
- **Breakeven trail:** at **70% of TP**, the stop moves to **1R (a 50% TP profit lock)**, then trails **30% of TP** behind the best favorable price so it can only continue toward profit.
- Position size is calculated from account risk, instrument pip size, contract units, and USD quote conversion.
- Lots round to the **0.01 lot step**, with a **0.01 minimum**, so actual risk can vary slightly.
- Open positions are re-targeted to the active risk model when the engine starts, while preserving any trailing-stop progress.

### Dashboard

- Live Signals and Trades pages.
- Mobile-first responsive layout.
- Open, TP, SL, breakeven, ambiguous, and expired signal filters.
- Per-signal mini tug-of-war visualization with an SL/TP scale, live market marker, and entry tick.
- Market watch strip with current prices and 24-hour context.
- Account summary with balance, equity, realized PnL, floating PnL, and open trade count from MT5 when connected.
- Trade history with entry, stop, target, exit, lot size, and outcome.
- Automatic per-trade position sizing and balance deposits.

### Engineering

- Shared TypeScript types between server and client.
- Persistent local state file for signals, trades, and account balance.
- Express API with Vite middleware in development.
- Security headers and mutation protection.
- Reduced-motion support for dashboard animations.
- Production build through Vite.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js |
| Language | TypeScript |
| Frontend | React 19 |
| Build tool | Vite 8 |
| Styling | Tailwind CSS 4 |
| Backend | Express 4 |
| Market data | OANDA v20 REST API |
| Icons | Lucide React |
| Persistence | JSON state file |

<p align="center">
  <img src="https://skillicons.dev/icons?i=nodejs,typescript,react,vite,express,tailwind,git,github&perline=8" alt="Technology stack" />
</p>

---

## How It Works

```text
OANDA S5 prices
      │
      ▼
H1 / M30 untested high-volume body zones
      │
      ▼
M1 reversal candle + volume confirmation
      │
      ▼
Duplicate and cooldown checks
      │
      ▼
5% balance risk + per-pair SL + 2R TP
      │
      ▼
MT5 market order placed (only while connected)
      │
      ▼
TP / SL / ambiguous / expiry watcher
      │
      ▼
Trade history, account balance, and dashboard update
```

### 1. Market data

The server refreshes S5 candles for the configured symbols and keeps the latest price in memory. Open signals receive live prices without waiting for the next scan.

### 2. Zone discovery

H1 and M30 candles are analyzed for high-volume body zones. A zone is considered untested when price has not revisited its body. Distance, volume ratio, direction, and timeframe are retained for the dashboard.

### 3. Entry confirmation

The engine looks for a reversal candle touching an untested zone. Long setups require a green M1 candle at demand; short setups require a red M1 candle at supply. Relative volume must exceed the confirmation threshold.

### 4. Risk and target calculation

When a signal is accepted:

```text
riskUsd = account balance × 5%
slDistance = per-instrument stop distance
tpDistance = 2 × slDistance
lotSize = riskUsd / (slDistance × value per lot)
```

The engine converts the fixed pip distances into instrument prices using each symbol's pip size. Position size is derived from the 5% risk target, contract units, and USD quote conversion, then rounded to the 0.01 lot step. Stop loss and take profit are placed symmetrically around the entry, with TP at twice the stop distance.

### 5. Trade lifecycle

The engine tracks each open signal against live candles. A trade closes when:

- take profit is reached,
- stop loss is reached,
- an ambiguous candle touches both levels,
- the maximum tracking window expires.

Closed trades are read from MT5 history. The dashboard does not maintain a local simulated trade journal.

### 6. MT5 demo execution

On the Trades page, enter the MT5 demo account number, password, server, and optional terminal path. The broker symbol suffix is detected automatically from the logged-in terminal. The server starts a Python bridge and keeps the password in memory only.

When a new signal is accepted while connected, the bridge resolves the broker symbol, floor-rounds the position size to the broker volume step, and sends a market order with the engine's existing SL and TP. Trailing-stop changes are mirrored to the MT5 position. While disconnected, signals are still generated but nothing is executed or added to the trade journal. The dashboard account summary and trade journal are sourced from the MT5 demo account (open positions plus the last 90 days of closed deals), shown 10 trades per page.

### 7. Dashboard updates

The React client polls the signal API, renders live cards, and keeps the market strip, account summary, and trade journal in sync.

---

## Quick Start

### Requirements

- Node.js 20 or newer
- npm
- An OANDA v20 API token
- Optional: MetaTrader 5 terminal and Python 3.10+ for demo order execution
- Optional: Python `MetaTrader5` package (`pip install MetaTrader5`)

### 1. Clone the repository

```bash
git clone https://github.com/Dzuhaib/AI-Forex-Trading-Bot.git
cd AI-Forex-Trading-Bot
```

### 2. Install dependencies

```bash
npm install --legacy-peer-deps
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and add your OANDA credentials:

```env
OANDA_API_KEY=your_oanda_v20_token
OANDA_ENVIRONMENT=practice
SIGNAL_REENTRY_COOLDOWN_MIN=60
```

Use `practice` while developing. Switch to `live` only when you understand the risks and have verified your OANDA account configuration.

### 4. Start the app

```bash
npm run dev
```

Open [http://localhost:5000](http://localhost:5000).

The first scan can take a moment while the engine loads candles. The dashboard will populate as market data arrives.

Dashboard pair selections and the detected MT5 symbol suffix are saved to `data/dashboard-state.json`. Once saved, that exact active pair list is restored on restart instead of the defaults, including removals and MT5-only pairs. The suffix is re-detected automatically on every connect and stored exactly as the broker uses it (`m`, `.m`, `c`, etc.).

### 5. Optional MT5 demo execution

1. Install and open MetaTrader 5.
2. Log in to a **demo** account.
3. Enable **Algo Trading** in the MT5 toolbar.
4. If Python is not on `PATH`, set `MT5_PYTHON` in `.env`.
5. Open the Trades page and fill in the MT5 account number, password, server, and optional terminal path.
6. Connect. Only signals opened after connecting are sent to MT5.

The password is kept in server memory only. It is not written to disk, local storage, or logs.

---

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OANDA_API_KEY` | required | OANDA v20 API token. Never commit this value. |
| `OANDA_ENVIRONMENT` | `practice` | `practice` or `live`. |
| `SIGNAL_ENGINE_ENABLED` | `true` | Enable or disable signal generation. |
| `SIGNAL_SCAN_INTERVAL_MS` | `25000` | Zone scan interval. |
| `SIGNAL_WATCH_INTERVAL_MS` | `5000` | Open-trade watcher interval. |
| `SIGNAL_PRICE_INTERVAL_MS` | `500` | S5 live-price refresh interval. |
| `SIGNAL_MAX_TRACK_HOURS` | `24` | Maximum lifetime for an open signal. |
| `SIGNAL_MAX_OPEN_PER_SYMBOL` | `1` | Maximum simultaneous open signals per symbol. |
| `SIGNAL_REENTRY_COOLDOWN_MIN` | `60` | Same-symbol re-entry cooldown in minutes. |
| `SIGNAL_LEVERAGE` | `10` | Leverage value shown in return-on-equity calculations. |
| `SIGNAL_SCAN_CONCURRENCY` | `10` | Parallel symbol scans. |
| `SIGNAL_WATCH_CONCURRENCY` | `6` | Parallel trade watchers. |
| `SIGNAL_PAIRS` | 8 (XAUUSD, WTI, EURUSD, GBPUSD, BTCUSD, NZDUSD, NZDJPY, GBPJPY) | Initial active pairs when no dashboard state has been saved. All OANDA FX pairs and connected MT5 broker symbols are available from the dashboard pair search. |
| `MT5_PYTHON` | `python` | Python executable used to start the MetaTrader 5 bridge. |
| `MT5_TERMINAL_PATH` | auto-detect | Optional `terminal64.exe` path for auto-connect. |
| `MT5_SYMBOL_SUFFIX` | auto-detected | Fallback only. On connect, the suffix is detected from the MT5 symbol catalog and saved exactly as the broker uses it: `m`, `.m`, `c`, `.c`, etc. |
| `GEMINI_API_KEY` | unset | Gemini TTS key for voice-trade announcements. Falls back to browser speech when unset. |

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Express server with Vite middleware. |
| `npm run start` | Start the server using the `start` script. |
| `npm run lint` | Type-check the project with `tsc --noEmit`. |
| `npm run build` | Create the production client bundle in `dist/`. |

---

## Project Structure

```text
.
├── assets/
│   └── banner.png
├── src/
│   ├── components/
│   │   ├── TradesViewer.tsx
│   │   ├── LiveSignalsViewer.tsx
│   │   ├── MiniTugOfWar.tsx
│   │   └── ...
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   └── types.ts
├── .env.example
├── .gitignore
├── dashboardState.ts
├── data/
│   └── dashboard-state.json
├── index.html
├── package.json
├── server.ts
├── signalEngine.ts
└── README.md
```

---

## API Reference

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/signals` | Full dashboard payload: signals, market, account, and trades. |
| `POST` | `/api/signals/scan` | Trigger an immediate scan. |
| `GET` | `/api/pairs` | Pair catalog, aliases, categories, and active pairs. |
| `POST` | `/api/pairs/add` | Add an active pair and persist the list. |
| `POST` | `/api/pairs/remove` | Remove an active pair and persist the list. |
| `GET` | `/api/mt5/status` | MT5 connection, account, and broker positions. |
| `POST` | `/api/mt5/connect` | Connect an MT5 account; credentials stay in memory. |
| `POST` | `/api/mt5/disconnect` | Disconnect MT5 and stop the broker bridge. |
| `POST` | `/api/mt5/symbol-suffix` | Advanced override for an exact broker suffix such as `m` or `.m`; normal connects auto-detect it. |

All state-changing routes are same-origin guarded and rate-limited to 30 requests per minute per client.

---

## Risk Model

The engine is intentionally explicit about risk:

- **Account risk:** 5% of the current balance at signal creation; when MT5 is connected, new entries use the MT5 demo balance.
- **Stop distance:** fixed per instrument.
- **Take-profit distance:** 2× the stop distance.
- **Risk-to-reward:** exactly 1:2.
- **Breakeven trail:** once price reaches 70% of TP, SL moves to 1R (a 50% TP profit lock) and then trails 30% of TP behind the best favorable price.
- **Position size:** calculated automatically and rounded to the nearest 0.01 lot, with a 0.01 minimum.
- **Balance model:** balance and equity are read directly from MT5; equity includes floating PnL.

Because lots round to 0.01, the actual risk can be slightly above or below 5%. The engine uses the nearest available lot.

Trailing stops are evaluated on closed candles after SL/TP checks, so the engine does not assume an intrabar high or low occurred before a stop was touched. The original risk distance remains the denominator for MFE/MAE and unrealized R calculations after the stop moves.

When a trailed stop closes a trade at or above entry for a long, or at or below entry for a short, the outcome is recorded as **breakeven hit** instead of **SL hit**. Breakeven exits have their own dashboard count and history filter, are excluded from the SL total, and count as wins in the win-rate calculation.

---

## Security Notes

- `.env` and runtime state are gitignored.
- Mutation routes reject cross-origin requests.
- Same-origin `Sec-Fetch-Site` checks are enforced when present.
- Mutation requests are rate-limited.
- JSON bodies are capped at 16 KB.
- Security headers include `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Resource-Policy`.
- The Express fingerprint header is disabled.
- JSON responses are escaped.
- MT5 passwords are held in server memory only and are never persisted or returned by the API.
- MT5 order placement rejects non-demo accounts.

Never expose your OANDA API token or MT5 password in the browser, screenshots, issues, or commits.

---

## Important Limitations

- This project is **not** a live trading system. It does not submit OANDA orders.
- MT5 execution is limited to **demo accounts**; real accounts are rejected.
- When MT5 is disconnected, signals still generate but there is no account balance, execution, or local trade journal. When connected, balance and trades come from the MT5 demo account.
- Existing open signals are not back-filled to MT5 on connect; only new signals are executed.
- The MT5 bridge requires the MetaTrader 5 terminal to stay open and Algo Trading to be enabled.
- Broker suffixes such as `m` or `.m` are detected automatically; a different terminal path can still be set manually.
- The local JSON state file is suitable for a single-instance demo, not a horizontally scaled production deployment.
- The included Express + Vite setup expects a persistent Node.js process.
- Market data availability and rate limits depend on your OANDA account.
- Nothing in this repository is financial advice.

---

## Author

**Dzuhaib**

Builder of risk-first trading dashboards and full-stack market tooling. This project explores how live market data, deterministic volume analysis, disciplined risk sizing, and a clean interface can work together in one self-hosted system.

- GitHub: [@Dzuhaib](https://github.com/Dzuhaib)
- Repository: [AI-Forex-Trading-Bot](https://github.com/Dzuhaib/AI-Forex-Trading-Bot)

---

## Disclaimer

Trading Forex, metals, energy, and crypto involves substantial risk. This software is provided for educational and research purposes only. Past demo performance does not guarantee future results. Always test with a practice account and never risk capital you cannot afford to lose.

<p align="center">
  <sub>Built with Node.js, TypeScript, React, and OANDA market data.</sub>
</p>
