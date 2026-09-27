# World War 198X

Browser ICBM strategy game: Vite + TypeScript + CesiumJS. Physics lives in
`src/physics/`, early-warning satellites and radars in `src/sensors/` (both
renderer-independent and unit-tested); the Cesium UI is `src/main.ts`.

## Checks

- `npx tsc --noEmit` and `npx vitest run` must pass before any commit.

## Publishing: every push needs a new build number

The game is played from this branch via githack, which caches aggressively.
So **before every push**:

1. Run `npm run release`. It runs the checks, bumps `build.json`, builds into `site/b<N>/`, deletes the previous `site/b*` folder, and updates the README play link.
2. Commit everything, including `site/` and `build.json`, then push.
3. Give the user the new link: `https://raw.githack.com/johnmerm/Worldwar198x/<branch>/site/b<N>/index.html`

Never push without bumping the build number. Never edit files in `site/` by hand.

Side branches carry a sub-build after main's number: `build.json` holds
`{ "build": 6, "sub": 1 }`, the release bumps only `sub`, and the build is
served from `site/b6-1/`. Main has no `sub` field.
