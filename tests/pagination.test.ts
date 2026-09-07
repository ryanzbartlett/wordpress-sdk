import { describe, expect, test } from "bun:test";
import { collect, Page, pageFromResponse, paginate, parseLinkHeader } from "../src/pagination";

describe("parseLinkHeader", () => {
  test("extracts next and prev hrefs", () => {
    const header =
      '<https://example.com/wp-json/wp/v2/posts?page=1>; rel="prev", ' +
      '<https://example.com/wp-json/wp/v2/posts?page=3>; rel="next"';
    expect(parseLinkHeader(header)).toEqual({
      prev: "https://example.com/wp-json/wp/v2/posts?page=1",
      next: "https://example.com/wp-json/wp/v2/posts?page=3",
    });
  });

  test("tolerates unquoted rel values and extra attributes", () => {
    const header = '<https://example.com/a>; rel=next; title="Next page"';
    expect(parseLinkHeader(header).next).toBe("https://example.com/a");
  });

  test("does not split on commas inside a URL", () => {
    const header = '<https://example.com/a?include[]=1,2>; rel="next"';
    expect(parseLinkHeader(header).next).toBe("https://example.com/a?include[]=1,2");
  });

  test("returns an empty map for a missing header", () => {
    expect(parseLinkHeader(null)).toEqual({});
  });
});

function response(headers: Record<string, string>): Response {
  return new Response("[]", { headers });
}

describe("Page", () => {
  const fetcher = async (page: number): Promise<Page<string>> =>
    pageFromResponse(
      [`item-${page}`],
      response({ "x-wp-total": "3", "x-wp-totalpages": "3" }),
      page,
      1,
      fetcher,
    );

  test("reads totals from WordPress headers", () => {
    const page = pageFromResponse(
      ["a", "b"],
      response({ "x-wp-total": "25", "x-wp-totalpages": "3" }),
      1,
      10,
      fetcher,
    );

    expect(page.total).toBe(25);
    expect(page.totalPages).toBe(3);
    expect(page.hasNextPage).toBe(true);
    expect(page.hasPreviousPage).toBe(false);
  });

  test("reports null totals when the site omits the headers", () => {
    const page = pageFromResponse(["a"], response({}), 1, 10, fetcher);
    expect(page.total).toBeNull();
    expect(page.totalPages).toBeNull();
    // A short page with no headers is the end of the collection.
    expect(page.hasNextPage).toBe(false);
  });

  test("falls back to a full page meaning there may be more", () => {
    const page = pageFromResponse(["a", "b"], response({}), 1, 2, fetcher);
    expect(page.hasNextPage).toBe(true);
  });

  test("is iterable over its own items", () => {
    const page = pageFromResponse(["a", "b"], response({}), 1, 10, fetcher);
    expect([...page]).toEqual(["a", "b"]);
  });

  test("next() returns null on the last page", async () => {
    const last = pageFromResponse(
      ["c"],
      response({ "x-wp-total": "3", "x-wp-totalpages": "3" }),
      3,
      1,
      fetcher,
    );
    expect(await last.next()).toBeNull();
    expect((await last.previous())?.page).toBe(2);
  });
});

describe("paginate", () => {
  const makePage = (page: number, totalPages: number): Page<string> =>
    new Page({
      data: [`item-${page}`],
      total: totalPages,
      totalPages,
      page,
      perPage: 1,
      links: {},
      fetcher: async (next) => makePage(next, totalPages),
    });

  test("walks every page and yields items in order", async () => {
    expect(await collect(makePage(1, 3))).toEqual(["item-1", "item-2", "item-3"]);
  });

  test("stops at maxPages so bad pagination headers cannot loop forever", async () => {
    const runaway = (page: number): Page<string> =>
      new Page({
        data: [`item-${page}`],
        total: null,
        totalPages: 999_999,
        page,
        perPage: 1,
        links: {},
        fetcher: async (next) => runaway(next),
      });

    const items: string[] = [];
    for await (const item of paginate(runaway(1), 5)) items.push(item);
    expect(items).toHaveLength(5);
  });
});
