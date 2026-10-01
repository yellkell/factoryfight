# TUBES — design notes

The pitch in one line: **your room is the machine room — mount a flange,
haul a two-handed tube out of the wall, seat it across the room, and
light pours through.**

RAVE RAID proved a set of crafts worth carrying whole, and TUBES is built
deliberately on that legacy:

1. **The surface language.** The canvas panel kit — quiet near-black
   glass, white-alpha hairlines, ONE accent that only marks what matters,
   eased hovers, a breathing under-halo — moved over intact and swapped
   its magenta for furnace amber. The board had to be the quality of the
   RAVE RAID board; the cheapest way to hit a bar is to bring the bar.
2. **The clipped-liquid trick.** The glowsticks' gel (Alyx-style world-
   space clip plane, bright back-face cut, meniscus band) is re-derived
   here as **the pour**: the clip is an arc-length front racing down the
   run instead of a level surface resting in a glass. Same illusion,
   rotated ninety degrees and given a job.
3. **The sound idiom.** Synthesised WebAudio, no assets: struck plate
   steel, servos, bandpassed steam. RAVE RAID's kit was already tuned to
   an industrial palette — TUBES plays the same instruments slower and
   lets them ring.
4. **The discipline.** Every tunable in one config with its reasoning
   attached; systems that own exactly one thing; a debug hook that makes
   the whole game drivable headlessly; tools that walk the REAL code and
   exit non-zero. The craft is the feature.

## Pillars

- **The room is the venue.** Full passthrough, no dome, no dim slider.
  Everything TUBES draws is bolted to, carried through, or shone into
  the player's actual space — the game never asks the room to pretend.
  The best effect in the game (the shaft) works BECAUSE the stage is
  real: fake sunlight in a fake room is set dressing; fake sunlight in
  your kitchen is a small miracle.
- **Two hands or nothing.** The tube is plant, not a prop. One hand
  rattles it (the whole tutorial, no words); two hands haul it; the lag
  in the follow spring is the weight. Every number in the pull exists to
  make "big heavy industrial thing" true in the wrists.
- **Doorways, not keyholes.** Aim anywhere near a wall and the reticle
  clamps somewhere legal. Arrive anywhere near the socket, roughly
  square, and the magnet does the last metre. Let go anywhere and the
  tube parks. The game's precision demands are all theatre — the
  forgiveness is engineered, invisible, and total. Nobody fails a
  pipefitting fantasy on a five-degree alignment check.
- **The payoff is light arriving.** Everything funnels into the pour:
  the charge (one held breath), the front (racing, hot-banded), the
  arrival (chord, bloom, shaft, hum). Satisfaction is the win condition;
  the timer is garnish for people who like garnish.
- **Theatre in fixed beats.** Mount → knock → iris → pull is the same
  shape every time, short enough to never wait through grudgingly. The
  wake is the room ANSWERING — the fiction (THE WORKS is already in
  your walls) does the worldbuilding a cutscene would have begged for.

## The room model

The scan (WebXR plane detection, requested optional so a refusal still
plays) becomes a **wall registry**: centre, into-the-room normal (decided
by which side the player is on), right/up tangents, half-extents. One
system owns the fold (WallSystem); everything else reads the registry and
never touches a raw XRPlane.

- **The mount band.** Hardware lives away from wall edges (0.3 m inset)
  and between 0.7 m and 2.05 m of height — where hands actually work.
  All placement maths clamps into the band rather than rejecting.
- **The registry holds every mountable surface.** Vertical planes are
  walls; the scan's floor and ceiling join them with a `kind`, and
  labelled furniture (tables, desks, couches) is filtered out on
  principle. Flanges mount on walls only — the half of the run you were
  taught stays where you were taught it — but the room's answer can
  come from any kind.
- **The socket picker** is a pure seeded function in two lanes: sample
  candidate spots across every other usable surface, keep those whose
  straight run fits [1.15 m, 6.4 m], require the spot to be in FRONT of
  the flange's face, require the chord to arrive inside the seat's own
  alignment cone with margin, AND require the spot to sit inside the
  fitter's own reach — **every pick the room makes is a pick the magnet
  can take and the hands can get to, by construction**. The cone
  already capped flat runs short and steep; the REACH LAW
  (PORTS.overheadReach, measured off the player's live eye line plus a
  two-hand raise and most of the magnet's snap) is what stops a socket
  irising awake on a 2.7 m ceiling: knocked for, lit, aimed at, and
  impossible to finish. Ordinary ceilings therefore stop answering and
  low ones still take their turn, which is the only room an overhead
  port was ever fun in. A
  seeded roll (PORTS.flatChance) sometimes tries the overhead lane
  first — a lane, not a score bias, because on a distance-flavoured
  score a short flat spot never outbids a wall, and "sometimes the
  ceiling answers" has to actually happen. Within a lane: long-haul
  jobs weight distance, ordinary jobs the middle of the range, best
  wins with seeded jitter. Same seed, same layout: the headless walk
  replays exactly. A floor port never wakes under the player's feet.
- **The fallback room** (4.6 × 3.6 × 2.7 m around the player, aligned to
  their facing) stands in when no scan answers within the grace. It's
  drawn only as hairline frames, only while a flange wants placing — you
  cannot aim at plaster you cannot see — and the board's status chip
  always says which room you're in. Real planes arriving later evict the
  stand-ins, but never mid-shift: mounted hardware keeps its walls.
- **The stage room.** A headset with its boundary drawn plays inside
  that room-scale box, not the scan: the registry becomes six faces on
  the box's edges (`room/stage.ts` reads WebXR's bounded floor; the
  scan lends floor and ceiling heights), so the flange reticle, the
  socket picker and the tape all land on the floor you set aside to
  walk. Drawn as hairline frames while a flange wants placing, like the
  stand-in, and re-dealt only between shifts, like everything else.

## The tube

Modelled as a **cubic bezier** (mouth → out along the mount wall's
normal → back along the head's entry direction → head) carrying **eight
nested rigid sections, root fattest, filling root-first**: section i
shows `clamp(ext − i·segMax, 0, segMax)` of itself. Pull, and the fat
section comes out until it hits its stop, then the next thinner one
emerges from inside it — the classic telescope, which makes each
section's arrival an EVENT (a deeper clank, a harder buzz) on top of the
fine ratchet detents every 0.34 m.

The pull's five rules (each one line of feel, all in TubeSystem's
header): two hands or nothing, and then it's yours · the lag is the
weight and the wrists are the rudder · the ratchet tells the truth ·
parked is a real state · the socket does the last metre. "Then it's
yours" is load-bearing: acquisition tests reach + squeeze, but a HELD
collar re-tests only the squeeze (analog, soft floor) — the head lags
the hands on purpose, and measuring your grip against your own weight
illusion is how a fast haul once dropped itself. The follow is a single exponential
spring whose rate falls with extension; THE STEER blends the two
controllers' pointing direction into the head's travel
(TUBE.steerBlend) and stretches the end control while it's live, so
tipping both hands visibly bows the run — the curve answers your
wrists, not just your feet; the park is one underdamped droop spring;
the stops creak. No physics engine — RAVE RAID's club glasses proved
five cheap tricks read as one expensive one, and the tube runs on the
same economy.

**The seat.** Inside 0.32 m and within ~70° of square, the magnet takes:
the head eases onto the seat pose while the path's end control swings to
the socket's normal — so the tube visibly SWEEPS IN and meets the far
wall perpendicular, the way pipework does and rope doesn't. Latch dogs,
line-flavoured exhale (steam / hydraulic sigh / arc-snap), iris opens,
and the run locks. Hands come away clean; a seated run is DONE and can't
be un-seated — TUBES has no failure states, only unfinished jobs.

## The pour

One shader (materials/flow.ts), cloned per section, all sections of a
run sharing front/time/energy:

- **Charge** (0.55 s): energy ramps the dormant volume from near-black
  to lit — the line visibly wakes before anything moves.
- **The front**: an arc-length clip with a wobbled face (a surge, not a
  bulkhead), back-faces painted as the bright cut, a hot foam band
  burning behind it, racing at the line's speed (MAINS 2.3 m/s heavy,
  COOLANT 4.2 fast, VOLT 5.4 in packets).
- **One column, no cells**: two laws together. THE POLYLINE LAW —
  every piece (shell and pour alike) spans the straight line between
  its two points ON the curve, so consecutive sections share their
  joint point exactly and the run cannot open a gap at any bend the
  steer, the droop or the seat can ask for (pieces sized by arc length
  and centred on the curve used to fall short of each other, because a
  bent curve is longer than the chord between its ends — the walk now
  measures the worst joint off the scene's own transforms and holds it
  at zero). And THE BALL JOINT — each section's pour volume ends, on
  its outer joint point, in a sphere of its own bore that the next
  (thinner) section's volume starts inside, sharing the pour's live
  uniforms and carrying its own arc-length span so the front sweeps
  through it at the pace it crosses the pipe. At any bend the elbow is
  a ball of lit liquid; no flat cut of either cylinder can ever face
  the room. (The sections used to TUCK back through their joints into
  the fatter one behind, the tuck clamped by the local kink — and at
  exactly the kinks the clearance arcs make, the clamp ran the tuck to
  nothing and both cylinders' flat ends showed through the frost as
  hard wedges of liquid at every turn.) The joint rings are cut slimmer
  than the collar stock and sit on the balls' equators. The column
  steps down in bore at every joint, exactly what a telescope full of
  liquid would do; it never breaks.
- **Alive**: two travelling body waves plus the line's pulse — MAINS
  rolls (0.5 Hz), COOLANT streams (0.9), VOLT strobes (2.2 with `chop`
  squaring the wave into plasma packets with dark water between). Wet
  gloss (two Blinn-Phong lobes) and a fresnel skin keep the volume
  reading as a lit liquid cylinder, not flat neon.
- **Arrival**: the line's chord (warm third / bright fifth / electric
  octave over one shared boom), a 90-glint bloom off the socket mouth
  (population-sized sparkle — dust, grains, hero catches — that dies in
  the air, never litter), the hum fading in (per-line patch, detuned per
  run so two MAINS never phase-lock), and THE SHAFT: a ramped additive
  cone firing straight out of the socket's mouth, 46 motes drifting in
  it. Centred on every surface — level from a wall, rising from the
  floor, pouring from the ceiling; an early draft leaned every shaft
  downward for "sunlight" and it read as droop from anywhere but the
  floor. The sun flavour lives in the ramp and the motes, not a sag.

## Hardware that reads from everywhere

A socket's throat is an OPEN cylinder — it is a bore, you look into it —
and open geometry is where one-sided materials betray you: FrontSide
draws only the wall facing the camera, so the far wall's inner surface
is culled and the mouth reads as HALF a rim, with the visible half
following the viewer round the room. Invisible from any one viewpoint,
obvious the moment you walk past. Two rules came out of it, and both are
cheap:

1. **Open geometry renders both sides.** The throat wears its own
   two-sided material (`plateOpen`). The tube's shells stay one-sided on
   purpose — they are transparent and filled with an opaque pour, so
   their far wall is hidden anyway, and two-sided transparency would
   only buy self-sorting artefacts.
2. **Silhouettes are closed shapes.** The socket's rim is a torus, so
   the outline that says "socket" is whole by construction and can never
   depend on where you're standing. `tools/socket-look.mjs` orbits one
   and shoots 14 angles, because this class of defect is only ever
   visible in motion.

## The lines

Identity is carried three free ways — silhouette (plate sides: 8 / 24 /
6), surface (rough iron / brushed alloy / dark glass), light (amber /
cyan / violet) — plus pour behaviour and voice. Nobody counts bolts in
passthrough; everybody reads a hex plate as industrial from across the
room. A socket only takes its own line, which is the whole matching rule
and all the puzzle the ladder needs to teach.

## The jobs

Five sheets, no difficulty settings — the ladder IS the difficulty:

1. **FIRST LIGHT** — one MAINS run. The verbs, taught by doing — plus
   one sentence of coaching standing in the room while the first flange
   wants placing (the board's words leave with the board, the beam only
   draws once it is already on a wall, and Ⓐ is a button nobody has
   been told about). The only words a shift ever speaks unprompted;
   every later sheet trusts the flange on the ray.
2. **CROSSTOWN** — one run, long-hauled: the picker weights the farthest
   honest wall, so the tube must cross the room and the park (letting
   go halfway) earns its keep.
3. **TWO-HANDER** — MAINS then COOLANT: lines exist, sockets are typed.
4. **HOT AND COLD** — both, long-hauled: two runs wanting the same air;
   you route around your own standing work.
5. **FULL PRESSURE** — all three. The last seat triggers the ceremony:
   every pour surges, the chord spreads seven notes, and the board comes
   back with the sheet stamped.

Runs are sequential (place → pull → pour, then the next flange), which
keeps the loop tight and the teaching honest. Best time per job on the
sheet; a rerun rolls a fresh seed, so the room deals new walls.

## The shop floor

The factory half of the game, and the half playtest reshaped hardest.
Four things carry it now, and each one replaced something that was
actively working against the player:

- **ONE DOOR, AND IT REMEMBERS.** The board's FACTORY tab offers a
  single button. It used to list every sheet you had ever reached and
  let you START any of them — which dealt you sheet four's demands on a
  bare floor with none of sheets one to three's feeds, plant or parts.
  Every entry but the first was a trap dressed as a choice.

  The first fix — one door that always opened at sheet one — traded that
  trap for a worse one: it threw every session's progress on the floor.
  Come back after a week and the catalogue was a single MAKER again,
  with `stored.orders` written faithfully and read by nobody. So the door
  opens on **the sheet the book had got to**, and `postOrder`'s wakes are
  **cumulative** — posting sheet N switches on everything sheets 0..N
  ever granted, which is what makes arriving mid-book survivable at all.
  Fill the book and the door opens onto the shop wide open instead. The
  floor is still bare (a shift is a shift); the bank rides in from the
  shelf and the plant is yours to stand again.
- **NO SHEET MAY DEAD-END.** Sheet one asked for three stamped gears and
  a maker's chute holds two, so the only way past the first sheet in the
  book was to lift one off by hand — with a catalogue of one machine and
  nothing else to try if you didn't find the squeeze-to-carry. It asks
  for two now: it completes itself the moment the works works, and the
  backed-up chute becomes the SETUP for sheet two rather than a lock on
  it. A tutorial sheet must not have a failure mode.
- **THE LADDER STARTS WITH THE MACHINE.** Sheet one used to ask for ten
  draughts of fluid into a bank — a sheet about a hole in a box. It
  asks for three stamped GEARS now: stand a MAKER, run the amber feed
  into it, and watch the works make something. The bank arrives on
  sheet two, when there is finally something to put in it, and the rail
  arrives with it. The bank also stopped wearing a gland when the
  draughts went: the magnet takes the NEAREST free one, and a bank that
  caught every tube walked past it was the most-cursed object in the
  game.
- **THE SHAPES STAYED ROUND** — and this one is worth recording as a
  reversal rather than quietly deleting. The floor read as a steam
  museum, so a pass re-cut every chassis from flat stock: square boxes,
  four-panel folded hoppers, hex bolt rows, welded gussets, and
  `flatShading` on every material. It was, on a monitor, unarguably more
  like a factory. In a headset it was worse. The hard facets and the
  bolt detail ate the silhouettes at four metres — the exact distance
  the whole silhouette-first rule exists to serve — and the drums,
  bands and torus mouths turned out to be doing more work than they
  looked like they were doing. Reverted whole, and staying reverted. The
  VAT is the only machine with no earlier design to go back to, so it is
  built in the original idiom: a banded tank, which is what a vat is.
- **THE LANE BENDS.** A hauled rail run used to walk a plain Manhattan L
  and stop dead at the first thing in its way, which on any floor worth
  laying a lane across meant half your hauls died against the side of a
  maker. The route is a real search over the lattice now — Dijkstra over
  (cell, direction) with a turn penalty — so a clear floor still gets
  the single-cornered L a hand would draw, and an obstructed one gets a
  lane that goes AROUND. Posts still bend it deliberately where you
  want the corner.

## The hands, in the shop

Four buttons, and every one of them is the same verb in two moods:

| | with a tool in hand | empty-handed |
| --- | --- | --- |
| **Trigger** | stamp it (hold, on a rail, to haul the run) | open the box under the reticle |
| **Ⓑ** | turn the piece a quarter, and mean it | unplug a seated line, or unbolt a bare box |
| **Ⓧ / Ⓨ** | put it back down — ghost, links and a haul in progress | — |
| **Ⓐ** | the shift card | the shift card (or close an open box) |

**Ⓧ** was the late one. Arming a tool from the card was a one-way door:
the only ways back out were to raise the card and press the same tool a
second time, or to build something you did not want. It lives on the LEFT
controller because the right hand is holding the piece and doing the
aiming, and a bail-out you have to aim with is not a bail-out. It is
never destructive — nothing already on the floor comes off, and a haul it
interrupts simply is not laid (the anchor rail stays, because that landed
on the press before the drag ever started).

## The box panel

Point at any standing plant with an empty hand and pull the trigger.
Two playtest notes, one panel: *"we should be able to check what is in a
chest by clicking on it"* and *"we can't disconnect the tubes when
they're connected to the boxes — I delete the boxes at the moment."*
Both are the same card. It says what the machine is, what it is holding
(a crate's stack, a chute's queue, a combiner's ports, a rail's cargo,
the bank's whole vault, the vat's level) and what line is plumbed into
it — and it carries UNPLUG, TURN and TAKE IT OUT.

The two-handed TUG (grab the collar, haul it clear, hold while the joint
strains) is still the good way to break a seal in the room, and is
untouched. UNPLUG is the way you can FIND, which is a different
requirement and deserved its own answer. Every route — the tug, UNPLUG,
Ⓑ on a plumbed box, the wrecking bar — goes through one sim door now, so
the hum stops and the iris shuts exactly once however it happened.

## The records

TUBES' audio was 100% synthesised for a reason — struck metal and steam
want to be parameterised, and there was nothing to ship. Music is the
opposite: finished work, where the only job is putting the right one on.
So `audio/music.ts` sits beside `audio/sfx.ts` rather than inside it,
with its own bus straight to the speakers: the records are already
mastered and pushing them through the SFX glue compressor would only pump
them against the ratchet clicks. Two faders, because a player who turns
the shop down to hear the music is asking for two knobs.

**Three decks, and no state.** MusicSystem reads `site.screen` and
`plant.goop` every frame, works out which deck that means, and asks for
it; `setDeck` ignores a request for the deck already up. Nothing tracks
transitions, so nothing can get stuck in the wrong place.

- **THE BOARD** — 4 LEAF CLOVERS, on its own, looping. The longest of
  the four and the one you hear from the top every time you come back.
- **THE FLOOR** — the three NEW SONGs, shuffled through a bag so a set
  plays out before anything repeats, and never restarting on the track
  that just ended.
- **THE VAT** — NOVUS, from the instant green starts filling the tank,
  through the birth and under the whole dance. One-way within a shift:
  unplug the line half way and the record keeps going, because the thing
  in the tank is still in the tank and cutting back would undo it.

They crossfade (2.2 s, 3.4 s into or out of the finale). A shift
beginning is a door opening, not a track change.

**Streamed, not decoded.** Each track is an `<audio>` element piped in
through a MediaElementSource. Decoding 18 MB of masters into AudioBuffers
would cost a Quest tens of megabytes resident and a stall on first play,
to buy sample-accurate scheduling a jukebox has no use for. RAVE RAID
decodes because a rhythm game must pin beat zero to the audio clock;
nothing here counts bars.

**All five are MP3.** Novus arrived as an `.m4a` and was transcoded,
because AAC only ships in browsers whose vendors license it — Chromium's
open-source builds refuse the file outright. Silence is survivable on a
background track and not on the one the whole book walks toward.

## THE GOOP

The book ends with a machine you cannot use. Three SERVOS — each a PUMP
and a LAMP fitted into one, the book's one tier-3 part — crank the fourth
manifold's gate off the near pillar — a hatch with crossed straps and
eight bolt heads that has visibly never been opened — and behind it is
PEARL, which is GREEN, and nothing in the catalogue drinks green. The
last sheet hands you the VAT, the only glass on the floor, and asks you
to run the green line into it.

What climbs out is RAVE RAID's headliner, vendored whole (`src/goop/`):
the same twenty-blob verlet soup fused by a smooth-min into one
raymarched isosurface, the same overdamped wobble, the same club dance
stances. What did NOT come across is the fight — no moveset, no
telegraphs, no KO, no torn-off lumps, no hit detection. Nothing in a
factory throws a jab.

The arc is four beats and every one of them is a real object in your
room: the dome gathers inside the tank; it swells over the rim and pours
down the outside onto the boards; it stands up out of the puddle (the
sim's own glob→boxer morph, the trick this creature was built around);
and then it dances, hitting a stance on every beat and keeping you in
its eyes. THANKS FOR PLAYING comes up over its shoulder, and dismissing
the card leaves it dancing.

**The eyes are the pair he was ported with.** One near-black bead each
with a single white speck, sunk into the gel so it closes over them —
wet, not stuck on. They were twice rebuilt for legibility (a
sclera/iris/pupil eye, then a bigger warmer one with an amber iris) and
twice put back: both read better across a lit room and neither of them
was him. The beads stay.

What the rebuilds were right about is kept, because none of it shows on
the bead itself. They are placed by a lateral OFFSET, not a splay angle:
the first cut rotated the gaze vector by a fixed angle and marched out
from the head's centre, which works head-on and collapses the moment the
body yaws, because a fixed angle subtends less and less width as the
exit points converge round the silhouette — it could put both eyes
almost on top of each other. And they wander: a saccade re-aimed every
half-second or two, with an occasional proper look-away, plus a blink
that sometimes goes twice. Eyes locked dead on you read as a turret; the
wander is the cheapest thing on that list and does the most.

**THANKS FOR PLAYING is a bolted nameplate, and it stands BESIDE him.**
The card used to plant dead ahead like every other panel, which put it
straight through the creature: the gel is transparent and writes no
depth, but the beads are solid, so the sign came out half in front of
the goop and half behind it. Now the placement steps aside — if the goop
falls inside the cone the card would occupy, the bearing swings just
past it, to whichever side moves it less — and the card draws as one
piece over the room rather than arguing with anything for the same air.
Its face is the shop's own metal: a riveted plate, a stencilled title
over an amber rule broken like a serial, and under that the only thing
the last screen is actually for — who made it, and who made the music.

## The board

RAVE RAID's live-service lobby discipline, sized to a shop: one rail
(JOBS / FACTORY / SYSTEM), one content region, THE sheet on the right
with the one primary CTA. Every machine and every part carries its own
line-art SHOP DRAWING (`ui/icons.ts`) on the catalogue, on the goal
ladder and in the box panel — a list of seven words in one weight is a
thing you re-read every time; seven silhouettes is a thing you learn
once, and the ghost on your ray wears the same shape. AR-specific: the board RE-PLANTS in front of wherever the
player is standing every time it returns — in passthrough the menu comes
to the room, not the room to the menu. Mid-shift it's gone entirely;
right Ⓐ raises THE JOB CARD (live run states, the clock, BACK TO IT /
DOWN TOOLS). The card pauses the HANDS but never the MACHINE — a pour
mid-race keeps racing — because the fiction doesn't know you stopped,
and the fiction is the boss here.

## Honest limits

- **No occlusion.** Without depth sensing, a tube crossing your sofa
  draws over the sofa. Passthrough players forgive this faster than any
  fix we could afford; depth-gated rendering is on the roadmap, not in
  the build.
- **Controllers only.** The two-hand grab reads grip squeezes; tracked
  hands need a pinch-strength grammar that deserves its own pass.
- **The scan is trusted, not audited.** A wall the scan missed doesn't
  exist; furniture is invisible to the picker (a run can cross your
  bookcase), and horizontal furniture is deliberately REFUSED as a port
  surface — floor and ceiling only, because the machine lives in the
  room's bones. The mount band keeps the worst of it away from
  skirting.
- **Solo.** There is no wire. The seeded-layout discipline is already
  multiplayer-shaped (a shared seed deals both players the same walls
  only if they share a room scan, which is exactly the co-location
  problem), so the door is cut, not opened.

## Roadmap

- **Hands.** Pinch-to-grab with per-hand strength, so the two-hand rule
  survives controllerless play.
- **The fuller puzzle.** Multiple lines live at once with shared
  sockets — choose which service goes where; junction pieces (a Y that
  splits a run, a valve that gates one); runs that must cross without
  touching. The typed-socket rule scales to all of it.
- **Persistent plant.** WebXR persistent anchors (the SDK already
  restores them) so a finished job's hardware is still on your walls
  tomorrow — the room slowly becoming THE WORKS between sessions is the
  long game.
- **Depth occlusion** where the device offers it, so the sofa wins.
- **Co-located co-op.** Two fitters, one room, one tube — one on each
  end of a run that takes four hands. The relay would carry poses and
  seeds only, RAVE RAID style.
- **More services.** STEAM (billowing, scalding, and now that the
  ceiling takes ports, it would live up there on principle), DATA
  (glass fibre, light packets, wants corners). Each must earn a
  distinct pour, voice and metal or it doesn't ship. PEARL is spent —
  the fourth manifold got its one, unrepeatable moment.
- **After the goop.** It dances until you down tools, which is the right
  ending and not yet a right AFTERWARDS. It should have somewhere to be:
  wandering the floor, watching the machines, sitting on the bank. And
  the shop should acknowledge it — a maker that stops when it walks past,
  a rail it steps over.
- **A second vat.** The catalogue refuses one on purpose (one goop is the
  whole point of the goop), but the machine underneath is general: a tank
  that drinks a line and produces something that is not a part is the
  hook for whatever comes after the book.
