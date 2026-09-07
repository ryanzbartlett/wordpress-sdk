/** Taxonomy term routes: categories, tags, and any custom taxonomy. */

import type { Context } from "../types/common";
import type { Term } from "../types/entities";
import type { GetParams, TermListParams } from "../types/params";
import { CollectionResource, type EntityShapes } from "./collection";

export type TermShapes = EntityShapes<Term<"view">, Term<"embed">, Term<"edit">>;

/** `/wp/v2/categories`, `/wp/v2/tags`, or a custom taxonomy's `rest_base`. */
export class TermsResource extends CollectionResource<
  TermShapes,
  TermListParams<Context>,
  GetParams<Context>
> {}
