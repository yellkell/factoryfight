# FACTORY FIGHT 🔧⚔️

A **passthrough-AR tower defense** for Quest, played with **your bare hands**
against the real walls of your real room. Built on the engine of
[TUBES](https://github.com/yellkell/Tubes-), at **0.7 scale** so a whole
battlefield fits on your floor.

Something lives behind your walls. Place your core, and it comes for it,
from every side at once: a *They Are Billions* horde in your living room.

- **Place the CORE.** A new siege offers exactly one thing: the core. Put it
  anywhere on your floor.
- **Build TOWERS round it,** anywhere on the floor, right up against the core
  if you like. There are no roads: the horde comes out of **every wall**, so
  a tight base round the core covers every way in. While a tower is in your
  hand, the circle it will shoot within is drawn on the floor under it (the
  mortar's blind spot left dark). Towers aim and fire on their own:

  | Tower | Coins | What it does |
  | --- | --- | --- |
  | TURRET | 50 | rapid tracer slugs at one target |
  | HAMMER | 70 | heaves up and smashes the crowd beside it: everything under the head is flattened and stunned |
  | FLAMER | 80 | a cone of fire that sets the whole crowd (and the floor) burning |
  | TESLA COIL | 100 | a bolt that chains through ten of them at once |
  | MORTAR | 120 | lobs shells into the thick of the crowd; long reach, blind up close |

- **Touch a tower to UPGRADE or SELL it.** The panel is just the tower, its
  level dots and two big buttons: UPGRADE (with its price) and SELL (with what
  you get back). Three levels, each buying damage, reach and rate of fire. An
  upgraded tower stands a little bigger, wears a neon ring per level and
  has thicker plate (×1.5, then ×2.2 hit points). Selling returns 70% of
  everything you put in.
- **Coins are tight.** Kills pay a little (a fifth of a coin a mite, 2 a
  beetle, 25 a hulk); clearing a wave pays more (40 + 15 × the wave). You
  start with 150: three turrets.
- **They get tougher every wave.** Hit points grow with the wave
  (× 1 + 0.15w + 0.11w² for wave index w): over twice as tough by wave 4,
  four and a half times by wave 6, eleven by the last. A level-1 turret
  one-shots a mite only in the first wave; after that, upgrade or lose. `tools/balance-bot.mjs` plays the whole
  ladder the blunt way (spend everything, every wave, on the free cells
  nearest the core) and finishes it at about half a core.
- **They come out of EVERY WALL.** When a wave starts they climb out of the
  foot of every real wall in the room, anywhere along it, and make for the
  core: a hundred in the first wave, thousands by the end. Nobody knows the
  way but the room: one flow field, rooted at the core, gives every spot of
  floor its way in, and the crowd spreads, bunches at a choke and pours
  round your towers like water round rocks.
- **PACKS split the FLOOR.** From wave 2, some of the tide comes as a pack
  that climbs up out of a crack in your floor, out in the room between a
  wall and the core, split where the wave finds it (never on a tower, and
  as far round the room from the other packs as it can). The crack glows as
  a pulsing hairline as the wave starts, a few seconds' warning, then gapes open
  and they climb out of it.
- **They CHEW what's in the way.** A lone tower gets walked round. Box the
  core in and they chew through the weakest tower in the ring (a mite
  nibbles, a beetle gnaws, a hulk wrecks); one chewed to nothing is scrap.
  Towers patch up whole between waves.
- **Three kinds,** all the same neon-legged body:
  - **MITE:** the tide itself. Tiny and quick.
  - **BEETLE:** a lime-green shell that takes a few hits.
  - **HULK:** a big orange bruiser in the middle of the tide.
- **Pick them up and throw them.** Close a fist (or squeeze the grip) on a
  MITE or a BEETLE and it's yours, thrashing in your hand; the towers hold
  their fire on it. Open your hand and it flies with your hand's speed. Thrown
  hard, it breaks where it lands and takes the ones it lands on with it; set
  down gently, it lives, shakes it off and comes on again. A HULK is too big.
- **Whatever reaches the core takes a bite and is gone** (1 for a mite, 5 for
  a beetle, 20 for a hulk, out of 100). The core never heals: its crystal
  cracks, dims, slows and sinks as it is hurt.
- **They come apart.** Each death bursts into neon shards that bounce across
  the floor, leaves a glowing stain, and pops. The core's plate keeps the body
  count.
- **Ten waves,** each adding a tower or a threat, up to THE LAST SHIFT (5,400
  mites, 300 beetles, 8 hulks). After that comes OVERTIME, which never ends.

## Crystal & hex

Every tower is holographic geometry: faceted prisms of dark glass, their edges
traced in neon, standing on a glowing **hex pad** flat on your floor (no legs,
nothing plugged in), with whatever does the shooting mounted on a turntable on
top of it.

- **TURRET** (red): a cut obelisk with a turntable on top, and a crystal lance
  in its yoke that turns to its target.
- **HAMMER** (white): a crystal pylon with a long arm and a great hex-prism
  head that heaves up and slams down.
- **FLAMER** (orange): a brazier of three leaning shards round a stem, and a
  cut cone of glass on the stem's turntable that pours the fire.
- **TESLA COIL** (violet): a twisted spire of stacked prisms, its point run up
  into an orb held in two crossed rings.
- **MORTAR** (teal): six standing shards round a pedestal, and on it a fat
  hexagonal tube cocked up at the sky.
- **THE CORE** (gold): a big crystal hovering over its pad, turning inside
  three orbiting halo rings.
- **THE CRACKS** (magenta), where a pack splits your floor: a jagged black
  gash with burning lips, hairline fractures running off it and a glow
  pooled round it. A pulsing hairline while it gathers, gaping and
  flickering while the pack climbs out, a dim scar once it's spent, gone
  when the wave is.

The tide and its cracks are magenta. The menus
use no drawings: at load, a small studio (`src/ui/pictures.ts`) photographs
every tower with the same builders the floor uses.

## Bare hands — your left palm is the menu

The game reads controllers or tracked hands through one layer
(`src/input/intents.ts`), so nothing downstream knows which you are using. On
hands, everything is **poked with your right index finger**.

- **Turn your left palm toward you.** One panel rises over it, facing you:
  - **The header** across the top: three readouts (the WAVE, the clock
    to the NEXT WAVE or how many ENEMIES are LEFT, and your COINS) over a
    slim bar for the core, and the buttons a hand doesn't have, each an
    icon over a word: **▶▶ START** (start the next wave now), **❚❚ PAUSE**,
    and **TURN** / **DOWN** while you're holding a tower.
  - **The towers** below it: each tile shows the tower's picture and price,
    dimmed when you can't afford it. Poke one to pick it up, aim with your
    right hand and **pinch** to put it down. Poke the same tile again to put
    it away.

  Header and tiles are one flat panel, so nothing on it can hide anything
  else.
- **Touch a tower** (either hand) to open its panel: UPGRADE, SELL and ✕, with
  its reach drawn on the floor while it's open.
- **Panels come to you.** Pause and tower panels appear within arm's reach,
  and you press them by touch.

With controllers, the same verbs are on trigger, Ⓐ, Ⓑ and Ⓧ/Ⓨ: aim at a
tower and pull the trigger to open its panel.

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
node tools/siege-walk.mjs   # end to end: wave 1 from every wall, coins, upgrade, sell, a crack in the floor, the chew, a leak, the fall
node tools/hand-walk.mjs    # bare hands: the palm panel, pokes, touching a tower to upgrade and sell
node tools/horde-look.mjs   # 3,600 alive at once (sim cost; CROWD=8000 for more), then a real 3,300-mite wave vs a ring of towers
node tools/balance-bot.mjs  # plays all ten waves the blunt way: where the difficulty really sits
node tools/weapons-look.mjs # each tower photographed firing (shots/weapons/)
node tools/throw-walk.mjs   # grab a mite, throw it into a crowd; set a beetle down; a hulk won't lift
node tools/enemy-look.mjs   # the three kinds: a line-up, each close from three angles, and a crowd
node tools/floor-walk.mjs   # the hazard-tape floor
```

## Map of the parts

```
src/factory/field.ts      THE FIELD: one Dijkstra flow field from the core over the room (towers
                          priced to chew), and the crowd grid that spreads the tide
src/factory/horde.ts      THE HORDE: every crawler as typed-array columns (cap 8,192),
                          and a spatial hash for targeting, splash and chains
src/factory/crystal.ts    CRYSTAL & HEX: the core and the five towers' models
src/factory/siege.ts      the fight's sim: waves (streams), the rim and rifts, the march,
                          the chew, leaks, coins, the five
                          towers and their levels, shells, bolts, burning
src/systems/crack.ts      a pack's crack in the floor: the gash, its burning lips, the fractures
src/systems/swarm.ts      the horde drawn: three bodies (mite, beetle, hulk), one instanced
                          draw call each, legs and jaws animated on the GPU; shards and splats
src/systems/SiegeSystem.ts  the fight drawn and voiced: the swarm, deaths, tracers,
                          lobbed shells, bolts, fire, the hammer's swing, level rings, the core's crystal
src/systems/HandSystem.ts reads controllers or hands into intents; owns the palm panel
src/config.ts             THE SIEGE: enemies, TOWERS, costs and levels, the ten waves
```

`DESIGN.md` and `FACTORY.md` are TUBES' design notes, kept because everything
here still runs on them.
