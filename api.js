/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

import { assets, weather, places, terrain } from "./config.js";
import { isoDate } from "./utils.js";

// Assets load from the workspace's folder on a local server and from CodePen's
// Asset Hosting everywhere else. A hosted name cannot hold a slash, so the
// path's folders join it with `--`, as tools/lib/hosting.mjs uploads it.
// `?assets=hosted` loads the hosted copies locally, to test them.
const local =
  /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(
    window.location.hostname,
  ) && new URLSearchParams(window.location.search).get("assets") !== "hosted";
const url = (path) =>
  local
    ? `${assets.base}${path}`
    : `${assets.hosted}${path.split("/").join("--")}?v=${assets.version}`;

export const assetUrl = url;

// --- Star lists, with progress for the large optional ones
export const loadStars = async (name, onProgress = () => {}) => {
  const response = await fetch(url(assets.stars[name]));
  if (!response.ok)
    throw new Error(`Star list "${name}" answered ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  const read = async (received) => {
    const { done, value } = await reader.read();
    if (done) return received;
    chunks.push(value);
    if (total) onProgress((received + value.length) / total);
    return read(received + value.length);
  };
  const size = await read(0);
  const bytes = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.length;
  }, 0);
  return bytes;
};

// Size in bytes of a star list, or null when it has not been fetched for this
// workspace. Asset Hosting answers HEAD with 404, so this starts the download
// and stops it once the headers have said how long it is.
export const starListSize = async (name) => {
  const stop = new AbortController();
  const response = await fetch(url(assets.stars[name]), {
    signal: stop.signal,
  });
  stop.abort();
  return response.ok
    ? Number(response.headers.get("content-length")) || null
    : null;
};

// --- Light pollution grid (zlib-compressed bytes, one per cell)
let lightPollution = null;

export const loadLightPollution = () => {
  lightPollution ??= fetch(url(assets.lightPollution)).then(
    async (response) => {
      if (!response.ok)
        throw new Error(`Light pollution map answered ${response.status}`);
      const stream = response.body.pipeThrough(
        new DecompressionStream("deflate"),
      );
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
  );
  return lightPollution;
};

// --- Weather: hourly cloud, humidity, wind and aerosol for the night around `ms`
const DAY = 86400000;
const cache = new Map();

const getJson = async (endpoint, params) => {
  const response = await fetch(`${endpoint}?${new URLSearchParams(params)}`);
  if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
  return response.json();
};

const sourceFor = (ms) => {
  const days = (ms - Date.now()) / DAY;
  if (days > weather.forecastFutureDays) return null;
  return days < -weather.forecastPastDays ? "archive" : "forecast";
};

const hourlyRows = ({ hourly }) =>
  hourly.time.map((t, i) => ({
    t: t * 1000,
    cloudCover: hourly.cloud_cover[i],
    cloudLayers: [
      hourly.cloud_cover_low?.[i],
      hourly.cloud_cover_mid?.[i],
      hourly.cloud_cover_high?.[i],
    ],
    humidity: hourly.relative_humidity_2m[i],
    windSpeed: hourly.wind_speed_10m[i],
    windDirection: hourly.wind_direction_10m[i],
    temperature: hourly.temperature_2m?.[i] ?? null,
    precipitation: hourly.precipitation?.[i] ?? null,
  }));

export const fetchWeather = (site, ms) => {
  const source = sourceFor(ms);
  if (!source) return Promise.resolve({ source: "none", rows: [] });
  const range = {
    latitude: site.latitude.toFixed(3),
    longitude: site.longitude.toFixed(3),
    start_date: isoDate(site.timeZone, ms - DAY / 2),
    end_date: isoDate(site.timeZone, ms + DAY / 2),
    timezone: site.timeZone,
    timeformat: "unixtime",
  };
  const key = JSON.stringify(range);
  if (!cache.has(key)) {
    const meteo = getJson(
      source === "archive" ? weather.archiveUrl : weather.forecastUrl,
      {
        ...range,
        hourly:
          "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,wind_speed_10m,wind_direction_10m,temperature_2m,precipitation",
      },
    );
    const aerosol = getJson(weather.airQualityUrl, {
      ...range,
      hourly: "aerosol_optical_depth",
    })
      .then(
        ({ hourly }) =>
          new Map(
            hourly.time.map((t, i) => [
              t * 1000,
              hourly.aerosol_optical_depth[i],
            ]),
          ),
      )
      .catch(() => new Map());
    const request = Promise.all([meteo, aerosol]).then(([data, depths]) => ({
      source,
      rows: hourlyRows(data)
        .filter((row) => row.cloudCover !== null)
        .map((row) => ({ ...row, aerosol: depths.get(row.t) ?? null })),
    }));
    request.catch(() => cache.delete(key));
    cache.set(key, request);
  }
  return cache.get(key);
};

// Conditions at `ms`, interpolated between the hours either side.
export const weatherAt = ({ rows }, ms) => {
  if (!rows.length) return null;
  const after = rows.findIndex((row) => row.t >= ms);
  const b = rows[after === -1 ? rows.length - 1 : after];
  const a = rows[Math.max(0, (after === -1 ? rows.length : after) - 1)];
  const f =
    b.t === a.t ? 0 : Math.min(1, Math.max(0, (ms - a.t) / (b.t - a.t)));
  const mix = (key) =>
    a[key] === null || b[key] === null
      ? (a[key] ?? b[key])
      : a[key] + (b[key] - a[key]) * f;
  const layers = a.cloudLayers.map((value, i) =>
    value === null ||
    value === undefined ||
    b.cloudLayers[i] === null ||
    b.cloudLayers[i] === undefined
      ? null
      : value + (b.cloudLayers[i] - value) * f,
  );
  return {
    cloudCover: mix("cloudCover"),
    cloudLayers: layers.some((value) => value === null) ? null : layers,
    humidity: mix("humidity"),
    windSpeed: mix("windSpeed"),
    windDirection: (f < 0.5 ? a : b).windDirection,
    temperature: mix("temperature"),
    precipitation: mix("precipitation"),
    aerosol: mix("aerosol") ?? weather.fallback.aerosol,
  };
};

// --- Places: search, names for a point, and a point's time zone and elevation
export const searchPlaces = async (query, count, signal) => {
  const params = new URLSearchParams({
    name: query,
    count: String(count),
    language: "en",
    format: "json",
  });
  const response = await fetch(`${places.searchUrl}?${params}`, { signal });
  if (!response.ok) throw new Error(`Place search answered ${response.status}`);
  const { results = [] } = await response.json();
  return results.map((place) => ({
    name: place.name,
    region: [place.admin1, place.country].filter(Boolean).join(", "),
    latitude: place.latitude,
    longitude: place.longitude,
  }));
};

export const nameOf = async (latitude, longitude) => {
  const params = new URLSearchParams({
    latitude,
    longitude,
    localityLanguage: "en",
  });
  const response = await fetch(`${places.reverseUrl}?${params}`, {
    signal: AbortSignal.timeout(places.lookupSeconds * 1000),
  });
  if (!response.ok)
    throw new Error(`Reverse geocoding answered ${response.status}`);
  const place = await response.json();
  // Names as people say them, without the asides of official lists:
  // "Svalbard (Arctic Region) (see also …)", "Tanzania, the United Republic of".
  const plain = (text) =>
    text
      ?.replace(/\s*\([^)]*\)/g, "")
      .replace(/,\s*the\b.*$/i, "")
      .trim();
  const name =
    plain(place.locality || place.city || place.principalSubdivision) || "";
  const region = [plain(place.principalSubdivision), plain(place.countryName)]
    .filter((part) => part && part !== name)
    .join(", ");
  return { name, region };
};

export const detailsOf = async (latitude, longitude) => {
  const params = new URLSearchParams({
    latitude,
    longitude,
    timezone: "auto",
    current: "is_day",
  });
  // A slow answer must never hold up landing: past the limit, the caller falls back.
  const response = await fetch(`${places.detailsUrl}?${params}`, {
    signal: AbortSignal.timeout(places.lookupSeconds * 1000),
  });
  if (!response.ok) throw new Error(`Site details answered ${response.status}`);
  const { timezone, elevation } = await response.json();
  return { timeZone: timezone, elevation: Math.max(0, elevation ?? 0) };
};

// --- Map tiles read pixel by pixel (land cover, the sea, inland water); null where
// a tile is missing or will not load
const pixelTiles = new Map();

export const loadPixels = (url) => {
  if (!pixelTiles.has(url)) {
    pixelTiles.set(
      url,
      new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          resolve({
            data: context.getImageData(0, 0, image.width, image.height).data,
            width: image.width,
            height: image.height,
          });
        };
        image.onerror = () => resolve(null);
        image.src = url;
      }),
    );
  }
  return pixelTiles.get(url);
};

// --- Map tiles as bytes (OpenStreetMap vector tiles); null where one will not load
const byteTiles = new Map();

export const loadBytes = (url) => {
  if (!byteTiles.has(url)) {
    byteTiles.set(
      url,
      fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .then((buffer) => (buffer ? new Uint8Array(buffer) : null))
        .catch(() => null),
    );
  }
  return byteTiles.get(url);
};

// --- Terrain: Terrarium tiles decoded to metres (null where a tile is missing)
const elevationTiles = new Map();

export const loadElevationTile = (z, x, y) => {
  const key = `${z}/${x}/${y}`;
  if (!elevationTiles.has(key)) {
    const src = terrain.tileUrl
      .replace("{z}", z)
      .replace("{x}", x)
      .replace("{y}", y);
    const request = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, 256, 256);
        resolve(
          Float32Array.from(
            { length: 65536 },
            (_, i) =>
              data[i * 4] * 256 +
              data[i * 4 + 1] +
              data[i * 4 + 2] / 256 -
              32768,
          ),
        );
      };
      image.onerror = () => resolve(null);
      image.src = src;
    });
    elevationTiles.set(key, request);
  }
  return elevationTiles.get(key);
};

// --- Rainfall over the last full year (mm), from the weather archive

// --- Sky guide data (fetched by tools/fetch-stars.mjs, null if absent)
const loadJson = async (path) => {
  const response = await fetch(url(path));
  return response.ok ? response.json() : null;
};

export const loadStarNames = () => loadJson(assets.starNames);
export const loadConstellations = () => loadJson(assets.constellations);
