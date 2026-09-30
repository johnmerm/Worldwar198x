# World War 198X

A browser strategy game inspired by the 1982 anime film *Future War 198X*
(*Fyūchā Wō 198X-nen*): ICBM launches, early-warning radar, SDI satellite
interceptors and Soviet anti-satellite weapons, played on a physically
modelled Earth.

This first milestone covers **fire control, ICBM flight and MIRVs**: choose a
side, a silo field and up to one target per re-entry vehicle, let the
fire-control computer solve the trajectories, and watch the booster, the
MIRV bus and each warhead fly on a CesiumJS globe.

> **Disclaimer:** an independent, non-commercial fan project. It is not
> affiliated with, sponsored by or endorsed by the creators, studio or rights
> holders of *Future War 198X* (1982). No footage, artwork, characters,
> dialogue, music or other material from the film is used. The art, text and
> sound are original, and the film is referenced only as an inspiration.

<!-- play-link -->**[▶ Play build 7](https://raw.githack.com/johnmerm/Worldwar198x/claude/anime-war-game-icbm-rjekr1/site/b7/index.html)**<!-- /play-link -->

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

Published builds load Cesium from its official CDN (`cesium.com/downloads/cesiumjs/releases/<version>/`), matching the version in `package.json`. Each build is only the game itself, about 70 KB. Set `CESIUM_CDN=<url>` when building to use a different host.

No Cesium ion token is needed. The globe uses the Natural Earth II imagery
that ships with Cesium.

## How to play

1. Pick **USA · SAC** or **USSR · RVSN**.
2. Choose a launch site. Every early-1980s ICBM field is on the map; click one of your own to select it. The field then offers only the missiles historically based there.
3. Choose targets from the list, with **Pick on globe**, or by clicking an enemy silo field for a counterforce strike.
   - Minuteman III carries 3 RVs and the SS-18 carries 10. Target A is the booster's primary; the bus delivers the rest.
   - Targets outside the bus **footprint** are flagged and those RVs stay on the bus.
4. Pick a trajectory profile:
   - **Minimum energy** uses the least fuel.
   - **Lofted** flies higher and slower.
   - **Depressed** flies lower and faster; radar sees it later, but it uses more energy and is less accurate.
5. **Compute firing solution**, then **Launch**. Use time warp to follow the ~30-minute flight.
   **Camera → Target area** frames the warheads coming down.

## Two players (`src/net`, `src/game/intel.ts`)

1. Player 1 picks a side in the main page and clicks **Open player 2**. A popup opens for the other side.
   - The sides lock once player 2 is connected.
2. Each player plans and launches in their own window and sees their own missiles in full.
3. Only world events and sensor reports cross between the windows:
   - Of the enemy's missiles you see only what **your** satellites and radars report, as it happens:
     - IR launch detections, with an approximate launch point;
     - radar tracks with anonymous numbers (`R1-T07`), shown as UNKNOWN until drag sorts RVs from decoys;
     - track loss.
   - Weapon type, launch site, targets and MIRV events are never sent. You work out origin and destination from the tracks.
   - Detonations are world events, so both players see them.
4. **Sensor coverage** shows only your own radars and satellites.
5. Time warp is shared: either player can change it. The first detonation stops the clock for both players.

The windows talk over a `BroadcastChannel` named after the game id in the URL, so both must be in the same browser. The world clock is computed from the wall clock, so it keeps running when a window is hidden.

## Massive strike (`src/game/salvo.ts`)

- **Hand-picked:** solve a fire mission as usual, then click **Add to salvo** instead of **Launch**. Repeat for each missile.
- **By strategy:** set a number of missiles, choose a strategy and click **Assign**.
  - **Random** picks a random field and a weapon actually based there, then a random enemy target in range.
  - Further MIRV warheads go to targets within 800 km of the first one.
- **Launch salvo** ripple-fires every missile one second apart. The other player can answer in kind.

Solving and flying run in background workers (`src/game/fireControl.ts`), so a large salvo doesn't freeze the globe.

## Damage and the end of the war (`src/game/damage.ts`, `src/game/outcome.ts`)

- Every warhead paints its damage on the ground: a deep-red zone of flattened buildings and fires, inside a lighter light-damage ring. Radii scale with yield (Glasstone & Dolan).
- The **Population surviving** bars show both nations, computed the same way in both windows from every detonation:
  - deaths in ~40 major 1980s cities;
  - fallout, fire and collapse that grow with the megatons on a nation's soil. At 100 Mt, a game-scale figure, the nation is gone.
  - The hatched part of each bar won't survive the year. Smoke from burning cities brings a nuclear winter (TTAPS, 1983) that falls on **both** sides, whoever fired.
- From orbit the planet turns red: fires, dying countries, a global haze and a reddening atmosphere. **Camera → Orbit** looks down on it.
- The war ends when a nation reaches zero:
  - The game warps to 120× and waits 30 minutes of game time for the missiles already in the air.
  - If the other nation also falls in that time, the verdict is **NOBODY WINS**. Otherwise it is **YOU WIN** or **YOU LOSE**.
  - Even the winner's screen shows the winter to come.

## Presentation and ending (`src/ui`)

- **Anime look:**
  - an 80s-style title card;
  - a whole-screen CRT overlay (scanlines, vignette, a faint flicker);
  - full-width alert cards for launch, enemy early warning, radar contact, MIRV release and re-entry;
  - synthesized Web Audio sound effects, with a mute toggle in the header.

  Motion effects are off when the system asks for reduced motion.
- **The ending:** the first detonation of any flight stops the clock, flashes the screen and plays the ending. It uses the flight's own sensor data, such as which enemy satellite or radar saw it coming and how many minutes of warning that gave. Every run ends the same way: **there is no winner**. You can continue the simulation or restart.

## Silo fields and missiles (`src/game/sites.ts`, `src/physics/missiles.ts`)

| Side | Field (approx. centre) | Unit | Missiles |
|---|---|---|---|
| USA | Malmstrom AFB, MT | 341st SMW | Minuteman II, Minuteman III |
| USA | Minot AFB, ND | 91st SMW | Minuteman III |
| USA | Grand Forks AFB, ND | 321st SMW | Minuteman III |
| USA | Ellsworth AFB, SD | 44th SMW | Minuteman II |
| USA | F.E. Warren AFB, WY | 90th SMW | Minuteman III, Peacekeeper (1986) |
| USA | Whiteman AFB, MO | 351st SMW | Minuteman II |
| USA | Davis-Monthan AFB, AZ / McConnell AFB, KS / Little Rock AFB, AR | 390th / 381st / 308th SMW | Titan II |
| USA | Rural Wisconsin | scenario (fictional) | Minuteman II/III, Peacekeeper |
| USSR | Dombarovsky, Kartaly, Uzhur, Aleysk, Zhangiz-Tobe, Derzhavinsk | RVSN | R-36M (SS-18) |
| USSR | Kozelsk, Tatishchevo, Pervomaysk, Khmelnytskyi | RVSN | UR-100N (SS-19) |
| USSR | Yedrovo, Vypolzovo | RVSN | MR-UR-100 (SS-17) |
| USSR | Bershet, Drovyanaya, Svobodny | RVSN | UR-100 (SS-11) |

| Missile | RVs | Range in this model | Published CEP |
|---|---|---|---|
| Minuteman III | 3 | 11,000 km | 200 m |
| Minuteman II | 1 | 12,000 km | 370 m |
| Peacekeeper | 10 | 10,000 km | 100 m |
| Titan II | 1 (9 Mt) | 13,000 km | 1,300 m |
| SS-18 | 10 | 11,000 km | 400 m |
| SS-19 | 6 | 10,000 km | 350 m |
| SS-17 | 4 | 10,000 km | 420 m |
| SS-11 | 1 | 10,300 km | 1,100 m |

Stage masses and burn times are public approximations. Vacuum Isp and the
first-stage pitch program are calibrated so that the simulated guidance
reaches roughly the published range. A test checks that every missile at
every field can reach the opposing capital.

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

## Penetration aids and early warning (`src/sensors`)

Each RV leaves the bus with **decoys** and a **chaff** cloud:

- **Decoys** are light replicas with the same radar cross-section. In vacuum they fall exactly like the RV, so radar cannot tell them apart.
- **Chaff** is a cloud of dipoles that expands at about 5 m/s. Radar can't see the RV and decoys inside it, only a big blob of clutter.
- The **atmosphere strips them**:
  - chaff disperses at about 90 km (dynamic pressure above 50 Pa);
  - decoys tear apart at about 60 km (above 5 kPa);
  - the spent final stage breaks up at about 50 km.

The defender's sensors, evaluated over the whole flight:

| Sensor | Model |
|---|---|
| **DSP** (US), 3 geostationary IR satellites | Sees the booster plume above 12 km, looking down against the Earth. Needs two looks 10 s apart. |
| **Oko** (USSR), 9 satellites in 12-hour Molniya orbits | Apogees repeat over 24°W and 156°E. Early IR sensors could only see a plume **against the black of space**, so they detect late in boost, and some times of day are gaps. |
| **Radars**: BMEWS, PAVE PAWS and Cavalier PARCS (US); Dnepr, Daryal and Don-2N (USSR) | Line-of-sight horizon (2–3° minimum elevation), a coverage sector, and range scaling as RCS^¼: the stage (3 m²) is seen much farther than an RV (0.05 m²). |

**Discrimination.** The defender can't classify RV-sized objects in midcourse. They show as UNKNOWN until a radar tracks them below 80 km, where drag sorts heavy RVs from light decoys.

Against the Wisconsin → Moscow strike:

1. **Oko** reports the launch 45–180 s into boost, depending on the time of day.
2. **Olenegorsk** sees the chaff clouds 13 minutes in.
3. The RVs stay hidden inside the chaff until it disperses. **Moscow's Don-2N** then identifies each RV and decoy about 30–40 s before impact.

In the game, **Display → Enemy sensors** shows only what the other side holds and how it classifies each object. **Sensor coverage** draws the radar fans and the satellites.

## Roadmap

- [x] WGS-84 Earth, ICBM boost / midcourse / re-entry, fire control, globe UI
- [x] Early warning: DSP / Oko infrared satellites (boost detection), BMEWS and Dnepr/Daryal radars (horizon-limited tracking)
- [x] MIRV post-boost bus with Δv-limited footprint
- [x] Penetration aids (decoys, chaff) and radar discrimination
- [ ] SDI interceptor satellites (orbital mechanics, engagement windows)
- [ ] Soviet co-orbital ASAT ("Istrebitel Sputnikov") vs US satellites
- [ ] Two-player turn/real-time modes
