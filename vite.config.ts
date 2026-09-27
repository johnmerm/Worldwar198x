/// <reference types="vitest/config" />
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Build ID: bumped by `npm run release` before every push. It names the
// output folder (site/b<ID>/) so every published URL is new, which defeats
// githack's aggressive caching, and it is shown in the game's header.
// Side branches carry a sub-build that follows the main build: 6-1, 6-2, ...
const buildInfo: { build: number; sub?: number } = JSON.parse(readFileSync('build.json', 'utf8'));
const BUILD = buildInfo.sub === undefined ? `${buildInfo.build}` : `${buildInfo.build}-${buildInfo.sub}`;
const CESIUM_VERSION: string = JSON.parse(readFileSync('node_modules/cesium/package.json', 'utf8')).version;
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumDirs = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];
const SITE = 'site';
// Production builds load Cesium from its official CDN (the one Cesium's own
// quickstart uses). CESIUM_CDN overrides it, e.g. for local testing.
const [major, minor] = CESIUM_VERSION.split('.');
const CESIUM_CDN =
  process.env.CESIUM_CDN ?? `https://cesium.com/downloads/cesiumjs/releases/${major}.${minor}/Build/Cesium/`;

/**
 * Production layout for static hosting (githack / GitHub raw): site/b<N>/
 * holds this build's page and bundle; older b* folders are removed. The app
 * bundle treats `cesium` as the global loaded from the CDN, so each build is
 * tens of kB.
 */
function publishLayout(): Plugin {
  return {
    name: 'ww198x-publish-layout',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: `${CESIUM_CDN}Cesium.js` }, injectTo: 'head' }],
    closeBundle() {
      for (const entry of readdirSync(SITE)) {
        if (/^b\d+(-\d+)?$/.test(entry) && entry !== `b${BUILD}`) rmSync(`${SITE}/${entry}`, { recursive: true });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    __BUILD__: JSON.stringify(BUILD),
    __CESIUM_BASE_URL__: JSON.stringify(command === 'build' ? CESIUM_CDN : '/cesium/'),
  },
  plugins: [
    // Dev server only: serve Cesium's workers and assets at /cesium/.
    command === 'serve' &&
      viteStaticCopy({
        targets: cesiumDirs.map((dir) => ({
          src: `${cesiumSource}/${dir}`,
          dest: 'cesium',
          // Drop the node_modules/cesium/Build/Cesium prefix from output paths.
          rename: { stripBase: 4 },
        })),
      }),
    publishLayout(),
  ],
  build: {
    outDir: `${SITE}/b${BUILD}`,
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cesium'],
      output: { format: 'iife', globals: { cesium: 'Cesium' } },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
