/**
 * The generic read resource behind every route.
 *
 * One implementation serves posts, pages, media, terms, users and comments; the
 * per-route modules only supply the path and the parameter/entity types. The type
 * gymnastics here are what make `fields`, `embed` and `context` change the *return*
 * type rather than just the request.
 */

import type { Embeddable } from "../embed";
import { WPNotFoundError } from "../errors";
import type { HttpClient, RequestOptions } from "../http";
import { collect, type Page, pageFromResponse, paginate } from "../pagination";
import { normalizeParams } from "../query";
import type { Context } from "../types/common";
import type { GetParams, ListParams } from "../types/params";

/** The three shapes one entity takes, keyed by request context. */
export interface EntityShapes<View = unknown, Embed = unknown, Edit = unknown> {
  view: View;
  embed: Embed;
  edit: Edit;
}

/** The context a call requested, defaulting to `view`. */
type ContextOf<P> = P extends { context: infer C } ? (C extends Context ? C : "view") : "view";

/** The entity shape a call will receive. */
type EntityFor<S extends EntityShapes, P> = S[ContextOf<P>];

/** `fields: ["id", "slug"]` narrows the entity to just those keys. */
type Selected<E, P> = P extends { fields: infer F }
  ? F extends readonly (infer K)[]
    ? Pick<E, Extract<K, keyof E>>
    : E
  : E;

/** `embed: true` adds the optional `_embedded` payload. */
type WithEmbedded<E, P> = P extends { embed: infer B }
  ? B extends false | undefined
    ? E
    : Embeddable<E>
  : E;

/** The full return type for a call with parameters `P` against entity shapes `S`. */
export type Result<S extends EntityShapes, P> = WithEmbedded<Selected<EntityFor<S, P>, P>, P>;

/** Per-call transport overrides, accepted alongside query parameters. */
export interface RequestOverrides {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Merged into `RequestInit` — e.g. Next.js `{ next: { revalidate: 60 } }`. */
  fetchOptions?: RequestInit;
  headers?: Record<string, string>;
}

/** Split caller input into query parameters and transport overrides. */
function splitOptions(input: object = {}): {
  params: Record<string, unknown>;
  overrides: RequestOverrides;
} {
  const { signal, timeoutMs, fetchOptions, headers, ...params } = input as Record<string, unknown>;
  return {
    params,
    overrides: {
      signal: signal as AbortSignal | undefined,
      timeoutMs: timeoutMs as number | undefined,
      fetchOptions: fetchOptions as RequestInit | undefined,
      headers: headers as Record<string, string> | undefined,
    },
  };
}

function toRequestOptions(overrides: RequestOverrides): Partial<RequestOptions> {
  const options: Partial<RequestOptions> = {};
  if (overrides.signal) options.signal = overrides.signal;
  if (overrides.timeoutMs !== undefined) options.timeoutMs = overrides.timeoutMs;
  if (overrides.fetchOptions) options.fetchOptions = overrides.fetchOptions;
  if (overrides.headers) options.headers = overrides.headers;
  return options;
}

export class CollectionResource<
  S extends EntityShapes = EntityShapes,
  LP extends ListParams<Context> = ListParams<Context>,
  GP extends GetParams<Context> = GetParams<Context>,
> {
  constructor(
    protected readonly http: HttpClient,
    /** Route path relative to the REST root, e.g. `/wp/v2/posts`. */
    readonly path: string,
  ) {}

  /**
   * Fetch one page of the collection.
   *
   * ```ts
   * const page = await wp.posts.list({ perPage: 10, embed: true });
   * for (const post of page) console.log(post.title.rendered);
   * ```
   */
  async list<const P extends LP & RequestOverrides>(params?: P): Promise<Page<Result<S, P>>> {
    const { params: query, overrides } = splitOptions(params);
    const normalized = normalizeParams(query);
    const perPage = typeof normalized.perPage === "number" ? normalized.perPage : null;
    const requested = typeof normalized.page === "number" ? normalized.page : 1;

    const fetchPage = async (page: number): Promise<Page<Result<S, P>>> => {
      const { data, response } = await this.http.request<Result<S, P>[]>({
        path: this.path,
        params: { ...normalized, page },
        ...toRequestOptions(overrides),
      });
      return pageFromResponse(Array.isArray(data) ? data : [], response, page, perPage, fetchPage);
    };

    return fetchPage(requested);
  }

  /** Fetch a single entity by its numeric ID. */
  async get<const P extends GP & RequestOverrides>(id: number, params?: P): Promise<Result<S, P>> {
    const { params: query, overrides } = splitOptions(params);
    const { data } = await this.http.request<Result<S, P>>({
      path: `${this.path}/${id}`,
      params: normalizeParams(query),
      ...toRequestOptions(overrides),
    });
    return data;
  }

  /**
   * Fetch a single entity by slug — the lookup a headless route handler almost always
   * needs. Throws {@link WPNotFoundError} when nothing matches, mirroring `get()`.
   */
  async bySlug<const P extends Omit<LP, "slug"> & RequestOverrides>(
    slug: string,
    params?: P,
  ): Promise<Result<S, P>> {
    const found = await this.first({ ...(params as object), slug } as never);
    if (!found) {
      throw new WPNotFoundError(`No ${this.path} entry with slug "${slug}".`, {
        code: "rest_post_invalid_slug",
        status: 404,
        url: this.http.urlFor(this.path, { slug }).toString(),
      });
    }
    return found as Result<S, P>;
  }

  /** The first matching entity, or `null` when the collection is empty. */
  async first<const P extends LP & RequestOverrides>(params?: P): Promise<Result<S, P> | null> {
    const page = await this.list({ ...(params as object), perPage: 1 } as never);
    return (page.data[0] as Result<S, P> | undefined) ?? null;
  }

  /**
   * Iterate every matching entity across every page.
   *
   * ```ts
   * for await (const post of wp.posts.all({ status: "publish" })) { ... }
   * ```
   *
   * Requests pages of 100 unless `perPage` says otherwise, and stops after
   * `maxPages` (default 1000) as a runaway guard.
   */
  all<const P extends LP & RequestOverrides>(
    params?: P,
    maxPages?: number,
  ): AsyncGenerator<Result<S, P>, void, undefined> {
    const perPage = (params as ListParams | undefined)?.perPage ?? 100;
    return paginate(
      this.list({ ...(params as object), perPage } as never),
      maxPages,
    ) as AsyncGenerator<Result<S, P>, void, undefined>;
  }

  /** Collect every matching entity into one array. Convenience over {@link all}. */
  async collect<const P extends LP & RequestOverrides>(
    params?: P,
    maxPages?: number,
  ): Promise<Result<S, P>[]> {
    const perPage = (params as ListParams | undefined)?.perPage ?? 100;
    return collect(this.list({ ...(params as object), perPage } as never), maxPages) as Promise<
      Result<S, P>[]
    >;
  }

  /**
   * Total number of matching entities, from the `X-WP-Total` header, without
   * transferring the items. `null` if the site does not send the header.
   */
  async count(params?: LP & RequestOverrides): Promise<number | null> {
    const { params: query, overrides } = splitOptions(params);
    const { response } = await this.http.request<unknown>({
      path: this.path,
      params: { ...normalizeParams(query), perPage: 1, page: 1, _fields: ["id"] },
      ...toRequestOptions(overrides),
    });
    const total = response.headers.get("x-wp-total");
    return total === null || !Number.isFinite(Number(total)) ? null : Number(total);
  }
}
