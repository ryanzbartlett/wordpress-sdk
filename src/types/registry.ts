/**
 * Project-specific resource registry.
 *
 * The SDK ships no codegen, so this interface is how a project teaches it about its own
 * custom post types. Declare the merge once, anywhere in your project:
 *
 * ```ts
 * import type { CustomPost, WithMeta } from "@ryandotzone/wp-sdk";
 *
 * declare module "@ryandotzone/wp-sdk" {
 *   interface WPResources {
 *     product: WithMeta<CustomPost, { price: number; sku: string }>;
 *   }
 * }
 * ```
 *
 * After that, `wp.collection("product")` is fully typed and the resource name is
 * autocompleted, while any other string still works and falls back to `unknown`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: this is the declaration-merging seam.
export interface WPResources {}

/** A registered resource name, with arbitrary strings still permitted. */
export type ResourceName = keyof WPResources | (string & {});

/** The entity type registered for a resource name, or `unknown` if it is not registered. */
export type ResourceEntity<K> = K extends keyof WPResources ? WPResources[K] : unknown;
