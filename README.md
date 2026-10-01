# FACTORY FIGHT 🔧⚔️

A **passthrough-AR factory tower defense** for Quest, played with **your bare
hands** against the real walls of your real room. It is forked whole from
[TUBES](https://github.com/yellkell/Tubes-): the same two-handed telescoping
tubes, makers, rails and craft theatre, built at **0.7 scale** so a base, its
guns and a wall round it all fit inside a room.

Behind your walls sleeps THE WORKS, and it turns out it was never alone in
there. Something else lives in the plaster, and it has heard the hum.

- **Build between waves.** Haul a feed's tube into a MAKER, then rail its parts
  wherever they need to go. Rails are hauled out of one another just as in
  TUBES.
- **The factory is how you fight.** Rail what your makers make into the
  **CORE**. Its bank pays for the weapons, and once a weapon stands, **its
  ammunition is free**. Every weapon aims and fires on its own:

  | Weapon | Costs | What it does |
  | --- | --- | --- |
  | TURRET | 3 GEAR | quick tracer slugs, one target at a time |
  | FLAMER | 5 GEAR | a roaring cone of fire that sets crawlers and the floor alight. **Fuelled by the amber feed:** tube it in |
  | PISTON | 4 GEAR + 2 CELL | a floor trap that drives a steel ram out, knocking back whatever reaches it and stunning it |
  | TESLA COIL | 4 GEAR + 3 CHIP | a bolt off its crown that chains through four crawlers. **Fuelled by the volt feed:** tube it in |
  | MORTAR | 6 GEAR + 2 PUMP | lobs a shell high over your walls; the landing is a shockwave that flattens a crowd (it can't hit anything too close) |

- **Every feed has two spouts.** Each pillar carries a twin boss a cell along,
  so one feed can pour into a maker and a burner at the same time. You never
  have to choose between making and fighting.

- **Wall your factory in.** A **WALL** costs 1 GEAR. You lay it like a rail:
  pinch and drag out a run, and it is as long as your bank can pay for.
- **Hold the CORE.** You place it first, anywhere on your floor, and it banks
  every part railed into it. That bank pays for guns, walls and upgrades. Lose
  the core and the siege is over.
- **They come out of YOUR walls.** During the build phase, a glowing crack
  appears at the foot of a real wall, so you know which side to defend. When
  the horn goes, the plaster opens and they climb out:
  - **SKITTER:** fast scrap ticks.
  - **GRUB:** slow and fat, and it chews through rail.
  - **SAPPER:** blows up the first thing it reaches.
  - **BRUTE:** plate and fury.
- **They path, and they chew.** Enemies follow a flow field to the core. A wall
  with a gap gets walked around. A closed ring gets chewed through at its
  thinnest point.
- **Ten waves,** each bringing one new thing: walls, the flamer, sappers and
  the piston, the tesla coil, the mortar, brutes, swarms. After that comes
  OVERTIME, which never ends.

## Neon

Every machine is near-black glass with its outline traced in neon tube,
standing on a ring of the same light, one colour per trade:

| Machine | Colour |
| --- | --- |
| CORE | gold |
| MAKER | orange (retints to its feed's line) |
| RAIL | ice blue |
| COMBINER | yellow |
| CHEST | green |
| TURRET | red |
| FLAMER | flame orange |
| PISTON | steel white |
| TESLA COIL | violet |
| MORTAR | teal |
| WALL | hazard amber |
| POST | white |

Parts glow with their line's colour. The menus use no drawings: at load, a
small studio (`src/ui/pictures.ts`) photographs every machine and part with
the same builders the floor uses. Redesign a machine and its menu picture
updates on the next load. `node tools/neon-look.mjs` shoots the line-up, the
arsenal and a contact sheet of every picture, and `node tools/weapons-look.mjs`
photographs each weapon in the act of firing.

## Bare hands — your left hand is the menu

The game reads controllers or tracked hands through one layer
(`src/input/intents.ts`), so nothing downstream knows which you are using.
On hands there are no menus to open and no lasers to aim at buttons:
everything is **poked with your right index finger**.

- **Open your left hand toward you.** Two things rise off it:
  - **The toolbelt**, floating over your palm. It holds every piece you can
    build right now, each tile showing the machine's drawing and its price,
    dimmed when the bank can't pay. Poke a tile to pick it up, then aim with
    your right hand and pinch to place it. Poke the same tile again to put it
    down.
  - **The watch**, on the inside of your wrist. It shows the wave and the time
    to the horn, and its studs are the buttons you don't have: **HORN** (call
    the wave now), **PAUSE**, plus **TURN** and **DOWN** while you're holding a
    tool (**DONE** while marking the floor).
- **Touch the core.** Walk up to it and poke it, and its panel opens: the
  bank, and the upgrades your parts can buy.
- **The core comes first.** A new siege offers exactly one tile, the CORE.
  Nothing else can be built, no clock runs, and no wall cracks until you place
  it, because the breaches are chosen relative to where it stands.
- **Pinch** with your right hand to place what you're holding. Keep pinching
  and drag to lay a rail or wall run.
- **Two fists** on a tube collar haul it out of the feed to a maker. **One
  fist** lifts a part off a rail; open your hand over a rail or the core to
  drop it in.
- **Panels come to you.** Pause, the core panel and the board all appear
  within arm's reach, a little below your eyes, and you press them by touch.
  Pause has three plates: RESUME, SOUND THE HORN and QUIT.

With controllers, the same verbs are on trigger, grip, Ⓐ, Ⓑ and Ⓧ/Ⓨ, and the
original Ⓐ card is still there.

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
```

On Quest, open the page and tap **PLAY**. Mark out your floor (SETTINGS → SET
THE FLOOR), then **MAN THE WALLS**. On desktop, the IWSDK dev plugin's emulator
stands in. Its hands can be switched on from its panel.

## Checks

```bash
npm run typecheck
npm run dev &
node tools/siege-walk.mjs   # the fight end to end: gears to the core, wave 1, walls, the chew, the arsenal, the fall
node tools/weapons-look.mjs # each weapon photographed firing (shots/weapons/)
node tools/hand-walk.mjs    # bare hands: pinch, the fist detector, the cuff and its pokes, a two-fist haul
node tools/floor-walk.mjs   # the hazard-tape floor
node tools/lines-look.mjs   # tube clearance over plant
node tools/craft-look.mjs   # every part's making, frame by frame
```

## Map of the new parts

```
src/factory/frame.ts      THE PLANT FRAME: the whole factory at 0.7 scale, one group
src/factory/siege.ts      the fight's sim: waves, breaches, flow field, crawlers, the five
                          weapons, shells, bolts, burning
src/systems/SiegeSystem.ts  the fight drawn and voiced: instanced crawlers, tracers,
                          lobbed shells, bolts, fire, the ram, cracks in your walls,
                          the core's plate
src/input/intents.ts      what the hands MEAN this frame (point, grab, menu, turn, stow)
src/systems/HandSystem.ts reads controllers or hands into intents; owns the wrist cuff
src/config.ts             THE SIEGE: enemies, WEAPONS, costs, hit points, the ten waves
```

`DESIGN.md` and `FACTORY.md` are TUBES' design notes, kept because everything
here still runs on them.
