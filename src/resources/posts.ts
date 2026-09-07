/** Post-like routes: posts, pages, media, and any custom post type. */

import type { HttpClient } from "../http";
import type { Page } from "../pagination";
import type { Context } from "../types/common";
import type { CustomPost, Media, Page as PageEntity, Post, Revision } from "../types/entities";
import type {
  GetParams,
  MediaListParams,
  PageListParams,
  PostListParams,
  RevisionListParams,
} from "../types/params";
import {
  CollectionResource,
  type EntityShapes,
  type RequestOverrides,
  type Result,
} from "./collection";

export type PostShapes = EntityShapes<Post<"view">, Post<"embed">, Post<"edit">>;
export type PageShapes = EntityShapes<PageEntity<"view">, PageEntity<"embed">, PageEntity<"edit">>;
export type MediaShapes = EntityShapes<Media<"view">, Media<"embed">, Media<"edit">>;
export type CustomPostShapes<T> = EntityShapes<T, T, T>;
export type RevisionShapes = EntityShapes<Revision<"view">, Revision<"view">, Revision<"edit">>;

/** `/wp/v2/{parent}/{id}/revisions` — requires authentication. */
export class RevisionsResource extends CollectionResource<
  RevisionShapes,
  RevisionListParams<Context>,
  GetParams<Context>
> {}

/** `/wp/v2/posts` */
export class PostsResource extends CollectionResource<
  PostShapes,
  PostListParams<Context>,
  GetParams<Context>
> {
  /** Revisions of a single post. Authenticated callers only. */
  revisions(postId: number): RevisionsResource {
    return new RevisionsResource(this.http, `${this.path}/${postId}/revisions`);
  }
}

/** `/wp/v2/pages` */
export class PagesResource extends CollectionResource<
  PageShapes,
  PageListParams<Context>,
  GetParams<Context>
> {
  revisions(pageId: number): RevisionsResource {
    return new RevisionsResource(this.http, `${this.path}/${pageId}/revisions`);
  }
}

/** `/wp/v2/media` */
export class MediaResource extends CollectionResource<
  MediaShapes,
  MediaListParams<Context>,
  GetParams<Context>
> {
  /** Attachments belonging to a given post. */
  forPost<const P extends Omit<MediaListParams<Context>, "parent"> & RequestOverrides>(
    postId: number,
    params?: P,
  ): Promise<Page<Result<MediaShapes, P>>> {
    return this.list({ ...(params as object), parent: postId } as never) as Promise<
      Page<Result<MediaShapes, P>>
    >;
  }
}

/** Any registered custom post type, addressed by its `rest_base`. */
export class CustomPostResource<T = CustomPost<"view">> extends CollectionResource<
  CustomPostShapes<T>,
  PostListParams<Context>,
  GetParams<Context>
> {}

export function createCustomPostResource<T>(
  http: HttpClient,
  restBase: string,
  namespace = "wp/v2",
): CustomPostResource<T> {
  return new CustomPostResource<T>(http, `/${namespace}/${restBase}`);
}
