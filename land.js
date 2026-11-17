/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// What covers the land around a site and where its water lies. Close by it is
// read from OpenStreetMap (vector tiles: water, waterways, land cover, land use),
// over NASA's MODIS land cover, which also reaches the far horizon with OpenStreetMap's
// sea. Distances are metres in the ground's frame (x east, z south, from the site).
import { clamp, tileOf } from "./utils.js";
import { readTile } from "./mvt.js";

const DEG = Math.PI / 180;
const METRES_PER_DEGREE = 111320;

// Scene coordinates to latitude and longitude, and back.
export const placeOf = (site, x, z) => ({
  latitude: site.latitude - z / METRES_PER_DEGREE,
  longitude:
    site.longitude + x / (METRES_PER_DEGREE * Math.cos(site.latitude * DEG)),
});
const sceneOf = (site, latitude, longitude) => [
  (longitude - site.longitude) *
    METRES_PER_DEGREE *
    Math.cos(site.latitude * DEG),
  (site.latitude - latitude) * METRES_PER_DEGREE,
];

// NASA GIBS tiles in latitude and longitude around a site: a pixel's offset in
// its tile's data (`stride` values a pixel), or null where there is no tile.
export const geoField = async (
  site,
  radius,
  level,
  urlOf,
  load,
  stride = 4,
) => {
  const degree = 0.5625 / 2 ** level;
  const span = degree * 512;
  const columns = Math.ceil(360 / span);
  const dLat = radius / METRES_PER_DEGREE;
  const dLon = Math.min(
    radius /
      (METRES_PER_DEGREE * Math.max(Math.cos(site.latitude * DEG), 0.05)),
    180,
  );
  const rows = [
    Math.max(0, Math.floor((90 - site.latitude - dLat) / span)),
    Math.floor((90 - site.latitude + dLat) / span),
  ];
  const cols = [
    Math.floor((site.longitude - dLon + 180) / span),
    Math.floor((site.longitude + dLon + 180) / span),
  ];
  const cells = [];
  for (
    let r = rows[0];
    r <= Math.min(rows[1], Math.ceil(180 / span) - 1);
    r += 1
  ) {
    for (let c = cols[0]; c <= cols[1]; c += 1)
      cells.push([r, ((c % columns) + columns) % columns]);
  }
  const tiles = new Map();
  await Promise.all(
    cells.map(async ([r, c]) =>
      tiles.set(`${r},${c}`, await load(urlOf(level, r, c))),
    ),
  );
  return (latitude, longitude) => {
    const px = Math.floor(((((longitude + 180) % 360) + 360) % 360) / degree);
    const py = Math.floor((90 - latitude) / degree);
    const tile = tiles.get(
      `${Math.floor(py / 512)},${Math.floor(px / 512) % columns}`,
    );
    return tile
      ? { data: tile.data, i: ((py % 512) * tile.width + (px % 512)) * stride }
      : null;
  };
};

// Where the sea is around a site, from OpenStreetMap's land/water map (GIBS):
// (x, z) -> true over the sea.
export const seaMap = async (site, radius, settings, load) => {
  const { gibs, sea } = settings;
  const field = await geoField(
    site,
    radius,
    sea.far,
    (level, row, col) =>
      gibs
        .replace("{layer}", sea.layer)
        .replace("{time}", sea.time)
        .replace("{set}", sea.set)
        .replace("{level}", level)
        .replace("{row}", row)
        .replace("{col}", col),
    load,
  );
  return (x, z) => {
    const { latitude, longitude } = placeOf(site, x, z);
    const pixel = field(latitude, longitude);
    return Boolean(pixel && pixel.data[pixel.i] > 100);
  };
};

// OpenStreetMap vector tiles around a site: their features, in scene coordinates.
let osmTiles = null;
const osmFeatures = async (site, radius, settings, load) => {
  osmTiles ??= fetch(settings.tilejson)
    .then((r) => r.json())
    .then((json) => json.tiles[0])
    .catch(() => null);
  const template = await osmTiles;
  if (!template) return [];
  const { zoom } = settings;
  const n = 2 ** zoom;
  const corner = (dx, dz) => {
    const { latitude, longitude } = placeOf(site, dx, dz);
    return tileOf(latitude, longitude, zoom);
  };
  const a = corner(-radius, -radius);
  const b = corner(radius, radius);
  const cells = [];
  for (let y = Math.floor(a.y); y <= Math.floor(b.y); y += 1) {
    for (let x = Math.floor(a.x); x <= Math.floor(b.x); x += 1)
      cells.push([((x % n) + n) % n, clamp(y, 0, n - 1)]);
  }
  const features = [];
  await Promise.all(
    cells.map(async ([tx, ty]) => {
      const bytes = await load(
        template.replace("{z}", zoom).replace("{x}", tx).replace("{y}", ty),
      );
      if (!bytes) return;
      const layers = readTile(bytes, [
        "water",
        "waterway",
        "landcover",
        "landuse",
      ]);
      Object.entries(layers).forEach(([layer, { extent, features: list }]) => {
        const toScene = ([px, py]) => {
          const longitude = ((tx + px / extent) / n) * 360 - 180;
          const latitude =
            Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / extent)) / n))) /
            DEG;
          return sceneOf(site, latitude, longitude);
        };
        list.forEach(({ type, properties, parts }) =>
          features.push({
            layer,
            type,
            properties,
            parts: parts.map((part) => part.map(toScene)),
          }),
        );
      });
    }),
  );
  return features;
};

// A smooth, repeatable wander (value noise), about one unit per feature.
const hash = (x, y) => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
const noise = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx;
  const bottom = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
};

// A square grid of cells around the site, read with bilinear filtering.
const makeGrid = (radius, cell) => {
  const half = Math.ceil(radius / cell);
  const n = 2 * half + 1;
  const each = (fn) => {
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1)
        fn(i, j, (i - half) * cell, (j - half) * cell, j * n + i);
  };
  // Bilinear corners of (x, z), reused from call to call: four cell indices and
  // their weights, or null outside the grid.
  const scratch = { k: new Int32Array(4), w: new Float32Array(4) };
  const corners = (x, z) => {
    const gx = x / cell + half;
    const gz = z / cell + half;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return null;
    const fx = gx - i;
    const fz = gz - j;
    scratch.k[0] = j * n + i;
    scratch.k[1] = j * n + i + 1;
    scratch.k[2] = (j + 1) * n + i;
    scratch.k[3] = (j + 1) * n + i + 1;
    scratch.w[0] = (1 - fx) * (1 - fz);
    scratch.w[1] = fx * (1 - fz);
    scratch.w[2] = (1 - fx) * fz;
    scratch.w[3] = fx * fz;
    return scratch;
  };
  const sample = (values, x, z, outside = 0) => {
    const c = corners(x, z);
    return c
      ? values[c.k[0]] * c.w[0] +
          values[c.k[1]] * c.w[1] +
          values[c.k[2]] * c.w[2] +
          values[c.k[3]] * c.w[3]
      : outside;
  };
  // Every cell whose centre lies inside the rings (even-odd, so holes stay out).
  const fill = (rings, set) => {
    let top = Infinity;
    let bottom = -Infinity;
    rings.forEach((ring) =>
      ring.forEach(([, z]) => {
        top = Math.min(top, z);
        bottom = Math.max(bottom, z);
      }),
    );
    for (
      let j = Math.max(0, Math.floor(top / cell + half));
      j <= Math.min(n - 1, Math.ceil(bottom / cell + half));
      j += 1
    ) {
      const z = (j - half) * cell;
      const crossings = [];
      rings.forEach((ring) => {
        for (let k = 0; k < ring.length; k += 1) {
          const [x1, z1] = ring[k];
          const [x2, z2] = ring[(k + 1) % ring.length];
          if ((z1 <= z && z2 > z) || (z2 <= z && z1 > z))
            crossings.push(x1 + ((z - z1) / (z2 - z1)) * (x2 - x1));
        }
      });
      crossings.sort((p, q) => p - q);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const from = Math.max(0, Math.ceil(crossings[c] / cell + half));
        const to = Math.min(n - 1, Math.floor(crossings[c + 1] / cell + half));
        for (let i = from; i <= to; i += 1) set(j * n + i);
      }
    }
  };
  return { n, half, cell, each, corners, sample, fill };
};

// A box blur of a grid's values, `reach` cells each way.
const blur = (values, n, reach) => {
  const out = new Float32Array(values.length);
  const row = new Float32Array(values.length);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      let count = 0;
      for (
        let k = Math.max(0, i - reach);
        k <= Math.min(n - 1, i + reach);
        k += 1
      ) {
        sum += values[j * n + k];
        count += 1;
      }
      row[j * n + i] = sum / count;
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      let count = 0;
      for (
        let k = Math.max(0, j - reach);
        k <= Math.min(n - 1, j + reach);
        k += 1
      ) {
        sum += row[k * n + i];
        count += 1;
      }
      out[j * n + i] = sum / count;
    }
  }
  return out;
};

// OpenStreetMap land cover and land use to the kinds of land; `forest` is the
// kind of forest MODIS sees nearby, for woods OpenStreetMap does not describe.
const osmCover = ({ layer, properties: { class: kind, subclass } }, forest) => {
  if (layer === "landuse")
    return ["residential", "commercial", "industrial", "retail"].includes(kind)
      ? "urban"
      : null;
  if (kind === "wood") return forest;
  if (kind === "farmland") return "cropland";
  if (kind === "wetland") return "wetland";
  if (kind === "sand") return "sand";
  if (kind === "rock") return "rock";
  if (kind === "ice") return "snow";
  if (kind === "grass")
    return ["scrub", "heath", "fell"].includes(subclass)
      ? "shrubland"
      : "grassland";
  return null;
};

// Read the land around `site`. `raw(x, z)` is the elevation (metres above sea, or
// null) and `h0` the site's own; `load(url)` reads a tile's pixels and `bytes(url)`
// its bytes.
export const readLand = async ({
  site,
  raw,
  h0,
  settings,
  covers,
  landCover,
  outerRadius,
  load,
  bytes,
}) => {
  const { gibs, cover, sea } = settings;
  const gibsUrl = (layer) => (level, row, col) =>
    gibs
      .replace("{layer}", layer.layer)
      .replace("{time}", layer.time)
      .replace("{set}", layer.set)
      .replace("{level}", level)
      .replace("{row}", row)
      .replace("{col}", col);
  const [coverNear, coverFar, seaFar, features] = await Promise.all([
    geoField(
      site,
      settings.coverRadius + settings.warp * 2,
      cover.near,
      gibsUrl(cover),
      load,
    ),
    geoField(site, outerRadius, cover.far, gibsUrl(cover), load),
    geoField(site, outerRadius, sea.far, gibsUrl(sea), load),
    osmFeatures(site, settings.coverRadius, settings.osm, bytes),
  ]);

  // MODIS land cover classes by color; anything else (no data) is left unknown.
  const classes = new Map(
    landCover.map(({ rgb: [r, g, b], cover: id }) => [
      (r << 16) | (g << 8) | b,
      id,
    ]),
  );
  const classOf = (pixel) =>
    pixel
      ? (classes.get(
          (pixel.data[pixel.i] << 16) |
            (pixel.data[pixel.i + 1] << 8) |
            pixel.data[pixel.i + 2],
        ) ?? null)
      : null;
  const isSea = (pixel) => Boolean(pixel && pixel.data[pixel.i] > 100);
  // Bare land: rock where it is steep, sand where it lies gentle.
  const barren = (x, z) => {
    const step = 45;
    const dx = (raw(x + step, z) ?? 0) - (raw(x - step, z) ?? 0);
    const dz = (raw(x, z + step) ?? 0) - (raw(x, z - step) ?? 0);
    return Math.hypot(dx, dz) / (2 * step) > settings.rockSlope
      ? "rock"
      : "sand";
  };
  const modisAt = (x, z, field) => {
    const { latitude, longitude } = placeOf(site, x, z);
    const id = classOf(field(latitude, longitude));
    return id === "barren" ? barren(x, z) : id;
  };

  // --- The land cover grid: MODIS read through a gentle wander so its edges
  // curve, then OpenStreetMap's own areas over it.
  const grid = makeGrid(settings.coverRadius, settings.coverCell);
  const ids = [...Object.keys(covers), "water"];
  const index = new Map(ids.map((id, i) => [id, i]));
  const cells = new Uint8Array(grid.n * grid.n).fill(255);
  grid.each((i, j, x, z, k) => {
    const wx = (noise(x / 420, z / 420) - 0.5) * 2 * settings.warp;
    const wz = (noise(x / 420 + 17.3, z / 420 - 9.1) - 0.5) * 2 * settings.warp;
    const id = modisAt(x + wx, z + wz, coverNear) ?? modisAt(x, z, coverFar);
    cells[k] = id ? index.get(id) : 255;
  });
  // Cells with no data borrow a known neighbour's cover.
  for (let pass = 0; pass < 6 && cells.includes(255); pass += 1) {
    const before = cells.slice();
    grid.each((i, j, x, z, k) => {
      if (before[k] !== 255) return;
      const near = [k - 1, k + 1, k - grid.n, k + grid.n].find(
        (m) => m >= 0 && m < before.length && before[m] !== 255,
      );
      if (near !== undefined) cells[k] = before[near];
    });
  }
  cells.forEach((c, k) => {
    if (c === 255) cells[k] = index.get("grassland");
  });
  // MODIS water is left to OpenStreetMap, which knows where water really lies.
  const forestKinds = ["conifer", "mixed", "broadleaf", "rainforest"];
  const forestNearby = ids[cells[grid.half * grid.n + grid.half]];
  const forest = forestKinds.includes(forestNearby)
    ? forestNearby
    : ([...cells].map((c) => ids[c]).find((id) => forestKinds.includes(id)) ??
      (Math.abs(site.latitude) > 45 ? "conifer" : "broadleaf"));
  cells.forEach((c, k) => {
    if (ids[c] === "water")
      cells[k] = index.get(
        forest === "rainforest" ? "rainforest" : "grassland",
      );
  });
  // OpenStreetMap areas, land use first so land cover drawn over it wins where both are mapped.
  features
    .filter(
      (f) => f.type === 3 && (f.layer === "landuse" || f.layer === "landcover"),
    )
    .sort(
      (a, b) =>
        (a.layer === "landuse" ? 0 : 1) - (b.layer === "landuse" ? 0 : 1),
    )
    .forEach((f) => {
      const id = osmCover(f, forest);
      if (id)
        grid.fill(f.parts, (k) => {
          cells[k] = index.get(id);
        });
    });

  // --- Water: lakes, the sea and the banks of wide rivers fill the water grid;
  // rivers, streams and canals are kept as lines, each its real width.
  const wgrid = makeGrid(settings.waterRadius, settings.waterCell);
  const wn = wgrid.n;
  const fraction = new Float32Array(wn * wn);
  const ocean = new Uint8Array(wn * wn);
  // Where wide rivers are mapped as areas, between their banks.
  const flowing = new Uint8Array(wn * wn);
  features
    .filter(
      (f) =>
        f.layer === "water" &&
        f.type === 3 &&
        !f.properties.intermittent &&
        f.properties.class !== "swimming_pool",
    )
    .forEach((f) => {
      const sea = f.properties.class === "ocean";
      const river = f.properties.class === "river";
      wgrid.fill(f.parts, (k) => {
        fraction[k] = 1;
        if (sea) ocean[k] = 1;
        if (river) flowing[k] = 1;
      });
    });
  // Open sea that no mapped coastline reaches (OpenStreetMap draws no water far
  // out at sea): the sea map, wherever the ground lies at sea level.
  wgrid.each((i, j, x, z, k) => {
    if (fraction[k]) return;
    const h = raw(x, z);
    if (h === null || h > 0.5) return;
    const { latitude, longitude } = placeOf(site, x, z);
    if (isSea(seaFar(latitude, longitude))) {
      fraction[k] = 1;
      ocean[k] = 1;
    }
  });
  // Water cells mark the land cover too, so the far color of a lake is water's.
  const waterIndex = index.get("water");
  grid.each((i, j, x, z, k) => {
    if (wgrid.sample(fraction, x, z) > 0.5) cells[k] = waterIndex;
  });
  // A water surface lies at the lowest the elevation data shows around it, then
  // smoothed: banks and noise stand above water, never in it.
  const surface = new Float32Array(wn * wn).fill(NaN);
  wgrid.each((i, j, x, z, k) => {
    if (!fraction[k]) return;
    const h = raw(x, z);
    surface[k] = ocean[k] ? -h0 : h === null ? NaN : h - h0;
  });
  const lowest = new Float32Array(wn * wn).fill(NaN);
  wgrid.each((i, j, x, z, k) => {
    if (Number.isNaN(surface[k])) return;
    if (ocean[k]) {
      lowest[k] = surface[k];
      return;
    }
    let low = surface[k];
    for (let b = Math.max(0, j - 2); b <= Math.min(wn - 1, j + 2); b += 1) {
      for (let a = Math.max(0, i - 2); a <= Math.min(wn - 1, i + 2); a += 1) {
        const v = surface[b * wn + a];
        if (!Number.isNaN(v) && !ocean[b * wn + a]) low = Math.min(low, v);
      }
    }
    lowest[k] = low;
  });
  const known = Float32Array.from(lowest, (v) => (Number.isNaN(v) ? 0 : 1));
  const summed = Float32Array.from(lowest, (v) => (Number.isNaN(v) ? 0 : v));
  const weight = blur(known, wn, 3);
  const levels = blur(summed, wn, 3).map((v, k) =>
    weight[k] > 0.001 ? v / weight[k] : NaN,
  );
  // Spread each surface a little onto the land, so the water's edge has a height to meet.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = levels.slice();
    wgrid.each((i, j, x, z, k) => {
      if (!Number.isNaN(before[k])) return;
      const near = [k - 1, k + 1, k - wn, k + wn].filter(
        (m) => m >= 0 && m < before.length && !Number.isNaN(before[m]),
      );
      if (near.length)
        levels[k] = near.reduce((sum, m) => sum + before[m], 0) / near.length;
    });
  }
  const surfaceKnown = Float32Array.from(levels, (v) =>
    Number.isNaN(v) ? 0 : 1,
  );
  const surfaceLevel = Float32Array.from(levels, (v) =>
    Number.isNaN(v) ? 0 : v,
  );
  const shoreGrid = blur(
    fraction,
    wn,
    Math.max(1, Math.round(settings.shoreReach / settings.waterCell)),
  );
  // How far each cell lies from the sea (metres; negative out in it), to the
  // reach a beach is shaped over, so the shore has a slope and not a step.
  const coastReach = Math.ceil(settings.beach.reach / settings.waterCell) + 1;
  const coastGrid = new Float32Array(wn * wn).fill(settings.beach.reach * 2);
  if (ocean.some(Boolean)) {
    wgrid.each((i, j, x, z, k) => {
      const inSea = ocean[k] === 1;
      let nearest = settings.beach.reach * 2;
      for (
        let b = Math.max(0, j - coastReach);
        b <= Math.min(wn - 1, j + coastReach);
        b += 1
      ) {
        for (
          let a = Math.max(0, i - coastReach);
          a <= Math.min(wn - 1, i + coastReach);
          a += 1
        ) {
          if ((ocean[b * wn + a] === 1) === inSea) continue;
          nearest = Math.min(
            nearest,
            Math.hypot(a - i, b - j) * settings.waterCell,
          );
        }
      }
      coastGrid[k] = inSea ? -nearest : nearest;
    });
  }

  // Waterways as segments: each end's surface is the lowest ground about it, and a
  // waterway never runs uphill along its course.
  const segments = [];
  features
    .filter(
      (f) =>
        f.layer === "waterway" &&
        f.type === 2 &&
        !f.properties.intermittent &&
        settings.waterways[f.properties.class],
    )
    .forEach((f) => {
      const { width, depth } = settings.waterways[f.properties.class];
      f.parts.forEach((line) => {
        const low = line.map(([x, z]) => {
          const around = [
            [0, 0],
            [width, 0],
            [-width, 0],
            [0, width],
            [0, -width],
          ]
            .map(([ox, oz]) => raw(x + ox, z + oz))
            .filter((h) => h !== null);
          return around.length ? Math.min(...around) - h0 : null;
        });
        for (let k = 1; k < line.length; k += 1) {
          if (low[k - 1] === null || low[k] === null) continue;
          segments.push({
            a: line[k - 1],
            b: line[k],
            levels: [low[k - 1], low[k]],
            width,
            depth,
            kind: f.properties.class,
          });
        }
      });
    });
  // Segments by the 200 m square they touch, for quick lookups.
  const BIN = 200;
  const bins = new Map();
  const binOf = (bx, bz) => bx * 65536 + bz;
  segments.forEach((s) => {
    const pad = s.width;
    for (
      let bx = Math.floor((Math.min(s.a[0], s.b[0]) - pad) / BIN);
      bx <= Math.floor((Math.max(s.a[0], s.b[0]) + pad) / BIN);
      bx += 1
    ) {
      for (
        let bz = Math.floor((Math.min(s.a[1], s.b[1]) - pad) / BIN);
        bz <= Math.floor((Math.max(s.a[1], s.b[1]) + pad) / BIN);
        bz += 1
      ) {
        const key = binOf(bx, bz);
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(s);
      }
    }
  });
  // The nearest waterway to (x, z): how far its edge is, its surface there and its kind.
  const waterwayAt = (x, z) => {
    const list = bins.get(binOf(Math.floor(x / BIN), Math.floor(z / BIN)));
    if (!list) return null;
    let best = null;
    list.forEach((s) => {
      const dx = s.b[0] - s.a[0];
      const dz = s.b[1] - s.a[1];
      const t = clamp(
        ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / (dx * dx + dz * dz || 1),
        0,
        1,
      );
      const edge =
        Math.hypot(x - (s.a[0] + dx * t), z - (s.a[1] + dz * t)) - s.width / 2;
      if (!best || edge < best.edge)
        best = {
          edge,
          level: s.levels[0] + (s.levels[1] - s.levels[0]) * t,
          depth: s.depth,
          kind: s.kind,
          width: s.width,
        };
    });
    return best;
  };

  // --- The site itself: the water within reach (sea, river or lake), else its cover.
  const reach = settings.shoreDistance;
  const reachCells = Math.round(reach / settings.waterCell);
  const centre = wgrid.half;
  let seaNearby = false;
  let lakeNearby = false;
  let riverNearby = false;
  for (let j = centre - reachCells; j <= centre + reachCells; j += 1) {
    for (let i = centre - reachCells; i <= centre + reachCells; i += 1) {
      if ((i - centre) ** 2 + (j - centre) ** 2 > reachCells * reachCells)
        continue;
      const k = j * wn + i;
      if (ocean[k]) seaNearby = true;
      else if (flowing[k]) riverNearby = true;
      else if (fraction[k] > 0.5) lakeNearby = true;
    }
  }
  // Running water within reach: wide rivers count from further off; a stream,
  // drain or ditch makes a bank of the site only when it runs right past it,
  // since farmland is threaded with them.
  let runningNearby = null;
  segments.forEach((s) => {
    const dx = s.b[0] - s.a[0];
    const dz = s.b[1] - s.a[1];
    const t = clamp(
      (-s.a[0] * dx - s.a[1] * dz) / (dx * dx + dz * dz || 1),
      0,
      1,
    );
    const distance = Math.hypot(s.a[0] + dx * t, s.a[1] + dz * t);
    const limit =
      s.kind === "river" || s.kind === "canal"
        ? reach
        : settings.waterways[s.kind].width * 4 + 12;
    if (
      distance < limit &&
      (!runningNearby || distance < runningNearby.distance)
    )
      runningNearby = { distance, kind: s.kind };
  });
  const shore = seaNearby
    ? "ocean"
    : runningNearby || riverNearby
      ? "river"
      : lakeNearby
        ? "lake"
        : null;
  const tally = new Map();
  const centreCell = grid.half;
  for (let j = centreCell - 2; j <= centreCell + 2; j += 1) {
    for (let i = centreCell - 2; i <= centreCell + 2; i += 1) {
      const id = ids[cells[j * grid.n + i]];
      if (id !== "water") tally.set(id, (tally.get(id) ?? 0) + 1);
    }
  }
  // Out on the water, with no land underfoot.
  const centreWater = wgrid.half * wn + wgrid.half;
  const afloat = fraction[centreWater] > 0.5 && ocean[centreWater] === 1;
  const dominant = afloat
    ? null
    : ([...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "grassland");

  // The kinds of ground drawn in detail close by: the most common within reach,
  // and the shore if there is water.
  const area = new Map();
  const within = Math.round(1500 / settings.coverCell);
  for (let j = centreCell - within; j <= centreCell + within; j += 1) {
    for (let i = centreCell - within; i <= centreCell + within; i += 1) {
      const id = ids[cells[j * grid.n + i]];
      if (id !== "water")
        area.set(
          id,
          (area.get(id) ?? 0) +
            1 / (1 + Math.hypot(i - centreCell, j - centreCell)),
        );
    }
  }
  const anyWater = fraction.some((f) => f > 0.5) || segments.length > 0;
  const shoreKind =
    shore ??
    (anyWater
      ? ocean.some(Boolean)
        ? "ocean"
        : segments.length || flowing.some(Boolean)
          ? "river"
          : "lake"
      : null);
  const ranked = [...area.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  // The shore always takes the fourth slot, which is where its weight goes.
  const slots = shoreKind
    ? [...ranked.slice(0, 3), null, null, null]
        .slice(0, 3)
        .concat(`shore:${shoreKind}`)
    : ranked.slice(0, 4);
  const reachShore = settings.shoreReach;
  // Per cover index: its slot (or -1) and its color from afar.
  const slotOf = ids.map((id) => slots.indexOf(id));
  const albedos = ids.map((id) =>
    id === "water" ? [0.02, 0.025, 0.03] : covers[id].farAlbedo,
  );

  return {
    site,
    kind: shore ?? dominant,
    shore,
    stream: runningNearby?.kind ?? (riverNearby ? "river" : null),
    dominant,
    afloat,
    slots,
    anyWater,
    // Shifted to a walker's new centre [dx, dz], whose ground stands dh higher.
    view: (dx = 0, dz = 0, dh = 0) => {
      const water = (x, z) => {
        const px = x + dx;
        const pz = z + dz;
        const c = wgrid.corners(px, pz);
        let out;
        if (c) {
          let filled = 0;
          let height = 0;
          for (let m = 0; m < 4; m += 1) {
            filled += surfaceKnown[c.k[m]] * c.w[m];
            height += surfaceLevel[c.k[m]] * c.w[m];
          }
          // The water's edge is read through a gentle wander, so a shore curves
          // like a real one instead of following the grid's cells.
          const wx =
            (noise(px / settings.shoreWarp[1], pz / settings.shoreWarp[1]) -
              0.5) *
            2 *
            settings.shoreWarp[0];
          const wz =
            (noise(
              pz / settings.shoreWarp[1] + 31,
              px / settings.shoreWarp[1] + 17,
            ) -
              0.5) *
            2 *
            settings.shoreWarp[0];
          const e = wgrid.corners(px + wx, pz + wz) ?? c;
          let wet = 0;
          let salt = 0;
          let shore = 0;
          let coast = 0;
          for (let m = 0; m < 4; m += 1) {
            const k = e.k[m];
            const w = e.w[m];
            wet += fraction[k] * w;
            salt += ocean[k] * w;
            shore += shoreGrid[k] * w;
            coast += coastGrid[k] * w;
          }
          out = {
            fraction: wet,
            sea: salt,
            level: filled > 0.01 ? height / filled - dh : null,
            depth: settings.waterDepth,
            shore: clamp(shore * 3, 0, 1),
            coast,
          };
        } else {
          const { latitude, longitude } = placeOf(site, px, pz);
          const h = raw(px, pz);
          const deep = isSea(seaFar(latitude, longitude)) && (h ?? 0) < 1;
          out = {
            fraction: deep ? 1 : 0,
            sea: deep ? 1 : 0,
            level: deep ? -h0 - dh : null,
            depth: 4,
            shore: 0,
            coast: deep ? -settings.beach.reach * 2 : settings.beach.reach * 2,
          };
        }
        // A waterway here: inside its banks it is water, its own surface and depth.
        const way = waterwayAt(px, pz);
        if (way) {
          const inside = clamp(
            0.5 - way.edge / Math.max(1.2, way.width * 0.15),
            0,
            1,
          );
          if (inside > out.fraction) {
            out.fraction = inside;
            out.level = way.level - dh;
            out.depth = way.depth;
          }
          out.shore = Math.max(
            out.shore,
            clamp(1 - way.edge / Math.max(reachShore * 0.4, way.width), 0, 1),
          );
        }
        return out;
      };
      // How much each detailed kind of ground covers (x, z), slot by slot; give
      // the water already worked out for (x, z) to save the work.
      const weightsWith = (x, z, here) => {
        const out = [0, 0, 0, 0];
        const c = grid.corners(x + dx, z + dz);
        if (c) {
          for (let m = 0; m < 4; m += 1) {
            const s = slotOf[cells[c.k[m]]];
            if (s >= 0) out[s] += c.w[m];
          }
        }
        if (shoreKind) {
          const near = (here ?? water(x, z)).shore;
          for (let s = 0; s < 3; s += 1) out[s] *= 1 - near;
          out[3] = near;
        }
        return out;
      };
      return {
        water,
        weightsWith,
        weights: (x, z) => weightsWith(x, z),
        // The land's color from afar.
        color: (x, z) => {
          const c = grid.corners(x + dx, z + dz);
          if (c) {
            const out = [0, 0, 0];
            for (let m = 0; m < 4; m += 1) {
              const albedo = albedos[cells[c.k[m]]];
              out[0] += albedo[0] * c.w[m];
              out[1] += albedo[1] * c.w[m];
              out[2] += albedo[2] * c.w[m];
            }
            return out;
          }
          const id = modisAt(x + dx, z + dz, coverFar);
          return id ? albedos[index.get(id)] : covers.grassland.farAlbedo;
        },
      };
    },
  };
};
