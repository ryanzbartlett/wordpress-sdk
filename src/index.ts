/**
 * @ryandotzone/wp-sdk — a typed client for the WordPress REST API.
 *
 * ```ts
 * import { createClient } from "@ryandotzone/wp-sdk";
 *
 * const wp = createClient({ url: "https://example.com" });
 * const posts = await wp.posts.list({ perPage: 10, embed: true });
 * ```
 */

export type { AuthContext, Authenticator, AuthenticatorLike, BasicAuthOptions } from "./auth";
export {
  basicAuth,
  bearerAuth,
  encodeBase64,
  headerAuth,
  nonceAuth,
  toAuthenticator,
} from "./auth";
export type { CollectionEntity, WPClientOptions } from "./client";
export { createClient, WPClient } from "./client";
export type { Embeddable, Embedded, EmbedError } from "./embed";
export {
  getAuthor,
  getFeaturedMedia,
  getMediaSize,
  getReplies,
  getSrcSet,
  getTerms,
} from "./embed";
export type { WPErrorBody, WPErrorOptions } from "./errors";
export {
  errorFromResponse,
  parseRetryAfter,
  WPAuthError,
  WPConfigError,
  WPError,
  WPNotFoundError,
  WPRateLimitError,
  WPRequestError,
  WPServerError,
  WPValidationError,
} from "./errors";
export type {
  FetchLike,
  HttpClientOptions,
  HttpHooks,
  HttpResponse,
  RequestOptions,
  RetryOptions,
} from "./http";
export { HttpClient, normalizeBaseUrl } from "./http";
export type { PageFetcher, PageLinks } from "./pagination";
export { collect, Page, pageFromResponse, paginate, parseLinkHeader } from "./pagination";
export type { GlobalParams, QueryInput, QueryValue } from "./query";
export { buildUrl, MAX_PER_PAGE, normalizeParams, serializeParams } from "./query";
export type { EntityShapes, RequestOverrides, Result } from "./resources/collection";
export { CollectionResource } from "./resources/collection";
export { CommentsResource } from "./resources/comments";
export {
  CustomPostResource,
  createCustomPostResource,
  MediaResource,
  PagesResource,
  PostsResource,
  RevisionsResource,
} from "./resources/posts";
export {
  RootResource,
  SearchResource,
  SettingsResource,
  StatusesResource,
  TaxonomiesResource,
  TypesResource,
} from "./resources/site";
export { TermsResource } from "./resources/terms";
export { UsersResource } from "./resources/users";
export type {
  AvatarUrls,
  Context,
  OpenClosed,
  Order,
  PostFormat,
  PostStatus,
  RenderedContent,
  RenderedText,
  WithMeta,
  WPLink,
  WPLinks,
  WPMeta,
} from "./types/common";
export type {
  ApiRoot,
  Comment,
  CustomPost,
  Media,
  MediaDetails,
  MediaSize,
  Page as PageEntity,
  Post,
  PostStatusObject,
  PostType,
  Revision,
  SearchResult,
  Settings,
  Taxonomy,
  Term,
  User,
} from "./types/entities";

export type {
  CommentListParams,
  GetParams,
  ListParams,
  MediaListParams,
  PageListParams,
  PostListParams,
  PostOrderBy,
  RevisionListParams,
  SearchParams,
  TermListParams,
  TermOrderBy,
  UserListParams,
  UserOrderBy,
} from "./types/params";

export type { ResourceEntity, ResourceName, WPResources } from "./types/registry";
