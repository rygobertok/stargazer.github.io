/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// --- What the player keeps between visits, in this browser: the way they play,
// their assists, and their progress in the field game. Every write keeps the
// value it replaces under a backup key, and a stored value that cannot be read
// is set aside under its own key rather than written over.

const read = (key, fallback) => {
  let raw = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return { value: fallback, writable: false };
  }
  if (raw === null) return { value: fallback, writable: true };
  try {
    return { value: { ...fallback, ...JSON.parse(raw) }, writable: true };
  } catch {
    try {
      window.localStorage.setItem(`${key}:unreadable:${Date.now()}`, raw);
      return { value: fallback, writable: true };
    } catch {
      return { value: fallback, writable: false };
    }
  }
};

const write = (key, value) => {
  try {
    const previous = window.localStorage.getItem(key);
    if (previous !== null)
      window.localStorage.setItem(`${key}:backup`, previous);
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

// A stored record: `get` its value, `set` a new one (kept in memory even where
// the browser keeps nothing).
export const stored = (key, fallback) => {
  const found = read(key, fallback);
  let value = found.value;
  return {
    get: () => value,
    set: (next) => {
      value = next;
      if (found.writable) write(key, value);
      return value;
    },
  };
};
