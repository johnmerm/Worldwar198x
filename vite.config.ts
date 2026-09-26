/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Cesium ships web workers, widgets CSS and static assets (including the
// offline Natural Earth II imagery) that must be served next to the app.
const cesiumSource = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  base: './',
  plugins: [
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((dir) => ({
        src: `${cesiumSource}/${dir}`,
        dest: 'cesium',
        // Drop the node_modules/cesium/Build/Cesium prefix from output paths.
        rename: { stripBase: 4 },
      })),
    }),
  ],
  build: {
    // Cesium itself is ~4 MB; splitting it buys nothing for a single-page game.
    chunkSizeWarningLimit: 5000,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
