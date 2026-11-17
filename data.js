/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// --- Where the pen opens
// Where a first visit starts: the summit of Mauna Kea, Hawaii, home of the great
// observatories, above the clouds under one of the clearest skies on Earth; at
// 20° north it sees nearly the whole sky, Polaris and the Southern Cross alike.
export const defaultSite = {
  name: "Mauna Kea",
  region: "Hawaii, United States",
  about: "a summit above the clouds, under one of the clearest skies on Earth.",
  latitude: 19.8207,
  longitude: -155.4681,
  elevation: 4207,
  timeZone: "Pacific/Honolulu",
};

// --- Compass points drawn on the horizon (azimuth in degrees from north)
export const compass = [
  { label: "N", azimuth: 0, major: true },
  { label: "NE", azimuth: 45, major: false },
  { label: "E", azimuth: 90, major: true },
  { label: "SE", azimuth: 135, major: false },
  { label: "S", azimuth: 180, major: true },
  { label: "SW", azimuth: 225, major: false },
  { label: "W", azimuth: 270, major: true },
  { label: "NW", azimuth: 315, major: false },
];

// --- Landmarks in the sky used to aim the first view (J2000 RA hours, Dec degrees)
export const galacticCenter = { ra: 17.7611, dec: -29.0078 };

// --- Light Pollution Atlas 2025 zones (David Lorenz), in ordinal order.
// `ratio` is artificial sky brightness over the natural sky, the middle of the zone's range.
export const lightPollutionZones = [
  { zone: "0", ratio: 0.005 },
  { zone: "1a", ratio: 0.025 },
  { zone: "1b", ratio: 0.081 },
  { zone: "2a", ratio: 0.145 },
  { zone: "2b", ratio: 0.25 },
  { zone: "3a", ratio: 0.44 },
  { zone: "3b", ratio: 0.76 },
  { zone: "4a", ratio: 1.32 },
  { zone: "4b", ratio: 2.28 },
  { zone: "5a", ratio: 3.95 },
  { zone: "5b", ratio: 6.84 },
  { zone: "6a", ratio: 11.85 },
  { zone: "6b", ratio: 20.5 },
  { zone: "7a", ratio: 35.5 },
  { zone: "7b", ratio: 60 },
];

// --- Viewing instruments
// aperture and magnification set how much starlight reaches the eye and how
// much the sky background is dimmed; transmission is light lost in the optics;
// practicalLoss covers what formulas miss (focus, seeing, a hand-held view).
// field is the true field of view in degrees (the eyepiece's apparent field over
// the magnification), and a telescope's eyepieces change both; mount is how it is held: in the hands, or set up on a
// tripod or its own mount, which takes setup seconds; eyepiece is what the eye
// looks into. Every view is upright, as in modern binoculars and erecting diagonals.
export const instruments = [
  {
    id: "eye",
    name: "Naked eye",
    short: "Naked eye",
    icon: "eye",
    detail: "Fully dark-adapted, 7 mm pupil",
    aperture: 7,
    magnification: 1,
    transmission: 1,
    practicalLoss: 0,
    stars: "naked",
    field: null,
    mount: "none",
  },
  {
    id: "binoculars",
    name: "Handheld binoculars",
    short: "Binoculars",
    icon: "binoculars",
    detail: "10 × 50, held in the hands",
    reveal: "Binoculars reveal",
    aperture: 50,
    magnification: 10,
    transmission: 0.8,
    practicalLoss: 0.9,
    stars: "full",
    field: 6.5,
    mount: "hand",
    eyepiece: "binocular",
  },
  {
    id: "tripod-binoculars",
    name: "Tripod binoculars",
    short: "Big binos",
    icon: "tripod-binoculars",
    detail: "25 × 100 on a tripod",
    reveal: "Big binoculars reveal",
    aperture: 100,
    magnification: 25,
    transmission: 0.8,
    practicalLoss: 0.6,
    stars: "full",
    field: 3,
    mount: "tripod",
    setup: 3,
    eyepiece: "binocular",
  },
  {
    id: "small-telescope",
    name: "Small telescope",
    short: "Small scope",
    icon: "telescope",
    detail: "80 mm refractor",
    reveal: "A small telescope reveals",
    aperture: 80,
    magnification: 40,
    transmission: 0.85,
    practicalLoss: 0.5,
    stars: "full",
    field: 1.3,
    // Eyepieces from low to high power: magnification and true field.
    eyepieces: [
      { magnification: 40, field: 1.3 },
      { magnification: 100, field: 0.52 },
      { magnification: 160, field: 0.33 },
    ],
    mount: "tripod",
    setup: 4,
    eyepiece: "telescope",
  },
  {
    id: "large-telescope",
    name: "Large telescope",
    short: "Large scope",
    icon: "dobsonian",
    detail: "200 mm Dobsonian reflector",
    reveal: "A large telescope reveals",
    aperture: 200,
    magnification: 80,
    transmission: 0.75,
    practicalLoss: 0.5,
    stars: "deep",
    field: 0.75,
    eyepieces: [
      { magnification: 80, field: 0.75 },
      { magnification: 150, field: 0.4 },
      { magnification: 250, field: 0.24 },
    ],
    mount: "dobsonian",
    setup: 6,
    eyepiece: "telescope",
  },
];

// --- Sky conditions the visitor can override (keys match the conditions state)
export const conditionControls = [
  {
    key: "brightness",
    label: "Sky brightness",
    unit: "mag/arcsec²",
    min: 16,
    max: 22,
    step: 0.05,
    decimals: 2,
  },
  {
    key: "cloudCover",
    label: "Clouds",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    decimals: 0,
  },
  {
    key: "humidity",
    label: "Humidity",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    decimals: 0,
  },
  {
    key: "aerosol",
    label: "Haze",
    unit: "AOD",
    min: 0,
    max: 1,
    step: 0.01,
    decimals: 2,
  },
];

// --- Moon phases by elongation from the Sun (degrees)
export const moonPhases = [
  { name: "New Moon", upTo: 10 },
  { name: "Waxing crescent", upTo: 80 },
  { name: "First quarter", upTo: 100 },
  { name: "Waxing gibbous", upTo: 170 },
  { name: "Full Moon", upTo: 190 },
  { name: "Waning gibbous", upTo: 260 },
  { name: "Last quarter", upTo: 280 },
  { name: "Waning crescent", upTo: 350 },
  { name: "New Moon", upTo: 360 },
];

// --- Dark-sky places: pins on the globe, and first in search results
export const darkSkyPlaces = [
  {
    name: "Cerro Paranal",
    region: "Atacama Desert, Chile",
    latitude: -24.6272,
    longitude: -70.4042,
  },
  {
    name: "Elqui Valley",
    region: "Gabriela Mistral Sanctuary, Chile",
    latitude: -30.0306,
    longitude: -70.6939,
  },
  {
    name: "NamibRand Nature Reserve",
    region: "Namibia",
    latitude: -24.95,
    longitude: 16.0,
  },
  {
    name: "Aoraki Mackenzie",
    region: "Canterbury, New Zealand",
    latitude: -43.9867,
    longitude: 170.4646,
  },
  {
    name: "Warrumbungle National Park",
    region: "New South Wales, Australia",
    latitude: -31.2758,
    longitude: 149.0042,
  },
  {
    name: "Uluru-Kata Tjuta",
    region: "Northern Territory, Australia",
    latitude: -25.3444,
    longitude: 131.0369,
  },
  {
    name: "Mauna Kea",
    region: "Hawaii, United States",
    latitude: 19.8207,
    longitude: -155.4681,
  },
  {
    name: "Glacier Point",
    region: "Yosemite, California, United States",
    latitude: 37.7307,
    longitude: -119.5737,
  },
  {
    name: "Death Valley",
    region: "California, United States",
    latitude: 36.4617,
    longitude: -116.8669,
  },
  {
    name: "Natural Bridges",
    region: "Utah, United States",
    latitude: 37.6014,
    longitude: -110.0137,
  },
  {
    name: "Bryce Canyon",
    region: "Utah, United States",
    latitude: 37.593,
    longitude: -112.1871,
  },
  {
    name: "Grand Canyon",
    region: "Arizona, United States",
    latitude: 36.0544,
    longitude: -112.1401,
  },
  {
    name: "Big Bend",
    region: "Texas, United States",
    latitude: 29.2498,
    longitude: -103.2502,
  },
  {
    name: "Cherry Springs",
    region: "Pennsylvania, United States",
    latitude: 41.6626,
    longitude: -77.8236,
  },
  {
    name: "Jasper",
    region: "Alberta, Canada",
    latitude: 52.8737,
    longitude: -118.0814,
  },
  {
    name: "Mont-Mégantic",
    region: "Quebec, Canada",
    latitude: 45.4556,
    longitude: -71.1525,
  },
  {
    name: "Kerry Dark Sky Reserve",
    region: "County Kerry, Ireland",
    latitude: 51.85,
    longitude: -10.25,
  },
  {
    name: "Galloway Forest",
    region: "Scotland, United Kingdom",
    latitude: 55.1,
    longitude: -4.45,
  },
  {
    name: "Exmoor",
    region: "England, United Kingdom",
    latitude: 51.15,
    longitude: -3.6,
  },
  {
    name: "Pic du Midi",
    region: "Pyrenees, France",
    latitude: 42.9364,
    longitude: 0.1411,
  },
  {
    name: "Westhavelland",
    region: "Brandenburg, Germany",
    latitude: 52.7,
    longitude: 12.3,
  },
  {
    name: "Zselic",
    region: "Somogy, Hungary",
    latitude: 46.24,
    longitude: 17.77,
  },
  {
    name: "Roque de los Muchachos",
    region: "La Palma, Spain",
    latitude: 28.7564,
    longitude: -17.8917,
  },
  {
    name: "Teide",
    region: "Tenerife, Spain",
    latitude: 28.2724,
    longitude: -16.6425,
  },
  {
    name: "Erg Chebbi",
    region: "Sahara, Morocco",
    latitude: 31.15,
    longitude: -3.97,
  },
  {
    name: "Wadi Rum",
    region: "Aqaba, Jordan",
    latitude: 29.5762,
    longitude: 35.4195,
  },
  {
    name: "Hanle",
    region: "Ladakh, India",
    latitude: 32.7794,
    longitude: 78.9642,
  },
  {
    name: "Iriomote-Ishigaki",
    region: "Okinawa, Japan",
    latitude: 24.3333,
    longitude: 123.9,
  },
];

// --- The land: what covers the ground, read from NASA's MODIS land cover map
// around the site, and the shores of its water. Textures and models are Poly Haven
// ids (CC0) in assets/ground/ and assets/models/; farAlbedo is the land's color
// from afar; sounds name soundLayers.
//
// `growth` is what grows close about the walker, scattered models (`alpha` when
// their leaves are cut from a separate alpha map). `trees` stand further out, from
// assets/trees/: how many to a hectare where the land is wholly this kind, and the
// kinds with the heights (metres) they grow to. A kind with `latitudes` grows only
// that far from the equator (degrees); one with `winter` drops its leaves, and
// shows that picture in the months it stands bare.
// A kind with a `second` photograph shows both, in patches, so no one photograph
// covers a whole hillside; the photographs are Poly Haven's at 2k.
// `surface` is how the ground answers direct light: [shine, sparkle, pools], the
// share of moonlight or sunlight it mirrors (wet mud, rock), how much it glitters
// (sand's grains, snow's crystals) and how much of it lies in standing water.
// `turf` is the ground's own cover close about the walker: the small tufts of the
// grass scan, many to the square metre, so grassland is grass underfoot and not
// bare soil with the odd clump; the larger clumps stand among them, farther out.
const turf = {
  model: "grass_medium_01",
  parts: /tiny|small/,
  count: 2600,
  radius: 12,
  scale: [0.9, 1.5],
  sway: 0.05,
};
const grass = {
  model: "grass_medium_01",
  parts: /mid|large|tall/,
  count: 420,
  radius: 22,
  scale: [0.8, 1.2],
  sway: 0.05,
};
const tallGrass = {
  model: "grass_medium_02",
  count: 700,
  radius: 20,
  scale: [1.8, 2.6],
  sway: 0.09,
};
const tussock = {
  ...tallGrass,
  parts: /_(a|c)$/,
  count: 1400,
  radius: 14,
  scale: [1.2, 2.2],
};
const reeds = { ...tallGrass, count: 900, scale: [2.4, 3.2] };
const ferns = (count) => ({
  model: "fern_02",
  count,
  radius: 18,
  scale: [0.8, 1.4],
  sway: 0.03,
  alpha: true,
});
const shrubs = (model, count, scale = [0.8, 1.3]) => ({
  model,
  count,
  radius: 24,
  scale,
  sway: 0.02,
  alpha: true,
});
const boulders = (count, scale) => ({
  model: "namaqualand_boulder_02",
  count,
  radius: [7, 55],
  scale,
});
// Trees of a kind grow only in their `regions` (see `regions` below; none named
// means anywhere) and `latitudes` (degrees from the equator).
const NORTH = ["north-america", "europe", "north-asia"];
const TROPICS = [
  "africa",
  "south-asia",
  "central-america",
  "south-america",
  "australia",
];
const firs = {
  id: "fir_sapling_medium",
  height: [9, 24],
  regions: [...NORTH, "south-america", "new-zealand"],
};
const tallFirs = {
  id: "fir_tree_01",
  height: [14, 26],
  regions: [...NORTH, "south-america", "new-zealand"],
};
// Where open land is northern (or far south), its scattered trees are conifers.
const northernFirs = (height) => ({
  id: "fir_sapling_medium",
  height,
  latitudes: [42, 90],
  regions: [...NORTH, "south-america", "new-zealand"],
});
const roundTrees = (height) => ({
  id: "tree_small_02",
  height,
  winter: "tree_small_02_bare",
});
const spreadingTrees = (height) => ({
  id: "island_tree_02",
  height,
  latitudes: [0, 45],
  regions: TROPICS,
});
const thornTrees = (height) => ({
  id: "searsia_burchellii",
  height,
  latitudes: [0, 38],
  regions: TROPICS,
});
const bushes = (height) => ({ id: "searsia_lucida", height });
const quiverTrees = {
  id: "quiver_tree_01",
  height: [3, 6],
  latitudes: [0, 36],
  regions: ["africa"],
};
const quiverTrees2 = {
  id: "quiver_tree_02",
  height: [3, 5],
  latitudes: [0, 36],
  regions: ["africa"],
};
// Three pines scanned together, each its own kind, and a sapling of the same.
const pines = ["pine_tree_01", "pine_tree_01_1", "pine_tree_01_2"].map(
  (id) => ({
    id,
    height: [12, 26],
    regions: [...NORTH, "south-america", "new-zealand"],
  }),
);
const pineSaplings = {
  id: "pine_sapling_medium",
  height: [6, 14],
  regions: [...NORTH, "south-america", "new-zealand"],
};
const northernPines = (height) => ({
  id: "pine_tree_01_2",
  height,
  latitudes: [42, 90],
  regions: [...NORTH, "south-america", "new-zealand"],
});
const broadTrees = (height) => ({ id: "island_tree_01", height });
const jacarandas = (height) => ({
  id: "jacaranda_tree",
  height,
  latitudes: [0, 38],
  regions: TROPICS,
});

export const covers = {
  conifer: {
    label: "Conifer forest",
    texture: "forest_ground_04",
    second: "forest_leaves_04",
    tileSize: 4,
    farAlbedo: [0.032, 0.042, 0.03],
    sounds: [],
    growth: [ferns(60), shrubs("shrub_04", 14)],
    trees: { density: 260, kinds: [firs, tallFirs, ...pines, pineSaplings] },
  },
  mixed: {
    label: "Mixed forest",
    texture: "forest_ground_04",
    second: "forest_floor",
    tileSize: 4,
    farAlbedo: [0.036, 0.046, 0.032],
    sounds: ["crickets"],
    growth: [ferns(50), shrubs("shrub_02", 16)],
    trees: {
      density: 220,
      kinds: [
        firs,
        tallFirs,
        pines[0],
        pines[1],
        roundTrees([12, 24]),
        roundTrees([10, 20]),
        broadTrees([8, 16]),
      ],
    },
  },
  broadleaf: {
    label: "Woodland",
    texture: "leaves_forest_ground",
    second: "dry_decay_leaves",
    tileSize: 4,
    farAlbedo: [0.042, 0.05, 0.034],
    sounds: ["crickets"],
    growth: [ferns(40), shrubs("shrub_02", 24)],
    trees: {
      density: 180,
      kinds: [
        roundTrees([12, 24]),
        roundTrees([10, 20]),
        roundTrees([8, 14]),
        broadTrees([8, 16]),
        broadTrees([6, 12]),
        spreadingTrees([4, 7]),
      ],
    },
  },
  rainforest: {
    label: "Rainforest",
    texture: "mud_forest",
    second: "forest_ground_05",
    tileSize: 4,
    farAlbedo: [0.028, 0.042, 0.028],
    sounds: ["crickets", "frogs"],
    growth: [ferns(160), shrubs("shrub_03", 60, [1, 1.8])],
    trees: {
      density: 320,
      kinds: [
        roundTrees([16, 32]),
        spreadingTrees([6, 10]),
        roundTrees([6, 12]),
        broadTrees([10, 20]),
        jacarandas([8, 14]),
      ],
    },
  },
  woodland: {
    label: "Open woodland",
    texture: "grass_ground",
    second: "grass_path_3",
    tileSize: 5,
    farAlbedo: [0.055, 0.065, 0.04],
    sounds: ["crickets"],
    growth: [turf, grass, shrubs("shrub_02", 10)],
    trees: {
      density: 45,
      kinds: [
        roundTrees([7, 14]),
        broadTrees([6, 12]),
        spreadingTrees([4, 7]),
        thornTrees([3, 6]),
        jacarandas([6, 10]),
        northernFirs([6, 16]),
        northernPines([8, 20]),
      ],
    },
  },
  shrubland: {
    label: "Scrubland",
    texture: "dry_ground_rocks",
    second: "rocks_ground_09",
    tileSize: 6,
    farAlbedo: [0.16, 0.13, 0.1],
    growth: [boulders(6, [0.2, 0.6]), shrubs("shrub_03", 30, [0.5, 1])],
    sounds: ["crickets"],
    trees: {
      density: 40,
      kinds: [bushes([1.4, 2.6]), bushes([1, 2]), quiverTrees, quiverTrees2],
    },
  },
  savanna: {
    // MODIS calls every open, grassy land with scattered trees "savanna", from the
    // Serengeti to tussock country and the steppes; it is named for where it is.
    label: (region, latitude) =>
      region === "new-zealand"
        ? "Tussock grassland"
        : Math.abs(latitude) > 38
          ? "Steppe"
          : "Savanna",
    texture: "grass_path_2",
    second: "withered_grass",
    tileSize: 5,
    farAlbedo: [0.19, 0.16, 0.1],
    growth: [tussock, tallGrass],
    sounds: ["crickets"],
    trees: {
      density: 9,
      kinds: [
        thornTrees([3, 7]),
        thornTrees([4, 8]),
        spreadingTrees([4, 7]),
        jacarandas([5, 9]),
        northernFirs([5, 14]),
        northernPines([6, 16]),
      ],
    },
  },
  grassland: {
    label: "Grassland",
    texture: "grass_ground",
    second: "aerial_grass_rock",
    tileSize: 5,
    farAlbedo: [0.08, 0.1, 0.055],
    growth: [turf, grass],
    sounds: ["crickets"],
    trees: { density: 0.4, kinds: [roundTrees([6, 12]), broadTrees([5, 10])] },
  },
  wetland: {
    label: "Wetland",
    texture: "brown_mud_02",
    second: "brown_mud_leaves_01",
    tileSize: 4,
    farAlbedo: [0.055, 0.065, 0.045],
    surface: [0.1, 0, 0.5],
    growth: [reeds],
    sounds: ["frogs", "crickets"],
    trees: {
      density: 22,
      kinds: [
        roundTrees([6, 14]),
        broadTrees([5, 10]),
        spreadingTrees([3.5, 6]),
        northernFirs([5, 12]),
      ],
    },
  },
  cropland: {
    label: "Farmland",
    texture: "dry_mud_field_001",
    second: "farm_soil",
    tileSize: 4,
    farAlbedo: [0.12, 0.1, 0.075],
    sounds: ["crickets"],
    growth: [{ ...turf, count: 900 }],
    trees: {
      density: 1.5,
      kinds: [roundTrees([8, 16]), broadTrees([7, 14]), spreadingTrees([5, 8])],
    },
  },
  urban: {
    label: "Town edge",
    texture: "ground_grey",
    second: "gravel_ground_01",
    tileSize: 4,
    farAlbedo: [0.13, 0.13, 0.12],
    sounds: ["crickets"],
    growth: [{ ...turf, count: 1200 }, shrubs("shrub_02", 6)],
    trees: {
      density: 12,
      kinds: [
        roundTrees([6, 13]),
        roundTrees([9, 16]),
        broadTrees([6, 12]),
        jacarandas([7, 12]),
        northernFirs([8, 18]),
        pineSaplings,
      ],
    },
  },
  snow: {
    label: "Snow and ice",
    texture: "snow_01",
    tileSize: 6,
    farAlbedo: [0.72, 0.75, 0.8],
    sounds: [],
    surface: [0.2, 0.5, 0],
  },
  sand: {
    label: "Desert sand",
    texture: "aerial_sand",
    second: "sand_01",
    tileSize: 8,
    farAlbedo: [0.3, 0.24, 0.17],
    sounds: [],
    surface: [0.04, 0.25, 0],
  },
  rock: {
    label: "Bare rock",
    texture: "aerial_rocks_02",
    second: "rocky_terrain_03",
    tileSize: 7,
    farAlbedo: [0.15, 0.13, 0.11],
    surface: [0.15, 0.08, 0],
    growth: [boulders(11, [0.3, 1.1])],
    sounds: [],
  },
};

// The ground at the water's edge: sand by the sea, mud and reeds by lakes and rivers.
export const shores = {
  ocean: {
    label: "Beach",
    texture: "coast_sand_01",
    second: "aerial_beach_01",
    tileSize: 5,
    farAlbedo: [0.28, 0.25, 0.2],
    surface: [0.08, 0.2, 0],
    sounds: ["surf"],
  },
  lake: {
    label: "Lake shore",
    texture: "brown_mud",
    second: "river_small_rocks",
    tileSize: 4,
    farAlbedo: [0.07, 0.065, 0.05],
    surface: [0.18, 0, 0.12],
    growth: [reeds],
    sounds: ["lake", "frogs"],
  },
  river: {
    label: "Riverbank",
    texture: "brown_mud",
    second: "river_small_rocks",
    tileSize: 4,
    farAlbedo: [0.07, 0.065, 0.05],
    surface: [0.18, 0, 0.08],
    growth: [reeds],
    sounds: ["river", "frogs"],
  },
};

// MODIS IGBP land cover classes (1 to 17) and their colors in NASA GIBS map tiles.
// Barren land becomes sand or bare rock by the lie of the land; 17 is water.
export const landCover = [
  { rgb: [33, 138, 33], cover: "conifer" },
  { rgb: [49, 204, 49], cover: "rainforest" },
  { rgb: [152, 204, 49], cover: "conifer" },
  { rgb: [150, 250, 150], cover: "broadleaf" },
  { rgb: [141, 186, 141], cover: "mixed" },
  { rgb: [186, 141, 141], cover: "shrubland" },
  { rgb: [245, 222, 179], cover: "shrubland" },
  { rgb: [218, 235, 157], cover: "woodland" },
  { rgb: [255, 213, 0], cover: "savanna" },
  { rgb: [240, 185, 103], cover: "grassland" },
  { rgb: [71, 131, 181], cover: "wetland" },
  { rgb: [250, 239, 115], cover: "cropland" },
  { rgb: [255, 0, 0], cover: "urban" },
  { rgb: [153, 147, 86], cover: "cropland" },
  { rgb: [255, 255, 255], cover: "snow" },
  { rgb: [191, 191, 189], cover: "barren" },
  { rgb: [134, 202, 227], cover: "water" },
];

// Older names for the ground setting in the address, and what they mean now.
export const groundAliases = {
  meadow: "grassland",
  field: "savanna",
  desert: "sand",
  mountains: "rock",
  beach: "sand",
};

// --- Optional star sets, downloaded when an instrument needs them
// Each is what the sky can draw, cumulatively: the naked-eye list is built in;
// the full set adds the fainter stars, and the deep set fainter still. `reach`
// is the faintest magnitude each takes the sky to.
export const starSets = {
  naked: {
    name: "naked-eye list",
    title: "Naked-eye stars",
    short: "HYG",
    count: "26,000",
    reach: 7.5,
    source: "HYG Database",
  },
  full: {
    name: "full star set",
    title: "Full star set",
    short: "Tycho-2",
    count: "2.5 million",
    reach: 11.5,
    source: "Tycho-2 (ESA Hipparcos mission)",
  },
  deep: {
    name: "deep star set",
    title: "Deep star set",
    short: "Gaia",
    count: "about 17 million",
    reach: 15,
    source: "Gaia DR3 (ESA)",
  },
};

// --- Planets drawn when the planets guide is on (B-V sets their color)
export const planets = [
  { body: "Mercury", bv: 0.93 },
  { body: "Venus", bv: 0.82 },
  { body: "Mars", bv: 1.43 },
  { body: "Jupiter", bv: 0.87 },
  { body: "Saturn", bv: 1.09 },
  { body: "Uranus", bv: 0.56 },
  { body: "Neptune", bv: 0.41 },
];

// --- Sky guides the visitor can turn on (keys match the guides state)
// Each guide's switch on the rail, and the key that flips it.
export const guides = [
  {
    key: "constellations",
    label: "Constellations",
    short: "Constellations",
    code: "KeyG",
    icon: "constellations",
  },
  {
    key: "planets",
    label: "Planets",
    short: "Planets",
    code: "KeyP",
    icon: "planets",
  },
  {
    key: "details",
    label: "Star details on tap",
    short: "Star names",
    code: "KeyI",
    icon: "details",
  },
];

// --- Sound layers: how loud each sits in the mix, the low-pass that keeps
// it soft and far away (Hz), and how much a wind layer swells and ebbs
export const soundLayers = {
  leaves: { level: 0.14, lowpass: 5000, swell: 0.5 },
  breeze: { level: 0.08, lowpass: 420, swell: 0.6 },
  gusts: { level: 0.1, lowpass: 2000, swell: 0.7 },
  owl: { level: 0.07, lowpass: 4000 },
  "owl-horned": { level: 0.07, lowpass: 3000 },
  coyotes: { level: 0.05, lowpass: 3500 },
  wolves: { level: 0.05, lowpass: 3000 },
  whippoorwill: { level: 0.06, lowpass: 5000 },
  nightjar: { level: 0.05, lowpass: 5000 },
  boobook: { level: 0.07, lowpass: 3500 },
  "fiery-nightjar": { level: 0.06, lowpass: 5000 },
  jackal: { level: 0.05, lowpass: 4000 },
  "hawk-owl": { level: 0.07, lowpass: 3500 },
  crickets: { level: 0.07, lowpass: 3800 },
  frogs: { level: 0.08, lowpass: 5000 },
  surf: { level: 0.3, lowpass: 900 },
  river: { level: 0.16, lowpass: 1400 },
  lake: { level: 0.2, lowpass: 2200 },
};

// How much each kind of land rustles in the wind: woods most, grass and reeds
// less, bare ground not at all.
export const rustle = {
  conifer: 1,
  mixed: 1,
  broadleaf: 1,
  rainforest: 0.9,
  woodland: 0.8,
  shrubland: 0.4,
  savanna: 0.7,
  grassland: 0.6,
  wetland: 0.7,
  cropland: 0.5,
  urban: 0.5,
  snow: 0,
  sand: 0,
  rock: 0.1,
  ocean: 0,
  lake: 0.6,
  river: 0.6,
};

// Rough regions, for which animals call at night: [name, south, north, west,
// east] in degrees; the first that holds a place is its region.
export const regions = [
  ["new-zealand", -48, -33, 165, 180],
  ["australia", -45, -10, 112, 155],
  ["south-asia", -11, 30, 60, 155],
  ["north-asia", 30, 80, 60, 180],
  ["europe", 35, 72, -25, 60],
  ["africa", -36, 35, -20, 60],
  ["central-america", 7, 24, -118, -59],
  ["north-america", 24, 84, -170, -50],
  ["south-america", -56, 12.5, -82, -34],
];

// The region a place lies in, or null out at sea.
export const regionOf = ({ latitude, longitude }) =>
  regions.find(
    ([, south, north, west, east]) =>
      latitude >= south &&
      latitude <= north &&
      longitude >= west &&
      longitude <= east,
  )?.[0] ?? null;

// A kind of land's name, for a place: most are one name everywhere.
export const labelOf = (kind, site) =>
  typeof kind?.label === "function"
    ? kind.label(regionOf(site), site.latitude)
    : kind?.label;

// Night calls: the regions and kinds of land each is heard in, the months it
// calls (1 to 12, all year when absent), and the latitudes it keeps to.
const woods = ["conifer", "mixed", "broadleaf", "woodland"];
const open = ["grassland", "shrubland", "savanna", "cropland"];
export const nightCalls = {
  owl: {
    regions: ["europe", "north-asia"],
    covers: [...woods, "cropland", "urban"],
  },
  "owl-horned": {
    regions: ["north-america", "central-america", "south-america"],
    covers: [...woods, ...open, "urban", "sand", "rock"],
  },
  coyotes: {
    regions: ["north-america", "central-america"],
    covers: [...woods, ...open, "sand", "urban"],
  },
  wolves: {
    regions: ["north-america", "north-asia", "europe"],
    covers: ["conifer", "mixed", "snow", "grassland", "rock", "wetland"],
    latitudes: [40, 75],
  },
  whippoorwill: {
    regions: ["north-america"],
    covers: ["broadleaf", "mixed", "woodland"],
    months: [5, 6, 7, 8],
    longitudes: [-100, -60],
  },
  nightjar: {
    regions: ["europe", "north-asia"],
    covers: ["woodland", "shrubland", "conifer", "grassland"],
    months: [5, 6, 7, 8],
  },
  boobook: {
    regions: ["australia", "new-zealand"],
    covers: [...woods, ...open, "rainforest", "urban"],
  },
  "fiery-nightjar": {
    regions: ["africa"],
    covers: ["woodland", "savanna", "shrubland"],
    months: [9, 10, 11, 12, 1, 2, 3],
    latitudes: [-35, 5],
  },
  jackal: { regions: ["africa"], covers: [...open, "sand"] },
  "hawk-owl": {
    regions: ["south-asia"],
    covers: [...woods, "rainforest", "cropland", "urban"],
  },
};

// --- Field targets: what the field game asks the player to find. Stars and
// deep-sky objects sit at J2000 right ascension (hours) and declination
// (degrees); planets and the Moon move. `needs` is the faintest limiting
// magnitude, toward it, that shows it: a star's own magnitude, more for a
// diffuse glow whose light is spread out. `points` is its worth when logged.
export const targets = [
  {
    id: "moon",
    name: "The Moon",
    kind: "moon",
    points: 10,
    about: "Our Moon, any phase but new.",
  },
  {
    id: "sirius",
    name: "Sirius",
    kind: "star",
    ra: 6.7525,
    dec: -16.7161,
    needs: -1.46,
    points: 10,
    about: "The brightest star in the night sky.",
  },
  {
    id: "polaris",
    name: "Polaris",
    kind: "star",
    ra: 2.5303,
    dec: 89.2641,
    needs: 1.98,
    points: 15,
    about: "The North Star, still over the north pole of the sky.",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    kind: "planet",
    body: "Jupiter",
    points: 20,
    about: "The largest planet, bright and steady.",
  },
  {
    id: "venus",
    name: "Venus",
    kind: "planet",
    body: "Venus",
    points: 20,
    about: "The evening or morning star, never far from the Sun.",
  },
  {
    id: "mars",
    name: "Mars",
    kind: "planet",
    body: "Mars",
    points: 20,
    about: "The red planet.",
  },
  {
    id: "saturn",
    name: "Saturn",
    kind: "planet",
    body: "Saturn",
    points: 25,
    about: "The ringed planet.",
  },
  {
    id: "pleiades",
    name: "The Pleiades",
    kind: "deep",
    ra: 3.7833,
    dec: 24.1167,
    needs: 4,
    points: 20,
    about: "The Seven Sisters, a young star cluster.",
  },
  {
    id: "orion-nebula",
    name: "Orion Nebula",
    kind: "deep",
    ra: 5.5881,
    dec: -5.3911,
    needs: 5,
    points: 30,
    about: "A stellar nursery in Orion's sword.",
  },
  {
    id: "beehive",
    name: "Beehive Cluster",
    kind: "deep",
    ra: 8.6667,
    dec: 19.6833,
    needs: 5.5,
    points: 35,
    about: "A swarm of stars in Cancer.",
  },
  {
    id: "large-magellanic",
    name: "Large Magellanic Cloud",
    kind: "deep",
    ra: 5.3917,
    dec: -69.7561,
    needs: 5,
    points: 40,
    about: "A neighbouring galaxy, seen only from the south.",
  },
  {
    id: "galactic-center",
    name: "Heart of the Milky Way",
    kind: "deep",
    ra: 17.7611,
    dec: -29.0078,
    needs: 6,
    points: 40,
    about: "The bright star clouds toward our galaxy's centre.",
  },
  {
    id: "mercury",
    name: "Mercury",
    kind: "planet",
    body: "Mercury",
    points: 60,
    about: "Low in twilight, and rarely seen.",
  },
  {
    id: "andromeda",
    name: "Andromeda Galaxy",
    kind: "deep",
    ra: 0.7123,
    dec: 41.2692,
    needs: 5.8,
    points: 45,
    about: "The farthest thing the naked eye can see.",
  },
  {
    id: "lagoon",
    name: "Lagoon Nebula",
    kind: "deep",
    ra: 18.0631,
    dec: -24.3833,
    needs: 6.5,
    points: 45,
    about: "A glowing cloud in Sagittarius.",
  },
  {
    id: "jewel-box",
    name: "Jewel Box",
    kind: "deep",
    ra: 12.8936,
    dec: -60.3333,
    needs: 6,
    points: 45,
    about: "A cluster of colored stars by the Southern Cross.",
  },
  {
    id: "omega-centauri",
    name: "Omega Centauri",
    kind: "deep",
    ra: 13.4469,
    dec: -47.4794,
    needs: 5.5,
    points: 50,
    about: "The greatest globular cluster.",
  },
  {
    id: "hercules-cluster",
    name: "Hercules Cluster",
    kind: "deep",
    ra: 16.6948,
    dec: 36.4613,
    needs: 7,
    points: 50,
    about: "Half a million stars in a ball.",
  },
  {
    id: "uranus",
    name: "Uranus",
    kind: "planet",
    body: "Uranus",
    points: 60,
    about: "At the edge of naked-eye sight.",
  },
  {
    id: "ring-nebula",
    name: "Ring Nebula",
    kind: "deep",
    ra: 18.8931,
    dec: 33.0292,
    needs: 10,
    points: 80,
    about: "The shell of a dying star, in Lyra.",
  },
  {
    id: "neptune",
    name: "Neptune",
    kind: "planet",
    body: "Neptune",
    points: 90,
    about: "The farthest planet; it needs optics.",
  },
  {
    id: "whirlpool",
    name: "Whirlpool Galaxy",
    kind: "deep",
    ra: 13.498,
    dec: 47.1953,
    needs: 12,
    points: 120,
    about: "A spiral galaxy 30 million light years away.",
  },
];

// --- Awards in the field game, each earned by what the logbook and the traced
// constellations hold (`logged` and `traced` map ids to their entries).
const loggedAll =
  (...ids) =>
  ({ logged }) =>
    ids.every((id) => logged[id]);
const deepIds = targets
  .filter(({ kind }) => kind === "deep")
  .map(({ id }) => id);
export const awards = [
  {
    id: "first-light",
    name: "First light",
    about: "Log your first target.",
    earned: ({ logged }) => Object.keys(logged).length >= 1,
  },
  {
    id: "wanderers",
    name: "The wanderers",
    about: "Log Mercury, Venus, Mars, Jupiter and Saturn.",
    earned: loggedAll("mercury", "venus", "mars", "jupiter", "saturn"),
  },
  {
    id: "ice-giants",
    name: "Ice giants",
    about: "Log Uranus and Neptune.",
    earned: loggedAll("uranus", "neptune"),
  },
  {
    id: "southern-skies",
    name: "Southern skies",
    about: "Log the Large Magellanic Cloud, Omega Centauri and the Jewel Box.",
    earned: loggedAll("large-magellanic", "omega-centauri", "jewel-box"),
  },
  {
    id: "northern-lights",
    name: "Northern treasures",
    about: "Log Polaris, the Andromeda Galaxy and the Hercules Cluster.",
    earned: loggedAll("polaris", "andromeda", "hercules-cluster"),
  },
  {
    id: "deep-sky",
    name: "Deep sky",
    about: "Log five clusters, nebulae or galaxies.",
    earned: ({ logged }) => deepIds.filter((id) => logged[id]).length >= 5,
  },
  {
    id: "faint-fuzzies",
    name: "Faint fuzzies",
    about: "Log the Ring Nebula and the Whirlpool Galaxy.",
    earned: loggedAll("ring-nebula", "whirlpool"),
  },
  {
    id: "unaided",
    name: "With your own eyes",
    about: "Log the Andromeda Galaxy with the naked eye.",
    earned: ({ logged }) => logged.andromeda?.instrument === "eye",
  },
  {
    id: "purist",
    name: "Purist",
    about: "Log ten targets with no assists.",
    earned: ({ logged }) =>
      Object.values(logged).filter((entry) => !entry.assisted).length >= 10,
  },
  {
    id: "star-mapper",
    name: "Star mapper",
    about: "Trace three constellations from memory.",
    earned: ({ traced }) => Object.keys(traced).length >= 3,
  },
  {
    id: "cartographer",
    name: "Cartographer",
    about: "Trace twelve constellations from memory.",
    earned: ({ traced }) => Object.keys(traced).length >= 12,
  },
  {
    id: "gallery",
    name: "Gallery",
    about: "See five targets in detail through an eyepiece.",
    earned: ({ logged }) =>
      Object.values(logged).filter((entry) => entry.detail).length >= 5,
  },
  {
    id: "giant-planets",
    name: "Belts and rings",
    about: "See Jupiter and Saturn in detail through a telescope.",
    earned: ({ logged }) => logged.jupiter?.detail && logged.saturn?.detail,
  },
  {
    id: "centurion",
    name: "Five hundred",
    about: "Earn 500 points.",
    earned: ({ points }) => points >= 500,
  },
  {
    id: "logbook-full",
    name: "Logbook full",
    about: "Log every target.",
    earned: ({ logged }) => targets.every(({ id }) => logged[id]),
  },
];

// --- Pictures of famous objects, shown in the sky at their true size and turned
// north up, east left. `width` is how much sky (degrees) the picture spans, or for
// a planet the share of the picture its `radius` (km: Saturn's to the edge of its
// rings) fills across; `spin` turns the picture (degrees, counterclockwise as
// seen) to the object's true angle; `mask` keeps the object and fades the field
// stars around it: center and radii as shares of the picture, and its turn.
export const pictures = [
  {
    id: "orion-nebula",
    width: 0.5,
    spin: 0,
    mask: [0.5, 0.5, 0.48, 0.48, 0],
    credit: "NASA, ESA, M. Robberto and the Hubble Orion Treasury Project Team",
  },
  {
    id: "andromeda",
    width: 3.9,
    spin: -22,
    mask: [0.5, 0.5, 0.44, 0.17, -33],
    credit: "Adam Evans (CC BY 2.0)",
  },
  {
    id: "whirlpool",
    width: 0.25,
    spin: 90,
    mask: [0.52, 0.5, 0.5, 0.48, 0],
    credit: "NASA, ESA, S. Beckwith and the Hubble Heritage Team",
  },
  {
    id: "ring-nebula",
    width: 0.028,
    spin: 0,
    mask: [0.5, 0.5, 0.48, 0.48, 0],
    credit: "NASA, ESA and the Hubble Heritage Collaboration",
  },
  {
    id: "hercules-cluster",
    width: 0.55,
    spin: 0,
    mask: [0.5, 0.5, 0.3, 0.3, 0],
    credit: "Thedarksideobservatory (CC BY-SA 4.0)",
  },
  {
    id: "omega-centauri",
    width: 1,
    spin: 0,
    mask: [0.5, 0.5, 0.42, 0.42, 0],
    credit: "ESO/INAF-VST/OmegaCAM (CC BY 4.0)",
  },
  {
    id: "lagoon",
    width: 1.5,
    spin: 0,
    mask: [0.5, 0.52, 0.4, 0.34, 0],
    credit: "ESO/S. Guisard (CC BY 4.0)",
  },
  {
    id: "jupiter",
    body: "Jupiter",
    radius: 71492,
    fill: 0.9,
    spin: 0,
    credit: "NASA, ESA and A. Simon (GSFC)",
  },
  // The photograph (July 2020) shows the rings 21.3° open; they are squashed to
  // the real tilt on the night. `globe` is the planet's equatorial and polar
  // radius as shares of the ring radius, the part of the picture left round.
  {
    id: "saturn",
    body: "Saturn",
    radius: 136775,
    fill: 0.83,
    spin: 0,
    tilt: 21.3,
    globe: [0.44, 0.4],
    credit: "NASA, ESA, A. Simon (GSFC) and M.H. Wong (UC Berkeley)",
  },
  {
    id: "mars",
    body: "Mars",
    radius: 3390,
    fill: 0.86,
    spin: 0,
    credit:
      "NASA, ESA, the Hubble Heritage Team, J. Bell and M. Wolff (CC BY 4.0)",
  },
];
