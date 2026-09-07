/**
 * Error types for the WordPress REST API.
 *
 * WordPress returns errors as `{ code, message, data: { status, params?, details? } }`.
 * We parse that shape into a small hierarchy so callers can branch on the class rather
 * than on status-code integers scattered through their app.
 */

/** The JSON body WordPress sends for a failed request. */
export interface WPErrorBody {
  code: string;
  message: string;
  data?: {
    status?: number;
    params?: Record<string, string>;
    details?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface WPErrorOptions {
  /** WordPress error code, e.g. `rest_post_invalid_id`. */
  code: string;
  /** HTTP status code. */
  status: number;
  /** The parsed error body, when the response contained one. */
  body?: WPErrorBody;
  /** The request URL, with any credentials stripped. */
  url?: string;
  cause?: unknown;
}

/**
 * Base class for every error the SDK throws. `instanceof WPError` is true for all
 * API-level failures; transport failures throw {@link WPRequestError} instead.
 */
export class WPError extends Error {
  /** WordPress error code, e.g. `rest_post_invalid_id`. `unknown_error` if absent. */
  readonly code: string;
  /** HTTP status code. `0` when no response was received. */
  readonly status: number;
  /** The raw parsed WordPress error body, if the response had one. */
  readonly body: WPErrorBody | undefined;
  /** The request URL that produced the error. */
  readonly url: string | undefined;

  constructor(message: string, options: WPErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
    this.body = options.body;
    this.url = options.url;
  }
}

/** 400 — the request was malformed or a parameter failed validation. */
export class WPValidationError extends WPError {
  /** Per-parameter validation messages, keyed by parameter name. */
  readonly params: Record<string, string>;

  constructor(message: string, options: WPErrorOptions) {
    super(message, options);
    this.params = options.body?.data?.params ?? {};
  }
}

/** 401 / 403 — missing, invalid, or insufficient credentials. */
export class WPAuthError extends WPError {}

/** 404 — the route or the requested resource does not exist. */
export class WPNotFoundError extends WPError {}

/** 429 — too many requests. */
export class WPRateLimitError extends WPError {
  /** Seconds to wait before retrying, from the `Retry-After` header. */
  readonly retryAfter: number | null;

  constructor(message: string, options: WPErrorOptions & { retryAfter?: number | null }) {
    super(message, options);
    this.retryAfter = options.retryAfter ?? null;
  }
}

/** 5xx — WordPress or the server in front of it failed. */
export class WPServerError extends WPError {}

/**
 * A transport-level failure: DNS, TLS, connection reset, timeout, or abort.
 * No HTTP response was received, so there is no status or WordPress error code.
 */
export class WPRequestError extends Error {
  readonly url: string | undefined;
  /** True when the failure was a timeout or an explicit abort. */
  readonly aborted: boolean;

  constructor(message: string, options: { url?: string; aborted?: boolean; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.url = options.url;
    this.aborted = options.aborted ?? false;
  }
}

/** Thrown for client-side misuse that we can catch before making a request. */
export class WPConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** True if the value looks like a WordPress error body. */
function isWPErrorBody(value: unknown): value is WPErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WPErrorBody).code === "string" &&
    typeof (value as WPErrorBody).message === "string"
  );
}

/** Parse `Retry-After`, which may be seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - now) / 1000));
}

/**
 * Build the right {@link WPError} subclass from a failed response.
 *
 * `body` is whatever we managed to parse from the response; it is often, but not always,
 * a WordPress error body (a WAF or reverse proxy may return HTML instead).
 */
export function errorFromResponse(response: Response, body: unknown, url?: string): WPError {
  const parsed = isWPErrorBody(body) ? body : undefined;
  const status = parsed?.data?.status ?? response.status;
  const code = parsed?.code ?? `http_${response.status}`;
  const message = parsed?.message ?? `WordPress request failed with status ${response.status}`;
  const options: WPErrorOptions = { code, status, body: parsed, url };

  if (status === 400) return new WPValidationError(message, options);
  if (status === 401 || status === 403) return new WPAuthError(message, options);
  if (status === 404) return new WPNotFoundError(message, options);
  if (status === 429) {
    return new WPRateLimitError(message, {
      ...options,
      retryAfter: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  if (status >= 500) return new WPServerError(message, options);
  return new WPError(message, options);
}
