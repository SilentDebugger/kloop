import { build } from "esbuild";

// Bundles server + workspace packages; node_modules stay external (present in image).
await build({
  entryPoints: ["src/index.ts", "src/cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
  banner: {
    // ESM bundle needs require for a few CJS deps resolved at runtime.
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
console.log("server built -> dist/");
