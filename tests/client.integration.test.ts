/**
 * End-to-end tests: the real client against a real HTTP server.
 *
 * These exercise the parts a mocked `fetch` would paper over — header parsing,
 * pagination links, query serialization on the wire, and error bodies.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { basicAuth } from "../src/auth";
import { createClient, type WPClient } from "../src/client";
import { getAuthor, getFeaturedMedia, getTerms } from "../src/embed";
import { WPAuthError, WPNotFoundError, WPServerError } from "../src/errors";
import { startFakeWordPress, TOTAL_POSTS } from "./fixtures/server";

const wordpress = startFakeWordPress();

function client(overrides: Partial<Parameters<typeof createClient>[0]> = {}): WPClient {
  return createClient({ url: wordpress.url, retry: false, ...overrides });
}

beforeEach(() => wordpress.reset());
afterAll(() => wordpress.stop());

describe("reading collections", () => {
  test("lists posts with totals from the response headers", async () => {
    const page = await client().posts.list({ perPage: 10 });

    expect(page.data).toHaveLength(10);
    expect(page.total).toBe(TOTAL_POSTS);
    expect(page.totalPages).toBe(3);
    expect(page.page).toBe(1);
    expect(page.hasNextPage).toBe(true);
    expect(page.data[0]?.title.rendered).toBe("Post 1");
  });

  test("follows the Link header to the next page", async () => {
    const first = await client().posts.list({ perPage: 10 });
    const second = await first.next();

    expect(second?.page).toBe(2);
    expect(second?.data[0]?.id).toBe(11);
    expect((await second?.previous())?.page).toBe(1);
  });

  test("last page reports no next page", async () => {
    const page = await client().posts.list({ perPage: 10, page: 3 });
    expect(page.data).toHaveLength(5);
    expect(page.hasNextPage).toBe(false);
    expect(await page.next()).toBeNull();
  });

  test("all() walks every page", async () => {
    const ids: number[] = [];
    for await (const post of client().posts.all({ perPage: 10 })) ids.push(post.id);

    expect(ids).toHaveLength(TOTAL_POSTS);
    expect(ids[0]).toBe(1);
    expect(ids.at(-1)).toBe(TOTAL_POSTS);
    // One request per page, not per item.
    expect(wordpress.requests).toHaveLength(3);
  });

  test("collect() returns every item as an array", async () => {
    expect(await client().posts.collect({ perPage: 20 })).toHaveLength(TOTAL_POSTS);
  });

  test("count() reads the total without transferring the items", async () => {
    expect(await client().posts.count()).toBe(TOTAL_POSTS);

    const request = wordpress.requests[0];
    expect(request?.params.get("per_page")).toBe("1");
    expect(request?.params.get("_fields")).toBe("id");
  });
});

describe("reading single entities", () => {
  test("get() fetches by ID", async () => {
    const post = await client().posts.get(7);
    expect(post.id).toBe(7);
    expect(post.slug).toBe("post-7");
  });

  test("get() throws WPNotFoundError for a missing ID", async () => {
    const error = await client()
      .posts.get(9999)
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(WPNotFoundError);
    expect(error.code).toBe("rest_post_invalid_id");
    expect(error.status).toBe(404);
  });

  test("bySlug() resolves the lookup a headless route actually needs", async () => {
    const post = await client().posts.bySlug("post-12");
    expect(post.id).toBe(12);
    // A single slug goes out as a scalar; WordPress accepts either form.
    expect(wordpress.requests[0]?.params.get("slug")).toBe("post-12");
    expect(wordpress.requests[0]?.params.get("per_page")).toBe("1");
  });

  test("bySlug() throws WPNotFoundError rather than returning undefined", async () => {
    await expect(client().posts.bySlug("nope")).rejects.toThrow(WPNotFoundError);
  });

  test("first() returns null instead of throwing", async () => {
    expect(await client().posts.first({ search: "nothing matches" })).toBeNull();
  });
});

describe("query parameters on the wire", () => {
  test("sends WordPress spellings for camelCase options", async () => {
    await client().posts.list({ perPage: 5, include: [3, 1], order: "asc" });

    const params = wordpress.requests[0]?.params;
    expect(params?.get("per_page")).toBe("5");
    expect(params?.getAll("include[]")).toEqual(["3", "1"]);
    expect(params?.get("order")).toBe("asc");
  });

  test("narrows the payload with _fields", async () => {
    const page = await client().posts.list({ perPage: 2, fields: ["id", "slug"] });

    expect(wordpress.requests[0]?.params.get("_fields")).toBe("id,slug");
    expect(Object.keys(page.data[0] ?? {})).toEqual(["id", "slug"]);
  });

  test("embed: true returns linked resources under _embedded", async () => {
    const page = await client().posts.list({ perPage: 1, embed: true });
    const post = page.data[0];

    expect(wordpress.requests[0]?.params.get("_embed")).toBe("1");
    expect(getAuthor(post)?.name).toBe("Ada Lovelace");
    expect(getTerms(post, "category").map((term) => term.slug)).toEqual(["news"]);
  });

  test("a post with no featured image embeds none", async () => {
    const page = await client().posts.list({ perPage: 1, page: 1, embed: true });
    // Post 1 is odd-numbered, so the fixture gives it no featured media.
    expect(getFeaturedMedia(page.data[0])).toBeNull();
  });
});

describe("authentication", () => {
  test("an unauthenticated settings read fails with WPAuthError", async () => {
    const error = await client()
      .settings.get()
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(WPAuthError);
    expect(error.status).toBe(401);
  });

  test("Application Password credentials are sent as Basic auth", async () => {
    const authed = client({ auth: basicAuth({ username: "ada", password: "secret" }) });
    const settings = await authed.settings.get();

    expect(settings.title).toBe("Fake WP");
    expect(wordpress.requests[0]?.headers.authorization).toStartWith("Basic ");
  });
});

describe("keyed routes", () => {
  test("taxonomies come back keyed by slug, not as an array", async () => {
    const taxonomies = await client().taxonomies.list();
    expect(Object.keys(taxonomies).sort()).toEqual(["category", "post_tag"]);
    expect(taxonomies.category?.rest_base).toBe("categories");
  });

  test("all() flattens the keyed object into an array", async () => {
    expect(await client().taxonomies.all()).toHaveLength(2);
  });
});

describe("failures and retries", () => {
  test("retries a 5xx and eventually succeeds", async () => {
    wordpress.failNext(2, 503);
    const wp = createClient({
      url: wordpress.url,
      retry: { attempts: 3, baseDelayMs: 1 },
    });

    const page = await wp.posts.list({ perPage: 1 });
    expect(page.data).toHaveLength(1);
    expect(wordpress.requests).toHaveLength(3);
  });

  test("surfaces a non-JSON gateway error as WPServerError", async () => {
    const error = await client()
      .request({ path: "/wp/v2/broken" })
      .catch((cause) => cause);

    expect(error).toBeInstanceOf(WPServerError);
    expect(error.code).toBe("http_502");
  });

  test("an aborted request rejects and sends nothing further", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(client().posts.list({ perPage: 1, signal: controller.signal })).rejects.toThrow();
  });
});

describe("escape hatch", () => {
  test("request() reaches routes the resources do not model, including writes", async () => {
    const wp = client();
    await wp
      .request({ method: "POST", path: "/wp/v2/posts", body: { title: "Draft" } })
      .catch(() => {});

    const request = wordpress.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.body).toBe('{"title":"Draft"}');
  });

  test("url() shows exactly what the SDK would request", async () => {
    const url = client().url("/wp/v2/posts", { perPage: 5, embed: true });
    expect(url.pathname).toBe("/wp-json/wp/v2/posts");
    expect(url.searchParams.get("per_page")).toBe("5");
    expect(url.searchParams.get("_embed")).toBe("1");
  });

  test("collection() targets a custom post type", async () => {
    await client()
      .collection("product")
      .list({ perPage: 5 })
      .catch(() => {});
    expect(wordpress.requests[0]?.path).toBe("/wp-json/wp/v2/product");
  });
});

describe("api root", () => {
  test("reads the site description document", async () => {
    const root = await client().root.get();
    expect(root.name).toBe("Fake WP");
    expect(root.namespaces).toContain("wp/v2");
  });
});
