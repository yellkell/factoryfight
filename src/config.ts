/**
 * TUBES — every number the feel depends on.
 *
 * The game: a passthrough-AR pipefitting toy-puzzle played against the real
 * walls of your real room. Behind those walls (the fiction goes) sleeps an
 * old machine — THE WORKS — and you are the fitter bringing it back online.
 * A job hands you a run: you MOUNT a flange on a wall of your choosing, the
 * room answers by waking a socket somewhere on ANOTHER wall, and between
 * them goes a tube — a big industrial telescoping thing that takes both
 * hands. Grab the collar, haul it out of the wall click by click, walk it
 * across your actual floor, and offer it up to the socket until the magnet
 * takes it and the latch dogs slam home. Then the payoff: liquid light
 * pours through the run, the socket blooms, and a shaft of sun leans into
 * your room out of a wall that never had a window.
 *
 * Jobs start at one run and grow to three, keyed by LINE type — MAINS,
 * COOLANT, VOLT — each with its own metalwork, its own light and its own
 * voice. A socket only takes its own line. That is the whole puzzle, and
 * it is enough: the game is the pull, the seat, and the pour.
 *
 * Dimensions are metres. Times are seconds. Colours are the line's.
 */

export const GAME_TITLE = 'FACTORY FIGHT';

/* ────────────────────────────── THE WALLS ────────────────────────────────
 * Quest's room scan (WebXR plane detection) hands us the real walls as
 * planes. WallSystem folds them into a registry the whole game reads:
 * centre, normal (into the room), tangent basis and extents per wall.
 * Where no scan exists — desktop emulator, a headset that skipped room
 * setup — a synthetic fallback room stands in after a grace period, so the
 * game is always playable and the tools can always drive it.
 */
export const WALLS = {
  /** A wall must offer at least this much face (m²) to host hardware. */
  minArea: 1.1,
  /** Nothing mounts within this margin of a wall's edges. */
  edgeInset: 0.3,
  /** Mounting band: hardware lives where hands can work it. */
  minHeight: 0.7,
  maxHeight: 2.05,
  /** How long we wait for real planes after the session starts before the
   *  fallback room stands in. The scan usually answers inside a second;
   *  the grace keeps a slow first frame from building phantom walls. */
  fallbackGraceS: 3,
  /** The fallback room, centred on the player, aligned to their facing:
   *  a comfortable flat footprint (w × d, height h). */
  fallback: { w: 4.6, d: 3.6, h: 2.7 },
  /** Faint edge hint drawn on fallback walls (real walls need none — the
   *  player can SEE those). Opacity of the hairline frame. */
  hintOpacity: 0.22,
};

/* ────────────────────────────── THE TUBE ─────────────────────────────────
 * One run = flange (wall A) → telescoping tube → socket (wall B). The tube
 * is rigid plant hardware, not rope: it exits the flange along the wall's
 * normal, carries a gentle industrial flex on its way to your hands, and
 * telescopes in SEGMENTS that emerge one by one as you pull — each arrival
 * a click you can hear and feel. The segment count is fixed; the tube gets
 * longer by each segment sliding out of the one behind it.
 */
export const TUBE = {
  /** Telescoping segments (root → head). Eight reads unmistakably as
   *  plant pipework and keeps the whole run cheap to pose. */
  segments: 8,
  /** Radius of the fattest (root) segment, and of the slimmest (head).
   *  BIG on purpose: this is two-hands hardware, not a hose. */
  rootRadius: 0.088,
  headRadius: 0.058,
  /** How much tube sticks out of a freshly mounted flange — the stub you
   *  grab. Enough to read as "handle", not enough to poke anyone. */
  stubLength: 0.42,
  /** Max extension = run distance + this much slack, so a seated tube
   *  always had headroom and a wild pull can overshoot the socket a bit
   *  without hitting the stops the moment it lines up. */
  slack: 1.2,
  /** Hard ceiling on any run (fallback rooms are ~4.6 m corner to corner;
   *  real scans can be bigger, and a 7 m tube is still a good time). */
  maxLength: 7,
  /** THE PULL. The head chases the two-hand midpoint through a critically
   *  damped spring — the lag is the WEIGHT. Stiffness falls as the tube
   *  gets longer (more metal in your hands), which reads as mass without
   *  any physics engine. */
  followStiffness: 14,
  followStiffnessFar: 7.5,
  /** Both hands must be inside this reach of the collar to TAKE it.
   *  Generous: the fantasy is hauling plant, not threading a needle.
   *  Acquisition only — a held collar never re-tests reach (the head
   *  deliberately LAGS the hands; measuring your grip against your own
   *  weight illusion is how a fast haul used to drop itself). */
  // (Plant metres — ×0.7 in the room, so this is TUBES' own 0.3 m.)
  grabReach: 0.43,
  /** Once held, the grab persists while both squeezes stay above this
   *  (analog, with the press as fallback) — a jostled grip mid-swing
   *  dips, it doesn't open. The only way to drop plant is to let go. */
  holdSqueeze: 0.3,
  /** BREAKING A SEAL. A seated tube is not welded to the box: take the
   *  collar in both hands and HAUL, and the gland lets go. Sheet 2 wants
   *  the amber line moved off the bank and onto the maker, and the only
   *  way out used to be deleting the bank — a fitter would just pull it.
   *
   *  It has to cost something, though, or a hand brushing past would
   *  unplumb a running factory. So it takes a real tug: both hands, and
   *  the collar dragged this far off the gland, held for `unseatHoldS`
   *  while the joint audibly strains. Let go early and it re-seats. */
  unseatPull: 0.36,
  unseatHoldS: 0.45,
  /** One hand alone can't haul it — but it can RATTLE it. The shake
   *  amplitude and the cooldown between rattle clanks. */
  rattleAmp: 0.012,
  rattleCooldownS: 0.4,
  /** A detent clicks every time this much tube emerges (or returns). The
   *  ratchet is most of what "it extends!" feels like in the hands. */
  detentPitch: 0.34,
  /** Released mid-carry, the free end DROOPS — a damped settle onto a
   *  slight sag, held by the wall. Sag per metre of extension, capped. */
  droopPerMetre: 0.055,
  droopMax: 0.2,
  droopSettleS: 0.7,
  /** The root flex: the tube leaves the wall along its normal and bows
   *  toward your hands. Control-point reach as a fraction of extension —
   *  small numbers keep it reading as heavy pipe, not garden hose. */
  bendReach: 0.32,
  bendReachMax: 0.85,
  /** THE STEER. Held with both hands, the collar AIMS: the controllers'
   *  pointing direction blends into the head's travel, so tipping your
   *  wrists bows the run where you're looking instead of only where
   *  you're standing. 0 = the old straight chord, 1 = pure wrist. */
  steerBlend: 0.6,
  /** The end control reaches further while you're steering, so the bow
   *  you're asking for is a bow you can see. */
  steerReach: 1.2,
  /** How far each section's pour volume tucks back through its joint
   *  into the fatter section behind it. This is what makes the column
   *  read as ONE pour stepping down in bore, not eight lit cells: the
   *  overlap swallows the seam, the bend wedge, and the collar's shadow
   *  in a single move. */
  pourOverlap: 0.1,
  /** And how far the LAST section's volume runs on past the head, into
   *  the socket it has landed in. A feed that stops dead at the collar
   *  shows the flat face of its own liquid at the joint; a feed that
   *  runs a few centimetres into the throat simply arrives, and the
   *  bore hides the end. Short of every socket's iris (the factory's
   *  gland sits 0.075 deep, the wall's 0.055) so it never pokes out the
   *  far side of a box. */
  pourSeatReach: 0.04,
  /** THE DODGE WINDOW. A seated run that has to give way (to plant, or
   *  to another run) bows its belly, and the bow used to start rising
   *  the moment the tube left its fitting — so a big lift tipped the
   *  last section 20–40° off the socket's axis and the pipe read as
   *  having JUMPED OUT of its seat. The bump now stays exactly zero for
   *  this fraction of the run at EACH end — one section, at eight — so
   *  the section in the fitting is always on the fitting's axis and
   *  the whole lift is spent over the middle. */
  dodgeEnd: 0.125,
  /** And a lift never snaps: when the clearance pass re-solves (a new
   *  line seats, a box lands under a run, a collar is tugged loose) the
   *  drawn offset EASES to the new answer at this rate (1/s). */
  dodgeEase: 6,
};

/* ────────────────────────────── THE SEAT ─────────────────────────────────
 * The socket answers a tube that comes CLOSE ENOUGH, POINTED ROUGHLY IN.
 * Inside the window the guide brightens and a magnet takes over — the head
 * eases onto the seat pose, the hands feel the pull-in, and the moment it
 * bottoms the latch dogs slam. Forgiveness is the design: every number
 * here is a doorway, not a keyhole.
 */
export const SEAT = {
  /** The magnet's catch radius around the socket mouth. */
  snapRadius: 0.32,
  /** How square the tube must arrive: dot(tube direction, into-socket).
   *  0.35 ≈ within ~70° — offer it up ANYWHERE near square and the
   *  socket does the last of the aiming for you. */
  alignDot: 0.35,
  /** The magnet's ease-in time once it takes. */
  magnetS: 0.16,
  /** Seat travel: the last shove, eased over this long, then the dogs. */
  seatS: 0.24,
  /** A seated head is DONE — the run locks, hands come away clean. */
};

/* ────────────────────────────── THE WAKE ─────────────────────────────────
 * The beat between mounting a flange and the room answering. Fixed
 * theatre, always the same shape: the bolts bite, something KNOCKS from
 * inside another wall, and the socket irises awake where the knock came
 * from. Short enough to never wait through twice grudgingly.
 */
export const WAKE = {
  /** Knock-knock from behind the chosen wall (s after mount). */
  knockAt: 0.35,
  /** The socket stamps itself and irises open. */
  socketAt: 1.0,
  /** The run hands over to the pull. */
  doneAt: 1.55,
};

/* ────────────────────────────── THE FLOW ─────────────────────────────────
 * The payoff. On latch, the line charges for a breath, then the front
 * races the run from flange to socket and the tube is ALIVE — a living
 * pour riding inside frosted metal, pulsing at the line's own pace. At
 * the far end: the bloom, the shaft of light into the room, and the hum
 * settling in for good.
 */
export const FLOW = {
  /** The held breath between latch and pour. Anticipation is cheap. */
  chargeS: 0.55,
  /** The advancing front's hot band length (m). */
  frontBand: 0.55,
  /** The arrival bloom: glint burst count and its life. */
  bloomCount: 90,
  bloomLifeS: 1.6,
  /** The sun shaft leaning out of a connected socket: length and radius
   *  at the wide end. Passthrough loves a light that isn't there. */
  shaftLength: 1.9,
  shaftRadius: 0.5,
  /** Dust motes drifting in the shaft — the part that sells "sunlight". */
  moteCount: 46,
};

/* ────────────────────────────── THE LINES ────────────────────────────────
 * Three services run through THE WORKS, and every piece of hardware wears
 * its line head to toe — metalwork, light, pour and voice. A socket only
 * takes its own line; the collar's colour tells you which wall it wants.
 *
 *  MAINS   — the old plant. Cast iron, hex bolts, furnace-amber glow.
 *            The pour is slow and heavy; the hum is a boiler two rooms
 *            over; the seat is a steam hiss off hot metal.
 *  COOLANT — the retrofit. Brushed alloy, sleek rings, glacier cyan.
 *            Fast bright pour, airy hum, hydraulic sighs.
 *  VOLT    — the future bolted onto both. Dark glass, coil rings,
 *            violet plasma that travels in pulses and BITES when it
 *            lands. Crackle, arc, zap.
 */
/** Every service the works runs. The first three are the trade; PEARL is
 *  the fourth manifold — bolted shut for the whole book, and GREEN when
 *  it finally cracks (see THE GOOP, the last sheet). */
export type LineId = 'mains' | 'coolant' | 'volt' | 'pearl';
/** The three lines a MAKER can drink: the ones that stamp parts. PEARL
 *  makes nothing — it pours the goop, and only the VAT takes it. */
export type CoreLineId = 'mains' | 'coolant' | 'volt';

export interface LineSpec {
  id: LineId;
  name: string;
  /** UI + text accents. */
  hex: string;
  /** The pour: lit body, shadowed depths, hot front/meniscus. */
  glow: number;
  deep: number;
  foam: number;
  /** Metalwork: shell tint, roughness, metalness — the vibe in PBR. */
  shell: number;
  roughness: number;
  metalness: number;
  /** Pour speed (m/s) and the living pulse once connected (Hz). */
  flowSpeed: number;
  pulseHz: number;
  /** VOLT's strobing front: 0 = smooth liquid, 1 = full plasma chop. */
  chop: number;
}

export const LINES: Record<LineId, LineSpec> = {
  mains: {
    id: 'mains',
    name: 'MAINS',
    hex: '#ffa22e',
    glow: 0xffa22e,
    deep: 0x571f02,
    foam: 0xffe9c4,
    shell: 0x4a4038,
    roughness: 0.52,
    metalness: 0.82,
    flowSpeed: 2.3,
    pulseHz: 0.5,
    chop: 0,
  },
  coolant: {
    id: 'coolant',
    name: 'COOLANT',
    hex: '#46e0ff',
    glow: 0x46e0ff,
    deep: 0x043346,
    foam: 0xdcf8ff,
    shell: 0x5a6670,
    roughness: 0.28,
    metalness: 0.9,
    flowSpeed: 4.2,
    pulseHz: 0.9,
    chop: 0,
  },
  volt: {
    id: 'volt',
    name: 'VOLT',
    hex: '#b46bff',
    glow: 0xb46bff,
    deep: 0x2a0b4e,
    foam: 0xefe0ff,
    shell: 0x2d2a38,
    roughness: 0.38,
    metalness: 0.72,
    flowSpeed: 5.4,
    pulseHz: 2.2,
    chop: 0.85,
  },
  /** PEARL — the fourth manifold. It sleeps behind a shut iris for the
   *  whole book, wearing nothing but a name, and the first thing anybody
   *  ever sees of it is the moment it opens: not amber, not cyan, not
   *  violet, but GREEN — and what pours out of it is alive. The slowest
   *  pour in the game on purpose: you watch this one arrive. */
  pearl: {
    id: 'pearl',
    name: 'PEARL',
    hex: '#4dff9b',
    glow: 0x4dff9b,
    deep: 0x02361d,
    foam: 0xdaffe9,
    shell: 0x2f3a33,
    roughness: 0.34,
    metalness: 0.6,
    flowSpeed: 1.5,
    pulseHz: 0.32,
    chop: 0,
  },
};

/* ────────────────────────────── THE JOBS ─────────────────────────────────
 * The shift sheet: five authored jobs, one honest difficulty. The ladder
 * teaches by doing — one run, then a longer one, then two lines at once,
 * then two lines that want to cross your room, then all three services
 * and the room celebrates. Nothing here is random except WHERE the room
 * puts the hardware; what you owe each job never changes.
 *
 *  runs      — the lines this job wants connected, in the order their
 *              flange holograms are handed to you.
 *  longHaul  — bias the socket toward the farthest legal wall, so the
 *              run has to cross the room instead of hugging a corner.
 */
export interface JobSpec {
  id: string;
  name: string;
  brief: string;
  runs: CoreLineId[];
  longHaul?: boolean;
  /**
   * ONE LINE OF COACHING, in the room, while a flange wants placing.
   * Playtest lost the first flange: the board says "trigger to mount"
   * and then goes away, the beam only draws once it is already ON a
   * wall, and the only words left are behind Ⓐ — which a first-time
   * player does not know to press. So the first sheet speaks once, low
   * and ahead, until the mount lands. Later sheets stay silent: by then
   * the flange on the ray is the cue.
   */
  coach?: string;
}

export const JOBS: JobSpec[] = [
  {
    id: 'first-light',
    name: 'FIRST LIGHT',
    brief: 'Connect MAINS. Trigger to mount a flange; use both grips to haul the tube to its matching socket.',
    runs: ['mains'],
    coach: 'Aim your right hand at a wall. Pull the trigger to mount the flange.',
  },
  {
    id: 'crosstown',
    name: 'CROSSTOWN',
    brief: 'Connect MAINS across the room. Carry the tube to the amber socket with both grips.',
    runs: ['mains'],
    longHaul: true,
  },
  {
    id: 'two-hander',
    name: 'TWO-HANDER',
    brief: 'Connect MAINS, then COOLANT. Match each tube to its own socket.',
    runs: ['mains', 'coolant'],
  },
  {
    id: 'hot-and-cold',
    name: 'HOT AND COLD',
    brief: 'Connect MAINS and COOLANT across the room. Steer the second tube around the first.',
    runs: ['coolant', 'mains'],
    longHaul: true,
  },
  {
    id: 'full-pressure',
    name: 'FULL PRESSURE',
    brief: 'Connect MAINS, COOLANT and VOLT. Finish all three lines.',
    runs: ['mains', 'coolant', 'volt'],
    longHaul: true,
  },
];

/** Target placement: how far a socket may wake from its flange. */
export const RUN_RANGE = {
  min: 1.15,
  max: 6.4,
};

/* ────────────────────────────── THE PORTS ────────────────────────────────
 * Exit ports don't only live on walls: the scan's floor and ceiling are
 * registry citizens too, and sometimes the room answers from one — a
 * socket irising awake OVER your head, or under your feet. Flanges stay
 * wall-mounted (the thing YOU place is the thing you were taught); it's
 * the room's half of the run that gets adventurous.
 */
export const PORTS = {
  /** The seeded roll: this often, the picker TRIES overhead/underfoot
   *  first and takes the best legal flat spot it finds — its own lane,
   *  because on a distance-flavoured score a flat can never outbid a
   *  wall (the seat's alignment cone caps flat runs SHORT by geometry,
   *  which is also why a ceiling answer feels like an event: it's
   *  always close, always steep, always a reach). No legal flat spot —
   *  a mount too high for the ceiling's cone, a floor swallowed by the
   *  avoid circle — and the walls answer as ever. */
  flatChance: 0.3,
  /** Candidate samples per horizontal surface (walls get 14). */
  horizontalSamples: 10,
  /** A floor port never wakes under the player's feet. */
  floorAvoidRadius: 0.9,
  /**
   * THE REACH LAW, and it is the ceiling's whole problem. A wall port is
   * clamped into the mount band (WALLS.maxHeight) because that is where
   * hands can work; a ceiling had no such clamp, so a socket could wake
   * at 2.7 m — visible, promised by the knock, and impossible to carry
   * the collar to. The job simply could not be finished.
   *
   * So no port wakes higher than the player's OWN eye line plus this:
   * both hands raised, plus most of the magnet's snap radius, which is
   * how high a two-hand haul can honestly present a collar. It is
   * measured per player, so a tall fitter gets the reach they have. An
   * ordinary ceiling (2.4 m and up) therefore stops answering, which is
   * correct; a low one — a basement, a loft, a garage — still takes its
   * turn, and that is when overhead ports were ever any fun.
   */
  overheadReach: 0.72,
};

/* ────────────────────────────── THE FLOOR ────────────────────────────────
 * PIECEWORK groundwork (FACTORY.md, phase 0). Before the shop can stand,
 * you mark out the floor: a rectangle of HAZARD TAPE strung post to post
 * on your real floor, each side draggable to your real walls — SLUGFEST's
 * ring verb wearing site clothing. Reach toward a side, hold the trigger,
 * slide it along its own normal; one side at a time; clamps keep the
 * floor a floor; the layout saves per headset.
 */
export const FLOOR = {
  /** The floor stays workable: sides can't close inside this. */
  minWidth: 1.8,
  minDepth: 1.8,
  /** Hard cap on any side's coordinate — even a warehouse scan doesn't
   *  get a tape run the pull can't service. */
  maxSide: 7,
  /** Default sides stand this far inside the registry's walls. */
  inset: 0.25,
  /** Dragging a side inside this reach of a parallel wall SNAPS it… */
  snapDist: 0.2,
  /** …to just off the plaster (tape touches walls in no workshop). */
  snapGap: 0.04,
  /** How close a hand must be to a side to take it. */
  grabReach: 0.65,
  /** Sides refuse to cross standing plant by this margin — re-planning
   *  the floor can never orphan a crate outside the boundary. */
  plantPad: 0.15,
  /** The tape itself: barricade height and band width. */
  tapeHeight: 0.72,
  tapeWidth: 0.07,
  /** One amber+black stripe cycle per this many metres of tape. */
  stripePeriod: 0.24,
  /** Corner posts stand at bench height — the shop's one datum. */
  postHeight: 0.85,
  /** No walls yet (grace still counting) — a starter floor this big
   *  stands around the player, ready to drag out. */
  fallback: { w: 3.6, d: 2.8 },
  /** The build lattice: world-anchored cells this wide. Anchored to the
   *  WORLD, not the rectangle, so dragging a side never re-deals the
   *  cells under standing plant. */
  cell: 0.35,
};

/* ────────────────────────────── THE UNITS ────────────────────────────────
 * The shop's plant, one grid cell each, and ALL of it bench height on
 * principle: a room-scale factory on the actual floor is a crouching
 * simulator, so the whole shop lives in the mount band. The CRATE from
 * phase 0 grew up into the CHEST; the rest arrived with the orders.
 */
export const UNITS = {
  crate: {
    /** Footprint (m) — sits inside one grid cell with clearance. */
    size: 0.3,
    /** The box itself; its top lands on the bench datum. */
    height: 0.3,
    benchTop: 0.85,
    legRadius: 0.018,
  },
  /** Rails ride a touch under the bench so parts sit AT the datum. */
  railTop: 0.8,
  /** THE BRIDGE — how high a crossing lane's deck arches over the rail
   *  it crosses. Enough for a part to visibly clear the traffic under
   *  it; low enough that the hop still reads as the same lane. */
  bridgeRise: 0.13,
  /** THE PULL. A rail is not stamped a cell at a time — you stand one
   *  and HAUL, and the run ratchets out of it exactly like a tube comes
   *  out of a wall. These are the stops on that haul. */
  pull: {
    /** How many rails one haul may lay. Long enough to cross the floor,
     *  short enough that a sweep of the arm can't carpet it. */
    maxRun: 14,
    /** A POST is a stick you stand to say "go through here". A haul
     *  visits every post between where it started and where you are
     *  pointing, in order, instead of taking the direct line — and the
     *  rail takes the post's place as it passes. Bought once (SUPPLY),
     *  then free to plant, like every other piece. */
    postRadius: 0.016,
    postHeight: 0.62,
    /** How far off the direct line a stick may sit and still catch the
     *  haul, in cells. It HAS to be more than zero: the whole point of a
     *  stick is bending a lane off the straight, and a straight drag's
     *  bounding box is a line with no width — nothing could ever be
     *  inside it. Two cells is forgiving enough to plant a stick where
     *  you want the bow, tight enough that one across the room doesn't
     *  come and hijack a lane you were laying somewhere else. */
    postReach: 2,
  },
  /** Where a unit's tube gland sits (m up its body), facing LEVEL.
   *  An angled-up mount high on the drum was tried here — "connect to
   *  the top of the boxes" — and reverted on sight: the tilted collar
   *  read as garbage against the level plate language everything else
   *  speaks. The clipping it existed to prevent is the CLEARANCE PASS's
   *  job instead (FactorySystem.recomputeDodges): a seated line arcs its
   *  belly over whatever stands under its flight path — plant and other
   *  tubes alike — and comes down level into the side collar that
   *  always looked right. */
  glandHeight: 0.7,
  /** THE VAT — the last machine in the book, and the only one that isn't
   *  shop plant: a squat green-glass tank the fourth manifold pours into.
   *  Taller and wider than anything else on the floor, because what comes
   *  out of it has to have been IN there. */
  vat: {
    size: 0.34,
    height: 0.62,
    /** The tank's inside floor (m up) — where the level starts and where
     *  the goop first forms. GoopSystem needs it as badly as the builder
     *  does, so it lives here rather than as a local in either. */
    tankFloor: 0.39,
    /** Seconds of PEARL pouring in before the goop is done. */
    brewS: 14,
  },
  /** THE BOLT — the head diameter of the hex bolts studded round every
   *  chassis. Small, and there are dozens: bolts are what make a box read
   *  as fabricated rather than modelled. */
  boltR: 0.011,
};

/* ────────────────────────────── THE FACTORY ──────────────────────────────
 * PIECEWORK phases 1–2 (FACTORY.md): the feeds, the sim, the orders.
 * Rates follow the tuning law — a naive single chain finishes a sheet in
 * minutes, a parallel floor in under one; waiting is legal, building is
 * better.
 */
export const FACTORY = {
  /** After a line is hauled off a gland, that gland ignores it for this
   *  long — the head is right beside the box you just freed it from, so
   *  without a pause the magnet undoes the tug before you can step away. */
  spurnS: 2.5,
  /** Which line each side's FEED carries. `near` holds PEARL — a fourth
   *  manifold kept visibly in reserve (the expansion hook; it never
   *  wakes in these sheets). */
  sides: {
    far: 'mains',
    left: 'coolant',
    right: 'volt',
    near: 'pearl',
  } as Record<'far' | 'left' | 'right' | 'near', LineId>,
  /** The spout: where the stub waits on the pillar (m up). */
  spoutHeight: 1.05,
  /** Craft times. Makers drink and stamp; combiners fit two parts. */
  // FACTORY FIGHT runs the shop hotter than TUBES did (4 s and 6 s): one
  // tube per feed is the whole supply, and it has to arm a war.
  makerS: 2.6,
  combinerS: 4,
  /** Rails: part speed along a chain, and a chute's queue depth. */
  railSpeed: 0.35,
  chuteSlots: 2,
  /** How many cells a hauled rail run may detour around standing plant
   *  before it gives up and stops short. Generous — a lane that refuses
   *  to go round a box is the bug this number exists to kill. */
  routeBudget: 900,
  chestCap: 12,
  /** An unbolted supply run telescopes home over this long. */
  retractS: 0.5,
  /** The gland's catch radius. Wider than a wall socket's (SEAT.snapRadius)
   *  because a bench gland is a SWIVEL — it turns to meet the tube — so
   *  the only thing left to ask of the player is "get it near", and we
   *  ask that generously. */
  seatRadius: 0.42,
  /** THE SEAL — how far off a gland's face the collar seats. The gland's
   *  rim ring stands 0.1 off its face and the collar's own stock is
   *  ~13 mm, so this lands the collar PRESSED against the rim from the
   *  outside, cap just inside the mouth: a clamped joint. (It sat at
   *  0.08 — 20 mm BEHIND the rim — so the collar clipped through the
   *  throat wall and the joint read as three rings in an argument.) */
  glandSeat: 0.105,
  /** Hand-carry: how close a grip must be to take a loose part, and how
   *  close a drop must be to a hopper/port/chest to land IN it. */
  // Plant metres, so a hand reaches as far in the room as it did in TUBES.
  partReach: 0.48,
  dropReach: 0.5,
};

/* ────────────────────────────── THE ITEMS ────────────────────────────────
 * Colour → part, part + part → deeper part. Every item wears its
 * lineage's plate language (eight-sided iron / smooth alloy / hex glass),
 * so a composite part visibly CONTAINS its ingredients and a target on
 * the sheet is reverse-engineerable by looking at it.
 */
export type ItemId = 'gear' | 'cell' | 'chip' | 'pump' | 'lamp' | 'servo';

export interface ItemSpec {
  id: ItemId;
  name: string;
  tier: 1 | 2 | 3;
  /** The lines whose look this part carries (first = the body). */
  lineage: CoreLineId[];
  /** One-line recipe shown on the goal card. */
  docket: string;
}

export const ITEMS: Record<ItemId, ItemSpec> = {
  gear: {
    id: 'gear',
    name: 'GEAR',
    tier: 1,
    lineage: ['mains'],
    docket: 'MAINS + MAKER → GEAR',
  },
  cell: {
    id: 'cell',
    name: 'CELL',
    tier: 1,
    lineage: ['coolant'],
    docket: 'COOLANT + MAKER → CELL',
  },
  chip: {
    id: 'chip',
    name: 'CHIP',
    tier: 1,
    lineage: ['volt'],
    docket: 'VOLT + MAKER → CHIP',
  },
  pump: {
    id: 'pump',
    name: 'PUMP',
    tier: 2,
    lineage: ['mains', 'coolant'],
    docket: 'GEAR + CELL → PUMP',
  },
  lamp: {
    id: 'lamp',
    name: 'LAMP',
    tier: 2,
    lineage: ['coolant', 'volt'],
    docket: 'CELL + CHIP → LAMP',
  },
  servo: {
    id: 'servo',
    name: 'SERVO',
    // THE LAST ITEM IS THE DEEP ONE. A servo used to be a gear and a chip
    // — one combine, same as everything else — which made the sheet that
    // opens the fourth gate no harder than the sheet before it. It is a
    // PUMP and a LAMP fitted together now: every base part on the floor,
    // through three combines, into one bolt. The only tier-3 in the book,
    // and the gate is bolted with them for exactly that reason.
    tier: 3,
    lineage: ['mains', 'coolant', 'volt'],
    docket: 'PUMP + LAMP → SERVO',
  },
};

/** The maker's law: feed it a colour, get the colour's base part. PEARL
 *  is absent on purpose — a maker handed the fourth manifold just stands
 *  there dripping. Only the VAT knows what to do with that. */
export const MAKES: Partial<Record<LineId, ItemId>> = {
  mains: 'gear',
  coolant: 'cell',
  volt: 'chip',
};

/** The combiner's law: two DIFFERENT parts, alphabetical key. Tier-1
 *  pairs make the tier-2s — and the two tier-2s make the SERVO, the one
 *  fitting deep enough to crank the fourth gate. */
export const COMBINES: Record<string, ItemId> = {
  'cell+gear': 'pump',
  'cell+chip': 'lamp',
  'lamp+pump': 'servo',
};

export function combineKey(a: ItemId, b: ItemId): string {
  return [a, b].sort().join('+');
}

/* ─────────────────────────────── THE BILLS ───────────────────────────────
 * What the bank is FOR (FACTORY.md, the economy): upgrades are BILLS OF
 * BANKED PARTS, exactly like milestones — no abstract currency, ever.
 * Overproducing a SPECIFIC item is a decision, and old lines stay alive
 * because their product stays spendable. Bought fittings persist with
 * the trade (localStorage) and apply the moment the bill is paid.
 * (The SECOND SPOUT — the big physical one, with its colour dial — is
 * the next fitting on this list.)
 */
export type UpgradeId =
  | 'long-reach'
  | 'belt-pace'
  | 'quick-boxes'
  | 'deep-crates'
  | 'route-posts'
  | 'thick-plate'
  | 'long-barrels'
  | 'core-armour'
  | 'rapid-breech';

export interface UpgradeSpec {
  id: UpgradeId;
  name: string;
  /** What it does, in the card's one line. */
  effect: string;
  bill: Partial<Record<ItemId, number>>;
}

export const UPGRADES: UpgradeSpec[] = [

  {
    id: 'belt-pace',
    name: 'BELT PACE',
    effect: 'Rail speed +25%',
    bill: { gear: 8, cell: 6 },
  },
  {
    id: 'quick-boxes',
    name: 'QUICK BOXES',
    effect: 'Crafting time −25%',
    bill: { cell: 8, pump: 4 },
  },

  {
    // The one fitting that changes a VERB rather than a number: a haul
    // goes direct until you give it somewhere to go through.
    id: 'route-posts',
    name: 'ROUTING POSTS',
    effect: 'Unlock posts to guide rail routes',
    // GEAR ONLY, and early. This is the first fitting anyone actually
    // wants — it shapes the very first lane you pull — so it is priced
    // in the part the very first lane makes. A routing aid you cannot
    // afford until the book runs out is a routing aid nobody ever uses.
    bill: { gear: 10 },
  },
  // THE SIEGE'S FITTINGS. Bought out of the same bank the walls come out
  // of — so every one is a wave fought with fewer walls — and kept for
  // good, so a siege lost is never a siege wasted.
  {
    id: 'thick-plate',
    name: 'THICK PLATE',
    effect: 'Walls take twice the chewing',
    bill: { gear: 12, cell: 4 },
  },
  {
    id: 'long-barrels',
    name: 'LONG BARRELS',
    effect: 'Turret range +25%',
    bill: { gear: 10, chip: 6 },
  },
  {
    id: 'rapid-breech',
    name: 'RAPID BREECH',
    effect: 'Turrets fire a third faster',
    bill: { cell: 8, pump: 3 },
  },
  {
    id: 'core-armour',
    name: 'CORE ARMOUR',
    effect: 'Core hit points +50%',
    bill: { gear: 16, lamp: 2 },
  },
];

/* ────────────────────────────── THE BOOK ─────────────────────────────────
 * ONE SHIFT, ONE BOOK. There used to be five sheets on the board and you
 * could START any of them — which meant starting sheet four on an empty
 * floor with no feeds awake, no rails, no gears and nothing to do about
 * any of it. Every entry but the first was a trap. So the board offers
 * exactly one door now (OPEN THE FACTORY) and the book advances INSIDE
 * the shift: fill a sheet and the next is posted onto the same floor,
 * with the plant you already built still standing.
 *
 * The ladder teaches one verb at a time, in the order a shop actually
 * grows:
 *
 *   1  a MAKER and a tube            — the works makes a thing
 *   2  a BANK and a rail             — the thing goes somewhere
 *   3  a second line                 — two chains at once
 *   4  the COMBINER                  — two chains become one
 *   5  VOLT and the CHEST            — depth, and somewhere to put it
 *   6  SERVOS for the fourth gate    — the machine that opens the last door
 *   7  the VAT, and THE GOOP         — the fourth manifold, and what lives in it
 */
export type UnitType =
  | 'dock'
  | 'maker'
  | 'belt'
  | 'combiner'
  | 'chest'
  | 'post'
  | 'vat'
  /** FACTORY FIGHT's two pieces of plant: the gun and the wall. */
  | 'turret'
  | 'wall'
  /** THE ARSENAL beyond the first gun. */
  | 'mortar'
  | 'tesla'
  | 'flamer'
  | 'piston';

/** What a sheet counts.
 *   craft — parts STAMPED anywhere on the floor (no bank needed: this is
 *           how sheet 1 can be about the maker and nothing else)
 *   item  — parts DELIVERED into the bank
 *   brew  — the vat's one and only output, and the end of the book */
export type OrderTarget =
  | { kind: 'craft'; item: ItemId }
  | { kind: 'item'; item: ItemId }
  | { kind: 'brew' };

export interface OrderSpec {
  id: string;
  name: string;
  brief: string;
  target: OrderTarget;
  goal: number;
  /** The GOALS page's deeper read: what this actually asks of you. */
  steps: string[];
  /** What this sheet switches on the morning it's posted. */
  wakes: { feeds?: LineId[]; units?: UnitType[] };
}

/** THE BOOK IS GONE. TUBES' seven sheets (first gear → the goop) were
 *  thrown out whole when the shop learned to fight: FACTORY FIGHT's
 *  ladder is THE SIEGE (below), and what a shift asks of you is to still
 *  be standing. The type survives because the shop's plumbing still
 *  speaks it; the book itself is empty and stays empty. */
export const ORDERS: OrderSpec[] = [];

/* ────────────────────────────── THE BOARD ────────────────────────────────
 * The menu is a work board: quiet glass, hairlines, one furnace-amber
 * accent that only marks what matters (see ui/panel.ts for the whole
 * discipline). It floats at spawn, hides for the shift, and the right
 * controller's Ⓐ raises the JOB CARD mid-shift the way a fitter checks
 * the sheet — the shift never stops for it.
 */
export const BOARD = {
  widthM: 1.3,
  heightM: 0.86,
  pxW: 1360,
  pxH: 900,
  /** Where the board stands relative to spawn (m, forward is −Z). */
  position: [0, 1.32, -1.35] as [number, number, number],
  /** The shift card (pause) — dead ahead, below the eye line. Sized to
   *  the BOOK, which is the page that needs the most room: the ladder,
   *  or one sheet opened up with its docket and every step. Playtest
   *  found text sitting on other text, and the honest fix was a bigger
   *  card, not smaller type — you read this at a metre, in passthrough.
   *  Kept at 1000 px/m so every font size below is still true. */
  cardW: 0.78,
  cardH: 0.72,
  cardPx: [780, 720] as [number, number],
  cardPosition: [0, 1.24, -1.0] as [number, number, number],
  /** THE BOX PANEL — click any standing plant and this opens beside your
   *  face: what is in it, what is plumbed into it, and the two verbs
   *  (UNPLUG, TAKE IT OUT) that used to have no home at all. Smaller
   *  than the shift card: it answers one question about one box. */
  boxW: 0.56,
  boxH: 0.5,
  boxPx: [560, 500] as [number, number],
  boxPosition: [0, 1.26, -0.86] as [number, number, number],
  /** THE COACH LINE — one sentence, low and ahead, while the first
   *  sheet's flange wants placing (JobSpec.coach). Below the eye line
   *  and short of the card's spot, so it never sits where a hand aims. */
  coachW: 0.64,
  coachH: 0.2,
  coachPx: [640, 200] as [number, number],
  coachPosition: [0, 1.0, -0.9] as [number, number, number],
};

/** The celebration when a job's last run lands: how long the room gets to
 *  glow before the board comes back with the sheet stamped. */
export const CEREMONY_S = 4.2;

/* ══════════════════════════════ THE SIEGE ════════════════════════════════
 * FACTORY FIGHT. THE WORKS is lit, and it turns out it was never alone
 * behind your walls: something else lives in there, and it has noticed
 * the hum. Between waves you build — haul tubes into makers, rail the
 * parts — and when the horn goes, things KNOCK, the plaster cracks, and
 * they come out of the wall at your CORE.
 *
 * The factory is how you fight. A TURRET is a sink on a rail like the
 * bank is: what you feed it is what it fires, and every part fires its
 * own way. A WALL is a cheap, thick cell they have to chew through. Both
 * cost banked parts, so the core is the hub: lanes into it pay for the
 * defence, and lanes out of it (a rail pointing AWAY from the core pulls)
 * feed the guns.
 *
 * Every distance below is in PLANT metres (factory/frame.ts — ×0.7 to
 * the room). Times are seconds.
 */

/**
 * THE HORDE. Three kinds, one body: a neon-legged mite, drawn thousands at
 * a time in a single draw call (systems/swarm.ts). They differ in size,
 * colour, and how much it takes to put them down — the MITE is the tide,
 * the BEETLE the stiffening in it, the HULK the thing it is carrying.
 */
export type EnemyId = 'mite' | 'beetle' | 'hulk';

export interface EnemySpec {
  id: EnemyId;
  name: string;
  hp: number;
  /** Plant metres per second, flat out. */
  speed: number;
  /** One bite: damage dealt, and seconds between bites. */
  bite: number;
  biteS: number;
  /** Body radius — the hit circle, the crowd spacing, the mesh's scale. */
  radius: number;
  /** How far a piston's punch throws it (1 = all the way). */
  give: number;
  /** GEARS banked per kill — fractional; the core keeps the change, so
   *  every twenty-odd mites killed is a gear. The swarm pays for the
   *  guns that kill it. */
  scrap: number;
  /** Whole parts dropped into the bank when it dies. */
  bounty: Partial<Record<ItemId, number>>;
  /** Its neon. */
  neon: number;
  /** The one line on the WAVES page. */
  docket: string;
}

export const ENEMIES: Record<EnemyId, EnemySpec> = {
  mite: {
    id: 'mite',
    name: 'MITE',
    hp: 6,
    speed: 0.5,
    bite: 1,
    biteS: 0.8,
    radius: 0.05,
    give: 1,
    scrap: 0.05,
    bounty: {},
    neon: 0xff2bd6,
    docket: 'The tide. One hit each, and there are thousands.',
  },
  beetle: {
    id: 'beetle',
    name: 'BEETLE',
    hp: 45,
    speed: 0.3,
    bite: 4,
    biteS: 0.9,
    radius: 0.085,
    give: 0.6,
    scrap: 0.35,
    bounty: {},
    neon: 0xb8ff2b,
    docket: 'Shell on it. Shrugs off a slug and chews through rail.',
  },
  hulk: {
    id: 'hulk',
    name: 'HULK',
    hp: 900,
    speed: 0.14,
    bite: 30,
    biteS: 1.3,
    radius: 0.2,
    give: 0.2,
    scrap: 0,
    bounty: { gear: 6, cell: 2 },
    neon: 0xff6a2a,
    docket: 'Plate and fury, walking in the middle of the tide.',
  },
};

/** The kinds, in the order the horde indexes them. */
export const HORDE_KINDS: EnemyId[] = ['mite', 'beetle', 'hulk'];

/* ── THE ARSENAL ───────────────────────────────────────────────────────────
 * Weapons COST parts to build and fire for FREE. The factory's job is to
 * fill the core's bank; the bank buys guns, and guns never run dry. Two
 * of them burn fuel instead — the FLAMETHROWER and the TESLA COIL only
 * fire while a feed's tube is seated in them (their fuel is free too,
 * but it has to be PLUMBED, which is what a factory is for).
 */
export type WeaponId = 'turret' | 'mortar' | 'tesla' | 'flamer' | 'piston';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  /** The catalogue's one line. */
  docket: string;
  /** Reach (plant m), and a dead zone a lobbed shell can't drop into. */
  range: number;
  minRange?: number;
  /** Seconds between shots (the flamer ticks at this rate). */
  cycleS: number;
  damage: number;
  /** Splash radius for shells; cone half-angle (rad) for the flamer. */
  splash?: number;
  cone?: number;
  /** Shot flight speed (m/s); shells lob at this. */
  speed?: number;
  /** ARC: how many more it jumps to, and how far each jump reaches. */
  chain?: number;
  chainReach?: number;
  /** FIRE: damage per second while burning, and for how long; and a
   *  patch of burning floor left where the flame lands. */
  burn?: { dps: number; s: number };
  /** PUNCH: how far a hit is thrown back (plant m), and stunned for. */
  knock?: number;
  stunS?: number;
  /** Must have this line's tube seated and pouring to fire. */
  fuel?: LineId;
  /** The colour it fires in. */
  color: number;
  /** Muzzle height (plant m). */
  muzzleY: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  turret: {
    id: 'turret',
    name: 'TURRET',
    docket: 'Rapid kinetic rounds at one target. Never runs dry.',
    range: 2.1,
    cycleS: 0.14,
    damage: 8,
    speed: 10,
    color: 0xffb347,
    muzzleY: 1.02,
  },
  flamer: {
    id: 'flamer',
    name: 'FLAMETHROWER',
    docket: 'A cone of fire that sets crawlers burning and the floor alight. Drinks the amber feed.',
    range: 1.15,
    cycleS: 0.1,
    damage: 2.4,
    cone: 0.5,
    burn: { dps: 7, s: 2.5 },
    fuel: 'mains',
    color: 0xff7a1a,
    muzzleY: 0.82,
  },
  piston: {
    id: 'piston',
    name: 'PISTON',
    docket: 'A hydraulic ram that shoves the whole front of the tide back the way it came.',
    range: 0.55,
    cycleS: 1.1,
    damage: 30,
    knock: 0.9,
    stunS: 0.6,
    cone: 0.75,
    color: 0xb8fff4,
    muzzleY: 0.5,
  },
  tesla: {
    id: 'tesla',
    name: 'TESLA COIL',
    docket: 'A bolt that jumps through ten of them at once. Drinks the violet feed.',
    range: 1.7,
    cycleS: 0.7,
    damage: 16,
    chain: 10,
    chainReach: 0.5,
    fuel: 'volt',
    color: 0xc79bff,
    muzzleY: 1.3,
  },
  mortar: {
    id: 'mortar',
    name: 'MORTAR',
    docket: 'Lobs shells over your walls into the crowd. Long reach, close blind spot.',
    range: 3.4,
    minRange: 0.7,
    cycleS: 2.3,
    damage: 60,
    splash: 0.7,
    speed: 2.4,
    color: 0xffd36a,
    muzzleY: 0.95,
  },
};

export const SIEGE = {
  /** The core's hit points — the whole game is keeping this above zero. */
  coreHp: 420,
  /** Plant hit points by kind. Walls are the thick ones on purpose; a
   *  rail is a snack. */
  hp: {
    dock: 420,
    maker: 70,
    belt: 18,
    combiner: 80,
    chest: 60,
    post: 5,
    vat: 80,
    turret: 90,
    wall: 120,
    mortar: 100,
    tesla: 80,
    flamer: 90,
    piston: 110,
  } as Record<UnitType, number>,
  /** Damaged plant knits itself back at this many hp/s once no bite has
   *  landed on it for repairDelayS — a wall that held is a wall again by
   *  the next wave, without a repair verb to learn. */
  repairPerS: 6,
  repairDelayS: 4,
  /** How fast a gun's head slews onto a target, radians per second. */
  slew: 7,
  /** What standing a defence costs, out of the bank. The factory itself
   *  is free (never charge for trying); the fight is not. Unbolting
   *  refunds the bill in full — a wrong wall is not a tax. */
  cost: {
    turret: { gear: 3 },
    wall: { gear: 1 },
    flamer: { gear: 5 },
    piston: { gear: 4, cell: 2 },
    tesla: { gear: 4, chip: 3 },
    mortar: { gear: 6, pump: 2 },
  } as Partial<Record<UnitType, Partial<Record<ItemId, number>>>>,
  /** The bank a siege opens with: enough for the first gun and a stub of
   *  wall, so the first build phase is about plumbing, not saving. */
  startBank: { gear: 5 } as Partial<Record<ItemId, number>>,
  /** How far from a breach's mouth (into the room) a spawned enemy
   *  steps before it starts pathing — it climbs OUT of the plaster. */
  emergeDepth: 0.22,
  /** The flow field's margin round the floor and the breaches, cells. */
  fieldPad: 3,
  /** A cell under standing plant costs this much extra to path through,
   *  plus hp/chewCost — so a long wall is walked round when there is a
   *  way round, and chewed through when there isn't. */
  chewBase: 6,
  chewPerHp: 0.08,
  /** Endless mode: after the ladder, each wave's spawns scale by this. */
  endlessGrowth: 1.15,
  /** THE CROWD: how hard overlapping crawlers shove apart (0..1 of the
   *  overlap per tick), and how many neighbours each one checks. */
  shove: 0.45,
  shoveMax: 8,
};

export interface WaveSpawn {
  enemy: EnemyId;
  count: number;
  /** Seconds between each of this group's arrivals (a stream: 0.05 is
   *  twenty a second pouring out of the plaster). */
  gap: number;
  /** Seconds into the wave this group starts. */
  at: number;
  /** Which of the wave's breaches it comes out of (index; wraps). */
  breach: number;
}

export interface WaveSpec {
  id: string;
  name: string;
  /** What this wave TEACHES — one line, on the card while you build. */
  tip: string;
  /** How many breaches the wall opens for this wave. */
  breaches: number;
  /** Seconds of build time BEFORE this wave (the horn calls it early). */
  buildS: number;
  spawns: WaveSpawn[];
  /** What this wave's build phase switches on (cumulative, like the
   *  book's wakes were: arriving at wave N grants everything before it). */
  wakes: { feeds?: LineId[]; units?: UnitType[] };
}

/** A stream: `count` of them at `perS` a second, from `at` seconds in. */
const s = (enemy: EnemyId, count: number, perS: number, at = 0, breach = 0): WaveSpawn => ({
  enemy,
  count,
  gap: 1 / perS,
  at,
  breach,
});

/**
 * THE LADDER. Every wave is a TIDE — hundreds at first, thousands by the
 * end — and every one adds a tool for killing them in bulk.
 */
export const WAVES: WaveSpec[] = [
  {
    id: 'first-watch',
    name: 'FIRST WATCH',
    tip: 'Haul amber into a MAKER, rail its GEARS to the CORE, spend them on TURRETS.',
    breaches: 1,
    buildS: 100,
    spawns: [s('mite', 50, 3), s('mite', 50, 6, 20)],
    wakes: { feeds: ['mains'], units: ['dock', 'maker', 'belt', 'turret'] },
  },
  {
    id: 'two-doors',
    name: 'TWO DOORS',
    tip: 'WALLS cost 1 GEAR. Funnel the tide past your guns.',
    breaches: 2,
    buildS: 55,
    spawns: [s('mite', 140, 8, 0, 0), s('mite', 140, 8, 4, 1)],
    wakes: { units: ['wall'] },
  },
  {
    id: 'hot-work',
    name: 'HOT WORK',
    tip: 'FLAMETHROWERS drink amber: haul the feed\'s second spout into one.',
    breaches: 2,
    buildS: 55,
    spawns: [s('mite', 260, 14, 0, 0), s('mite', 260, 14, 3, 1), s('beetle', 16, 1, 6, 0)],
    wakes: { feeds: ['coolant'], units: ['flamer'] },
  },
  {
    id: 'the-tide',
    name: 'THE TIDE',
    tip: 'PISTONS shove the front of the tide back into the flames.',
    breaches: 3,
    buildS: 50,
    spawns: [
      s('mite', 300, 18, 0, 0),
      s('mite', 300, 18, 2, 1),
      s('mite', 200, 14, 5, 2),
      s('beetle', 30, 1.5, 8, 1),
    ],
    wakes: { units: ['combiner', 'chest', 'piston'] },
  },
  {
    id: 'live-wire',
    name: 'LIVE WIRE',
    tip: 'TESLA COILS drink violet and arc through ten at a time.',
    breaches: 3,
    buildS: 55,
    spawns: [
      s('mite', 450, 22, 0, 0),
      s('mite', 450, 22, 2, 1),
      s('mite', 300, 18, 4, 2),
      s('beetle', 40, 2, 6, 0),
    ],
    wakes: { feeds: ['volt'], units: ['tesla'] },
  },
  {
    id: 'heavy-metal',
    name: 'HEAVY METAL',
    tip: 'MORTARS drop shells into the thick of it. They cost PUMPS: GEAR + CELL.',
    breaches: 3,
    buildS: 60,
    spawns: [
      s('mite', 600, 26, 0, 0),
      s('mite', 600, 26, 2, 1),
      s('mite', 400, 20, 4, 2),
      s('beetle', 60, 2.5, 5, 1),
      s('hulk', 1, 1, 14, 0),
    ],
    wakes: { units: ['mortar'] },
  },
  {
    id: 'the-hulks',
    name: 'THE HULKS',
    tip: 'Three hulks in the tide. Burn the tide, shell the hulks.',
    breaches: 3,
    buildS: 60,
    spawns: [
      s('mite', 700, 28, 0, 0),
      s('mite', 700, 28, 2, 1),
      s('hulk', 3, 0.15, 6, 2),
      s('beetle', 80, 3, 8, 2),
    ],
    wakes: {},
  },
  {
    id: 'swarm',
    name: 'SWARM',
    tip: 'Two and a half thousand. All at once.',
    breaches: 4,
    buildS: 55,
    spawns: [
      s('mite', 650, 40, 0, 0),
      s('mite', 650, 40, 0, 1),
      s('mite', 650, 40, 0, 2),
      s('mite', 650, 40, 0, 3),
    ],
    wakes: {},
  },
  {
    id: 'siege-engine',
    name: 'SIEGE ENGINE',
    tip: 'Beetles in the front rank, hulks behind. Hold the core.',
    breaches: 4,
    buildS: 60,
    spawns: [
      s('beetle', 160, 6, 0, 0),
      s('mite', 700, 30, 2, 1),
      s('mite', 700, 30, 2, 2),
      s('hulk', 4, 0.2, 8, 3),
      s('mite', 500, 30, 12, 0),
    ],
    wakes: {},
  },
  {
    id: 'last-shift',
    name: 'THE LAST SHIFT',
    tip: 'Everything, everywhere, at once.',
    breaches: 4,
    buildS: 70,
    spawns: [
      s('mite', 900, 40, 0, 0),
      s('mite', 900, 40, 0, 1),
      s('mite', 900, 40, 0, 2),
      s('mite', 900, 40, 0, 3),
      s('beetle', 200, 6, 6, 1),
      s('hulk', 6, 0.25, 10, 2),
    ],
    wakes: {},
  },
];
