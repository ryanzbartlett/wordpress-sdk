/**
 * Pluggable authentication.
 *
 * An {@link Authenticator} decorates an outgoing request — almost always by setting a
 * header. Built-ins cover the two mechanisms core WordPress and most plugins use
 * (Basic auth for Application Passwords, and bearer tokens); anything else is a
 * few lines of user code.
 */

/** The mutable request description handed to an authenticator before it is sent. */
export interface AuthContext {
  /** The fully-resolved request URL. Mutating it changes where the request goes. */
  readonly url: URL;
  /** The HTTP method, uppercased. */
  readonly method: string;
  /** Request headers. Set credentials here. */
  readonly headers: Headers;
}

export interface Authenticator {
  authenticate(context: AuthContext): void | Promise<void>;
}

/** An authenticator, or a bare function that behaves like one. */
export type AuthenticatorLike = Authenticator | ((context: AuthContext) => void | Promise<void>);

/** Normalize a function-style authenticator into the object form. */
export function toAuthenticator(auth: AuthenticatorLike): Authenticator {
  return typeof auth === "function" ? { authenticate: auth } : auth;
}

/**
 * Base64-encode a string without depending on `Buffer`, so the SDK runs unchanged in
 * browsers, edge runtimes, Deno, Bun and Node. Encodes UTF-8 first, which `btoa` alone
 * does not do — usernames outside Latin-1 would otherwise throw.
 */
export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface BasicAuthOptions {
  username: string;
  /**
   * An Application Password. WordPress ignores the spaces in the displayed form
   * (`abcd efgh ijkl mnop`), so it may be passed either way.
   */
  password: string;
}

/**
 * HTTP Basic auth — the mechanism behind WordPress Application Passwords.
 *
 * Only ever send this over HTTPS; the client refuses `http://` base URLs unless
 * `allowInsecure` is set, for exactly this reason.
 */
export function basicAuth({ username, password }: BasicAuthOptions): Authenticator {
  const value = `Basic ${encodeBase64(`${username}:${password}`)}`;
  return {
    authenticate({ headers }) {
      headers.set("Authorization", value);
    },
  };
}

/**
 * Bearer token auth, for JWT plugins and similar.
 *
 * Accepts a static token or a getter, so a caller can refresh an expiring token
 * without rebuilding the client:
 *
 * ```ts
 * bearerAuth(async () => (await session.getAccessToken()));
 * ```
 */
export function bearerAuth(token: string | (() => string | Promise<string>)): Authenticator {
  return {
    async authenticate({ headers }) {
      const value = typeof token === "function" ? await token() : token;
      headers.set("Authorization", `Bearer ${value}`);
    },
  };
}

/** Set arbitrary static headers — for proxies, shared secrets, or custom auth plugins. */
export function headerAuth(headers: Record<string, string>): Authenticator {
  const entries = Object.entries(headers);
  return {
    authenticate(context) {
      for (const [key, value] of entries) context.headers.set(key, value);
    },
  };
}

/**
 * Cookie authentication for same-origin browser contexts (e.g. a block editor plugin).
 * WordPress requires the REST nonce alongside the cookie; the cookie itself is sent by
 * the browser once the request is marked same-origin credentialed.
 */
export function nonceAuth(nonce: string | (() => string)): Authenticator {
  return {
    authenticate({ headers }) {
      headers.set("X-WP-Nonce", typeof nonce === "function" ? nonce() : nonce);
    },
  };
}
