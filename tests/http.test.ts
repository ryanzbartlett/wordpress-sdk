import { describe, expect, test } from "bun:test";
import { WPConfigError, WPRequestError, WPServerError, WPValidationError } from "../src/errors";
import { HttpClient, normalizeBaseUrl } from "../src/http";

const BASE = "https://example.com";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("normalizeBaseUrl", () => {
  test("appends the REST root to a site URL", () => {
    expect(normalizeBaseUrl("https://example.com")).toBe("https://example.com/wp-json");
  });

  test("strips trailing slashes, which would otherwise cause a redirect", () => {
    expect(normalizeBaseUrl("https://example.com/")).toBe("https://example.com/wp-json");
    expect(normalizeBaseUrl("https://example.com/wp-json/")).toBe("https://example.com/wp-json");
  });

  test("accepts a URL that already points at the REST root", () => {
    expect(normalizeBaseUrl("https://example.com/wp-json")).toBe("https://example.com/wp-json");
  });

  test("supports WordPress installed in a subdirectory", () => {
    expect(normalizeBaseUrl("https://example.com/blog")).toBe("https://example.com/blog/wp-json");
  });

  test("refuses plaintext http, which would leak credentials", () => {
    expect(() => normalizeBaseUrl("http://example.com")).toThrow(WPConfigError);
  });

  test("allows http for local development hosts", () => {
    expect(normalizeBaseUrl("http://localhost:8080")).toBe("http://localhost:8080/wp-json");
    expect(normalizeBaseUrl("http://mysite.test")).toBe("http://mysite.test/wp-json");
  });

  test("allows http when explicitly opted into", () => {
    expect(normalizeBaseUrl("http://example.com", true)).toBe("http://example.com/wp-json");
  });

  test("rejects a non-absolute URL with an actionable message", () => {
    expect(() => normalizeBaseUrl("example.com")).toThrow(/Invalid WordPress URL/);
  });
});

describe("HttpClient requests", () => {
  test("sends Accept: application/json and parses the body", async () => {
    let seen: Request | undefined;
    const client = new HttpClient({
      url: BASE,
      fetch: async (request) => {
        seen = request;
        return jsonResponse({ id: 1 });
      },
    });

    const { data } = await client.request<{ id: number }>({ path: "/wp/v2/posts/1" });

    expect(data).toEqual({ id: 1 });
    expect(seen?.headers.get("accept")).toBe("application/json");
    expect(seen?.url).toBe("https://example.com/wp-json/wp/v2/posts/1");
  });

  test("applies the authenticator to every request", async () => {
    const client = new HttpClient({
      url: BASE,
      auth: ({ headers }) => headers.set("Authorization", "Bearer t"),
      fetch: async (request) => jsonResponse({ auth: request.headers.get("authorization") }),
    });

    const { data } = await client.request<{ auth: string }>({ path: "/wp/v2/posts" });
    expect(data.auth).toBe("Bearer t");
  });

  test("merges client headers with per-request headers, request wins", async () => {
    const client = new HttpClient({
      url: BASE,
      headers: { "X-Client": "a", "X-Both": "client" },
      fetch: async (request) =>
        jsonResponse({
          client: request.headers.get("x-client"),
          both: request.headers.get("x-both"),
        }),
    });

    const { data } = await client.request<{ client: string; both: string }>({
      path: "/wp/v2/posts",
      headers: { "X-Both": "request" },
    });

    expect(data).toEqual({ client: "a", both: "request" });
  });

  test("serializes a plain object body as JSON", async () => {
    let body: string | undefined;
    const client = new HttpClient({
      url: BASE,
      fetch: async (request) => {
        body = await request.text();
        return jsonResponse({ ok: true }, { status: 201 });
      },
    });

    await client.request({ method: "POST", path: "/wp/v2/posts", body: { title: "Hi" } });
    expect(body).toBe('{"title":"Hi"}');
  });

  test("passes a FormData body through untouched, so uploads keep their boundary", async () => {
    let seen: Request | undefined;
    const client = new HttpClient({
      url: BASE,
      fetch: async (request) => {
        seen = request;
        return jsonResponse({ ok: true });
      },
    });

    const form = new FormData();
    form.set("file", new Blob(["x"]), "x.txt");
    await client.request({ method: "POST", path: "/wp/v2/media", body: form });

    expect(seen?.headers.get("content-type")).toContain("multipart/form-data; boundary=");
  });

  test("merges fetchOptions, so framework cache hints reach fetch", async () => {
    let init: Request | undefined;
    const client = new HttpClient({
      url: BASE,
      fetchOptions: { cache: "no-store" },
      fetch: async (request) => {
        init = request;
        return jsonResponse({});
      },
    });

    await client.request({ path: "/wp/v2/posts" });
    expect(init?.cache).toBe("no-store");
  });
});

describe("HttpClient errors and retries", () => {
  test("throws a typed error for a WordPress error response", async () => {
    const client = new HttpClient({
      url: BASE,
      retry: false,
      fetch: async () =>
        jsonResponse(
          {
            code: "rest_invalid_param",
            message: "Invalid parameter(s): per_page",
            data: { status: 400, params: { per_page: "bad" } },
          },
          { status: 400 },
        ),
    });

    await expect(client.request({ path: "/wp/v2/posts" })).rejects.toThrow(WPValidationError);
  });

  test("retries retryable statuses and returns the eventual success", async () => {
    let attempts = 0;
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 3, baseDelayMs: 1 },
      fetch: async () => {
        attempts++;
        return attempts < 3
          ? jsonResponse({ code: "x", message: "y", data: { status: 503 } }, { status: 503 })
          : jsonResponse({ id: 1 });
      },
    });

    const { data } = await client.request<{ id: number }>({ path: "/wp/v2/posts" });
    expect(data).toEqual({ id: 1 });
    expect(attempts).toBe(3);
  });

  test("gives up after the configured attempts and throws the last error", async () => {
    let attempts = 0;
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 2, baseDelayMs: 1 },
      fetch: async () => {
        attempts++;
        return jsonResponse({ code: "x", message: "y", data: { status: 500 } }, { status: 500 });
      },
    });

    await expect(client.request({ path: "/wp/v2/posts" })).rejects.toThrow(WPServerError);
    expect(attempts).toBe(2);
  });

  test("does not retry a client error", async () => {
    let attempts = 0;
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 3, baseDelayMs: 1 },
      fetch: async () => {
        attempts++;
        return jsonResponse({ code: "x", message: "y", data: { status: 404 } }, { status: 404 });
      },
    });

    await client.request({ path: "/wp/v2/posts" }).catch(() => {});
    expect(attempts).toBe(1);
  });

  test("does not retry a POST, which may already have taken effect", async () => {
    let attempts = 0;
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 3, baseDelayMs: 1 },
      fetch: async () => {
        attempts++;
        return jsonResponse({ code: "x", message: "y", data: { status: 503 } }, { status: 503 });
      },
    });

    await client.request({ method: "POST", path: "/wp/v2/posts" }).catch(() => {});
    expect(attempts).toBe(1);
  });

  test("retries a POST when explicitly told to", async () => {
    let attempts = 0;
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 2, baseDelayMs: 1, retryNonIdempotent: true },
      fetch: async () => {
        attempts++;
        return jsonResponse({ code: "x", message: "y", data: { status: 503 } }, { status: 503 });
      },
    });

    await client.request({ method: "POST", path: "/wp/v2/posts" }).catch(() => {});
    expect(attempts).toBe(2);
  });

  test("prefers Retry-After over the backoff curve", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 2, baseDelayMs: 5000, maxDelayMs: 10_000 },
      onRetry: ({ delayMs }) => delays.push(delayMs),
      fetch: async () => {
        attempts++;
        return attempts === 1
          ? jsonResponse(
              { code: "x", message: "y", data: { status: 429 } },
              {
                status: 429,
                headers: { "retry-after": "0" },
              },
            )
          : jsonResponse({ id: 1 });
      },
    });

    await client.request({ path: "/wp/v2/posts" });
    expect(delays).toEqual([0]);
  });

  test("wraps a network failure as WPRequestError and retries it", async () => {
    let attempts = 0;
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 2, baseDelayMs: 1 },
      fetch: async () => {
        attempts++;
        throw new TypeError("fetch failed");
      },
    });

    await expect(client.request({ path: "/wp/v2/posts" })).rejects.toThrow(WPRequestError);
    expect(attempts).toBe(2);
  });

  test("never retries a caller-initiated abort", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const client = new HttpClient({
      url: BASE,
      retry: { attempts: 3, baseDelayMs: 1 },
      fetch: async () => {
        attempts++;
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    });

    const error = await client
      .request({ path: "/wp/v2/posts", signal: controller.signal })
      .catch((cause) => cause);

    expect(error).toBeInstanceOf(WPRequestError);
    expect((error as WPRequestError).aborted).toBe(true);
    expect(attempts).toBe(1);
  });

  test("times out a hanging request", async () => {
    const client = new HttpClient({
      url: BASE,
      timeoutMs: 10,
      retry: false,
      fetch: (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason));
        }),
    });

    await expect(client.request({ path: "/wp/v2/posts" })).rejects.toThrow(WPRequestError);
  });

  test("calls the request and response hooks", async () => {
    const seen: string[] = [];
    const client = new HttpClient({
      url: BASE,
      onRequest: (request) => void seen.push(`req:${new URL(request.url).pathname}`),
      onResponse: (response) => void seen.push(`res:${response.status}`),
      fetch: async () => jsonResponse({}),
    });

    await client.request({ path: "/wp/v2/posts" });
    expect(seen).toEqual(["req:/wp-json/wp/v2/posts", "res:200"]);
  });
});
