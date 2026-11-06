import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Search, X } from 'lucide-react';
import type { PairMutationResult, PairOption, PairsResponse } from '../types';

async function postJson(url: string, body: Record<string, unknown>): Promise<PairMutationResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: (PairMutationResult & { error?: string }) | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as PairMutationResult & { error?: string };
    } catch {
      throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (HTTP ${response.status}).`);
  }
  if (!payload) throw new Error('Server returned an empty response.');
  return payload;
}

export function PairManager({
  onChanged,
  connected,
}: {
  onChanged?: () => void | Promise<void>;
  connected?: boolean;
}) {
  const [pairs, setPairs] = useState<PairsResponse | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/pairs', { cache: 'no-store' });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}.`);
      }
      if (!text.trimStart().startsWith('{')) {
        throw new Error('The API server is not responding. Restart npm run dev.');
      }
      setPairs(JSON.parse(text) as PairsResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pairs.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, connected]);

  const active = pairs?.active ?? [];
  const catalog = pairs?.catalog ?? [];
  const bySymbol = useMemo(() => {
    const map = new Map<string, PairOption>();
    for (const option of catalog) map.set(option.symbol, option);
    return map;
  }, [catalog]);

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!needle) return [];
    return catalog
      .filter((option) => {
        if (option.active) return false;
        const values = [option.symbol, option.name, option.category ?? '', ...(option.aliases ?? [])];
        return values.some((value) =>
          value.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle)
        );
      })
      .slice(0, 10);
  }, [catalog, query]);

  const mutate = async (action: 'add' | 'remove', symbol: string) => {
    const key = `${action}-${symbol}`;
    setBusy(key);
    setError(null);
    try {
      const result = await postJson(`/api/pairs/${action}`, { symbol });
      setPairs(result.pairs);
      if (action === 'add') setQuery('');
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Updating pairs failed.');
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const top = suggestions[0];
    if (top) void mutate('add', top.symbol);
  };

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1d1d1f] sm:text-[17px]">
            Pairs
          </h2>
          <span className="text-[11px] text-[#86868b]">{active.length} active</span>
        </div>
        <span className="text-[10px] text-[#86868b]">Search and add or remove scanned pairs</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {active.length === 0 && (
          <span className="text-[11px] text-[#86868b]">
            No active pairs. Search below to add one.
          </span>
        )}
        {active.map((symbol) => {
          const option = bySymbol.get(symbol);
          const removing = busy === `remove-${symbol}`;
          return (
            <span
              key={symbol}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] py-1 pl-2.5 pr-1.5 text-[11px] font-medium text-[#1d1d1f]"
            >
              <span>{symbol}</span>
              {option && option.name !== symbol && (
                <span className="text-[10px] font-normal text-[#86868b]">{option.name}</span>
              )}
              <button
                type="button"
                onClick={() => void mutate('remove', symbol)}
                disabled={Boolean(busy)}
                aria-label={`Remove ${symbol}`}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#86868b] hover:bg-black/[0.06] hover:text-[#d70015] active:opacity-70 disabled:opacity-40"
              >
                {removing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </span>
          );
        })}
      </div>

      <form onSubmit={submit} className="relative mt-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868b]"
              strokeWidth={1.8}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="text"
              placeholder="Search pairs, e.g. EURUSD, gold, CADJPY..."
              className="h-10 w-full rounded-xl border border-transparent bg-[#f5f5f7] pl-9 pr-3 text-[13px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#0071e3] focus:bg-white focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={suggestions.length === 0 || Boolean(busy)}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#1d1d1f] px-4 text-[12px] font-medium text-white active:opacity-70 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {query.trim() && suggestions.length > 0 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-black/[0.08] bg-white py-1 shadow-lg">
            {suggestions.map((option) => (
              <button
                key={option.symbol}
                type="button"
                onClick={() => void mutate('add', option.symbol)}
                disabled={Boolean(busy)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#f5f5f7] disabled:opacity-50"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-[#1d1d1f]">{option.symbol}</span>
                  {option.name !== option.symbol && (
                    <span className="text-[10px] text-[#86868b]">{option.name}</span>
                  )}
                </span>
                {busy === `add-${option.symbol}` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#86868b]" />
                ) : (
                  <Plus className="h-3.5 w-3.5 text-[#86868b]" />
                )}
              </button>
            ))}
          </div>
        )}
      </form>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-[#d70015]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
