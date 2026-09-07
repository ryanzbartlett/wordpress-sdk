import { describe, expect, test } from "bun:test";
import {
  getAuthor,
  getFeaturedMedia,
  getMediaSize,
  getReplies,
  getSrcSet,
  getTerms,
} from "../src/embed";

const post = {
  id: 1,
  _embedded: {
    author: [{ id: 1, name: "Ada", slug: "ada" }],
    "wp:featuredmedia": [
      {
        id: 100,
        mime_type: "image/jpeg",
        source_url: "https://example.com/hero.jpg",
        media_details: {
          width: 1600,
          height: 900,
          file: "hero.jpg",
          sizes: {
            thumbnail: {
              file: "hero-150.jpg",
              width: 150,
              height: 150,
              mime_type: "image/jpeg",
              source_url: "https://example.com/hero-150.jpg",
            },
            medium: {
              file: "hero-800.jpg",
              width: 800,
              height: 450,
              mime_type: "image/jpeg",
              source_url: "https://example.com/hero-800.jpg",
            },
          },
        },
      },
    ],
    "wp:term": [
      [{ id: 3, name: "News", slug: "news", taxonomy: "category" }],
      [{ id: 9, name: "Bun", slug: "bun", taxonomy: "post_tag" }],
    ],
    replies: [[{ id: 7, author_name: "Grace" }]],
  },
};

describe("embed accessors", () => {
  test("reach through the nested arrays WordPress uses", () => {
    expect(getAuthor(post)?.name).toBe("Ada");
    expect(getFeaturedMedia(post)?.id).toBe(100);
    expect(getTerms(post)).toHaveLength(2);
    expect(getReplies(post)[0]?.id).toBe(7);
  });

  test("getTerms filters by taxonomy", () => {
    expect(getTerms(post, "category").map((term) => term.slug)).toEqual(["news"]);
    expect(getTerms(post, "post_tag").map((term) => term.slug)).toEqual(["bun"]);
    expect(getTerms(post, "product_cat")).toEqual([]);
  });

  test("return null or empty on an entity fetched without embed", () => {
    expect(getAuthor({ id: 1 })).toBeNull();
    expect(getFeaturedMedia({ id: 1 })).toBeNull();
    expect(getTerms({ id: 1 })).toEqual([]);
    expect(getReplies(undefined)).toEqual([]);
  });

  test("skip the error objects WordPress substitutes for unreadable resources", () => {
    const restricted = {
      _embedded: {
        author: [
          { code: "rest_user_invalid_id", message: "Invalid user ID.", data: { status: 404 } },
        ],
        "wp:term": [[{ code: "rest_forbidden", message: "Not allowed." }]],
      },
    };
    expect(getAuthor(restricted)).toBeNull();
    expect(getTerms(restricted)).toEqual([]);
  });
});

describe("getMediaSize", () => {
  const media = getFeaturedMedia(post);

  test("returns a named size", () => {
    expect(getMediaSize(media, "thumbnail")?.width).toBe(150);
  });

  test("falls back to the original file when the size was never generated", () => {
    const full = getMediaSize(media, "2048x2048");
    expect(full?.source_url).toBe("https://example.com/hero.jpg");
    expect(full?.width).toBe(1600);
  });

  test("returns null for missing media", () => {
    expect(getMediaSize(null, "thumbnail")).toBeNull();
  });
});

describe("getSrcSet", () => {
  test("builds a srcset from every generated size", () => {
    expect(getSrcSet(getFeaturedMedia(post))).toBe(
      "https://example.com/hero-150.jpg 150w, https://example.com/hero-800.jpg 800w",
    );
  });

  test("returns an empty string when there are no sizes", () => {
    expect(getSrcSet(null)).toBe("");
  });
});
