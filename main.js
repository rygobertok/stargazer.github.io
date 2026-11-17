/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

import * as THREE from "three";
import { gsap } from "gsap";
import * as config from "./config.js";
import {
  defaultSite,
  compass,
  galacticCenter,
  instruments,
  lightPollutionZones,
  conditionControls,
  moonPhases,
  darkSkyPlaces,
  covers,
  shores,
  landCover,
  groundAliases,
  starSets,
  planets,
  guides,
  soundLayers,
  rustle,
  regionOf,
  labelOf as landLabel,
  nightCalls,
  targets,
  awards,
  pictures,
} from "./data.js";
import { stored } from "./game.js";
import { getState, setState, subscribe, watch } from "./state.js";
import {
  loadStars,
  loadLightPollution,
  fetchWeather,
  weatherAt,
  assetUrl,
  searchPlaces,
  nameOf,
  detailsOf,
  loadElevationTile,
  loadPixels,
  loadBytes,
  starListSize,
  loadStarNames,
  loadConstellations,
} from "./api.js";
import {
  skyVertex,
  skyFragment,
  starVertex,
  starFragment,
  moonVertex,
  moonFragment,
  haloVertex,
  haloFragment,
  lineVertex,
  lineFragment,
  figureStarVertex,
  figureStarFragment,
  visibilityVertex,
  visibilityFragment,
  skyMapFragment,
  cloudMapFragment,
} from "./shaders.js";
import {
  anchorPanels,
  placePanel,
  trackIdle,
  createGlobe,
  createSearch,
  createGround,
  createSoundscape,
  createLoading,
} from "./components.js";
import {
  clamp,
  skyMatrix,
  equatorialVector,
  applyMatrix,
  horizontalOf,
  sceneDirection,
  countBrighterThan,
  tonight,
  sunAltitude,
  nightMidnight,
  formatSiteTime,
  formatClock,
  isoDate,
  localFields,
  zonedInstant,
  zoneAt,
  horizonDomes,
  nanoLamberts,
  opticsOf,
  extinctionOf,
  zenithSky,
  sunState,
  moonState,
  parseCoordinates,
  formatCoordinates,
  planetStates,
  compassPoint,
  readSettings,
  nextRise,
  placeAt,
  ringTilt,
  tideHeight,
} from "./utils.js";

const DEG = Math.PI / 180;
const root = document.querySelector(".scene");
const canvas = root.querySelector(".sky");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const instrumentById = Object.fromEntries(
  instruments.map((instrument) => [instrument.id, instrument]),
);

// --- Renderer, camera, scene
// Logarithmic depth lets one camera hold grass at arm's length and ridges 100 km away.
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
  logarithmicDepthBuffer: true,
});
renderer.setClearColor(config.renderer.clearColor);
renderer.autoClear = false;
const camera = new THREE.PerspectiveCamera(
  config.view.fovLandscape,
  1,
  0.05,
  400000,
);
camera.rotation.order = "YXZ";
camera.position.y = config.terrain.eyeHeight;
const world = new THREE.Scene();

const fovFor = (aspect) =>
  aspect >= 1
    ? config.view.fovLandscape
    : Math.min(
        config.view.fovMax,
        (2 *
          Math.atan(
            Math.tan((config.view.fovPortraitHorizontal * DEG) / 2) / aspect,
          )) /
          DEG,
      );

const loadTexture = (path) => {
  const texture = new THREE.TextureLoader().load(assetUrl(path));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

// --- Sky model uniforms, shared by the sky, star and marker shaders
const exposure = { value: 0 };
const model = {
  uSunDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonPhaseAngle: { value: 90 },
  uNatural: { value: nanoLamberts(config.visibility.naturalZenith) },
  uArtificial: { value: 0 },
  uDomes: { value: new Array(config.lightPollutionGrid.domeSectors).fill(0) },
  uDomeHeight: { value: config.lightPollutionGrid.domeHeight },
  uExtinction: { value: 0.2 },
  uSkyFactor: { value: 1 },
  uGain: { value: 0 },
  uCloudCover: { value: 0 },
  uCloudOffset: { value: new THREE.Vector2(0, 0) },
  // What the eye is adapted to: the sky overhead (nL), and the daylight regime.
  uAdapt: { value: nanoLamberts(config.visibility.naturalZenith) },
  uCeiling: { value: config.sky.ceiling },
  uDayKey: { value: config.sky.dayKey },
  uDayRange: { value: new THREE.Vector2(...config.sky.dayRange) },
};

// --- Sky map: the sky model's four sources toward every direction, worked out
// once a frame on a small map (azimuth across, altitude up) and read by every
// pixel of the sky dome and its reflection, instead of the model running per pixel.
const skyMap = new THREE.WebGLRenderTarget(
  config.renderer.skyMap[0],
  config.renderer.skyMap[1],
  {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  },
);
skyMap.texture.wrapS = THREE.RepeatWrapping;
skyMap.texture.wrapT = THREE.ClampToEdgeWrapping;
// The cloud layer's density per direction, likewise, drawn only while there is cloud.
const cloudMap = new THREE.WebGLRenderTarget(
  config.renderer.skyMap[0],
  config.renderer.skyMap[1],
  {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  },
);
cloudMap.texture.wrapS = THREE.RepeatWrapping;
cloudMap.texture.wrapT = THREE.ClampToEdgeWrapping;

// --- Sky dome
// Phones get the 4K maps of the Milky Way and the night Earth; desktops able to
// hold an 8K texture get the sharper ones.
const phone =
  window.matchMedia("(pointer: coarse)").matches &&
  Math.min(screen.width, screen.height) < 1000;
const sharpMaps = !phone && renderer.capabilities.maxTextureSize >= 8192;
const milkyWay = loadTexture(
  sharpMaps ? config.assets.milkyWaySharp : config.assets.milkyWay,
);
milkyWay.generateMipmaps = false;
milkyWay.minFilter = THREE.LinearFilter;
milkyWay.wrapS = THREE.RepeatWrapping;

const skyUniforms = {
  ...model,
  uMilkyWay: { value: milkyWay },
  uToEquatorial: { value: new THREE.Matrix3() },
  uGround: { value: new THREE.Vector3(...config.sky.groundColor) },
  uMilkyWayGain: { value: config.sky.milkyWayGain },
  uMilkyWaySaturation: { value: config.sky.milkyWaySaturation },
  uDisplay: { value: config.sky.display },
  uExposure: exposure,
  uDither: { value: config.sky.dither },
  uDeep: { value: null },
  uDeepWeights: { value: new THREE.Vector3() },
  uDeepGain: { value: 0 },
  uSkyMap: { value: skyMap.texture },
  uCloudMap: { value: cloudMap.texture },
};

world.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(900, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      // Both sides, so the mirrored reflection pass still sees it.
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  ),
);

// --- Visibility map: limits and clouds per direction, worked out once a frame
// on a small grid instead of once per star.
const visibility = new THREE.WebGLRenderTarget(512, 128, {
  type: THREE.HalfFloatType,
  depthBuffer: false,
  magFilter: THREE.NearestFilter,
  minFilter: THREE.NearestFilter,
});
visibility.texture.wrapS = THREE.RepeatWrapping;
const visibilityScene = new THREE.Scene();
visibilityScene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: model,
      vertexShader: visibilityVertex,
      fragmentShader: visibilityFragment,
      depthTest: false,
    }),
  ),
);
const flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const skyMapScene = new THREE.Scene();
skyMapScene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: model,
      vertexShader: visibilityVertex,
      fragmentShader: skyMapFragment,
      depthTest: false,
    }),
  ),
);
const cloudMapScene = new THREE.Scene();
cloudMapScene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: model,
      vertexShader: visibilityVertex,
      fragmentShader: cloudMapFragment,
      depthTest: false,
    }),
  ),
);

// --- Stars, and markers for the stars that cannot be seen
const starUniforms = {
  uVisibility: { value: visibility.texture },
  ...model,
  uSky: { value: new THREE.Matrix3() },
  uMarkers: { value: 0 },
  uCloudDimming: { value: config.visibility.cloudDimming },
  uPixelRatio: { value: 1 },
  uMinSize: { value: config.stars.minSize },
  uMaxSize: { value: config.stars.maxSize },
  uFaintAlpha: { value: config.stars.faintAlpha },
  uAlphaPower: { value: config.stars.alphaPower },
  uSizePower: { value: config.stars.sizePower },
  uSaturation: { value: config.stars.saturation },
  uTime: { value: 0 },
  uTwinkle: { value: reducedMotion.matches ? 0 : config.stars.twinkle },
  uTwinkleRate: { value: config.stars.twinkleRate },
  uTwinkleChroma: { value: config.stars.twinkleChroma },
  uTurbulence: { value: 1 },
  uApertureFlicker: { value: 1 },
  uSteady: { value: 0 },
  uGlare: { value: config.stars.glare },
  uCrowd: { value: 1 },
  // 1 while looking into an eyepiece.
  uOptics: { value: 0 },
  uExposure: exposure,
};

const pointMaterial = (uniforms, depthTest = false) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: starVertex,
    fragmentShader: starFragment,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest,
    transparent: true,
  });

const starMaterial = pointMaterial(starUniforms);
const markerMaterial = pointMaterial({
  ...starUniforms,
  uMarkers: { value: 1 },
});

const pointsOf = (geometry, material, order) => {
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = order;
  return points;
};

const starGeometry = (bytes) => {
  const geometry = new THREE.BufferGeometry();
  const shorts = new THREE.InterleavedBuffer(new Int16Array(bytes.buffer), 4);
  const octets = new THREE.InterleavedBuffer(new Uint8Array(bytes.buffer), 8);
  geometry.setAttribute(
    "position",
    new THREE.InterleavedBufferAttribute(shorts, 3, 0, true),
  );
  geometry.setAttribute(
    "magColor",
    new THREE.InterleavedBufferAttribute(octets, 2, 6, false),
  );
  return geometry;
};

// --- Star layers: the naked-eye list, and the optional sets once downloaded
const layers = {};

const addStarLayer = (name, bytes) => {
  const geometry = starGeometry(bytes);
  const points = pointsOf(geometry, starMaterial, 1);
  const markers = pointsOf(geometry, markerMaterial, 1);
  world.add(points, markers);
  layers[name] = { bytes, points, markers };
  return geometry;
};

// The deep set is gathered onto a grid of tiny sky patches, one magnitude bin
// per color channel, flux per unit of sky, then drawn as a fine glow.
const DEEP_CHUNK = 400000;
const bakeDeepStars = async (bytes) => {
  const { width, height, bins } = config.deepStars;
  const grid = new Float32Array(width * height * 4);
  const count = bytes.length / 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bake = (start) => {
    new Uint32Array(Math.min(DEEP_CHUNK, count - start)).forEach((_, k) => {
      const i = start + k;
      const x = view.getInt16(i * 8, true) / 32767;
      const y = view.getInt16(i * 8 + 2, true) / 32767;
      const z = view.getInt16(i * 8 + 4, true) / 32767;
      const magnitude = view.getUint8(i * 8 + 6) / 16 - 1.5;
      const bin = bins.findIndex(
        (edge, b) => b < bins.length - 1 && magnitude <= bins[b + 1],
      );
      if (bin < 0) return;
      const u = (((0.5 - Math.atan2(y, x) / (2 * Math.PI)) % 1) + 1) % 1;
      const v = 0.5 + Math.asin(clamp(z, -1, 1)) / Math.PI;
      const column = Math.min(width - 1, Math.floor(u * width));
      const row = Math.min(height - 1, Math.floor(v * height));
      grid[(row * width + column) * 4 + bin] +=
        10 ** (-0.4 * (magnitude - 14)) / Math.max(Math.sqrt(1 - z * z), 0.02);
    });
  };
  const starts = Array.from(
    { length: Math.ceil(count / DEEP_CHUNK) },
    (_, i) => i * DEEP_CHUNK,
  );
  await starts.reduce(
    (done, start) =>
      done.then(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              bake(start);
              resolve();
            }, 0);
          }),
      ),
    Promise.resolve(),
  );
  const texture = new THREE.DataTexture(
    Uint16Array.from(grid, (value) => THREE.DataUtils.toHalfFloat(value)),
    width,
    height,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

// Phones get the full set; the deep set is desktop only.
const desktop = !phone;
const setsFor = (instrument) => {
  if (instrument.stars === "deep") return desktop ? ["full", "deep"] : ["full"];
  return instrument.stars === "full" ? ["full"] : [];
};

// --- The ground around the observer
// Loading the place, shown quietly beside its details.
const loading = createLoading({ root, linger: config.ui.loadingLinger });

const ground = createGround({
  renderer,
  shared: { ...model, uDisplay: skyUniforms.uDisplay, uExposure: exposure },
  settings: config.terrain,
  land: config.land,
  covers,
  shores,
  landCover,
  progress: loading,
  urls: {
    ground: (path) => assetUrl(`${config.assets.ground}${path}`),
    models: (path) => assetUrl(`${config.assets.models}${path}`),
    trees: (path) => assetUrl(`${config.assets.trees}${path}`),
    waves: assetUrl(config.assets.waves),
  },
  loadTile: loadElevationTile,
  loadPixels,
  loadBytes,
});

// Moonlight and sunlight reaching the ground through the air.
const lightReaching = (body, extinction, full) => {
  if (body.altitude <= -1) return 0;
  const mass =
    1 /
    (Math.max(Math.sin(body.altitude * DEG), 0) +
      0.50572 * (Math.max(body.altitude, 0) + 6.07995) ** -1.6364);
  return (
    full *
    10 ** (-0.4 * extinction * mass) *
    clamp((body.altitude + 1) / 3, 0, 1)
  );
};

// --- Light pollution grid, once loaded, for the sky at any point
let lightGrid = null;

const skyAt = (latitude, longitude) => {
  if (!lightGrid) return null;
  const zone =
    lightPollutionZones[
      zoneAt(lightGrid, config.lightPollutionGrid, latitude, longitude)
    ];
  return {
    zone: zone.zone,
    brightness:
      config.visibility.naturalZenith - 2.5 * Math.log10(1 + zone.ratio),
  };
};

// --- The Moon and its glow
const moonGeometry = new THREE.SphereGeometry(1, 48, 24);
// Turn the map so longitude 0 (the face toward Earth) sits on +z, which lookAt aims at us.
moonGeometry.rotateY(-Math.PI / 2);
const moonUniforms = {
  uMap: { value: loadTexture(config.assets.moon) },
  uSunDir: model.uSunDir,
  uBrightness: { value: config.moon.brightness },
  uExposure: exposure,
};
const moonMesh = new THREE.Mesh(
  moonGeometry,
  new THREE.ShaderMaterial({
    uniforms: moonUniforms,
    vertexShader: moonVertex,
    fragmentShader: moonFragment,
    side: THREE.DoubleSide,
  }),
);
const sizeMoon = (diameter) =>
  moonMesh.scale.setScalar(
    config.moon.distance * Math.tan((diameter / 2) * DEG),
  );
sizeMoon(config.moon.diameter);
moonMesh.renderOrder = 3;

const haloUniforms = { uStrength: { value: 0 }, uExposure: exposure };
const halo = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShaderMaterial({
    uniforms: haloUniforms,
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  }),
);
halo.scale.setScalar(
  2 * config.moon.distance * Math.tan(config.moon.haloDegrees * DEG),
);
halo.renderOrder = 2;
world.add(moonMesh, halo);

// --- Conditions: live weather and the atlas, unless the visitor overrides them
const ratioFromBrightness = (brightness) =>
  Math.max(
    0,
    10 ** (-0.4 * (brightness - config.visibility.naturalZenith)) - 1,
  );
const brightnessFromRatio = (ratio) =>
  config.visibility.naturalZenith - 2.5 * Math.log10(1 + ratio);

// Only cloud layers above the site hide its sky.
const cloudsAbove = (at, elevation) => {
  if (!at?.cloudLayers) return at?.cloudCover;
  const [lowTop, midTop] = config.visibility.cloudLayerTops;
  const fade = config.visibility.cloudLayerFade;
  const weights = [lowTop, midTop, Infinity].map((top) =>
    clamp((top + fade / 2 - elevation) / fade, 0, 1),
  );
  const clear = at.cloudLayers.reduce(
    (product, cover, i) => product * (1 - (cover / 100) * weights[i]),
    1,
  );
  return (1 - clear) * 100;
};

const effectiveConditions = ({
  weather,
  override,
  lightPollution,
  site,
  mode,
  assists,
}) => ({
  ...config.weather.fallback,
  ...(weather.at ?? {}),
  ...(weather.at
    ? { cloudCover: cloudsAbove(weather.at, site?.elevation ?? 0) }
    : {}),
  brightness: brightnessFromRatio(lightPollution?.ratio ?? 0),
  // The field game plays the real weather; only the clear-skies assist changes it.
  ...(mode === "game" ? {} : (override ?? {})),
  ...(assists?.clouds ? { cloudCover: 0 } : {}),
});

const skyNow = (state, instrument = viewing(state)) => {
  const conditions = effectiveConditions(state);
  const extinction = extinctionOf(
    config.visibility,
    state.site.elevation,
    conditions,
  );
  const sun = sunState(state.site, state.time);
  const moon = moonState(state.site, state.time);
  return {
    conditions,
    extinction,
    sun,
    moon,
    ratio: ratioFromBrightness(conditions.brightness),
    zenith: zenithSky({
      natural: config.visibility.naturalZenith,
      ratio: ratioFromBrightness(conditions.brightness),
      extinction,
      sun,
      moon,
      optics: opticsOf(instrument),
    }),
  };
};

// --- Sky orientation and everything that follows from the state
let currentSky = null;

const orientSky = ({ site, time }) => {
  const m = skyMatrix(site, time);
  currentSky = m;
  starUniforms.uSky.value.set(...m.flat());
  turnCharts(m);
  turnPictures(m);
  skyUniforms.uToEquatorial.value.copy(starUniforms.uSky.value).transpose();
  return m;
};

const wind = { speed: 0, direction: 0 };

const placeMoon = (moon, m) => {
  const direction = new THREE.Vector3(...moon.direction);
  moonMesh.position.copy(direction).multiplyScalar(config.moon.distance);
  moonMesh.up.set(m[0][2], m[1][2], m[2][2]);
  // The sky travels with the walker, so the Moon faces the sky's own centre.
  moonMesh.lookAt(world.position);
  halo.position.copy(direction).multiplyScalar(config.moon.distance * 0.99);
  halo.lookAt(world.position);
  const lunarFlux =
    10 ** (-0.4 * (0.026 * moon.phaseAngle + 4e-9 * moon.phaseAngle ** 4));
  haloUniforms.uStrength.value =
    config.moon.haloStrength * lunarFlux * clamp(moon.altitude / 4, 0, 1);
  moonMesh.visible = moon.altitude > -1;
  halo.visible = moonMesh.visible;
};

// The catalog the sky draws from: the fullest one downloaded, up to the one the
// player chose. Each adds fainter stars to those before it.
const CATALOGS = ["naked", "full", "deep"];
const catalogInUse = (state) => {
  const ceiling = CATALOGS.indexOf(state.catalog ?? "deep");
  const ready = (name) => state.starSets?.[name]?.status === "ready";
  if (ceiling >= 2 && ready("full") && ready("deep")) return "deep";
  if (ceiling >= 1 && ready("full")) return "full";
  return "naked";
};

const applyDrawRange = (state, reach) => {
  const using = CATALOGS.indexOf(catalogInUse(state));
  const deepReady = using === 2;
  Object.entries(layers).forEach(([name, layer]) => {
    const used = CATALOGS.indexOf(name) <= using;
    layer.points.visible = used;
    const depth =
      name === "full" && deepReady
        ? Math.min(reach + 0.3, config.deepStars.handover)
        : reach + 0.3;
    const total = layer.bytes.length / 8;
    const faint = state.showFaint && state.mode !== "game";
    layer.points.geometry.setDrawRange(
      0,
      faint ? total : countBrighterThan(layer.bytes, depth),
    );
    layer.markers.visible = faint && used;
  });
  starUniforms.uCrowd.value =
    1 /
    (1 +
      config.stars.crowdFalloff * Math.max(0, reach - config.stars.crowdFrom));
  const { bins, gain } = config.deepStars;
  skyUniforms.uDeepGain.value = deepReady ? gain : 0;
  skyUniforms.uDeepWeights.value.set(
    ...bins
      .slice(0, 3)
      .map((low, i) => clamp((reach - low) / (bins[i + 1] - low), 0, 1)),
  );
};

const applySky = (state) => {
  const m = orientSky(state);
  const now = skyNow(state);
  const optics = opticsOf(viewing(state));
  model.uSunDir.value.set(...now.sun.direction);
  model.uMoonDir.value.set(...now.moon.direction);
  model.uMoonPhaseAngle.value = now.moon.phaseAngle;
  model.uArtificial.value = now.ratio;
  model.uDomes.value =
    state.lightPollution?.domes ?? model.uDomes.value.map(() => 0);
  model.uExtinction.value = now.extinction;
  model.uSkyFactor.value = optics.skyFactor;
  model.uGain.value = optics.gain;
  model.uCloudCover.value = now.conditions.cloudCover / 100;
  model.uAdapt.value = Object.values(now.zenith.sources).reduce(
    (sum, source) => sum + source,
    0,
  );
  wind.speed = now.conditions.windSpeed;
  wind.direction = now.conditions.windDirection;
  // Stars flicker more when the air churns, and less through a wide aperture,
  // which averages the flicker over its whole width (as aperture to the -2/3).
  starUniforms.uTurbulence.value =
    1 + (now.conditions.windSpeed ?? 0) / config.stars.turbulenceWind;
  starUniforms.uApertureFlicker.value = Math.min(
    1,
    (viewing(state).aperture / 7) ** (-2 / 3),
  );
  placeMoon(now.moon, m);
  // The glow around the Moon is sky, dimmed by the optics like the rest of it.
  haloUniforms.uStrength.value *= optics.skyFactor;
  applyDrawRange(state, now.zenith.instrument);
  const lunarFlux =
    10 **
    (-0.4 * (0.026 * now.moon.phaseAngle + 4e-9 * now.moon.phaseAngle ** 4));
  ground.setLight({
    overhead: Object.values(now.zenith.sources),
    moon: lightReaching(
      now.moon,
      now.extinction,
      config.terrain.fullMoonLight * lunarFlux,
    ),
    sun: lightReaching(now.sun, now.extinction, config.terrain.sunLight),
    moonDir: now.moon.direction,
    sunDir: now.sun.direction,
    extinction: now.extinction,
  });
  ground.setTide(tideHeight(state.site, state.time, config.land.tide));
  ground.setWind(now.conditions.windSpeed, now.conditions.windDirection);
  return now;
};

// --- Looking around
const look = {
  yaw: 0,
  pitch: 0,
  yawVelocity: 0,
  pitchVelocity: 0,
  dragging: false,
  keys: new Set(),
};

const aimAt = (altitude, azimuth) => {
  look.yaw = -azimuth * DEG;
  look.pitch =
    clamp(altitude, config.view.pitchMin, config.view.pitchMax) * DEG;
};

// Open on the galactic center when it is up, otherwise face south.
const aimFirstView = (m) => {
  const center = horizontalOf(applyMatrix(m, equatorialVector(galacticCenter)));
  if (center.altitude > config.view.galacticCenterMinAltitude)
    aimAt(clamp(center.altitude, 12, 48), center.azimuth);
  else aimAt(config.view.fallbackPitch, 180);
};

const radiansPerPixel = () => (camera.fov * DEG) / window.innerHeight;

let lastPointer = null;

canvas.addEventListener("pointerdown", (event) => {
  if (lastPointer || getState().view !== "ground") return;
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // A pointer that is already gone cannot be captured; the drag still works.
  }
  lastPointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    startX: event.clientX,
    startY: event.clientY,
    startT: event.timeStamp,
  };
  look.dragging = true;
  look.yawVelocity = 0;
  look.pitchVelocity = 0;
});

canvas.addEventListener("pointermove", (event) => {
  if (!lastPointer || event.pointerId !== lastPointer.id) return;
  const scale = radiansPerPixel();
  const dYaw = (event.clientX - lastPointer.x) * scale;
  const dPitch = (event.clientY - lastPointer.y) * scale;
  const dt = Math.max((event.timeStamp - lastPointer.t) / 1000, 1 / 240);
  look.yaw += dYaw;
  look.pitch = clamp(
    look.pitch + dPitch,
    pitchFloor(),
    config.view.pitchMax * DEG,
  );
  if (
    Math.hypot(
      event.clientX - lastPointer.startX,
      event.clientY - lastPointer.startY,
    ) > 40
  ) {
    learn("looked");
    putOfferAway();
  }
  look.yawVelocity = look.yawVelocity * 0.5 + (dYaw / dt) * 0.5;
  look.pitchVelocity = look.pitchVelocity * 0.5 + (dPitch / dt) * 0.5;
  lastPointer = {
    ...lastPointer,
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
  };
});

const endDrag = (event) => {
  if (!lastPointer || event.pointerId !== lastPointer.id) return;
  const tapped =
    event.type === "pointerup" &&
    Math.hypot(
      event.clientX - lastPointer.startX,
      event.clientY - lastPointer.startY,
    ) < 6 &&
    event.timeStamp - lastPointer.startT < 450;
  if (tapped) {
    // As in a game: with the mouse captured a click picks what is under the cross;
    // otherwise it captures the mouse, unless it lands on a constellation to pin.
    if (document.pointerLockElement === canvas)
      tapAt(window.innerWidth / 2, window.innerHeight / 2);
    else if (touchFirst || draw.active || figureState.hovered !== null)
      tapAt(event.clientX, event.clientY);
    else captureMouse();
  }
  // A pause before letting go means the sky should stop where it is.
  // A mount stays where it is let go.
  if (
    event.timeStamp - lastPointer.t > 80 ||
    reducedMotion.matches ||
    mounted(viewing(getState()))
  ) {
    look.yawVelocity = 0;
    look.pitchVelocity = 0;
  }
  lastPointer = null;
  look.dragging = false;
};

["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
  canvas.addEventListener(type, endDrag),
);

const ARROWS = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

window.addEventListener("keydown", (event) => {
  if (
    !ARROWS[event.key] ||
    getState().view !== "ground" ||
    event.target.closest?.(".panel, input")
  )
    return;
  event.preventDefault();
  look.keys.add(event.key);
  putOfferAway();
});
window.addEventListener("keyup", (event) => look.keys.delete(event.key));
window.addEventListener("blur", () => look.keys.clear());

const stepLook = (dt, t) => {
  const keySpeed = config.view.keyDegreesPerSecond * DEG * dt * aimScale();
  [...look.keys].forEach((key) => {
    look.yaw += ARROWS[key][0] * keySpeed;
    look.pitch += ARROWS[key][1] * keySpeed;
  });
  if (!look.dragging) {
    const decay = 0.5 ** (dt / config.view.inertiaHalfLife);
    look.yaw += look.yawVelocity * dt;
    look.pitch += look.pitchVelocity * dt;
    look.yawVelocity *= decay;
    look.pitchVelocity *= decay;
  }
  look.pitch = clamp(look.pitch, pitchFloor(), config.view.pitchMax * DEG);
  const sway = swayOf(t, dt);
  camera.rotation.set(look.pitch + sway.pitch, look.yaw + sway.yaw, 0);
};

// --- Walking, with the mechanics of a first-person game: WASD (or a joystick on
// touch screens) to move, Shift to run, the mouse to look once it is captured.
const walking = {
  keys: new Set(),
  stick: new THREE.Vector2(),
  velocity: new THREE.Vector2(),
  centre: null,
  rebuilding: false,
  walked: new THREE.Vector2(),
};
const MOVES = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] };

window.addEventListener("keydown", (event) => {
  if (getState().view !== "ground" || event.target.closest?.(".panel, input"))
    return;
  if (MOVES[event.code] || event.code.startsWith("Shift"))
    walking.keys.add(event.code);
});
window.addEventListener("keyup", (event) => walking.keys.delete(event.code));
window.addEventListener("blur", () => walking.keys.clear());

// Where the walker stands relative to the ground's centre, and the land under them.
const footing = (x, z) => ground.surfaceAt(x, z);

// The land is rebuilt around the walker so its detail stays where they are.
const recentre = async () => {
  if (walking.rebuilding || !walking.centre) return;
  walking.rebuilding = true;
  const { x, z } = camera.position;
  const centre = placeAt(walking.centre, x, z);
  const before = ground.land;
  try {
    const land = await ground.setSite(centre, null, { walked: [x, z] });
    if (land) {
      walking.centre = centre;
      camera.position.x -= x;
      camera.position.z -= z;
      // Heights are measured from each centre's own ground.
      camera.position.y -= land.h0 - before.h0;
      if (rig.at) {
        rig.at.x -= x;
        rig.at.z -= z;
      }
      remeasureHorizon();
    }
  } catch (error) {
    console.error(error);
  }
  walking.rebuilding = false;
};

const stepWalk = (dt) => {
  const input = new THREE.Vector2(
    [...walking.keys].reduce((sum, key) => sum + (MOVES[key]?.[0] ?? 0), 0) +
      walking.stick.x,
    [...walking.keys].reduce((sum, key) => sum + (MOVES[key]?.[1] ?? 0), 0) +
      walking.stick.y,
  );
  const running =
    walking.keys.has("ShiftLeft") ||
    walking.keys.has("ShiftRight") ||
    walking.stick.length() > 0.92;
  if (input.lengthSq() > 1) input.normalize();
  if (
    input.lengthSq() > 0.01 &&
    (rig.setting || mounted(instrumentById[getState().instrument]))
  )
    walkingStarted();
  // Forward is where the camera faces, flattened onto the ground.
  const forward = new THREE.Vector2(-Math.sin(look.yaw), -Math.cos(look.yaw));
  const right = new THREE.Vector2(Math.cos(look.yaw), -Math.sin(look.yaw));
  const target = forward
    .multiplyScalar(input.y)
    .add(right.multiplyScalar(input.x))
    .multiplyScalar(running ? config.walk.runSpeed : config.walk.speed);
  walking.velocity.lerp(target, 1 - Math.exp(-config.walk.grip * dt));
  if (walking.velocity.lengthSq() < 1e-6) return;
  if (walking.velocity.length() > 0.5) {
    learn("moved");
    putOfferAway();
  }
  const step = walking.velocity.clone().multiplyScalar(dt);
  const { x, z } = camera.position;
  // Water and rocks stop the walker; along them they slide instead of sticking.
  // A walker set down on water can still wade out of it.
  const dry = footing(x, z) !== null;
  const kit = rig.model?.group;
  const open = ([px, pz]) =>
    (footing(px, pz) !== null || !dry) &&
    !ground.blocked(px, pz, config.walk.radius) &&
    !(kit && Math.hypot(px - kit.position.x, pz - kit.position.z) < 0.45);
  const options = [
    [x + step.x, z + step.y],
    [x + step.x, z],
    [x, z + step.y],
  ];
  const [nx, nz] = options.find(open) ?? [x, z];
  if (nx === x) walking.velocity.x = 0;
  if (nz === z) walking.velocity.y = 0;
  walking.walked.x += nx - x;
  walking.walked.y += nz - z;
  camera.position.x = nx;
  camera.position.z = nz;
  if (Math.hypot(nx, nz) > config.walk.recentre) recentre();
};

const settleEyes = (dt) => {
  const height = footing(camera.position.x, camera.position.z);
  if (height === null) return;
  const eyes = height + config.terrain.eyeHeight;
  camera.position.y +=
    (eyes - camera.position.y) * (1 - Math.exp(-config.walk.stride * dt));
};

// Walk mode: on a mouse, the pointer is captured for looking; on touch, a joystick.
const walkHint = root.querySelector(".walk-hint");
const lookHint = root.querySelector(".look-hint");
const joystick = root.querySelector(".joystick");
const knob = joystick.querySelector(".joystick-knob");
const touchFirst = window.matchMedia("(pointer: coarse)").matches;
root.dataset.touch = String(touchFirst);
let hintTimer = 0;

const hint = (text) => {
  walkHint.textContent = text;
  walkHint.dataset.show = "true";
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    walkHint.dataset.show = "false";
  }, config.walk.hintSeconds * 1000);
};

// A toolbar control's name and what it is set to.
const setTool = (button, name, setting = "") => {
  button.querySelector(".tool-name").textContent = name;
  button.querySelector(".tool-state").textContent = setting;
};

// Moving as in a game: W A S D walk at any time, a click on the sky takes the mouse
// to look with it, and Esc lets it go; on touch screens the stick walks. How is
// shown under the crosshair until the walker has both moved and looked around.
const learned = { moved: false, looked: false };
const kbd = (...keys) => keys.map((key) => `<kbd>${key}</kbd>`).join("");
const renderLookHint = () => {
  const locked = document.pointerLockElement === canvas;
  const done = learned.moved && learned.looked;
  lookHint.dataset.show = String(!done || locked);
  if (touchFirst) lookHint.innerHTML = "Drag to look around · the stick walks";
  else if (locked)
    lookHint.innerHTML = `Move the mouse to look · click to pick what is under the cross · ${kbd("Esc")} lets go`;
  else
    lookHint.innerHTML = `${kbd("W", "A", "S", "D")} walk · ${kbd("Shift")} run · click the sky to look around`;
  // Once learned, the captured-mouse line shows for a moment and goes.
  clearTimeout(renderLookHint.timer);
  if (done && locked)
    renderLookHint.timer = setTimeout(() => {
      lookHint.dataset.show = "false";
    }, config.walk.hintSeconds * 1000);
};
const learn = (what) => {
  if (learned[what]) return;
  learned[what] = true;
  renderLookHint();
};
renderLookHint();

async function captureMouse() {
  try {
    await canvas.requestPointerLock();
  } catch {
    // Without a captured pointer, dragging still looks around.
  }
}

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  root.dataset.looking = String(locked);
  if (locked) learn("looked");
  renderLookHint();
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;
  if (Math.abs(event.movementX) + Math.abs(event.movementY) > 2) putOfferAway();
  const sensitivity = config.walk.lookSensitivity * aimScale();
  look.yaw -= event.movementX * sensitivity;
  look.pitch = clamp(
    look.pitch - event.movementY * sensitivity,
    pitchFloor(),
    config.view.pitchMax * DEG,
  );
});

let stickPointer = null;
const moveStick = (event) => {
  const box = joystick.getBoundingClientRect();
  const offset = new THREE.Vector2(
    event.clientX - box.left - box.width / 2,
    event.clientY - box.top - box.height / 2,
  );
  offset.clampLength(0, config.walk.joystickRadius);
  knob.style.transform = `translate(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px)`;
  walking.stick.set(
    offset.x / config.walk.joystickRadius,
    -offset.y / config.walk.joystickRadius,
  );
};
joystick.addEventListener("pointerdown", (event) => {
  stickPointer = event.pointerId;
  try {
    joystick.setPointerCapture(event.pointerId);
  } catch {
    // A pointer that is already gone cannot be captured.
  }
  moveStick(event);
});
joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId === stickPointer) moveStick(event);
});
["pointerup", "pointercancel"].forEach((type) =>
  joystick.addEventListener(type, (event) => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null;
    walking.stick.set(0, 0);
    knob.style.transform = "";
  }),
);

// --- The instrument in use. Hand-held binoculars go up to the eyes and sway with
// the hands; tripod binoculars and telescopes are set up on the ground where the
// walker stands, take a moment to set up, and are aimed by moving them. Walking
// steps away from set-up equipment, which stays where it stands.
const eyepiece = root.querySelector(".eyepiece");
eyepiece.style.setProperty("--fill", String(config.optics.fieldFill));
const mounted = (instrument) =>
  instrument.mount === "tripod" || instrument.mount === "dobsonian";
const finderOf = (instrument) => instrument.eyepiece === "telescope";
// The guides in use: none in the field game.
const guidesOn = (state) => (state.mode === "game" ? {} : (state.guides ?? {}));
// What the eye is looking through: the naked eye along a telescope's finder.
const viewing = (state) => {
  if (state.finder) return instrumentById.eye;
  const instrument = instrumentById[state.instrument] ?? instrumentById.eye;
  return instrument.eyepieces
    ? { ...instrument, ...instrument.eyepieces[state.power ?? 0] }
    : instrument;
};

// The camera's field: the eyepiece's circle of view spans `fieldFill` of the
// screen's shorter side, and holds the instrument's true field.
const viewFov = (aspect) => {
  const { field } = viewing(getState());
  if (!field) return fovFor(aspect);
  return (
    (2 *
      Math.atan(
        Math.tan((field * DEG) / 2) /
          (config.optics.fieldFill * Math.min(1, aspect)),
      )) /
    DEG
  );
};
// Looking and aiming slow down with the magnification.
const aimScale = () => camera.fov / fovFor(camera.aspect);
const pitchFloor = () =>
  (mounted(viewing(getState()))
    ? config.optics.pitchMin
    : config.view.pitchMin) * DEG;

const rig = {
  at: null, // set-up equipment: { id, x, z } where the eye meets it, and its aim
  setting: null, // { id, elapsed, seconds } while it is being set up
  model: null,
  wobble: { yaw: 0, pitch: 0, yawRate: 0, pitchRate: 0 },
  aim: { yaw: 0, pitch: 0, yawRate: 0, pitchRate: 0 },
};

// A smooth wander between -1 and 1, one per seed.
const wander = (t, seed) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const at = (n) => {
    const x = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  return at(i) * (1 - u) + at(i + 1) * u;
};

// --- Equipment on the ground: plain shapes, painted and lit like the land.
const equipmentPart = (geometry, color, place = () => {}) => {
  const mesh = new THREE.InstancedMesh(geometry, ground.painted(color), 1);
  mesh.frustumCulled = false;
  place(mesh);
  return mesh;
};
// A tube along -z (where it points), from `back` behind the pivot to `front` ahead of it.
const tube = (radius, back, front, color, x = 0, y = 0) =>
  equipmentPart(
    new THREE.CylinderGeometry(radius, radius, back + front, 20).rotateX(
      Math.PI / 2,
    ),
    color,
    (mesh) => {
      mesh.position.set(x, y, (back - front) / 2);
    },
  );
const box = (w, h, d, color, x, y, z) =>
  equipmentPart(new THREE.BoxGeometry(w, h, d), color, (mesh) =>
    mesh.position.set(x, y, z),
  );
const tripodLegs = (height, spread, color) =>
  [0, 1, 2].map((k) => {
    const angle = (k * 2 * Math.PI) / 3 + Math.PI;
    const foot = new THREE.Vector3(
      Math.sin(angle) * spread,
      0,
      Math.cos(angle) * spread,
    );
    const top = new THREE.Vector3(0, height, 0);
    const along = top.clone().sub(foot);
    return equipmentPart(
      new THREE.CylinderGeometry(0.014, 0.018, along.length(), 8),
      color,
      (mesh) => {
        mesh.position.copy(foot).add(top).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          along.normalize(),
        );
      },
    );
  });

const equipmentModels = {
  "tripod-binoculars": () => {
    const head = new THREE.Group();
    head.position.y = 1.32;
    head.add(
      tube(0.058, 0.12, 0.34, [26, 27, 29], -0.08),
      tube(0.058, 0.12, 0.34, [26, 27, 29], 0.08),
      box(0.3, 0.1, 0.16, [20, 21, 23], 0, 0, 0.14),
      tube(0.02, 0.3, -0.2, [14, 14, 15], -0.06, 0.02),
      tube(0.02, 0.3, -0.2, [14, 14, 15], 0.06, 0.02),
    );
    return {
      legs: [
        ...tripodLegs(1.28, 0.55, [88, 90, 95]),
        box(0.07, 0.08, 0.07, [30, 30, 32], 0, 1.27, 0),
      ],
      head,
    };
  },
  "small-telescope": () => {
    const head = new THREE.Group();
    head.position.y = 1.18;
    head.add(
      tube(0.045, 0.28, 0.32, [222, 224, 227]),
      tube(0.052, -0.3, 0.46, [24, 24, 26]),
      box(0.06, 0.06, 0.07, [24, 24, 26], 0, 0, 0.3),
      tube(0.016, 0.0, 0.07, [14, 14, 15], 0, 0.06, 0.3),
    );
    head.children.at(-1).rotation.x = Math.PI / 2;
    return {
      legs: [
        ...tripodLegs(1.12, 0.5, [88, 90, 95]),
        box(0.1, 0.1, 0.1, [36, 36, 38], 0, 1.1, 0),
      ],
      head,
    };
  },
  "large-telescope": () => {
    const head = new THREE.Group();
    head.position.y = 0.52;
    head.add(
      tube(0.125, 0.38, 0.86, [232, 232, 234]),
      tube(0.13, -0.78, 0.86, [22, 22, 24]),
    );
    return {
      legs: [
        box(0.62, 0.04, 0.62, [118, 86, 54], 0, 0.02, 0),
        box(0.04, 0.5, 0.42, [128, 94, 60], -0.18, 0.29, 0),
        box(0.04, 0.5, 0.42, [128, 94, 60], 0.18, 0.29, 0),
      ],
      head,
    };
  },
};

// The equipment stands just ahead of where the eye meets it.
const placeEquipment = () => {
  const { at } = rig;
  if (rig.model && rig.model.id !== at?.id) {
    ground.scene.remove(rig.model.group);
    rig.model = null;
  }
  if (!at) return;
  if (!rig.model) {
    const { legs, head } = equipmentModels[at.id]();
    const group = new THREE.Group();
    group.add(...legs, head);
    group.rotation.order = "YXZ";
    ground.scene.add(group);
    rig.model = { id: at.id, group, head };
  }
  const { group, head } = rig.model;
  // Rebuilding the land clears its scene.
  if (!group.parent) ground.scene.add(group);
  const ahead = config.optics.standBack;
  const x = at.x - Math.sin(at.yaw) * ahead;
  const z = at.z - Math.cos(at.yaw) * ahead;
  group.position.set(x, footing(x, z) ?? footing(at.x, at.z) ?? 0, z);
  group.rotation.y = at.yaw;
  head.rotation.x = clamp(at.pitch, -0.2, 1.45);
  // Hidden while the eye is at it (or along its finder).
  group.visible = getState().instrument !== at.id;
};

// Why the equipment cannot stand here, if it cannot.
const groundTrouble = (x, z, instrument) => {
  const here = footing(x, z);
  if (here === null)
    return `Find dry ground to set up the ${instrument.name.toLowerCase()}.`;
  const step = 0.6;
  const slope =
    Math.max(
      Math.abs((footing(x + step, z) ?? here) - (footing(x - step, z) ?? here)),
      Math.abs((footing(x, z + step) ?? here) - (footing(x, z - step) ?? here)),
    ) /
    (2 * step);
  if (slope > config.optics.steepest)
    return `Too steep here for the ${instrument.mount === "dobsonian" ? "mount" : "tripod"}. Find flatter ground.`;
  const ahead = config.optics.standBack;
  if (
    ground.blocked(
      x - Math.sin(look.yaw) * ahead,
      z - Math.cos(look.yaw) * ahead,
      0.35,
    )
  ) {
    return "No room to set up here. Step clear of the rocks and trees.";
  }
  return null;
};

const useInstrument = (id) => {
  rig.setting = null;
  setState({ instrument: id, finder: false, power: 0, declined: [] });
};

// A telescope's eyepieces, from low power to high: + and − (or the mouse wheel in
// the eyepiece) step through them.
const powerControl = root.querySelector(".power");
const stepPower = (by) => {
  const state = getState();
  const { eyepieces } = instrumentById[state.instrument];
  if (!eyepieces || state.finder || rig.setting) return;
  const power = clamp((state.power ?? 0) + by, 0, eyepieces.length - 1);
  if (power !== (state.power ?? 0)) setState({ power });
};
powerControl
  .querySelector(".power-down")
  .addEventListener("click", () => stepPower(-1));
powerControl
  .querySelector(".power-up")
  .addEventListener("click", () => stepPower(1));
window.addEventListener("keydown", (event) => {
  if (!forScene(event) || event.repeat) return;
  if (event.key === "+" || event.key === "=") stepPower(1);
  else if (event.key === "-" || event.key === "_") stepPower(-1);
});
let wheelRest = 0;
canvas.addEventListener(
  "wheel",
  (event) => {
    if (!instrumentById[getState().instrument]?.eyepieces || getState().finder)
      return;
    event.preventDefault();
    if (event.timeStamp < wheelRest) return;
    wheelRest = event.timeStamp + 350;
    stepPower(event.deltaY < 0 ? 1 : -1);
  },
  { passive: false },
);

const chooseInstrument = (id) => {
  const instrument = instrumentById[id];
  if (!mounted(instrument)) {
    stepAway(false);
    useInstrument(id);
    renderRig();
    return;
  }
  // Choosing the telescope in use again looks along its finder (or back).
  if (getState().instrument === id && !rig.setting) {
    if (finderOf(instrument)) setState({ finder: !getState().finder });
    return;
  }
  const { x, z } = camera.position;
  // Back to the equipment already standing close by, as it was left: still aimed
  // where it was, which is said when the eye had turned elsewhere, with the way
  // to swing it round (its finder, at the naked eye's pace).
  if (
    rig.at?.id === id &&
    Math.hypot(rig.at.x - x, rig.at.z - z) < config.optics.reach
  ) {
    const turned =
      Math.abs(
        Math.atan2(
          Math.sin(look.yaw - rig.at.yaw),
          Math.cos(look.yaw - rig.at.yaw),
        ),
      ) / DEG;
    const tipped = Math.abs(look.pitch - rig.at.pitch) / DEG;
    camera.position.x = rig.at.x;
    camera.position.z = rig.at.z;
    look.yaw = rig.at.yaw;
    look.pitch = rig.at.pitch;
    look.yawVelocity = 0;
    look.pitchVelocity = 0;
    useInstrument(id);
    renderRig();
    if (Math.max(turned, tipped) > config.optics.aimedElsewhere) {
      const where = `${Math.round((((-rig.at.yaw / DEG) % 360) + 360) % 360)}° ${POINTS[Math.round(((((-rig.at.yaw / DEG) % 360) + 360) % 360) / 22.5) % 16]}`;
      hint(
        finderOf(instrument)
          ? `The ${instrument.name.toLowerCase()} is still aimed where you left it, ${where}. Press R to sight along its finder and swing it.`
          : `The ${instrument.name.toLowerCase()} are still aimed where you left them, ${where}. Drag to swing them.`,
      );
    }
    return;
  }
  const trouble = groundTrouble(x, z, instrument);
  if (trouble) {
    hint(trouble);
    return;
  }
  if (
    getState().instrument !== "eye" &&
    mounted(instrumentById[getState().instrument])
  )
    stepAway(false);
  rig.setting = {
    id,
    elapsed: 0,
    seconds: reducedMotion.matches ? 0.3 : instrument.setup,
  };
  renderRig();
};

// The eye leaves the eyepiece; set-up equipment stays aimed where it was.
const stepAway = (announce = true) => {
  const state = getState();
  if (!rig.at || state.instrument !== rig.at.id) return;
  rig.at.yaw = look.yaw;
  rig.at.pitch = look.pitch;
  useInstrument("eye");
  const key = instruments.findIndex(({ id }) => id === rig.at.id) + 1;
  if (announce)
    hint(
      `You stepped away from the ${instrumentById[rig.at.id].name.toLowerCase()}. Press ${key} to look through it again.`,
    );
  renderRig();
};

// Walking (or the stick) while setting up stops it; while looking through set-up
// equipment, it steps away.
const walkingStarted = () => {
  if (rig.setting) {
    hint(
      `Stopped setting up the ${instrumentById[rig.setting.id].name.toLowerCase()}.`,
    );
    rig.setting = null;
    renderRig();
  } else if (mounted(instrumentById[getState().instrument])) stepAway();
};

const stepSetting = (dt) => {
  const { setting } = rig;
  if (!setting) return;
  setting.elapsed += dt;
  slots
    .find((slot) => slot.instrument.id === setting.id)
    ?.node.style.setProperty(
      "--setup",
      String(Math.min(1, setting.elapsed / setting.seconds)),
    );
  if (setting.elapsed < setting.seconds) return;
  rig.at = {
    id: setting.id,
    x: camera.position.x,
    z: camera.position.z,
    yaw: look.yaw,
    pitch: look.pitch,
  };
  useInstrument(setting.id);
  renderRig();
};

// Equipment chosen from the address, or kept on landing somewhere new, stands where
// the walker lands once the ground is there.
const settleRig = () => {
  const instrument = instrumentById[getState().instrument];
  if (!mounted(instrument) || rig.at?.id === instrument.id || rig.setting)
    return;
  if (footing(camera.position.x, camera.position.z) === null) return;
  rig.at = {
    id: instrument.id,
    x: camera.position.x,
    z: camera.position.z,
    yaw: look.yaw,
    pitch: look.pitch,
  };
  renderRig();
};

// The view through the eyepiece moves with the hands that hold it, or rings after
// a mount is moved, and shakes in the wind.
const swayOf = (t, dt) => {
  const instrument = viewing(getState());
  const { wobble, aim } = rig;
  if (getState().assists?.steady) return { yaw: 0, pitch: 0 };
  const windAtEye =
    ((getState().weather?.at ? wind.speed : 0) / 3.6) * config.optics.windAtEye;
  if (instrument.mount === "hand") {
    const { drift, breath, tremor, walkingShake } = config.optics.hand;
    const moving = clamp(walking.velocity.length() / config.walk.speed, 0, 1.5);
    const shake =
      1 + (walkingShake - 1) * moving + windAtEye * config.optics.hand.wind;
    return {
      yaw:
        (drift * wander(t * 0.35, 1) +
          tremor * wander(t * 9, 2) * shake +
          0.12 * moving * Math.sin(t * 5.6)) *
        DEG,
      pitch:
        (drift * wander(t * 0.3, 3) +
          breath * Math.sin((t * 2 * Math.PI) / 4.5) +
          tremor * wander(t * 8.3, 4) * shake +
          0.2 * moving * Math.sin(t * 11.2)) *
        DEG,
    };
  }
  if (!mounted(instrument)) return { yaw: 0, pitch: 0 };
  const mount = config.optics.mounts[instrument.mount];
  // A mount rings as it is pushed and stopped: a damped spring driven by how
  // sharply the aim changes speed.
  const yawRate = (look.yaw - aim.yaw) / Math.max(dt, 1e-3);
  const pitchRate = (look.pitch - aim.pitch) / Math.max(dt, 1e-3);
  const limit = 40 * DEG;
  const yawPush =
    clamp((yawRate - aim.yawRate) / Math.max(dt, 1e-3), -limit, limit) *
    mount.push;
  const pitchPush =
    clamp((pitchRate - aim.pitchRate) / Math.max(dt, 1e-3), -limit, limit) *
    mount.push;
  Object.assign(aim, { yaw: look.yaw, pitch: look.pitch, yawRate, pitchRate });
  const w = 2 * Math.PI * mount.frequency;
  const steps = Math.ceil(dt / (1 / 240));
  for (let i = 0; i < steps; i += 1) {
    const h = dt / steps;
    wobble.yawRate +=
      (-w * w * wobble.yaw - 2 * mount.damping * w * wobble.yawRate - yawPush) *
      h;
    wobble.pitchRate +=
      (-w * w * wobble.pitch -
        2 * mount.damping * w * wobble.pitchRate -
        pitchPush) *
      h;
    wobble.yaw += wobble.yawRate * h;
    wobble.pitch += wobble.pitchRate * h;
  }
  // Wind shakes it in gusts, as the square of its speed.
  const gust =
    mount.wind * windAtEye ** 2 * (0.55 + 0.45 * wander(t * 0.4, 5)) * DEG;
  return {
    yaw: wobble.yaw + gust * wander(t * mount.frequency * 1.3, 6),
    pitch: wobble.pitch + gust * 0.7 * wander(t * mount.frequency * 1.1, 7),
  };
};

// The hotbar shows what is being set up, and what keys the instrument in use takes.
const renderRig = () => {
  const state = getState();
  slots.forEach(({ instrument, node }) => {
    node.dataset.setting = String(rig.setting?.id === instrument.id);
    node.dataset.standing = String(rig.at?.id === instrument.id);
    if (rig.setting?.id !== instrument.id) node.style.removeProperty("--setup");
  });
  const chosen = viewing({ ...state, finder: false });
  const { eyepieces } = instrumentById[state.instrument];
  powerControl.hidden =
    !eyepieces || Boolean(rig.setting) || Boolean(state.finder);
  if (eyepieces) {
    powerControl.querySelector(".power-value").textContent =
      `${chosen.magnification}×`;
    powerControl.querySelector(".power-down").disabled = !(state.power > 0);
    powerControl.querySelector(".power-up").disabled =
      (state.power ?? 0) >= eyepieces.length - 1;
  }
  if (rig.setting)
    hotbarLabel.textContent = `Setting up the ${instrumentById[rig.setting.id].name.toLowerCase()}…`;
  else if (chosen.id === "eye")
    hotbarLabel.textContent = "Naked eye, fully dark-adapted";
  else if (state.finder)
    hotbarLabel.textContent = `Red-dot finder on the ${chosen.name.toLowerCase()} · R back to the eyepiece`;
  else if (finderOf(chosen))
    hotbarLabel.textContent = `${chosen.name} · ${chosen.detail} at ${chosen.magnification}× · R finder`;
  else hotbarLabel.textContent = `${chosen.name} · ${chosen.detail}`;
  placeEquipment();
};

window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyR" || event.repeat || !forScene(event)) return;
  const state = getState();
  if (finderOf(instrumentById[state.instrument]))
    chooseInstrument(state.instrument);
});

// The eye moves to the eyepiece: the view goes dark for a moment, then opens on
// the instrument's field.
let blinkTimer = 0;
watch(
  (s) => `${s.instrument}|${Boolean(s.finder)}|${s.power ?? 0}`,
  (_, state) => {
    const instrument = viewing(state);
    const apply = () => {
      camera.fov = viewFov(camera.aspect);
      camera.updateProjectionMatrix();
      root.dataset.optic = instrument.eyepiece ?? "eye";
      sizeMoon(
        instrument.field ? config.moon.trueDiameter : config.moon.diameter,
      );
      starUniforms.uOptics.value = instrument.field ? 1 : 0;
      root.dataset.finder = String(Boolean(state.finder));
      Object.assign(rig.wobble, { yaw: 0, pitch: 0, yawRate: 0, pitchRate: 0 });
      Object.assign(rig.aim, {
        yaw: look.yaw,
        pitch: look.pitch,
        yawRate: 0,
        pitchRate: 0,
      });
      look.pitch = Math.max(look.pitch, pitchFloor());
      eyepiece.dataset.blink = "false";
      renderRig();
    };
    clearTimeout(blinkTimer);
    if (state.view !== "ground" || reducedMotion.matches) {
      apply();
      return;
    }
    eyepiece.dataset.blink = "true";
    blinkTimer = setTimeout(apply, config.optics.blink * 1000);
  },
);

// --- Headlamp: red light for finding the way, which leaves dark-adapted eyes as they are
// Its button (or F) steps through its settings and back to off.
const lampButton = root.querySelector(".lamp-button");
const lampModes = config.headlamp.modes;
const headlamp = { mode: null, beam: lampModes[0], level: 0 };
const lampFrom = new THREE.Vector3();
const lampAim = new THREE.Vector3();

const setLamp = (mode, { announce = false } = {}) => {
  headlamp.mode = mode;
  if (mode) headlamp.beam = mode;
  lampButton.setAttribute("aria-pressed", String(Boolean(mode)));
  lampButton.setAttribute(
    "aria-label",
    `Red headlamp: ${mode ? mode.name.toLowerCase() : "off"} (F)`,
  );
  lampButton.dataset.mode = mode?.id ?? "off";
  setTool(lampButton, mode ? mode.name : "Lamp", mode ? "F" : "Off");
  if (announce) hint(mode ? `Headlamp · ${mode.name}` : "Headlamp off");
};
const stepLamp = () => {
  const next = lampModes.indexOf(headlamp.mode) + 1;
  setLamp(lampModes[next] ?? null, { announce: true });
};
// From the address: a setting by name, or simply on.
const lampSetting = (value) =>
  value === null
    ? null
    : (lampModes.find((m) => m.id === value) ??
      (["", "1", "on", "true"].includes(value) ? lampModes[0] : null));
lampButton.addEventListener("click", stepLamp);
window.addEventListener("keydown", (event) => {
  if (
    event.code !== "KeyF" ||
    event.repeat ||
    getState().view !== "ground" ||
    event.target.closest?.(".panel, input")
  )
    return;
  stepLamp();
});

// It points where the walker looks, tipped down a little toward the ground ahead.
const aimLamp = (dt) => {
  const { above, rise } = config.headlamp;
  const { beam } = headlamp;
  const { tilt } = beam;
  headlamp.level = clamp(
    headlamp.level + (headlamp.mode ? 1 : -1) * (dt / rise),
    0,
    1,
  );
  const pitch = look.pitch - tilt * DEG;
  lampAim.set(
    -Math.sin(look.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(look.yaw) * Math.cos(pitch),
  );
  lampFrom.copy(camera.position).y += above;
  ground.setLamp(beam.candela * headlamp.level, lampFrom, lampAim, beam);
};

// --- Clouds drift with the wind (it blows from wind.direction)
const driftClouds = (dt) => {
  if (reducedMotion.matches || model.uCloudCover.value < 0.005) return;
  const rate =
    (wind.speed / 3600 / config.sky.cloudHeight) *
    0.55 *
    config.sky.cloudDrift *
    dt;
  const toward = wind.direction * DEG;
  model.uCloudOffset.value.x += Math.sin(toward) * rate;
  model.uCloudOffset.value.y -= Math.cos(toward) * rate;
};

// --- Compass on the horizon
const compassLayer = root.querySelector(".compass");
const compassTemplate = document.getElementById("compass-label");
const compassMarks = compass.map(({ label, azimuth, major }) => {
  const node = compassTemplate.content.cloneNode(true).firstElementChild;
  node.textContent = label;
  node.dataset.major = String(major);
  compassLayer.append(node);
  return {
    node,
    point: new THREE.Vector3(...sceneDirection(1.4, azimuth)).multiplyScalar(
      100,
    ),
  };
});

const projected = new THREE.Vector3();
// Where the controls along the bottom begin (CSS pixels from the top), measured as they change.
let controlsTop = window.innerHeight;
const controls = [".hud-bottom", ".joystick"].map((selector) =>
  root.querySelector(selector),
);
const watchControls = new ResizeObserver(() => {
  controlsTop = Math.min(
    window.innerHeight,
    ...controls
      .map((node) => node.getBoundingClientRect().top)
      .filter((top) => top > 0),
  );
});
[document.documentElement, ...controls].forEach((node) =>
  watchControls.observe(node),
);
const placeCompass = () =>
  compassMarks.forEach(({ node, point }) => {
    projected.copy(point).add(camera.position).project(camera);
    // Not down among the controls, where the heading strip already says the same.
    const visible =
      projected.z < 1 &&
      Math.abs(projected.x) < 1.1 &&
      Math.abs(projected.y) < 1.1 &&
      ((1 - projected.y) / 2) * window.innerHeight < controlsTop - 12;
    node.style.visibility = visible ? "visible" : "hidden";
    if (visible) {
      const x = ((projected.x + 1) / 2) * window.innerWidth;
      const y = ((1 - projected.y) / 2) * window.innerHeight;
      node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  });

// --- Heading: a strip along the top that turns with the view, and where it points
const heading = root.querySelector(".heading");
const headingTicks = heading.querySelector(".heading-ticks");
const headingReadout = heading.querySelector(".heading-readout");
// Where the strip has no room, the same reading sits with the place's details.
const headingMini = root.querySelector(".conditions-heading");
const POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
const { pixelsPerDegree } = config.ui.heading;
// Three turns of ticks, so the strip never runs out whichever way it is turned.
headingTicks.replaceChildren(
  ...Array.from({ length: (360 * 3) / 5 + 1 }, (_, k) => {
    const degrees = k * 5 - 360;
    const around = ((degrees % 360) + 360) % 360;
    const nodes = [
      Object.assign(document.createElement("i"), {
        className: around % 15 ? "" : "major",
      }),
    ];
    if (around % 15 === 0) {
      const label = Object.assign(document.createElement("span"), {
        textContent: around % 45 ? String(around) : POINTS[around / 22.5],
        className: around % 45 ? "" : "point",
      });
      nodes.push(label);
    }
    nodes.forEach((node) => {
      node.style.left = `${(degrees + 360) * pixelsPerDegree}px`;
    });
    return nodes;
  }).flat(),
);
let headingShown = "";
const placeHeading = () => {
  const azimuth = (((-look.yaw / DEG) % 360) + 360) % 360;
  const altitude = look.pitch / DEG;
  headingTicks.style.transform = `translateX(${(heading.offsetWidth / 2 - (azimuth + 360) * pixelsPerDegree).toFixed(1)}px)`;
  const text = `${Math.round(azimuth) % 360}° ${POINTS[Math.round(azimuth / 22.5) % 16]} · ${
    Math.abs(altitude) < 0.5
      ? "level"
      : `${Math.abs(Math.round(altitude))}° ${altitude > 0 ? "up" : "down"}`
  }`;
  if (text !== headingShown) {
    headingShown = text;
    headingReadout.textContent = text;
    headingMini.textContent = text;
  }
};

// --- Conditions line
const placeText = root.querySelector(".conditions-place");
const timeText = root.querySelector(".conditions-time");

// Which stars the sky can show for this instrument right now.
// Limiting magnitude, as observers write it: NELM for the naked eye, LM with optics.
const limitLabel = (instrument) => (instrument.field ? "LM" : "NELM");

const missingSets = (state) =>
  setsFor(instrumentById[state.instrument]).filter(
    (name) => state.starSets?.[name]?.status !== "ready",
  );

// The toolbar's sky: what the weather is doing, in a word and a number.
const skyButton = root.querySelector(".sky-button");
const renderTools = (state, now) => {
  const cloud = now.conditions.cloudCover;
  setTool(
    skyButton,
    cloud < 10
      ? "Clear"
      : cloud < 50
        ? "Some cloud"
        : cloud < 85
          ? "Cloudy"
          : "Overcast",
    `${Math.round(cloud)}% cloud`,
  );
};

// How dark the sky is overhead, in plain words for its measured brightness
// (mag/arcsec²). The atlas's author asks that its values not be called Bortle
// classes, so the pen gives the brightness itself and these words only.
const darknessOf = (brightness) =>
  [
    [21.75, "Very dark sky"],
    [21.3, "Dark sky"],
    [20.8, "Rural sky"],
    [20.3, "Rural edge"],
    [19.5, "Suburban sky"],
    [18.8, "Bright suburban sky"],
    [-Infinity, "City sky"],
  ].find(([floor]) => brightness >= floor)[1];
const darknessCells = [...root.querySelectorAll(".darkness i")];
const darknessText = root.querySelector(".darkness-label");
const starsText = root.querySelector(".conditions-stars");
const catalogButton = root.querySelector(".catalog-button");
const starsButton = root.querySelector(".stars-button");
const moonText = root.querySelector(".conditions-moon");

const renderConditions = (state, now) => {
  placeText.textContent = [state.site.name, state.site.region]
    .filter(Boolean)
    .join(", ");
  // Whether the weather shown is the place's own or set by hand.
  timeText.textContent = `${state.override && state.mode !== "game" ? "Your own sky" : "Real weather"} · ${formatSiteTime(state.site.timeZone, state.time)}${state.live ? " · now" : ""}`;
  const { brightness } = now.zenith;
  const sun = now.sun.altitude;
  // Ten cells, filling as the sky darkens from a city's (17) to the darkest (22).
  const filled =
    sun > -0.8 ? 0 : Math.round(clamp((brightness - 17) / 5, 0, 1) * 10);
  darknessCells.forEach((cell, i) => {
    cell.dataset.on = String(i < filled);
  });
  const surface = `${brightness.toFixed(2)} mag/arcsec²`;
  // Against a bright sky (twilight, daylight) the HUD takes deeper surfaces.
  root.dataset.sky = brightness < config.ui.brightSky ? "bright" : "dark";
  // When the Moon outshines the sky's own glow and the towns', it is a moonlit
  // sky, whatever its brightness would otherwise be called.
  const { sources } = now.zenith;
  const moonlit = sources.moon > sources.natural + sources.artificial;
  darknessText.textContent =
    sun > -0.8
      ? "Daylight"
      : sun > -18
        ? `Twilight · ${surface}`
        : `${moonlit ? "Moonlit sky" : darknessOf(brightness)} · ${surface}`;
  darknessText.title =
    "Sky brightness overhead, in magnitudes per square arcsecond: bigger is darker, from about 17 in a city to 22 in the darkest places";
  const missing = missingSets(state);
  // Clouds hide what the darkness would show, so they are said here too once they matter.
  const cloud = Math.round(now.conditions.cloudCover);
  const reach = now.zenith.instrument;
  starsText.textContent =
    sun > -0.8
      ? ""
      : [
          `${limitLabel(viewing(state))} ${reach.toFixed(1)}`,
          ...(cloud >= 30 ? [`${cloud}% cloud`] : []),
        ].join(" · ");
  starsText.title =
    "Limiting magnitude overhead: the faintest star this sky and instrument show (NELM by eye, LM with optics). Bigger numbers are fainter stars.";
  // The catalog in use, and where it stops when the instrument could reach fainter.
  const catalog = starSets[catalogInUse(state)];
  catalogButton.textContent = `${catalog.short} catalog${reach > catalog.reach + 0.3 ? `, to mag ${catalog.reach}` : ""}`;
  setTool(starsButton, "Stars", catalog.short);
  starsButton.setAttribute(
    "aria-label",
    `Star catalog: ${catalog.title}, ${catalog.source}`,
  );
  catalogButton.title = `Stars from the ${catalog.source}: ${catalog.count} to magnitude ${catalog.reach}. Choose or download a catalog.`;
  catalogButton.dataset.short = String(
    reach > catalog.reach + 0.3 || missing.length > 0,
  );
  moonText.textContent =
    now.moon.altitude > 0
      ? `Moon up · ${Math.round(now.moon.fraction * 100)}% lit`
      : "Moon down";
};

// --- The sky banner: why the sky looks the way it does when that is not obvious
// (daylight, cloud, twilight, a bright Moon, city lights), and one thing to do about it.
const banner = root.querySelector(".sky-banner");
const bannerText = banner.querySelector(".sky-banner-text");
const bannerAction = banner.querySelector(".sky-banner-action");
let bannerShown = { key: "", reason: null };
let bannerDismissed = "";

const MINUTE = 60000;
// The first time from `from` to `to` (in steps of `step` minutes) that passes `test`.
const firstTime = (from, to, step, test) => {
  for (let t = from; t <= to; t += step * MINUTE) if (test(t)) return t;
  return null;
};

const reasonFor = (state, now) => {
  const { site, time } = state;
  const clock = (t) => formatClock(site.timeZone, t);
  const sunAt = (t) => sunAltitude(site, t);
  const until = nightStart(state) + span * 2 * MINUTE;
  const sun = now.sun.altitude;
  const cloud = Math.round(now.conditions.cloudCover);
  const fullDark = () =>
    firstTime(time, time + 20 * 60 * MINUTE, 10, (t) => sunAt(t) < -18);
  if (sun > -6) {
    const dark = fullDark();
    return {
      kind: "day",
      text:
        sun > -0.8
          ? "Daylight · the stars come out after dusk"
          : "Dusk · the sky is still too bright for most stars",
      action: dark
        ? { label: `Full dark at ${clock(dark)}`, time: dark }
        : null,
    };
  }
  if (cloud >= 60) {
    const rows = state.override ? [] : (state.weather.result?.rows ?? []);
    const clearer = rows.find(
      (row) =>
        row.t > time &&
        row.t < until &&
        row.cloudCover <= Math.min(40, cloud - 30) &&
        sunAt(row.t) < -12,
    );
    return {
      kind: "cloud",
      text: `${cloud >= 90 ? "Overcast" : "Cloudy"} · ${cloud}% cloud ${state.override ? "as you set it" : "here"}, so most stars are hidden`,
      action: clearer
        ? { label: `Clearer at ${clock(clearer.t)}`, time: clearer.t }
        : { label: "Find a clear place", globe: true },
    };
  }
  if (sun > -15) {
    const dark = fullDark();
    return {
      kind: "twilight",
      text: "Twilight · fainter stars appear as the sky darkens",
      action: dark
        ? { label: `Full dark at ${clock(dark)}`, time: dark }
        : null,
    };
  }
  if (now.moon.altitude > 5 && now.moon.fraction > 0.4) {
    const set = firstTime(
      time,
      until,
      10,
      (t) => moonState(site, t).altitude < 0 && sunAt(t) < -18,
    );
    return {
      kind: "moon",
      text: `Bright Moon · ${Math.round(now.moon.fraction * 100)}% lit, its light hides the fainter stars`,
      action: set
        ? { label: `Darker after moonset, ${clock(set)}`, time: set }
        : null,
    };
  }
  if (now.zenith.brightness < 19.3) {
    return {
      kind: "city",
      text: "City lights · only the brightest stars show through them",
      action: { label: "Find a darker place", globe: true },
    };
  }
  return null;
};

const renderBanner = (state, now) => {
  if (!state.site) {
    banner.hidden = true;
    return;
  }
  // Worked out again only when the place, the time (to ten minutes) or the sky change.
  const key = [
    state.site.latitude,
    state.site.longitude,
    Math.round(state.time / (10 * MINUTE)),
    Math.round(now.conditions.cloudCover),
    Math.round(now.zenith.brightness * 10),
    state.override,
  ].join();
  if (key !== bannerShown.key)
    bannerShown = { key, reason: reasonFor(state, now) };
  const { reason } = bannerShown;
  const id =
    reason && `${state.site.latitude},${state.site.longitude},${reason.kind}`;
  banner.hidden = !reason || id === bannerDismissed;
  if (banner.hidden) return;
  banner.dataset.kind = reason.kind;
  bannerText.textContent = reason.text;
  bannerAction.hidden = !reason.action;
  bannerAction.textContent = reason.action?.label ?? "";
};

bannerAction.addEventListener("click", () => {
  const { action } = bannerShown.reason ?? {};
  if (action?.globe) enterGlobe();
  else if (action?.time) setState({ time: action.time, live: false });
});
banner.querySelector(".sky-banner-close").addEventListener("click", () => {
  const { reason } = bannerShown;
  const { site } = getState();
  if (reason)
    bannerDismissed = `${site.latitude},${site.longitude},${reason.kind}`;
  banner.hidden = true;
});

// --- Time panel
const timePanel = document.getElementById("time-panel");
const clock = timePanel.querySelector(".time-clock");
const dateLabel = timePanel.querySelector(".time-date");
const dateInput = timePanel.querySelector(".time-date-input");
// The timeline: tonight from dusk to dawn, to scrub through, with the date (which
// opens the time panel) and when the night is fully dark and the Moon is up.
const timeline = root.querySelector(".timeline");
const slider = timeline.querySelector(".night-slider");
const scaleStart = timeline.querySelector(".night-scale-start");
const scaleEnd = timeline.querySelector(".night-scale-end");
const timelineDate = timeline.querySelector(".timeline-date");
const timelineNight = timeline.querySelector(".timeline-night");
const timelineMoon = timeline.querySelector(".timeline-moon");
const nowButton = timePanel.querySelector('[data-time="now"]');

const span = config.time.sliderHours * 60;
const nightStart = ({ site, time }) =>
  nightMidnight(site.timeZone, time) - span * 60000;

// Daylight, the three twilights and full dark, sampled across the slider.
const twilightColor = (altitude) => {
  if (altitude > 0) return "#4b5d78";
  if (altitude > -6) return "#34344f";
  if (altitude > -12) return "#1f2036";
  if (altitude > -18) return "#141428";
  return "#05060d";
};

const paintNight = (state) => {
  const start = nightStart(state);
  const steps = 96;
  const at = (i) => start + (i / steps) * span * 2 * 60000;
  const suns = Array.from({ length: steps + 1 }, (_, i) =>
    sunAltitude(state.site, at(i)),
  );
  const stops = suns.map(
    (altitude, i) =>
      `${twilightColor(altitude)} ${((i / steps) * 100).toFixed(2)}%`,
  );
  slider.style.setProperty(
    "--night-gradient",
    `linear-gradient(90deg, ${stops.join(", ")})`,
  );
  const clockAt = (i) => formatClock(state.site.timeZone, at(i));
  scaleStart.textContent = clockAt(0);
  scaleEnd.textContent = clockAt(steps);
  // Full dark: from the end of astronomical twilight to its return.
  const dark = suns.map((altitude) => altitude < -18);
  const from = dark.indexOf(true);
  const until = dark.lastIndexOf(true);
  // The Moon: a pale band over the hours it is up, and when it rises or sets.
  const moons = Array.from(
    { length: steps / 2 + 1 },
    (_, i) => moonState(state.site, at(i * 2)).altitude > 0,
  );
  const band = moons.map(
    (up, i) =>
      `${up ? "rgb(236 232 222 / 0.5)" : "transparent"} ${((i / (moons.length - 1)) * 100).toFixed(2)}%`,
  );
  timelineMoon.style.background = `linear-gradient(90deg, ${band.join(", ")})`;
  // Only what the Moon does after sunset and before sunrise matters to the night;
  // under the midnight Sun there is no night, and all of it does.
  const nightless = !suns.some((altitude) => altitude < 0);
  const night = (i) => nightless || suns[i * 2] < 0;
  const rise = moons.findIndex((up, i) => i && night(i) && up && !moons[i - 1]);
  const set = moons.findIndex((up, i) => i && night(i) && !up && moons[i - 1]);
  const dusk = moons.filter((_, i) => night(i));
  const moon = dusk.every(Boolean)
    ? nightless
      ? "Moon up"
      : "Moon up all night"
    : !dusk.some(Boolean)
      ? nightless
        ? "No Moon"
        : "No Moon tonight"
      : rise > 0 && (set < 0 || rise < set)
        ? `Moon rises ${clockAt(rise * 2)}`
        : `Moon sets ${clockAt(set * 2)}`;
  const darkness =
    from >= 0
      ? `Dark ${clockAt(from)}–${clockAt(until)}`
      : nightless
        ? "Midnight Sun"
        : "No full dark tonight";
  timelineNight.textContent = [darkness, moon].join(" · ");
};

const renderTimePanel = (state) => {
  const { site, time, live } = state;
  const start = nightStart(state);
  slider.min = "0";
  slider.max = String(span * 2);
  slider.step = String(config.time.sliderStepMinutes);
  slider.value = String(Math.round((time - start) / 60000));
  slider.setAttribute("aria-valuetext", formatSiteTime(site.timeZone, time));
  clock.textContent = formatClock(site.timeZone, time);
  dateLabel.textContent = new Intl.DateTimeFormat(undefined, {
    timeZone: site.timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(time));
  dateInput.value = isoDate(site.timeZone, time);
  nowButton.setAttribute("aria-pressed", String(live));
  timelineDate.textContent = dateLabel.textContent;
};

slider.addEventListener("input", () => {
  const state = getState();
  setState({
    time: nightStart(state) + Number(slider.value) * 60000,
    live: false,
  });
});

dateInput.addEventListener("change", () => {
  if (!dateInput.value) return;
  const { site, time } = getState();
  const [year, month, day] = dateInput.value.split("-").map(Number);
  const { hour, minute } = localFields(site.timeZone, time);
  setState({
    time: zonedInstant(site.timeZone, { year, month, day, hour, minute }),
    live: false,
  });
});

timePanel
  .querySelector('[data-time="tonight"]')
  .addEventListener("click", () => {
    const { site } = getState();
    setState({
      time: tonight(site, Date.now(), config.time.afterDuskMinutes),
      live: false,
    });
  });

nowButton.addEventListener("click", () =>
  setState({ time: Date.now(), live: true }),
);

setInterval(() => {
  if (getState().live) setState({ time: Date.now() });
}, config.time.liveTickSeconds * 1000);

// --- Ways of seeing: a hotbar, picked by clicking or with the number keys
const instrumentPanel = document.getElementById("instrument-panel");
const hotbar = root.querySelector(".hotbar");
const hotbarLabel = root.querySelector(".hotbar-label");
const slotTemplate = document.getElementById("hotbar-slot");
const iconOf = (name) =>
  document.getElementById(`icon-${name}`).content.cloneNode(true);

const slots = instruments.map((instrument, i) => {
  const node = slotTemplate.content.cloneNode(true).firstElementChild;
  node.querySelector("kbd").textContent = String(i + 1);
  node.querySelector(".slot-icon").append(iconOf(instrument.icon));
  node.querySelector(".slot-name").textContent = instrument.short;
  node.setAttribute(
    "aria-label",
    `${instrument.name}, ${instrument.detail} (${i + 1})`,
  );
  node.addEventListener("click", () => chooseInstrument(instrument.id));
  hotbar.append(node);
  return { instrument, node, reach: node.querySelector(".slot-reach") };
});

// True when a key press is meant for the scene, not for a field or a panel.
const forScene = (event) =>
  getState().view === "ground" &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.target.closest?.(".panel, input");

window.addEventListener("keydown", (event) => {
  const slot = /^Digit[1-9]$/.test(event.code)
    ? slots[Number(event.code.slice(5)) - 1]
    : null;
  if (slot && forScene(event)) chooseInstrument(slot.instrument.id);
});

// --- Offer the star sets an instrument needs
const offer = instrumentPanel.querySelector(".offer");
const offerText = offer.querySelector(".offer-text");
const offerProgress = offer.querySelector(".offer-progress");
const offerActions = offer.querySelector(".offer-actions");

const megabytes = (bytes) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

const renderOffer = (state) => {
  const instrument = instrumentById[state.instrument];
  const missing = missingSets(state);
  const sets = missing.map((id) => ({
    id,
    ...starSets[id],
    ...state.starSets[id],
  }));
  const downloading = sets.find((set) => set.status === "downloading");
  const offered = sets.filter(
    (set) => set.status === "available" && !state.declined.includes(set.id),
  );
  // Only a download to offer, or one under way: a catalog that cannot be had is
  // said in the menu's catalog list, not here.
  offer.hidden = !downloading && !offered.length;
  offerProgress.hidden = !downloading;
  offerActions.hidden = Boolean(downloading) || !offered.length;
  if (downloading) {
    offerText.textContent = `Downloading the ${downloading.name}…`;
    offerProgress.style.setProperty(
      "--progress",
      String(downloading.progress ?? 0),
    );
  } else if (offered.length) {
    const bytes = offered.reduce((sum, set) => sum + (set.bytes ?? 0), 0);
    const names = offered.map((set) => set.name).join(" and the ");
    offerText.textContent = `${instrument.reveal} ${offered.at(-1).count} more stars. Download the ${names} (${megabytes(bytes)})?`;
  }
};

const setStarSet = (name, patch) =>
  setState((state) => ({
    starSets: {
      ...state.starSets,
      [name]: { ...state.starSets[name], ...patch },
    },
  }));

const downloadSet = async (name) => {
  setStarSet(name, { status: "downloading", progress: 0 });
  let shown = 0;
  try {
    // Progress is shown in whole percents; finer steps would only redraw the panel.
    const bytes = await loadStars(name, (progress) => {
      if (progress - shown < 0.01) return;
      shown = progress;
      setStarSet(name, { progress });
    });
    if (name === "deep") skyUniforms.uDeep.value = await bakeDeepStars(bytes);
    else addStarLayer(name, bytes);
    setStarSet(name, { status: "ready" });
    // A catalog just downloaded is the one wanted.
    setState({ catalog: name });
  } catch (error) {
    console.error(error);
    setStarSet(name, { status: "error" });
  }
};

offer.querySelector(".offer-accept").addEventListener("click", async () => {
  const state = getState();
  const wanted = missingSets(state).filter(
    (name) => state.starSets[name].status === "available",
  );
  await wanted.reduce(
    (done, name) => done.then(() => downloadSet(name)),
    Promise.resolve(),
  );
});

offer.querySelector(".offer-decline").addEventListener("click", () => {
  setState((state) => ({
    declined: [...state.declined, ...missingSets(state)],
  }));
});

const findStarSets = async () => {
  const sizes = await Promise.all(
    ["full", "deep"].map((name) => starListSize(name).catch(() => null)),
  );
  setState({
    starSets: Object.fromEntries(
      ["full", "deep"].map((name, i) => [
        name,
        { status: sizes[i] ? "available" : "missing", bytes: sizes[i] },
      ]),
    ),
  });
};

const renderInstrumentPanel = (state) => {
  renderOffer(state);
  slots.forEach(({ instrument, node, reach }) => {
    node.setAttribute(
      "aria-pressed",
      String(instrument.id === state.instrument),
    );
    reach.textContent = `${limitLabel(instrument)} ${skyNow(state, instrument).zenith.instrument.toFixed(1)}`;
  });
  renderRig();
  faintSwitch.setAttribute("aria-pressed", String(state.showFaint));
  // A star set to offer (or one on its way) shows above the hotbar, once for each
  // instrument in a visit; it goes when the player looks around or walks, and the
  // menu's catalog list keeps the download at hand. Not over the menu, which shows
  // the same download.
  const open = instrumentPanel.matches(":popover-open");
  const offering =
    !offer.hidden &&
    state.view === "ground" &&
    !document.getElementById("menu-panel").matches(":popover-open") &&
    (open || !offerShown.has(state.instrument));
  if (offering && !open) {
    offerShown.add(state.instrument);
    instrumentPanel.showPopover();
    placeOffer(state);
  } else if (!offering && open) instrumentPanel.hidePopover();
};

// Above the hotbar and what sits on it: its label, the eyepiece control, hints and,
// on touch screens, the walking stick.
const placeOffer = (state) => {
  placePanel(
    instrumentPanel,
    slots.find((slot) => slot.instrument.id === state.instrument).node,
  );
  const clear = [
    root.querySelector(".hotbar-label"),
    powerControl,
    walkHint,
    joystick,
  ]
    .filter(
      (node) =>
        node && !node.hidden && getComputedStyle(node).display !== "none",
    )
    .map((node) => node.getBoundingClientRect().top)
    .filter((top) => top > 0);
  if (clear.length)
    instrumentPanel.style.bottom = `${window.innerHeight - Math.min(...clear) + 10}px`;
};

const offerShown = new Set();
// Looking around or walking puts the offer away.
const putOfferAway = () => {
  if (instrumentPanel.matches(":popover-open")) instrumentPanel.hidePopover();
};

// --- Sky conditions panel
const skyPanel = document.getElementById("sky-panel");
const rowTemplate = document.getElementById("condition-row");
const sourceText = skyPanel.querySelector(".sky-source");
const moonPhaseText = skyPanel.querySelector(".moon-phase");
const moonPlaceText = skyPanel.querySelector(".moon-place");
const liveButton = skyPanel.querySelector(".live-button");
const landText = skyPanel.querySelector(".land-kind");

// The land underfoot, named: the shore if there is water close by, what covers
// the land, and the snow on it.
watch(
  (s) => `${s.ground}|${s.snow}`,
  (_, { ground: kind, snow }) => {
    const land = ground.land;
    const { site } = getState();
    const shore = shores[kind]?.label;
    // Sand by the sea is the beach itself, not a desert.
    const cover =
      kind === "ocean" && land?.dominant === "sand"
        ? null
        : landLabel(covers[land?.dominant], site);
    const lying =
      snow > 0.5 ? "snow on the ground" : snow > 0.15 ? "patchy snow" : null;
    landText.textContent = land?.cover?.afloat
      ? "Open sea"
      : [shore, shore ? cover?.toLowerCase() : cover, lying]
          .filter(Boolean)
          .join(" · ");
  },
);

const conditionRows = conditionControls.map((control) => {
  const node = rowTemplate.content.cloneNode(true).firstElementChild;
  const input = node.querySelector("input");
  Object.assign(input, {
    min: control.min,
    max: control.max,
    step: control.step,
  });
  node.querySelector(".condition-label").textContent = control.label;
  input.addEventListener("input", () => {
    const state = getState();
    const conditions = effectiveConditions(state);
    const keys = conditionControls.map(({ key }) => key);
    setState({
      override: {
        ...Object.fromEntries(keys.map((key) => [key, conditions[key]])),
        [control.key]: Number(input.value),
      },
    });
  });
  skyPanel.querySelector(".condition-rows").append(node);
  return { control, input, output: node.querySelector("output") };
});

liveButton.addEventListener("click", () => setState({ override: null }));

const sourceLabel = ({ override, weather }) => {
  if (override) return "Set by you";
  if (weather.status === "loading") return "Loading weather…";
  if (weather.status === "error") return "Weather unavailable";
  if (weather.source === "none") return "No forecast this far ahead";
  return weather.source === "archive" ? "Recorded weather" : "Live forecast";
};

const phaseName = (elongation) =>
  moonPhases.find(({ upTo }) => elongation <= upTo).name;

const renderSkyPanel = (state, now) => {
  conditionRows.forEach(({ control, input, output }) => {
    const value = now.conditions[control.key];
    input.value = String(value);
    output.textContent = `${value.toFixed(control.decimals)} ${control.unit}`;
  });
  sourceText.textContent = sourceLabel(state);
  moonPhaseText.textContent = `${phaseName(now.moon.elongation)} · ${Math.round(now.moon.fraction * 100)}% lit`;
  moonPlaceText.textContent =
    now.moon.altitude > 0
      ? `${Math.round(now.moon.altitude)}° up`
      : "Below the horizon";
  liveButton.hidden = !state.override;
};

// --- Sound: off until asked for, then mixed from the ground and the weather
const soundscape = createSoundscape({
  sound: (path) => assetUrl(`${config.assets.sound}${path}`),
  settings: config.sound,
  layers: soundLayers,
  progress: loading,
});
const soundButton = root.querySelector(".sound-button");
let soundOn = false;

const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// The place's sounds: its water's and its land's, each as the night allows. Wind is
// heard only once it would be: rustling what grows first, then at the ear, then
// howling. Insects and frogs want warmth and fall quiet in wind or over snow; the
// region's night birds and animals call in the dark, in their season; still water
// freezes in hard cold.
const soundMix = (state, now) => {
  if (!state.ground) return {};
  const windSpeed = now.conditions.windSpeed ?? 0;
  const temperature = now.conditions.temperature ?? 15;
  const sound = config.sound;
  const rising = ([from, full]) => smoothstep(from, full, windSpeed);
  const hush = 1 - 0.85 * rising(sound.hushWind);
  const night = now.sun.altitude < 0;
  const dark = now.sun.altitude < sound.owlSunAltitude;
  const snowy = (state.snow ?? 0) > sound.snowSilence;
  const warm = (limit) => (temperature >= limit && night && !snowy ? 1 : 0);
  const land = ground.land?.dominant ?? state.ground;
  const shore = shores[state.ground] ? state.ground : null;
  // Wind in what grows here (reeds at the shore), then at the ear, then howling.
  const levels = {
    leaves:
      Math.max(rustle[land] ?? 0, shore ? rustle[shore] : 0) *
      (snowy ? 0.5 : 1) *
      rising(sound.leavesWind),
    breeze: rising(sound.breezeWind),
    gusts: rising(sound.gustsWind),
    crickets: warm(sound.insectTemperature) * hush,
    frogs: warm(sound.frogTemperature) * hush,
    lake: temperature > sound.iceTemperature ? 1 : 0,
  };
  // Night calls of this region, this kind of land and this time of year.
  const region = regionOf(state.site);
  const month = Number(
    new Intl.DateTimeFormat("en", {
      month: "numeric",
      timeZone: state.site.timeZone ?? "UTC",
    }).format(state.time),
  );
  const within = (range, value) =>
    !range || (value >= range[0] && value <= range[1]);
  const calls = Object.entries(nightCalls)
    .filter(
      ([, call]) =>
        call.regions.includes(region) &&
        call.covers.includes(land) &&
        (!call.months || call.months.includes(month)) &&
        within(call.latitudes, state.site.latitude) &&
        within(call.longitudes, state.site.longitude),
    )
    .map(([name]) => name);
  calls.forEach((name) => {
    levels[name] = dark && temperature > -25 ? hush : 0;
  });
  const names = new Set([
    ...(shores[state.ground]?.sounds ?? []),
    ...(covers[land]?.sounds ?? []),
    ...calls,
    "leaves",
    "breeze",
    "gusts",
  ]);
  return Object.fromEntries(
    [...names].map((name) => [
      name,
      soundLayers[name].level * (levels[name] ?? 1),
    ]),
  );
};

soundButton.addEventListener("click", async () => {
  soundOn = !soundOn;
  soundButton.setAttribute("aria-pressed", String(soundOn));
  setTool(soundButton, "Sound", soundOn ? "On" : "Off");
  if (soundOn) {
    await soundscape.enable();
    const state = getState();
    soundscape.mix(soundMix(state, skyNow(state)));
  } else soundscape.disable();
});

// --- Sky guides: constellation figures and names, planets, and star details,
// each a keyed switch on the rail, with faint stars beside them
const guidesPanel = document.getElementById("guides-panel");
const rail = root.querySelector(".guides-rail");
const railTemplate = document.getElementById("rail-toggle");
const railToggle = ({ short, label, code, icon }, onToggle) => {
  const node = railTemplate.content.cloneNode(true).firstElementChild;
  node.querySelector(".rail-icon").append(iconOf(icon));
  node.querySelector(".rail-name").textContent = short;
  node.querySelector("kbd").textContent = code.slice(3);
  node.setAttribute("aria-label", `${label} (${code.slice(3)})`);
  node.addEventListener("click", onToggle);
  rail.append(node);
  window.addEventListener("keydown", (event) => {
    if (
      event.code === code &&
      !event.repeat &&
      forScene(event) &&
      getState().mode !== "game"
    )
      onToggle();
  });
  return node;
};
const guideSwitches = guides.map((entry) => ({
  key: entry.key,
  node: railToggle(entry, () =>
    setState((state) => ({
      guides: { ...state.guides, [entry.key]: !state.guides?.[entry.key] },
    })),
  ),
}));
const faintSwitch = railToggle(
  {
    short: "Faint stars",
    label: "Show stars too faint to see",
    code: "KeyV",
    icon: "faint",
  },
  () => setState((state) => ({ showFaint: !state.showFaint })),
);
// Where the planets are tonight: a list beside the planets' switch.
const planetsMore = document.createElement("button");
planetsMore.className = "rail-more";
planetsMore.type = "button";
planetsMore.setAttribute("popovertarget", "guides-panel");
planetsMore.setAttribute("aria-label", "Where the planets are tonight");
planetsMore.append(iconOf("list"));
guideSwitches.find((entry) => entry.key === "planets").node.after(planetsMore);

const guide = {
  names: null,
  constellations: null,
  figures: null,
  planets: null,
  labels: [],
};
const labelLayer = root.querySelector(".sky-labels");
const labelTemplate = document.getElementById("sky-label");

const makeLabel = (text, kind) => {
  const node = labelTemplate.content.cloneNode(true).firstElementChild;
  node.textContent = text;
  node.dataset.kind = kind;
  labelLayer.append(node);
  return node;
};

const vectorOf = (ra, dec) => equatorialVector({ ra: ra / 15, dec });

// --- The terrain's horizon around the walker: how high the land rises in each
// direction, measured a few directions a frame so walking never stutters. Stars
// and figure lines behind it count as hidden.
const HORIZON = config.guideStyle.horizonSamples;
const horizonData = new Float32Array(HORIZON);
const horizonTexture = new THREE.DataTexture(
  horizonData,
  HORIZON,
  1,
  THREE.RedFormat,
  THREE.FloatType,
);
horizonTexture.wrapS = THREE.RepeatWrapping;
horizonTexture.needsUpdate = true;
const horizonJob = {
  next: HORIZON,
  values: new Float32Array(HORIZON),
  from: new THREE.Vector3(Infinity, 0, 0),
};

const remeasureHorizon = () => {
  horizonJob.from.set(Infinity, 0, 0);
  horizonJob.next = HORIZON;
};

const measureHorizon = () => {
  if (horizonJob.next >= HORIZON) {
    if (
      horizonJob.from.distanceTo(camera.position) <
      config.guideStyle.horizonRemeasure
    )
      return;
    horizonJob.from.copy(camera.position);
    horizonJob.next = 0;
  }
  const { x, y, z } = horizonJob.from;
  const end = Math.min(
    HORIZON,
    horizonJob.next + config.guideStyle.horizonPerFrame,
  );
  for (let i = horizonJob.next; i < end; i += 1)
    horizonJob.values[i] = ground.horizonAt(
      x,
      z,
      y,
      (i / HORIZON) * 2 * Math.PI,
    );
  horizonJob.next = end;
  if (end === HORIZON) {
    horizonData.set(horizonJob.values);
    horizonTexture.needsUpdate = true;
  }
};

// Height of the land (degrees) toward an azimuth (degrees).
const horizonAltitude = (azimuth) =>
  horizonData[
    Math.round(((((azimuth % 360) + 360) % 360) / 360) * HORIZON) % HORIZON
  ] / DEG;

// --- Constellation figures. Each line is drawn only while both of its stars can
// be seen, and a figure only while enough of it is left to recognize; a figure
// under the pointer (or tapped) is lit up, lines, stars and name together.
const figureState = {
  count: 0,
  shown: null,
  shownTarget: null,
  glow: null,
  glowTarget: null,
  pinned: null,
  hovered: null,
  kept: null,
  keptTarget: null,
};
const figureTexture = new THREE.DataTexture(
  new Float32Array(4),
  1,
  1,
  THREE.RGBAFormat,
  THREE.FloatType,
);
// Per line of every figure: whether it is part of the shape being drawn.
const segmentTexture = new THREE.DataTexture(
  new Float32Array(1),
  1,
  1,
  THREE.RedFormat,
  THREE.FloatType,
);

const figureUniforms = {
  ...model,
  uSky: starUniforms.uSky,
  uVisibility: starUniforms.uVisibility,
  uCloudDimming: starUniforms.uCloudDimming,
  uHorizon: { value: horizonTexture },
  uHorizonSize: { value: HORIZON },
  uFigures: { value: figureTexture },
  uFigureCount: { value: 1 },
  uSegments: { value: segmentTexture },
  uSegmentCount: { value: 1 },
  uExposure: exposure,
};

// Figure lines, cut into short arcs so they follow the curve of the sky, each
// drawn as a soft ribbon a fixed number of pixels wide.
const lineUniforms = {
  ...figureUniforms,
  uOpacity: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uWidth: { value: config.guideStyle.lineWidth },
  uColor: { value: new THREE.Color(...config.guideStyle.lineColor) },
  uClear: { value: config.guideStyle.lineClear },
  uRamp: { value: config.guideStyle.lineRamp },
  uHighlight: { value: config.guideStyle.lineHighlight },
};

// The brightness of the naked-eye star at each point of a figure: the brightest
// star within a third of a degree, since figures join bright stars and a faint
// neighbour can sit closer to the plotted point.
const starMagnitudes = (points) => {
  const bytes = layers.naked?.bytes;
  if (!bytes) return points.map(() => config.guideStyle.unknownMagnitude);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = countBrighterThan(bytes, config.guideStyle.pickMagnitude);
  const xyz = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 1)
    xyz[i] = view.getInt16(i * 2 + Math.floor(i / 3) * 2, true) / 32767;
  return points.map((vector) => {
    const within = Math.cos(0.35 * DEG);
    // Stars are stored brightest first, so the first one close enough is the one.
    for (let i = 0; i < count; i += 1) {
      if (
        xyz[i * 3] * vector[0] +
          xyz[i * 3 + 1] * vector[1] +
          xyz[i * 3 + 2] * vector[2] >
        within
      )
        return bytes[i * 8 + 6] / 16 - 1.5;
    }
    return config.guideStyle.unknownMagnitude;
  });
};

const buildFigures = ({ figures: data }) => {
  const step = config.guideStyle.lineStep * DEG;
  const points = [
    ...new Map(
      data
        .flatMap(({ lines }) => lines.flat())
        .map((point) => [point.join(), point]),
    ).values(),
  ];
  const found = starMagnitudes(points.map((point) => vectorOf(...point)));
  const magnitudes = new Map(
    points.map((point, i) => [point.join(), found[i]]),
  );
  const magnitudeOf = (point) => magnitudes.get(point.join());
  let segmentCount = 0;
  const figures = data.map(({ id, lines }) => {
    const segments = lines.flatMap((line) =>
      line.slice(1).map((end, i) => ({
        from: vectorOf(...line[i]),
        to: vectorOf(...end),
        ends: [line[i].join(), end.join()],
        magnitudes: [magnitudeOf(line[i]), magnitudeOf(end)],
        index: segmentCount++,
        seen: false,
        kept: false,
      })),
    );
    const stars = [
      ...new Map(
        lines
          .flat()
          .map((point) => [
            point.join(),
            { vector: vectorOf(...point), magnitude: magnitudeOf(point) },
          ]),
      ).values(),
    ];
    return { id, segments, stars };
  });
  // Each piece carries its distance (degrees) from the nearer star at either end,
  // the length of its whole line, that line's two stars and its figure.
  const pieces = figures.flatMap((figure, f) =>
    figure.segments.flatMap((segment) => {
      const a = new THREE.Vector3(...segment.from);
      const b = new THREE.Vector3(...segment.to);
      const angle = a.angleTo(b);
      const count = Math.max(1, Math.ceil(angle / step));
      const along = (t) => a.clone().lerp(b, t).normalize().toArray();
      const gap = (t) => (Math.min(t, 1 - t) * angle) / DEG;
      // A cut at the middle, where the distance to the nearer star turns around.
      const cuts = [
        ...new Set([
          0,
          0.5,
          ...Array.from({ length: count + 1 }, (_, k) => k / count),
          1,
        ]),
      ].sort((x, y) => x - y);
      return cuts.slice(1).map((t, k) => ({
        start: along(cuts[k]),
        end: along(t),
        gaps: [gap(cuts[k]), gap(t)],
        length: angle / DEG,
        segment,
        figure: f,
      }));
    }),
  );
  // Four corners and two triangles per piece.
  const corners = [
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 1],
  ];
  const each = (fn) =>
    pieces.flatMap((piece) =>
      corners.flatMap(([at, side]) => fn(piece, at, side)),
    );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      each((p, at) => (at ? p.end : p.start)),
      3,
    ),
  );
  geometry.setAttribute(
    "aStart",
    new THREE.Float32BufferAttribute(
      each((p) => p.start),
      3,
    ),
  );
  geometry.setAttribute(
    "aEnd",
    new THREE.Float32BufferAttribute(
      each((p) => p.end),
      3,
    ),
  );
  geometry.setAttribute(
    "aAt",
    new THREE.Float32BufferAttribute(
      each((p, at) => [at]),
      1,
    ),
  );
  geometry.setAttribute(
    "aSide",
    new THREE.Float32BufferAttribute(
      each((p, at, side) => [side]),
      1,
    ),
  );
  geometry.setAttribute(
    "aGap",
    new THREE.Float32BufferAttribute(
      each((p, at) => [p.gaps[at]]),
      1,
    ),
  );
  geometry.setAttribute(
    "aLength",
    new THREE.Float32BufferAttribute(
      each((p) => [p.length]),
      1,
    ),
  );
  geometry.setAttribute(
    "aFrom",
    new THREE.Float32BufferAttribute(
      each((p) => p.segment.from),
      3,
    ),
  );
  geometry.setAttribute(
    "aTo",
    new THREE.Float32BufferAttribute(
      each((p) => p.segment.to),
      3,
    ),
  );
  geometry.setAttribute(
    "aMagnitudes",
    new THREE.Float32BufferAttribute(
      each((p) => p.segment.magnitudes),
      2,
    ),
  );
  geometry.setAttribute(
    "aFigure",
    new THREE.Float32BufferAttribute(
      each((p) => [p.figure]),
      1,
    ),
  );
  geometry.setAttribute(
    "aSegment",
    new THREE.Float32BufferAttribute(
      each((p) => [p.segment.index]),
      1,
    ),
  );
  geometry.setIndex(
    pieces.flatMap((_, k) => [0, 1, 2, 2, 1, 3].map((i) => k * 4 + i)),
  );
  const lines = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: lineUniforms,
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  lines.visible = false;
  // A soft glow around each star of a lit-up figure.
  const allStars = figures.flatMap((figure, f) =>
    figure.stars.map((star) => ({ ...star, figure: f })),
  );
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      allStars.flatMap((star) => star.vector),
      3,
    ),
  );
  starGeometry.setAttribute(
    "aMagnitude",
    new THREE.Float32BufferAttribute(
      allStars.map((star) => star.magnitude),
      1,
    ),
  );
  starGeometry.setAttribute(
    "aFigure",
    new THREE.Float32BufferAttribute(
      allStars.map((star) => star.figure),
      1,
    ),
  );
  const glows = new THREE.Points(
    starGeometry,
    new THREE.ShaderMaterial({
      uniforms: {
        ...figureUniforms,
        uSize: { value: config.guideStyle.starGlow },
        uPixelRatio: starUniforms.uPixelRatio,
        uColor: lineUniforms.uColor,
      },
      vertexShader: figureStarVertex,
      fragmentShader: figureStarFragment,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    }),
  );
  glows.frustumCulled = false;
  glows.renderOrder = 1;
  world.add(lines, glows);
  // Per figure: whether it is shown and how lit up it is, eased toward their targets.
  const n = figures.length;
  Object.assign(figureState, {
    count: n,
    shown: new Float32Array(n),
    shownTarget: new Float32Array(n),
    glow: new Float32Array(n),
    glowTarget: new Float32Array(n),
  });
  figureTexture.image = { data: new Float32Array(n * 4), width: n, height: 1 };
  figureTexture.needsUpdate = true;
  figureUniforms.uFigureCount.value = n;
  figureState.kept = new Float32Array(segmentCount);
  figureState.keptTarget = new Float32Array(segmentCount);
  segmentTexture.image = {
    data: new Float32Array(segmentCount),
    width: segmentCount,
    height: 1,
  };
  segmentTexture.needsUpdate = true;
  figureUniforms.uSegmentCount.value = segmentCount;
  return {
    lines,
    glows,
    figures,
    index: new Map(figures.map((figure, f) => [figure.id, f])),
  };
};

// Whether a figure's star can be seen: above the land, and bright enough for this
// sky and instrument (the same test the star details use).
const starSeen = (vector, magnitude, now) => {
  const where = horizontalOf(sceneOf(vector));
  if (
    where.altitude <= 0 ||
    where.altitude < horizonAltitude(where.azimuth) + 0.2
  )
    return false;
  if (now.conditions.cloudCover > 75) return false;
  const air =
    1 /
    (Math.sin(where.altitude * DEG) +
      0.50572 * (where.altitude + 6.07995) ** -1.6364);
  return (
    magnitude + now.extinction * air <=
    now.zenith.instrument - 0.3 * Math.max(air - 1, 0)
  );
};

// The lines of a figure that join stars that can be seen, gathered into connected
// pieces; the largest piece is the shape that can still be recognized.
const largestPiece = (segments) => {
  const parent = new Map();
  const root = (key) => {
    while (parent.get(key) !== key) key = parent.get(key);
    return key;
  };
  segments.forEach(({ ends }) =>
    ends.forEach((key) => {
      if (!parent.has(key)) parent.set(key, key);
    }),
  );
  segments.forEach(({ ends: [a, b] }) => parent.set(root(a), root(b)));
  const pieces = new Map();
  segments.forEach((segment) => {
    const key = root(segment.ends[0]);
    pieces.set(key, [...(pieces.get(key) ?? []), segment]);
  });
  return [...pieces.values()].reduce(
    (best, piece) => (piece.length > best.length ? piece : best),
    [],
  );
};

// A figure is shown while a recognizable shape of it can be seen: most of its lines,
// or a connected piece large enough to make it out. Only that piece is drawn, so no
// line is left joining nothing.
const judgeFigures = (state) => {
  if (!guide.figures || !currentSky) return;
  const now = skyNow(state);
  const { figureShare, pieceShare, pieceLines } = config.guideStyle;
  guide.figures.figures.forEach((figure, f) => {
    figure.segments.forEach((segment) => {
      segment.seen =
        starSeen(segment.from, segment.magnitudes[0], now) &&
        starSeen(segment.to, segment.magnitudes[1], now);
      segment.kept = false;
    });
    const total = figure.segments.length;
    const piece = largestPiece(
      figure.segments.filter((segment) => segment.seen),
    );
    const seen = figure.segments.filter((segment) => segment.seen).length;
    const shown =
      total <= 2
        ? seen === total
        : seen / total >= figureShare ||
          piece.length >= Math.max(pieceLines, Math.ceil(pieceShare * total));
    figureState.shownTarget[f] = shown ? 1 : 0;
    const middle = [0, 0, 0];
    if (shown) {
      piece.forEach((segment) => {
        segment.kept = true;
        [segment.from, segment.to].forEach((v) =>
          v.forEach((c, i) => {
            middle[i] += c;
          }),
        );
      });
    }
    figure.segments.forEach((segment) => {
      figureState.keptTarget[segment.index] = segment.kept ? 1 : 0;
    });
    // The middle of what can be seen of it: where its name goes if the land hides its usual place.
    const length = Math.hypot(...middle);
    figure.middle = length ? middle.map((c) => c / length) : null;
  });
};

// The shown figure nearest a point on screen (CSS pixels), if one is close enough.
const figureAt = (x, y) => {
  if (!guide.figures) return null;
  let best = null;
  let nearest = config.guideStyle.hoverPixels;
  guide.figures.figures.forEach((figure, f) => {
    if (!figureState.shownTarget[f]) return;
    figure.segments.forEach((segment) => {
      if (!segment.kept) return;
      const a = project(sceneOf(segment.from));
      const b = project(sceneOf(segment.to));
      if (!a.inFront || !b.inFront) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = clamp(
        ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1),
        0,
        1,
      );
      const distance = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
      if (distance < nearest) {
        nearest = distance;
        best = f;
      }
    });
  });
  return best;
};

// Ease each figure toward being shown and lit up, and hand the result to the shaders.
const easeFigures = (dt) => {
  if (!figureState.count) return;
  const lit = figureState.hovered ?? figureState.pinned;
  const data = figureTexture.image.data;
  const shownRate = 1 - Math.exp(-dt / 0.35);
  const glowRate = 1 - Math.exp(-dt / 0.18);
  let changed = false;
  for (let f = 0; f < figureState.count; f += 1) {
    figureState.glowTarget[f] = f === lit && figureState.shownTarget[f] ? 1 : 0;
    const shown =
      figureState.shown[f] +
      (figureState.shownTarget[f] - figureState.shown[f]) *
        (reducedMotion.matches ? 1 : shownRate);
    const glow =
      figureState.glow[f] +
      (figureState.glowTarget[f] - figureState.glow[f]) *
        (reducedMotion.matches ? 1 : glowRate);
    if (
      Math.abs(shown - data[f * 4]) > 1e-3 ||
      Math.abs(glow - data[f * 4 + 1]) > 1e-3
    )
      changed = true;
    figureState.shown[f] = shown;
    figureState.glow[f] = glow;
    data[f * 4] = shown;
    data[f * 4 + 1] = glow;
  }
  if (changed) figureTexture.needsUpdate = true;
  const kept = segmentTexture.image.data;
  let keptChanged = false;
  for (let s = 0; s < kept.length; s += 1) {
    const value =
      figureState.kept[s] +
      (figureState.keptTarget[s] - figureState.kept[s]) *
        (reducedMotion.matches ? 1 : shownRate);
    if (Math.abs(value - kept[s]) > 1e-3) keptChanged = true;
    figureState.kept[s] = value;
    kept[s] = value;
  }
  if (keptChanged) segmentTexture.needsUpdate = true;
};

// Planets share the stars' shader, so the same sky decides whether they show.
const planetGeometry = new THREE.BufferGeometry();
planetGeometry.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(new Float32Array(planets.length * 3), 3),
);
planetGeometry.setAttribute(
  "magColor",
  new THREE.BufferAttribute(new Uint8Array(planets.length * 2), 2),
);
// Planets share the stars' look but shine steadily: they are discs, not points.
const planetPoints = pointsOf(
  planetGeometry,
  pointMaterial({ ...starUniforms, uSteady: { value: 1 } }),
  1,
);
planetPoints.visible = false;
world.add(planetPoints);
const planetLabels = planets.map(({ body }) => makeLabel(body, "planet"));

const placePlanets = (time) => {
  guide.planets = planetStates(planets, time);
  const position = planetGeometry.attributes.position;
  const magColor = planetGeometry.attributes.magColor;
  guide.planets.forEach(({ body, vector, mag, bv }, i) => {
    position.setXYZ(i, ...vector);
    // A planet whose picture shows its disc is drawn by the picture instead.
    const shown = pictureShown.has(body)
      ? 255
      : clamp(Math.round((mag + 1.5) * 16), 0, 255);
    magColor.setXY(i, shown, clamp(Math.round((bv + 0.5) * 80), 0, 255));
  });
  position.needsUpdate = true;
  magColor.needsUpdate = true;
};

const loadGuides = async () => {
  const [names, constellations] = await Promise.all([
    loadStarNames().catch(() => null),
    loadConstellations().catch(() => null),
  ]);
  guide.names = names;
  if (constellations) {
    guide.constellations = constellations;
    guide.figures = buildFigures(constellations);
    guide.labels = constellations.names.map((c) => {
      const node = makeLabel(c.name, "constellation");
      node.dataset.rank = String(c.rank);
      return {
        ...c,
        node,
        vector: vectorOf(c.ra, c.dec),
        figure: guide.figures.index.get(c.id),
      };
    });
  }
  applyGuides(getState());
};

// Turn smoothly to face a point in the sky.
const turnTo = (altitude, azimuth) => {
  const target = -azimuth * DEG;
  const yaw =
    target + Math.round((look.yaw - target) / (2 * Math.PI)) * 2 * Math.PI;
  look.yawVelocity = 0;
  look.pitchVelocity = 0;
  gsap.to(look, {
    yaw,
    pitch: clamp(altitude, config.view.pitchMin, 60) * DEG,
    duration: reducedMotion.matches ? 0 : 1.6,
    ease: "power2.inOut",
  });
};

// Where each planet is tonight, in the guides panel: tap one that is up to face it.
const planetList = guidesPanel.querySelector(".planet-list");
const planetRowTemplate = document.getElementById("planet-row");

const renderPlanetList = (state) => {
  if (!guide.planets || !currentSky || !guidesPanel.matches(":popover-open"))
    return;
  planetList.replaceChildren(
    ...guide.planets.map((planet) => {
      const node = planetRowTemplate.content.cloneNode(true).firstElementChild;
      const button = node.querySelector("button");
      const where = horizontalOf(sceneOf(planet.vector));
      node.querySelector(".planet-name").textContent = planet.body;
      if (where.altitude > 0) {
        node.querySelector(".planet-where").textContent =
          `${Math.round(where.altitude)}° up, ${compassPoint(where.azimuth)}`;
        button.addEventListener("click", () =>
          turnTo(where.altitude, where.azimuth),
        );
      } else {
        const rise = nextRise(planet.body, state.site, state.time);
        node.querySelector(".planet-where").textContent = rise
          ? `rises ${formatClock(state.site.timeZone, rise)}`
          : "below the horizon";
        button.disabled = true;
      }
      return node;
    }),
  );
};

guidesPanel.addEventListener("toggle", () => renderPlanetList(getState()));

const applyGuides = (state) => {
  const on = guidesOn(state);
  if (guide.figures && guide.figures.on !== Boolean(on.constellations)) {
    const show = Boolean(on.constellations);
    const { lines, glows } = guide.figures;
    guide.figures.on = show;
    lines.visible = true;
    glows.visible = true;
    if (!show) {
      figureState.hovered = null;
      figureState.pinned = null;
    }
    judgeFigures(state);
    gsap.to(lineUniforms.uOpacity, {
      value: show ? config.guideStyle.lineOpacity : 0,
      duration: reducedMotion.matches ? 0 : 0.8,
      ease: "power1.inOut",
      onComplete: () => {
        lines.visible = show;
        glows.visible = show;
      },
    });
  }
  labelLayer.dataset.constellations = String(Boolean(on.constellations));
  // Planets are always in the sky; the guide names them.
  planetPoints.visible = true;
  guideSwitches.forEach(({ key, node }) =>
    node.setAttribute("aria-pressed", String(Boolean(on[key]))),
  );
  planetsMore.hidden = !on.planets;
  renderPlanetList(state);
  if (!on.details && state.selected) setState({ selected: null });
};

// Labels follow their points across the screen each frame.
const sceneOf = (vector) => applyMatrix(currentSky, vector);
const project = (direction) => {
  projected
    .set(...direction)
    .multiplyScalar(100)
    .add(camera.position)
    .project(camera);
  return {
    x: ((projected.x + 1) / 2) * window.innerWidth,
    y: ((1 - projected.y) / 2) * window.innerHeight,
    onScreen:
      projected.z < 1 &&
      Math.abs(projected.x) < 1.05 &&
      Math.abs(projected.y) < 1.05,
    inFront: projected.z < 1,
  };
};

const placeLabel = (node, direction, show) => {
  const at = project(direction);
  const visible =
    show &&
    at.onScreen &&
    direction[1] > Math.sin(config.guideStyle.labelAltitude * DEG);
  node.style.visibility = visible ? "visible" : "hidden";
  if (visible)
    node.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) ${node.dataset.kind === "planet" ? "translate(0, -50%)" : "translate(-50%, -50%)"}`;
  return at;
};

const placeGuides = () => {
  if (!currentSky) return;
  const { guides: on = {}, selected } = getState();
  guide.labels.forEach(({ node, vector, figure }) => {
    let direction = sceneOf(vector);
    const where = horizontalOf(direction);
    const middle =
      figure === undefined ? null : guide.figures.figures[figure].middle;
    if (middle && where.altitude < horizonAltitude(where.azimuth) + 1)
      direction = sceneOf(middle);
    // A name follows its figure: gone when the figure is, brighter when it is lit up.
    const shown = figure === undefined ? 1 : figureState.shown[figure];
    const lit = figure === undefined ? 0 : figureState.glow[figure];
    placeLabel(node, direction, shown > 0.01);
    node.style.setProperty("--shown", shown.toFixed(2));
    node.style.setProperty("--lit", lit.toFixed(2));
    // Names thin out toward the horizon, where the air would hide them anyway.
    node.style.setProperty(
      "--rise",
      clamp(
        (Math.asin(clamp(direction[1], -1, 1)) / DEG -
          config.guideStyle.labelAltitude) /
          10,
        0,
        1,
      ).toFixed(2),
    );
  });
  planetLabels.forEach((node, i) => {
    placeLabel(
      node,
      guide.planets ? sceneOf(guide.planets[i].vector) : [0, -1, 0],
      Boolean(on.planets),
    );
    // Over a disc drawn by its picture the mark would sit on the planet itself:
    // the name moves beside the disc and the ring goes.
    const disc = pictureShown.has(planets[i].body)
      ? (picturesOf.find(({ body }) => body === planets[i].body)?.pixels ?? 0)
      : 0;
    node.dataset.disc = String(disc > 0);
    if (disc > 0) node.style.setProperty("--disc", `${Math.round(disc)}px`);
  });
  placeSelection(selected);
};

// --- The constellation under the pointer or crosshair (or tapped): its name, where
// it is and what it does tonight, and what lies beside it, to turn to.
const figureCard = root.querySelector(".figure-card");
const figureNameText = figureCard.querySelector(".figure-name");
const figureWhereText = figureCard.querySelector(".figure-where");
const figureNear = figureCard.querySelector(".figure-near");
let figureShown = { figure: null, time: 0 };

const labelOf = (figure) =>
  guide.labels?.find((label) => label.figure === figure);
const whereOf = (vector) => horizontalOf(sceneOf(vector));

// What a point of the sky does over the next day: rising or sinking, when it is
// highest, and when it sets, or that it never does here.
const pathTonight = (vector, state) => {
  const minute = 60000;
  const altitudes = Array.from({ length: 145 }, (_, k) => {
    const direction = applyMatrix(
      skyMatrix(state.site, state.time + k * 10 * minute),
      vector,
    );
    return Math.asin(clamp(direction[1], -1, 1)) / DEG;
  });
  const clockIn = (k) =>
    formatClock(state.site.timeZone, state.time + k * 10 * minute);
  const now = altitudes[0];
  if (Math.min(...altitudes) > 0) return "never sets here";
  if (now <= 0) {
    const rise = altitudes.findIndex((a) => a > 0);
    return rise > 0 ? `rises ${clockIn(rise)}` : "not up tonight";
  }
  if (altitudes[1] > now) {
    const peak = altitudes.findIndex((a, k) => k && a < altitudes[k - 1]) - 1;
    return `climbing until ${clockIn(Math.max(peak, 0))}`;
  }
  const set = altitudes.findIndex((a) => a <= 0);
  return set > 0 ? `sinking · sets ${clockIn(set)}` : "sinking";
};

const nearChip = (text, kind, onPick) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "near-chip";
  button.dataset.kind = kind;
  button.textContent = text;
  button.addEventListener("click", onPick);
  return button;
};

const renderFigureCard = (figure, state) => {
  const label = labelOf(figure);
  if (!label) return;
  figureNameText.textContent = label.name;
  const vector = guide.figures.figures[figure].middle ?? label.vector;
  const where = whereOf(vector);
  figureWhereText.textContent = `${POINTS[Math.round(where.azimuth / 22.5) % 16]} · ${Math.max(0, Math.round(where.altitude))}° up · ${pathTonight(label.vector, state)}`;
  // Beside it: the nearest constellations that can be made out tonight, and any planet among its stars.
  const centre = new THREE.Vector3(...label.vector);
  const neighbours = guide.labels
    .filter(
      (other) =>
        other.figure !== undefined &&
        other.figure !== figure &&
        figureState.shownTarget[other.figure],
    )
    .map((other) => ({
      other,
      angle: centre.angleTo(new THREE.Vector3(...other.vector)) / DEG,
    }))
    .filter(({ angle }) => angle < config.guideStyle.nearDegrees)
    .sort((a, b) => a.angle - b.angle)
    .slice(0, 3);
  const planetsHere =
    guidesOn(state).planets && guide.planets
      ? guide.planets.filter(
          (p) =>
            centre.angleTo(new THREE.Vector3(...p.vector)) / DEG <
              config.guideStyle.planetNearDegrees &&
            whereOf(p.vector).altitude > 0,
        )
      : [];
  figureNear.replaceChildren(
    ...planetsHere.map((p) =>
      nearChip(p.body, "planet", () => {
        const at = whereOf(p.vector);
        turnTo(at.altitude, at.azimuth);
      }),
    ),
    ...neighbours.map(({ other }) =>
      nearChip(other.name, "constellation", () => {
        const at = whereOf(
          guide.figures.figures[other.figure].middle ?? other.vector,
        );
        figureState.pinned = other.figure;
        turnTo(at.altitude, at.azimuth);
      }),
    ),
  );
  figureNear.hidden = !figureNear.children.length;
};

// Each frame: which figure the card is about, and where it sits, beside the figure's name.
const placeFigureCard = () => {
  const state = getState();
  const figure = figureState.hovered ?? figureState.pinned;
  const show =
    figure !== null && guide.figures?.on && !state.selected && currentSky;
  figureCard.hidden = !show;
  if (!show) {
    figureShown.figure = null;
    return;
  }
  if (figure !== figureShown.figure || state.time !== figureShown.time) {
    figureShown = { figure, time: state.time };
    renderFigureCard(figure, state);
  }
  const kept = figure === figureState.pinned && figureState.hovered === null;
  figureCard.dataset.kept = String(kept);
  // Beside the figure's outline on screen, on whichever side has room, so it never covers the figure.
  const box = {
    left: Infinity,
    right: -Infinity,
    top: Infinity,
    bottom: -Infinity,
  };
  guide.figures.figures[figure].segments.forEach(({ kept, from, to }) => {
    if (!kept) return;
    [from, to].forEach((vector) => {
      const at = project(sceneOf(vector));
      if (!at.inFront) return;
      box.left = Math.min(box.left, at.x);
      box.right = Math.max(box.right, at.x);
      box.top = Math.min(box.top, at.y);
      box.bottom = Math.max(box.bottom, at.y);
    });
  });
  if (box.left === Infinity) {
    figureCard.hidden = true;
    return;
  }
  const gap = 28;
  const edge = 16;
  const width = figureCard.offsetWidth;
  const height = figureCard.offsetHeight;
  const x =
    box.right + gap + width < window.innerWidth - edge
      ? box.right + gap
      : box.left - gap - width > edge
        ? box.left - gap - width
        : window.innerWidth - width - edge;
  const y = clamp(
    (box.top + box.bottom) / 2 - height / 2,
    edge + 50,
    window.innerHeight - height - 110,
  );
  figureCard.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
};

// --- Star details on tap
const card = root.querySelector(".star-card");
const ring = root.querySelector(".star-ring");
const factTemplate = document.getElementById("star-fact");

const selectionVector = (selected) => {
  if (selected?.kind === "planet")
    return guide.planets?.find((p) => p.body === selected.body)?.vector ?? null;
  if (selected?.kind === "star") {
    const bytes = layers.naked?.bytes;
    return bytes
      ? [0, 2, 4].map(
          (o) =>
            new DataView(bytes.buffer).getInt16(selected.index * 8 + o, true) /
            32767,
        )
      : null;
  }
  return null;
};

const placeSelection = (selected) => {
  const vector = selectionVector(selected);
  const show = Boolean(vector);
  ring.hidden = !show;
  card.hidden = !show;
  if (!show) return;
  const direction = sceneOf(vector);
  const at = project(direction);
  const visible = at.onScreen && direction[1] > -0.02;
  ring.style.visibility = visible ? "visible" : "hidden";
  card.style.visibility = visible ? "visible" : "hidden";
  ring.style.transform = `translate(${(at.x - 13).toFixed(1)}px, ${(at.y - 13).toFixed(1)}px)`;
  // The card sits beside the star, on whichever side has room.
  const right = at.x + 24 + card.offsetWidth < window.innerWidth - 16;
  const left = right ? at.x + 24 : at.x - 24 - card.offsetWidth;
  const top = clamp(
    at.y - card.offsetHeight / 2,
    16,
    window.innerHeight - card.offsetHeight - 16,
  );
  card.style.transform = `translate(${Math.max(16, left).toFixed(1)}px, ${top.toFixed(1)}px)`;
};

const nearestStar = (eq) => {
  const bytes = layers.naked?.bytes;
  if (!bytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = countBrighterThan(bytes, config.guideStyle.pickMagnitude);
  const best = {
    index: -1,
    dot: Math.cos(config.guideStyle.pickDegrees * DEG),
  };
  new Uint32Array(count).forEach((_, i) => {
    const dot =
      (eq[0] * view.getInt16(i * 8, true) +
        eq[1] * view.getInt16(i * 8 + 2, true) +
        eq[2] * view.getInt16(i * 8 + 4, true)) /
      32767;
    if (dot > best.dot) Object.assign(best, { index: i, dot });
  });
  return best.index < 0 ? null : best;
};

const tapAt = (x, y) => {
  if (draw.active) {
    drawAt(x, y);
    return;
  }
  const state = getState();
  // A tap lights up the constellation under it, or puts out the one that was lit.
  if (guidesOn(state).constellations && guide.figures) {
    const tapped = figureAt(x, y);
    figureState.pinned = tapped === figureState.pinned ? null : tapped;
  }
  if (!guidesOn(state).details || !currentSky) return;
  // A tap while a card is open only closes it; the next tap picks a star.
  if (state.selected) {
    setState({ selected: null });
    return;
  }
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      (x / window.innerWidth) * 2 - 1,
      -(y / window.innerHeight) * 2 + 1,
    ),
    camera,
  );
  const d = ray.ray.direction;
  if (d.y < 0) {
    setState({ selected: null });
    return;
  }
  // Scene direction back to J2000 equatorial: the sky matrix is a rotation, so its transpose undoes it.
  const m = currentSky;
  const eq = [0, 1, 2].map(
    (j) => m[0][j] * d.x + m[1][j] * d.y + m[2][j] * d.z,
  );
  const star = nearestStar(eq);
  const planet =
    guidesOn(state).planets && guide.planets
      ? guide.planets
          .map((p) => ({
            body: p.body,
            dot:
              p.vector[0] * eq[0] + p.vector[1] * eq[1] + p.vector[2] * eq[2],
          }))
          .reduce((a, b) => (b.dot > a.dot ? b : a), {
            dot: Math.cos(config.guideStyle.pickDegrees * DEG),
          })
      : null;
  if (planet?.body && (!star || planet.dot >= star.dot))
    setState({ selected: { kind: "planet", body: planet.body } });
  else
    setState({ selected: star ? { kind: "star", index: star.index } : null });
};

const constellationName = (id) =>
  guide.constellations?.names.find((c) => c.id === id)?.name ?? id;

const fact = (label, value) => {
  const node = factTemplate.content.cloneNode(true).firstElementChild;
  node.querySelector("dt").textContent = label;
  node.querySelector("dd").textContent = value;
  return node;
};

const renderCard = (state, now) => {
  const { selected } = state;
  if (!selected) return;
  const vector = selectionVector(selected);
  if (!vector) return;
  const where = horizontalOf(sceneOf(vector));
  const air =
    where.altitude > 0
      ? 1 /
        (Math.sin(where.altitude * DEG) +
          0.50572 * (where.altitude + 6.07995) ** -1.6364)
      : Infinity;
  const planet =
    selected.kind === "planet"
      ? guide.planets.find((p) => p.body === selected.body)
      : null;
  const about =
    selected.kind === "star" ? (guide.names?.[selected.index] ?? []) : [];
  const magnitude = planet
    ? planet.mag
    : layers.naked.bytes[selected.index * 8 + 6] / 16 - 1.5;
  const [proper, designation, con, lightYears, spectrum] = about;
  card.querySelector(".star-name").textContent = planet
    ? planet.body
    : proper || designation || "An unnamed star";
  card.querySelector(".star-designation").textContent = planet
    ? "Planet"
    : [proper ? designation : "", constellationName(con)]
        .filter(Boolean)
        .join(" · ");
  const facts = [
    ["Brightness", `magnitude ${magnitude.toFixed(1)}`],
    ...(planet
      ? [["Light takes", `${Math.round(planet.lightMinutes)} minutes`]]
      : []),
    ...(lightYears
      ? [["Distance", `${lightYears.toLocaleString()} light years`]]
      : []),
    ...(spectrum
      ? [
          [
            "Spectral type",
            spectrum.match(
              /^[OBAFGKMCSWDN][0-9.]*(?:I{1,3}|IV|V|Ia|Ib)?/,
            )?.[0] ?? spectrum,
          ],
        ]
      : []),
    [
      "In the sky",
      where.altitude > 0
        ? `${Math.round(where.altitude)}° up, ${compassPoint(where.azimuth)}`
        : "below the horizon",
    ],
  ];
  card
    .querySelector(".star-facts")
    .replaceChildren(...facts.map(([label, value]) => fact(label, value)));
  const apparent = magnitude + now.extinction * air;
  const reach = now.zenith.instrument - 0.3 * Math.max(air - 1, 0);
  const instrument = viewing(state);
  const seen = card.querySelector(".star-seen");
  seen.dataset.seen = String(apparent <= reach);
  if (where.altitude <= 0) seen.textContent = "Below the horizon right now.";
  else if (now.conditions.cloudCover > 75)
    seen.textContent = "Behind the clouds tonight.";
  else if (apparent <= reach)
    seen.textContent = `Visible here with the ${instrument.name.toLowerCase()}.`;
  else
    seen.textContent = `Too faint to see here with the ${instrument.name.toLowerCase()}.`;
};

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && getState().selected)
    setState({ selected: null });
  if (event.key === "Escape") figureState.pinned = null;
});

// --- Ways to play. Explore is the whole sky with its guides; the field game takes
// the guides away and asks for targets in the real sky, weather and land. Assists
// make either easier (and the game's points smaller). Both are kept in the browser.
const settingsStore = stored("stargazer:settings", {
  mode: "explore",
  assists: { trees: false, mountains: false, clouds: false, steady: false },
});
const progressStore = stored("stargazer:progress", {
  points: 0,
  logged: {},
  hunting: null,
  traced: {},
  drawings: [],
  awards: [],
});
const targetById = Object.fromEntries(
  targets.map((target) => [target.id, target]),
);
const menuPanel = document.getElementById("menu-panel");
const huntCard = root.querySelector(".hunt");
const observeRing = root.querySelector(".observe-ring");
const entryTemplate = document.getElementById("logbook-entry");
const assistCount = (assists) =>
  Object.values(assists ?? {}).filter(Boolean).length;
// Each assist takes a quarter off the points, down to a quarter.
const assistShare = (assists) =>
  Math.max(
    1 - config.game.assistCost * assistCount(assists),
    config.game.assistFloor,
  );

menuPanel.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", () => setState({ mode: input.value }));
});
menuPanel.querySelectorAll(".assists input").forEach((input) => {
  input.addEventListener("change", () =>
    setState((state) => ({
      assists: { ...state.assists, [input.name]: input.checked },
    })),
  );
});

watch(
  (s) => s.mode,
  (mode, state) => {
    root.dataset.mode = mode;
    menuPanel.dataset.mode = mode;
    settingsStore.set({ ...settingsStore.get(), mode });
    // The field game plays the real weather, so the sky's own settings are set aside.
    skyPanel.querySelectorAll(".condition-rows input").forEach((input) => {
      input.disabled = mode === "game";
    });
    skyPanel.dataset.mode = mode;
    renderMenu(state);
    renderHunt(state);
  },
);

watch(
  (s) => s.assists,
  (assists, state) => {
    ground.setTrees(!assists.trees);
    ground.setFlat(assists.mountains);
    remeasureHorizon();
    settingsStore.set({ ...settingsStore.get(), assists });
    renderMenu(state);
  },
);

// --- Tonight's plan: for each target, when it is up in a dark sky from here,
// how high it gets, and the least kit that shows it through this night's sky,
// worked out across the night in quarter hours. The logbook is grouped by it,
// so the night has a path: what the eye finds first, then binoculars, then a
// telescope; and what cannot be had tonight says why.
const KIT_GROUPS = {
  eye: "eye",
  binoculars: "binoculars",
  "tripod-binoculars": "binoculars",
  "small-telescope": "telescope",
  "large-telescope": "telescope",
};
let planCache = { key: "", weather: null, plan: null };

const nightPlan = (state) => {
  const { site } = state;
  const key = [
    site.latitude,
    site.longitude,
    nightMidnight(site.timeZone, state.time),
    JSON.stringify(state.assists),
    state.lightPollution?.ratio,
    JSON.stringify(state.override),
    state.mode,
  ].join("|");
  if (
    planCache.key === key &&
    planCache.weather === state.weather.result &&
    planCache.plan
  )
    return planCache.plan;
  const start = nightStart(state);
  const times = [];
  for (
    let t = start;
    t <= start + span * 2 * MINUTE;
    t += config.time.planStepMinutes * MINUTE
  )
    times.push(t);
  if (!times.includes(state.time)) times.push(state.time);
  const found = new Map(
    targets.map((target) => [
      target.id,
      { up: [], dark: [], clear: [], kits: [], above: false, night: false },
    ]),
  );
  times.forEach((t) => {
    const stateAt = {
      ...state,
      time: t,
      weather: {
        ...state.weather,
        at: state.weather.result?.rows.length
          ? weatherAt(state.weather.result, t)
          : state.weather.at,
      },
    };
    const now = skyNow(stateAt, instrumentById.eye);
    // Each instrument's reach overhead, in the hotbar's order.
    const reaches = instruments.map(
      (instrument) =>
        zenithSky({
          natural: config.visibility.naturalZenith,
          ratio: now.ratio,
          extinction: now.extinction,
          sun: now.sun,
          moon: now.moon,
          optics: opticsOf(instrument),
        }).instrument,
    );
    const m = skyMatrix(site, t);
    const planetsAt = planetStates(planets, t);
    const clouded = now.conditions.cloudCover > config.game.cloudCover;
    targets.forEach((target) => {
      const record = found.get(target.id);
      let vector;
      let magnitude;
      if (target.kind === "moon") {
        vector = now.moon.direction;
        magnitude = -10;
      } else if (target.kind === "planet") {
        const planet = planetsAt.find(({ body }) => body === target.body);
        vector = applyMatrix(m, planet.vector);
        magnitude = planet.mag;
      } else {
        vector = applyMatrix(m, equatorialVector(target));
        magnitude = target.needs;
      }
      const where = horizontalOf(vector);
      if (where.altitude > 0) record.above = true;
      // Up: clear of the land. Dark enough: bright planets show in twilight, the
      // Moon whenever the Sun is down, anything faint wants a dark sky.
      const up =
        where.altitude > 0.5 &&
        where.altitude >= horizonAltitude(where.azimuth) + 0.3;
      const darkEnough =
        now.sun.altitude <
        (target.kind === "moon" ? -0.8 : magnitude < 1 ? -6 : -12);
      if (!up) return;
      record.up.push(t);
      if (!darkEnough) return;
      if (target.kind === "moon" && now.moon.fraction < 0.02) return;
      record.dark.push(t);
      if (clouded) return;
      record.clear.push(t);
      const air =
        1 /
        (Math.sin(where.altitude * DEG) +
          0.50572 * (where.altitude + 6.07995) ** -1.6364);
      const apparent =
        target.kind === "moon" ? -10 : magnitude + now.extinction * air;
      const kit = instruments.findIndex(
        (_, i) => apparent <= reaches[i] - 0.3 * Math.max(air - 1, 0),
      );
      if (now.sun.altitude < -12) record.night = true;
      if (kit >= 0)
        record.kits.push({
          t,
          kit,
          altitude: where.altitude,
          azimuth: where.azimuth,
          fullDark: now.sun.altitude < -18,
        });
    });
  });
  const plan = new Map();
  targets.forEach((target) => {
    const record = found.get(target.id);
    const entry = {
      group: "none",
      reason: "",
      now: false,
      first: null,
      best: null,
      kit: null,
    };
    if (record.kits.length) {
      const easiest = Math.min(...record.kits.map(({ kit }) => kit));
      const reachable = record.kits.filter(({ kit }) => kit === easiest);
      entry.kit = instruments[easiest];
      entry.group = KIT_GROUPS[entry.kit.id];
      entry.now = reachable.some(({ t }) => t === state.time);
      entry.first = Math.min(...reachable.map(({ t }) => t));
      // The best hour is the highest in full dark, where there is any.
      const dark = reachable.filter(({ fullDark }) => fullDark);
      entry.best = (dark.length ? dark : reachable).reduce((best, sample) =>
        sample.altitude > best.altitude ? sample : best,
      );
    } else if (record.clear.length)
      entry.reason = record.night
        ? "Too faint for this sky tonight, even with the large telescope."
        : "Lost in twilight, low in a bright sky.";
    else if (record.dark.length) entry.reason = "Clouded over tonight.";
    else if (record.up.length)
      entry.reason =
        target.kind === "moon"
          ? "New Moon tonight."
          : "Up only in daylight this month.";
    else if (record.above)
      entry.reason = "Behind the land all night. Find a lower horizon.";
    else if (
      target.dec !== undefined &&
      (site.latitude >= 0
        ? target.dec < site.latitude - 90
        : target.dec > site.latitude + 90)
    ) {
      entry.reason = `Never rises this far ${site.latitude >= 0 ? "north" : "south"}. Travel ${target.dec < 0 ? "south" : "north"}.`;
    } else entry.reason = "Below the horizon all night.";
    plan.set(target.id, entry);
  });
  planCache = { key, weather: state.weather.result, plan };
  return plan;
};

const PLAN_GROUPS = [
  ["eye", "By eye tonight"],
  ["binoculars", "With binoculars"],
  ["telescope", "With a telescope"],
  ["none", "Not tonight"],
];

const renderMenu = (state) => {
  const progress = progressStore.get();
  menuPanel.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.checked = input.value === state.mode;
  });
  menuPanel.querySelectorAll(".assists input").forEach((input) => {
    input.checked = Boolean(state.assists?.[input.name]);
  });
  const share = assistShare(state.assists);
  menuPanel.querySelector(".assist-cost").textContent =
    state.mode !== "game"
      ? "Assists change the land and sky; in the field game each takes a quarter off the points."
      : share < 1
        ? `Targets are worth ${Math.round(share * 100)}% of their points with these assists.`
        : "Targets are worth their full points.";
  const logged = Object.keys(progress.logged).length;
  menuPanel.querySelector(".menu-score").textContent =
    state.mode === "game"
      ? `${progress.points} points · ${logged} of ${targets.length} logged`
      : "";
  const list = menuPanel.querySelector(".logbook-list");
  const plan = state.site && state.mode === "game" ? nightPlan(state) : null;
  const clock = (ms) => formatClock(state.site.timeZone, ms);
  const counts = Object.fromEntries(PLAN_GROUPS.map(([group]) => [group, 0]));
  targets.forEach((target) => {
    counts[plan?.get(target.id)?.group ?? "none"] += 1;
  });
  menuPanel.querySelector(".logbook-summary").textContent = plan
    ? `Tonight from here: ${counts.eye} by eye, ${counts.binoculars} with binoculars, ${counts.telescope} with a telescope, ${counts.none} not tonight.`
    : "";
  // Grouped by the least kit that shows each target tonight, easier first; what
  // is logged stays in its group, at the end.
  const byGroup = PLAN_GROUPS.map(([group, title]) => [
    title,
    targets
      .filter((target) => (plan?.get(target.id)?.group ?? "none") === group)
      .sort(
        (a, b) =>
          Number(Boolean(progress.logged[a.id])) -
            Number(Boolean(progress.logged[b.id])) || a.points - b.points,
      ),
  ]);
  list.replaceChildren(
    ...byGroup
      .filter(([, group]) => group.length)
      .flatMap(([title, group]) => [
        Object.assign(document.createElement("li"), {
          className: "logbook-group",
          textContent: title,
        }),
        ...group.map((target) => {
          const node = entryTemplate.content.cloneNode(true).firstElementChild;
          const entry = progress.logged[target.id];
          const tonight = plan?.get(target.id);
          node.dataset.logged = String(Boolean(entry));
          node.querySelector(".entry-name").textContent = target.name;
          node.querySelector(".entry-points").textContent = entry
            ? `Logged${entry.detail ? " in detail" : ""} · ${entry.points}`
            : `${Math.round(target.points * share)} points${pictures.some(({ id }) => id === target.id) ? " · more in detail" : ""}`;
          node.querySelector(".entry-when").textContent = !tonight
            ? ""
            : tonight.group === "none"
              ? tonight.reason
              : `${tonight.now ? "Up now" : `From ${clock(tonight.first)}`} · best ${clock(tonight.best.t)} · ${Math.round(tonight.best.altitude)}° up ${POINTS[Math.round(tonight.best.azimuth / 22.5) % 16]}${
                  tonight.group === "eye"
                    ? ""
                    : ` · ${tonight.kit.short.toLowerCase()}`
                }`;
          node.querySelector(".entry-about").textContent = target.about;
          node.querySelector(".entry-button").title = target.about;
          if (entry?.detail && pictures.some(({ id }) => id === target.id)) {
            const thumb = document.createElement("img");
            thumb.className = "entry-picture";
            thumb.alt = "";
            thumb.loading = "lazy";
            thumb.src = assetUrl(`${config.assets.objects}${target.id}.jpg`);
            node.querySelector(".entry-button").append(thumb);
          }
          const button = node.querySelector(".entry-button");
          if (progress.hunting === target.id)
            button.setAttribute("aria-current", "true");
          button.addEventListener("click", () => {
            progressStore.set({ ...progressStore.get(), hunting: target.id });
            hunt.judged = 0;
            menuPanel.hidePopover();
            renderMenu(getState());
            renderHunt(getState());
          });
          return node;
        }),
      ]),
  );
};

// Esc opens the menu when nothing else is open to close; L opens it in the game.
// Esc opens it as the key comes up, so the same press cannot close it again.
let escapeOpens = false;
window.addEventListener("keydown", (event) => {
  const state = getState();
  if (
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.target.closest?.("input")
  )
    return;
  const open = document.querySelector(":popover-open");
  escapeOpens =
    event.key === "Escape" &&
    !open &&
    !state.selected &&
    figureState.pinned === null &&
    !draw.active &&
    state.view === "ground";
  if (
    event.code === "KeyL" &&
    state.mode === "game" &&
    state.view === "ground" &&
    !open
  )
    menuPanel.showPopover();
});
window.addEventListener("keyup", (event) => {
  if (event.key !== "Escape" || !escapeOpens) return;
  escapeOpens = false;
  menuPanel.showPopover();
});
menuPanel.addEventListener("toggle", (event) => {
  if (event.newState === "open") renderMenu(getState());
});
huntCard
  .querySelector(".hunt-change")
  .addEventListener("click", () => menuPanel.showPopover());

// --- Help: what the sky, the numbers and the game mean, in tabs; ? opens it.
const helpPanel = document.getElementById("help-panel");
const helpTabs = [...helpPanel.querySelectorAll('[role="tab"]')];
const showHelpTab = (tab) => {
  helpTabs.forEach((other) => {
    const on = other === tab;
    other.setAttribute("aria-selected", String(on));
    other.tabIndex = on ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden = !on;
  });
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });
};
helpTabs.forEach((tab, i) => {
  tab.addEventListener("click", () => showHelpTab(tab));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const next = helpTabs[(i + step + helpTabs.length) % helpTabs.length];
    showHelpTab(next);
    next.focus();
  });
});
helpTabs.forEach((tab, i) => {
  tab.tabIndex = i ? -1 : 0;
});
window.addEventListener("keydown", (event) => {
  if (
    event.key !== "?" ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.target.closest?.("input")
  )
    return;
  if (helpPanel.matches(":popover-open")) helpPanel.hidePopover();
  else {
    document
      .querySelectorAll(":popover-open")
      .forEach((open) => open.hidePopover());
    helpPanel.showPopover();
  }
});

// --- Star catalogs, in the menu: which one the sky draws from, and downloading
// or switching any of them at any time. The sky line's catalog opens it.
const catalogTemplate = document.getElementById("catalog-entry");
const catalogSection = menuPanel.querySelector(".catalogs");
const renderCatalogs = (state) => {
  const using = catalogInUse(state);
  menuPanel.querySelector(".catalog-list").replaceChildren(
    ...CATALOGS.map((id) => {
      const set = starSets[id];
      const status =
        id === "naked" ? "ready" : (state.starSets?.[id]?.status ?? "unknown");
      const node = catalogTemplate.content.cloneNode(true).firstElementChild;
      const action = node.querySelector(".catalog-action");
      node.querySelector(".catalog-name").textContent = set.title;
      node.querySelector(".catalog-about").textContent =
        `${set.source} · ${set.count} stars to mag ${set.reach}${id === "naked" ? " · built in" : ""}`;
      const deepNeedsDesktop = id === "deep" && !desktop;
      node.dataset.state =
        id === using ? "in-use" : deepNeedsDesktop ? "unavailable" : status;
      action.disabled = true;
      if (id === using) action.textContent = "In use";
      else if (deepNeedsDesktop) action.textContent = "Needs a desktop";
      else if (status === "ready") {
        action.textContent = "Use";
        action.disabled = false;
        action.addEventListener("click", () => setState({ catalog: id }));
      } else if (status === "available") {
        action.textContent = `Download · ${megabytes(state.starSets[id].bytes ?? 0)}`;
        action.disabled = false;
        action.addEventListener("click", async () => {
          // The deep set builds on the full set, which comes first if it is missing.
          const needed =
            id === "deep" && state.starSets.full?.status !== "ready"
              ? ["full", "deep"]
              : [id];
          await needed.reduce(
            (done, name) => done.then(() => downloadSet(name)),
            Promise.resolve(),
          );
        });
      } else if (status === "downloading") {
        action.textContent = `Downloading ${Math.round((state.starSets[id].progress ?? 0) * 100)}%`;
        node.querySelector(".catalog-progress i").style.width =
          `${(state.starSets[id].progress ?? 0) * 100}%`;
      } else if (status === "error") {
        action.textContent = "Try again";
        action.disabled = false;
        action.addEventListener("click", () => downloadSet(id));
      } else if (status === "missing") action.textContent = "Not in this copy";
      else action.textContent = "Checking…";
      return node;
    }),
  );
};
watch(
  (s) => `${JSON.stringify(s.starSets)}|${s.catalog}`,
  (_, state) => {
    if (menuPanel.matches(":popover-open")) renderCatalogs(state);
  },
);
menuPanel.addEventListener("toggle", (event) => {
  if (event.newState === "open") renderCatalogs(getState());
});
[catalogButton, starsButton].forEach((button) =>
  button.addEventListener("click", () => {
    menuPanel.showPopover();
    catalogSection.scrollIntoView({ block: "nearest" });
  }),
);

// --- The hunt: where the target is, whether it can be seen from here and now (and
// if not, what stands in the way), and holding it in view long enough to log it.
const hunt = {
  judged: 0,
  judgement: null,
  held: 0,
  rising: new Map(),
  pictureUntil: 0,
};

const targetDirection = (target, now) => {
  if (target.kind === "moon")
    return { vector: now.moon.direction, magnitude: -10 };
  if (target.kind === "planet") {
    const planet = guide.planets?.find(({ body }) => body === target.body);
    return planet
      ? {
          vector: sceneOf(planet.vector),
          magnitude: planet.mag,
          equatorial: planet.vector,
        }
      : null;
  }
  const equatorial = equatorialVector(target);
  return { vector: sceneOf(equatorial), magnitude: target.needs, equatorial };
};

// When a target below the horizon next rises while the sky is dark, within a
// day; or why it does not.
const darkRise = (target, equatorial, state, magnitude) => {
  const key = `${target.id}|${state.site.latitude},${state.site.longitude}|${Math.round(state.time / 600000)}`;
  if (hunt.rising.has(key)) return hunt.rising.get(key);
  let rises = null;
  let ever = false;
  for (let minutes = 10; minutes <= 24 * 60; minutes += 10) {
    const time = state.time + minutes * 60000;
    const up =
      horizontalOf(applyMatrix(skyMatrix(state.site, time), equatorial))
        .altitude > 3;
    if (!up) continue;
    ever = true;
    // Bright planets show in twilight; anything faint wants a dark sky.
    if (sunState(state.site, time).altitude < (magnitude < 1 ? -6 : -12)) {
      rises = time;
      break;
    }
  }
  const answer = rises ? { time: rises } : { never: !ever };
  hunt.rising.set(key, answer);
  return answer;
};

const judgeTarget = (target, state, now) => {
  const found = targetDirection(target, now);
  if (!found)
    return {
      visible: false,
      reason: "Its place in the sky is still being worked out.",
    };
  const where = horizontalOf(found.vector);
  const place = `${compassPoint(where.azimuth)}, ${Math.round(where.altitude)}° up`;
  const result = (visible, reason) => ({
    visible,
    reason,
    where,
    vector: found.vector,
  });
  if (where.altitude <= 0.5) {
    if (target.kind === "moon")
      return result(
        false,
        "The Moon is below the horizon. Try another hour or night.",
      );
    const rise = found.equatorial
      ? darkRise(target, found.equatorial, state, found.magnitude)
      : {};
    if (rise.time)
      return result(
        false,
        `Below the horizon. It is up in a dark enough sky by about ${formatClock(state.site.timeZone, rise.time)}.`,
      );
    if (rise.never) {
      const way = (target.dec ?? 0) < 0 ? "south" : "north";
      return result(
        false,
        `It never rises this far from the ${way === "south" ? "southern" : "northern"} sky. Travel ${way}.`,
      );
    }
    return result(
      false,
      "Below the horizon, and up only in daylight these days. Try another month.",
    );
  }
  if (now.sun.altitude > -0.8 && found.magnitude > -4)
    return result(
      false,
      `Daylight hides it. It sits ${place}; come back after dark.`,
    );
  if (where.altitude < horizonAltitude(where.azimuth) + 0.3) {
    return result(
      false,
      `The land hides it, ${place}. Find higher ground or a lower horizon to the ${compassPoint(where.azimuth)}.`,
    );
  }
  if (
    ground.treesAbove(
      camera.position.x,
      camera.position.z,
      camera.position.y,
      where.azimuth * DEG,
      where.altitude * DEG,
    )
  ) {
    return result(
      false,
      `Trees stand in the way, ${place}. Find a clearing open to the ${compassPoint(where.azimuth)}.`,
    );
  }
  if (now.conditions.cloudCover > config.game.cloudCover)
    return result(
      false,
      `Clouds cover the sky here tonight. Find clearer weather.`,
    );
  const air =
    1 /
    (Math.sin(where.altitude * DEG) +
      0.50572 * (where.altitude + 6.07995) ** -1.6364);
  const reach = now.zenith.instrument - 0.3 * Math.max(air - 1, 0);
  if (found.magnitude + now.extinction * air > reach) {
    const instrument = viewing(state).name.toLowerCase();
    if (now.sun.altitude > -18)
      return result(
        false,
        `Twilight still hides it with the ${instrument}, ${place}. Wait for full dark, or use more aperture.`,
      );
    if (now.moon.altitude > 0 && now.moon.fraction > 0.4)
      return result(
        false,
        `Too faint with the Moon up and the ${instrument}, ${place}. Wait for moonset, or use more aperture.`,
      );
    return result(
      false,
      `Too faint for this sky with the ${instrument}, ${place}. A darker place or more aperture would show it.`,
    );
  }
  return result(
    true,
    `In view, ${place}. Center it and hold steady to log it.`,
  );
};

// How close to the center of the view the target must be: the middle of the
// eyepiece's field, or a few degrees for the naked eye.
const aimRadius = () => {
  const { field } = viewing(getState());
  return (field ? field * config.game.fieldShare : config.game.eyeRadius) * DEG;
};

const viewAxis = new THREE.Vector3();
const stepHunt = (dt, now) => {
  const state = getState();
  const target =
    state.mode === "game" && state.view === "ground"
      ? targetById[progressStore.get().hunting]
      : null;
  const logged = target && progressStore.get().logged[target.id];
  if (!target || logged || !currentSky) {
    observeRing.dataset.show = "false";
    hunt.held = 0;
    return;
  }
  if (now - hunt.judged > config.game.judgeEvery * 1000) {
    hunt.judged = now;
    hunt.judgement = judgeTarget(target, state, skyNow(state));
    renderHunt(state);
  }
  const judgement = hunt.judgement;
  if (!judgement?.vector) return;
  camera.getWorldDirection(viewAxis);
  const off = viewAxis.angleTo(new THREE.Vector3(...judgement.vector));
  const centred = judgement.visible && off < aimRadius();
  hunt.held = centred ? hunt.held + dt : Math.max(0, hunt.held - dt * 2);
  observeRing.dataset.show = String(centred || hunt.held > 0);
  observeRing.style.setProperty(
    "--held",
    String(Math.min(1, hunt.held / config.game.holdSeconds)),
  );
  if (hunt.held >= config.game.holdSeconds) logTarget(target, state);
};

const logTarget = (target, state) => {
  const progress = progressStore.get();
  const detail = seenInDetail(target);
  const points = Math.round(
    target.points *
      (detail ? 1 + config.pictures.detailBonus : 1) *
      assistShare(state.assists),
  );
  progressStore.set({
    ...progress,
    points: progress.points + points,
    logged: {
      ...progress.logged,
      [target.id]: {
        at: Date.now(),
        points,
        detail,
        assisted: assistCount(state.assists) > 0,
        place:
          state.site.name ||
          `${state.site.latitude.toFixed(2)}, ${state.site.longitude.toFixed(2)}`,
        instrument: state.instrument,
        time: state.time,
      },
    },
  });
  hunt.held = 0;
  observeRing.dataset.show = "false";
  celebrate(points, progress.points, detail);
  hint(
    `Logged ${target.name}${detail ? " in detail" : ""} · +${points} points`,
  );
  // The photograph shows for a while, then leaves the eyepiece clear; the
  // logbook keeps it.
  if (detail) {
    hunt.pictureUntil = performance.now() + config.pictures.keepSeconds * 1000;
    setTimeout(
      () => renderHunt(getState()),
      config.pictures.keepSeconds * 1000 + 50,
    );
  }
  renderHunt(state);
  checkAwards();
};

// --- The moment of logging: the ring closes on the target in gold, the points
// rise from it and the score counts up, with a quiet chime when sound is on.
const pointsRise = root.querySelector(".points-rise");
const huntScore = huntCard.querySelector(".hunt-score");
let countingScore = 0;
const celebrate = (points, from, detail) => {
  const { closeSeconds, riseSeconds, countSeconds } = config.game.moment;
  observeRing.style.setProperty("--held", "1");
  observeRing.dataset.logged = "true";
  setTimeout(() => {
    observeRing.dataset.logged = "false";
  }, closeSeconds * 1000);
  pointsRise.textContent = `+${points}`;
  pointsRise.dataset.detail = String(detail);
  pointsRise.dataset.show = "false";
  // Restarted from the top for a second log within a moment.
  void pointsRise.offsetWidth;
  pointsRise.dataset.show = "true";
  setTimeout(() => {
    pointsRise.dataset.show = "false";
  }, riseSeconds * 1000);
  // The score counts up to its new total, quickly at first.
  const to = from + points;
  const started = performance.now();
  const count = ++countingScore;
  hunt.counting = true;
  const tick = (now) => {
    if (count !== countingScore) return;
    const t = reducedMotion.matches
      ? 1
      : Math.min(1, (now - started) / (countSeconds * 1000));
    const eased = 1 - (1 - t) ** 3;
    huntScore.textContent = `${Math.round(from + (to - from) * eased)} points`;
    if (t < 1) requestAnimationFrame(tick);
    else hunt.counting = false;
  };
  requestAnimationFrame(tick);
  if (soundOn) soundscape.chime(detail);
};

const renderHunt = (state) => {
  const game = state.mode === "game";
  huntCard.hidden = !game;
  if (!game) return;
  const progress = progressStore.get();
  const target = targetById[progress.hunting];
  // While the score is counting up it keeps its own pace.
  if (!hunt.counting) huntScore.textContent = `${progress.points} points`;
  huntCard.querySelector(".hunt-name").textContent = target
    ? target.name
    : "Choose a target";
  const status = huntCard.querySelector(".hunt-status");
  if (!target) status.textContent = "Pick something to find from the logbook.";
  else if (progress.logged[target.id]) {
    status.textContent = `Logged${progress.logged[target.id].detail ? " in detail" : ""} for ${progress.logged[target.id].points} points. Choose your next target.`;
  } else
    status.textContent = hunt.judgement?.reason ?? "Working out where it is…";
  // Seen in detail, the target's photograph is the keepsake.
  const figure = huntCard.querySelector(".hunt-picture");
  const fresh = performance.now() < hunt.pictureUntil;
  const picture =
    fresh && target && progress.logged[target.id]?.detail
      ? pictures.find(({ id }) => id === target.id)
      : null;
  figure.hidden = !picture;
  if (picture) {
    const image = figure.querySelector("img");
    const source = assetUrl(`${config.assets.objects}${picture.id}.jpg`);
    if (image.getAttribute("src") !== source) image.src = source;
    image.alt = target.name;
    figure.querySelector("figcaption").textContent = picture.credit;
  }
  huntCard.dataset.visible = String(
    Boolean(target && !progress.logged[target.id] && hunt.judgement?.visible),
  );
};

watch(
  (s) => s.view,
  (_, state) => renderHunt(state),
);
// Anything that changes the sky changes the verdict; judge again at once.
subscribe((state, previous) => {
  if (
    [
      "time",
      "site",
      "instrument",
      "finder",
      "weather",
      "assists",
      "lightPollution",
    ].some((key) => state[key] !== previous[key])
  )
    hunt.judged = 0;
});

// --- Drawing constellations. Draw (C) turns clicks into a pen: each click picks
// the star that can be seen nearest it and draws a line from the last one; Enter
// lifts the pen, Backspace takes a line back. Save keeps the figure in the sky
// under a name. A figure that traces a real constellation is named for it, and in
// the field game tracing one from memory scores, once each.
const drawButton = root.querySelector(".draw-button");
const drawBar = root.querySelector(".draw-bar");
const drawSnap = root.querySelector(".draw-snap");
const drawName = drawBar.querySelector(".draw-name");
const draw = { active: false, segments: [], pen: null, hover: null, looked: 0 };

// Lines on the sky, kept in equatorial directions and turned with it.
const charts = new THREE.Group();
charts.matrixAutoUpdate = false;
world.add(charts);
const chartMaterial = (opacity) =>
  new THREE.LineBasicMaterial({
    color: config.drawing.color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
const savedMaterial = chartMaterial(config.drawing.savedOpacity);
const draftMaterial = chartMaterial(config.drawing.draftOpacity);
const chartLines = { saved: null, draft: null };
const setChartLines = (key, segments, material) => {
  if (chartLines[key]) {
    charts.remove(chartLines[key]);
    chartLines[key].geometry.dispose();
    chartLines[key] = null;
  }
  if (!segments.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      segments.flatMap(([a, b]) => [...a, ...b].map((v) => v * 390)),
      3,
    ),
  );
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  charts.add(lines);
  chartLines[key] = lines;
};
const turnCharts = (m) => {
  charts.matrix.set(
    m[0][0],
    m[0][1],
    m[0][2],
    0,
    m[1][0],
    m[1][1],
    m[1][2],
    0,
    m[2][0],
    m[2][1],
    m[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  charts.matrixWorldNeedsUpdate = true;
};
const renderCharts = () => {
  setChartLines(
    "saved",
    (progressStore.get().drawings ?? []).flatMap(({ segments }) => segments),
    savedMaterial,
  );
  setChartLines("draft", draw.segments, draftMaterial);
};

// The star nearest a point on the screen that this sky shows, from the naked-eye list.
const pickStar = (x, y) => {
  const layer = layers.naked;
  if (!layer || !currentSky) return null;
  const now = skyNow(getState());
  const view = new DataView(
    layer.bytes.buffer,
    layer.bytes.byteOffset,
    layer.bytes.byteLength,
  );
  let best = null;
  let nearest = config.drawing.snapPixels;
  for (let i = 0; i < layer.bytes.length / 8; i += 1) {
    const vector = [0, 2, 4].map((k) => view.getInt16(i * 8 + k, true) / 32767);
    const scene = sceneOf(vector);
    if (scene[1] <= 0) continue;
    const at = project(scene);
    if (!at.inFront) continue;
    const d = Math.hypot(at.x - x, at.y - y);
    if (d >= nearest) continue;
    const magnitude = view.getUint8(i * 8 + 6) / 16 - 1.5;
    if (!starSeen(vector, magnitude, now)) continue;
    nearest = d;
    best = {
      vector: vector.map((v) => Math.round(v * 1e5) / 1e5),
      x: at.x,
      y: at.y,
    };
  }
  return best;
};

const sameStar = (a, b) =>
  new THREE.Vector3(...a).angleTo(new THREE.Vector3(...b)) <
  config.drawing.matchDegrees * DEG;

// The real constellation a drawing traces, if any: most of the lines of it that
// this sky shows, and not many lines besides.
const identify = (segments) => {
  if (!guide.figures || !segments.length) return null;
  const now = skyNow(getState());
  const matches =
    (segment) =>
    ([a, b]) =>
      (sameStar(a, segment.from) && sameStar(b, segment.to)) ||
      (sameStar(a, segment.to) && sameStar(b, segment.from));
  let found = null;
  guide.figures.figures.forEach((figure) => {
    const shown = figure.segments.filter(
      (segment) =>
        starSeen(segment.from, segment.magnitudes[0], now) &&
        starSeen(segment.to, segment.magnitudes[1], now),
    );
    if (!shown.length) return;
    const traced = shown.filter((segment) =>
      segments.some(matches(segment)),
    ).length;
    const extra = segments.filter(
      (line) => !figure.segments.some((segment) => matches(segment)(line)),
    ).length;
    if (
      traced < Math.min(2, shown.length) ||
      traced / shown.length < config.drawing.share ||
      extra > segments.length * config.drawing.extra
    )
      return;
    if (!found || traced > found.traced) found = { id: figure.id, traced };
  });
  if (!found) return null;
  const name =
    guide.constellations.names.find(({ id }) => id === found.id)?.name ??
    found.id;
  return { ...found, name };
};

const renderDrawBar = () => {
  const state = getState();
  drawBar.hidden = !draw.active;
  root.dataset.drawing = String(draw.active);
  drawButton.setAttribute("aria-pressed", String(draw.active));
  setTool(drawButton, "Draw", draw.active ? "On" : "C");
  const count = draw.segments.length;
  drawBar.querySelector(".draw-count").textContent = count
    ? `${count} line${count === 1 ? "" : "s"}${draw.pen ? "" : " · pen lifted"}`
    : draw.pen
      ? "Now the next star"
      : `${touchFirst ? "Tap" : "Click"} a star to start`;
  drawBar.querySelector(".draw-undo").disabled = !count;
  drawBar.querySelector(".draw-lift").disabled = !draw.pen;
  drawBar.querySelector(".draw-save").disabled = !count;
  drawBar.querySelector(".draw-save").textContent =
    state.mode === "game" ? "Save and check" : "Save";
};

const setDrawing = (on) => {
  draw.active = on;
  if (!on) {
    draw.segments = [];
    draw.pen = null;
    drawSnap.dataset.show = "false";
  }
  renderCharts();
  renderDrawBar();
};

const drawAt = (x, y) => {
  const star = pickStar(x, y);
  if (!star) {
    hint("No star you can see there. Click right on one.");
    return;
  }
  // Clicking the star the pen is on lifts it.
  if (draw.pen && sameStar(draw.pen, star.vector)) draw.pen = null;
  else {
    if (draw.pen) draw.segments.push([draw.pen, star.vector]);
    draw.pen = star.vector;
  }
  renderCharts();
  renderDrawBar();
};

const undoLine = () => {
  const last = draw.segments.pop();
  if (last) draw.pen = last[0];
  renderCharts();
  renderDrawBar();
};

const liftPen = () => {
  draw.pen = null;
  renderDrawBar();
};

const saveDrawing = () => {
  if (!draw.segments.length) return;
  const state = getState();
  const progress = progressStore.get();
  const found = identify(draw.segments);
  const drawings = progress.drawings ?? [];
  const name =
    drawName.value.trim() || found?.name || `Figure ${drawings.length + 1}`;
  const traced = progress.traced ?? {};
  const scores = state.mode === "game" && found && !traced[found.id];
  const lines = Math.min(found?.traced ?? 0, config.drawing.maxLines);
  const points = scores
    ? Math.round(
        (config.drawing.base + config.drawing.perLine * lines) *
          assistShare(state.assists),
      )
    : 0;
  progressStore.set({
    ...progress,
    points: progress.points + points,
    traced: scores
      ? { ...traced, [found.id]: { points, at: Date.now() } }
      : traced,
    drawings: [
      ...drawings,
      {
        id: Date.now().toString(36),
        name,
        constellation: found?.id ?? null,
        segments: draw.segments,
      },
    ],
  });
  if (scores) hint(`Traced ${found.name} · +${points} points`);
  else if (found)
    hint(
      state.mode === "game"
        ? `${found.name}, traced before · saved`
        : `That's ${found.name} · saved`,
    );
  else if (state.mode === "game")
    hint(`Saved “${name}”. It doesn't trace a constellation, so no points.`);
  else hint(`Saved “${name}”`);
  draw.segments = [];
  draw.pen = null;
  drawName.value = "";
  renderCharts();
  renderDrawBar();
  renderHunt(state);
  checkAwards();
};

drawButton.addEventListener("click", () => setDrawing(!draw.active));
drawBar.querySelector(".draw-undo").addEventListener("click", undoLine);
drawBar.querySelector(".draw-lift").addEventListener("click", liftPen);
drawBar.querySelector(".draw-save").addEventListener("click", saveDrawing);
drawBar
  .querySelector(".draw-close")
  .addEventListener("click", () => setDrawing(false));
drawName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveDrawing();
  if (event.key === "Escape") drawName.blur();
});
window.addEventListener("keydown", (event) => {
  if (!forScene(event) || event.repeat) return;
  if (event.code === "KeyC") setDrawing(!draw.active);
  else if (!draw.active) return;
  else if (event.key === "Backspace") {
    event.preventDefault();
    undoLine();
  } else if (event.key === "Enter") liftPen();
  else if (event.key === "Escape") setDrawing(false);
});
watch(
  (s) => s.view,
  () => renderDrawBar(),
);
watch(
  (s) => s.mode,
  () => renderDrawBar(),
);

// While drawing, a ring marks the star a click would take.
const stepDraw = (now) => {
  if (!draw.active || now - draw.looked < 60) return;
  draw.looked = now;
  const locked = document.pointerLockElement === canvas;
  const star =
    locked || (pointer.over && !look.dragging)
      ? pickStar(
          locked ? window.innerWidth / 2 : pointer.x,
          locked ? window.innerHeight / 2 : pointer.y,
        )
      : null;
  drawSnap.dataset.show = String(Boolean(star));
  if (star)
    drawSnap.style.transform = `translate(${star.x}px, ${star.y}px) translate(-50%, -50%)`;
};

// --- Awards, earned by the logbook and the traced constellations.
const checkAwards = () => {
  const progress = progressStore.get();
  const have = new Set(progress.awards ?? []);
  const record = {
    logged: progress.logged,
    traced: progress.traced ?? {},
    points: progress.points,
  };
  const fresh = awards.filter(
    (award) => !have.has(award.id) && award.earned(record),
  );
  if (!fresh.length) return;
  progressStore.set({
    ...progress,
    awards: [...have, ...fresh.map(({ id }) => id)],
  });
  fresh.forEach((award, i) =>
    setTimeout(
      () => hint(`Award · ${award.name}`),
      (i + 1) * config.drawing.awardGap * 1000,
    ),
  );
};

const awardTemplate = document.getElementById("award-entry");
const chartTemplate = document.getElementById("chart-entry");
const renderKeepsakes = () => {
  const progress = progressStore.get();
  const have = new Set(progress.awards ?? []);
  menuPanel.querySelector(".award-list").replaceChildren(
    ...awards.map((award) => {
      const node = awardTemplate.content.cloneNode(true).firstElementChild;
      node.dataset.earned = String(have.has(award.id));
      node.querySelector(".award-name").textContent = award.name;
      node.querySelector(".award-about").textContent = award.about;
      node.title = award.about;
      return node;
    }),
  );
  const drawings = progress.drawings ?? [];
  menuPanel.querySelector(".charts-empty").hidden = drawings.length > 0;
  menuPanel.querySelector(".chart-list").replaceChildren(
    ...drawings.map((drawing) => {
      const node = chartTemplate.content.cloneNode(true).firstElementChild;
      node.querySelector(".chart-name").textContent = drawing.name;
      node.querySelector(".chart-lines").textContent =
        `${drawing.segments.length} line${drawing.segments.length === 1 ? "" : "s"}`;
      const remove = node.querySelector(".chart-remove");
      remove.setAttribute("aria-label", `Remove ${drawing.name}`);
      remove.addEventListener("click", () => {
        const current = progressStore.get();
        progressStore.set({
          ...current,
          drawings: (current.drawings ?? []).filter(
            ({ id }) => id !== drawing.id,
          ),
        });
        renderCharts();
        renderKeepsakes();
      });
      return node;
    }),
  );
};
menuPanel.addEventListener("toggle", (event) => {
  if (event.newState === "open") renderKeepsakes();
});

renderCharts();

// --- Pictures of famous objects. Each is a real photograph laid on the sky at its
// true size and angle, loaded only once an instrument (or the eye) is turned near
// it. How much of it shows follows what that sky and instrument would show: a
// faint grey smudge at the edge of seeing, more of its glow and a little color as
// it rises clear above the limit, and full detail for the planets. In the field
// game, logging a target through optics while its picture is in view counts it as
// seen in detail, for more points.
const pictureVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const pictureFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uGain;
  uniform float uFloor;
  uniform float uSaturation;
  uniform float uAppear;
  uniform float uExposure;
  uniform vec4 uMask;
  uniform float uMaskTurn;
  uniform float uMasked;
  // The night's seeing blurs fine detail at high power.
  uniform float uBlur;
  // Saturn: the globe's radii (in the picture) left round, and how far the rings
  // outside it are flattened to the night's tilt (0 for any other picture).
  uniform vec3 uRings;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    if (uRings.z > 0.0) {
      vec2 p = (vUv - 0.5) / uRings.xy;
      if (dot(p, p) > 1.0) uv.y = 0.5 + (vUv.y - 0.5) / uRings.z;
    }
    vec3 c = texture2D(uMap, uv, uBlur).rgb;
    // The sky's own glow and the eye's threshold swallow the faint outer parts.
    c = max(c - uFloor, 0.0) / (1.0 - uFloor);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    vec2 p = vUv - uMask.xy;
    float s = sin(uMaskTurn);
    float k = cos(uMaskTurn);
    p = vec2(k * p.x + s * p.y, -s * p.x + k * p.y) / uMask.zw;
    float keep = mix(1.0, 1.0 - smoothstep(0.55, 1.0, length(p)), uMasked);
    vec2 edge = min(vUv, 1.0 - vUv);
    keep *= smoothstep(0.0, 0.02, min(edge.x, edge.y));
    gl_FragColor = vec4(c * uGain * keep * uAppear * uExposure, 1.0);
    #include <colorspace_fragment>
  }
`;

const pictureLayer = new THREE.Group();
pictureLayer.matrixAutoUpdate = false;
world.add(pictureLayer);
const pictureLoader = new THREE.TextureLoader();
const pictureQuad = new THREE.PlaneGeometry(1, 1);
const pictureShown = new Map();
const PICTURE_DISTANCE = 380;

const picturesOf = pictures.map((picture) => {
  const target = targetById[picture.id];
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uGain: { value: 0 },
      uFloor: { value: 0.1 },
      uSaturation: { value: 0.2 },
      uAppear: { value: 0 },
      uExposure: exposure,
      uMask: {
        value: new THREE.Vector4(
          ...(picture.mask ?? [0.5, 0.5, 1, 1, 0]).slice(0, 4),
        ),
      },
      uMaskTurn: { value: ((picture.mask?.[4] ?? 0) * Math.PI) / 180 },
      uMasked: { value: picture.mask ? 1 : 0 },
      uBlur: { value: 0 },
      uRings: { value: new THREE.Vector3() },
    },
    vertexShader: pictureVertex,
    fragmentShader: pictureFragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(pictureQuad, material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  pictureLayer.add(mesh);
  return {
    ...picture,
    target,
    mesh,
    material,
    state: "idle",
    aspect: 1,
    equatorial: null,
    degrees: 0,
  };
});

// Lays a picture on the sky: centered on its equatorial direction, north up and
// east to the left as seen from the middle, `degrees` across.
const layPicture = (picture, equatorial, degrees) => {
  const d = new THREE.Vector3(...equatorial).normalize();
  const pole = new THREE.Vector3(0, 0, 1);
  const north = pole
    .clone()
    .sub(d.clone().multiplyScalar(pole.dot(d)))
    .normalize();
  const west = d.clone().cross(north).normalize();
  const basis = new THREE.Matrix4().makeBasis(west, north, d.clone().negate());
  const spin = new THREE.Matrix4().makeRotationZ(
    (picture.spin * Math.PI) / 180,
  );
  const width = 2 * PICTURE_DISTANCE * Math.tan((degrees * DEG) / 2);
  picture.mesh.matrix
    .copy(basis)
    .multiply(spin)
    .scale(new THREE.Vector3(width, width / picture.aspect, 1));
  picture.mesh.matrix.setPosition(d.multiplyScalar(PICTURE_DISTANCE));
  picture.mesh.matrixAutoUpdate = false;
};

const loadPicture = (picture) => {
  picture.state = "loading";
  pictureLoader.load(
    assetUrl(`${config.assets.objects}${picture.id}.jpg`),
    (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      picture.material.uniforms.uMap.value = map;
      picture.aspect = map.image.width / map.image.height;
      picture.state = "ready";
      picture.kept = performance.now();
      gsap.to(picture.material.uniforms.uAppear, {
        value: 1,
        duration: reducedMotion.matches ? 0 : 0.8,
        ease: "power1.out",
      });
      showPictures();
    },
    undefined,
    () => {
      picture.state = "failed";
    },
  );
};

// Where each picture belongs, how big it is, and how much of it this sky and
// instrument show; pictures load once the view comes near them.
// A loaded picture holds about 22 MB of graphics memory, so one that has been
// out of reach for a while is let go, and loaded again if the view comes back.
const freePicture = (picture) => {
  picture.material.uniforms.uMap.value?.dispose();
  picture.material.uniforms.uMap.value = null;
  picture.material.uniforms.uAppear.value = 0;
  picture.mesh.visible = false;
  picture.state = "idle";
  if (picture.body) pictureShown.delete(picture.body);
};
const freeAway = (picture, kept) => {
  const now = performance.now();
  if (kept) picture.kept = now;
  else if (
    picture.state === "ready" &&
    now - (picture.kept ?? 0) > config.pictures.freeSeconds * 1000
  )
    freePicture(picture);
};

const showPictures = () => {
  const state = getState();
  if (!currentSky) return;
  const now = skyNow(state);
  camera.getWorldDirection(viewAxis);
  const instrument = viewing(state);
  const optics = Boolean(instrument.field);
  let hidden = false;
  picturesOf.forEach((picture) => {
    const { target } = picture;
    let equatorial;
    let degrees;
    let magnitude;
    if (picture.body) {
      const planet = guide.planets?.find(({ body }) => body === picture.body);
      if (!planet) {
        freeAway(picture, false);
        return;
      }
      equatorial = planet.vector;
      const km = planet.lightMinutes * 60 * 299792.458;
      degrees = (2 * Math.atan(picture.radius / km)) / DEG / picture.fill;
      magnitude = planet.mag;
    } else {
      equatorial = equatorialVector(target);
      degrees = picture.width;
      magnitude = target.needs;
    }
    const scene = sceneOf(equatorial);
    const where = horizontalOf(scene);
    const air =
      1 /
      (Math.max(Math.sin(where.altitude * DEG), 0.01) +
        0.50572 * (Math.max(where.altitude, 0) + 6.07995) ** -1.6364);
    const reach = now.zenith.instrument - 0.3 * Math.max(air - 1, 0);
    // How far above the limit it stands: 0 at the edge of seeing, 1 well clear.
    const margin = clamp(
      (reach - (magnitude + now.extinction * air) + 0.5) /
        config.pictures.clear,
      0,
      1,
    );
    const clouds =
      1 - clamp(now.conditions.cloudCover / config.game.cloudCover, 0, 1);
    // How far (degrees) it is from where the view points; near once in the field.
    const off = viewAxis.angleTo(new THREE.Vector3(...scene)) / DEG;
    const near = off < camera.fov / 2 + degrees / 2 + 3;
    const up = where.altitude > horizonAltitude(where.azimuth);
    const wanted = up && margin > 0 && clouds > 0;
    freeAway(picture, wanted && off < config.pictures.keepDegrees + degrees);
    if (wanted && near && picture.state === "idle") loadPicture(picture);
    picture.mesh.visible = wanted && picture.state === "ready";
    if (!picture.mesh.visible) return;
    layPicture(picture, equatorial, degrees);
    const { uniforms } = picture.material;
    // Seeing (arcseconds) grows with the churn of the air. Its size on the screen
    // softens the picture: a level-of-detail bias on top of the one the screen
    // size already picks.
    const perDegree =
      (window.innerHeight * renderer.getPixelRatio()) / camera.fov;
    const seeing =
      (config.pictures.seeing * starUniforms.uTurbulence.value) / 3600;
    uniforms.uBlur.value = Math.log2(Math.max(1, seeing * perDegree));
    if (picture.body) {
      // Planets are bright: their disc shows whole; a telescope shows its color.
      uniforms.uGain.value = config.pictures.planetGain * clouds;
      uniforms.uFloor.value = 0.02;
      uniforms.uSaturation.value = optics ? 0.85 : 0.4;
      // Once its disc is big enough to see, it replaces the planet's point.
      const pixels =
        ((degrees * picture.fill) / camera.fov) * window.innerHeight;
      picture.pixels = pixels;
      if (pixels > config.pictures.discPixels) {
        pictureShown.set(picture.body, true);
        hidden = true;
      } else pictureShown.delete(picture.body);
      // Saturn's rings open and close over the years: the picture's rings are
      // flattened (or opened) from the photograph's tilt to the night's.
      if (picture.tilt) {
        const open =
          Math.sin(Math.abs(ringTilt(state.time)) * DEG) /
          Math.sin(picture.tilt * DEG);
        const ring = picture.fill / 2;
        uniforms.uRings.value.set(
          ring * picture.globe[0],
          ring * picture.globe[1] * picture.aspect,
          Math.max(open, config.pictures.ringsFloor),
        );
      }
    } else {
      uniforms.uGain.value =
        config.pictures.gain * (0.25 + 0.75 * margin) * clouds;
      uniforms.uFloor.value =
        config.pictures.floor[0] +
        (config.pictures.floor[1] - config.pictures.floor[0]) * (1 - margin);
      // Color only where the light is strong enough for the eye's cones.
      uniforms.uSaturation.value =
        config.pictures.saturation *
        smoothstep(0.5, 1, margin) *
        (optics ? 1 : 0.3);
    }
    picture.onScreen = near;
  });
  if (hidden !== showPictures.hidden) {
    showPictures.hidden = hidden;
    placePlanets(state.time);
  }
};

const turnPictures = (m) => {
  pictureLayer.matrix.set(
    m[0][0],
    m[0][1],
    m[0][2],
    0,
    m[1][0],
    m[1][1],
    m[1][2],
    0,
    m[2][0],
    m[2][1],
    m[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  pictureLayer.matrixWorldNeedsUpdate = true;
};

let picturesLooked = 0;
const stepPictures = (now) => {
  if (now - picturesLooked < config.pictures.lookEvery * 1000) return;
  picturesLooked = now;
  showPictures();
};

// A target's picture is in view through optics, large enough to see its form.
const seenInDetail = (target) => {
  const picture = picturesOf.find(({ id }) => id === target.id);
  if (!picture?.mesh.visible || !viewing(getState()).field) return false;
  return picture.onScreen;
};

// --- Resolution governor: the drawing buffer shrinks while frames run longer
// than the budget and grows back while they keep to it, so the frame rate holds
// on any GPU. A step up that fails sets a ceiling, which lifts again with time.
const governor = {
  scale: 1,
  frames: [],
  ceiling: 1,
  settled: 0,
  ceilingWindows: 0,
};

const govern = (dt) => {
  const {
    budget,
    window: size,
    step,
    floor,
    settleWindows,
    retryWindows,
  } = config.renderer.governor;
  // Only the view from the ground, with nothing loading: a land being rebuilt
  // fills the frames with its own work, which is not the GPU running behind.
  if (
    getState().view !== "ground" ||
    document.hidden ||
    walking.rebuilding ||
    loading.busy()
  ) {
    governor.frames = [];
    return;
  }
  governor.frames.push(dt * 1000);
  if (governor.frames.length < size) return;
  const sorted = governor.frames.sort((a, b) => a - b);
  governor.frames = [];
  // A single long stall is a hitch, not the GPU running behind.
  if (sorted[sorted.length - 1] > 50) return;
  const median = sorted[size >> 1];
  const high = sorted[Math.floor(size * 0.9)];
  const running = median > budget * 1.1;
  const easy = high < budget * 1.15;
  let next = governor.scale;
  if (running) {
    next = Math.max(floor, Math.round((governor.scale - step) * 100) / 100);
    // The scale that failed stays out of reach until the ceiling lifts again.
    governor.ceiling = next;
    governor.ceilingWindows = 0;
    governor.settled = 0;
  } else if (easy) {
    governor.settled += 1;
    governor.ceilingWindows += 1;
    // A ceiling that has held for a few minutes lifts a step, to be tried again.
    if (governor.ceilingWindows > retryWindows && governor.ceiling < 1) {
      governor.ceiling = Math.min(
        1,
        Math.round((governor.ceiling + step) * 100) / 100,
      );
      governor.ceilingWindows = 0;
    }
    if (
      governor.settled >= settleWindows &&
      governor.scale < governor.ceiling
    ) {
      next = Math.min(
        governor.ceiling,
        Math.round((governor.scale + step) * 100) / 100,
      );
      governor.settled = 0;
    }
  } else governor.settled = 0;
  if (next !== governor.scale) {
    governor.scale = next;
    resize();
  }
};

// --- Resize
const resize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // Large screens draw at a little under their full density to hold the frame
  // rate, and the governor takes the drawing buffer lower while the GPU runs behind.
  const ratio =
    Math.min(
      window.devicePixelRatio,
      config.renderer.maxPixelRatio,
      Math.max(1, Math.sqrt(config.renderer.maxPixels / (width * height))),
    ) * governor.scale;
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = viewFov(camera.aspect);
  camera.updateProjectionMatrix();
  starUniforms.uPixelRatio.value = ratio;
  lineUniforms.uResolution.value.set(width * ratio, height * ratio);
  lineUniforms.uWidth.value = config.guideStyle.lineWidth * ratio;
  if (placeDialog.open) globe?.resize();
  ground.resize(width, height, ratio);
};

window.addEventListener("resize", resize);

// --- Water reflects the sky: render it once more, mirrored in the horizontal plane
const mirror = new THREE.PerspectiveCamera();
const flip = new THREE.Matrix4().makeScale(1, -1, 1);

const reflectSky = () => {
  camera.updateMatrixWorld();
  mirror.projectionMatrix.copy(camera.projectionMatrix);
  mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  // Mirror the view direction only; the reflected sky is centred on the walker too.
  mirror.matrixWorld
    .multiplyMatrices(
      flip,
      new THREE.Matrix4().extractRotation(camera.matrixWorld),
    )
    .setPosition(camera.position);
  mirror.matrixWorldInverse.copy(mirror.matrixWorld).invert();
  mirror.matrixAutoUpdate = false;
  mirror.matrixWorldAutoUpdate = false;
  // Water mirrors the sky, not the guides drawn over it: markers for faint stars
  // and constellation lines stay out of the reflection.
  const guidesShown = [
    ...Object.values(layers).map(({ markers }) => markers),
    guide.figures?.lines,
    guide.figures?.glows,
    charts,
  ].filter((object) => object?.visible);
  guidesShown.forEach((object) => {
    object.visible = false;
  });
  renderer.setRenderTarget(ground.reflection);
  renderer.clear();
  renderer.render(world, mirror);
  renderer.setRenderTarget(null);
  guidesShown.forEach((object) => {
    object.visible = true;
  });
};

// --- Constellations: which figures can be recognized, and which one the pointer
// (or the crosshair, with the mouse captured) is over.
const pointer = { x: 0, y: 0, over: false };
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse") return;
  Object.assign(pointer, { x: event.clientX, y: event.clientY, over: true });
});
canvas.addEventListener("pointerleave", () => {
  pointer.over = false;
});

let judged = 0;
const followFigures = (now, dt) => {
  const state = getState();
  if (!guide.figures?.on) {
    easeFigures(dt);
    return;
  }
  if (now - judged > config.guideStyle.judgeEvery * 1000) {
    judged = now;
    judgeFigures(state);
  }
  const locked = document.pointerLockElement === canvas;
  const hovering =
    (locked || (pointer.over && !look.dragging)) && !state.selected;
  figureState.hovered = hovering
    ? figureAt(
        locked ? window.innerWidth / 2 : pointer.x,
        locked ? window.innerHeight / 2 : pointer.y,
      )
    : null;
  canvas.style.cursor =
    figureState.hovered !== null && !locked ? "pointer" : "";
  easeFigures(dt);
};

// --- Frame loop
let last = performance.now();
let behind = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  starUniforms.uTime.value = now / 1000;
  // While the place dialog is open, the globe is drawn every frame, and the game
  // behind it only now and then: it is still, under the dialog's veil.
  if (getState().view === "globe") {
    globe.frame();
    behind = (behind + 1) % config.globe.behindEvery;
    if (behind) return;
  }
  renderer.clear();
  govern(dt);
  stepLook(dt, now / 1000);
  stepWalk(dt);
  stepSetting(dt);
  settleRig();
  placeEquipment();
  settleEyes(dt);
  ground.follow(
    camera.position.x,
    camera.position.z,
    walking.walked.x,
    walking.walked.y,
  );
  aimLamp(dt);
  measureHorizon();
  followFigures(now, dt);
  stepHunt(dt, now);
  stepDraw(now);
  stepPictures(now);
  // The sky is infinitely far away: it travels with the walker.
  world.position.copy(camera.position);
  driftClouds(dt);
  placeCompass();
  placeHeading();
  placeGuides();
  placeFigureCard();
  ground.tick(now / 1000);
  renderer.setRenderTarget(skyMap);
  renderer.render(skyMapScene, flatCamera);
  if (model.uCloudCover.value >= 0.005) {
    renderer.setRenderTarget(cloudMap);
    renderer.render(cloudMapScene, flatCamera);
  }
  renderer.setRenderTarget(visibility);
  renderer.render(visibilityScene, flatCamera);
  renderer.setRenderTarget(null);
  if (ground.water) reflectSky();
  renderer.render(world, camera);
  renderer.clearDepth();
  ground.castShadows(renderer, camera.position, now / 1000);
  renderer.render(ground.scene, camera);
});

// --- Data that follows the site and time
let weatherRequest = 0;

const refreshWeather = (state) => {
  const request = ++weatherRequest;
  if (!getState().weather.at)
    setState({ weather: { ...getState().weather, status: "loading" } });
  fetchWeather(state.site, state.time)
    .then((result) => {
      if (request !== weatherRequest) return;
      const at = weatherAt(result, getState().time);
      setState({
        weather: { status: "ready", source: result.source, at, result },
      });
    })
    .catch((error) => {
      if (request !== weatherRequest) return;
      console.error(error);
      setState({
        weather: { status: "error", source: "none", at: null, result: null },
      });
    });
};

const refreshLightPollution = async (site) => {
  try {
    const grid = await loadLightPollution();
    lightGrid = grid;
    const zone = zoneAt(
      grid,
      config.lightPollutionGrid,
      site.latitude,
      site.longitude,
    );
    setState({
      lightPollution: {
        zone: lightPollutionZones[zone].zone,
        ratio: lightPollutionZones[zone].ratio,
        domes: horizonDomes(
          grid,
          config.lightPollutionGrid,
          lightPollutionZones,
          site,
        ),
      },
    });
  } catch (error) {
    console.error(error);
  }
};

// --- Globe: choosing where to stand
const veil = root.querySelector(".veil");
const placeDialog = root.querySelector(".place-dialog");
const placeFoot = placeDialog.querySelector(".place-foot");
// The place stood at, kept in the browser so a visit starts where the last one left off.
// It is kept once the player is at it, out of the dialog: a first visit that has not
// chosen yet opens the dialog again.
const placeStore = stored("stargazer:place", { site: null });
const keepPlace = () => {
  const { site, view } = getState();
  if (!site || view !== "ground") return;
  const { name, region, latitude, longitude, elevation, timeZone } = site;
  placeStore.set({
    site: { name, region, latitude, longitude, elevation, timeZone },
  });
};
watch((s) => s.site, keepPlace);

const earthMap = loadTexture(
  sharpMaps ? config.assets.earthNight : config.assets.earthNightPhone,
);
earthMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

const fade = (opacity, duration) =>
  new Promise((resolve) => {
    gsap.to(veil, {
      opacity,
      duration: reducedMotion.matches ? 0.05 : duration,
      ease: "power1.inOut",
      onComplete: resolve,
    });
  });

const showView = (view) => {
  root.dataset.view = view;
  setState({ view });
};

// The place dialog over the game: the globe is sized to it once it is open.
const openPlaceDialog = ({ first = false } = {}) => {
  placeFoot.hidden = !first;
  if (first)
    placeFoot.querySelector(".place-start").innerHTML =
      `Or start at <strong>${defaultSite.name}</strong>, ${defaultSite.region}: ${defaultSite.about}`;
  if (!placeDialog.open) {
    placeDialog.showModal();
    // Focus the dialog itself, not its first button, so nothing is singled out.
    placeDialog.focus();
  }
  showView("globe");
  globe.resize();
  search.reset();
};
const closePlaceDialog = () => {
  globe.hide();
  if (placeDialog.open) placeDialog.close();
  showView("ground");
  keepPlace();
};

// Without a time zone from the forecast service, fall back to the sun's.
const zoneByLongitude = (longitude) => {
  const hours = Math.round(longitude / 15);
  return `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`;
};

// The exposure the sky fades in to: the eye's, unless the address asks for a
// photograph's longer one.
let fullExposure = 1;
const fadeInSky = () => {
  exposure.value = 0;
  gsap.to(exposure, {
    value: fullExposure,
    duration: reducedMotion.matches ? 0.05 : config.ui.fadeInSeconds,
    ease: "power2.inOut",
  });
};

let globe = null;
let search = null;
let moving = false;

const enterGlobe = async () => {
  if (moving || placeDialog.open) return;
  document
    .querySelectorAll(":popover-open")
    .forEach((open) => open.hidePopover());
  if (document.pointerLockElement) document.exitPointerLock();
  openPlaceDialog();
  await globe.show(getState().site);
};

const leaveGlobe = () => {
  if (moving) return;
  closePlaceDialog();
};

const standAt = async (spot) => {
  if (moving) return;
  moving = true;
  const details = detailsOf(spot.latitude, spot.longitude).catch((error) => {
    console.error(error);
    return { timeZone: zoneByLongitude(spot.longitude), elevation: 0 };
  });
  const [{ timeZone, elevation }] = await Promise.all([
    details,
    globe.descend(spot),
  ]);
  await fade(1, 0.35);
  closePlaceDialog();
  const site = {
    name: spot.name || formatCoordinates(spot),
    region: spot.region ?? "",
    latitude: spot.latitude,
    longitude: spot.longitude,
    elevation,
    timeZone,
  };
  const { live, time } = getState();
  exposure.value = 0;
  // A new place reads its own ground and weather, whatever the address asked for before.
  setState({
    site,
    override: null,
    forcedGround: null,
    time: live ? Date.now() : tonight(site, time, config.time.afterDuskMinutes),
  });
  aimFirstView(orientSky(getState()));
  look.yawVelocity = 0;
  look.pitchVelocity = 0;
  fadeInSky();
  await fade(0, 0.4);
  moving = false;
};

const setUpGlobe = () => {
  const globeRenderer = new THREE.WebGLRenderer({
    canvas: placeDialog.querySelector(".globe-canvas"),
    antialias: true,
  });
  globeRenderer.setClearColor(config.globe.background, 1);
  globe = createGlobe({
    renderer: globeRenderer,
    root: placeDialog,
    earthMap,
    exposure,
    settings: config.globe,
    pins: darkSkyPlaces,
    skyAt,
    nameAt: nameOf,
    onSelect: standAt,
  });
  search = createSearch({
    root: placeDialog,
    darkSkyPlaces,
    count: config.globe.searchResults,
    delay: config.globe.searchDelay,
    search: searchPlaces,
    parse: parseCoordinates,
    describe: formatCoordinates,
    onPick: async (place) => {
      const spot = await globe.goTo(place);
      // Searching means "take me there": land after a moment over the place.
      setTimeout(() => standAt(spot), reducedMotion.matches ? 0 : 700);
    },
  });
  root
    .querySelectorAll(".place-button")
    .forEach((button) => button.addEventListener("click", enterGlobe));
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyM" && !event.repeat && forScene(event)) enterGlobe();
  });
  placeDialog
    .querySelector(".back-button")
    .addEventListener("click", leaveGlobe);
  placeDialog
    .querySelector(".stay-button")
    .addEventListener("click", leaveGlobe);
  // Esc closes the dialog as any dialog closes; the game picks up where it was.
  placeDialog.addEventListener("close", () => {
    if (getState().view === "globe" && !moving) closePlaceDialog();
  });
};

// --- State wiring
const startTime = (site) => {
  const now = Date.now();
  return sunAltitude(site, now) < -18
    ? { time: now, live: true }
    : { time: tonight(site, now, config.time.afterDuskMinutes), live: false };
};

const SKY_KEYS = [
  "site",
  "time",
  "weather",
  "override",
  "lightPollution",
  "instrument",
  "finder",
  "power",
  "catalog",
  "showFaint",
  "mode",
  "assists",
  "ground",
  "snow",
  "starSets",
  "declined",
  "guides",
  "selected",
];

subscribe((state, previous) => {
  if (!state.site || !SKY_KEYS.some((key) => state[key] !== previous[key]))
    return;
  const now = applySky(state);
  renderConditions(state, now);
  renderBanner(state, now);
  renderTools(state, now);
  renderTimePanel(state);
  renderInstrumentPanel(state);
  renderSkyPanel(state, now);
  if (soundOn) soundscape.mix(soundMix(state, now));
  applyGuides(state);
  renderCard(state, now);
});

watch(
  (s) => s.time,
  (time) => placePlanets(time),
);
// The banner belongs to the ground: shown again on arriving there.
watch(
  (s) => s.view,
  (view, state) => {
    if (state.site) renderBanner(state, skyNow(state));
  },
);

// Hourly weather is fetched per night; between hours it is interpolated.
watch(
  (s) => s.time,
  (time, state) => {
    const { result } = state.weather;
    if (
      result &&
      result.rows.length &&
      time >= result.rows[0].t &&
      time <= result.rows.at(-1).t
    ) {
      setState({ weather: { ...state.weather, at: weatherAt(result, time) } });
    } else refreshWeather(state);
  },
);
watch(
  (s) => s.site,
  (site, state) => {
    // A new place starts the walker back at its centre.
    walking.centre = site;
    walking.velocity.set(0, 0);
    walking.walked.set(0, 0);
    camera.position.set(0, config.terrain.eyeHeight, 0);
    // Equipment comes along, set up again where the walker lands.
    rig.at = null;
    rig.setting = null;
    paintNight(state);
    refreshLightPollution(site);
    refreshWeather(state);
    ground
      .setSite(site, state.forcedGround)
      .then((land) => {
        remeasureHorizon();
        if (land) setState({ ground: land.kind });
      })
      .catch((error) => console.error(error));
  },
);
watch(
  (s) => (s.site ? nightMidnight(s.site.timeZone, s.time) : 0),
  (_, state) => paintNight(state),
);
// Snow on the ground (and trees in leaf or bare) follows the date at the place:
// the evening's date, so a night keeps its snow past midnight.
const nightDate = (site, time) => isoDate(site.timeZone, time - 12 * 3600e3);
watch(
  (s) =>
    s.site
      ? `${s.site.latitude},${s.site.longitude},${nightDate(s.site, s.time)}`
      : "",
  (key, state) => {
    if (!key) return;
    ground
      .setSnow(state.site, nightDate(state.site, state.time))
      .then((snow) => {
        if (snow)
          setState({
            snow: ground.snowAt(camera.position.x, camera.position.z),
          });
      })
      .catch((error) => console.error(error));
  },
);

// --- Start
const status = root.querySelector(".status");

const loadNakedEyeStars = async () => {
  try {
    addStarLayer("naked", await loadStars("naked"));
    applySky(getState());
  } catch (error) {
    console.error(error);
    status.textContent = "The star catalog could not be loaded.";
  }
};

// A place named in the address, completed with its time zone, elevation and name.
const placeFrom = async (place) => {
  const [details, names] = await Promise.all([
    place.timeZone && place.elevation !== undefined
      ? { timeZone: place.timeZone, elevation: place.elevation }
      : detailsOf(place.latitude, place.longitude).catch(() => ({
          timeZone: zoneByLongitude(place.longitude),
          elevation: 0,
        })),
    place.name
      ? { name: place.name, region: place.region }
      : nameOf(place.latitude, place.longitude).catch(() => ({
          name: "",
          region: "",
        })),
  ]);
  return {
    ...place,
    timeZone: place.timeZone ?? details.timeZone,
    elevation: place.elevation ?? details.elevation,
    name: names.name || formatCoordinates(place),
    region: names.region,
  };
};

const timeFrom = (settings, site) => {
  if (settings.now) return { time: Date.now(), live: true };
  if (!settings.date && !settings.time) return startTime(site);
  const today = localFields(site.timeZone, Date.now());
  const day = settings.date ?? {
    year: today.year,
    month: today.month,
    day: today.day,
  };
  if (!settings.time)
    return {
      time: tonight(
        site,
        zonedInstant(site.timeZone, { ...day, hour: 18 }),
        config.time.afterDuskMinutes,
      ),
      live: false,
    };
  return {
    time: zonedInstant(site.timeZone, { ...day, ...settings.time }),
    live: false,
  };
};

// Roughly where the visitor is, without asking: their position only if they
// have already let the page see it, otherwise the city their clock is set to.
const visitorPlace = async () => {
  try {
    const permission = await navigator.permissions?.query({
      name: "geolocation",
    });
    if (permission?.state === "granted") {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 4000,
          maximumAge: 3600000,
        });
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    }
  } catch {
    // Fall through to the time zone.
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const city = zone.includes("/")
    ? zone.split("/").pop().replaceAll("_", " ")
    : "";
  const [found] = city ? await searchPlaces(city, 1).catch(() => []) : [];
  return (
    found ?? { latitude: 20, longitude: -new Date().getTimezoneOffset() / 4 }
  );
};

// The dialog on arrival: for a first visit, or when the address asks for the globe.
const openGlobe = async (settings, first) => {
  openPlaceDialog({ first });
  const center = settings.place ?? (await visitorPlace());
  await globe.open(center, settings.zoom ?? 0);
};

const start = async () => {
  const settings = readSettings(new URLSearchParams(window.location.search), {
    instruments,
    covers,
    groundAliases,
    guides,
  });
  fullExposure = settings.exposure ?? 1;
  setUpGlobe();
  resize();
  anchorPanels(root);
  trackIdle(root, config.ui.idleSeconds);
  showView("ground");
  // A first visit (no place in the address, none kept from before) starts at the
  // default place, with the dialog open to choose another.
  const kept = placeStore.get().site;
  const first = !settings.place && !kept;
  if (settings.view === "globe" || first) openGlobe(settings, first);
  setState({
    instrument: settings.instrument ?? "eye",
    mode: settings.mode ?? settingsStore.get().mode,
    catalog: "deep",
    assists: { ...settingsStore.get().assists },
    starSets: { full: { status: "unknown" }, deep: { status: "unknown" } },
    guides: settings.guides ?? {
      constellations: false,
      planets: false,
      details: false,
    },
    selected: null,
    declined: [],
    showFaint: settings.faint ?? false,
    override: settings.override,
    forcedGround: settings.ground,
    lightPollution: null,
    weather: { status: "loading", source: "none", at: null, result: null },
  });
  setLamp(lampSetting(settings.lamp));
  const site = settings.place
    ? await placeFrom(settings.place)
    : (kept ?? defaultSite);
  setState({ site, ...timeFrom(settings, site) });
  const m = orientSky(getState());
  if (settings.look) aimAt(settings.look.altitude, settings.look.azimuth);
  else aimFirstView(m);
  await loadNakedEyeStars();
  findStarSets();
  loadGuides();

  gsap.matchMedia().add(
    {
      motion: "(prefers-reduced-motion: no-preference)",
      reduce: "(prefers-reduced-motion: reduce)",
    },
    ({ conditions }) => {
      if (conditions.reduce) exposure.value = fullExposure;
      else
        gsap.to(exposure, {
          value: fullExposure,
          duration: config.ui.fadeInSeconds,
          ease: "power2.inOut",
        });
    },
  );
  root.dataset.ready = "true";
};

start();
