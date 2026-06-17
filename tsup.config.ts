import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node20",
  outDir: "dist",
  noExternal: [/.*/], // Bundle all deps for standalone distribution
  // The bin is launched via npx, so the bundle must start with a shebang or the OS
  // runs it as a shell script and Node never executes it (issue #44). pino also uses
  // CJS dynamic require — shim it for ESM bundles. The shebang MUST be the first line.
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});
