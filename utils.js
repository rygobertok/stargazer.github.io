/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

import * as Astronomy from "astronomy-engine";

const DEG = Math.PI / 180;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// --- Time zones
const zoneParts = (timeZone, ms) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(ms))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );

// Minutes the zone is ahead of UTC at that instant.
export const zoneOffset = (timeZone, ms) => {
  const p = zoneParts(timeZone, ms);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
};

// Wall-clock fields at the site for an instant.
export const localFields = (timeZone, ms) => zoneParts(timeZone, ms);

// The instant when the site's wall clock reads the given fields.
export const zonedInstant = (
  timeZone,
  { year, month, day, hour = 0, minute = 0 },
) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffset(timeZone, guess) * 60000;
  return guess - zoneOffset(timeZone, first) * 60000;
};

// Local midnight that ends the evening of the given instant.
export const nightMidnight = (timeZone, ms) => {
  const p = localFields(timeZone, ms - 12 * 3600000);
  const evening = zonedInstant(timeZone, {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: 12,
  });
  return zonedInstant(timeZone, localFields(timeZone, evening + 12 * 3600000));
};

export const formatSiteTime = (timeZone, ms) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));

export const formatClock = (timeZone, ms) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));

export const isoDate = (timeZone, ms) => {
  const p = localFields(timeZone, ms);
  return [p.year, p.month, p.day]
    .map((n, i) => String(n).padStart(i ? 2 : 4, "0"))
    .join("-");
};

// --- Observer
export const observerFor = (site) =>
  new Astronomy.Observer(site.latitude, site.longitude, site.elevation);

export const sunAltitude = (site, ms) => sunState(site, ms).altitude;

// First full dark of the night that `ms` belongs to, after moonset when the
// Moon sets before dawn. Shifting back six hours keeps the small hours with
// the evening before and the morning with tonight.
export const tonight = (site, ms, afterDuskMinutes) => {
  const p = localFields(site.timeZone, ms - 6 * 3600000);
  const noon = zonedInstant(site.timeZone, {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: 12,
  });
  const observer = observerFor(site);
  const { Body, SearchAltitude, SearchHourAngle, SearchRiseSet } = Astronomy;
  const dusk = SearchAltitude(Body.Sun, observer, -1, new Date(noon), 1, -18);
  if (!dusk)
    return SearchHourAngle(
      Body.Sun,
      observer,
      12,
      new Date(noon),
    ).time.date.getTime();
  const dark = dusk.date.getTime() + afterDuskMinutes * 60000;
  const dawn = SearchAltitude(Body.Sun, observer, 1, dusk, 1, -18);
  const moonUp = bodyPosition(Body.Moon, site, dark).altitude > 0;
  const moonset = moonUp
    ? SearchRiseSet(Body.Moon, observer, -1, new Date(dark), 1)
    : null;
  const lateEnough =
    moonset && dawn && moonset.date.getTime() + 3600000 < dawn.date.getTime();
  return lateEnough ? moonset.date.getTime() + 20 * 60000 : dark;
};

// --- Sky orientation
// Rotation from J2000 equatorial vectors to the scene: x east, y up, z south.
// astronomy-engine's horizontal frame is x north, y west, z zenith.
export const skyMatrix = (site, ms) => {
  const { rot } = Astronomy.Rotation_EQJ_HOR(
    Astronomy.MakeTime(new Date(ms)),
    observerFor(site),
  );
  return [
    [-rot[0][1], -rot[1][1], -rot[2][1]],
    [rot[0][2], rot[1][2], rot[2][2]],
    [-rot[0][0], -rot[1][0], -rot[2][0]],
  ];
};

export const equatorialVector = ({ ra, dec }) => [
  Math.cos(dec * DEG) * Math.cos(ra * 15 * DEG),
  Math.cos(dec * DEG) * Math.sin(ra * 15 * DEG),
  Math.sin(dec * DEG),
];

export const applyMatrix = (m, v) =>
  m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

// Altitude and azimuth (degrees, azimuth from north through east) of a scene direction.
export const horizontalOf = ([x, y, z]) => ({
  altitude: Math.asin(clamp(y, -1, 1)) / DEG,
  azimuth: (Math.atan2(x, -z) / DEG + 360) % 360,
});

export const sceneDirection = (altitude, azimuth) => [
  Math.cos(altitude * DEG) * Math.sin(azimuth * DEG),
  Math.sin(altitude * DEG),
  -Math.cos(altitude * DEG) * Math.cos(azimuth * DEG),
];

// --- Star lists
export const decodeMagnitude = (code) => code / 16 - 1.5;

// Number of stars at or brighter than `limit` in a brightest-first list.
export const countBrighterThan = (bytes, limit) => {
  const count = bytes.length / 8;
  const search = (lo, hi) => {
    if (lo >= hi) return lo;
    const mid = (lo + hi) >> 1;
    return decodeMagnitude(bytes[mid * 8 + 6]) <= limit
      ? search(mid + 1, hi)
      : search(lo, mid);
  };
  return search(0, count);
};

// --- Light pollution
export const zoneAt = (
  grid,
  { width, height, cellsPerDegree, north },
  latitude,
  longitude,
) => {
  const row = Math.floor((north - latitude) * cellsPerDegree);
  if (row < 0 || row >= height) return 0;
  const col =
    ((Math.floor((longitude + 180) * cellsPerDegree) % width) + width) % width;
  return grid[row * width + col];
};

// Point `km` away along a bearing (degrees) on a spherical Earth.
const destination = (latitude, longitude, bearing, km) => {
  const d = km / 6371;
  const p1 = latitude * DEG;
  const b = bearing * DEG;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    longitude * DEG +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [p2 / DEG, ((l2 / DEG + 540) % 360) - 180];
};

// Glow on the horizon in each azimuth sector, from lit areas out to a few
// hundred kilometres, in units of the natural sky brightness.
export const horizonDomes = (grid, gridConfig, zones, site) => {
  const { domeDistances, domeSectors, domeStrength } = gridConfig;
  const width = 360 / domeSectors;
  return Array.from(
    { length: domeSectors },
    (_, sector) =>
      [-1 / 3, 0, 1 / 3].reduce(
        (sum, offset) =>
          sum +
          domeDistances.reduce((ring, km) => {
            const [lat, lon] = destination(
              site.latitude,
              site.longitude,
              (sector + 0.5 + offset) * width,
              km,
            );
            return (
              ring + zones[zoneAt(grid, gridConfig, lat, lon)].ratio * (10 / km)
            );
          }, 0),
        0,
      ) *
      (domeStrength / 3),
  );
};

// --- Visibility model (Schaefer 1990, Krisciunas & Schaefer 1991)
export const nanoLamberts = (mag) => 34.08 * Math.exp(20.7233 - 0.92104 * mag);
export const surfaceMagnitude = (nl) =>
  (20.7233 - Math.log(nl / 34.08)) / 0.92104;

// Faintest point source the dark-adapted eye sees against sky brightness `nl`.
export const eyeLimit = (nl) => {
  const night = nl < 1479;
  const c1 = night ? 10 ** -9.8 : 10 ** -8.35;
  const c2 = night ? 10 ** -1.9 : 10 ** -5.9;
  return -16.57 - 2.5 * Math.log10(c1 * (1 + Math.sqrt(c2 * nl)) ** 2);
};

// How an instrument changes the sky the eye sees and the light a star delivers.
export const opticsOf = ({
  aperture,
  magnification,
  transmission,
  practicalLoss,
}) => {
  const exitPupil = Math.min(aperture / magnification, 7);
  const usable = Math.min(aperture, magnification * 7);
  return {
    skyFactor: transmission * (exitPupil / 7) ** 2,
    gain: 2.5 * Math.log10(transmission * (usable / 7) ** 2) - practicalLoss,
  };
};

export const extinctionOf = (model, elevation, { aerosol, humidity }) =>
  model.rayleigh * Math.exp(-elevation / 8000) +
  model.ozone +
  model.aerosolPerDepth * aerosol +
  model.humidityExtinction * (humidity / 100) ** 2;

// Zenith sky brightness from twilight, as a surface magnitude, by solar altitude.
export const twilightMagnitude = (sunAlt) =>
  sunAlt <= 0 ? 6.5 - 0.95 * sunAlt : 6.5 - 0.25 * Math.min(sunAlt, 10);

const airMassAt = (altitude) =>
  1 /
  (Math.max(Math.sin(altitude * DEG), 0) +
    0.50572 * (Math.max(altitude, 0) + 6.07995) ** -1.6364);

// Moonlight scattered into a view direction `separation` degrees from the Moon.
export const moonlight = ({
  phaseAngle,
  moonAltitude,
  viewAltitude,
  separation,
  extinction,
}) => {
  if (moonAltitude <= 0) return 0;
  const illuminance =
    10 ** (-0.4 * (3.84 + 0.026 * phaseAngle + 4e-9 * phaseAngle ** 4));
  const scattering =
    10 ** 5.36 * (1.06 + Math.cos(separation * DEG) ** 2) +
    10 ** (6.15 - separation / 40);
  const xMoon = (1 - 0.96 * Math.sin((90 - moonAltitude) * DEG) ** 2) ** -0.5;
  const xView = (1 - 0.96 * Math.sin((90 - viewAltitude) * DEG) ** 2) ** -0.5;
  return (
    scattering *
    illuminance *
    10 ** (-0.4 * extinction * xMoon) *
    (1 - 10 ** (-0.4 * extinction * xView))
  );
};

// Sky brightness and limits at the zenith, for the readout and the draw range.
export const zenithSky = ({
  natural,
  ratio,
  extinction,
  sun,
  moon,
  optics,
}) => {
  const sources = {
    natural: nanoLamberts(natural),
    artificial: nanoLamberts(natural) * ratio,
    moon: moonlight({
      phaseAngle: moon.phaseAngle,
      moonAltitude: moon.altitude,
      viewAltitude: 90,
      separation: 90 - moon.altitude,
      extinction,
    }),
    twilight:
      sun.altitude > -20 ? nanoLamberts(twilightMagnitude(sun.altitude)) : 0,
  };
  const total = Object.values(sources).reduce((a, b) => a + b, 0);
  const eye = eyeLimit(total) - extinction * (airMassAt(90) - 1);
  return {
    sources,
    brightness: surfaceMagnitude(total),
    eye,
    instrument: eyeLimit(total * optics.skyFactor) + optics.gain,
  };
};

// --- Sun and Moon
export const bodyPosition = (body, site, ms) => {
  const observer = observerFor(site);
  const time = Astronomy.MakeTime(new Date(ms));
  const { ra, dec } = Astronomy.Equator(body, time, observer, true, true);
  const { altitude, azimuth } = Astronomy.Horizon(time, observer, ra, dec);
  return { altitude, azimuth, direction: sceneDirection(altitude, azimuth) };
};

export const moonState = (site, ms) => {
  const time = Astronomy.MakeTime(new Date(ms));
  const { phase_angle: phaseAngle, phase_fraction: fraction } =
    Astronomy.Illumination(Astronomy.Body.Moon, time);
  return {
    ...bodyPosition(Astronomy.Body.Moon, site, ms),
    phaseAngle,
    fraction,
    elongation: Astronomy.MoonPhase(time),
  };
};

export const sunState = (site, ms) =>
  bodyPosition(Astronomy.Body.Sun, site, ms);

// The tide's height above mean sea level (metres): the equilibrium tide, the
// Moon's semidiurnal part and the Sun's smaller one, each highest `lag` hours
// after that body crosses the meridian, so springs come with new and full Moon.
export const tideHeight = (site, ms, { range, lag }) => {
  const time = Astronomy.MakeTime(new Date(ms));
  const observer = observerFor(site);
  const angle = (body) =>
    ((Astronomy.HourAngle(body, time, observer) - lag) * 15 * Math.PI) / 180;
  return (
    (range / 2) *
    (0.69 * Math.cos(2 * angle(Astronomy.Body.Moon)) +
      0.31 * Math.cos(2 * angle(Astronomy.Body.Sun)))
  );
};

// --- Coordinates typed into search: "-24.63, -70.40" or "24.63 S 70.40 W"
export const parseCoordinates = (text) => {
  const match = text
    .trim()
    .match(
      /^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i,
    );
  if (!match) return null;
  const [, lat, ns, lon, ew] = match;
  const latitude = Number(lat) * (/s/i.test(ns ?? "") ? -1 : 1);
  const longitude = Number(lon) * (/w/i.test(ew ?? "") ? -1 : 1);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
};

export const formatCoordinates = ({ latitude, longitude }) =>
  `${Math.abs(latitude).toFixed(2)}° ${latitude < 0 ? "S" : "N"}, ${Math.abs(longitude).toFixed(2)}° ${longitude < 0 ? "W" : "E"}`;

// --- Globe geometry: a point on a unit sphere, in the same frame as three's SphereGeometry
export const globePoint = (latitude, longitude, radius = 1) => [
  radius * Math.cos(latitude * DEG) * Math.cos(longitude * DEG),
  radius * Math.sin(latitude * DEG),
  -radius * Math.cos(latitude * DEG) * Math.sin(longitude * DEG),
];

export const globeCoordinates = ([x, y, z]) => {
  const r = Math.hypot(x, y, z);
  return {
    latitude: Math.asin(y / r) / DEG,
    longitude: Math.atan2(-z, x) / DEG,
  };
};

// Web Mercator tile maths (slippy map tiles).
export const tileOf = (latitude, longitude, zoom) => {
  const n = 2 ** zoom;
  const lat = clamp(latitude, -85.0511, 85.0511) * DEG;
  return {
    x: ((longitude + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  };
};

export const tileLatitude = (y, zoom) =>
  Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) / DEG;

// --- Grounds: a rough read of the region is enough to pick one
// A repeatable random sequence (mulberry32), so a place always looks the same.
export const seededRandom = (seed) => {
  let a = Math.floor(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// --- Planets: direction (J2000 equatorial unit vector), brightness and distance
export const planetStates = (bodies, ms) => {
  const time = Astronomy.MakeTime(new Date(ms));
  return bodies.map(({ body, bv }) => {
    const v = Astronomy.GeoVector(Astronomy.Body[body], time, true);
    const length = Math.hypot(v.x, v.y, v.z);
    return {
      body,
      bv,
      vector: [v.x / length, v.y / length, v.z / length],
      mag: Astronomy.Illumination(Astronomy.Body[body], time).mag,
      lightMinutes: (length * 149597870.7) / 299792.458 / 60,
    };
  });
};

// How far open Saturn's rings are as seen from Earth: the Saturnicentric latitude
// of the Earth (degrees, signed by the face shown), 0 when they are edge-on.
export const ringTilt = (ms) => {
  const time = Astronomy.MakeTime(new Date(ms));
  const { north } = Astronomy.RotationAxis(Astronomy.Body.Saturn, time);
  const toSaturn = Astronomy.GeoVector(Astronomy.Body.Saturn, time, true);
  const length = Math.hypot(toSaturn.x, toSaturn.y, toSaturn.z);
  return (
    Math.asin(
      clamp(
        -(north.x * toSaturn.x + north.y * toSaturn.y + north.z * toSaturn.z) /
          length,
        -1,
        1,
      ),
    ) / DEG
  );
};

export const compassPoint = (azimuth) =>
  [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ][Math.round(azimuth / 45) % 8];

// --- Settings from the page address, e.g.
//   ?lat=-24.63&lon=-70.40&date=2026-11-20&time=23:30&instrument=binoculars&guides=constellations,planets
// Anything missing or invalid is left to the pen's defaults.
export const readSettings = (
  params,
  { instruments, covers, groundAliases, guides },
) => {
  const number = (key, min, max) => {
    const value = Number(params.get(key));
    return params.has(key) &&
      params.get(key) !== "" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
      ? value
      : undefined;
  };
  const latitude = number("lat", -90, 90);
  const longitude = number("lon", -180, 180);
  const date = params.get("date")?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = params.get("time")?.match(/^(\d{1,2}):(\d{2})$/);
  const list = (params.get("guides") ?? "").split(",").map((key) => key.trim());
  const override = Object.fromEntries(
    [
      ["clouds", "cloudCover", 0, 100],
      ["humidity", "humidity", 0, 100],
      ["haze", "aerosol", 0, 1],
      ["brightness", "brightness", 16, 22],
    ]
      .map(([key, field, min, max]) => [field, number(key, min, max)])
      .filter(([, value]) => value !== undefined),
  );
  return {
    place:
      latitude !== undefined && longitude !== undefined
        ? {
            latitude,
            longitude,
            name: params.get("name") ?? "",
            region: params.get("region") ?? "",
            timeZone: params.get("tz") ?? null,
            elevation: number("elevation", -500, 9000),
          }
        : null,
    date: date
      ? { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) }
      : null,
    time: time ? { hour: Number(time[1]), minute: Number(time[2]) } : null,
    now: params.get("time") === "now",
    instrument: instruments.some(({ id }) => id === params.get("instrument"))
      ? params.get("instrument")
      : undefined,
    mode: ["explore", "game"].includes(params.get("mode"))
      ? params.get("mode")
      : undefined,
    guides: params.has("guides")
      ? Object.fromEntries(guides.map(({ key }) => [key, list.includes(key)]))
      : undefined,
    faint: params.has("faint")
      ? ["1", "true", "on", ""].includes(params.get("faint"))
      : undefined,
    // A headlamp setting by name, or simply on.
    lamp: params.has("lamp") ? params.get("lamp") : null,
    override: Object.keys(override).length ? override : null,
    // A kind of land by name, or an older name for one.
    ground:
      [params.get("ground"), groundAliases[params.get("ground")]].find(
        (id) => covers[id],
      ) ?? null,
    // `view=globe` opens the place dialog over the game.
    view: ["globe", "ground"].includes(params.get("view"))
      ? params.get("view")
      : null,
    zoom: number("zoom", 0, 5),
    // How long the eye's exposure runs: 1 is the sky as the eye sees it; more is
    // a photograph's longer exposure, for a picture of the pen.
    exposure: number("exposure", 0.25, 6),
    look:
      number("az", 0, 360) !== undefined || number("alt", -20, 90) !== undefined
        ? {
            azimuth: number("az", 0, 360) ?? 180,
            altitude: number("alt", -20, 90) ?? 25,
          }
        : null,
  };
};

// Next time a planet rises at the site, or null when it does not within a day.
export const nextRise = (body, site, ms) =>
  Astronomy.SearchRiseSet(
    Astronomy.Body[body],
    observerFor(site),
    1,
    new Date(ms),
    1,
  )?.date.getTime() ?? null;

// The place `x` metres east and `z` metres south of a site.
export const placeAt = (site, x, z) => ({
  ...site,
  latitude: site.latitude - z / 111320,
  longitude: site.longitude + x / (111320 * Math.cos(site.latitude * DEG)),
});
