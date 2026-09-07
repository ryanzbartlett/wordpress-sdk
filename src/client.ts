/**
 * The client: one object that wires the transport to every resource.
 */

import { HttpClient, type HttpClientOptions, type RequestOptions } from "./http";
import type { QueryInput } from "./query";
import { normalizeParams } from "./query";
import { CommentsResource } from "./resources/comments";
import { CustomPostResource, MediaResource, PagesResource, PostsResource } from "./resources/posts";
import {
  RootResource,
  SearchResource,
  SettingsResource,
  StatusesResource,
  TaxonomiesResource,
  TypesResource,
} from "./resources/site";
import { TermsResource } from "./resources/terms";
import { UsersResource } from "./resources/users";
import type { CustomPost } from "./types/entities";
import type { ResourceName, WPResources } from "./types/registry";

export interface WPClientOptions extends HttpClientOptions {
  /** REST namespace for the core routes. Only change this if you know why. */
  namespace?: string;
}

/** The entity type registered for a resource name, or a permissive custom-post shape. */
export type CollectionEntity<K> = [K] extends [keyof WPResources]
  ? WPResources[K]
  : CustomPost<"view">;

export class WPClient {
  /** The underlying transport. Use it for hooks, or to build URLs by hand. */
  readonly http: HttpClient;
  private readonly namespace: string;

  readonly posts: PostsResource;
  readonly pages: PagesResource;
  readonly media: MediaResource;
  readonly categories: TermsResource;
  readonly tags: TermsResource;
  readonly users: UsersResource;
  readonly comments: CommentsResource;
  readonly taxonomies: TaxonomiesResource;
  readonly types: TypesResource;
  readonly statuses: StatusesResource;
  readonly settings: SettingsResource;
  readonly search: SearchResource;
  readonly root: RootResource;

  constructor(options: WPClientOptions) {
    this.http = new HttpClient(options);
    this.namespace = options.namespace ?? "wp/v2";

    const route = (base: string) => `/${this.namespace}/${base}`;
    this.posts = new PostsResource(this.http, route("posts"));
    this.pages = new PagesResource(this.http, route("pages"));
    this.media = new MediaResource(this.http, route("media"));
    this.categories = new TermsResource(this.http, route("categories"));
    this.tags = new TermsResource(this.http, route("tags"));
    this.users = new UsersResource(this.http, route("users"));
    this.comments = new CommentsResource(this.http, route("comments"));
    this.taxonomies = new TaxonomiesResource(this.http, route("taxonomies"));
    this.types = new TypesResource(this.http, route("types"));
    this.statuses = new StatusesResource(this.http, route("statuses"));
    this.settings = new SettingsResource(this.http, route("settings"));
    this.search = new SearchResource(this.http, route("search"));
    this.root = new RootResource(this.http);
  }

  /**
   * A term resource for any taxonomy, addressed by its `rest_base`.
   *
   * ```ts
   * await wp.terms("product_cat").list({ hideEmpty: true });
   * ```
   */
  terms(restBase: string): TermsResource {
    return new TermsResource(this.http, `/${this.namespace}/${restBase}`);
  }

  /**
   * A collection resource for any post type, addressed by its `rest_base`.
   *
   * Pass the entity explicitly, or register it once on `WPResources` (see
   * `types/registry.ts`) and let it be inferred:
   *
   * ```ts
   * await wp.collection<Product>("products").list();
   * await wp.collection("products").list();  // typed if registered
   * ```
   */
  collection<T = never, K extends ResourceName = ResourceName>(
    restBase: K,
  ): CustomPostResource<[T] extends [never] ? CollectionEntity<K> : T> {
    return new CustomPostResource(this.http, `/${this.namespace}/${restBase}`);
  }

  /**
   * The escape hatch: any route, any method, fully typed by the caller.
   *
   * Writes are not modelled by the resource classes yet, so this is how you create,
   * update or delete until they are:
   *
   * ```ts
   * const { data } = await wp.request<Post>({
   *   method: "POST",
   *   path: "/wp/v2/posts",
   *   body: { title: "Hello", status: "draft" },
   * });
   * ```
   */
  request<T = unknown>(options: RequestOptions) {
    return this.http.request<T>(options);
  }

  /** The absolute URL the SDK would request for a route — useful for debugging and caching. */
  url(path: string, params?: Record<string, unknown>): URL {
    return this.http.urlFor(path, normalizeParams(params) as QueryInput);
  }
}

/**
 * Create a WordPress REST API client.
 *
 * ```ts
 * const wp = createClient({ url: "https://example.com" });
 * const page = await wp.posts.list({ perPage: 10, embed: true });
 * ```
 */
export function createClient(options: WPClientOptions): WPClient {
  return new WPClient(options);
}
