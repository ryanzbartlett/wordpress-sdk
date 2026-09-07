import { describe, expect, test } from "bun:test";
import { WPConfigError } from "../src/errors";
import { buildUrl, MAX_PER_PAGE, normalizeParams, serializeParams } from "../src/query";

describe("serializeParams", () => {
  test("maps camelCase option names onto WordPress wire names", () => {
    const search = serializeParams({
      perPage: 20,
      authorExclude: [4],
      modifiedAfter: "2026-01-01",
    });
    expect(search.get("per_page")).toBe("20");
    expect(search.getAll("author_exclude[]")).toEqual(["4"]);
    expect(search.get("modified_after")).toBe("2026-01-01");
  });

  test("repeats array parameters with [] suffixes", () => {
    const search = serializeParams({ include: [3, 1, 2] });
    expect(search.getAll("include[]")).toEqual(["3", "1", "2"]);
  });

  test("keeps _fields and _embed as comma-separated lists", () => {
    const search = serializeParams({ _fields: ["id", "slug"], _embed: ["author", "wp:term"] });
    expect(search.get("_fields")).toBe("id,slug");
    expect(search.get("_embed")).toBe("author,wp:term");
  });

  test("serializes dates as ISO 8601 and booleans as literals", () => {
    const search = serializeParams({ after: new Date("2026-01-02T03:04:05Z"), sticky: false });
    expect(search.get("after")).toBe("2026-01-02T03:04:05.000Z");
    expect(search.get("sticky")).toBe("false");
  });

  test("drops null and undefined so optional params can be passed through", () => {
    const search = serializeParams({ search: undefined, author: null, page: 2 });
    expect(search.has("search")).toBe(false);
    expect(search.has("author")).toBe(false);
    expect(search.get("page")).toBe("2");
  });

  test("emits keys in a stable order so equivalent queries produce identical URLs", () => {
    const a = serializeParams({ page: 2, perPage: 10, search: "x" });
    const b = serializeParams({ search: "x", perPage: 10, page: 2 });
    expect(a.toString()).toBe(b.toString());
  });

  test("leaves underscore-prefixed and already-snake_case keys untouched", () => {
    const search = serializeParams({ _fields: ["id"], meta_key: "price" });
    expect(search.get("_fields")).toBe("id");
    expect(search.get("meta_key")).toBe("price");
  });
});

describe("normalizeParams", () => {
  test("translates fields and embed to their wire names", () => {
    expect(normalizeParams({ fields: ["id", "slug"] })._fields).toEqual(["id", "slug"]);
    expect(normalizeParams({ embed: true })._embed).toBe("1");
    expect(normalizeParams({ embed: ["author"] })._embed).toEqual(["author"]);
  });

  test("omits _embed when embed is false or an empty list", () => {
    expect(normalizeParams({ embed: false })).not.toHaveProperty("_embed");
    expect(normalizeParams({ embed: [] })).not.toHaveProperty("_embed");
  });

  test("rejects a perPage WordPress would refuse, before making a request", () => {
    expect(() => normalizeParams({ perPage: MAX_PER_PAGE + 1 })).toThrow(WPConfigError);
    expect(() => normalizeParams({ perPage: 0 })).toThrow(WPConfigError);
    expect(() => normalizeParams({ perPage: 10.5 })).toThrow(WPConfigError);
    expect(() => normalizeParams({ perPage: MAX_PER_PAGE })).not.toThrow();
  });
});

describe("buildUrl", () => {
  test("joins a REST root and a route path without doubling slashes", () => {
    expect(buildUrl("https://example.com/wp-json", "/wp/v2/posts").toString()).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
    expect(buildUrl("https://example.com/wp-json", "wp/v2/posts").toString()).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
  });

  test("appends serialized parameters", () => {
    const url = buildUrl("https://example.com/wp-json", "/wp/v2/posts", { perPage: 5 });
    expect(url.searchParams.get("per_page")).toBe("5");
  });
});
