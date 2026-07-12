export type HistoricalProviderErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'bad_request'
  | 'not_found'
  | 'malformed_response'
  | 'provider_error';

/**
 * The only error type historical-market providers may throw. Messages are
 * generic by contract — never credentials, authorization headers, or full
 * authenticated URLs.
 */
export class HistoricalProviderError extends Error {
  constructor(
    public readonly code: HistoricalProviderErrorCode,
    message?: string,
    /** Whether a retry could plausibly succeed (429/5xx/network/timeout). */
    public readonly retryable = false,
  ) {
    super(message ?? code);
    this.name = 'HistoricalProviderError';
  }
}

export function sanitizedHistoricalErrorCode(error: unknown): HistoricalProviderErrorCode {
  return error instanceof HistoricalProviderError ? error.code : 'provider_error';
}
