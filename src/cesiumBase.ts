// Must run before any Cesium code: tells Cesium where its workers and static
// assets are served (see vite.config.ts).
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = __CESIUM_BASE_URL__;
