/**
 * Optional smoke test against a real WordPress install.
 *
 * The fake server in `tests/fixtures/server.ts` encodes assumptions about what
 * WordPress returns; this is how those assumptions get checked against the real thing.
 * Skipped unless a site is provided:
 *
 * ```sh
 * WP_TEST_URL=https://example.com bun test tests/live.smoke.test.ts
 * # optionally, for authenticated routes:
 * WP_TEST_USER=admin WP_TEST_APP_PASSWORD="xxxx xxxx" bun test tests/live.smoke.test.ts
 * ```
 */

import { describe, expect, test } from "bun:test";
import { basicAuth } from "../src/auth";
import { createClient } from "../src/client";
import { getAuthor, getTerms } from "../src/embed";

const url = process.env.WP_TEST_URL;
const username = process.env.WP_TEST_USER;
const password = process.env.WP_TEST_APP_PASSWORD;

const describeLive = url ? describe : describe.skip;

describeLive("live WordPress site", () => {
  const wp = createClient({
    url: url ?? "https://example.com",
    ...(username && password ? { auth: basicAuth({ username, password }) } : {}),
  });

  test("the API root advertises the wp/v2 namespace", async () => {
    const root = await wp.root.get();
    expect(root.namespaces).toContain("wp/v2");
  });

  test("posts come back with the pagination headers the SDK relies on", async () => {
    const page = await wp.posts.list({ perPage: 2 });
    expect(page.data.length).toBeLessThanOrEqual(2);
    // If either header is missing, Page falls back to heuristics — worth knowing.
    expect(page.total).not.toBeNull();
    expect(page.totalPages).not.toBeNull();
  });

  test("_fields really does narrow the payload", async () => {
    const page = await wp.posts.list({ perPage: 1, fields: ["id", "slug"] });
    const post = page.data[0];
    if (post) expect(Object.keys(post).sort()).toEqual(["id", "slug"]);
  });

  test("_embed returns the relations the accessors expect", async () => {
    const page = await wp.posts.list({ perPage: 1, embed: true });
    const post = page.data[0];
    if (!post) return;
    expect(post._embedded).toBeDefined();
    // An author is always present on a standard post.
    expect(getAuthor(post)).not.toBeNull();
    expect(Array.isArray(getTerms(post))).toBe(true);
  });

  test("taxonomies are keyed by slug, not returned as an array", async () => {
    const taxonomies = await wp.taxonomies.list();
    expect(Array.isArray(taxonomies)).toBe(false);
    expect(taxonomies.category?.rest_base).toBe("categories");
  });

  test.if(Boolean(username && password))("settings are readable when authenticated", async () => {
    const settings = await wp.settings.get();
    expect(typeof settings.title).toBe("string");
  });
});
