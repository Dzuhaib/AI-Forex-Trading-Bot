from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback
from datetime import datetime, timedelta

import MetaTrader5 as mt5

MAGIC = 20261030
COMMENT = "ForexBot"


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _account_payload() -> dict:
    info = mt5.account_info()
    if info is None:
        raise RuntimeError(f"MT5 account_info failed: {mt5.last_error()}")
    return {
        "login": int(info.login),
        "name": str(info.name or ""),
        "server": str(info.server or ""),
        "company": str(info.company or ""),
        "currency": str(info.currency or ""),
        "balance": float(info.balance),
        "equity": float(info.equity),
        "profit": float(info.profit),
        "margin": float(info.margin),
        "marginFree": float(info.margin_free),
        "marginLevel": float(info.margin_level) if info.margin_level else None,
        "leverage": int(info.leverage),
        "tradeMode": int(info.trade_mode),
        "isDemo": int(info.trade_mode) == 0,
        "tradeAllowed": bool(info.trade_allowed),
        "tradeExpert": bool(info.trade_expert),
        "credit": float(info.credit),
    }


def _terminal_payload() -> dict:
    info = mt5.terminal_info()
    if info is None:
        return {
            "connected": False,
            "tradeAllowed": False,
            "path": "",
            "name": "",
            "company": "",
            "build": 0,
        }
    return {
        "connected": bool(info.connected),
        "tradeAllowed": bool(info.trade_allowed),
        "path": str(info.path or ""),
        "name": str(info.name or ""),
        "company": str(info.company or ""),
        "build": int(info.build),
    }


def _normalize_terminal_path(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if os.path.isdir(raw):
        return os.path.join(raw, "terminal64.exe")
    return raw


def _attach(payload: dict) -> dict:
    terminal_path = _normalize_terminal_path(payload.get("terminalPath"))

    mt5.shutdown()
    init_kwargs: dict = {}
    if terminal_path:
        init_kwargs["path"] = terminal_path
    if not mt5.initialize(**init_kwargs):
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")

    return {
        "account": _account_payload(),
        "terminal": _terminal_payload(),
    }


def _connect(payload: dict) -> dict:
    login = int(payload.get("login") or 0)
    password = str(payload.get("password") or "")
    server = str(payload.get("server") or "").strip()
    terminal_path = _normalize_terminal_path(payload.get("terminalPath"))

    if login <= 0:
        raise ValueError("Enter a valid MT5 account number.")
    if not password:
        raise ValueError("Enter the MT5 password.")
    if not server:
        raise ValueError("Enter the MT5 server name.")

    mt5.shutdown()
    init_kwargs: dict = {}
    if terminal_path:
        init_kwargs["path"] = terminal_path
    if not mt5.initialize(**init_kwargs):
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")

    if not mt5.login(login, password=password, server=server):
        error = mt5.last_error()
        mt5.shutdown()
        raise RuntimeError(f"MT5 login failed: {error}")

    account = _account_payload()
    return {
        "account": account,
        "terminal": _terminal_payload(),
    }


def _positions_payload() -> list[dict]:
    positions = mt5.positions_get()
    if positions is None:
        error = mt5.last_error()
        if error and error[0] != 1:
            raise RuntimeError(f"MT5 positions_get failed: {error}")
        return []

    result: list[dict] = []
    for position in positions:
        result.append(
            {
                "ticket": int(position.ticket),
                "symbol": str(position.symbol),
                "type": "BUY" if int(position.type) == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": float(position.volume),
                "priceOpen": float(position.price_open),
                "priceCurrent": float(position.price_current),
                "sl": float(position.sl),
                "tp": float(position.tp),
                "profit": float(position.profit),
                "swap": float(position.swap),
                "magic": int(position.magic),
                "comment": str(position.comment or ""),
                "time": int(position.time) * 1000,
            }
        )
    return sorted(result, key=lambda item: item["time"], reverse=True)


def _history_payload(payload: dict) -> dict:
    days_raw = payload.get("days")
    full_history = days_raw == "all" or bool(payload.get("all"))
    date_to = datetime.now() + timedelta(days=1)
    if full_history:
        date_from = datetime(1970, 1, 2)
    else:
        try:
            days = int(days_raw or 30)
        except (TypeError, ValueError):
            days = 30
        days = max(1, min(days, 3650))
        date_from = date_to - timedelta(days=days + 1)
    deals = mt5.history_deals_get(date_from, date_to)
    if deals is None:
        error = mt5.last_error()
        if error and error[0] != 1:
            raise RuntimeError(f"MT5 history_deals_get failed: {error}")
        return {"deals": []}

    result: list[dict] = []
    for deal in deals:
        position_id = int(getattr(deal, "position_id", 0) or 0)
        symbol = str(getattr(deal, "symbol", "") or "")
        if position_id <= 0 or not symbol:
            continue
        reason = getattr(deal, "reason", None)
        result.append(
            {
                "positionId": position_id,
                "ticket": int(deal.ticket),
                "symbol": symbol,
                "type": "BUY" if int(deal.type) == mt5.DEAL_TYPE_BUY else "SELL",
                "volume": float(deal.volume),
                "price": float(deal.price),
                "profit": float(deal.profit),
                "swap": float(deal.swap),
                "commission": float(getattr(deal, "commission", 0.0) or 0.0),
                "fee": float(getattr(deal, "fee", 0.0) or 0.0),
                "entry": int(deal.entry),
                "time": int(deal.time) * 1000,
                "comment": str(getattr(deal, "comment", "") or ""),
                "magic": int(getattr(deal, "magic", 0) or 0),
                "reason": int(reason) if reason is not None else -1,
            }
        )
    return {"deals": result}


def _find_symbol(name: str, suffix: str) -> object:
    raw = str(name or "").strip()
    if not raw:
        raise ValueError("Missing symbol.")
    core, _, dot_suffix = raw.partition(".")
    core = core.strip().upper()
    if not core:
        raise ValueError("Missing symbol.")
    dot_suffix = dot_suffix.strip()
    suffix_text = str(suffix or "").strip()
    if (
        suffix_text
        and not dot_suffix
        and core.upper().endswith(suffix_text.upper())
        and len(core) > len(suffix_text)
    ):
        core = core[: -len(suffix_text)]

    suffix_trials: list[str] = []
    if suffix_text:
        suffix_trials.append(suffix_text)
        if suffix_text.startswith(".") and len(suffix_text) > 1:
            suffix_trials.append(suffix_text[1:])
        elif not suffix_text.startswith("."):
            suffix_trials.append(f".{suffix_text}")
    if dot_suffix:
        suffix_trials.append(dot_suffix)
        suffix_trials.append(f".{dot_suffix}")
    suffix_trials = list(dict.fromkeys(suffix_trials))

    candidates: list[str] = []
    if dot_suffix:
        candidates.append(f"{core}.{dot_suffix}")
    for trial in suffix_trials:
        candidates.append(f"{core}{trial}")
    candidates.append(core)
    candidates = list(dict.fromkeys(candidates))
    for candidate in candidates:
        info = mt5.symbol_info(candidate)
        if info is None:
            if mt5.symbol_select(candidate, True):
                info = mt5.symbol_info(candidate)
        if info is not None:
            if not info.visible:
                mt5.symbol_select(info.name, True)
            return info

    aliases = {
        "XAUUSD": ["GOLD", "XAUUSD"],
        "WTI": ["WTIUSD", "XTIUSD", "USOIL", "CRUDOIL"],
        "BTCUSD": ["BTCUSD", "BITCOIN"],
    }
    alias_suffixes = [""] + suffix_trials
    for alias in aliases.get(core, []):
        for suffix_value in alias_suffixes:
            candidate = f"{alias}{suffix_value}"
            info = mt5.symbol_info(candidate)
            if info is None and mt5.symbol_select(candidate, True):
                info = mt5.symbol_info(candidate)
            if info is not None:
                if not info.visible:
                    mt5.symbol_select(info.name, True)
                return info

    core_normalized = core.replace("_", "").replace("-", "")
    prefix_matches: list[tuple[int, object]] = []
    for symbol in mt5.symbols_get() or []:
        symbol_name = str(symbol.name).upper().split(".")[0]
        normalized = symbol_name.replace("_", "").replace("-", "")
        if normalized == core_normalized:
            if not symbol.visible:
                mt5.symbol_select(symbol.name, True)
            info = mt5.symbol_info(symbol.name)
            if info is not None:
                return info
        elif normalized.startswith(core_normalized):
            prefix_matches.append((len(normalized), symbol))
    if prefix_matches:
        prefix_matches.sort(key=lambda item: item[0])
        symbol = prefix_matches[0][1]
        if not symbol.visible:
            mt5.symbol_select(symbol.name, True)
        info = mt5.symbol_info(symbol.name)
        if info is not None:
            return info

    raise RuntimeError(f"MT5 symbol not found: {name} (suffix: {suffix_text or 'none'})")


def _volume_for_symbol(info: object, requested: float) -> float:
    step = float(getattr(info, "volume_step", 0.01) or 0.01)
    minimum = float(getattr(info, "volume_min", 0.01) or 0.01)
    maximum = float(getattr(info, "volume_max", 100.0) or 100.0)
    volume = math.floor(float(requested) / step + 1e-9) * step
    volume = round(volume, 8)
    if volume < minimum:
        raise ValueError(
            f"Calculated volume {requested:.4f} is below the broker minimum {minimum:.4f}."
        )
    if volume > maximum:
        volume = round(maximum, 8)
    return volume


def _filling_mode(info: object) -> int:
    allowed = int(getattr(info, "filling_mode", 0) or 0)
    if allowed & 2:
        return mt5.ORDER_FILLING_IOC
    if allowed & 1:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


def _find_open_position(symbol: str, order_ticket: int) -> object | None:
    positions = mt5.positions_get(symbol=symbol) or []
    for position in positions:
        if int(position.ticket) == int(order_ticket):
            return position
    matches = [position for position in positions if int(position.magic) == MAGIC]
    if not matches:
        return None
    return max(matches, key=lambda item: int(item.time))


def _normalize_price(symbol_info: object, value: float) -> float:
    tick_size = float(getattr(symbol_info, "trade_tick_size", 0) or 0)
    if tick_size <= 0:
        tick_size = float(getattr(symbol_info, "point", 0) or 0)
    digits = int(getattr(symbol_info, "digits", 0) or 0)
    if tick_size > 0:
        value = round(value / tick_size) * tick_size
    return round(value, digits)


def _place_order(payload: dict) -> dict:
    symbol_info = _find_symbol(str(payload.get("symbol") or ""), str(payload.get("suffix") or ""))
    symbol = str(symbol_info.name)
    direction = str(payload.get("direction") or "").upper()
    if direction not in ("BUY", "SELL"):
        raise ValueError("Direction must be BUY or SELL.")

    sl = float(payload.get("sl") or 0)
    tp = float(payload.get("tp") or 0)
    sl_distance = float(payload.get("slDistance") or 0)
    tp_distance = float(payload.get("tpDistance") or 0)

    if int(payload.get("dedupe") or 0):
        want_buy = direction == "BUY"
        for position in mt5.positions_get(symbol=symbol) or []:
            same_side = (
                int(position.type) == mt5.POSITION_TYPE_BUY and want_buy
            ) or (
                int(position.type) == mt5.POSITION_TYPE_SELL and not want_buy
            )
            if same_side:
                raise RuntimeError(
                    f"Duplicate trade blocked: an open {direction} position already exists "
                    f"on {symbol} (ticket {position.ticket})."
                )

    volume = _volume_for_symbol(symbol_info, float(payload.get("volume") or 0))
    tick = _tick_payload(symbol_info, retries=12)
    if tick["bid"] <= 0 or tick["ask"] <= 0:
        raise RuntimeError(f"MT5 tick unavailable for {symbol}.")

    is_buy = direction == "BUY"
    price = float(tick["ask"] if is_buy else tick["bid"])

    point = float(getattr(symbol_info, "point", 0) or 0)
    stops_points = int(getattr(symbol_info, "trade_stops_level", 0) or 0)
    freeze_points = int(getattr(symbol_info, "trade_freeze_level", 0) or 0)
    spread = float(tick["ask"]) - float(tick["bid"])
    min_distance = max(stops_points, freeze_points) * point + max(spread, 0.0) + point

    if sl_distance > 0 and tp_distance > 0:
        # Re-derive stops from the live execution price so a quote/drift between
        # signal generation and order placement can never produce invalid stops.
        sl_distance = max(sl_distance, min_distance)
        tp_distance = max(tp_distance, min_distance)
        sl = price - sl_distance if is_buy else price + sl_distance
        tp = price + tp_distance if is_buy else price - tp_distance
    elif not sl > 0 or not tp > 0:
        raise ValueError("Both SL and TP are required for an MT5 order.")
    elif min_distance > 0:
        # Backwards-compatible absolute levels: push them outside the broker's
        # minimum stop distance when needed.
        if is_buy:
            sl = min(sl, price - min_distance)
            tp = max(tp, price + min_distance)
        else:
            sl = max(sl, price + min_distance)
            tp = min(tp, price - min_distance)

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        "price": price,
        "sl": _normalize_price(symbol_info, sl),
        "tp": _normalize_price(symbol_info, tp),
        "deviation": int(payload.get("deviation") or 20),
        "magic": MAGIC,
        "comment": COMMENT,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _filling_mode(symbol_info),
    }
    result = mt5.order_send(request)
    if result is None:
        raise RuntimeError(f"MT5 order_send failed: {mt5.last_error()}")
    if result.retcode not in (
        mt5.TRADE_RETCODE_DONE,
        mt5.TRADE_RETCODE_DONE_PARTIAL,
        mt5.TRADE_RETCODE_PLACED,
    ):
        raise RuntimeError(
            f"MT5 rejected order ({result.retcode}): {result.comment or 'no broker comment'}"
        )

    order_ticket = int(result.order or result.deal or 0)
    position = _find_open_position(symbol, order_ticket)
    position_ticket = int(position.ticket) if position is not None else order_ticket
    return {
        "ticket": position_ticket,
        "order": order_ticket,
        "deal": int(result.deal or 0),
        "symbol": symbol,
        "volume": float(result.volume or volume),
        "price": float(result.price or request["price"]),
        "retcode": int(result.retcode),
        "comment": str(result.comment or ""),
    }


def _close_position(payload: dict) -> dict:
    ticket = int(payload.get("ticket") or 0)
    if ticket <= 0:
        raise ValueError("Missing MT5 position ticket.")
    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        return {"closed": False, "ticket": ticket, "message": "Position is already closed."}
    position = positions[0]
    symbol_info = mt5.symbol_info(position.symbol)
    if symbol_info is None:
        raise RuntimeError(f"MT5 symbol unavailable for {position.symbol}.")
    tick = _tick_payload(symbol_info, retries=12)
    if tick["bid"] <= 0 or tick["ask"] <= 0:
        raise RuntimeError(f"MT5 quote unavailable for {position.symbol}.")

    is_buy = int(position.type) == mt5.POSITION_TYPE_BUY
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "volume": float(position.volume),
        "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        "position": ticket,
        "price": float(tick["bid"] if is_buy else tick["ask"]),
        "deviation": int(payload.get("deviation") or 20),
        "magic": MAGIC,
        "comment": COMMENT,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _filling_mode(symbol_info),
    }
    result = mt5.order_send(request)
    if result is None:
        raise RuntimeError(f"MT5 close failed: {mt5.last_error()}")
    if result.retcode not in (
        mt5.TRADE_RETCODE_DONE,
        mt5.TRADE_RETCODE_DONE_PARTIAL,
        mt5.TRADE_RETCODE_PLACED,
    ):
        raise RuntimeError(
            f"MT5 close rejected ({result.retcode}): {result.comment or 'no broker comment'}"
        )
    return {
        "closed": True,
        "ticket": ticket,
        "price": float(result.price or request["price"]),
        "retcode": int(result.retcode),
    }


def _modify_position(payload: dict) -> dict:
    ticket = int(payload.get("ticket") or 0)
    if ticket <= 0:
        raise ValueError("Missing MT5 position ticket.")
    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        return {"modified": False, "ticket": ticket, "message": "Position is no longer open."}
    position = positions[0]
    symbol_info = mt5.symbol_info(position.symbol)
    if symbol_info is None:
        raise RuntimeError(f"MT5 symbol unavailable for {position.symbol}.")
    sl = float(payload.get("sl") or position.sl)
    tp = float(payload.get("tp") or position.tp)
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": position.symbol,
        "position": ticket,
        "sl": round(sl, int(symbol_info.digits)),
        "tp": round(tp, int(symbol_info.digits)),
        "magic": MAGIC,
        "comment": COMMENT,
    }
    result = mt5.order_send(request)
    if result is None:
        raise RuntimeError(f"MT5 modify failed: {mt5.last_error()}")
    if result.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED):
        raise RuntimeError(
            f"MT5 modify rejected ({result.retcode}): {result.comment or 'no broker comment'}"
        )
    return {"modified": True, "ticket": ticket, "retcode": int(result.retcode)}


TIMEFRAME_MAP = {
    "S5": mt5.TIMEFRAME_M1,
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
}

TIMEFRAME_SECONDS = {
    "S5": 60,
    "M1": 60,
    "M5": 300,
    "M15": 900,
    "M30": 1800,
    "H1": 3600,
    "H4": 14400,
    "D1": 86400,
}


def _tick_payload(symbol_info: object, retries: int = 0, delay: float = 0.25) -> dict:
    name = str(symbol_info.name)
    tick = None
    for attempt in range(max(0, retries) + 1):
        tick = mt5.symbol_info_tick(name)
        if tick is not None and (tick.bid > 0 or tick.ask > 0 or tick.last > 0):
            break
        if attempt < retries:
            if not symbol_info.visible:
                mt5.symbol_select(name, True)
            time.sleep(delay)
    bid = float(tick.bid) if tick else 0.0
    ask = float(tick.ask) if tick else 0.0
    last = float(tick.last) if tick else 0.0
    mid = (bid + ask) / 2 if bid > 0 and ask > 0 else last
    return {
        "bid": bid,
        "ask": ask,
        "last": last,
        "mid": float(mid or 0.0),
        "time": int(tick.time) if tick else 0,
    }


def _symbols_payload(_payload: dict) -> dict:
    rows: list[dict] = []
    for symbol_info in mt5.symbols_get() or []:
        tick = _tick_payload(symbol_info)
        rows.append(
            {
                "name": str(symbol_info.name),
                "path": str(symbol_info.path or ""),
                "description": str(symbol_info.description or ""),
                "digits": int(symbol_info.digits),
                "point": float(symbol_info.point),
                "contractSize": float(symbol_info.trade_contract_size),
                "volumeMin": float(symbol_info.volume_min),
                "volumeStep": float(symbol_info.volume_step),
                "tradeMode": int(symbol_info.trade_mode),
                "stopsLevel": int(getattr(symbol_info, "trade_stops_level", 0) or 0),
                "bid": tick["bid"],
                "ask": tick["ask"],
                "last": tick["last"],
                "mid": tick["mid"],
                "time": tick["time"],
            }
        )
    return {"symbols": rows}


def _server_time_offset(symbol_info: object) -> int:
    tick = mt5.symbol_info_tick(symbol_info.name)
    if tick is None or not tick.time:
        return 0
    offset = int(tick.time) - int(time.time())
    if abs(offset) > 6 * 3600:
        return 0
    return offset


def _candles_payload(payload: dict) -> dict:
    symbol_info = _find_symbol(str(payload.get("symbol") or ""), str(payload.get("suffix") or ""))
    interval = str(payload.get("interval") or "M1").upper()
    timeframe = TIMEFRAME_MAP.get(interval)
    if timeframe is None:
        raise ValueError(f"Unsupported MT5 timeframe: {interval}")
    count = max(1, min(int(payload.get("count") or 1), 5000))
    rates = mt5.copy_rates_from_pos(symbol_info.name, timeframe, 0, count)
    if rates is None:
        raise RuntimeError(f"MT5 candles unavailable for {symbol_info.name}: {mt5.last_error()}")
    offset = _server_time_offset(symbol_info)
    seconds = TIMEFRAME_SECONDS[interval]
    candles: list[dict] = []
    for rate in rates:
        open_time = (int(rate["time"]) - offset) * 1000
        candles.append(
            {
                "openTime": open_time,
                "closeTime": open_time + seconds * 1000,
                "open": float(rate["open"]),
                "high": float(rate["high"]),
                "low": float(rate["low"]),
                "close": float(rate["close"]),
                "volume": float(rate["tick_volume"]),
            }
        )
    return {"symbol": str(symbol_info.name), "candles": candles}


def _quote_payload(payload: dict) -> dict:
    symbol_info = _find_symbol(str(payload.get("symbol") or ""), str(payload.get("suffix") or ""))
    tick = _tick_payload(symbol_info, retries=12)
    price = tick["mid"] or tick["last"] or tick["bid"] or tick["ask"]
    if not price:
        raise RuntimeError(f"MT5 quote unavailable for {symbol_info.name}.")
    return {
        "symbol": str(symbol_info.name),
        "price": float(price),
        "bid": tick["bid"],
        "ask": tick["ask"],
        "time": tick["time"],
    }


def _dispatch(request: dict) -> dict:
    command = str(request.get("cmd") or "")
    payload = request.get("payload") or {}
    if command == "connect":
        return _connect(payload)
    if command == "attach":
        return _attach(payload)
    if command == "disconnect":
        mt5.shutdown()
        return {"disconnected": True}
    if command == "account":
        return {"account": _account_payload(), "terminal": _terminal_payload()}
    if command == "positions":
        return {"positions": _positions_payload()}
    if command == "history":
        return _history_payload(payload)
    if command == "symbols":
        return _symbols_payload(payload)
    if command == "candles":
        return _candles_payload(payload)
    if command == "quote":
        return _quote_payload(payload)
    if command == "place":
        return _place_order(payload)
    if command == "close":
        return _close_position(payload)
    if command == "modify":
        return _modify_position(payload)
    if command == "ping":
        return {"pong": True}
    raise ValueError(f"Unknown MT5 bridge command: {command}")


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request: dict = {}
        try:
            request = json.loads(line)
            response = {"id": request.get("id"), "ok": True, "data": _dispatch(request)}
        except Exception as error:  # noqa: BLE001
            _log(traceback.format_exc())
            response = {
                "id": request.get("id"),
                "ok": False,
                "error": str(error) or "MT5 bridge failed.",
            }
        print(json.dumps(response, separators=(",", ":")), flush=True)

    try:
        mt5.shutdown()
    except Exception:  # noqa: BLE001
        pass


if __name__ == "__main__":
    main()
