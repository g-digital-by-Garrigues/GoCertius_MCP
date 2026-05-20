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
});
