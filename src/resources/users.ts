/** `/wp/v2/users` */

import type { Context } from "../types/common";
import type { User } from "../types/entities";
import type { GetParams, UserListParams } from "../types/params";
import { CollectionResource, type EntityShapes } from "./collection";

export type UserShapes = EntityShapes<User<"view">, User<"embed">, User<"edit">>;

export class UsersResource extends CollectionResource<
  UserShapes,
  UserListParams<Context>,
  GetParams<Context>
> {
  /** The authenticated user. Requires credentials. */
  async me<const P extends GetParams<Context>>(params?: P) {
    return this.get("me" as unknown as number, params);
  }
}
