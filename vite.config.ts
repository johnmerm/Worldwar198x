/// <reference types="vitest/config" />
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Build number: bumped by `npm run release` before every push. It names the
// output folder (site/b<N>/) so every published URL is new, which defeats
// githack's aggressive caching, and it is shown in the game's header.
const BUILD: number = JSON.parse(readFileSync('build.json', 'utf8')).build;
const CESIUM_VERSION: string = JSON.parse(readFileSync('node_modules/cesium/package.json', 'utf8')).version;
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumDirs = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];
const SITE = 'site';
const CESIUM_SHARED = `cesium-${CESIUM_VERSION}`;

/**
 * Production layout for static hosting (githack / GitHub raw):
 *   site/cesium-<version>/  prebuilt Cesium, shared by all builds, copied once
 *   site/b<N>/              this build's page and bundle (older b* folders removed)
 * The app bundle treats `cesium` as the global loaded from the shared copy,
 * so each build is tens of kB instead of megabytes.
 */
function publishLayout(): Plugin {
  return {
    name: 'ww198x-publish-layout',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'script', attrs: { src: `../${CESIUM_SHARED}/Cesium.js` }, injectTo: 'head' },
    ],
    closeBundle() {
      const shared = `${SITE}/${CESIUM_SHARED}`;
      if (!existsSync(shared)) {
        cpSync(`${cesiumSource}/Cesium.js`, `${shared}/Cesium.js`);
        for (const dir of cesiumDirs) cpSync(`${cesiumSource}/${dir}`, `${shared}/${dir}`, { recursive: true });
      }
      for (const entry of readdirSync(SITE)) {
        const stale = (/^b\d+$/.test(entry) && entry !== `b${BUILD}`) || (entry.startsWith('cesium-') && entry !== CESIUM_SHARED);
        if (stale) rmSync(`${SITE}/${entry}`, { recursive: true });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    __BUILD__: JSON.stringify(BUILD),
    __CESIUM_BASE_URL__: JSON.stringify(command === 'build' ? `../${CESIUM_SHARED}/` : '/cesium/'),
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
