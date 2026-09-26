# World War 198X

A browser strategy game inspired by the 1982 anime film *Future War 198X*
(*Fyūchā Wō 198X-nen*): ICBM launches, early-warning radar, SDI satellite
interceptors and Soviet anti-satellite weapons, played on a physically
modelled Earth.

This first milestone covers **fire control, ICBM flight and MIRVs**: choose a
side, a silo field and up to one target per re-entry vehicle, let the
fire-control computer solve the trajectories, and watch the booster, the
MIRV bus and each warhead fly on a CesiumJS globe.

<!-- play-link -->**[▶ Play build 1](https://raw.githack.com/johnmerm/Worldwar198x/claude/anime-war-game-icbm-rjekr1/site/b1/index.html)**<!-- /play-link -->

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics test suite
npm run release    # bump build number, test, build into site/b<N>/
```

### Publishing

The game is served straight from this branch through githack. Every push
must carry a new build number, because githack caches aggressively:

1. `npm run release` bumps `build.json` and builds into `site/b<N>/`. It deletes the previous build folder and updates the play link above.
2. Commit everything, including `site/`, and push.

The shared Cesium library lives in `site/cesium-<version>/` and is copied only once.

No Cesium ion token is needed. The globe uses the Natural Earth II imagery
that ships with Cesium.

## How to play

1. Pick **USA · SAC** or **USSR · RVSN**.
2. Choose a weapon, a launch site and targets, from the lists or with **Pick on globe**.
   - Minuteman III carries 3 RVs and the SS-18 carries 10. Target A is the booster's primary; the bus delivers the rest.
   - Targets outside the bus **footprint** are flagged and those RVs stay on the bus.
3. Pick a trajectory profile:
   - **Minimum energy** uses the least fuel.
   - **Lofted** flies higher and slower.
   - **Depressed** flies lower and faster; radar sees it later, but it uses more energy and is less accurate.
4. **Compute firing solution**, then **Launch**. Use time warp to follow the ~30-minute flight.
   **Camera → Target area** frames the warheads coming down.

## Physics model (`src/physics`)

The physics module is independent of the renderer and fully unit-tested.

| Piece | Model |
|---|---|
| Earth shape | WGS-84 ellipsoid (a = 6378.137 km, b = 6356.752 km); geodetic ↔ ECEF conversions |
| Surface distance | Vincenty inverse on the ellipsoid |
| Gravity | Point mass + **J2** (the equatorial bulge) |
| Earth rotation | Inertial integration frame. The target moves ~470 km east (at Moscow's latitude) during the flight; the launch site's own rotation adds ~330 m/s |
| Atmosphere | Piecewise-exponential standard atmosphere, co-rotating with Earth |
| Integrator | RK4: 0.5 s boost, 2 s coast, 0.1 s re-entry |

### Guidance, as 1980s ICBMs did it

ICBMs of the era were **inertially guided during boost only**. After that
the warhead fell freely.

1. **Vertical rise** out of the silo, then an **open-loop pitch program** through the dense atmosphere (1st stage).
2. **Closed-loop "velocity-to-be-gained" steering** on the upper stages. Every guidance cycle:
   - solves **Lambert's problem** for the velocity needed to coast to the Earth-rotated aim point at the planned impact time;
   - thrusts along the difference between that velocity and the current one;
   - commands **thrust termination** when the difference reaches zero.
3. **MIRV bus.** The booster aims the post-boost vehicle at target A. Above the atmosphere, at fixed intervals, the bus:
   - solves Lambert's problem for the next RV, choosing the impact time that costs the least Δv;
   - makes that velocity change (the rocket equation draws on its propellant, and the bus gets lighter as RVs leave);
   - releases the RV.

   The bus computer sequences the releases itself, always serving the cheapest remaining target next.
4. **Ballistic flight** of each re-entry vehicle: J2 gravity plus drag until it meets the ellipsoid.

Lambert's problem assumes a perfectly spherical Earth with no atmosphere. So
the **fire-control solver** (`solveFiringSolution`) flies the full simulation,
measures every RV's miss, moves each aim point the opposite way, and repeats
until every nominal miss is under 5 m. For Wisconsin → Moscow that correction is
about 13 km, and it converges in 2 iterations (~50 ms).

A real shot then adds random inertial-guidance errors at each RV release,
calibrated to each weapon's published CEP.

### MIRV footprint

A bus has only a few hundred m/s of Δv. Spreading RVs **along** the ground
track is cheap, because a small change in speed moves the impact point a long
way downrange. Spreading them **across** it is expensive, because it means
turning the whole trajectory plane. From Wisconsin, a Minuteman III aimed at Moscow:

| Second target | Distance from Moscow | Bus Δv needed | Result (bus has ~300 m/s) |
|---|---|---|---|
| Tula | 174 km | 96 m/s | ✓ |
| Leningrad (up-track) | 634 km | 187 m/s | ✓ |
| Kiev (cross-track) | 757 km | 743 m/s | outside footprint |

### Wisconsin → Moscow (Minuteman III, minimum energy)

| | |
|---|---|
| Range | 7,858 km, launch azimuth 028° (polar route over Greenland) |
| Burnout | T+180 s, 222 km altitude, 6.57 km/s at 20° |
| Apogee | ~1,020 km |
| Flight time | ~27.8 min |
| J2/drag aim correction | ~13 km |

## Roadmap

- [x] WGS-84 Earth, ICBM boost / midcourse / re-entry, fire control, globe UI
- [ ] Early warning: DSP / Oko infrared satellites (boost detection), BMEWS and Dnestr/Daryal radars (horizon-limited tracking)
- [x] MIRV post-boost bus with Δv-limited footprint
- [ ] Penetration aids (decoys, chaff) for radars to discriminate
- [ ] SDI interceptor satellites (orbital mechanics, engagement windows)
- [ ] Soviet co-orbital ASAT ("Istrebitel Sputnikov") vs US satellites
- [ ] Two-player turn/real-time modes
