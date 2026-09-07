/**
 * Hand-written types for the core `wp/v2` entities.
 *
 * Each entity is generic over the request {@link Context}. `Post<"edit">` has `raw`
 * fields, `Post<"embed">` has only the handful of fields WordPress inlines under
 * `_embedded`, and the default `Post` is the `view` shape most callers want.
 */

import type {
  AvatarUrls,
  Context,
  ForContext,
  OpenClosed,
  PostFormat,
  PostStatus,
  RenderedContent,
  RenderedText,
  WPLinks,
  WPMeta,
} from "./common";

/* -------------------------------------------------------------------------- */
/* Posts and pages                                                            */
/* -------------------------------------------------------------------------- */

interface PostFields<C extends Context> {
  id: number;
  date: string | null;
  date_gmt: string | null;
  guid: RenderedText<C>;
  modified: string;
  modified_gmt: string;
  slug: string;
  status: PostStatus;
  type: string;
  link: string;
  title: RenderedText<C>;
  content: RenderedContent<C>;
  excerpt: RenderedContent<C>;
  author: number;
  featured_media: number;
  comment_status: OpenClosed;
  ping_status: OpenClosed;
  sticky: boolean;
  template: string;
  format: PostFormat;
  meta: WPMeta;
  categories: number[];
  tags: number[];
  password?: string;
  _links: WPLinks;
}

interface PostEmbedFields {
  id: number;
  date: string | null;
  slug: string;
  type: string;
  link: string;
  title: RenderedText<"view">;
  excerpt: RenderedContent<"view">;
  author: number;
  featured_media: number;
  _links: WPLinks;
}

/** A post from `/wp/v2/posts`. */
export type Post<C extends Context = "view"> = ForContext<PostFields<C>, PostEmbedFields, C>;

interface PageFields<C extends Context>
  extends Omit<PostFields<C>, "categories" | "tags" | "sticky" | "format"> {
  parent: number;
  menu_order: number;
}

/** A page from `/wp/v2/pages`. */
export type Page<C extends Context = "view"> = ForContext<
  PageFields<C>,
  PostEmbedFields & { parent: number; menu_order: number },
  C
>;

/**
 * Any registered custom post type. Custom types share the post shape but may drop
 * `categories`/`tags` and add their own taxonomies, so those are optional here.
 */
export type CustomPost<C extends Context = "view"> = Omit<
  PostFields<C>,
  "categories" | "tags" | "sticky" | "format"
> & {
  categories?: number[];
  tags?: number[];
  sticky?: boolean;
  format?: PostFormat;
  parent?: number;
  menu_order?: number;
  [taxonomy: string]: unknown;
};

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

export interface MediaSize {
  file: string;
  width: number;
  height: number;
  mime_type: string;
  source_url: string;
}

export interface MediaDetails {
  width?: number;
  height?: number;
  file?: string;
  filesize?: number;
  sizes?: Record<string, MediaSize>;
  image_meta?: Record<string, unknown>;
  /** Present for audio and video attachments. */
  length?: number;
  length_formatted?: string;
  bitrate?: number;
  [key: string]: unknown;
}

interface MediaFields<C extends Context>
  extends Omit<PostFields<C>, "categories" | "tags" | "sticky" | "format" | "content" | "excerpt"> {
  alt_text: string;
  caption: RenderedContent<C>;
  description: RenderedContent<C>;
  media_type: "image" | "file";
  mime_type: string;
  media_details: MediaDetails;
  post: number | null;
  source_url: string;
  /** Present on image attachments in WordPress 6.5+. */
  missing_image_sizes?: string[];
}

interface MediaEmbedFields {
  id: number;
  date: string | null;
  slug: string;
  type: string;
  link: string;
  title: RenderedText<"view">;
  author: number;
  alt_text: string;
  caption: RenderedContent<"view">;
  media_type: "image" | "file";
  mime_type: string;
  media_details: MediaDetails;
  source_url: string;
  _links: WPLinks;
}

/** An attachment from `/wp/v2/media`. */
export type Media<C extends Context = "view"> = ForContext<MediaFields<C>, MediaEmbedFields, C>;

/* -------------------------------------------------------------------------- */
/* Taxonomy terms                                                             */
/* -------------------------------------------------------------------------- */

interface TermFields {
  id: number;
  count: number;
  description: string;
  link: string;
  name: string;
  slug: string;
  taxonomy: string;
  /** Only present on hierarchical taxonomies such as `category`. */
  parent?: number;
  meta: WPMeta;
  _links: WPLinks;
}

interface TermEmbedFields {
  id: number;
  link: string;
  name: string;
  slug: string;
  taxonomy: string;
  _links: WPLinks;
}

/** A term from `/wp/v2/categories`, `/wp/v2/tags`, or any custom taxonomy route. */
export type Term<C extends Context = "view"> = ForContext<TermFields, TermEmbedFields, C>;

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

interface UserViewFields {
  id: number;
  name: string;
  url: string;
  description: string;
  link: string;
  slug: string;
  avatar_urls: AvatarUrls;
  meta: WPMeta;
  _links: WPLinks;
}

interface UserEditFields extends UserViewFields {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  nickname: string;
  roles: string[];
  registered_date: string;
  capabilities: Record<string, boolean>;
  extra_capabilities: Record<string, boolean>;
  locale: string;
}

/** A user from `/wp/v2/users`. Email and roles appear only in `edit` context. */
export type User<C extends Context = "view"> = C extends "edit"
  ? UserEditFields
  : C extends "embed"
    ? Omit<UserViewFields, "meta">
    : UserViewFields;

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

interface CommentFields<C extends Context> {
  id: number;
  post: number;
  parent: number;
  author: number;
  author_name: string;
  author_url: string;
  date: string;
  date_gmt: string;
  content: RenderedContent<C>;
  link: string;
  status: string;
  type: string;
  author_avatar_urls: AvatarUrls;
  meta: WPMeta;
  /** `edit` context only. */
  author_email?: string;
  author_ip?: string;
  author_user_agent?: string;
  _links: WPLinks;
}

interface CommentEmbedFields {
  id: number;
  parent: number;
  author: number;
  author_name: string;
  author_url: string;
  date: string;
  content: RenderedContent<"view">;
  link: string;
  type: string;
  author_avatar_urls: AvatarUrls;
  _links: WPLinks;
}

/** A comment from `/wp/v2/comments`. */
export type Comment<C extends Context = "view"> = ForContext<
  CommentFields<C>,
  CommentEmbedFields,
  C
>;

/* -------------------------------------------------------------------------- */
/* Introspection routes                                                       */
/* -------------------------------------------------------------------------- */

/** An entry from `/wp/v2/taxonomies`. */
export interface Taxonomy {
  name: string;
  slug: string;
  description: string;
  types: string[];
  hierarchical: boolean;
  rest_base: string;
  rest_namespace: string;
  /** `edit` context only. */
  capabilities?: Record<string, string>;
  labels?: Record<string, string>;
  show_cloud?: boolean;
  visibility?: Record<string, boolean>;
  _links: WPLinks;
}

/** An entry from `/wp/v2/types`. */
export interface PostType {
  name: string;
  slug: string;
  description: string;
  hierarchical: boolean;
  has_archive: boolean | string;
  rest_base: string;
  rest_namespace: string;
  taxonomies: string[];
  icon: string | null;
  /** `edit` context only. */
  capabilities?: Record<string, string>;
  labels?: Record<string, string>;
  viewable?: boolean;
  supports?: Record<string, boolean>;
  _links: WPLinks;
}

/** An entry from `/wp/v2/statuses`. */
export interface PostStatusObject {
  name: string;
  slug: string;
  public: boolean;
  queryable: boolean;
  date_floating: boolean;
  /** `edit` context only. */
  private?: boolean;
  protected?: boolean;
  show_in_list?: boolean;
  _links: WPLinks;
}

/** A hit from `/wp/v2/search`. */
export interface SearchResult {
  id: number | string;
  title: string;
  url: string;
  type: string;
  subtype: string;
  _links: WPLinks;
}

/** The site settings object from `/wp/v2/settings`. Requires authentication. */
export interface Settings {
  title: string;
  description: string;
  url: string;
  email: string;
  timezone: string;
  date_format: string;
  time_format: string;
  start_of_week: number;
  language: string;
  use_smilies: boolean;
  default_category: number;
  default_post_format: string;
  posts_per_page: number;
  show_on_front: string;
  page_on_front: number;
  page_for_posts: number;
  default_ping_status: OpenClosed;
  default_comment_status: OpenClosed;
  site_logo: number | null;
  site_icon: number | null;
  [key: string]: unknown;
}

/** A revision from `/wp/v2/posts/{id}/revisions`. */
export interface Revision<C extends Context = "view"> {
  id: number;
  author: number;
  date: string;
  date_gmt: string;
  guid: RenderedText<C>;
  modified: string;
  modified_gmt: string;
  parent: number;
  slug: string;
  title: RenderedText<C>;
  content: RenderedContent<C>;
  excerpt: RenderedContent<C>;
}

/** The API root document at `/wp-json`. */
export interface ApiRoot {
  name: string;
  description: string;
  url: string;
  home: string;
  gmt_offset: number | string;
  timezone_string: string;
  namespaces: string[];
  authentication: Record<string, unknown>;
  site_logo?: number;
  site_icon?: number;
  site_icon_url?: string;
  _links: WPLinks;
}
