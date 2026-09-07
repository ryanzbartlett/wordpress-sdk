/**
 * Site-level routes that do not behave like collections.
 *
 * `/taxonomies`, `/types` and `/statuses` return an object keyed by slug rather than a
 * JSON array, and `/settings` is a singleton — so none of them can use
 * {@link CollectionResource}. `/search` *is* a paginated collection, but of search hits
 * rather than entities.
 */

import type { HttpClient } from "../http";
import { type Page, pageFromResponse } from "../pagination";
import { normalizeParams } from "../query";
import type { Context } from "../types/common";
import type {
  ApiRoot,
  PostStatusObject,
  PostType,
  SearchResult,
  Settings,
  Taxonomy,
} from "../types/entities";
import type { GetParams, SearchParams } from "../types/params";
import type { RequestOverrides } from "./collection";

/** A route that returns `{ slug: entity }` instead of an array. */
class KeyedResource<T> {
  constructor(
    private readonly http: HttpClient,
    private readonly path: string,
  ) {}

  /** Every entry, keyed by slug. */
  async list(params?: GetParams<Context> & RequestOverrides): Promise<Record<string, T>> {
    const { signal, timeoutMs, fetchOptions, headers, ...query } = params ?? {};
    const { data } = await this.http.request<Record<string, T>>({
      path: this.path,
      params: normalizeParams(query),
      signal,
      timeoutMs,
      fetchOptions,
      headers,
    });
    return data ?? {};
  }

  /** Every entry as an array, for when the keys are redundant. */
  async all(params?: GetParams<Context> & RequestOverrides): Promise<T[]> {
    return Object.values(await this.list(params));
  }

  /** A single entry by slug. */
  async get(slug: string, params?: GetParams<Context> & RequestOverrides): Promise<T> {
    const { signal, timeoutMs, fetchOptions, headers, ...query } = params ?? {};
    const { data } = await this.http.request<T>({
      path: `${this.path}/${slug}`,
      params: normalizeParams(query),
      signal,
      timeoutMs,
      fetchOptions,
      headers,
    });
    return data;
  }
}

/** `/wp/v2/taxonomies` */
export class TaxonomiesResource extends KeyedResource<Taxonomy> {}

/** `/wp/v2/types` */
export class TypesResource extends KeyedResource<PostType> {}

/** `/wp/v2/statuses` */
export class StatusesResource extends KeyedResource<PostStatusObject> {}

/** `/wp/v2/settings` — a singleton, and readable only with authentication. */
export class SettingsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly path = "/wp/v2/settings",
  ) {}

  async get(options?: RequestOverrides): Promise<Settings> {
    const { data } = await this.http.request<Settings>({
      path: this.path,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      fetchOptions: options?.fetchOptions,
      headers: options?.headers,
    });
    return data;
  }
}

/** `/wp/v2/search` — a paginated collection of lightweight hits across post types. */
export class SearchResource {
  constructor(
    private readonly http: HttpClient,
    private readonly path = "/wp/v2/search",
  ) {}

  async query(params: SearchParams & RequestOverrides = {}): Promise<Page<SearchResult>> {
    const { signal, timeoutMs, fetchOptions, headers, ...query } = params;
    const normalized = normalizeParams(query);
    const perPage = typeof normalized.perPage === "number" ? normalized.perPage : null;
    const requested = typeof normalized.page === "number" ? normalized.page : 1;

    const fetchPage = async (page: number): Promise<Page<SearchResult>> => {
      const { data, response } = await this.http.request<SearchResult[]>({
        path: this.path,
        params: { ...normalized, page },
        signal,
        timeoutMs,
        fetchOptions,
        headers,
      });
      return pageFromResponse(Array.isArray(data) ? data : [], response, page, perPage, fetchPage);
    };

    return fetchPage(requested);
  }
}

/** The API root document at `/`, which describes the site and its namespaces. */
export class RootResource {
  constructor(private readonly http: HttpClient) {}

  async get(options?: RequestOverrides): Promise<ApiRoot> {
    const { data } = await this.http.request<ApiRoot>({
      path: "/",
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      fetchOptions: options?.fetchOptions,
      headers: options?.headers,
    });
    return data;
  }
}
