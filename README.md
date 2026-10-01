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
- **The factory is how you fight.** A **TURRET** is fed by rail, and whatever
  you feed it is what it fires:

  | Part | Round | What it does |
  | --- | --- | --- |
  | GEAR | SLUG | four quick iron rounds, one target each |
  | CELL | FROST | a cold burst that slows a crowd |
  | CHIP | ARC | bites one enemy, then jumps to three more |
  | PUMP (gear + cell) | HAMMER | a lobbed shell that flattens a crowd |
  | LAMP (cell + chip) | BEAM | a lance through everything in line |
  | SERVO (pump + lamp) | THE BIG ONE | every line on the floor, in one shell |

- **Wall your factory in.** A **WALL** costs 1 GEAR. You lay it like a rail:
  pinch and drag out a run, and it is as long as your bank can pay for.
- **Hold the CORE.** The core stands in the middle of your floor and banks
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
- **Ten waves,** each teaching one thing: walls, frost, sappers, arcs, hammers,
  beams, brutes, swarms. After that comes OVERTIME, which never ends.

## Bare hands

The game reads controllers or tracked hands through one layer
(`src/input/intents.ts`), so nothing downstream knows which you are using.

| Gesture | What it does |
| --- | --- |
| **PINCH** | Aim with your hand and pinch to place a machine, press the card, or inspect a box. Keep pinching and drag to haul a rail or a wall. |
| **TWO FISTS** | Close both hands on a tube collar, haul it out of the feed, and walk it to a maker. It seats itself. |
| **FIST** | Lift a part off a rail, then open your hand over a turret, a rail or the core to drop it in. |
| **THE CUFF** | Turn your left wrist toward your face and a cuff rises on the inside of it. It is a watch (wave and time to the horn), and its studs are the buttons you don't have: **MENU / BACK**, **TURN** and **DOWN** (put the tool away), plus **DONE** while marking the floor. Poke a stud with your right index finger. |

With controllers, the same verbs are on trigger, grip, Ⓐ, Ⓑ and Ⓧ/Ⓨ.

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
node tools/siege-walk.mjs   # the fight end to end: gun chain, wave 1, walls, the chew, the fall
node tools/hand-walk.mjs    # bare hands: pinch, the fist detector, the cuff and its pokes, a two-fist haul
node tools/floor-walk.mjs   # the hazard-tape floor
node tools/lines-look.mjs   # tube clearance over plant
node tools/craft-look.mjs   # every part's making, frame by frame
```

## Map of the new parts

```
src/factory/frame.ts      THE PLANT FRAME: the whole factory at 0.7 scale, one group
src/factory/siege.ts      the fight's sim: waves, breaches, flow field, crawlers, guns, shots
src/systems/SiegeSystem.ts  the fight drawn and voiced: instanced crawlers, tracers,
                          shells, arcs, beams, cracks in your walls, the core's plate
src/input/intents.ts      what the hands MEAN this frame (point, grab, menu, turn, stow)
src/systems/HandSystem.ts reads controllers or hands into intents; owns the wrist cuff
src/config.ts             THE SIEGE: enemies, ammo, costs, hit points, the ten waves
```

`DESIGN.md` and `FACTORY.md` are TUBES' design notes, kept because everything
here still runs on them.
