/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// --- Assets
export const assets = {
  base: "/pens/stargazer/assets/",
  // The same files in Asset Hosting, uploaded by `tools/assets.mjs sync stargazer`.
  // Raise `version` when a hosted file is replaced, so browsers fetch it again.
  hosted: "https://assets.codepen.io/6234/stargazer--",
  version: 3,
  stars: {
    naked: "stars/naked.bin",
    full: "stars/full.bin",
    deep: "stars/deep.bin",
  },
  starNames: "stars/naked-names.json",
  constellations: "stars/constellations.json",
  // The sharper map where the GPU takes 8192-pixel textures.
  milkyWay: "sky/milky-way.jpg",
  milkyWaySharp: "sky/milky-way-8k.jpg",
  moon: "sky/moon.jpg",
  earthNight: "globe/earth-night.jpg",
  // Phones get 4K maps of the night Earth and the Milky Way: an 8K map takes
  // over 128 MB of graphics memory, more than a phone's browser can spare.
  earthNightPhone: "globe/earth-night-4k.jpg",
  ground: "ground/",
  models: "models/",
  // Scanned trees drawn from eight sides by tools/build-trees.mjs.
  trees: "trees/",
  // Photographs of famous objects, by tools/build-objects.py.
  objects: "objects/",
  waves: "water/normals.jpg",
  sound: "sound/",
  lightPollution: "maps/light-pollution.bin",
};

// --- Light pollution lookup grid (see tools/build-maps.py)
export const lightPollutionGrid = {
  width: 7200,
  height: 2800,
  cellsPerDegree: 20,
  north: 75,
  // Horizon glows toward towns: distances sampled (km) and azimuth sectors.
  domeDistances: [4, 7, 11, 16, 23, 32, 45, 62, 85, 115, 155, 200],
  domeSectors: 32,
  domeStrength: 0.55,
  domeHeight: 7,
};

// --- Weather (Open-Meteo, no key)
export const weather = {
  forecastUrl: "https://api.open-meteo.com/v1/forecast",
  archiveUrl: "https://archive-api.open-meteo.com/v1/archive",
  airQualityUrl: "https://air-quality-api.open-meteo.com/v1/air-quality",
  forecastPastDays: 92,
  forecastFutureDays: 15,
  // Used when no forecast exists for the date.
  fallback: {
    cloudCover: 0,
    humidity: 40,
    aerosol: 0.06,
    windSpeed: 8,
    windDirection: 270,
    temperature: 15,
    precipitation: 0,
  },
};

// --- Renderer
export const renderer = {
  maxPixelRatio: 2,
  // Drawing-buffer pixels to aim for on large screens.
  maxPixels: 4.2e6,
  clearColor: 0x000000,
  // The sky and cloud maps' texels: azimuth across the whole horizon, altitude up
  // to the zenith.
  skyMap: [1024, 256],
  // The drawing buffer shrinks while frames run longer than the budget (ms) and
  // grows back while they keep to it, so the frame rate holds on any GPU: judged
  // over windows of so many frames, in steps of the scale, never below the floor.
  governor: {
    budget: 1000 / 60,
    window: 60,
    step: 0.1,
    floor: 0.5,
    settleWindows: 4,
    retryWindows: 180,
  },
};

// --- Camera and looking around
export const view = {
  // Vertical field of view in degrees. Portrait screens widen it so the sky
  // still feels open, up to the cap.
  fovLandscape: 62,
  fovPortraitHorizontal: 72,
  fovMax: 96,
  eyeHeight: 1.6,
  // How much brighter the sky-lit ground looks than its light alone (dark adaptation).
  nightVision: 14,
  pitchMin: -60,
  pitchMax: 89.5,
  // Where the view starts when the galactic center is below this altitude.
  fallbackPitch: 28,
  galacticCenterMinAltitude: 8,
  keyDegreesPerSecond: 55,
  inertiaHalfLife: 0.16,
};

// --- Instruments in use (degrees, metres, seconds)
export const optics = {
  // The eyepiece's circle of view, as a share of the screen's shorter side.
  fieldFill: 0.88,
  // How long the view stays dark while the eye moves to an eyepiece.
  blink: 0.2,
  // How near set-up equipment must be to step back to it, and how far ahead of
  // the eye it stands.
  reach: 3,
  standBack: 0.55,
  // The steepest ground (rise over run) a tripod or mount stands on.
  steepest: 0.3,
  // The lowest a mounted instrument points.
  pitchMin: -8,
  // Stepping back to standing equipment says where it is still aimed once the
  // eye had turned this far (degrees) from it.
  aimedElsewhere: 10,
  // Hand-held sway: a slow drift, breathing and the hands' tremor; walking with
  // the binoculars up multiplies the tremor, and wind (per m/s) adds to it.
  hand: {
    drift: 0.1,
    breath: 0.035,
    tremor: 0.022,
    walkingShake: 3,
    wind: 0.12,
  },
  // Mounts ring when pushed (natural frequency in Hz, damping ratio, how hard a
  // change of aim speed drives them) and shake in the wind (degrees per (m/s)²).
  mounts: {
    tripod: { frequency: 5, damping: 0.12, push: 0.5, wind: 0.0012 },
    dobsonian: { frequency: 3.5, damping: 0.22, push: 0.35, wind: 0.0007 },
  },
  // Wind at eye height, compared with the forecast's 10 m wind.
  windAtEye: 0.7,
};

// --- Walking (metres, seconds)
export const walk = {
  speed: 4,
  runSpeed: 12,
  // How quickly walking speeds up and slows down (per second).
  grip: 8,
  // Radians of turn per pixel of mouse movement with the pointer captured.
  lookSensitivity: 0.0022,
  // Eye height settles toward the ground at this rate as the land rises and falls.
  stride: 10,
  // The land is rebuilt around the walker once they are this far from its centre,
  // keeping its finest detail under their feet.
  recentre: 60,
  // The walker's own width, for keeping clear of rocks.
  radius: 0.3,
  joystickRadius: 33,
  hintSeconds: 5,
};

// --- Headlamp: a red LED on its low setting (about 5 lumens), worn on the forehead
export const headlamp = {
  // The lamp's red settings, in the order its button steps through them. Each is a
  // brightness at the centre of the beam (candela), a beam (half-angles in degrees
  // of its bright centre, its dimmer spill and where the spill ends, and the spill's
  // share of the centre's brightness) and how far it is tipped down from the line
  // of sight (degrees): toward the feet for a flood, nearly level for a spot.
  modes: [
    // About 10 lumens spread in an even, wide flood: the ground all around your feet.
    {
      id: "broad",
      name: "Broad",
      candela: 9,
      hotspot: 26,
      spill: 34,
      edge: 46,
      spillShare: 0.6,
      tilt: 20,
    },
    // About 30 lumens in a tight beam: a path, a rock or a shore 20 to 30 metres off.
    {
      id: "spot",
      name: "Spot",
      candela: 40,
      hotspot: 5,
      spill: 11,
      edge: 22,
      spillShare: 0.12,
      tilt: 3,
    },
    // A thrower, as red hunting lights are: a narrow, level beam of about 20,000
    // candela, still a quarter of a lux (full moonlight) some 280 metres off.
    {
      id: "throw",
      name: "Thrower",
      candela: 20000,
      hotspot: 1.5,
      spill: 4,
      edge: 9,
      spillShare: 0.04,
      tilt: 0,
    },
    // About 250 lumens, as a red hunting flood gives, spread wide and nearly level:
    // the clearing around you, its trees and the ground out to 15 or 20 metres.
    {
      id: "flood",
      name: "Floodlight",
      candela: 110,
      hotspot: 32,
      spill: 48,
      edge: 66,
      spillShare: 0.55,
      tilt: 6,
    },
    // About 5 lumens: a gentle light a few steps ahead.
    {
      id: "low",
      name: "Low",
      candela: 6,
      hotspot: 9,
      spill: 24,
      edge: 52,
      spillShare: 0.22,
      tilt: 12,
    },
  ],
  // Above the eyes, in metres.
  above: 0.08,
  // Seconds for the LED to reach full brightness.
  rise: 0.06,
};

// --- Stars
export const stars = {
  // Point size in CSS pixels for a star right at the limiting magnitude.
  minSize: 1.3,
  maxSize: 10,
  // Alpha of a star at the limit, and how fast it rises with flux.
  faintAlpha: 0.2,
  alphaPower: 0.5,
  // Core size grows as flux to this power (flux 1 at the limit).
  sizePower: 0.19,
  // Fraction of each star's color kept (night vision desaturates).
  saturation: 0.85,
  // Stars only an instrument reveals grow fainter the deeper it reaches, so
  // millions of them read as fine dust rather than a wall of light.
  crowdFrom: 10.5,
  crowdFalloff: 0.75,
  // Scintillation: its depth overhead (a fraction of the light), which grows with
  // the air the light crosses; how fast it wanders (noise steps a second); and how
  // far a bright star's colors flicker apart low in the sky.
  twinkle: 0.025,
  twinkleRate: 7,
  twinkleChroma: 0.9,
  // Wind (km/h) at which the air churns twice as hard as in calm.
  turbulenceWind: 35,
  // How strongly the brightest stars and planets glare.
  glare: 1,
};

// --- Visibility model
export const visibility = {
  // Natural zenith sky brightness, mag/arcsec² (moonless, no light pollution).
  naturalZenith: 22,
  // Extinction (mag per air mass): Rayleigh at sea level, ozone, and aerosol
  // per unit of aerosol optical depth.
  rayleigh: 0.145,
  ozone: 0.016,
  aerosolPerDepth: 1.086,
  humidityExtinction: 0.05,
  // A fully cloudy patch dims starlight by this many magnitudes.
  cloudDimming: 5,
  // Tops of the low and middle cloud layers (m): a site above a layer looks
  // down on it, not up through it.
  cloudLayerTops: [2000, 6000],
  cloudLayerFade: 1000,
};

// --- The deep star set, baked into a fine glow: magnitude bins it is split into
// (one per color channel), the grid it is gathered on, and its strength on screen.
export const deepStars = {
  bins: [11, 12, 13, 14.3],
  width: 2048,
  height: 1024,
  gain: 0.0035,
  // Where the full set hands over to the deep set when both are loaded.
  handover: 11,
};

// --- Sky background
export const sky = {
  // Screen brightness of the natural dark sky at the zenith (linear).
  display: 0.0021,
  // The soft ceiling the night curve rolls off toward, so the brightest glow never clips.
  ceiling: 0.45,
  milkyWayGain: 0.42,
  // Night vision sees the Milky Way almost without color.
  milkyWaySaturation: 0.35,
  groundColor: [0.0005, 0.0005, 0.0006],
  dither: 1.2,
  // By day the eye exposes to the sky overhead: the zenith shows at
  // dayKey / (1 + dayKey) of white. The daylight regime comes in between
  // dayRange (log10 of the sky's nanolamberts: a bright Moon's sky to civil twilight).
  dayKey: 0.6,
  dayRange: [3.5, 5.5],
  // Clouds drift with the wind; the deck is drawn this many kilometres up.
  cloudHeight: 2,
  cloudDrift: 1.5,
};

// --- The Moon
export const moon = {
  distance: 380,
  // Angular diameter in degrees: 0.52 in truth, drawn a little larger to the
  // naked eye, the way the eye remembers it, and true through an instrument.
  diameter: 0.75,
  trueDiameter: 0.52,
  brightness: 1.7,
  haloDegrees: 6,
  haloStrength: 0.5,
};

// --- Time
export const time = {
  // "Tonight" lands this many minutes after astronomical dusk.
  afterDuskMinutes: 40,
  // The night slider spans this many hours either side of local midnight.
  sliderHours: 8,
  sliderStepMinutes: 5,
  liveTickSeconds: 15,
  // Tonight's plan for the logbook samples the night this often (minutes).
  planStepMinutes: 15,
};

// --- Interface
export const ui = {
  idleSeconds: 3.5,
  // Skies brighter than this (mag/arcsec² overhead: twilight and day) put the
  // HUD on deeper surfaces so it still reads.
  brightSky: 17,
  fadeInSeconds: 2.4,
  // The loading line stays this long (seconds) after the last thing arrives.
  loadingLinger: 1.2,
  // The heading strip along the top: how many pixels a degree of turn takes.
  heading: { pixelsPerDegree: 3 },
};

// --- Globe
export const globe = {
  fov: 34,
  // The night behind the globe, in its dialog, and how many frames pass between
  // drawings of the game behind the dialog.
  background: 0x03050a,
  behindEvery: 2,
  // On opening, the globe turns this far (degrees) as it settles on the visitor.
  arrivalSpin: 50,
  arrivalSeconds: 3.2,
  atmosphere: {
    // A key light from the upper left, toward the viewer.
    light: [-0.6, 0.55, 0.6],
    // How deep the glow reaches, in Earth radii: wider than real air, for a soft fall-off.
    scaleHeight: 0.022,
    strength: 0.62,
  },
  // Camera distance from the Earth's center (in Earth radii) at each zoom level.
  levels: [4.2, 2.4, 1.62, 1.3, 1.14, 1.065],
  // From this level on, sharper night-light tiles are laid over the globe.
  tileLevel: 2,
  tileUrl:
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
  tileMaxZoom: 8,
  tileGrid: 4,
  // Seconds for a spin-and-zoom, and for the flight down to the ground.
  focusSeconds: 1.6,
  descendSeconds: 1.8,
  riseSeconds: 2.2,
  dragDegreesPerPixel: 0.32,
  clickTolerance: 6,
  searchDelay: 250,
  searchResults: 7,
  // Pins show their names from this level on.
  pinLabelLevel: 1,
};

// --- Place lookups (no keys)
export const places = {
  searchUrl: "https://geocoding-api.open-meteo.com/v1/search",
  reverseUrl: "https://api.bigdatacloud.net/data/reverse-geocode-client",
  detailsUrl: "https://api.open-meteo.com/v1/forecast",
  // Place names and details give up after this long (seconds); landing goes ahead
  // with the time zone guessed from longitude.
  lookupSeconds: 6,
};

// --- What covers the land and where its water lies, read from map tiles
export const land = {
  // With the mountains assist, land is laid flat beyond these distances from
  // the walker (metres): starting at the first, wholly by the second.
  flatRange: [150, 700],
  // NASA GIBS (EPSG:4326, 512-pixel tiles; level 0 is 0.5625 degrees a pixel).
  gibs: "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{time}{set}/{level}/{row}/{col}.png",
  // MODIS land cover (500 m): close by at full detail, out to the horizon coarser.
  cover: {
    layer: "MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual",
    set: "500m",
    time: "2024-01-01/",
    near: 7,
    far: 4,
  },
  // The sea out to the far horizon, from OpenStreetMap (GIBS, 2 km).
  sea: { layer: "OSM_Land_Water_Map", set: "250m", time: "", far: 5 },
  // Close by, OpenStreetMap itself (OpenMapTiles vector tiles from OpenFreeMap):
  // its water, waterways, land cover and land use, at this zoom.
  osm: { tilejson: "https://tiles.openfreemap.org/planet", zoom: 13 },
  // How wide (metres) each kind of waterway is drawn, and how deep it runs.
  waterways: {
    river: { width: 24, depth: 1.4 },
    canal: { width: 12, depth: 1.2 },
    stream: { width: 3.5, depth: 0.35 },
    drain: { width: 2, depth: 0.25 },
    ditch: { width: 1.5, depth: 0.2 },
  },
  // The detailed grids around the site: land cover out to coverRadius in cells of
  // coverCell, water out to waterRadius in cells of waterCell (metres).
  coverRadius: 6000,
  coverCell: 60,
  waterRadius: 4000,
  waterCell: 30,
  // Land cover is read through a gentle wander (metres), so the edges between kinds
  // of land curve like real ones instead of following the map's square pixels.
  warp: 160,
  // Bare land steeper than this (rise over run) is rock; gentler, sand.
  rockSlope: 0.18,
  // Far land's patchiness: the scales (metres) of its broad and fine patches of
  // thicker and thinner cover, and how much (a share) they vary its colour.
  farPatch: [320, 48],
  farBreakup: 0.55,
  // Shadows from the Moon or the Sun close by: each depth map's size (pixels),
  // how far the near map (everything) and the far map (trees alone) reach from
  // the walker (metres, centre to edge), the depth they span, how often they are
  // drawn again (seconds), the bias a receiver steps off its surface by (a share
  // of the depth, and metres along its normal), and how much brighter than the
  // sky the light must be to cast any.
  // The near map's casters are drawn over `slices` frames, so no one frame bears them all.
  shadows: {
    mapSize: 2048,
    reach: [40, 260],
    depth: 900,
    interval: 0.1,
    slices: 6,
    bias: [0.0003, 0.08],
    castFrom: 0.5,
  },
  // Contact darkening under footings: the map's size (pixels), its reach (metres,
  // centre to edge), painted again after the walker moves `repaint` metres, the
  // share of sky light kept out at a footing's centre, and the radius of the
  // dark disc under a plant (times its scale), a rock (times its footprint) and a
  // trunk (metres, plus a share of the tree's height).
  contact: {
    size: 1024,
    reach: 60,
    repaint: 3,
    strength: 0.6,
    radius: { plant: 0.45, rock: 1.3, trunk: 0.6 },
  },
  // Close by, the ground's small rises and hollows: their scales (metres) and
  // how much they tilt the ground.
  nearRelief: [2.6, 0.7, 0.9],
  // The ground's pattern at tens of metres: a coarse read of each kind's
  // photograph at this many times its near repeat, and how much (a share) its
  // light and dark show over the land's colour.
  midDetail: [11, 0.8],
  // How far (metres) the ground counts as a shore, and how deep water lies.
  shoreReach: 28,
  waterDepth: 1.6,
  // The water's edge wanders off the grid by up to this far (metres), over this wavelength.
  shoreWarp: [9, 70],
  // The shore of the sea is shaped from its distance to the water: a beach
  // rising at `slope` (rise over run) out to `reach` metres from the water's
  // edge at mean sea level, the sea floor falling at `floor` to `depth` metres.
  beach: { slope: 1 / 12, reach: 40, floor: 1 / 8, depth: 4 },
  // The tide: a lunar model (the Moon's and the Sun's hour angles, high water
  // `lag` hours after the Moon crosses the meridian) with this range (metres,
  // low to high). The real range varies from coast to coast; this is a typical one.
  tide: { range: 1.4, lag: 1.6 },
  // Swash: each wave runs this high (metres) up the beach, every `period` seconds,
  // waves `wavelength` metres apart.
  swash: { height: 0.3, period: 9, wavelength: 24 },
  // Farmland lies in fields about this wide (metres), each its own crop.
  fieldSize: 170,
  // How near (metres) water must be to give the site its shore and its sounds.
  shoreDistance: 260,
  // Trees stand in rings out from the centre, each `[to, cell]`: at most one tree
  // to each square `cell` of the land out to `to` metres. Close by every tree
  // stands on its own cell; farther out the cells grow, so a forest still reaches
  // the horizon as the wall of crowns it is, with a few thousand cards. They fade
  // beyond `fade` of the last ring. Where the observer is set down is a clearing,
  // open to `clearing[0]` and full grown by `clearing[1]`, as a stargazer would
  // choose in a forest. Their pictures were lit brighter than leaves are; `albedo`
  // brings them down to it.
  trees: {
    rings: [
      [240, 3],
      [600, 6],
      [1500, 14],
    ],
    fade: 0.85,
    clearing: [24, 45],
    albedo: 0.45,
    // A walker's trees are planted again once they have walked this far (metres)
    // from where the trees were planted.
    replantAfter: 120,
    // How far a crown sways, as a share of the tree's height, in a 20 km/h wind.
    sway: 0.012,
    // Where trees stop: beyond `latitude` degrees of the equator, and above the
    // mountain treeline, `elevation[0]` metres up to `elevation[1]` degrees from
    // the equator and `elevation[2]` metres lower for each degree beyond, thinning
    // over the last `band` metres.
    treeline: { latitude: 69, elevation: [4000, 20, 75], band: 300 },
  },
  // Broadleaf trees stand bare in winter beyond `latitude` degrees of the equator:
  // in the north from `from` to `to` (months, with `[latitude, month]` pairs moving
  // either end where winter runs longer); in the south, six months on.
  leafOff: {
    latitude: 28,
    from: [
      [0, 12],
      [40, 11],
    ],
    to: [
      [0, 2],
      [38, 3],
      [50, 4],
    ],
  },
  // Snow on the date, from NASA's MODIS snow maps (GIBS): the newest daily map
  // within `recent` days of it, `lookBack` days of them past clouds, then the 8-day
  // map; for dates no map covers, that month's average. Read finely to
  // `nearRadius` (cells of `nearCell` metres) and coarsely (`farCell`) beyond.
  snow: {
    daily: {
      layer: "MODIS_Terra_L3_NDSI_Snow_Cover_Daily",
      set: "500m",
      near: 7,
      far: 4,
      colormap: "MODIS_NDSI_Snow_Cover",
    },
    eightDay: {
      layer: "MODIS_Terra_L3_Snow_Extent_8Day",
      set: "500m",
      near: 7,
      far: 4,
      colormap: "MODIS_L3_Snow_Extent",
    },
    monthly: {
      layer: "MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct",
      set: "2km",
      near: 5,
      far: 3,
      colormap: "MODIS_NDSI_Snow_Cover",
    },
    colormaps: "https://gibs.earthdata.nasa.gov/colormaps/v1.3/{name}.xml",
    domains:
      "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/{layer}/default/{set}/all/{from}--{to}.xml",
    recent: 10,
    lookBack: 3,
    nearRadius: 6000,
    nearCell: 250,
    farCell: 2500,
  },
};

// --- The ground around the observer
export const terrain = {
  // The wind speed (km/h) that pushes plants and trees with a force of 1, and
  // the most force a gale brings.
  windForceAt: 20,
  windForceMax: 2.2,
  // Terrarium elevation tiles (Mapzen / AWS Open Data), open and keyless.
  tileUrl:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  // A sharp grid close by and a coarse one out to the far horizon.
  nearZoom: 12,
  nearTiles: 3,
  farZoom: 8,
  farTiles: 4,
  rings: 120,
  segments: 720,
  innerRadius: 1.5,
  outerRadius: 140000,
  // Ground within this radius is smoothed flat, then the real terrain takes over.
  flatRadius: 8,
  flatBlend: 30,
  // Light bends over the curved Earth, so the horizon drops less than geometry says.
  refraction: 0.13,
  eyeHeight: 1.6,
  // How much brighter the sky-lit ground looks than its light alone (dark adaptation).
  nightVision: 14,
  // The ground's own display ceiling, above the sky's: moonlit ground is seen with
  // the cones, which still tell wet sand from dry and a shadow from the light.
  ceiling: 0.8,
  // Moonlight and sunlight on the ground, in nanolamberts for albedo 1 at full strength.
  fullMoonLight: 27000,
  sunLight: 1e10,
  // How the headlamp's light shows: the lux (on the ground, albedo 1) drawn at
  // half brightness, and the power the eye compresses dimmer light by, so a
  // spot 25 m off still shows while the flood at the feet keeps its gradient.
  lampDisplay: { halfLux: 6, power: 0.7 },
};

// --- Sound
export const sound = {
  master: 0.55,
  // The chime of a target logged, as a share of the master.
  chime: 0.16,
  // Seconds for the sound to come in, and for layers to swell or fade.
  fadeIn: 4,
  fade: 3,
  // Wind is heard only once the ear could hear it: each wind layer rises from
  // silence to full between two forecast wind speeds (km/h at 10 m). Leaves and
  // grass rustle first; wind at the ear itself comes later; it howls in a gale.
  // Animals fall quiet as the wind rises between `hushWind` speeds.
  leavesWind: [6, 25],
  breezeWind: [15, 40],
  gustsWind: [35, 60],
  hushWind: [20, 45],
  // Insects fall silent below this temperature (°C) and in strong wind; frogs
  // below theirs; still water freezes over below `iceTemperature`. Snow on the
  // ground (a share over `snowSilence`) silences both.
  insectTemperature: 10,
  frogTemperature: 8,
  iceTemperature: -6,
  snowSilence: 0.5,
  // Night birds and animals call once the Sun is this far (degrees) below the horizon.
  owlSunAltitude: -6,
};

// --- The field game
export const game = {
  // Each assist takes this share off a target's points, down to the floor.
  assistCost: 0.25,
  assistFloor: 0.25,
  // A target counts as found once held this long (seconds) within this many
  // degrees of the center by eye, or this share of an eyepiece's field.
  holdSeconds: 2,
  eyeRadius: 3,
  fieldShare: 0.42,
  // Cloud cover (%) that hides everything, and how often (seconds) the target is
  // judged again.
  cloudCover: 75,
  judgeEvery: 0.4,
  // The moment a target is logged: how long (seconds) the ring takes to close,
  // the points to rise and fade, and the score to count up.
  moment: { closeSeconds: 1.1, riseSeconds: 1.8, countSeconds: 1.2 },
};

// --- Pictures of famous objects in the sky
export const pictures = {
  // Brightness of a deep-sky picture well clear of the limit, and of a planet's.
  gain: 0.55,
  planetGain: 1,
  // Magnitudes above the limit at which a picture shows in full.
  clear: 3,
  // The share of a picture's light the sky swallows: when well clear, and at the limit.
  floor: [0.04, 0.45],
  // Most color a deep-sky picture shows (the eye sees little color at night).
  saturation: 0.35,
  // A planet's disc (CSS pixels) big enough to replace its point of light.
  discPixels: 5,
  // Seconds between looks at which pictures are near the view.
  lookEvery: 0.25,
  // A loaded picture is let go after this many seconds more than this many
  // degrees from the view (or out of sight).
  keepDegrees: 30,
  freeSeconds: 10,
  // Seeing on a calm night (arcseconds); wind makes it worse.
  seeing: 1.8,
  // Saturn's rings are never flattened past this share of the photograph's
  // opening: edge-on they remain a hairline.
  ringsFloor: 0.04,
  // Extra share of points for a target logged with its picture in an eyepiece,
  // and how long (seconds) its photograph shows afterwards.
  detailBonus: 0.5,
  keepSeconds: 12,
};

// --- Drawing constellations
export const drawing = {
  // Gold for what you are finding: saved figures quieter than one being drawn.
  color: "#e6c27a",
  savedOpacity: 0.4,
  draftOpacity: 0.85,
  // How near (CSS pixels) a click must land to take a star, and how near
  // (degrees) a drawn end must be to a constellation's star to count.
  snapPixels: 22,
  matchDegrees: 0.3,
  // A drawing traces a constellation when it has this share of the lines that
  // can be seen, and no more than this share of its own lines go elsewhere.
  share: 0.6,
  extra: 0.4,
  // Points for a traced constellation: a base and so many a line, counting up
  // to so many lines.
  base: 15,
  perLine: 2,
  maxLines: 15,
  // Seconds between award notices.
  awardGap: 2.2,
};

// --- Sky guides
export const guideStyle = {
  // Figure lines are cut into arcs this many degrees long, so they curve with the sky.
  lineStep: 2,
  // Lines are soft strokes this many CSS pixels wide, faint and cool like the sky.
  lineWidth: 1.4,
  lineOpacity: 0.02,
  lineColor: [0.62, 0.7, 0.88],
  // Each line leaves its stars this much clear sky (degrees) and fades in softly
  // over the next stretch; short lines shrink both, so they stay a faint link.
  lineClear: 0.85,
  lineRamp: 0.7,
  // A lit-up figure's lines are this many times brighter, and its stars glow this
  // wide (CSS pixels).
  lineHighlight: 3.2,
  starGlow: 18,
  // A figure is drawn only while at least this share of its lines join stars that
  // can be seen; fewer would not make a recognizable shape.
  figureShare: 0.6,
  // Or while its largest connected piece of such lines has at least this many lines
  // and this share of the figure: enough to make the shape out.
  pieceLines: 3,
  pieceShare: 0.4,
  // How often (seconds) figures are checked against the sky, and how near (CSS
  // pixels) the pointer must come to a figure's line to light it up.
  judgeEvery: 0.5,
  hoverPixels: 22,
  // A constellation's card names the shown figures within this many degrees of it,
  // and any planet within this many.
  nearDegrees: 40,
  planetNearDegrees: 14,
  // Brightness assumed for a figure point with no catalog star close by.
  unknownMagnitude: 5,
  // The land's horizon is measured in this many directions, this many a frame, and
  // again once the walker has moved this far (metres).
  horizonSamples: 360,
  horizonPerFrame: 24,
  horizonRemeasure: 25,
  // Labels hide this close to the horizon.
  labelAltitude: 3,
  // A tap picks the nearest star within this many degrees.
  pickDegrees: 2.2,
  pickMagnitude: 6.5,
};
