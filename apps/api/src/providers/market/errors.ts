export type MarketProviderErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'bad_request'
  | 'malformed_response'
  | 'provider_error';

/**
 * The only error type market providers may throw. Messages are generic by
 * contract — they must never contain credentials, authorization headers, or
 * full authenticated URLs.
 */
export class MarketProviderError extends Error {
  constructor(
    public readonly code: MarketProviderErrorCode,
    message?: string,
    /** Whether a retry could plausibly succeed (429/5xx/network). */
    public readonly retryable = false,
  ) {
    super(message ?? code);
    this.name = 'MarketProviderError';
  }
}

/** Maps any thrown value to a sanitized error code for storage/API responses. */
export function sanitizedMarketErrorCode(error: unknown): MarketProviderErrorCode {
  return error instanceof MarketProviderError ? error.code : 'provider_error';
}
