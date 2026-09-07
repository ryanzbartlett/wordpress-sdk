/**
 * Query-parameter serialization.
 *
 * WordPress expects snake_case parameter names, repeated `key[]=` syntax for arrays,
 * and a handful of underscore-prefixed globals (`_fields`, `_embed`). This module is the
 * one place that knows those rules, so the rest of the SDK can speak idiomatic camelCase.
 */

import { WPConfigError } from "./errors";

/** A value that can appear in a query string. */
export type QueryValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | readonly (string | number)[];

export type QueryInput = Record<string, QueryValue>;

/** WordPress caps `per_page` at 100 on every core collection route. */
export const MAX_PER_PAGE = 100;

/**
 * camelCase -> snake_case for every parameter core WordPress defines.
 *
 * This is an explicit map rather than a generic transform on purpose: a naive
 * `camelToSnake` would mangle the underscore-prefixed globals and would silently
 * invent parameter names WordPress does not accept.
 */
const PARAM_NAMES: Readonly<Record<string, string>> = {
  perPage: "per_page",
  authorExclude: "author_exclude",
  parentExclude: "parent_exclude",
  categoriesExclude: "categories_exclude",
  tagsExclude: "tags_exclude",
  modifiedAfter: "modified_after",
  modifiedBefore: "modified_before",
  searchColumns: "search_columns",
  searchSemantics: "search_semantics",
  taxRelation: "tax_relation",
  menuOrder: "menu_order",
  hideEmpty: "hide_empty",
  mediaType: "media_type",
  mimeType: "mime_type",
  authorEmail: "author_email",
  hasPublishedPosts: "has_published_posts",
  excludeAssigned: "exclude_assigned",
  ignoreSticky: "ignore_sticky",
};

/** Parameters the caller may pass through untouched because they are already correct. */
function resolveName(key: string): string {
  if (key.startsWith("_")) return key;
  return PARAM_NAMES[key] ?? key;
}

function serializeScalar(value: string | number | boolean | Date): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Turn `{ fields, embed, ...rest }` into `URLSearchParams`.
 *
 * Keys are emitted in sorted order so that two equivalent queries produce byte-identical
 * URLs — which matters when an upstream HTTP cache or a framework's fetch cache keys on
 * the URL string.
 */
export function serializeParams(params: QueryInput | undefined): URLSearchParams {
  const search = new URLSearchParams();
  if (!params) return search;

  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [resolveName(key), value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      // `_fields` and `_embed` are comma-separated lists, not repeated params.
      if (key === "_fields" || key === "_embed") {
        if (value.length > 0) search.set(key, value.join(","));
        continue;
      }
      for (const item of value) search.append(`${key}[]`, String(item));
      continue;
    }
    search.append(key, serializeScalar(value as string | number | boolean | Date));
  }

  return search;
}

/** Options every read request accepts, before route-specific parameters. */
export interface GlobalParams {
  /**
   * Restrict the response to these top-level fields (`_fields`). Narrows the return type
   * as well as the payload.
   */
  fields?: readonly string[];
  /**
   * Include linked resources under `_embedded` (`_embed`). `true` embeds everything;
   * an array embeds only the named relations, e.g. `["author", "wp:featuredmedia"]`.
   */
  embed?: boolean | readonly string[];
}

/**
 * Translate the SDK's ergonomic option names into WordPress's wire names.
 * Returns a plain object so callers can still inspect or extend it before serializing.
 */
export function normalizeParams(params: Record<string, unknown> = {}): QueryInput {
  const output: QueryInput = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (key === "fields") {
      const fields = value as readonly string[];
      if (fields.length > 0) output._fields = fields;
      continue;
    }

    if (key === "embed") {
      if (value === true) output._embed = "1";
      else if (Array.isArray(value) && value.length > 0) output._embed = value as string[];
      continue;
    }

    if (key === "perPage") {
      const perPage = value as number;
      if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
        throw new WPConfigError(
          `perPage must be an integer between 1 and ${MAX_PER_PAGE} (received ${String(perPage)}). ` +
            "WordPress rejects larger pages; use .all() or paginate() to walk a whole collection.",
        );
      }
    }

    output[key] = value as QueryValue;
  }

  return output;
}

/** Build a full request URL from a base, a route path, and parameters. */
export function buildUrl(baseUrl: string, path: string, params?: QueryInput): URL {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(`${baseUrl}/${cleanPath}`);
  const search = serializeParams(params);
  for (const [key, value] of search) url.searchParams.append(key, value);
  return url;
}
