/**
 * Verify the built package before it can be published.
 *
 * This exists because of a real failure: with `"sideEffects": false` in package.json,
 * Bun's bundler treats the library's own modules as prunable while building the library
 * itself, and emits an entry point that re-exports names it never defined — a file that
 * type-checks, publishes, and then throws `SyntaxError: Export 'X' is not defined in
 * module` in the consumer. Hence the narrowed `"sideEffects": ["./src/**"]`, which
 * still tells a consumer's bundler that everything in `dist` is side-effect free, and
 * hence this check, which loads both bundles the way a consumer would.
 */

import { createRequire } from "node:module";
import { resolve } from "node:path";

const EXPECTED_EXPORTS = [
  "createClient",
  "WPClient",
  "HttpClient",
  "CollectionResource",
  "Page",
  "basicAuth",
  "bearerAuth",
  "WPError",
  "WPNotFoundError",
  "getFeaturedMedia",
  "serializeParams",
];

const failures: string[] = [];

function check(label: string, module: Record<string, unknown>) {
  const missing = EXPECTED_EXPORTS.filter((name) => module[name] === undefined);
  if (missing.length > 0) {
    failures.push(`${label} is missing exports: ${missing.join(", ")}`);
    return;
  }
  console.log(`  ok  ${label} (${EXPECTED_EXPORTS.length} exports present)`);
}

const esm = (await import(resolve("dist/index.js"))) as Record<string, unknown>;
check("dist/index.js (esm)", esm);

const require = createRequire(import.meta.url);
check("dist/index.cjs (cjs)", require(resolve("dist/index.cjs")) as Record<string, unknown>);

// The bundle must actually work, not merely export the right names.
const { createClient } = esm as {
  createClient: (options: { url: string }) => {
    url: (path: string, params?: Record<string, unknown>) => URL;
  };
};
const url = createClient({ url: "https://example.com" }).url("/wp/v2/posts", { perPage: 5 });
if (url.toString() !== "https://example.com/wp-json/wp/v2/posts?per_page=5") {
  failures.push(`built client produced an unexpected URL: ${url.toString()}`);
} else {
  console.log("  ok  built client builds request URLs correctly");
}

if (failures.length > 0) {
  console.error("\ndist verification failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\ndist verified.");
