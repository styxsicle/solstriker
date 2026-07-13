/**
 * Shared server-side wallet search.
 *
 * Several wallet pickers used to load one fixed page of wallets
 * (`/api/wallets?pageSize=50` or `?pageSize=200`) and then filter that page
 * locally in the browser. That silently hid any wallet outside the loaded
 * page — including exact-address matches — even though the backend already
 * supports a real `search` query parameter. This hook always searches on the
 * server, so every matching wallet is reachable regardless of when it was
 * imported.
 *
 * Selection state itself is intentionally NOT owned by this hook (primary vs.
 * comparison roles, single-select vs. multi-select differ per page). Instead,
 * `getWallet(id)` resolves a wallet object from every result ever seen in this
 * hook instance, so a previously selected wallet keeps displaying its label
 * and address correctly even after the search query changes and it drops out
 * of the current `results` list.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Wallet, type WalletListResponse } from '../api';

export interface UseWalletSearchOptions {
  /** Maximum results per query. Default 25. */
  pageSize?: number;
  /** Include synthetic development records. Default false. */
  includeDev?: boolean;
  /** Only enabled wallets. Default false (all wallets). */
  enabledOnly?: boolean;
  /** Optional debounce before firing the request, in milliseconds. Default 0. */
  debounceMs?: number;
}

export interface UseWalletSearchResult {
  query: string;
  setQuery: (query: string) => void;
  results: Wallet[];
  loading: boolean;
  error: string | null;
  /** Resolves a wallet by ID from every result this hook has ever returned. */
  getWallet: (id: string) => Wallet | undefined;
  /** Re-runs the current query (e.g. after adding a wallet elsewhere). */
  reload: () => void;
}

export function useWalletSearch(options: UseWalletSearchOptions = {}): UseWalletSearchResult {
  const { pageSize = 25, includeDev = false, enabledOnly = false, debounceMs = 0 } = options;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const cacheRef = useRef<Map<string, Wallet>>(new Map());
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ page: '1', pageSize: String(pageSize) });
      if (query.trim()) params.set('search', query.trim());
      if (!includeDev) params.set('includeDev', 'false');
      if (enabledOnly) params.set('enabled', 'true');
      api<WalletListResponse>(`/api/wallets?${params.toString()}`)
        .then((response) => {
          if (requestIdRef.current !== requestId) return; // a newer request superseded this one
          for (const wallet of response.items) cacheRef.current.set(wallet.id, wallet);
          setResults(response.items);
          setError(null);
        })
        .catch((e: unknown) => {
          if (requestIdRef.current !== requestId) return;
          setError((e as Error).message);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [query, pageSize, includeDev, enabledOnly, reloadToken]);

  const getWallet = useCallback((id: string) => cacheRef.current.get(id), []);
  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { query, setQuery, results, loading, error, getWallet, reload };
}
