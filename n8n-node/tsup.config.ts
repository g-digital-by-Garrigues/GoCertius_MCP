import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // n8n node bundle: node class + credentials.
    // REST-direct architecture (Epic 12 ADR 0008): no MCP subprocess,
    // no @modelcontextprotocol/sdk bundled. n8n-workflow stays external.
    // Icon PNGs are handled by the `copyfiles` step in the build script.
    entry: {
      'nodes/Gocertius/Gocertius.node': 'nodes/Gocertius/Gocertius.node.ts',
      'credentials/GocertiusApi.credentials': 'credentials/GocertiusApi.credentials.ts',
    },
    format: ['cjs'],
    target: 'node18',
    outDir: 'dist',
    clean: true,
    bundle: true,
    splitting: false,
    dts: false,
    external: ['n8n-workflow'],
  },
  {
    // Barrel index: transpile-only (no bundling) so index.ts's re-exports
    // are left as require() calls that resolve to the CJS files built above.
    entry: { index: 'index.ts' },
    format: ['cjs'],
    target: 'node18',
    outDir: 'dist',
    bundle: false,
    dts: false,
  },
]);
