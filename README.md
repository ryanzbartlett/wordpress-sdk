# @ryandotzone/wp-sdk

A typed TypeScript client for the WordPress REST API, built for headless projects.

- **Typed against the real API.** `context: "edit"` gives you `raw` fields, `context: "embed"` doesn't have `content`, and `fields: ["id", "slug"]` narrows the return type as well as the payload.
- **Pagination that works.** `X-WP-Total`, `X-WP-TotalPages` and the `Link` header are parsed for you; `all()` walks every page.
- **Zero runtime dependencies.** One `fetch` call underneath. Runs in Bun, Node 18+, Deno, browsers and edge runtimes.
- **Read-optimized.** Every GET route is modelled; writes go through a typed escape hatch (see [Writing](#writing)).

```sh
bun add @ryandotzone/wp-sdk
```

## Quick start

```ts
import { createClient } from "@ryandotzone/wp-sdk";

const wp = createClient({ url: "https://example.com" });

const page = await wp.posts.list({ perPage: 10, embed: true });

for (const post of page) {
  console.log(post.title.rendered);
}

console.log(`${page.total} posts across ${page.totalPages} pages`);
```

The `url` is your site root — the SDK appends `/wp-json` itself, and normalizes away the
trailing slash that would otherwise cause a redirect (and drop your `Authorization` header).

## Reading

Every collection resource has the same shape:

```ts
await wp.posts.list({ perPage: 20, categories: [3] });  // one Page
await wp.posts.get(42);                                 // by ID
await wp.posts.bySlug("hello-world");                   // by slug; throws if missing
await wp.posts.first({ search: "bun" });                // first match, or null
await wp.posts.count({ status: "publish" });            // X-WP-Total, no payload
await wp.posts.collect({ categories: [3] });            // every match, all pages
```

The resources: `posts`, `pages`, `media`, `categories`, `tags`, `users`, `comments`,
plus `taxonomies`, `types`, `statuses`, `settings`, `search` and `root`.

```ts
await wp.terms("product_cat").list({ hideEmpty: true });  // any taxonomy
await wp.collection("product").list();                    // any post type
await wp.posts.revisions(42).list();                      // authenticated
await wp.media.forPost(42);
await wp.comments.forPost(42);
await wp.users.me();
```

### Pagination

A `Page` knows where it sits in the collection and can fetch its neighbours:

```ts
const first = await wp.posts.list({ perPage: 10 });

first.total;         // 25
first.totalPages;    // 3
first.hasNextPage;   // true
const second = await first.next();
```

To walk everything, use `all()` — it requests pages of 100 and yields items:

```ts
for await (const post of wp.posts.all({ status: "publish" })) {
  console.log(post.slug);
}
```

`all()` and `collect()` stop after 1000 pages by default, as a guard against a site with
unexpected pagination headers. Pass a second argument to change it.

### Selecting fields

`fields` maps to `_fields` and narrows the TypeScript type to match the payload:

```ts
const page = await wp.posts.list({ fields: ["id", "slug", "title"] });
page.data[0].title.rendered;  // ok
page.data[0].content;         // Type error — you didn't ask for it
```

### Embedding

`embed: true` maps to `_embed`. WordPress returns embedded resources in an awkward
nested shape, so the SDK ships accessors for it:

```ts
import { getAuthor, getFeaturedMedia, getTerms, getSrcSet } from "@ryandotzone/wp-sdk";

const post = await wp.posts.get(42, { embed: true });

getAuthor(post)?.name;
getFeaturedMedia(post)?.source_url;
getTerms(post, "category").map((term) => term.name);
getSrcSet(getFeaturedMedia(post));  // for a responsive <img>
```

These skip the error objects WordPress substitutes when the current user cannot read an
embedded resource, so they return `null`/`[]` rather than handing you an error shaped
like a post.

To embed only some relations: `embed: ["author", "wp:featuredmedia"]`.

### Context

```ts
const view = await wp.posts.get(1);                      // title: { rendered }
const edit = await wp.posts.get(1, { context: "edit" }); // title: { rendered, raw }
const user = await wp.users.get(1, { context: "edit" }); // adds email, roles, …
```

`edit` context requires authentication.

## Authentication

Auth is a one-method interface, so anything works. Two implementations are built in:

```ts
import { createClient, basicAuth, bearerAuth } from "@ryandotzone/wp-sdk";

// WordPress Application Passwords (Users → Profile → Application Passwords)
const wp = createClient({
  url: "https://example.com",
  auth: basicAuth({ username: "ada", password: process.env.WP_APP_PASSWORD! }),
});

// A JWT plugin, or anything else that issues bearer tokens.
// Pass a getter and it is called per request, so refresh just works.
const wp2 = createClient({
  url: "https://example.com",
  auth: bearerAuth(async () => session.getAccessToken()),
});
```

Also available: `headerAuth({ "X-Api-Key": "…" })` and `nonceAuth(nonce)` for same-origin
browser contexts. Or write your own — an authenticator is any function that decorates the
outgoing headers:

```ts
const wp3 = createClient({
  url: "https://example.com",
  auth: async ({ headers, url }) => {
    headers.set("Authorization", await sign(url));
  },
});
```

The client refuses a plaintext `http://` URL unless the host is local or you pass
`allowInsecure: true`, since Basic auth over HTTP sends credentials in the clear.

## Errors

Failures throw a typed error rather than returning a status code:

```ts
import { WPNotFoundError, WPAuthError, WPValidationError } from "@ryandotzone/wp-sdk";

try {
  await wp.posts.bySlug("missing");
} catch (error) {
  if (error instanceof WPNotFoundError) return null;
  if (error instanceof WPAuthError) throw new Error("Check your credentials");
  if (error instanceof WPValidationError) console.error(error.params);
  throw error;
}
```

All of them extend `WPError` and carry WordPress's own `code`, the `status`, and the
parsed `body`. Transport failures (DNS, TLS, timeout, abort) throw `WPRequestError`
instead, which has no status because no response arrived.

Retries are on by default for idempotent requests: three attempts on 408/429/5xx with
jittered exponential backoff, honouring `Retry-After` when the server sends it.

```ts
createClient({ url, retry: { attempts: 5, baseDelayMs: 500 } });
createClient({ url, retry: false });
```

## Framework integration

There is no framework adapter, because none is needed — `fetch` and its options are
yours to control.

**Next.js** — pass cache directives straight through, per client or per request:

```ts
const wp = createClient({
  url: process.env.WORDPRESS_URL!,
  fetchOptions: { next: { revalidate: 60 } },
});

// Or per call, e.g. to tag a route for on-demand revalidation:
await wp.posts.list({
  perPage: 10,
  fetchOptions: { next: { tags: ["posts"] } },
});
```

**Any framework** — every read accepts `signal`, `timeoutMs`, `headers` and
`fetchOptions` alongside the query parameters:

```ts
await wp.posts.list({ perPage: 10, signal: request.signal, timeoutMs: 5000 });
```

**Caching or instrumenting everything** — replace `fetch` outright:

```ts
createClient({
  url,
  fetch: (request) => myCachingFetch(request),
  onRequest: (request) => logger.debug(request.url),
  onRetry: ({ attempt, delayMs }) => logger.warn(`retry ${attempt} in ${delayMs}ms`),
});
```

## Custom post types

Pass the entity inline:

```ts
import type { CustomPost } from "@ryandotzone/wp-sdk";

interface Product extends CustomPost {
  meta: { price: number; sku: string };
}

const products = await wp.collection<Product>("products").list();
```

Or register it once, and every later call is typed without the annotation:

```ts
declare module "@ryandotzone/wp-sdk" {
  interface WPResources {
    products: Product;
  }
}

await wp.collection("products").list();  // Page<Product>
```

`WithMeta` is a shortcut for retyping just the meta of a core entity:

```ts
import type { Post, WithMeta } from "@ryandotzone/wp-sdk";
type Review = WithMeta<Post, { rating: number }>;
```

## Writing

Write resources are not modelled yet. Until they are, `request()` reaches any route with
any method, typed by you:

```ts
const { data } = await wp.request<Post>({
  method: "POST",
  path: "/wp/v2/posts",
  body: { title: "Hello", status: "draft" },
});
```

A plain object body is JSON-encoded; a `FormData` body is passed through untouched, so
media uploads keep their multipart boundary. Non-idempotent methods are not retried
unless you opt in with `retry: { retryNonIdempotent: true }`.

`wp.url("/wp/v2/posts", { perPage: 5 })` returns exactly the URL the SDK would request,
which is useful for debugging and for building cache keys.

## Development

```sh
bun install
bun test          # unit + integration, against a fake WordPress served by Bun.serve()
bun run typecheck # also runs the type-level tests in tests/types
bun run lint
bun run build     # ESM + CJS + bundled declarations, then verifies dist
```

Integration tests run the real client against a real HTTP server
(`tests/fixtures/server.ts`) rather than a mocked `fetch`, so headers, pagination links
and error bodies are all exercised. To check those fixtures against a real site:

```sh
WP_TEST_URL=https://example.com bun test tests/live.smoke.test.ts
```

Two build details are deliberate and worth knowing before you change them:

- `sideEffects` is scoped to `["./src/**"]`, not `false`. With `false`, Bun's bundler
  prunes the library's own modules while building the library, emitting an entry point
  that re-exports names it never defines. The narrowed form still tells a consumer's
  bundler that everything in `dist` is side-effect free. `scripts/check-dist.ts` loads
  both built bundles so this cannot regress silently.
- Declarations are bundled into a single file by `scripts/build-types.ts`. Per-file
  `.d.ts` output has extensionless relative imports that `moduleResolution: "nodenext"`
  consumers cannot resolve, and the CJS entry needs its own `.d.cts` to avoid
  masquerading as ESM.

## License

MIT
