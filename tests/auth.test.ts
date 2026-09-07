import { describe, expect, test } from "bun:test";
import {
  type AuthContext,
  basicAuth,
  bearerAuth,
  encodeBase64,
  headerAuth,
  nonceAuth,
  toAuthenticator,
} from "../src/auth";

function context(): AuthContext {
  return {
    url: new URL("https://example.com/wp-json/wp/v2/posts"),
    method: "GET",
    headers: new Headers(),
  };
}

describe("basicAuth", () => {
  test("sets a Basic Authorization header", async () => {
    const ctx = context();
    await basicAuth({ username: "ada", password: "abcd efgh" }).authenticate(ctx);
    expect(ctx.headers.get("authorization")).toBe(`Basic ${encodeBase64("ada:abcd efgh")}`);
  });

  test("handles credentials outside Latin-1, which bare btoa cannot", async () => {
    const ctx = context();
    await basicAuth({ username: "adá✓", password: "pass" }).authenticate(ctx);
    const header = ctx.headers.get("authorization") ?? "";
    expect(header.startsWith("Basic ")).toBe(true);
    // atob gives back a byte string; decode those bytes as UTF-8 to recover the input.
    const bytes = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("adá✓:pass");
  });
});

describe("bearerAuth", () => {
  test("sets a static token", async () => {
    const ctx = context();
    await bearerAuth("token-123").authenticate(ctx);
    expect(ctx.headers.get("authorization")).toBe("Bearer token-123");
  });

  test("resolves a token getter on every request, so refresh works", async () => {
    let issued = 0;
    const auth = bearerAuth(async () => `token-${++issued}`);

    const first = context();
    await auth.authenticate(first);
    const second = context();
    await auth.authenticate(second);

    expect(first.headers.get("authorization")).toBe("Bearer token-1");
    expect(second.headers.get("authorization")).toBe("Bearer token-2");
  });
});

describe("headerAuth and nonceAuth", () => {
  test("headerAuth sets arbitrary headers", async () => {
    const ctx = context();
    await headerAuth({ "X-Api-Key": "secret" }).authenticate(ctx);
    expect(ctx.headers.get("x-api-key")).toBe("secret");
  });

  test("nonceAuth sets the WordPress REST nonce header", async () => {
    const ctx = context();
    await nonceAuth(() => "abc123").authenticate(ctx);
    expect(ctx.headers.get("x-wp-nonce")).toBe("abc123");
  });
});

describe("toAuthenticator", () => {
  test("accepts a bare function", async () => {
    const ctx = context();
    await toAuthenticator((c) => c.headers.set("X-Custom", "1")).authenticate(ctx);
    expect(ctx.headers.get("x-custom")).toBe("1");
  });
});
