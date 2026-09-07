/**
 * Shared building blocks for entity types.
 *
 * WordPress reshapes every entity depending on the `context` query parameter:
 * `edit` adds `raw` alongside `rendered`, and `embed` returns only a small subset of
 * fields. The generics here encode that so the compiler knows which fields exist.
 */

export type Context = "view" | "embed" | "edit";

/** A rendered text field such as `title`. `edit` context also returns the raw source. */
export type RenderedText<C extends Context = "view"> = C extends "edit"
  ? { rendered: string; raw: string }
  : { rendered: string };

/** A rendered rich-text field such as `content` or `excerpt`. */
export type RenderedContent<C extends Context = "view"> = C extends "edit"
  ? { rendered: string; raw: string; protected: boolean; block_version?: number }
  : { rendered: string; protected: boolean };

/** A HAL-style link entry from an entity's `_links` map. */
export interface WPLink {
  href: string;
  embeddable?: boolean;
  templated?: boolean;
  taxonomy?: string;
  type?: string;
  name?: string;
  [key: string]: unknown;
}

export type WPLinks = Record<string, WPLink[] | undefined>;

/**
 * Reduce a full entity to the subset WordPress returns in `embed` context.
 * Embedded records are always rendered in `view` shape, never `edit`.
 */
export type ForContext<Full, EmbedShape, C extends Context> = C extends "embed" ? EmbedShape : Full;

/**
 * Replace an entity's loosely-typed `meta` with your own shape.
 *
 * ```ts
 * type Product = WithMeta<Post, { price: number; sku: string }>;
 * ```
 */
export type WithMeta<T, M> = Omit<T, "meta"> & { meta: M };

/** Registered post meta. Unknown by default; narrow it with {@link WithMeta}. */
export type WPMeta = Record<string, unknown>;

/** Core post statuses, open to the custom ones plugins register. */
export type PostStatus =
  | "publish"
  | "future"
  | "draft"
  | "pending"
  | "private"
  | "trash"
  | "auto-draft"
  | "inherit"
  | (string & {});

export type OpenClosed = "open" | "closed";

export type PostFormat =
  | "standard"
  | "aside"
  | "chat"
  | "gallery"
  | "link"
  | "image"
  | "quote"
  | "status"
  | "video"
  | "audio";

export type Order = "asc" | "desc";

/** Avatar URLs keyed by pixel size (`"24" | "48" | "96"`). */
export type AvatarUrls = Record<string, string>;
