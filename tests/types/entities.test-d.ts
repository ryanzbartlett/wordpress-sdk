/**
 * Type-level tests. These never run — `tsc --noEmit` is the assertion.
 *
 * Every `@ts-expect-error` below must actually error: TypeScript reports an *unused*
 * `@ts-expect-error` as an error of its own, so this file fails the typecheck in both
 * directions.
 */

import { createClient } from "../../src/client";
import type { Embedded } from "../../src/embed";
import { getFeaturedMedia } from "../../src/embed";
import type { WithMeta } from "../../src/types/common";
import type { CustomPost, Media, Post } from "../../src/types/entities";

const wp = createClient({ url: "https://example.com" });

/** Compile-time equality, invariant in both directions. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare function assertType<T extends true>(): void;
declare function expectType<T>(value: T): void;

/* -- context: view (the default) ------------------------------------------- */

const viewPage = await wp.posts.list({ perPage: 10 });
const viewPost = viewPage.data[0] as Post<"view">;

expectType<string>(viewPost.title.rendered);
expectType<boolean>(viewPost.content.protected);
expectType<number[]>(viewPost.categories);

// @ts-expect-error `raw` exists only in edit context.
viewPost.title.raw;

// @ts-expect-error `_embedded` is only present when embed was requested.
viewPost._embedded;

/* -- context: edit --------------------------------------------------------- */

const editPost = await wp.posts.get(1, { context: "edit" });
expectType<string>(editPost.title.raw);
expectType<string>(editPost.title.rendered);
expectType<string>(editPost.content.raw);

/* -- context: embed -------------------------------------------------------- */

const embedPost = await wp.posts.get(1, { context: "embed" });
expectType<string>(embedPost.title.rendered);
expectType<string>(embedPost.excerpt.rendered);

// @ts-expect-error embed context omits `content` entirely.
embedPost.content;

// @ts-expect-error embed context omits `categories`.
embedPost.categories;

/* -- field selection ------------------------------------------------------- */

const narrowed = await wp.posts.get(1, { fields: ["id", "slug"] });
assertType<Equals<typeof narrowed, Pick<Post<"view">, "id" | "slug">>>();
expectType<number>(narrowed.id);
expectType<string>(narrowed.slug);

// @ts-expect-error `title` was not requested, so it is not on the result.
narrowed.title;

const narrowedList = await wp.posts.list({ fields: ["id", "title"] });
expectType<string>((narrowedList.data[0] as Pick<Post, "id" | "title">).title.rendered);

/* -- embedding ------------------------------------------------------------- */

const embedded = await wp.posts.get(1, { embed: true });
expectType<number>(embedded.id);
expectType<Embedded | undefined>(embedded._embedded);
// The accessors take the widened type without a cast.
expectType<Media<"embed"> | null>(getFeaturedMedia(embedded));

const notEmbedded = await wp.posts.get(1, { embed: false });
// @ts-expect-error embed: false must not widen the type.
notEmbedded._embedded;

/* -- field selection and embedding compose --------------------------------- */

const both = await wp.posts.get(1, { fields: ["id"], embed: true });
expectType<number>(both.id);
expectType<Embedded | undefined>(both._embedded);
// @ts-expect-error still narrowed to the requested fields.
both.slug;

/* -- users change shape by context, not just by rendered fields ------------ */

const editUser = await wp.users.get(1, { context: "edit" });
expectType<string>(editUser.email);
expectType<string[]>(editUser.roles);

const viewUser = await wp.users.get(1);
// @ts-expect-error email is never exposed in view context.
viewUser.email;

/* -- custom post types ----------------------------------------------------- */

interface Product extends CustomPost<"view"> {
  meta: { price: number; sku: string };
}

const product = await wp.collection<Product>("products").get(1);
expectType<number>(product.meta.price);

// @ts-expect-error the registered meta shape is enforced.
product.meta.nonexistent.deep;

type ProductViaHelper = WithMeta<Post<"view">, { price: number }>;
declare const helperProduct: ProductViaHelper;
expectType<number>(helperProduct.meta.price);
expectType<string>(helperProduct.title.rendered);

/* -- pagination ------------------------------------------------------------ */

expectType<number | null>(viewPage.total);
expectType<boolean>(viewPage.hasNextPage);
expectType<Awaited<ReturnType<typeof viewPage.next>>>(await viewPage.next());

for await (const post of wp.posts.all()) {
  expectType<string>(post.slug);
}

/* -- keyed routes ---------------------------------------------------------- */

const taxonomies = await wp.taxonomies.list();
expectType<string | undefined>(taxonomies.category?.rest_base);

/* -- invalid parameters are rejected at compile time ----------------------- */

// @ts-expect-error `orderby` only accepts the values WordPress supports.
await wp.posts.list({ orderby: "not_a_column" });

// @ts-expect-error `perPage` is a number.
await wp.posts.list({ perPage: "10" });

// @ts-expect-error posts have no `parent` filter; pages do.
await wp.posts.list({ parent: 4 });
await wp.pages.list({ parent: 4 });
