/**
 * Collection pagination.
 *
 * WordPress reports totals in `X-WP-Total` / `X-WP-TotalPages` headers and next/prev
 * links in a `Link` header. A {@link Page} carries all of that alongside the items, so
 * callers never have to touch the raw response.
 */

export interface PageLinks {
  next?: string;
  prev?: string;
  first?: string;
  last?: string;
}

/** Parse an RFC 8288 `Link` header into a `rel -> href` map. */
export function parseLinkHeader(header: string | null): PageLinks {
  const links: PageLinks = {};
  if (!header) return links;

  for (const part of header.split(/,\s*(?=<)/)) {
    const match = /^\s*<([^>]+)>\s*;\s*(.*)$/.exec(part);
    if (!match) continue;
    const [, href, attributes] = match;
    const rel = /rel\s*=\s*"?([^";]+)"?/.exec(attributes ?? "")?.[1]?.trim();
    if (!rel || !href) continue;
    for (const name of rel.split(/\s+/)) {
      if (name === "next" || name === "prev" || name === "first" || name === "last") {
        links[name] = href;
      }
    }
  }

  return links;
}

function parseCount(header: string | null): number | null {
  if (header === null) return null;
  const value = Number(header);
  return Number.isFinite(value) ? value : null;
}

/** How a {@link Page} fetches its neighbours. */
export type PageFetcher<T> = (page: number) => Promise<Page<T>>;

/**
 * One page of a collection. Iterable over its own items, and able to fetch the
 * pages either side of it.
 */
export class Page<T> implements Iterable<T> {
  /** The items on this page. */
  readonly data: readonly T[];
  /** Total items across all pages, or `null` if WordPress omitted the header. */
  readonly total: number | null;
  /** Total number of pages, or `null` if WordPress omitted the header. */
  readonly totalPages: number | null;
  /** This page's 1-based number. */
  readonly page: number;
  /** The requested page size. */
  readonly perPage: number | null;
  readonly links: PageLinks;
  private readonly fetcher: PageFetcher<T>;

  constructor(init: {
    data: readonly T[];
    total: number | null;
    totalPages: number | null;
    page: number;
    perPage: number | null;
    links: PageLinks;
    fetcher: PageFetcher<T>;
  }) {
    this.data = init.data;
    this.total = init.total;
    this.totalPages = init.totalPages;
    this.page = init.page;
    this.perPage = init.perPage;
    this.links = init.links;
    this.fetcher = init.fetcher;
  }

  get hasNextPage(): boolean {
    if (this.links.next) return true;
    if (this.totalPages !== null) return this.page < this.totalPages;
    // No headers and no link: assume a full page means there may be more.
    return this.perPage !== null && this.data.length >= this.perPage;
  }

  get hasPreviousPage(): boolean {
    return this.page > 1;
  }

  /** Fetch the next page, or `null` when this is the last one. */
  async next(): Promise<Page<T> | null> {
    return this.hasNextPage ? this.fetcher(this.page + 1) : null;
  }

  /** Fetch the previous page, or `null` when this is the first one. */
  async previous(): Promise<Page<T> | null> {
    return this.hasPreviousPage ? this.fetcher(this.page - 1) : null;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.data[Symbol.iterator]();
  }
}

/** Build a {@link Page} from a response and its parsed body. */
export function pageFromResponse<T>(
  data: readonly T[],
  response: Response,
  page: number,
  perPage: number | null,
  fetcher: PageFetcher<T>,
): Page<T> {
  return new Page({
    data,
    total: parseCount(response.headers.get("x-wp-total")),
    totalPages: parseCount(response.headers.get("x-wp-totalpages")),
    page,
    perPage,
    links: parseLinkHeader(response.headers.get("link")),
    fetcher,
  });
}

/**
 * Walk every page of a collection, yielding items one at a time.
 *
 * `maxPages` is a guard against an unbounded loop if a site returns unexpected
 * pagination headers; it defaults to 1000 pages.
 */
export async function* paginate<T>(
  first: Page<T> | Promise<Page<T>>,
  maxPages = 1000,
): AsyncGenerator<T, void, undefined> {
  let current: Page<T> | null = await first;
  let seen = 0;

  while (current && seen < maxPages) {
    seen++;
    for (const item of current.data) yield item;
    current = await current.next();
  }
}

/** Collect every item across every page into one array. */
export async function collect<T>(first: Page<T> | Promise<Page<T>>, maxPages = 1000): Promise<T[]> {
  const items: T[] = [];
  for await (const item of paginate(first, maxPages)) items.push(item);
  return items;
}
