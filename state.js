/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// --- Store: one state object, replaced on every change, with listeners
const listeners = new Set();

let current = {};

export const getState = () => current;

export const setState = (patch) => {
  const previous = current;
  current = {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
  listeners.forEach((listener) => listener(current, previous));
};

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Calls `listener` only when the selected value changes.
export const watch = (select, listener) =>
  subscribe((next, previous) => {
    if (select(next) !== select(previous)) listener(select(next), next);
  });
