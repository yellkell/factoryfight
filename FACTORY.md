# PIECEWORK — from spatial puzzle to factory game

*Research + design + build plan for taking TUBES from a five-job pipefitting
ladder to a room-scale factory game in the shapez / Satisfactory family.
Working title: **PIECEWORK** (shop-floor word for getting paid per part made —
which is exactly the game). The name is a placeholder; the design isn't.*

**The pitch in one line:** you brought THE WORKS back online — now it opens
its supply manifolds, posts work orders, and your room stops being the
machine room and becomes the **shop floor**: set your floor like a boxing
ring, haul supply tubes out of wall-mounted feeds into maker boxes, belt the
parts together, and deliver ten of whatever the order sheet wants — each
sheet wanting something one step deeper than the last.

---

## 1 · Research: how the reference games are built

Two games define the genre's structure; a handful of VR titles have tested
it in room scale. What follows is the load-bearing skeleton of each, then
the grammar they share — the part we're actually importing. (Numbers below
come from shapez.io's open-source repo, the parsed Satisfactory 1.0 game
data, and the games' wikis — sources at the end.)

### shapez / shapez 2 (tobspr Games)

- **The goal structure is the whole game.** A central hub demands *N of
  shape X*; a live counter sits on the hub itself. Deliver them — at any
  pace, there is no failure — and the next level appears, wanting a shape
  that takes one more operation to make. The authored ladder is 26 levels,
  then freeplay generates targets forever. **This is the user-facing shape
  of our design: "create 10 of a certain item that gets increasingly more
  complex" is shapez's level loop, verbatim.**

  | Lvl | Target | Qty | Unlocks |
  | --- | --- | --- | --- |
  | 1 | plain circle | 30 | cutter (+ trash) |
  | 3 | plain rect | 70 | balancer |
  | 6 | quarter circle | 270 | painter |
  | 8 | blue halves | 480 | colour mixer |
  | 10 | cyan star | 800 | stacker |
  | 12 | two-layer shape | 1,000 | **blueprints** |
  | 14 | two-layer | **8/second** | (first *throughput* goal) |
  | 20 | the "logo" | 25,000 | wires layer |
  | 26 | 4-layer "rocket" | 50,000 | freeplay |

- **The target is its own recipe.** A shape's quadrants, colours and
  layers *visually encode* the cuts, paints and stacks that make it — you
  reverse-engineer the goal by looking at it, never by reading a menu.
  Three primary colour patches mix additively into seven colours for free
  combinatorial depth.
- **Complexity comes from operations, not new resources.** A handful of
  raws and transforms — cut (1→2), rotate (1→1), paint (2→1), mix (2→1),
  stack (2→1) — compose into thousands of targets. Buildings are **free
  and infinite**; the stacker is deliberately the slowest processor, so
  late shapes force *parallelization*, not just longer chains.
- **One new verb per level.** Cutter, then balancer, then rotator, tunnel,
  painter, mixer, merger, stacker — each level's target is impossible
  without exactly the newly granted building. The tutorial is the ladder.
- **Overdelivery banks; banked shapes are the only currency.** Every shape
  ever delivered accumulates in the hub, and upgrades (belt / extractor /
  processor / painting speed, tiers II–VIII: +50%…+200%, ~×8 total) cost
  *specific banked shapes* — e.g. belt tier II = 30 more of level 1's
  circles. Surplus production is never waste; old lines stay alive because
  their product stays spendable. Blueprints run on their own mass-produced
  shape.
- **shapez 2** keeps the identical skeleton (Vortex at map centre →
  ~10 milestones + side tasks → research points → shop) and scales the
  space: build platforms in 3D connected by notches, **three build layers
  per platform**, space belts (one = 48 lanes), trains from Milestone 2,
  infinite Operator Levels that pay for delivering *old* milestone shapes
  continuously. The lesson for us: the skeleton survives a dimension
  change untouched — encouraging, since we're about to change dimension
  harder than they did.

### Satisfactory (Coffee Stain)

- **Tiers and milestones.** Progress is Tiers 0–9, each rung opened by
  delivering a bill of parts to the HUB (Tier 2's Assembler costs
  200 cable + 200 rod + 500 screw + 300 plate). Tier *bands* are gated by
  **Space Elevator phases** — huge deliveries of deep assemblies
  (Phase 1: 50 Smart Plating; Phase 2: 500 Smart Plating + 500 Versatile
  Framework + 100 Automated Wiring; Phase 3 wants thousands). Project
  parts **cannot be handcrafted** — automation is mandatory, by law.
- **Machine complexity scales by input count.** Nearly a design law:
  Smelter (1 in, 4 MW) → Constructor (1 in, 4 MW) → **Assembler (2 in,
  15 MW)** → **Manufacturer (4 in, 55 MW)**, refineries running a
  parallel fluid ladder. A late part is late because more belts enter the
  box, and the power bill scales with it.
- **The canonical early chain** — iron ore → ingot → plates + rods →
  screws → **Reinforced Iron Plate** (Assembler: 30 plate + 60 screw →
  5/min) — is the first moment the game asks you to *plan* two parallel
  lines merging into one 2-input machine, and the moment most players
  fall in love. Phase 1's 50 Smart Plating ≈ 25 minutes of runtime from
  ~5 machines: tuned so you *leave it running and go expand*.
- **Logistics unlock as pressure arrives.** Belts in speed marks
  (Mk.1–6: 60 → 1,200 items/min), splitters/mergers and containers early;
  trucks, trains, drones only when distance demands them. Storage is
  explicitly a buffer against rate mismatch.
- **Power is the tax on scale.** Every machine draws it; eras of the game
  are power eras (biomass 30 MW → coal 75 → fuel 250 → nuclear 2,500),
  and an overloaded grid trips a fuse. Overclocking trades superlinear
  power for speed. (We don't want a literal grid in a 3×3 m room — but
  the *throttle role* needs an answer; see Feeds below.)
- **Alternate recipes as discoveries.** Crash-site hard drives each offer
  a choice of 1-of-3 alternate recipes (~109 of them) that restructure
  ratios — replay and expression with zero balance risk, since defaults
  always suffice. The MAM research trees (96 nodes) do the same for
  optional tech.

### Room-scale VR precedents

- **The Last Clockwinder** (Pontoco, 2022) is the landmark: you record
  short loops of your own hand motions into clones that chain into
  assembly lines. Its lesson, and now our pillar: **in VR the body is the
  first machine** — automation must replace something your hands were
  genuinely doing, so it lands as relief, not homework. Generous snapping
  and a pod-sized room as the optimization puzzle.
- **VRactory** (App Lab) is the closest true VR shapez — machines linked
  by belts building toward explicit rate goals. **Conveyor VR** does
  assembly under throughput pressure on scripted lines. **Fail Factory**
  (Armature) reduces factory to hand-speed minigames — evidence that
  station work gets repetitive *without* a building layer. Nobody has
  shipped the passthrough-AR version where the factory stands in your
  actual room. That's the open lane.

### The shared grammar — twelve laws we're importing

1. **Source → transform → combine → deliver.** Everything is this pipe.
2. **The goal is a count of a named item,** its progress counter mounted
   on the delivery point itself. No failure state; pace is the player's.
   (TUBES already lives by "no failure states, only unfinished jobs.")
3. **The target is its own recipe** — it visually encodes what built it.
4. **One new verb per level.** The ladder is the tutorial. TUBES' five-job
   ladder is already built this way.
5. **Complexity ramps depth first, arity second, throughput third.**
   Longer chains, then 2-input machines, then rates that force parallel
   lines. In a room, every input is a physical route — hold high-arity
   boxes until late, or forever.
6. **Building is free; throughput is earned.** Placing plant never costs.
   Upgrades cost banked product.
7. **Logistics arrive exactly when their absence hurts:** hands → belt →
   split/merge → buffer. (And trash must arrive with the first
   byproduct-maker — shapez ships it with the cutter.)
8. **Yesterday's target is tomorrow's ingredient.** Era gates consume the
   previous era's product (elevator phases, upgrade bills of old level
   shapes) — "puzzle solved once" becomes "production line kept alive."
9. **The factory persists and grows.** Orders change; the plant stays.
   Tearing down a working line is the genre's cardinal sin.
10. **Overproduction banks.** A running factory is never wasted.
11. **When complexity exceeds working memory, hand out compression** —
    blueprints (shapez L12, Satisfactory Tier 4) — and hide alternate
    recipes as discoveries in the world.
12. **The payoff is watching it run** — the first item traversing the
    finished chain, items visible the whole way, a tick per delivery.
    And in VR: the body is the first machine.

**Where we deliberately deviate:** no power grid (a room doesn't need two
throttles — **spout rate is our power**, and the second spout is our
"more power"); no trash in v1 (no recipe has a byproduct — every output
has a consumer, and the chest is the only buffer); count goals never
become pure throughput goals in the campaign (waiting is legal; parallel
lines just make the room *feel* better and the bank fill faster).

---

## 2 · What we already own

This is not a from-scratch project. Inventory of the two codebases, mapped
to the factory design:

### From TUBES (this repo) — carries over nearly whole

| Existing | File(s) | Factory role |
| --- | --- | --- |
| Wall registry (walls/floor/ceiling, mount band, fallback room) | `room/walls.ts`, `systems/WallSystem.ts` | Feeds snap to real walls; floor rect initialises from the scan |
| The two-handed tube pull (grab, ratchet, steer, park, magnet, seat) | `systems/TubeSystem.ts`, `tube/*` | **The connection verb**: hauling supply from a feed spout into a box intake |
| Typed lines with full identity (metal, light, pour, voice) | `config.ts` LINES, `tube/build.ts` | **The raw materials.** AMBER / CYAN / VIOLET feedstock = MAINS / COOLANT / VOLT, colour → item |
| The pour (arc-length flow front, one unbroken column) | `materials/flow.ts`, `systems/FlowSystem.ts` | A seated supply run pours *continuously* — a live supply line reads as exactly what it is |
| Placement grammar (hologram on ray, clamp-to-legal, stamp) | `systems/PlacementSystem.ts` | Generalised from wall mounts to floor-grid placement of boxes/belts |
| Board + Ⓐ job card, panel kit, pointer lasers | `systems/MenuSystem.ts`, `ui/*` | The board becomes the order sheet; the card becomes the **Ⓐ shift menu** |
| Jobs ladder, unlocks, best times, seeds | `config.ts` JOBS, `game/progress.ts`, `game/rng.ts` | Orders ladder, the bank, seeded layouts |
| Synth sound kit + per-line detuned hums | `audio/sfx.ts` | The factory soundscape — more lines running = richer room |
| Headless tool discipline (`__tubes` hook, job-walk, preview-shot) | `tools/*` | `factory-walk.mjs`: set floor, build a chain, assert 10 delivered — no mocks |

### From SLUGFEST (goopboxing2) — one mechanic, ported

| Existing | File(s) | Factory role |
| --- | --- | --- |
| The adjustable ring: 4 independent sides, `{left,right,near,far}`, clamps keep it a ring, saved per headset | `arena/ringLayout.ts` | **THE FLOOR** — the play boundary, same data shape, same law |
| Adjust mode: quick-menu toggle → glowing side handles → trigger-grab a side → drag along its own normal → release saves | `systems/ArenaSystem.ts` (`adjustTick`), `systems/MenuSystem.ts` | Floor setup before/between orders, one side at a time, to your real walls |
| "Layout is cosmetic by law" discipline | `arena/ringLayout.ts` header | Ours is stronger: the floor is *functional* (feeds stand on its sides) but still per-headset and re-adjustable |
| Two-seat mirror math | `game/ring.ts` | The door to co-located co-op factory, already cut |

Nothing else crosses over from SLUGFEST — the goop, the judge and the
Firebase wire stay home.

---

## 3 · The design

### The fiction

TUBES ends with THE WORKS lit. PIECEWORK begins the morning after: the
machine is awake, it remembers you, and it has *orders to fill*. The walls
grow supply manifolds; a work board posts sheets; the room hums louder the
more of your plant is running. You are no longer the fitter — you're the
shop.

### THE FLOOR — the boundary (ported from SLUGFEST's ring)

Before the first order, the board hands you the floor: a rectangle of
amber-and-black **hazard tape** strung post to post at hip height across
your real floor — SLUGFEST's ADJUST RING verb, restrung in barricade
tape (the team call: tape, not ropes — and the shop's furnace amber IS
caution livery, so the boundary wears the game's one accent for free).
Bench-height corner posts, a hairline deck mark, the build lattice faint
inside it, and in adjust mode each side grows a glowing grab ring —

- reach toward a side, **hold trigger, drag it along its own normal** to
  your real wall; release and it stays; one side at a time; clamps keep a
  minimum floor (≥ 1.8 × 1.8 m) and a maximum inside arm's-reach of the
  registry's walls.
- a headset with its boundary drawn deals the sides **onto its own
  room-scale box** (WebXR's bounded floor, folded into the game's frame
  — `room/stage.ts`): the area you set aside to walk is the floor, not
  the plaster beyond it. Without one, a room scan **initialises the sides
  at your actual walls** (inset 0.25 m); sides **snap** to a wall when
  dragged within 0.2 m of it either way; in the fallback room, a
  3.6 × 2.8 m default stands in — same law as both parent games,
  playable anywhere.
- the layout **saves per headset** (`localStorage`, the SLUGFEST pattern)
  and greets you next shift.
- once plant is standing, a side **refuses to cross it** — the clamp
  extends to occupied cells, so re-planning the floor can never orphan a
  machine outside the boundary.
- and once you're set up, **the tape comes down**: barricade tape is site
  dressing, not furniture. It stands only while the floor is being marked
  out; the boundary lives on in the lattice and the feeds standing on its
  sides, and SET THE FLOOR raises it again any time.

### THE FEEDS — tube spawners on every side

Each side of the floor gets a **FEED**: a manifold pillar standing at the
side's midpoint, facing in, wearing its line's metalwork head to toe (the
`build.ts` plate language — nobody will mistake whose feed it is from
across the room). Its **spout** is a flange-and-gland at hand height.

- **Feed colours:** far = **AMBER** (mains), left = **CYAN** (coolant),
  right = **VIOLET** (volt), near = **PEARL** — a fourth line kept in
  reserve (dormant through the campaign, the expansion hook; the DESIGN.md
  roadmap's STEAM finally gets its job). Feeds sleep until their first
  order wakes them — knock, iris, hum: the TUBES wake theatre, reused as
  the unlock ceremony.
- **The spout is where the pull lives on.** Grab the collar two-handed and
  haul a telescoping tube out of the feed — the entire existing verb,
  unchanged — and seat it into a **box's intake** instead of a wall
  socket. A seated run pours continuously: it is a supply line now, and
  the pour shader already knows how to be one.
- **THE GLAND SWIVELS.** A box's intake is a collar that ORBITS its drum:
  it turns to face wherever the tube is coming from, so a hookup is never
  refused for arriving on the wrong side, and a box can be re-fed from a
  feed clean across the room without moving an inch. (The first cut
  welded the gland to the box's back face, and playtest killed it inside
  a minute: every connection became a guessing game about which way the
  box happened to be facing — "doorways, not keyholes" broken in the one
  place the whole game hangs off. Now the door turns to face you and the
  alignment gate is satisfied *by construction*: all we ask is "bring it
  near", inside a catch radius wider than the wall sockets'.)
- **Spout rate is our power grid** (deviation note above): a spout
  supplies a fixed rate, generous for one consumer, tight for two — the
  throttle that makes upgrades and layout choices matter without ever
  drawing a wire.
- **One spout, one run.** A feed supports a single live tube. The
  **SECOND SPOUT upgrade** (bought from the bank, per feed) grows a
  second gland beside the first — servo ceremony, very visible — for a
  second simultaneous run. The second spout carries a **colour dial**:
  grab and twist (ratchet detents — the feel kit already has them) to
  tune it to any *unlocked* line, so late floors can pull two ambers for
  a hungry gear line, or bring violet to a wall it never lived on. This
  is the user-spec "second spout to give more options" made physical.

### Hands make connections, belts make throughput

The thesis that keeps TUBES' soul inside a factory game — and the
research's law 12 (the body is the first machine, per The Last
Clockwinder) made structural:

- **Tubes carry fluid, and only hands place tubes.** Every supply hookup
  is the two-handed haul — heavy, deliberate, satisfying, rare (a dozen
  times a shift, not a hundred).
- **Belts carry parts, and belts are automation.** Rails arrive with the
  very first maker, so the first part you ever stamp rides home in front
  of you. (The first cut withheld them a sheet longer and made you
  hand-carry ten gears; playtest found the hole immediately — parts
  stacked two-deep on a chute you had to know to look at, and the sheet
  simply never finished. Carrying still works, and still matters for
  loading a chest or a combiner port by hand — it is just no longer the
  only way anything moves.)

### THE SHOP FLOOR IS BENCH HEIGHT

A room-scale factory that lives on the actual floor is a crouching
simulator. So: **every unit stands on legs at bench height (~0.85 m)** —
boxes are waist-high bench machines, belts are self-supported rails at
0.8 m, chests are crates on stands, the dock is a pedestal. The whole
factory lives inside TUBES' existing mount band ("where hands actually
work", 0.7–2.05 m) and nothing ever asks your knees. Parts riding rails
at bench height also sit exactly where passthrough looks best — mid-room,
against your real furniture, not lost in carpet.

### The units (crafted from the Ⓐ card, placed on the grid)

Placement uses a **soft grid**: 0.35 m cells aligned to the floor
rectangle. Holograms snap; occupied cells refuse with a buzz; the nearest
free cell inside reach is always offered (doorways, not keyholes).

| Unit | Ports | What it does |
| --- | --- | --- |
| **MAKER box** | 1 tube gland in · 1 rail out | Solidifies feedstock into the colour's base part every few seconds — gulp, stamp, eject |
| **COMBINER box** | 2 rail in · 1 rail out | Two different parts in, one deeper part out; *the* complexity machine (the Assembler law — and per law 5, arity 2 is our ceiling for the campaign) |
| **BELT rail** | 1 in · 1 out per piece | Floating rail pieces — no legs, just two skids and a slatted TREAD that visibly runs (one shared scrolling texture; rotation carries direction); speed is upgradable |
| **SPLIT / MERGE tee** | 1→2 / 2→1 | Routing pressure valves; unlock exactly when their absence hurts (law 7) |
| **CHEST crate** | 1 in (+ hand access) | Buffers 12 parts against rate mismatch; also the bin you grab from to hand-carry |
| **THE DOCK** | 1 tube gland · 1 rail hopper · hand hopper | The delivery point — a round player-placed pedestal with an amber mouth, one per floor. Drinks fluids, swallows parts, **flashes its halo as each one lands**, banks the surplus. The COUNT itself rides the Ⓐ card — a chosen deviation from law 2: the room floats nothing |

Boxes and rails are **free to craft** (law 6: never charge for trying).
The bank buys **upgrades** only.

**THE FACING IS THE GAME'S PROBLEM, NOT YOURS.** Every piece turns
itself to connect: a rail swings to feed whatever it touches, a maker
aims its chute at a rail, a combiner turns so its two ports face the
lines that would fill them. Your aim only breaks ties. Lay rails
*backward from the dock* and the whole run self-orients with no
rotation input at all — which is the difference between laying a
conveyor and solving a puzzle about laying a conveyor.

**THE CONNECTION LAW, DRAWN BEFORE YOU COMMIT.** Rails feed rails,
docks, chests and a combiner's two ports — never a maker, which drinks
fluid off a tube and has no use for a part. While the ghost stands,
amber chevrons show exactly what it will feed and what will feed it;
aim a rail at a maker and no chevron appears. Standing plant keeps its
chevrons too, so a chain reads as a chain across the room instead of a
row of boxes.

**DELETE IS A TOOL.** It sits in the card beside the boxes and paints
its target red — a verb nobody can find is a verb that doesn't exist.
Moving it there freed Ⓑ up for the verb it should always have had:

**A SEATED LINE COMES OFF WITH A TUG.** Sheet 1 runs the amber tube
into the bank; sheet 2 wants that same line feeding a maker. The only
way to free it was to DELETE the bank, which is a nonsense — a fitter
would take the collar in both hands and pull it off. So now you do:
both hands on a seated collar, hauled clear of the gland and HELD there
while the joint creaks and the grips buzz harder the closer it comes to
letting go. Brush past a running factory and nothing happens; mean it,
and the line is in your hands, still extended, ready to walk to the next
box. And **the gland you just tore it off spurns it** for a couple of
seconds: the head is by definition right beside the box you freed it
from, so without that the magnet would undo the tug before you had taken
a step, and you would fight the same box forever.

**THE RAIL IS PULLED, NOT STAMPED.** Pressing a trigger once per cell
is bookkeeping, not a verb — and this game already owns the best verb it
has. So: stand ONE rail where the parts come from, keep hold of the
trigger, and haul. The run ratchets out toward wherever you point, one
detent per cell, pitched up the run exactly like the tube's telescoping
sections, so a long lane plays a rising scale. Let go and it is rails,
every piece already facing the next. **Flow follows the drag** — the same
way the tube's head follows your hands — so you pull *from* the maker
*to* the bank and the last rail arrives pointing into it. A press with no
drag is still one rail, so nothing was taken away.

**AND THE STICKS BEND IT.** A haul goes direct by default: one leg, one
corner, one leg. Buy ROUTING POSTS (10 GEAR — priced in the part the very
first lane makes, because a routing aid you cannot afford until the book
runs out is one nobody ever uses) and you can plant sticks: a survey peg
with striped collars and a bright cap. Any stick standing between the two
ends of a haul — within two cells of the box between them, because a
straight drag's box is a line with no width and nothing could ever be
inside it — becomes a waypoint the run visits in order. Plant the stick
where you want the bow. The rail takes its place as it passes; the stick
was scaffolding, and scaffolding comes down.

**THE HOLOGRAM WEARS THE MACHINE.** The ghost used to be one anonymous
crate for every tool, which meant the catalogue told you what you had
picked and the floor didn't — you found out what you had built by
building it. Each tool now holds its own body, from the very same builder
the standing plant uses, in glass: the maker's drum and piston, the
combiner's twin lobes, the bank's mouth, the crate's bands, a post's
stick.

**THE DOCK IS THE BANK.** One name for one thing. It was always where
deliveries land AND where the surplus accrues — two words for that was
one too many, and "bank" is the one the player already reads on the card.

**QUIT ASKS FIRST.** It used to say DOWN TOOLS and mean it immediately;
one mis-click took a whole floor of plant with it. Now it arms, the same
two-press confirm RESET PROGRESS has always had.

**Ⓑ TURNS THE PIECE, AND MEANS IT.** Auto-facing is the default, not a
cage. With a piece in hand, Ⓑ ratchets it a quarter turn and that
choice *wins over the scorer* until the piece lands — otherwise the
button appears to do nothing, because bestRot simply argues it back.
Four presses walk the compass and come home. The override is per piece:
the next one goes back to facing itself, which is right far more often
than a stale hand angle. Empty-handed, Ⓑ unbolts exactly as it always
did — one button, and what you are holding decides which verb it is.

*(An earlier cut split plant into "wall plant" — dock and combiner
bolted to the site's edge. Playtest killed it: it turned every one of
them into a hunt for a legal cell, for a tidiness nobody had asked for.
Everything stands anywhere now.)*

**Every role its own silhouette** (shipped): the MAKER is a solidifier
drum with a working piston, the COMBINER twin lobes under one pressing
clamp, the CHEST a banded crate, the DOCK the round pedestal with the
amber mouth. Machines tell you what they are from across the room — and
tell you when they're WORKING: pistons bob, clamps press, lamps pulse,
the dock's halo flashes as parts land.

### Items: colour → part, part + part → deeper part

Three colours in the campaign; every recipe is 1-in (maker) or 2-in
(combiner). Depth first, arity second, throughput third — the research
ramp, exactly. And per law 3, **a composite part visibly contains its
ingredients** — a PUMP is an iron gear-body with an alloy cell-throat; a
CORE has an engine block and an arm articulation readable at arm's length
— so a target on the sheet is reverse-engineerable by looking at it,
never by reading a recipe menu.

Every item is built as a little **assembly** (a component kit over shared
geometry, instanced — a floor of parts is a dozen draw calls): the gear
is a sixteen-tooth double plate on a lit amber axle, the cell a machined
canister with a glowing charge band, the chip a dark hex wafer with
violet traces inside — and the tier-2 kits wear both parents. Parts at
rest turn slowly on the bench; a part in your fist holds still. And every
item carries a **works docket** — one line of what the machine behind
your walls DOES with it, printed on the order sheet — so nothing you
make is ever just a token.

| Tier | Item | Recipe | Silhouette (free identity, per the lines' plate language) |
| --- | --- | --- | --- |
| 0 | AMBER · CYAN · VIOLET | feeds | the pours themselves |
| 1 | **GEAR** | maker ← amber | eight-sided cast iron (mains) |
| 1 | **CELL** | maker ← cyan | smooth alloy canister (coolant) |
| 1 | **CHIP** | maker ← violet | six-sided dark-glass wafer (volt) |
| 2 | **PUMP** | gear + cell | iron body, alloy throat |
| 2 | **LAMP** | cell + chip | canister with a lit crown |
| 2 | **SERVO** | gear + chip | iron ring on glass |
| 3 | **ENGINE** | pump + gear | the first part that needs a *split or a second spout* |
| 3 | **ARM** | servo + cell | — |
| 3 | **BEACON** | lamp + gear | — |
| 4 | **CORE** | engine + arm | the campaign's final part — everything at once |

(PEARL and its SHELL part, plus an INFUSER box — part + fluid in — are the
post-campaign expansion lane, deliberately outside v1's tree.)

### ONE SHOP, ALWAYS OPEN

There is **one entrance and one session**. You open the shop and stay in
it: goals advance in place as you fill them, the catalogue grows with
them, and when the book runs out the shop simply stays open with every
feed awake and nothing left to ask. No mode to choose, no trip back to
the board between sheets.

The first goal already hands you **dock, maker and rails** — enough to
build a whole working chain in the first minute. (The bit-by-bit
unlock was the other half of playtest's brick wall: gated to one box at
a time, the shop read as a locked room, while starting with everything
read as a pile of parts with no reason to touch any of them. Growing
*while you play* is the only version that behaves like a factory game.)

The Ⓐ card's **GOALS** page carries the book: the ladder with what's
done, what's live and what's next — and tapping a sheet opens it up for
the deeper read, the works docket it serves, and the actual steps it
asks of you.

### THE ORDERS — the level ladder (ten sheets, one new verb each)

Every order: **deliver 10 ×** the target. No timers, no failure; best
time per sheet on the board, exactly like the jobs today. The plant
**persists between orders** — sheets change, the factory grows (law 9;
DOWN TOOLS still clears the floor if you want out). And the ladder obeys
law 8 by construction: **every tier-2 target returns two or three sheets
later as an ingredient** (PUMP → ENGINE, SERVO → ARM, LAMP → BEACON), so
the line you built for order 4 is still earning in order 7.

| # | Order | Target ×10 | What wakes / what it teaches |
| --- | --- | --- | --- |
| 1 | FIRST DRAUGHT | AMBER (fluid) | The floor, the dock, the pull: run one tube feed→dock. Pure TUBES, new destination |
| 2 | PIECE WORK | GEAR | Now MAKE something: tube→maker→rail→dock, and the first part you ever stamp POPS out of the chute and rides home in front of you |
| 3 | THE LINE | CELL | CYAN wakes: a second maker, a second lane, two chains sharing one dock |
| 4 | FIRST FITTING | PUMP | The COMBINER: two lines merging into a 2-in box — our Reinforced Iron Plate moment |
| 5 | NIGHT SHIFT | LAMP | VIOLET wakes; the CHEST arrives to buffer the rate mismatch it creates |
| 6 | HOT ORDER | SERVO | SPLIT/MERGE tees; the bank starts posting upgrade bills worth chasing |
| 7 | THE PUSH | ENGINE | Needs gear in *two* chains: split the gear rail **or** buy the SECOND SPOUT — the first layout decision with two right answers |
| 8 | COLD SNAP | ARM | Parallel deep chains; chest discipline |
| 9 | FULL BOOK | BEACON **and** PUMP | Two targets on one sheet — the factory serves two masters |
| 10 | THE CORE | CORE | Everything running at once. The dock drinks the tenth core, every feed surges, and the room gets the full ceremony |

**The tuning law** (from the research: shapez's count ramp, Satisfactory's
"leave it running and go expand"): rates are set so a naive single chain
finishes a sheet in **3–5 minutes** and a well-parallelized floor in
**under one** — waiting is always legal, building is always better.
First-guess rates for `config.ts` (reasons attached there as ever):

```
FEEDS.spoutRate    0.8 units/s        one consumer generous, two tight
UNITS.maker        1 part / 4 s       (drinks 2 units)
UNITS.combiner     1 part / 6 s
UNITS.railSpeed    0.35 m/s           parts 0.3 m apart
UNITS.chestCap     12
```

### THE BANK — the one currency (and it's the parts themselves)

The research is unambiguous (law 6 + 10, straight from shapez): the
strongest factory economy is **no abstract currency at all**. So:

- The dock counts deliveries against the sheet first; **everything beyond
  the sheet banks** — a per-item tally kept in progress storage, shown on
  the Ⓐ card. A running factory is never wasted.
- **Upgrades are bills of banked parts,** exactly like milestones — which
  keeps old lines alive (law 8) and makes overproducing *specific* items
  a decision, not noise. **Shipped:** the shift card's SUPPLY page lists
  the bills; pay one and the fitting is yours for good, live immediately
  (five-sheet-book pricing below — the numbers grow with sheets 6–10):

| Upgrade | Effect | Bill |
| --- | --- | --- |
| LONG REACH ✅ | tube max length +2 m | 4 GEAR |
| BELT PACE ✅ | rail speed +25% | 8 GEAR + 6 CELL |
| QUICK BOXES ✅ | maker/combiner craft −25% | 8 CELL + 4 PUMP |
| DEEP CRATES ✅ | chest 12 → 24 | 6 CHIP + 4 LAMP |
| SECOND SPOUT (per feed) | +1 tube run, colour-dialable | phase 3 — the big physical one |

### THE CATALOGUE — the Ⓐ menu

Mid-shift there is no board — and no hardware on your arm either (the
wrist-button idea retired; one press beats one gadget). **Ⓐ raises the
shift card dead ahead, below the eye line** — the job card, promoted:
laser-clickable with either hand, and **the sheet's goal lives on it**:
the big amber `3 / 10` and its target ride the card's header, because
the room floats nothing — the dock just flashes its halo as parts land.
Three pages under that header:

- **BUILD** — dock / maker / rail / combiner / chest, and DELETE at the
  end of the row; pick one and the card drops, the hologram rides your
  ray to the grid (trigger stamps, Ⓑ turns).
- **GOALS** — the book as a ladder (`✓` filled, `▸` running, `·` still
  to come), every sheet tappable for its docket, its steps in order,
  and what it feeds two sheets later.
- **SUPPLY** — the bills above: pay one and the fitting is yours for
  good, live immediately.

**AND THE CARD IS SIZED TO THE BOOK.** Playtest found text sitting on
other text all through GOALS, and two things were wrong. The card was
500 px tall for a page that wanted more, and — worse — every y on it
was a fixed offset, so a docket that wrapped to two lines printed its
second line straight through the first step. The card is now 680 × 640
(same 1000 px/m, so every font size is unchanged — bigger card, not
smaller type, because you read this at a metre through passthrough) and
nothing on it is a hard-coded pixel: pages measure themselves against a
header / body / footer band, text advances by the lines it actually
drew, and the steps stop where the footer begins.

*(And ALL GOALS bricked the game. `'goal:back'` starts with `'goal:'`,
so the index branch caught it first, parked `NaN` in `goalOpen`, and
the next paint indexed `ORDERS[NaN]` and threw — every frame, forever.
The walk pressed that exact button and passed, because it flipped the
page back in the same evaluate and no frame ever rendered the broken
state. It now presses it alone and lets real frames go by.)*

The clock, the bank tally, BACK TO IT and DOWN TOOLS ride the card too.

Raising it pauses the hands, never the machine — a factory mid-hum keeps
humming, because the fiction doesn't know you stopped (the job-card law,
inherited verbatim).

### The payoff economy

TUBES' aesthetic engine is reused as the factory's reward channel: every
craft is a thunk + glow gulp (and a piston or clamp you can SEE working);
every delivery a tick and a flash of the dock's amber halo — the count
itself rides the Ⓐ card; every completed sheet a chord; the tenth sheet,
the full ceremony. The per-line detuned hums
scale with live plant, so *the room itself* tells you how much factory
you own. Satisfaction stays the win condition; the timer stays garnish.

---

## 4 · Architecture

The discipline stays: every tunable in `config.ts` with its reasoning,
systems that own exactly one thing, a debug hook (`__tubes.plant…`) that
makes the whole factory drivable headlessly, tools that walk the real code.

### New modules

```
src/floor/plan.ts        THE FLOOR: {left,right,near,far}, clamps (incl.
                         occupied-cell law), wall-snap, save/load
                         — a straight port of arena/ringLayout.ts
src/floor/grid.ts        the WORLD-ANCHORED 0.35 m lattice + occupancy
                         (anchored to the world, not the rectangle, so a
                         dragged side never re-deals cells under plant)
src/floor/tape.ts        the hazard-tape rig: striped bands, bench-height
                         posts, grab rings, deck line, lattice hint
src/factory/items.ts     ItemSpec registry (id, tier, line lineage,
                         silhouette recipe)
src/factory/recipes.ts   RecipeSpec: 1-in maker table (colour→part) +
                         2-in combiner table (part+part→part)
src/factory/graph.ts     the plant graph: nodes (spout, run, box, rail,
                         chest, dock) + edges; pure and seedable
src/factory/sim.ts       the tick (fixed 8 Hz, decoupled from render):
                         spouts emit, runs supply, boxes craft, rails
                         advance slot-parts, chests buffer, dock counts
                         and banks — deterministic given layout + seed
src/systems/FloorSystem.ts    floor adjust mode (ArenaSystem.adjustTick,
                              ported) + feed pillars on the sides
src/systems/BuildSystem.ts    catalogue selection → hologram → grid stamp
                              (PlacementSystem's grammar, floor variant)
src/systems/FactorySystem.ts  runs sim, owns unit visuals + instanced
                              parts + craft/deliver fx
```

### Existing modules, extended

- `config.ts` grows FLOOR, FEEDS, UNITS, ITEMS, RECIPES, ORDERS, BILLS —
  the JOBS/LINES pattern, same voice, reasons attached.
- `game/state.ts`: `site` keeps screens (`board / shift / ceremony`);
  a sibling `plant` object carries floor rect, placed units, live runs,
  the bank, order progress; `generation` discipline unchanged.
- `systems/TubeSystem.ts`: seat targets become *unit intakes* (moving
  furniture) as well as wall sockets; the run's far pose comes from the
  box, not the picker. The pull itself doesn't change.
- `systems/MenuSystem.ts`: board gains the ORDERS ladder + the bank; the
  job card becomes the Ⓐ shift menu (same panel kit, same anchor —
  dead ahead, below the eye line).
- `game/progress.ts`: orders unlocked, best times, **the bank**, bought
  upgrades — still localStorage, still no server.
- `tools/factory-walk.mjs`: the new job-walk — set floor, wake feed,
  seat a run headlessly, stamp a maker + rails, assert parts advance and
  10 land, order flips, surplus banks, a bill pays, the second spout
  runs. Exits non-zero. `preview-shot.mjs` gains the money shots (bench
  line running, dock bloom, catalogue).

### Performance stance (Quest AR budget)

Instanced meshes per part type; one shared pour material per line; unit
shells from the existing shared-geometry factory; hum LOD (nearest ~6
sources audible); caps in config (~24 units, ~64 rail pieces v1) with the
`__tubes.info()` draw-call check in the walk. The existing per-run budget
maths says three tube runs + a full bench network fits if parts are
instanced — the walk asserts it instead of hoping.

---

## 5 · Build plan

Five phases, each ending green on `npm run typecheck` + a headless walk.

- **Phase 0 — THE FLOOR.** ✅ **SHIPPED.** `floor/plan.ts` (the ring
  port: clamps, the plant law, per-headset save), `floor/grid.ts`,
  `floor/tape.ts` (the hazard-tape rig), `systems/FloorSystem.ts` (the
  adjust verb + wall snap with a ratchet click), `systems/BuildSystem.ts`
  (crate holograms stamped onto the lattice, Ⓑ unbolts), SET THE FLOOR
  on the board's SYSTEM tab. All of it walked headlessly by
  `tools/floor-walk.mjs` — defaults dealt from the walls, the cap, the
  minimum, the snap through the live drag path, occupied-cell refusal,
  the plant law, and the layout surviving a reload — with the original
  five-job ladder still walking green beside it
  (`npm run dev`, then `node tools/floor-walk.mjs`).
- **Phase 1 — SUPPLY.** ✅ **SHIPPED.** Feed pillars stand on the tape's
  sides in their lines' metalwork (PEARL dormant on the fourth); the
  two-handed pull forked onto the shop floor (`systems/FactorySystem.ts`
  — same constants, same five rules, one honest difference: no
  predetermined socket, every free GLAND is a candidate and the nearest
  one inside the snap window takes the head); continuous pours + per-run
  hums; makers drink colour and stamp parts; the dock with its gland,
  hopper and delivery halo (the count rides the Ⓐ card); grip-carry (you are the first
  conveyor); Ⓑ unbolts in two steps (run first, unit second) whenever
  the hands are empty.
- **Phase 2 — LOGISTICS.** ✅ **SHIPPED.** Rails with visible parts,
  chute push, combiner ports fed from both sides, the chest, the ORDERS
  tab + the Ⓐ shift card with the BUILD catalogue, sheets 1–5 posting
  into one persistent shift, per-sheet best times, and the bank already
  tallying every surplus delivery (its BILLS wait for phase 3).
  `tools/order-walk.mjs` fills the whole book headlessly — the draught,
  the hand-carried gears, cells riding unattended, pumps from two lines,
  the mid-shift re-plumb to lamps, the chest, the bank — with the floor
  and job walks still green beside it.
- **Phase 3 — ECONOMY.** ◐ **Half in.** The bank and its BILLS shipped
  early (the SUPPLY page, four fittings live: reach, pace, quick boxes,
  deep crates — the walk pays one and asserts the deduction). Remaining:
  the SECOND SPOUT with its grab-and-twist colour dial, and sheets 6–7
  built on it. *Check: both ENGINE solutions walk green.*
- **Phase 4 — DEPTH & POLISH.** Tiers 3–4, two-target sheets, the finale
  ceremony, perf pass, preview shots. *The full ten-sheet ladder walks.*
- **Roadmap (post-v1),** each item genre-sourced:
  - **PEARL + INFUSER lane** (part + fluid recipes) and **fluid mixing**
    — shapez's three primaries → seven colours, ours: amber+cyan etc. at
    a MIXER box, a whole second depth axis for free.
  - **The blueprint stamp** (law 11): grab-duplicate a box *with its rail
    stubs*, paid from the bank — when floors get big enough to hurt.
  - **Alternate recipes as room discoveries** (law 11): rare parts found
    behind an iris that shortcut a chain; defaults always suffice.
  - **A second rail layer** (shapez 2's answer to saturation) when the
    bench plane fills — verticality as the relief valve.
  - **Persistent plant via WebXR anchors** — the factory still standing
    in your room tomorrow (the DESIGN.md roadmap's long game).
  - **Co-located co-op** on the two-seat mirror; **tracked-hands**
    grammar for the pull.

---

## 6 · Open calls (recommendations attached)

1. **Bench height vs floor scale.** Recommend bench (0.85 m) hard: it
   keeps the whole factory in the mount band and passthrough's best zone.
   The cost: less "toy city on the carpet" fantasy. Decide before Phase 0.
2. **Plant persistence across orders.** Recommend persistent within a
   shift (law 9); DOWN TOOLS clears. Cross-*session* persistence waits
   for anchors on the roadmap.
3. **Grid cell size.** 0.35 m assumed; verify against real reach in the
   headset during Phase 0 (0.3–0.45 m is the plausible band).
4. **Banked-part bills vs an abstract scrap currency.** The draft
   originally used scrap (one number, lighter UI); the research flipped
   it — shapez proves the parts-are-the-currency economy, and it feeds
   law 8 for free. Recommend bills; flag here in case the team prefers
   scrap's simplicity for v1.
5. **The fourth side.** Spec says every side gets a spawner — PEARL
   stands dormant as the visible promise of more. Alternative: the fourth
   side hosts the dock instead. Recommend dormant PEARL + player-placed
   dock.

---

## 7 · Sources

- shapez level/upgrade/building numbers: the open-source repo —
  [`levels.js`](https://github.com/tobspr-games/shapez.io/blob/master/src/js/game/modes/levels.js),
  [`regular.js`](https://github.com/tobspr-games/shapez.io/blob/master/src/js/game/modes/regular.js),
  [`config.js`](https://github.com/tobspr-games/shapez.io/blob/master/src/js/core/config.js);
  [Levels](https://shapezio.fandom.com/wiki/Levels) and
  [Freeplay](https://shapezio.fandom.com/wiki/Freeplay) wiki pages.
- shapez 2: [Vortex](https://shapez2.wiki.gg/wiki/Vortex),
  [Milestones](https://shapez2.wiki.gg/wiki/Milestones),
  [Space Platforms](https://shapez2.wiki.gg/wiki/Space_Platforms),
  [Trains](https://shapez2.wiki.gg/wiki/Trains),
  [Operator Level](https://shapez2.wiki.gg/wiki/Operator_Level),
  [Shop](https://shapez2.wiki.gg/wiki/Shop).
- Satisfactory: parsed 1.0 game data
  ([greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools));
  [Space Elevator](https://satisfactory.wiki.gg/wiki/Space_Elevator),
  [Conveyor Belts](https://satisfactory.wiki.gg/wiki/Conveyor_Belts),
  [Milestones](https://satisfactory.wiki.gg/wiki/Milestones),
  [Power Shard](https://satisfactory.wiki.gg/wiki/Power_Shard),
  [Production line tutorial](https://satisfactory.wiki.gg/wiki/Tutorial:Production_line).
- VR precedents: The Last Clockwinder —
  [Road to VR](https://roadtovr.com/the-last-clockwinder-review-quest-2-steam/),
  [UploadVR](https://www.uploadvr.com/the-last-clockwinder-review/);
  [VRactory](https://sidequestvr.com/app/7500/vractory);
  [Conveyor VR](https://conveyorvr.com/).
- This repo: `README.md`, `DESIGN.md` (pillars, roadmap), `src/*` as
  inventoried above. goopboxing2: `arena/ringLayout.ts`,
  `systems/ArenaSystem.ts` (the ring adjust verb), `README.md`.


---

## Appendix — THE PLAYTEST PASS (what actually shipped)

The build above is the design; this is the record of what the first real
playtest changed, because every item on it was a case of the design being
right on paper and wrong in a headset.

**"All those extra options other than the first one are completely
useless in that sub menu."** The board listed five startable sheets. A
shift always begins on a bare floor, so starting sheet four dealt sheet
four's demands with none of sheets one to three's feeds, plant or parts —
unwinnable, and silently so. The tab is called **FACTORY**, it offers one
button, and THE BOOK advances inside the shift onto the same floor.

**"The first mission of build 10 draughts is stupid."** It was: a sheet
about a hole in a box. Sheet one is **FIRST GEAR** now — stand a MAKER,
run the amber feed into it, watch it stamp, and lift one off the chute
with your fist when the chute fills (which is also how the carry gets
taught). **THE BANK** is sheet two, arriving with the rail, when there is
finally something to put in it. Fluid targets left the game with the
draughts, and the bank lost its gland with them: the magnet takes the
NEAREST free gland, so a bank standing between you and a maker used to
snatch every tube you walked past it.

**"We can't disconnect the tubes from when they're connected to the
boxes. I'd delete the boxes at the moment."** A missing verb, not a
missing button. **THE BOX PANEL** — empty hand, trigger, any standing
plant — carries UNPLUG, TURN and TAKE IT OUT, and every unplug route now
goes through one sim door so the hum and the iris can never disagree.

**"We should be able to check what is in her chest by clicking on it."**
Same panel: a crate's stack, a chute's queue, a combiner's ports, a
rail's cargo, the bank's whole vault, the vat's level — each with the
part's own drawing beside the count.

**"They're too circular, they're all too similar. They're making a
factory, not a steam machine."** Every chassis was re-cut from flat
stock: boxes, four-panel folded hoppers, bolt rows, welded gussets, and
`flatShading: true` on every material — which is the single flag that
stops an eight-sided prism reading as a smooth pipe. Silhouettes now
differ in height and mass as well as plan.

**"We want the rails to actually bend when we pull them, bend around
objects."** `haulRoute` is a Dijkstra over (cell, direction) with a turn
penalty. A clear floor still lays the one-cornered L a hand would draw;
an obstructed one goes around. And a MAKER stood on an empty floor last
sheet turns its chute onto the first rail that lands beside it, because
otherwise its facing was frozen at whatever angle your hand happened to
be at when there was nothing to face.

**"Pressing X while ghost build is active should exit ghost build."**
It was a one-way door: arming a tool from the card left you holding it
until you raised the card and pressed the same tool again, or built
something you did not want. Ⓧ on the left controller now drops the
ghost, the link chevrons and any haul in progress — never destructively,
and it hands you back the empty hand that opens boxes.

**"When we select and build it should show a picture and the word."**
`ui/icons.ts`: a line-art elevation of every machine and every part, on
the catalogue, the goal ladder, the sheets and the box panel.

**"Grab the goop from RAVE RAID... a machine that activates the final
tube socket which is green... that creates the goop and it dances and a
screen pops up that says thanks for playing."** Sheets six and seven.
Three servos — a servo is a PUMP and a LAMP now, the book's one deep
fitting — crank the fourth manifold's bolted gate off the near pillar;
PEARL is green; the VAT is the only thing that drinks it; and what climbs
out of the tank dances ON TOP OF THE VAT — the club's own gel creature
(`src/goop/`, the fight left behind), the tank its podium, with THANKS
FOR PLAYING over its shoulder.


### The second playtest pass

**"Our progression system is totally broken \u2014 if we've completed goals,
turn off the headset and come back, we can't play factory because we
can't build a bank after phase 1."** Exactly true, and self-inflicted.
Killing the startable-sheet menu left one door that always opened at
sheet one, and `clearPlant` wipes the catalogue — so a headset that had
reached sheet five came back to a single MAKER, `stored.orders` written
faithfully by `recordOrderDone` and read by nobody. Standing a bank
returned literally `false`. Two halves to the fix: `postOrder`'s wakes
are **cumulative** (posting sheet N switches on everything sheets 0..N
ever granted, so arriving mid-book is survivable), and `startShop` with
no argument opens on `bookAt()` — or on the shop wide open once
`bookDone`. The one caller in the game was passing `0` and walking
straight past the resume logic.

Underneath it was a second wall: **sheet one could dead-end.** It asked
for three stamped gears, a maker's chute holds two, and the catalogue is
one machine — so a player who did not find the squeeze-to-carry was
stuck on the first sheet of the book forever. It asks for two now. A
tutorial sheet must not have a failure mode, and the backed-up chute is
the setup for sheet two rather than a lock on it.

**"Let's revert the design of the boxes and tube containers."** The
flat-stock re-cut — square chassis, folded hoppers, bolt rows, gussets,
flat shading — was unarguably more factory-like on a monitor and worse
in a headset: the facets and the bolt detail ate the silhouettes at four
metres, which is the distance the silhouette rule exists to serve.
`factory/units.ts` is reverted whole to the drums, bands and torus
mouths, keeping only the functional deltas the book needs (no gland on
the bank, the VAT, PEARL's bolted plate). The VAT had no earlier design
to return to and is built in the original idiom: a banded tank.

### The records, and the face

**"Let's have new songs and 4 leaf play in menus and gameplay
separately, and Novus starts playing when we start filling up the VAT
and as the goop dances."** `audio/music.ts` — three decks (board /
floor / vat), crossfaded, shuffled within a set, streamed rather than
decoded. 4 LEAF CLOVERS holds the board; the three NEW SONGs work the
floor; NOVUS takes the room from the first drop of green and does not
let go. Novus was transcoded from AAC to MP3 on the way in, because
Chromium's open-source builds have no AAC and the finale is the last
track in the game that can afford to be silent.

**"The purple liquid noise is way too annoying."** It was: a 110 Hz
SQUARE through a 900 Hz lowpass, amplitude-modulated at 2.2 Hz, playing
continuously for as long as a violet line was plugged in. Every one of
those choices is wrong for a drone — odd harmonics in the ear's most
sensitive band, flutter-rate modulation that reads as a fault. VOLT's
hum is now a steady body of two darkened triangles with the electric
character moved onto a very quiet bandpassed corona, which is the only
part that pulses, at half the old rate. All the hums came down a few dB
besides: they were levelled for a silent game and there is a record
playing over them now.

**"We should iterate on his eyes to look better."** See DESIGN.md — a
pale sclera for contrast, an iris that visibly swings, a dilating pupil,
two catchlights, a lateral placement that survives the body yawing, and
a gaze that wanders instead of staring.

### The third pass — the rail grammar, the liveries, and the podium

**"Let's make our rails actually curve."** A corner rail was two straight
pieces butted at right angles, and the part slid along a line the track
wasn't drawing. Every rail owns a wardrobe now (`factory/units.ts`):
the straight, two quarter-curves, and the bridge deck — `setBeltForm`
dresses it for its neighbours on every generation tick, the part rides
the true arc (`partPose` walks the same quadrant the geometry draws),
and the haul's ghosts wear the same forms, so the run you drag is the
run that lands, curves and all.

**"Let's have bridge rails so they can intersect."** The route search
(`routeLeg`) treats a cell with a rail on it as open ONE way: straight
across, over the top. A haul that crosses a standing perpendicular rail
lays a DECK arched over it — the standing rail becomes a crossing
(`Unit.over`), two lanes on one cell, each carrying its own part.
Pressing a rail directly onto a crossing rail does the same by hand.
No turning on a deck, no ending a run mid-deck, no decking a corner —
`canBridge` is the one gate all three doors go through.

**"If you place a rail moving away from another it joins on and takes
50% of the payload."** THE TAP: a rail standing beside a lane,
perpendicular and pointing away, is a branch — the lane deals
round-robin between straight-ahead and each branch (`Unit.tap` holds
whose turn is next), which with one branch is exactly half. A refused
output passes its turn rather than damming the lane. The join draws its
own chevron, the ghost previews it, and `bestRot` scores it so the
piece lands the way your hand says.

**"Rails facing away pull objects out of a container block just as
facing towards puts them in."** The door swings both ways: a rail whose
back sits against a chest or the bank, pointing away, PULLS — the chest
from the top of its stack, the bank whichever part it holds deepest
(so a drain levels the vault instead of stripping one shelf). One part
per free rail; the lane's own pace is the drain's pace.

**"Make it so we can place blocks back on the rails after we've picked
them up."** `dropCarried` learned the rail: a part dropped over a free
one lands at the exact spot on the lane your fist was over and rides
on. Drop targeting is nearest-eligible now rather than first-found,
because dropReach overlaps neighbouring cells and a rail used to be
able to shadow the chest you were actually aiming at.

**"Iterate on the colours and design of our boxes to give them some
character and identity."** THE LIVERIES: the chassis stays dark iron,
the identity rides the details. The MAKER's drum bands sit furnace
orange cold and re-tint to whichever line is seated — a violet maker
looks violet from across the room, which is the identity that matters:
what it makes. The COMBINER wears fitter's brass on the clamp and the
spine where its halves meet; the CHEST, storeman's olive straps and a
painted lid; the BANK, minted gold round its mouth. Rails and posts
stay plain — infrastructure has no trade.

**"Make the last item harder — like you have to combine the pump and
the lamp."** SERVO is tier 3 now: a PUMP and a LAMP fitted together,
four base parts through three combines, every line on the floor in one
bolt. The fourth gate wants three of them instead of six — the sheet
got deeper, so it stopped being longer — and the part's kit and icon
carry both parents, per the lineage law.

**"Let's have the goop dance on top of the VAT."** It used to climb
down and dance on the boards; now the climb ends ON the lid and the
tank it was brewed in is its podium — head at your eye line, hopping
on the machine that made it, the contact shadow grounding it on the
lid instead of the floor.

### The fourth pass — the pillars slim down and line up

**"Let's iterate on the design for the tube pillars, more slender and
aligned."** The manifold pillar was a 22 cm drum wearing a 32 cm spout
plate — a gatepost. It is a STANDPIPE now: the column thinned by nearly
half and drawn a touch taller, standing on a bolted foot flange, with
the working weight moved into the one part that cannot shrink — the
spout boss, which still has to visibly swallow the tube's 88 mm root
section. A slim riser carrying one heavy boss is the fitter's
silhouette. Two hub collars ring the column at the tape band (0.72 m)
and the bench datum (0.85 m), the same two heights the site's rig is
built to, so the pillar reads as part of the room's grid rather than
furniture beside it; a ring of hex heads on the plate face keeps the
fabrication tell at eye level, and the boss stack (neck, plate, gland,
halo) sits on one tight axis instead of the old z-scatter.

Aligned in plan, too: the tape lands wherever the player dragged it, so
a pillar at the raw midpoint of its side stood a random fraction of a
cell off the build lattice — every straight pull met its machine
slightly askew, forever. Each pillar now snaps to the nearest lattice
centreline (`FactorySystem.sideMid`), so the spout looks straight down
a row of cells — and because opposite sides share one midline, facing
pillars line up with each other down the same lane by construction.

### The fifth pass — no daylight in the joints, and the boxes get their fittings

**"Make sure there's no gaps in these connections and sockets between
the tubes and boxes."** There were two, both measured off a close-up:
the gland's origin floated a finger's width off the maker's drum
(glandPose reached to a crate face that isn't there on a round drum —
levitating plumbing), and the collar seated 20 mm BEHIND the gland's
rim, clipping through the throat wall in a three-ring argument. Fixed
at the root: `sim.glandReach` gives every gland the radius of the BODY
it actually bolts to, sunk a few millimetres so its new mounting BOSS —
a stub barrel with a clamp band — presses in at every swivel angle
(through the vat's glass it doubles as the intake stub you can see
inside the tank); the seat maths, the live mesh and the build ghost all
read that one number. The mouth is drawn tighter round the bore it
takes, and the collar now seats at `FACTORY.glandSeat` — pressed
against the rim from the OUTSIDE, like a union nut, cap just inside the
mouth. The spout end already sealed (the root section starts inside the
pillar boss's gland ring); it stays as it was.

**"And further polish the boxes."** The fittings pass: every box stands
on a FOOT FLANGE now, same language as the pillars — a bare leg read as
stabbed into the boards, not stood on them. The maker's drum lands on a
skirt where it meets the leg and its piston works through a stuffing
box (nothing enters a pressure vessel through a bare hole); the chute
trays grew lips — a TRAY, not a shelf — on makers and both combiner
ports; the chest's olive lid is pinned by four hex heads; and the
combiner's brass spine, drawn proud of its lobes, wears two more down
its face. Draw budget after all of it: 104 of 420.

### The sixth pass — nothing clips: the pour, the corridor, the crossing

**"The liquid in the tubes appears too angular — a piece of liquid
sticking out of the glass casing."** Photographed on the headset, and
the mechanism was exactly what the photo shows: each section's pour
volume was aimed at the curve point BEHIND its joint (the old overlap
trick), which put the prism on a different line than its own casing —
at any bend it cut the corner and stuck out of the glass as a hard
wedge. The pour is COAXIAL with its shell now (same chord, same
quaternion, so it geometrically cannot leave its own glass) and tucks
backward along that shared axis into the fatter section behind, with
the tuck clamped by the local kink so it cannot burst out of that shell
either — at a sharp carried bend the overlap shortens and the rib
covers the seam, which is the right failure. Same fix in both pull
forks (wall + factory), and the pour prism gains the shell's own 18
sides so the liquid stops reading as faceted. job-walk still holds
every joint at 0.00 mm.

**"Tubes clip through each other — they should find paths around each
other… maybe connect to the top of the boxes to be more out of the
way?"** Both, and they reinforce: the MAKER's gland now mounts HIGH on
the drum and TILTED UP (~60°), so supply lines ride an overhead
corridor from the spouts (1.05 m) down to ~0.91 m and pour in from
above — clear of the rails, the parts riding them, and the other boxes
that a level 0.7 m mount used to plough straight through. The VAT is
the deliberate exception, kept side-fed at working height per the
follow-up ask: the green pour arriving inside the glass is the finale's
whole show, and the lid stays the goop's podium. And where two SEATED
tubes still cross in the overhead corridor, THE CLEARANCE PASS lifts
the later one's belly over the other — its bezier controls rise, its
ends stay seated in their glands, the polyline law keeps every joint
sealed through the new bend — a pipe bridging a pipe, the same language
as a rail decking a rail. Held runs are never fought, and the pass
recomputes only when the seated set changes. (Rails already refuse to
clip by construction: they route around plant and deck over crossings —
that half was the third pass.)

### The seventh pass — the angle comes off, the arc stays

**"This angled up idea looks like garbage unfortunately — it looked
much better before, but we hate the overlapping."** Exactly the right
verdict, and the two halves separate cleanly. The tilted mount is
REVERTED — glands are level side collars at 0.7 m again, the union that
photographed right — and the overlap job moves entirely onto THE
CLEARANCE PASS, which grows a second duty: besides lifting a seated
run over another seated run, it now lifts every seated run over the
PLANT under its flight path. Each sampled point on the curve asks the
cell below what stands there (a rail plus the part riding it, a bench
box, a bridge deck, the vat and whatever dances on it — each with its
own clearance height), and the run's bezier controls rise until the
belly clears; the run's own target box is exempt, since the line must
come down level to seat in it. Recomputed when the seated set changes
AND when the floor does (plant.generation rides the signature), so a
lane hauled underneath a standing line pushes that line up on the spot.
Clashes hard against a run's endpoints are left alone in both sweeps —
a mid-curve bump has no leverage there, and pumping it just buys a
huge crest that separates nothing.

### The eighth pass — the leak at the elbows, and the clearance pass grows teeth

**"We're still seeing liquid poking outside the tubes in certain
places."** The certain places were sharp elbows — exactly where the new
clearance arcs put sharp elbows. The pour's joint tuck had a 2 cm
MINIMUM, and at a steep kink even 2 cm of tail pokes sideways out of
the fatter shell; the root's tuck into the mouth was never clamped at
all. The tuck now shrinks all the way to ZERO against the local kink
(both ends, both pull forks), and the seam a vanished tuck can no
longer bridge belongs to the RIB: the joint collar widens with the
kink, so a sharp bend reads as a fatter fitting, never as a gap and
never as escaped liquid.

**"And I'm seeing tubes clipping over each other in the most recent
test images."** Two real defects, both now measured instead of
eyeballed (factoryView.runCurve samples the exact drawn curve; the
look tool audits distances). First, the pair check compared POINT
samples ~15 cm apart, so a perpendicular crossing's true closest
approach fell between samples — "cleared" on paper, clipped on screen.
It uses exact segment-to-segment distances now. Second, always lifting
the LATER run was a pecking order, not a solution: in a cramped corner
it pinned at its cap with the tubes still touching. The pass is a
RELAXATION now — each round finds the worst remaining clash and moves
whichever run clears it cheapest, and the dodge is a full VECTOR: up
first, and a bounded SIDESTEP when vertical leverage runs out (pushed
along the line between closest points, never downward), with the plant
sweep re-run afterwards since a sidestep changes what stands beneath.
Audited on the adversarial rig (two runs crossing above a lane laid
under both): tube-tube 0.223 m at the crossing, 0.999 m over the lane,
against bores that need 0.15.

### The ninth pass — the mouth of the spout

**"As the liquid enters the tubes we get this gross sharp angle of the
liquid and the liquid poking through to the outside world."** The
headset was pointed straight at a pillar mouth, and both counts were
real. The POKING was the root section's pour tail: every section tucks
backward along its own axis to hide the joint seam, and at the root
that tail runs INTO the mouth — but on a dodge-lifted run the root
chord leaves steeply, the tail swings out of the gland boss, and the
pour's raw lit end cap hangs in the room. The root has NO tail now, in
both pull forks: the shell's own overhang plus the boss ring cover the
mouth seam without one.

The SHARP ANGLE was the clearance dodge itself. The lift lands on the
curve's two control points, and a control sitting only ~0.85 m off a
mouth that gets shoved a full metre upward means the tube WRENCHES off
the spout axis the moment it leaves the boss. Two fixes, one honest,
one structural. Honest: a dodged run's controls now also STRETCH out
along their own end normals as the lift grows (capped — scaling it
freely threw the controls metres out and looped the curve past its own
head), so the first stretch of tube holds the boss line and banks the
dodge into the middle of the arc. Structural: the plant sweep's demand
had a ratchet in it — a lane hauled right up to a fed maker put lane
cells under the tube's final descent, no lift can raise an end pinned
in its gland, and the solver pumped every such run to its height cap
for nothing. The SEAT CORRIDOR is exempt now (samples within half a
cell of either endpoint, by distance, not index), which is the old
documented caveat — "a line must come down to seat" — carved into the
solver instead of written under it. On the same adversarial rig the
lifts fell from the 1.4 cap to 0.98/0.68, departures fell from ~50° to
~30°, and the clearances HELD: tube-tube 0.227 m, 0.976 m over the
lane, and the mouth close-ups show the seam buried in the boss.

### The tenth pass — flush at the socket

**"The tube and liquid still don't sit flush to the socket as we'd like."**
Three defects under one complaint, and the first was measurable: a
dodged run arrived up to **52 degrees off its gland's axis**. The
clearance offset landed on the bezier's two control points, and those
controls ARE the end tangents — every lift tipped the tube off the
spout's boss line at one end and off the gland's axis at the other, so
the pipe drove past its own port into the side of the drum while the
socket sat empty beside it. Last pass's normal-stretch only bent that
curve back a bit; nothing on a cubic can hold an end tangent while its
control moves.

So the offset moves the CURVE now, not the controls: `dodgeBump` is
zero, and has zero SLOPE, at both ends, spending the whole lift in
between (`tube/geometry.ts`). Both fittings keep their axes exactly —
**52 degrees to 1.0**, and the spout departure fell to 1.5 with it —
while the belly still climbs wherever the plant needs it to. The
solver got sharper in the same move: a lift now displaces the line at
t by exactly `lift · dodgeBump(t)`, so the leverage it divides by is
the real number rather than a cubic's approximation, and the same
clearance costs less lift (0.98 → 0.64 on the crossing rig).

**The pipe was fatter than the port.** The factory's fork sized its
telescope to the global 7 m ceiling instead of to the run, as the wall
game always had — so a 0.6 m shop run unfurled ONE section and
delivered the root bore, 0.088, into a mouth cut for the 0.058 head.
No aiming fixes a pipe wider than the hole. Sized to the job it
spreads five or six sections over a typical run, tapers root-fat to
head-thin, and arrives at 0.067–0.079; the gland's own bore went to
0.064 × 1.3 to take it with a ring of port still showing. A parked
feed now reads as a telescope waiting to be pulled rather than one fat
plug.

**And the liquid stopped at the collar.** The pour ended flush with
the head, showing the flat face of its own column at the joint. The
last section's volume runs `TUBE.pourSeatReach` past the head into the
throat now (both forks), so a feed simply arrives inside the box.

Audited on the same adversarial rig: tube-tube 0.224 m, arrival 1.0
and 0.6 degrees off axis, head standoff exactly on the seat. The one
standing caveat is unchanged and inherent: the last 20 cm into a
gland is a descent to a port at 0.7 m, so a lane hauled hard against
a fed box still passes under a tube that is coming down to meet it.

### The eleventh pass — the last screen

**"The thank you for playing sign doesn't go behind or in front of the
goop."** It was doing both at once, and that is the giveaway: the card
planted dead ahead like every other panel, straight through the
creature, and the goop is not one kind of surface — the gel is
transparent and writes no depth, so the sign drew over its body, while
the eyes are solid geometry, so they drew over the sign. Half a creature
in front of a card and half behind it.

Two moves. The card STEPS ASIDE: if the goop falls inside the cone the
card would occupy — its own half-width at arm's length, plus the
creature's, plus a little air — the placement bearing swings just past
it, to whichever side moves it less. And the card draws as ONE PIECE
over the room (Panel.alwaysOnTop), so if you walk somewhere that puts
them together anyway, the sign stays a sign instead of being punctured.

**The sign is themed and it carries the credits.** It is the shop's own
metal now: a riveted plate with hex heads at the corners, the stencilled
title over an amber rule broken in the middle like a maker's serial, and
the goop's glyph above it. The closing paragraph about the shift is
gone, because the names are the point of a last screen:

    CREATED BY  yellkell
    MUSIC BY    IBWildcat1998, poopoodoodoo698 & JakeThePro

The names are typeset at the size that FITS the plate (measured, then
stepped down) rather than a fixed one — a name is not something to wrap
or run off the end of a card.

**And the eyes went back.** Two rebuilds had chased legibility across a
lit room — a sclera/iris/pupil eye, then a bigger one with an amber iris
— and the verdict on both was the same: not him. The beads he was ported
with are restored, near-black with a single white speck, sunk into the
gel. The two things the rebuilds got right are kept, because neither
shows on the bead: the pair is separated by a real width rather than a
splay angle (a fixed angle slid both eyes onto the same spot as the body
turned), and the gaze wanders instead of locking on.

### The twelfth pass — every item made its own way

**"Let's work on the maker and combiner animations and have each item be
made in a unique visual way."** They had one animation between them: the
maker's piston bobbed on a sine wave for four seconds and the combiner's
clamp dipped two centimetres on the same wave for six, whatever was
being made, and then a part popped onto the chute at 2.4× scale for a
third of a second. Nothing in the motion said WHAT was being made, and
the one moment that did was over before you turned your head.

`factory/craft.ts` is THE CRAFT THEATRE: one choreography per item,
driven by the sim's own craft progress (0..1, so QUICK BOXES and the
tools' fast-forward simply play it faster) and staged on the machine's
own hardware. A maker forms a PHANTOM — the item's own kit, drawn
through the same instanced pools as the parts, with a per-component
matrix the theatre writes each frame, so a molten slug costs what a gear
on a rail costs. A combiner animates the two REAL parts sitting in its
ports (the sim leaves them there until the craft lands): they walk in
from their trays, meet under the press, and FIT.

| Item | How it is made |
| --- | --- |
| GEAR | **struck** — a molten slug on the anvil, lit through an additive heat shell; the die set winds up and DROPS three times, sparks off each blow (glint sprites, not squares), the plates spread and the top one indexes a third of the half-tooth per blow, hub and axle rising out of the iron; the glow cools to nothing before the eject |
| CELL | **drawn** — the canister extrudes up out of the die under the raised plate, sweating a cyan sheen; the plate comes down and PRESSES the caps on with a hydraulic sigh and a visible squeeze; the charge band lights and pulses full in three surges |
| CHIP | **etched** — a wafer on an indexing table under a scriber: six clicks round, the probe dipping on each and the traces growing a sixth at a time; then the pin comes down from above and is pressed home with a snap of arc |
| PUMP | **screwed** — the gear slides in, the cell arcs in over it and threads DOWN onto it, four turns at constant pitch, then the clamp presses the union |
| LAMP | **kindled** — the chip is lowered onto the cell as a crown and tapped home; the filament flickers twice and dies, then comes on and stays |
| SERVO | **torqued** — lamp onto pump, clamped, then the stack indexed a quarter turn four times under the press with the clamp biting on each, the flash cycling amber, cyan, violet, white (one bolt per line); then RUN IN: it spins up and brakes |

And every one ends the same way: the finished thing slides forward to
the exact chute slot the sim will stand it on (`sim.chuteReach`),
turning into the idle spin the real part will be born with (the sim's
next id is known before it spawns), so the swap from ghost to part is a
hand-off and not a cut. The birth punch shrank from 2.4× to a nudge.

Two pieces of hardware changed to stage it. The maker's piston is a DIE
SET now — a punch plate riding two guide pins that stand OUTSIDE the
work and run down into the drum (the first cut was a single central ram
on a rod, and the rod stabbed straight through the canister it was
pressing; the look tool caught it in one frame). The combiner's clamp
rides two brass columns on a PRESS FRAME, tall enough to lift clear of a
lamp hovering over a pump, so the parts can walk in under it and be
pressed rather than tapped from a bar lying on the lobes. The chute
slots and port trays moved too: a part waits IN the tray the builder
draws (0.21 and 0.105 off centre, ±0.2 for the ports) instead of hanging
off the drum's edge short of it and sitting under the piston.

Sound follows the cue, not the frame: the theatre reports `strike`,
`press`, `charge`, `etch`, `pin`, `thread`, `seat`, `torque`, `spark`,
`lit` and `spin` through a callback, FactorySystem plays them (two new
voices in the kit: `forgeStrike`, deader with each blow, and `servoRun`,
which winds up and holds or winds up and brakes), and all of it is
silenced under the tools' fast-forward, where a craft plays in a frame.

`tools/craft-look.mjs` stands three fed makers and a hand-fed combiner
on the fallback floor and shoots each craft at the moments that carry it
(`shots/craft/`), at quarter speed with the sim all but stopped for the
exposure so a frame lands within a hundredth of its mark. It also
asserts what can be asserted: the theatre is live, the die set and the
clamp leave their rests, the draw budget holds with all of it running
(338 of 420).

### The thirteenth pass — the lines clear, land square, and the rails meet their machines

**"In job the tubes can still overlap."** They could: the clearance
pass was the factory's alone, and HOT AND COLD's two long hauls ran
straight through each other. The pair half of that pass — the exact
segment-to-segment relaxation, who-moves, the push down the line
between the closest points — moved out of FactorySystem into
`tube/clearance.ts`, and TubeSystem drives it too: every seated wall
run is an item, re-solved when the seated set changes, drawn through
the same `dodgedPoint`. The room sets the caps instead of the plant: a
belly may rise to just under the scan's ceiling and, the floor being
open, the LOWER of a pair may dip toward it (the shop never dips — the
plant is down there). Two bores and a hand's width of daylight in the
room (`CLEAR_ROOM`), because a crossing that cleared by two bores on
paper still read as two pipes touching. job-walk now measures the
closest approach between every seated pair's drawn curves on the
multi-run jobs and holds it over 0.2 m through the middle of the runs.

**"In factory we had it where the tubes jumped out of their socket when
repositioning after an overlap."** Two mechanisms, both real. The
window: `dodgeBump` was zero with zero slope at the ends and still
ROSE through the last section, so a tall lift put the section in the
gland 20–40° off the gland's axis — every joint sealed, and the pipe
still read as having jumped out of its seat. The bump is dead flat for
`TUBE.dodgeEnd` of the run at each end now (one section of eight), so
whatever the lift, the section that sits in a fitting lies along that
fitting's axis; lines-look measures it under 3° on every gland, every
socket, before and after a re-solve. The snap: the pass re-solved the
instant a line seated, a box landed, or a collar was tugged loose, and
the frozen curve POPPED to the new one — at its worst the whole arc
collapsed into your hands as the seal broke. Each system keeps the
SOLVED offset apart from the DRAWN one and walks the drawn one toward
it at `TUBE.dodgeEase` (`easeLift`), in every phase: a freshly seated
line bows into place over half a second, and a tugged one relaxes.

Two honesty rules came with the window, because a flat end costs
leverage: inside the fitting corridors (bump under 0.2 — the first and
last quarter of a run) a clash is the OTHER run's to clear if it has
the purchase, and otherwise the fittings' business; and the plant
sweep no longer pays for a clash the cap cannot clear — a press frame
a few sections short of a gland used to buy the tallest tent the cap
allows and still pass through the frame. Half a clearance is no
clearance, and the arc it costs is real.

**"We had edges of liquid showing at turns in the tubes across
everything."** The eighth pass ran the joint tuck to zero against the
local kink, which was the right failure for the tuck — and exactly at
the kinks the clearance arcs make, both cylinders' flat ends then
showed through the frost as hard wedges of liquid. THE BALL JOINT
replaces the tuck (`build.posePour`): every section's pour ends on its
joint point in a sphere of its own bore, sharing the pour's live
uniforms (`createJointMaterial`) and carrying its own arc-length span
so the front sweeps through it, and the next section starts inside it.
A bend is an elbow of lit liquid now; no flat cut can face the room.
Seven more draws a run; FULL PRESSURE sits at 132.

**"We want the rails to actually connect to the makers and
combiners."** They didn't: the chute tray hung 0.1 m over the next cell
at bench height, six centimetres above the rail standing there and
touching nothing, and a stamped part left it by dropping through the
tray onto the tread. The chute is a SLIDE (`units.chuteSlide`,
`sim.CHUTE_SLIDE`): it leaves the machine's face at bench height and
comes down to rail height just over the cell edge, where its foot sits
on the rail's skid tops with a bolted cross-bar under it. A combiner's
two ports are the same slide turned outward, so a lane runs up into
the hopper. `chuteY(reach)` is the one function that knows the slope:
`partPose` walks a waiting part down it (slot 0 waits at the foot, at
rail height — where the lane takes it from; slot 1 behind it on the
drum's edge), a port part waits at its slide's foot on the end of the
rail that fed it, and the craft theatre's eject and walk-in ride the
same numbers, so the hand-off from phantom to part is still a
hand-off. `tools/lines-look.mjs` shoots both joints close and asserts
the slot heights.

**"We want an arrow instead of a dot when placing rails."** The laser's
cursor was the board's dot everywhere — right for a button, wrong for a
lane, where the thing you are choosing is a direction as much as a
spot. `PointerRay` has two faces now (`ui/pointer.ts`): the dot for
things you press, and a flat ARROW that lies on the boards at the hit
point, nose along a yaw the caller hands it, wearing the dot's swell
and click pop. BuildSystem asks for the arrow whenever a rail is armed,
pointed the way the lane will run — the facing the piece would land
with, or, mid-haul, the last step of the run in your hand.
