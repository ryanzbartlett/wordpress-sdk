/**
 * Emit the package's type declarations as a single self-contained file.
 *
 * `tsc` alone emits one `.d.ts` per source file with extensionless relative imports,
 * which `moduleResolution: "nodenext"` consumers cannot resolve — `attw` reports an
 * internal resolution error for both the ESM and CJS entry points. Bundling into one
 * file removes the internal imports entirely, and lets the CJS entry point get a real
 * `.d.cts` so it stops masquerading as ESM.
 */

import { $ } from "bun";

await $`bun x dts-bundle-generator --no-banner --project tsconfig.build.json -o dist/index.d.ts src/index.ts`.quiet();

const declarations = await Bun.file("dist/index.d.ts").text();
if (!declarations.includes("declare function createClient")) {
  throw new Error("dist/index.d.ts does not declare createClient — the type build failed.");
}
if (/from ["']\.\.?\//.test(declarations)) {
  throw new Error("dist/index.d.ts still has relative imports; it is not self-contained.");
}

// The CJS entry needs its own declaration file, or TypeScript treats these ESM types as
// describing the CommonJS bundle. The content is identical; only the extension matters.
await Bun.write("dist/index.d.cts", declarations);

console.log(
  `  ok  dist/index.d.ts and dist/index.d.cts (${declarations.split("\n").length} lines)`,
);
