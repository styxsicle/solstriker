/**
 * Sanitized Helius RPC client.
 *
 * The API key and full RPC URL exist only inside this module's closure.
 * Status responses and errors NEVER include the URL or key — failures are
 * reduced to the generic code `rpc_error` so nothing can leak downstream.
 */

export interface RpcStatus {
  configured: boolean;
  cluster: string;
  healthy: boolean | null;
  slot: number | null;
  latencyMs: number | null;
  checkedAt: string;
  error: 'not_configured' | 'rpc_error' | null;
}

export interface RpcClient {
  getStatus(): Promise<RpcStatus>;
}

export interface RpcClientOptions {
  apiKey?: string;
  cluster: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createRpcClient(options: RpcClientOptions): RpcClient {
  const { apiKey, cluster } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const host = cluster === 'devnet' ? 'devnet.helius-rpc.com' : 'mainnet.helius-rpc.com';
  const url = apiKey ? `https://${host}/?api-key=${apiKey}` : null;

  async function rpcCall<T>(method: string): Promise<T> {
    const res = await fetchImpl(url as string, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`rpc status ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: unknown };
    if (json.error !== undefined) throw new Error('rpc error response');
    return json.result as T;
  }

  async function getStatus(): Promise<RpcStatus> {
    const base: RpcStatus = {
      configured: Boolean(apiKey),
      cluster,
      healthy: null,
      slot: null,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
    if (!url) {
      return { ...base, error: 'not_configured' };
    }
    const start = Date.now();
    try {
      const health = await rpcCall<string>('getHealth');
      const slot = await rpcCall<number>('getSlot');
      return {
        ...base,
        healthy: health === 'ok',
        slot: typeof slot === 'number' ? slot : null,
        latencyMs: Date.now() - start,
      };
    } catch {
      // Deliberately swallow the underlying error: its message may contain
      // the request URL (and therefore the API key).
      return { ...base, healthy: false, latencyMs: Date.now() - start, error: 'rpc_error' };
    }
  }

  return { getStatus };
}
