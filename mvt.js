/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// A small reader for Mapbox Vector Tiles (protobuf): each layer's features with
// their properties and geometry, as rings or lines of [x, y] in tile units.

const reader = (bytes) => {
  let at = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[at++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  const skip = (type) => {
    if (type === 0) varint();
    else if (type === 1) at += 8;
    else if (type === 2) {
      // The length is read first: `at += varint()` would add it to where the length began.
      const length = varint();
      at += length;
    } else if (type === 5) at += 4;
  };
  return {
    get at() {
      return at;
    },
    varint,
    skip,
    // Fields of a message ending at `end`: calls handle(field, type) for each.
    each(end, handle) {
      while (at < end) {
        const key = varint();
        handle(key >> 3, key & 7);
      }
    },
    string() {
      const length = varint();
      const text = new TextDecoder().decode(bytes.subarray(at, at + length));
      at += length;
      return text;
    },
    packed() {
      const length = varint();
      const end = at + length;
      const values = [];
      while (at < end) values.push(varint());
      return values;
    },
    double() {
      const value = new DataView(
        bytes.buffer,
        bytes.byteOffset + at,
        8,
      ).getFloat64(0, true);
      at += 8;
      return value;
    },
    float() {
      const value = new DataView(
        bytes.buffer,
        bytes.byteOffset + at,
        4,
      ).getFloat32(0, true);
      at += 4;
      return value;
    },
  };
};

const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

// Geometry commands to parts: MoveTo starts a part, LineTo extends it, ClosePath ends a ring.
const geometryOf = (commands) => {
  const parts = [];
  let x = 0;
  let y = 0;
  let part = null;
  for (let i = 0; i < commands.length;) {
    const id = commands[i] & 7;
    const count = commands[i] >> 3;
    i += 1;
    if (id === 7) {
      part = null;
      continue;
    }
    for (let k = 0; k < count; k += 1) {
      x += zigzag(commands[i]);
      y += zigzag(commands[i + 1]);
      i += 2;
      if (id === 1) {
        part = [[x, y]];
        parts.push(part);
      } else {
        part.push([x, y]);
      }
    }
  }
  return parts;
};

// The tile's layers by name: { extent, features: [{ type, properties, parts }] }.
// Only the layers named in `wanted` are read.
export const readTile = (bytes, wanted) => {
  const r = reader(bytes);
  const layers = {};
  r.each(bytes.length, (field, type) => {
    if (field !== 3) {
      r.skip(type);
      return;
    }
    const end = r.varint() + r.at;
    const layer = { name: "", extent: 4096, keys: [], values: [], raw: [] };
    r.each(end, (f, t) => {
      // A layer not wanted is passed over once its name is known.
      if (wanted && layer.name && !wanted.includes(layer.name)) {
        r.skip(t);
        return;
      }
      if (f === 1) layer.name = r.string();
      else if (f === 5) layer.extent = r.varint();
      else if (f === 3) layer.keys.push(r.string());
      else if (f === 4) {
        const valueEnd = r.varint() + r.at;
        let value = null;
        r.each(valueEnd, (vf, vt) => {
          if (vf === 1) value = r.string();
          else if (vf === 2) value = r.float();
          else if (vf === 3) value = r.double();
          else if (vf === 4 || vf === 5) value = r.varint();
          else if (vf === 6) value = zigzag(r.varint());
          else if (vf === 7) value = Boolean(r.varint());
          else r.skip(vt);
        });
        layer.values.push(value);
      } else if (f === 2) {
        const featureEnd = r.varint() + r.at;
        const feature = { type: 0, tags: [], commands: [] };
        r.each(featureEnd, (ff, ft) => {
          if (ff === 2) feature.tags = r.packed();
          else if (ff === 3) feature.type = r.varint();
          else if (ff === 4) feature.commands = r.packed();
          else r.skip(ft);
        });
        layer.raw.push(feature);
      } else {
        r.skip(t);
      }
    });
    if (wanted && !wanted.includes(layer.name)) return;
    layers[layer.name] = {
      extent: layer.extent,
      features: layer.raw.map(({ type, tags, commands }) => {
        const properties = {};
        for (let i = 0; i < tags.length; i += 2)
          properties[layer.keys[tags[i]]] = layer.values[tags[i + 1]];
        return { type, properties, parts: geometryOf(commands) };
      }),
    };
  });
  return layers;
};
