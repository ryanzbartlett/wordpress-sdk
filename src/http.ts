/**
 * The transport layer: one `fetch` call, wrapped in timeouts, retries, auth and
 * error mapping. Everything above this file deals in typed entities; everything
 * below it deals in `Request`/`Response`.
 */

import { type Authenticator, type AuthenticatorLike, toAuthenticator } from "./auth";
import { errorFromResponse, parseRetryAfter, WPConfigError, WPRequestError } from "./errors";
import { buildUrl, type QueryInput } from "./query";

/** Methods that are safe to replay after a failure. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RetryOptions {
  /** Total attempts, including the first. `1` disables retrying. Default `3`. */
  attempts?: number;
  /** Base delay in ms; doubles each attempt and is jittered. Default `300`. */
  baseDelayMs?: number;
  /** Upper bound on any single delay. Default `10_000`. */
  maxDelayMs?: number;
  /** Response statuses worth retrying. Default `[408, 429, 500, 502, 503, 504]`. */
  statuses?: readonly number[];
  /** Retry non-idempotent methods too. Off by default — a POST may have succeeded. */
  retryNonIdempotent?: boolean;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 10_000,
  statuses: [408, 429, 500, 502, 503, 504],
  retryNonIdempotent: false,
};

/**
 * The `fetch` implementation to use. Injectable for tests and caching wrappers.
 *
 * The SDK always builds a `Request` before dispatching, so an implementation only ever
 * needs to accept one — `globalThis.fetch` satisfies this, and so does a two-line stub.
 */
export type FetchLike = (input: Request) => Promise<Response>;

export interface HttpHooks {
  /** Called with the final request just before it is sent. */
  onRequest?: (request: Request) => void | Promise<void>;
  /** Called with every response, including ones that will be retried or thrown. */
  onResponse?: (response: Response, request: Request) => void | Promise<void>;
  /** Called before a retry sleep, with the 1-based attempt that just failed. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: unknown }) => void;
}

export interface HttpClientOptions extends HttpHooks {
  /** Site root (`https://example.com`) or full REST root (`https://example.com/wp-json`). */
  url: string;
  auth?: AuthenticatorLike;
  fetch?: FetchLike;
  /** Per-request timeout in ms. Default `30_000`. `0` disables it. */
  timeoutMs?: number;
  retry?: RetryOptions | false;
  /** Headers added to every request. */
  headers?: Record<string, string>;
  /** Allow a plaintext `http://` base URL. Off by default: it leaks credentials. */
  allowInsecure?: boolean;
  /** Extra `RequestInit` merged into every request — e.g. Next.js `next: { revalidate }`. */
  fetchOptions?: RequestInit;
}

export interface RequestOptions {
  method?: string;
  /** Route path relative to the REST root, e.g. `/wp/v2/posts`. */
  path: string;
  params?: QueryInput;
  /** Serialized as JSON unless it is already a `BodyInit`. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: RetryOptions | false;
  fetchOptions?: RequestInit;
}

export interface HttpResponse<T> {
  data: T;
  /** The raw response, so callers can read pagination and cache headers. */
  response: Response;
}

/**
 * Normalize a site URL into a REST root.
 *
 * Trailing slashes and a missing `/wp-json` both cause WordPress to redirect, and a
 * cross-origin redirect drops the `Authorization` header — so we resolve this once,
 * at construction, rather than per request.
 */
export function normalizeBaseUrl(input: string, allowInsecure = false): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new WPConfigError(
      `Invalid WordPress URL: ${JSON.stringify(input)}. Pass an absolute URL, e.g. "https://example.com".`,
    );
  }

  if (parsed.protocol !== "https:" && !allowInsecure) {
    if (parsed.protocol !== "http:") {
      throw new WPConfigError(`Unsupported protocol ${parsed.protocol} in WordPress URL.`);
    }
    const isLocal =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname.endsWith(".local") ||
      parsed.hostname.endsWith(".test");
    if (!isLocal) {
      throw new WPConfigError(
        `Refusing to use a plaintext http:// URL (${parsed.origin}) — credentials would be sent in the clear. ` +
          "Use https, or set allowInsecure: true if you understand the risk.",
      );
    }
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  // Accept a site root, a REST root, or an index.php?rest_route style root already given.
  const restPath = path.endsWith("/wp-json") ? path : `${path}/wp-json`;
  return `${parsed.origin}${restPath}`;
}

/** Combine an optional caller signal with an optional timeout. */
function combineSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal | undefined {
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  if (!signal) return timeout;
  if (!timeout) return signal;
  // AbortSignal.any landed in Node 20; fall back for Node 18.
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  const abort = (reason: unknown) => controller.abort(reason);
  for (const source of [signal, timeout]) {
    if (source.aborted) {
      abort(source.reason);
      break;
    }
    source.addEventListener("abort", () => abort(source.reason), { once: true });
  }
  return controller.signal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with full jitter, so concurrent clients don't retry in lockstep. */
function backoffDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponential = options.baseDelayMs * 2 ** (attempt - 1);
  return Math.round(Math.random() * Math.min(exponential, options.maxDelayMs));
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 304) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  return text.length > 0 ? text : null;
}

export class HttpClient {
  readonly baseUrl: string;
  private readonly auth: Authenticator | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryOptions> | null;
  private readonly headers: Record<string, string>;
  private readonly fetchOptions: RequestInit;
  private readonly hooks: HttpHooks;

  constructor(options: HttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.url, options.allowInsecure);
    this.auth = options.auth ? toAuthenticator(options.auth) : undefined;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new WPConfigError(
        "No global fetch available. Pass a fetch implementation via the `fetch` option.",
      );
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retry = options.retry === false ? null : { ...DEFAULT_RETRY, ...options.retry };
    this.headers = options.headers ?? {};
    this.fetchOptions = options.fetchOptions ?? {};
    this.hooks = {
      onRequest: options.onRequest,
      onResponse: options.onResponse,
      onRetry: options.onRetry,
    };
  }

  /** Resolve a route path to the absolute URL the SDK would request. */
  urlFor(path: string, params?: QueryInput): URL {
    return buildUrl(this.baseUrl, path, params);
  }

  async request<T>(options: RequestOptions): Promise<HttpResponse<T>> {
    const method = (options.method ?? "GET").toUpperCase();
    const url = this.urlFor(options.path, options.params);
    const retry =
      options.retry === false
        ? null
        : options.retry
          ? { ...DEFAULT_RETRY, ...options.retry }
          : this.retry;
    // `retry` is null when retrying is disabled; keep a config around anyway so the
    // backoff helper has concrete numbers, and gate every retry on `canRetry`.
    const retryConfig = retry ?? DEFAULT_RETRY;
    const canRetry =
      retry !== null && (retryConfig.retryNonIdempotent || IDEMPOTENT_METHODS.has(method));
    const attempts = canRetry ? Math.max(1, retryConfig.attempts) : 1;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const request = await this.buildRequest(method, url, options, timeoutMs);
      let response: Response;

      try {
        await this.hooks.onRequest?.(request);
        response = await this.fetchImpl(request);
      } catch (cause) {
        const aborted = options.signal?.aborted === true;
        lastError = new WPRequestError(
          aborted
            ? "Request aborted."
            : `Request to ${url.pathname} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          { url: url.toString(), aborted, cause },
        );
        // A caller-initiated abort is a decision, not a fault — never retry it.
        if (aborted || attempt === attempts) throw lastError;
        await this.waitBeforeRetry(attempt, retryConfig, lastError, null, options.signal);
        continue;
      }

      await this.hooks.onResponse?.(response, request);

      if (response.ok) {
        return { data: (await parseBody(response)) as T, response };
      }

      const body = await parseBody(response);
      lastError = errorFromResponse(response, body, url.toString());

      const retryable = canRetry && retryConfig.statuses.includes(response.status);
      if (!retryable || attempt === attempts) throw lastError;
      await this.waitBeforeRetry(attempt, retryConfig, lastError, response, options.signal);
    }

    /* c8 ignore next -- the loop always returns or throws. */
    throw lastError;
  }

  private async waitBeforeRetry(
    attempt: number,
    retry: Required<RetryOptions>,
    reason: unknown,
    response: Response | null,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    // A server that tells us when to come back knows better than our backoff curve.
    const retryAfter = response ? parseRetryAfter(response.headers.get("retry-after")) : null;
    const delayMs =
      retryAfter !== null
        ? Math.min(retryAfter * 1000, retry.maxDelayMs)
        : backoffDelay(attempt, retry);
    this.hooks.onRetry?.({ attempt, delayMs, reason });
    await sleep(delayMs, signal);
  }

  private async buildRequest(
    method: string,
    url: URL,
    options: RequestOptions,
    timeoutMs: number,
  ): Promise<Request> {
    const headers = new Headers({ Accept: "application/json" });
    for (const [key, value] of Object.entries(this.headers)) headers.set(key, value);
    for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);

    let body: BodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (isBodyInit(options.body)) {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      }
    }

    if (this.auth) {
      await this.auth.authenticate({ url, method, headers });
    }

    const init: RequestInit = {
      ...this.fetchOptions,
      ...options.fetchOptions,
      method,
      headers,
      redirect: "follow",
    };
    if (body !== undefined) init.body = body;

    const signal = combineSignals(options.signal, timeoutMs);
    if (signal) init.signal = signal;

    return new Request(url, init);
  }
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof ReadableStream
  );
}
