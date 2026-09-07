/**
 * A fake WordPress site, served by `Bun.serve()`.
 *
 * Integration tests run the real client against this rather than mocking `fetch`, so
 * header handling, redirects, pagination and error parsing are all exercised end to end.
 * The payload shapes mirror what a stock WordPress install returns.
 */

export interface RecordedRequest {
  method: string;
  path: string;
  search: string;
  params: URLSearchParams;
  headers: Record<string, string>;
  body: string | null;
}

export interface FakeWordPress {
  /** Site root, e.g. `http://localhost:53211`. */
  url: string;
  /** Every request the server has received, in order. */
  requests: RecordedRequest[];
  /** Fail the next `count` requests with `status` before succeeding. */
  failNext(count: number, status?: number, headers?: Record<string, string>): void;
  reset(): void;
  stop(): Promise<void>;
}

const TOTAL_POSTS = 25;

function makePost(id: number) {
  return {
    id,
    date: `2026-01-${String((id % 28) + 1).padStart(2, "0")}T10:00:00`,
    date_gmt: `2026-01-${String((id % 28) + 1).padStart(2, "0")}T10:00:00`,
    guid: { rendered: `https://example.com/?p=${id}` },
    modified: "2026-02-01T10:00:00",
    modified_gmt: "2026-02-01T10:00:00",
    slug: `post-${id}`,
    status: "publish",
    type: "post",
    link: `https://example.com/post-${id}/`,
    title: { rendered: `Post ${id}` },
    content: { rendered: `<p>Body of post ${id}</p>`, protected: false },
    excerpt: { rendered: `<p>Excerpt ${id}</p>`, protected: false },
    author: 1,
    featured_media: id % 2 === 0 ? 100 : 0,
    comment_status: "open",
    ping_status: "open",
    sticky: false,
    template: "",
    format: "standard",
    meta: {},
    categories: [3],
    tags: [],
    _links: { self: [{ href: `https://example.com/wp-json/wp/v2/posts/${id}` }] },
  };
}

const ALL_POSTS = Array.from({ length: TOTAL_POSTS }, (_, index) => makePost(index + 1));

const AUTHOR = {
  id: 1,
  name: "Ada Lovelace",
  url: "",
  description: "",
  link: "https://example.com/author/ada/",
  slug: "ada",
  avatar_urls: { "96": "https://example.com/avatar-96.png" },
};

const FEATURED_MEDIA = {
  id: 100,
  date: "2026-01-01T10:00:00",
  slug: "hero",
  type: "attachment",
  link: "https://example.com/hero/",
  title: { rendered: "Hero" },
  author: 1,
  alt_text: "A hero image",
  caption: { rendered: "", protected: false },
  media_type: "image",
  mime_type: "image/jpeg",
  media_details: {
    width: 1600,
    height: 900,
    file: "2026/01/hero.jpg",
    sizes: {
      thumbnail: {
        file: "hero-150x150.jpg",
        width: 150,
        height: 150,
        mime_type: "image/jpeg",
        source_url: "https://example.com/hero-150x150.jpg",
      },
      medium: {
        file: "hero-800x450.jpg",
        width: 800,
        height: 450,
        mime_type: "image/jpeg",
        source_url: "https://example.com/hero-800x450.jpg",
      },
    },
  },
  source_url: "https://example.com/hero.jpg",
  _links: {},
};

const CATEGORY = {
  id: 3,
  link: "https://example.com/category/news/",
  name: "News",
  slug: "news",
  taxonomy: "category",
  _links: {},
};

function pickFields(entity: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in entity) output[field] = entity[field];
  }
  return output;
}

function jsonError(code: string, message: string, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify({ code, message, data: { status } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function startFakeWordPress(): FakeWordPress {
  const requests: RecordedRequest[] = [];
  let pendingFailures = 0;
  let failureStatus = 500;
  let failureHeaders: Record<string, string> = {};

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body =
        request.method === "GET" || request.method === "HEAD" ? null : await request.text();

      requests.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        params: url.searchParams,
        headers: Object.fromEntries(request.headers.entries()),
        body,
      });

      if (pendingFailures > 0) {
        pendingFailures--;
        return jsonError("temporarily_unavailable", "Try again", failureStatus, failureHeaders);
      }

      if (!url.pathname.startsWith("/wp-json")) {
        return jsonError("rest_no_route", "No route was found", 404);
      }

      const route = url.pathname.slice("/wp-json".length).replace(/\/$/, "");
      const params = url.searchParams;

      // A bare `/wp-json` root document.
      if (route === "") {
        return Response.json({
          name: "Fake WP",
          description: "A test site",
          url: url.origin,
          home: url.origin,
          gmt_offset: 0,
          timezone_string: "UTC",
          namespaces: ["wp/v2"],
          authentication: {},
          _links: {},
        });
      }

      if (route === "/wp/v2/posts") return listPosts(url, params);

      const single = /^\/wp\/v2\/posts\/(\d+)$/.exec(route);
      if (single) {
        const post = ALL_POSTS.find((item) => item.id === Number(single[1]));
        if (!post) {
          return jsonError("rest_post_invalid_id", "Invalid post ID.", 404);
        }
        return Response.json(post);
      }

      if (route === "/wp/v2/taxonomies") {
        return Response.json({
          category: {
            name: "Categories",
            slug: "category",
            description: "",
            types: ["post"],
            hierarchical: true,
            rest_base: "categories",
            rest_namespace: "wp/v2",
            _links: {},
          },
          post_tag: {
            name: "Tags",
            slug: "post_tag",
            description: "",
            types: ["post"],
            hierarchical: false,
            rest_base: "tags",
            rest_namespace: "wp/v2",
            _links: {},
          },
        });
      }

      if (route === "/wp/v2/settings") {
        if (!request.headers.get("authorization")) {
          return jsonError("rest_forbidden", "Sorry, you are not allowed to do that.", 401);
        }
        return Response.json({ title: "Fake WP", description: "A test site", posts_per_page: 10 });
      }

      if (route === "/wp/v2/rate-limited") {
        return jsonError("too_many_requests", "Slow down", 429, { "retry-after": "1" });
      }

      if (route === "/wp/v2/broken") {
        return new Response("<html>gateway error</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        });
      }

      if (route === "/wp/v2/invalid-param") {
        return new Response(
          JSON.stringify({
            code: "rest_invalid_param",
            message: "Invalid parameter(s): per_page",
            data: { status: 400, params: { per_page: "per_page must be between 1 and 100" } },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }

      return jsonError("rest_no_route", `No route was found matching ${route}`, 404);
    },
  });

  function listPosts(url: URL, params: URLSearchParams): Response {
    let posts: Record<string, unknown>[] = ALL_POSTS.map((post) => ({ ...post }));

    const slugs = params.getAll("slug[]").concat(params.getAll("slug"));
    if (slugs.length > 0) posts = posts.filter((post) => slugs.includes(post.slug as string));

    const search = params.get("search");
    if (search) {
      posts = posts.filter((post) =>
        (post.title as { rendered: string }).rendered.toLowerCase().includes(search.toLowerCase()),
      );
    }

    const includes = params.getAll("include[]");
    if (includes.length > 0) {
      posts = posts.filter((post) => includes.includes(String(post.id)));
    }

    if (params.get("order") === "asc") posts.reverse();

    const total = posts.length;
    const perPage = Number(params.get("per_page") ?? 10);
    const page = Number(params.get("page") ?? 1);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;

    if (page > totalPages && total > 0) {
      return jsonError(
        "rest_post_invalid_page_number",
        "The page number requested is larger than the number of pages available.",
        400,
      );
    }

    let items = posts.slice(start, start + perPage);

    if (params.get("_embed") !== null) {
      items = items.map((post) => ({
        ...post,
        _embedded: {
          author: [AUTHOR],
          "wp:featuredmedia": post.featured_media ? [FEATURED_MEDIA] : undefined,
          "wp:term": [[CATEGORY], []],
        },
      }));
    }

    const fields = params.get("_fields");
    if (fields) {
      const wanted = fields.split(",");
      items = items.map((post) => pickFields(post, wanted));
    }

    const headers = new Headers({
      "content-type": "application/json",
      "x-wp-total": String(total),
      "x-wp-totalpages": String(totalPages),
    });

    const links: string[] = [];
    if (page > 1) {
      const prev = new URL(url);
      prev.searchParams.set("page", String(page - 1));
      links.push(`<${prev.toString()}>; rel="prev"`);
    }
    if (page < totalPages) {
      const next = new URL(url);
      next.searchParams.set("page", String(page + 1));
      links.push(`<${next.toString()}>; rel="next"`);
    }
    if (links.length > 0) headers.set("link", links.join(", "));

    return new Response(JSON.stringify(items), { headers });
  }

  return {
    url: `http://localhost:${server.port}`,
    requests,
    failNext(count, status = 500, headers = {}) {
      pendingFailures = count;
      failureStatus = status;
      failureHeaders = headers;
    },
    reset() {
      requests.length = 0;
      pendingFailures = 0;
      failureStatus = 500;
      failureHeaders = {};
    },
    async stop() {
      await server.stop(true);
    },
  };
}

export { ALL_POSTS, TOTAL_POSTS };
