import { describe, expect, test } from "bun:test";
import {
  errorFromResponse,
  parseRetryAfter,
  WPAuthError,
  WPError,
  WPNotFoundError,
  WPRateLimitError,
  WPServerError,
  WPValidationError,
} from "../src/errors";

function jsonResponse(body: unknown, status: number, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("errorFromResponse", () => {
  test("maps a WordPress error body onto the matching class", () => {
    const body = {
      code: "rest_post_invalid_id",
      message: "Invalid post ID.",
      data: { status: 404 },
    };
    const error = errorFromResponse(jsonResponse(body, 404), body, "https://example.com/x");

    expect(error).toBeInstanceOf(WPNotFoundError);
    expect(error.code).toBe("rest_post_invalid_id");
    expect(error.status).toBe(404);
    expect(error.message).toBe("Invalid post ID.");
    expect(error.url).toBe("https://example.com/x");
  });

  test("exposes per-parameter messages on a validation error", () => {
    const body = {
      code: "rest_invalid_param",
      message: "Invalid parameter(s): per_page",
      data: { status: 400, params: { per_page: "must be between 1 and 100" } },
    };
    const error = errorFromResponse(jsonResponse(body, 400), body);

    expect(error).toBeInstanceOf(WPValidationError);
    expect((error as WPValidationError).params.per_page).toBe("must be between 1 and 100");
  });

  test("treats 401 and 403 alike as auth failures", () => {
    for (const status of [401, 403]) {
      const body = { code: "rest_forbidden", message: "Not allowed.", data: { status } };
      expect(errorFromResponse(jsonResponse(body, status), body)).toBeInstanceOf(WPAuthError);
    }
  });

  test("reads Retry-After off a rate-limit response", () => {
    const body = { code: "too_many_requests", message: "Slow down", data: { status: 429 } };
    const error = errorFromResponse(jsonResponse(body, 429, { "retry-after": "30" }), body);

    expect(error).toBeInstanceOf(WPRateLimitError);
    expect((error as WPRateLimitError).retryAfter).toBe(30);
  });

  test("degrades gracefully when a proxy returns HTML instead of a WordPress error", () => {
    const response = new Response("<html>502</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const error = errorFromResponse(response, "<html>502</html>");

    expect(error).toBeInstanceOf(WPServerError);
    expect(error.code).toBe("http_502");
    expect(error.body).toBeUndefined();
    expect(error.message).toContain("502");
  });

  test("prefers the status inside the body, which is what WordPress actually meant", () => {
    // Some hosts rewrite the HTTP status but leave the payload intact.
    const body = { code: "rest_forbidden", message: "Not allowed.", data: { status: 403 } };
    const error = errorFromResponse(jsonResponse(body, 200), body);

    expect(error).toBeInstanceOf(WPAuthError);
    expect(error.status).toBe(403);
  });

  test("every API error is a WPError", () => {
    const body = { code: "x", message: "y", data: { status: 418 } };
    const error = errorFromResponse(jsonResponse(body, 418), body);
    expect(error).toBeInstanceOf(WPError);
    expect(error.name).toBe("WPError");
  });
});

describe("parseRetryAfter", () => {
  test("accepts a delay in seconds", () => {
    expect(parseRetryAfter("120")).toBe(120);
  });

  test("accepts an HTTP date and converts it to seconds from now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30);
  });

  test("never returns a negative delay for a date in the past", () => {
    const now = Date.parse("2026-01-01T00:01:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:00 GMT", now)).toBe(0);
  });

  test("returns null for a missing or unparseable header", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
