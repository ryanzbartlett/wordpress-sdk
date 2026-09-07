/** `/wp/v2/comments` */

import type { Page } from "../pagination";
import type { Context } from "../types/common";
import type { Comment } from "../types/entities";
import type { CommentListParams, GetParams } from "../types/params";
import {
  CollectionResource,
  type EntityShapes,
  type RequestOverrides,
  type Result,
} from "./collection";

export type CommentShapes = EntityShapes<Comment<"view">, Comment<"embed">, Comment<"edit">>;

export class CommentsResource extends CollectionResource<
  CommentShapes,
  CommentListParams<Context>,
  GetParams<Context>
> {
  /** Comments on a given post, oldest first. */
  forPost<const P extends Omit<CommentListParams<Context>, "post"> & RequestOverrides>(
    postId: number,
    params?: P,
  ): Promise<Page<Result<CommentShapes, P>>> {
    return this.list({ order: "asc", ...(params as object), post: postId } as never) as Promise<
      Page<Result<CommentShapes, P>>
    >;
  }
}
