/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// Snow on the ground around a site on a given date, from NASA's MODIS snow maps
// (served by GIBS): the day's own map, looking back a few days past clouds; the
// 8-day map where clouds still hide the ground; and for dates no map covers (the
// future, or before MODIS) the average for that month of a recent year. Read into
// two grids of snow cover (0 to 1): a fine one close by and a coarse one to the
// far horizon. Distances are metres in the ground's frame (x east, z south).
import { clamp } from "./utils.js";
import { geoField, placeOf } from "./land.js";

// --- PNG with a palette, as GIBS serves its classified maps: each pixel's palette
// entry. The browser's own decoder would lose the colors of clear pixels, and
// clear is how these maps mark both "no snow" and "cloud".
const PNG_SIGNATURE = 8;
const inflate = async (bytes) => {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
const readPalettePng = async (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = PNG_SIGNATURE;
  let width = 0;
  let height = 0;
  let depth = 8;
  let palette = null;
  const parts = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = body[8];
      if (body[9] !== 3) return null;
    } else if (type === "PLTE") palette = body;
    else if (type === "IDAT") parts.push(body);
    at += 12 + length;
  }
  if (!palette || !parts.length) return null;
  const packed = await inflate(
    new Uint8Array(await new Blob(parts).arrayBuffer()),
  );
  // Undo each row's filter (one byte a pixel step, as palette images use).
  const stride = Math.ceil((width * depth) / 8);
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = packed[y * (stride + 1)];
    const source = packed.subarray(
      y * (stride + 1) + 1,
      (y + 1) * (stride + 1),
    );
    const row = rows.subarray(y * stride, (y + 1) * stride);
    const above = y ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x ? row[x - 1] : 0;
      const b = above ? above[x] : 0;
      const c = x && above ? above[x - 1] : 0;
      let value = source[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = value;
    }
  }
  // Palette entries, unpacked when several share a byte.
  const entries = new Uint8Array(width * height);
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const byte = rows[y * stride + Math.floor(x / perByte)];
      entries[y * width + x] =
        (byte >> ((perByte - 1 - (x % perByte)) * depth)) & mask;
    }
  }
  return { width, height, entries, palette };
};

// A map's color map: the value each color stands for.
const colormaps = new Map();
const colormap = (url) => {
  if (!colormaps.has(url)) {
    colormaps.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.text() : ""))
        .then((xml) => {
          const values = new Map();
          for (const [, r, g, b, value] of xml.matchAll(
            /rgb="(\d+),(\d+),(\d+)"[^>]*?sourceValue="\[?(\d+)/g,
          )) {
            values.set(
              (Number(r) << 16) | (Number(g) << 8) | Number(b),
              Number(value),
            );
          }
          return values;
        })
        .catch(() => new Map()),
    );
  }
  return colormaps.get(url);
};

// Snow cover (0 to 1) each kind of map's values stand for, or NaN where it cannot
// see the ground (cloud, night, no data).
const covers = {
  // NDSI snow cover (0 to 100) to the share of ground under snow (Salomonson and Appel 2004).
  daily: (v) =>
    v <= 100
      ? clamp(-0.01 + 1.45 * (v / 100), 0, 1)
      : v === 237 || v === 239
        ? 0
        : NaN,
  // Snow (200), no snow (25), lake (37) or ocean (39); lake ice (100) is not ground.
  eightDay: (v) =>
    v === 200 ? 1 : v === 25 || v === 37 || v === 39 || v === 100 ? 0 : NaN,
  // The month's average share of days under snow (0 to 100).
  monthly: (v) => (v <= 100 ? v / 100 : NaN),
};

const dayOf = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// The newest day with a daily map on or before `date`, within `recent` days of it.
const latestDaily = async (date, settings) => {
  const { domains, daily, recent } = settings;
  const url = domains
    .replace("{layer}", daily.layer)
    .replace("{set}", daily.set)
    .replace("{from}", dayOf(date, -recent))
    .replace("{to}", date);
  const xml = await fetch(url)
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  let latest = null;
  for (const [, from, to] of xml.matchAll(
    /(\d{4}-\d{2}-\d{2})(?:\/(\d{4}-\d{2}-\d{2}))?/g,
  )) {
    const end = to ?? from;
    if (end <= date && (!latest || end > latest)) latest = end;
  }
  return latest;
};

// A square grid around the site, centre-sampled, its cells NaN until known.
const makeGrid = (radius, cell) => {
  const half = Math.ceil(radius / cell);
  const n = 2 * half + 1;
  return {
    n,
    half,
    cell,
    radius: (half + 0.5) * cell,
    values: new Float32Array(n * n).fill(NaN),
  };
};

export const readSnow = async ({
  site,
  date,
  settings,
  outerRadius,
  gibs,
  bytes,
  progress,
}) => {
  const near = makeGrid(settings.nearRadius, settings.nearCell);
  const far = makeGrid(outerRadius, settings.farCell);
  // A grid still wants maps while more than a few of its cells are unseen (some,
  // past a map's edge or marked as fill, never will be).
  const unknown = (grid) =>
    grid.values.reduce((sum, v) => sum + Number.isNaN(v), 0) >
    grid.values.length * 0.03;
  const urlOf = (layer, time) => (level, row, col) =>
    gibs
      .replace("{layer}", layer.layer)
      .replace("{time}", `${time}/`)
      .replace("{set}", layer.set)
      .replace("{level}", level)
      .replace("{row}", row)
      .replace("{col}", col);
  // One map on one day into the cells it can still tell; false if it is not there.
  const apply = async (kind, time) => {
    const layer = settings[kind];
    const [values, read] = await Promise.all([
      colormap(settings.colormaps.replace("{name}", layer.colormap)),
      Promise.all(
        [
          [near, layer.near],
          [far, layer.far],
        ].map(async ([grid, level]) => {
          if (!unknown(grid)) return [grid, null];
          const field = await geoField(
            site,
            grid.radius * Math.SQRT2,
            level,
            urlOf(layer, time),
            async (url) => {
              progress?.add();
              const tile = await bytes(url)
                .then((b) => (b ? readPalettePng(b) : null))
                .catch(() => null);
              progress?.step();
              return tile && { data: tile, width: tile.width };
            },
            1,
          );
          return [grid, field];
        }),
      ),
    ]);
    let found = false;
    read.forEach(([grid, field]) => {
      if (!field) return;
      const { n, half, cell } = grid;
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const k = j * n + i;
          if (!Number.isNaN(grid.values[k])) continue;
          const { latitude, longitude } = placeOf(
            site,
            (i - half) * cell,
            (j - half) * cell,
          );
          const pixel = field(latitude, longitude);
          if (!pixel) continue;
          found = true;
          const { palette } = pixel.data;
          const e = pixel.data.entries[pixel.i] * 3;
          const value = values.get(
            (palette[e] << 16) | (palette[e + 1] << 8) | palette[e + 2],
          );
          if (value !== undefined) grid.values[k] = covers[kind](value);
        }
      }
    });
    return found;
  };

  let source = null;
  const latest = await latestDaily(date, settings);
  if (latest) {
    for (
      let back = 0;
      back < settings.lookBack && (unknown(near) || unknown(far));
      back += 1
    ) {
      if (await apply("daily", dayOf(latest, -back)))
        source ??= { kind: "daily", date: latest };
    }
    await apply("eightDay", latest);
  }
  // No map of the day: the month's average, from the latest year that has one.
  if (unknown(near) || unknown(far)) {
    const year = Number(date.slice(0, 4));
    const thisYear = new Date().getUTCFullYear();
    const years = [
      ...new Set([
        year,
        year - 1,
        year - 2,
        thisYear,
        thisYear - 1,
        thisYear - 2,
      ]),
    ].filter((y) => y >= 2001 && y <= thisYear);
    for (const y of years) {
      if (!(unknown(near) || unknown(far))) break;
      if (await apply("monthly", `${y}${date.slice(4, 7)}-01`))
        source ??= { kind: "monthly", date: `${y}${date.slice(4, 7)}` };
    }
  }
  // Whatever no map could see is taken as bare.
  [near, far].forEach((grid) =>
    grid.values.forEach((v, k) => {
      if (Number.isNaN(v)) grid.values[k] = 0;
    }),
  );
  // The snow cover of (x, z), in the site's frame.
  const sample = (grid, x, z) => {
    const gx = x / grid.cell + grid.half;
    const gz = z / grid.cell + grid.half;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    if (i < 0 || j < 0 || i >= grid.n - 1 || j >= grid.n - 1) return null;
    const fx = gx - i;
    const fz = gz - j;
    const v = grid.values;
    const k = j * grid.n + i;
    return (
      (v[k] * (1 - fx) + v[k + 1] * fx) * (1 - fz) +
      (v[k + grid.n] * (1 - fx) + v[k + grid.n + 1] * fx) * fz
    );
  };
  return {
    near,
    far,
    source,
    any: near.values.some((v) => v > 0.05) || far.values.some((v) => v > 0.05),
    at: (x, z) => sample(near, x, z) ?? sample(far, x, z) ?? 0,
  };
};
