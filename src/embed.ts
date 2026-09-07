/**
 * `_embedded` typing and accessors.
 *
 * With `embed: true`, WordPress inlines linked resources under `_embedded` — but in an
 * awkward shape: every relation is an array, `wp:term` and `replies` are arrays *of*
 * arrays, and any resource the current user cannot read is replaced by an error object
 * rather than omitted. These helpers absorb all of that.
 */

import type { Comment, Media, MediaSize, Term, User } from "./types/entities";

/** WordPress substitutes this for an embedded resource it could not return. */
export interface EmbedError {
  code: string;
  message: string;
  data?: { status?: number };
}

export interface Embedded {
  author?: (User<"embed"> | EmbedError)[];
  "wp:featuredmedia"?: (Media<"embed"> | EmbedError)[];
  /** One array per taxonomy attached to the post, in registration order. */
  "wp:term"?: (Term<"embed"> | EmbedError)[][];
  replies?: (Comment<"embed"> | EmbedError)[][];
  "wp:attachment"?: (Media<"embed"> | EmbedError)[];
  [relation: string]: unknown;
}

/** An entity fetched with `embed: true`. */
export type Embeddable<T> = T & { _embedded?: Embedded };

function isEmbedError(value: unknown): value is EmbedError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    !("id" in value)
  );
}

function relation(entity: unknown, name: string): unknown {
  if (typeof entity !== "object" || entity === null) return undefined;
  const embedded = (entity as { _embedded?: Record<string, unknown> })._embedded;
  return embedded?.[name];
}

function firstOf<T>(value: unknown): T | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!isEmbedError(item)) return item as T;
  }
  return null;
}

/** The post's author, or `null` if it was not embedded or is not readable. */
export function getAuthor(entity: unknown): User<"embed"> | null {
  return firstOf<User<"embed">>(relation(entity, "author"));
}

/** The post's featured image, or `null` if there is none. */
export function getFeaturedMedia(entity: unknown): Media<"embed"> | null {
  return firstOf<Media<"embed">>(relation(entity, "wp:featuredmedia"));
}

/**
 * The post's terms, flattened across taxonomies.
 * Pass a taxonomy slug (`"category"`, `"post_tag"`, …) to filter.
 */
export function getTerms(entity: unknown, taxonomy?: string): Term<"embed">[] {
  const groups = relation(entity, "wp:term");
  if (!Array.isArray(groups)) return [];

  const terms: Term<"embed">[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const term of group) {
      if (isEmbedError(term)) continue;
      const typed = term as Term<"embed">;
      if (taxonomy === undefined || typed.taxonomy === taxonomy) terms.push(typed);
    }
  }
  return terms;
}

/** The post's embedded comments. */
export function getReplies(entity: unknown): Comment<"embed">[] {
  const groups = relation(entity, "replies");
  if (!Array.isArray(groups)) return [];

  const comments: Comment<"embed">[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const comment of group) {
      if (!isEmbedError(comment)) comments.push(comment as Comment<"embed">);
    }
  }
  return comments;
}

/**
 * A named size from an attachment (`"thumbnail"`, `"medium"`, `"large"`, `"full"`, …),
 * falling back to the original file when the size was never generated.
 */
export function getMediaSize(
  media: Media<"view"> | Media<"embed"> | null | undefined,
  size: string,
): MediaSize | null {
  if (!media) return null;
  const sized = media.media_details?.sizes?.[size];
  if (sized) return sized;
  if (!media.source_url) return null;
  return {
    file: media.media_details?.file ?? "",
    width: media.media_details?.width ?? 0,
    height: media.media_details?.height ?? 0,
    mime_type: media.mime_type,
    source_url: media.source_url,
  };
}

/**
 * An `srcset` string built from every generated size of an image, for responsive
 * `<img>` markup.
 */
export function getSrcSet(media: Media<"view"> | Media<"embed"> | null | undefined): string {
  const sizes = media?.media_details?.sizes;
  if (!sizes) return "";
  const seen = new Set<number>();
  const entries: string[] = [];
  for (const size of Object.values(sizes)) {
    if (!size?.source_url || seen.has(size.width)) continue;
    seen.add(size.width);
    entries.push(`${size.source_url} ${size.width}w`);
  }
  return entries.join(", ");
}
