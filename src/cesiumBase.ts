// Must run before any Cesium code: tells Cesium where its workers and static
// assets were copied (see vite.config.ts).
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;
