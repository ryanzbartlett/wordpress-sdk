/**
 * Request parameters for each read route, in camelCase.
 *
 * `query.ts` maps these onto WordPress's snake_case wire names; nothing here needs to
 * match the API spelling.
 */

import type { GlobalParams } from "../query";
import type { Context, Order, PostFormat, PostStatus } from "./common";

/** Parameters accepted when fetching a single entity. */
export interface GetParams<C extends Context = "view"> extends GlobalParams {
  context?: C;
  /** Password for a password-protected post, so `content.rendered` is returned. */
  password?: string;
}

/** Parameters shared by every collection route. */
export interface ListParams<C extends Context = "view"> extends GlobalParams {
  context?: C;
  /** 1-based page number. */
  page?: number;
  /** Items per page, 1–100. */
  perPage?: number;
  search?: string;
  exclude?: readonly number[];
  include?: readonly number[];
  offset?: number;
  order?: Order;
  orderby?: string;
  slug?: string | readonly string[];
}

export type PostOrderBy =
  | "author"
  | "date"
  | "id"
  | "include"
  | "modified"
  | "parent"
  | "relevance"
  | "slug"
  | "include_slugs"
  | "title";

export interface PostListParams<C extends Context = "view"> extends ListParams<C> {
  orderby?: PostOrderBy;
  /** Posts published after this date. */
  after?: Date | string;
  before?: Date | string;
  modifiedAfter?: Date | string;
  modifiedBefore?: Date | string;
  author?: number | readonly number[];
  authorExclude?: readonly number[];
  categories?: number | readonly number[];
  categoriesExclude?: readonly number[];
  tags?: number | readonly number[];
  tagsExclude?: readonly number[];
  sticky?: boolean;
  ignoreSticky?: boolean;
  status?: PostStatus | readonly PostStatus[];
  format?: PostFormat | readonly PostFormat[];
  /** Limit a `search` to given columns, e.g. `["post_title"]` (WordPress 6.2+). */
  searchColumns?: readonly string[];
  taxRelation?: "AND" | "OR";
}

export interface PageListParams<C extends Context = "view">
  extends Omit<
    PostListParams<C>,
    "categories" | "categoriesExclude" | "tags" | "tagsExclude" | "sticky" | "format" | "orderby"
  > {
  orderby?: PostOrderBy | "menu_order";
  parent?: number | readonly number[];
  parentExclude?: readonly number[];
  menuOrder?: number;
}

export interface MediaListParams<C extends Context = "view"> extends ListParams<C> {
  orderby?: PostOrderBy;
  after?: Date | string;
  before?: Date | string;
  author?: number | readonly number[];
  authorExclude?: readonly number[];
  parent?: number | readonly number[];
  parentExclude?: readonly number[];
  mediaType?: "image" | "video" | "text" | "application" | "audio";
  mimeType?: string;
  status?: PostStatus | readonly PostStatus[];
}

export type TermOrderBy =
  | "id"
  | "include"
  | "name"
  | "slug"
  | "include_slugs"
  | "term_group"
  | "description"
  | "count";

export interface TermListParams<C extends Context = "view"> extends ListParams<C> {
  orderby?: TermOrderBy;
  /** Hide terms with no assigned posts. Defaults to `false` in the REST API. */
  hideEmpty?: boolean;
  parent?: number;
  /** Only terms assigned to this post. */
  post?: number;
}

export type UserOrderBy =
  | "id"
  | "include"
  | "name"
  | "registered_date"
  | "slug"
  | "include_slugs"
  | "email"
  | "url";

export interface UserListParams<C extends Context = "view"> extends ListParams<C> {
  orderby?: UserOrderBy;
  roles?: readonly string[];
  capabilities?: readonly string[];
  /** `"authors"` limits results to users who can write posts. */
  who?: "authors";
  hasPublishedPosts?: boolean | readonly string[];
}

export interface CommentListParams<C extends Context = "view"> extends ListParams<C> {
  orderby?: "date" | "date_gmt" | "id" | "include" | "post" | "parent" | "type";
  after?: Date | string;
  before?: Date | string;
  author?: number | readonly number[];
  authorExclude?: readonly number[];
  authorEmail?: string;
  parent?: number | readonly number[];
  parentExclude?: readonly number[];
  post?: number | readonly number[];
  status?: string;
  type?: string;
  password?: string;
}

export interface SearchParams extends GlobalParams {
  page?: number;
  perPage?: number;
  search?: string;
  type?: "post" | "term" | "post-format" | (string & {});
  subtype?: string | readonly string[];
  exclude?: readonly number[];
  include?: readonly number[];
}

export interface RevisionListParams<C extends Context = "view"> extends ListParams<C> {
  orderby?: "date" | "id" | "include" | "relevance" | "slug" | "include_slugs" | "title";
}
