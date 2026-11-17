/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

import * as THREE from "three";
import { gsap } from "gsap";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  earthVertex,
  earthFragment,
  atmosphereFragment,
  terrainVertex,
  terrainFragment,
  plantVertex,
  plantFragment,
  treeVertex,
  treeFragment,
  waterVertex,
  waterFragment,
  shadowPlantVertex,
  shadowPlantFragment,
  shadowTreeVertex,
  shadowTreeFragment,
} from "./shaders.js";
import {
  clamp,
  globePoint,
  globeCoordinates,
  tileOf,
  tileLatitude,
  formatCoordinates,
  seededRandom,
} from "./utils.js";
import { readLand, seaMap } from "./land.js";
import { readSnow } from "./snow.js";
import { regionOf } from "./data.js";

// --- Popovers anchored to the control that opened them
// Beside the guides' rail; below a bar along the top; above a bar along the
// bottom. Centred on the control and kept on screen.
export const placePanel = (panel, button) => {
  const rect = button.getBoundingClientRect();
  const bar =
    button
      .closest(".toolbar, .timeline, .hotbar, .guides-rail")
      ?.getBoundingClientRect() ?? rect;
  const gap = 10;
  const edge = 12;
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const across = clamp(
    rect.left + rect.width / 2 - width / 2,
    edge,
    window.innerWidth - width - edge,
  );
  if (button.closest(".guides-rail")) {
    const top = clamp(
      rect.top + rect.height / 2 - height / 2,
      edge,
      window.innerHeight - height - edge,
    );
    Object.assign(panel.style, {
      left: `${bar.right + gap}px`,
      top: `${top}px`,
      bottom: "auto",
      right: "auto",
    });
  } else if (bar.top + bar.height / 2 < window.innerHeight / 2) {
    Object.assign(panel.style, {
      left: `${across}px`,
      top: `${bar.bottom + gap}px`,
      bottom: "auto",
      right: "auto",
    });
  } else {
    Object.assign(panel.style, {
      left: `${across}px`,
      bottom: `${window.innerHeight - bar.top + gap}px`,
      top: "auto",
      right: "auto",
    });
  }
};

export const anchorPanels = (root) =>
  [...root.querySelectorAll("[popovertarget]")].forEach((button) => {
    const panel = document.getElementById(button.getAttribute("popovertarget"));
    button.setAttribute("aria-expanded", "false");
    panel.addEventListener("toggle", (event) => {
      const open = event.newState === "open";
      button.setAttribute("aria-expanded", String(open));
      // A panel marked `data-centered` stays in the middle of the screen.
      if (open && !panel.hasAttribute("data-centered"))
        placePanel(panel, button);
    });
    window.addEventListener("resize", () => {
      if (
        panel.matches(":popover-open") &&
        !panel.hasAttribute("data-centered")
      )
        placePanel(panel, button);
    });
  });

// --- Idle: icons and text fade low when nothing has happened for a while
export const trackIdle = (root, seconds) => {
  let timer = 0;
  const anyPanelOpen = () => Boolean(root.querySelector(":popover-open"));
  const rest = () => {
    if (anyPanelOpen()) wake();
    else root.dataset.idle = "true";
  };
  const wake = () => {
    root.dataset.idle = "false";
    clearTimeout(timer);
    timer = setTimeout(rest, seconds * 1000);
  };
  ["pointermove", "pointerdown", "keydown", "wheel", "focusin"].forEach(
    (type) => window.addEventListener(type, wake, { passive: true }),
  );
  wake();
};

// --- Globe: the night Earth for choosing where to stand
const DEG = Math.PI / 180;

const loadImage = (src) =>
  new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

const tileUrl = (template, z, x, y) =>
  template.replace("{z}", z).replace("{x}", x).replace("{y}", y);

// A lat/lon rectangle of the sphere, with texture coordinates in Web Mercator.
const patchGeometry = ({ lonMin, lonMax, z, y0, rows }, segments, radius) => {
  const n = segments + 1;
  const cells = Array.from({ length: n * n }, (_, k) => [
    k % n,
    Math.floor(k / n),
  ]);
  const positions = cells.flatMap(([i, j]) =>
    globePoint(
      tileLatitude(y0 + (rows * j) / segments, z),
      lonMin + ((lonMax - lonMin) * i) / segments,
      radius,
    ),
  );
  const uvs = cells.flatMap(([i, j]) => [i / segments, 1 - j / segments]);
  const index = cells
    .filter(([i, j]) => i < segments && j < segments)
    .flatMap(([i, j]) => {
      const a = j * n + i;
      return [a, a + n, a + 1, a + 1, a + n, a + n + 1];
    });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      positions.map((v) => v / radius),
      3,
    ),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
};

// The night Earth, drawn by its own renderer on a canvas inside `root` (the place
// dialog); screen positions are within that canvas.
export const createGlobe = ({
  renderer,
  root,
  earthMap,
  exposure,
  settings,
  pins,
  skyAt,
  nameAt,
  onSelect,
}) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.0005, 2000);
  const maxLevel = settings.levels.length - 1;

  // Earth, its sharper tile patch, and the atmosphere around it
  const earthMaterial = (map, feather) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uOpacity: { value: 1 },
        uFeather: { value: feather },
        uExposure: exposure,
      },
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      transparent: feather > 0,
      depthWrite: feather === 0,
    });
  const earthGroup = new THREE.Group();
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 80),
    earthMaterial(earthMap, 0),
  );
  earthGroup.add(earth);
  scene.add(earthGroup);
  // The atmosphere, drawn over the Earth and the space around it; its shader
  // works out the air along each line of sight, so the mesh only sets the bounds.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 128, 64),
    new THREE.ShaderMaterial({
      uniforms: {
        uExposure: exposure,
        uLight: {
          value: new THREE.Vector3(...settings.atmosphere.light).normalize(),
        },
        uScaleHeight: { value: settings.atmosphere.scaleHeight },
        uStrength: { value: settings.atmosphere.strength },
      },
      vertexShader: earthVertex,
      fragmentShader: atmosphereFragment,
      // Inner faces, so it still draws when the camera dips inside the shell.
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  atmosphere.renderOrder = 2;
  scene.add(atmosphere);

  // View: the point under the camera, and how close the camera is
  const view = { latitude: 0, longitude: 0, level: 0 };
  // Zoom levels interpolate geometrically; past the last level (the flight
  // down) the camera keeps closing in at the same rate.
  const distanceAt = (level) => {
    const i = clamp(Math.floor(level), 0, maxLevel - 1);
    const t = Math.max(level - i, 0);
    const [a, b] = [settings.levels[i] - 1, settings.levels[i + 1] - 1];
    return 1 + a * (b / a) ** t;
  };
  const apply = () => {
    view.latitude = clamp(view.latitude, -85, 85);
    earthGroup.rotation.set(
      view.latitude * DEG,
      -Math.PI / 2 - view.longitude * DEG,
      0,
    );
    camera.position.set(0, 0, distanceAt(view.level));
    camera.lookAt(0, 0, 0);
    earthGroup.updateMatrixWorld();
  };

  let tween = null;
  // Every flight of the view runs through here. Its promise settles when the flight
  // ends or when something cuts it short (a drag, a tap, the next flight), so
  // whatever waits on it is never left waiting.
  let settle = null;
  const stop = () => {
    tween?.kill();
    tween = null;
    const done = settle;
    settle = null;
    done?.();
  };
  const fly = (vars) =>
    new Promise((resolve) => {
      stop();
      settle = resolve;
      tween = gsap.to(view, {
        ...vars,
        onUpdate: apply,
        onComplete: () => {
          vars.onComplete?.();
          tween = null;
          const done = settle;
          settle = null;
          done?.();
        },
      });
    });

  const focus = (
    latitude,
    longitude,
    level,
    duration = settings.focusSeconds,
  ) => {
    const turn = ((((longitude - view.longitude) % 360) + 540) % 360) - 180;
    return fly({
      latitude,
      longitude: view.longitude + turn,
      level: clamp(level, 0, maxLevel + 0.4),
      duration,
      ease: "power2.inOut",
      onComplete: scheduleTiles,
    });
  };

  // Sharper night-light tiles around the focus once zoomed in
  const patch = { mesh: null, key: "" };
  let tileTimer = 0;
  const pixelsPerRadian = () =>
    renderer.domElement.height /
    (2 * Math.tan((camera.fov * DEG) / 2)) /
    Math.max(distanceAt(view.level) - 1, 1e-4);

  const updateTiles = async () => {
    if (view.level < settings.tileLevel) {
      if (patch.mesh) patch.mesh.visible = false;
      return;
    }
    const z = clamp(
      Math.round(Math.log2((2 * Math.PI * pixelsPerRadian()) / 256)),
      3,
      settings.tileMaxZoom,
    );
    const grid = settings.tileGrid;
    const center = tileOf(view.latitude, view.longitude, z);
    const x0 = Math.floor(center.x - grid / 2 + 0.5);
    const y0 = clamp(Math.floor(center.y - grid / 2 + 0.5), 0, 2 ** z - grid);
    const key = `${z}/${x0}/${y0}`;
    if (key === patch.key) {
      patch.mesh.visible = true;
      return;
    }
    patch.key = key;
    const cells = Array.from({ length: grid * grid }, (_, k) => [
      k % grid,
      Math.floor(k / grid),
    ]);
    const wrap = (x) => ((x % 2 ** z) + 2 ** z) % 2 ** z;
    const lights = await Promise.all(
      cells.map(([i, j]) =>
        loadImage(tileUrl(settings.tileUrl, z, wrap(x0 + i), y0 + j)),
      ),
    );
    if (key !== patch.key || lights.every((image) => !image)) return;
    const canvas = document.createElement("canvas");
    canvas.width = grid * 256;
    canvas.height = grid * 256;
    const context = canvas.getContext("2d");
    cells.forEach(([i, j], k) => {
      if (lights[k]) context.drawImage(lights[k], i * 256, j * 256);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const geometry = patchGeometry(
      {
        lonMin: (x0 / 2 ** z) * 360 - 180,
        lonMax: ((x0 + grid) / 2 ** z) * 360 - 180,
        z,
        y0,
        rows: grid,
      },
      48,
      1.0004,
    );
    if (patch.mesh) {
      earthGroup.remove(patch.mesh);
      patch.mesh.geometry.dispose();
      patch.mesh.material.uniforms.uMap.value.dispose();
      patch.mesh.material.dispose();
    }
    patch.mesh = new THREE.Mesh(geometry, earthMaterial(texture, 0.3));
    patch.mesh.material.uniforms.uOpacity.value = 0;
    patch.mesh.renderOrder = 1;
    earthGroup.add(patch.mesh);
    gsap.to(patch.mesh.material.uniforms.uOpacity, {
      value: 1,
      duration: 0.8,
      ease: "power1.out",
    });
  };

  const scheduleTiles = () => {
    clearTimeout(tileTimer);
    tileTimer = setTimeout(updateTiles, 180);
  };

  // Screen positions of points on the turning globe
  const scratch = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const screenOf = (latitude, longitude) => {
    scratch
      .set(...globePoint(latitude, longitude))
      .applyMatrix4(earthGroup.matrixWorld);
    toCamera.copy(camera.position).sub(scratch).normalize();
    const facing = scratch.clone().normalize().dot(toCamera);
    scratch.project(camera);
    return {
      x: ((scratch.x + 1) / 2) * renderer.domElement.clientWidth,
      y: ((1 - scratch.y) / 2) * renderer.domElement.clientHeight,
      visible: facing > 0.12 && scratch.z < 1,
    };
  };

  // Pins for dark-sky places
  const pinLayer = root.querySelector(".pins");
  const pinTemplate = document.getElementById("globe-pin");
  const pinNodes = pins.map((place) => {
    const node = pinTemplate.content.cloneNode(true).firstElementChild;
    node.querySelector(".pin-label").textContent = place.name;
    node.setAttribute("aria-label", `${place.name}, ${place.region}`);
    node.addEventListener("click", () => {
      setTarget(place);
      focus(
        place.latitude,
        place.longitude,
        Math.max(view.level, maxLevel - 1),
      );
    });
    pinLayer.append(node);
    return { node, place };
  });

  // The spot being considered
  const card = root.querySelector(".target");
  const cardName = card.querySelector(".target-name");
  const cardRegion = card.querySelector(".target-region");
  const cardSky = card.querySelector(".target-sky");
  let target = null;
  let naming = 0;

  const setTarget = (place) => {
    const request = ++naming;
    target = { ...place };
    card.hidden = false;
    cardName.textContent = place.name || "Finding this place…";
    cardRegion.textContent = place.region || formatCoordinates(place);
    const sky = skyAt(place.latitude, place.longitude);
    cardSky.textContent = sky
      ? `Sky ${sky.brightness.toFixed(2)} mag/arcsec² · zone ${sky.zone}`
      : "";
    if (!place.name) {
      nameAt(place.latitude, place.longitude)
        .then(({ name, region }) => {
          if (request !== naming) return;
          target = {
            ...target,
            name: name || formatCoordinates(place),
            region: name ? region : "",
          };
          cardName.textContent = target.name;
          cardRegion.textContent = target.region || formatCoordinates(place);
        })
        .catch(() => {
          if (request !== naming) return;
          target = { ...target, name: formatCoordinates(place), region: "" };
          cardName.textContent = target.name;
          cardRegion.textContent = "";
        });
    }
  };

  const clearTarget = () => {
    target = null;
    card.hidden = true;
  };

  card.querySelector(".stargaze-button").addEventListener("click", () => {
    if (target) onSelect(target);
  });

  const place = () => {
    const labels = view.level >= settings.pinLabelLevel;
    pinLayer.dataset.labels = String(labels);
    pinNodes.forEach(({ node, place: spot }) => {
      const at = screenOf(spot.latitude, spot.longitude);
      node.style.visibility = at.visible ? "visible" : "hidden";
      node.style.transform = `translate(${(at.x - 13.5).toFixed(1)}px, ${(at.y - 14).toFixed(1)}px)`;
    });
    if (target) {
      const at = screenOf(target.latitude, target.longitude);
      card.style.visibility = at.visible ? "visible" : "hidden";
      card.style.transform = `translate(${(at.x - 116).toFixed(1)}px, calc(${at.y.toFixed(1)}px - 100% - 24px))`;
    }
  };

  // Picking a point on the globe
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  // (x, y) on the page, as pointer events give them.
  const pick = (x, y) => {
    const box = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((x - box.left) / box.width) * 2 - 1,
      -((y - box.top) / box.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObject(earth);
    return hit
      ? globeCoordinates(earthGroup.worldToLocal(hit.point.clone()).toArray())
      : null;
  };

  const clickAt = (x, y) => {
    // A tap while a place's card is open only closes it; the next tap picks a place.
    if (target) {
      clearTarget();
      return;
    }
    const spot = pick(x, y);
    if (!spot) return;
    setTarget(spot);
    if (view.level < maxLevel - 0.05)
      focus(spot.latitude, spot.longitude, Math.floor(view.level + 0.05) + 1);
    else focus(spot.latitude, spot.longitude, view.level, 0.6);
  };

  // Pointer: drag to spin, click to zoom in, pinch and wheel to zoom
  const canvas = renderer.domElement;
  const ui = root;
  const pointers = new Map();
  let active = false;
  let gesture = null;

  const degreesPerPixel = () =>
    settings.dragDegreesPerPixel *
    ((distanceAt(view.level) - 1) / (settings.levels[0] - 1));

  canvas.addEventListener("pointerdown", (event) => {
    if (!active) return;
    ui.dataset.hinted = "true";
    stop();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the drag still works.
    }
    gesture =
      pointers.size === 1
        ? {
            type: "drag",
            startX: event.clientX,
            startY: event.clientY,
            moved: 0,
          }
        : { type: "pinch", distance: null, level: view.level };
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!active || !pointers.has(event.pointerId) || !gesture) return;
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.type === "drag") {
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      gesture.moved += Math.hypot(dx, dy);
      const step = degreesPerPixel();
      view.longitude -=
        (dx * step) / Math.max(Math.cos(view.latitude * DEG), 0.2);
      view.latitude += dy * step;
      apply();
    } else {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.distance ??= distance;
      view.level = clamp(
        gesture.level + Math.log2(distance / gesture.distance) * 1.2,
        0,
        maxLevel,
      );
      apply();
    }
  });

  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (
      gesture?.type === "drag" &&
      gesture.moved < settings.clickTolerance &&
      event.type === "pointerup"
    ) {
      clickAt(event.clientX, event.clientY);
    }
    if (pointers.size === 0) {
      gesture = null;
      scheduleTiles();
    }
  };
  ["pointerup", "pointercancel"].forEach((type) =>
    canvas.addEventListener(type, release),
  );

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!active) return;
      event.preventDefault();
      stop();
      view.level = clamp(view.level - event.deltaY * 0.0022, 0, maxLevel);
      apply();
      scheduleTiles();
    },
    { passive: false },
  );

  const zoomBy = (step) => {
    const level = clamp(Math.round(view.level) + step, 0, maxLevel);
    focus(view.latitude, view.longitude, level, 0.7);
  };
  root.querySelector(".zoom-in").addEventListener("click", () => zoomBy(1));
  root.querySelector(".zoom-out").addEventListener("click", () => zoomBy(-1));

  window.addEventListener("keydown", (event) => {
    if (!active || event.target.closest("input, .target, .pin")) return;
    const step = degreesPerPixel() * 40;
    const moves = {
      ArrowLeft: () => {
        view.longitude -= step;
      },
      ArrowRight: () => {
        view.longitude += step;
      },
      ArrowUp: () => {
        view.latitude += step;
      },
      ArrowDown: () => {
        view.latitude -= step;
      },
      "+": () => zoomBy(1),
      "=": () => zoomBy(1),
      "-": () => zoomBy(-1),
      Enter: () => {
        const box = canvas.getBoundingClientRect();
        return target
          ? onSelect(target)
          : clickAt(box.left + box.width / 2, box.top + box.height / 2);
      },
      // Esc closes a place's card, as it does a star's; with no card open it
      // closes the dialog, so it is left alone.
      Escape: () => clearTarget(),
    };
    if (!moves[event.key] || (event.key === "Escape" && !target)) return;
    event.preventDefault();
    moves[event.key]();
    apply();
    scheduleTiles();
  });

  return {
    scene,
    camera,
    // Fits the drawing to its canvas; portrait shapes keep the same width of view,
    // so the whole Earth still fits.
    resize: () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      const aspect = width / height;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = aspect;
      camera.fov =
        aspect >= 1
          ? settings.fov
          : (2 * Math.atan(Math.tan((settings.fov * DEG) / 2) / aspect)) / DEG;
      camera.updateProjectionMatrix();
    },
    frame: () => {
      place();
      renderer.render(scene, camera);
    },
    // Open on the whole Earth, turning gently to settle over `center`.
    open: (center, level = 0) => {
      active = true;
      clearTarget();
      Object.assign(view, {
        latitude: center.latitude * 0.6,
        longitude: center.longitude - settings.arrivalSpin,
        level: level + 0.35,
      });
      apply();
      return focus(
        center.latitude,
        center.longitude,
        level,
        settings.arrivalSeconds,
      );
    },
    // Rise from the ground: start close over the site and pull back.
    show: (site) => {
      active = true;
      clearTarget();
      Object.assign(view, {
        latitude: site.latitude,
        longitude: site.longitude,
        level: maxLevel + 0.4,
      });
      apply();
      return focus(site.latitude, site.longitude, 0, settings.riseSeconds);
    },
    hide: () => {
      active = false;
      stop();
      pointers.clear();
      gesture = null;
    },
    // Fly down to the chosen spot.
    descend: (spot) => {
      card.hidden = true;
      return fly({
        latitude: spot.latitude,
        longitude: spot.longitude,
        level: maxLevel + 3,
        duration: settings.descendSeconds,
        ease: "power3.in",
      });
    },
    // Spin, zoom in and mark a place found by search.
    goTo: async (spot) => {
      setTarget(spot);
      await focus(spot.latitude, spot.longitude, maxLevel - 1);
      return target;
    },
  };
};

// --- Search: dark-sky places first, then places anywhere, or typed coordinates
export const createSearch = ({
  root,
  darkSkyPlaces,
  count,
  delay,
  search,
  parse,
  describe,
  onPick,
}) => {
  const input = root.querySelector(".search-input");
  const list = root.querySelector(".search-results");
  const template = document.getElementById("search-result");
  let results = [];
  let active = -1;
  let timer = 0;
  let controller = null;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const highlight = (index) => {
    active = index;
    [...list.children].forEach((node, i) =>
      node.setAttribute("aria-selected", String(i === index)),
    );
    if (index >= 0)
      input.setAttribute("aria-activedescendant", `search-result-${index}`);
  };

  const pick = (place) => {
    close();
    input.value = place.name;
    input.blur();
    // Typed coordinates have no name yet; the globe looks one up.
    onPick(
      place.typed
        ? { latitude: place.latitude, longitude: place.longitude }
        : place,
    );
  };

  const render = (places) => {
    results = places;
    list.replaceChildren(
      ...places.map((place, i) => {
        const node = template.content.cloneNode(true).firstElementChild;
        node.id = `search-result-${i}`;
        node.dataset.darkSky = String(Boolean(place.darkSky));
        node.querySelector(".search-result-name").textContent = place.name;
        node.querySelector(".search-result-region").textContent = place.region;
        // pointerdown, not click, so the input keeps focus until the pick.
        node.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          pick(place);
        });
        return node;
      }),
    );
    list.hidden = places.length === 0;
    input.setAttribute("aria-expanded", String(places.length > 0));
    highlight(places.length ? 0 : -1);
  };

  const lookUp = async (query) => {
    const coordinates = parse(query);
    if (coordinates) {
      render([
        {
          ...coordinates,
          name: describe(coordinates),
          region: "Coordinates",
          typed: true,
        },
      ]);
      return;
    }
    const needle = query.toLowerCase();
    const dark = darkSkyPlaces
      .filter((place) =>
        `${place.name} ${place.region}`.toLowerCase().includes(needle),
      )
      .slice(0, 3)
      .map((place) => ({ ...place, darkSky: true }));
    render(dark);
    controller?.abort();
    controller = new AbortController();
    try {
      const found = await search(query, count, controller.signal);
      const fresh = found.filter(
        (place) =>
          !dark.some(
            (d) =>
              Math.abs(d.latitude - place.latitude) +
                Math.abs(d.longitude - place.longitude) <
              0.2,
          ),
      );
      if (input.value.trim() === query)
        render([...dark, ...fresh].slice(0, count));
    } catch (error) {
      if (error.name !== "AbortError") console.error(error);
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
      controller?.abort();
      close();
      return;
    }
    timer = setTimeout(() => lookUp(query), delay);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      highlight((active + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      highlight((active - 1 + results.length) % results.length);
    } else if (
      event.key === "Enter" &&
      results[Math.max(active, 0)] &&
      !list.hidden
    ) {
      event.preventDefault();
      pick(results[Math.max(active, 0)]);
    } else if (event.key === "Escape") {
      input.value = "";
      close();
    }
  });

  input.addEventListener("blur", close);

  return {
    reset: () => {
      input.value = "";
      close();
    },
  };
};

// --- Loading, shown quietly with the place: what is arriving and how far along it
// is, as phases of work that are added to and finished. The first unfinished phase
// names itself; a hairline shows the whole. It fades once everything is in.
export const createLoading = ({ root, linger }) => {
  const node = root.querySelector(".loading");
  const label = node.querySelector(".loading-label");
  const bar = node.querySelector(".loading-bar");
  const phases = [];
  let hide = 0;
  const render = () => {
    const total = phases.reduce((sum, p) => sum + p.total, 0);
    const done = phases.reduce((sum, p) => sum + p.done, 0);
    const current = phases.find((p) => p.done < p.total);
    clearTimeout(hide);
    if (current) {
      node.dataset.show = "true";
      if (label.textContent !== current.name) label.textContent = current.name;
      bar.style.setProperty("--done", (total ? done / total : 0).toFixed(3));
      return;
    }
    bar.style.setProperty("--done", "1");
    hide = setTimeout(() => {
      node.dataset.show = "false";
      phases.length = 0;
    }, linger * 1000);
  };
  return {
    busy: () => phases.some((p) => p.done < p.total),
    phase: (name) => {
      let phase = phases.find((p) => p.name === name && p.done < p.total);
      if (!phase) {
        phase = { name, total: 0, done: 0 };
        phases.push(phase);
      }
      return {
        add: (n = 1) => {
          phase.total += n;
          render();
        },
        step: () => {
          phase.done += 1;
          render();
        },
      };
    },
  };
};

// --- The ground: real terrain to the horizon, a photographed surface close by,
// scanned plants and rocks, and water where the land holds it
const EARTH_RADIUS = 6371000;
const METRES_PER_DEGREE = 111320;

// Elevation tiles around a point, read with bilinear filtering (metres).
const heightField = async (site, zoom, count, loadTile) => {
  const n = 2 ** zoom;
  const center = tileOf(site.latitude, site.longitude, zoom);
  const x0 = Math.floor(center.x) - Math.floor(count / 2);
  const y0 = clamp(Math.floor(center.y) - Math.floor(count / 2), 0, n - count);
  const cells = Array.from({ length: count * count }, (_, k) => [
    k % count,
    Math.floor(k / count),
  ]);
  const tiles = await Promise.all(
    cells.map(([i, j]) => loadTile(zoom, (((x0 + i) % n) + n) % n, y0 + j)),
  );
  const size = count * 256;
  const at = (px, py) => {
    if (px < 0 || py < 0 || px >= size || py >= size) return null;
    const tile = tiles[Math.floor(py / 256) * count + Math.floor(px / 256)];
    return tile ? tile[(py % 256) * 256 + (px % 256)] : null;
  };
  const pixelOf = (latitude, longitude) => {
    const t = tileOf(latitude, longitude, zoom);
    return [(t.x - x0) * 256 - 0.5, (t.y - y0) * 256 - 0.5];
  };
  const sample = (latitude, longitude) => {
    const [px, py] = pixelOf(latitude, longitude);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const v = [at(ix, iy), at(ix + 1, iy), at(ix, iy + 1), at(ix + 1, iy + 1)];
    if (v.some((h) => h === null)) return null;
    const fx = px - ix;
    const fy = py - iy;
    return (
      (v[0] * (1 - fx) + v[1] * fx) * (1 - fy) +
      (v[2] * (1 - fx) + v[3] * fx) * fy
    );
  };
  const nearest = (latitude, longitude) => {
    const [px, py] = pixelOf(latitude, longitude);
    return at(Math.round(px), Math.round(py));
  };
  return { sample, nearest };
};

// Scene coordinates (x east, z south, metres) to latitude and longitude.
const placeOf = (site, x, z) => ({
  latitude: site.latitude - z / METRES_PER_DEGREE,
  longitude:
    site.longitude + x / (METRES_PER_DEGREE * Math.cos(site.latitude * DEG)),
});

// A disc of rings around the observer, finest close by. `extras` adds attributes:
// name -> [item size, (x, z, r, i) -> values, pack]; i is the vertex's index, the
// same as heightAt was given, so work for a vertex can be done once. Values from 0
// to 1 can be packed as bytes (`pack` of 8) or shorts (16), which makes the mesh
// quicker to hand to the GPU. It is built a slice at a time between frames, so the
// scene never stalls while it builds.
const SLICE_MS = 6;
const nextSlice = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

// Vertex normals from the faces around each vertex (what three's
// computeVertexNormals does), a slice at a time, packed as shorts.
const slicedNormals = async (positions, index) => {
  const count = positions.length / 3;
  const sums = new Float32Array(count * 3);
  const faces = index.length / 3;
  let started = performance.now();
  for (let f = 0; f < faces; f += 1) {
    const a = index[f * 3] * 3;
    const b = index[f * 3 + 1] * 3;
    const c = index[f * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    sums[a] += nx;
    sums[a + 1] += ny;
    sums[a + 2] += nz;
    sums[b] += nx;
    sums[b + 1] += ny;
    sums[b + 2] += nz;
    sums[c] += nx;
    sums[c + 1] += ny;
    sums[c + 2] += nz;
    if ((f & 8191) === 0 && performance.now() - started > SLICE_MS) {
      await nextSlice();
      started = performance.now();
    }
  }
  const packed = new Int16Array(count * 3);
  for (let i = 0; i < count * 3; i += 3) {
    const length = Math.hypot(sums[i], sums[i + 1], sums[i + 2]) || 1;
    packed[i] = Math.round((sums[i] / length) * 32767);
    packed[i + 1] = Math.round((sums[i + 1] / length) * 32767);
    packed[i + 2] = Math.round((sums[i + 2] / length) * 32767);
  }
  return new THREE.BufferAttribute(packed, 3, true);
};

// Smooth value noise as a tiling picture, 16 cells of 16 pixels: its slope per
// cell in red and green (over -4 to 4), its height in blue. The shaders read it
// wherever the ground needs a lump, a patch or a tilt.
const noiseTexture = () => {
  const cells = 16;
  const size = cells * 16;
  const random = seededRandom(7);
  const lattice = Float32Array.from({ length: cells * cells }, () => random());
  const at = (i, j) =>
    lattice[((j + cells) % cells) * cells + ((i + cells) % cells)];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x / 16;
      const py = y / 16;
      const i = Math.floor(px);
      const j = Math.floor(py);
      const fx = px - i;
      const fy = py - j;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const dux = 6 * fx * (1 - fx);
      const duy = 6 * fy * (1 - fy);
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      const h = (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
      const dx = ((b - a) * (1 - uy) + (d - c) * uy) * dux;
      const dy = (c + (d - c) * ux - (a + (b - a) * ux)) * duy;
      const k = (y * size + x) * 4;
      data[k] = Math.round(clamp(dx / 8 + 0.5, 0, 1) * 255);
      data[k + 1] = Math.round(clamp(dy / 8 + 0.5, 0, 1) * 255);
      data[k + 2] = Math.round(h * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const radialGeometry = async (
  { rings, segments, innerRadius, outerRadius },
  heightAt,
  extras = {},
) => {
  const radii = Array.from(
    { length: rings },
    (_, i) => innerRadius * (outerRadius / innerRadius) ** (i / (rings - 1)),
  );
  const sines = Float64Array.from({ length: segments }, (_, j) =>
    Math.sin((j / segments) * Math.PI * 2),
  );
  const cosines = Float64Array.from({ length: segments }, (_, j) =>
    Math.cos((j / segments) * Math.PI * 2),
  );
  const count = 1 + rings * segments;
  const positions = new Float32Array(count * 3);
  // Packed values are written as they are worked out, so nothing is left to do in one go.
  const attributes = Object.entries(extras).map(([name, [size, at, pack]]) => ({
    name,
    size,
    at,
    pack,
    top: pack === 8 ? 255 : 65535,
    data:
      pack === 8
        ? new Uint8Array(count * size)
        : pack === 16
          ? new Uint16Array(count * size)
          : new Float32Array(count * size),
  }));
  const vertex = (i, x, z, r) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = heightAt(x, z, r, i);
    positions[i * 3 + 2] = z;
    attributes.forEach(({ size, at, pack, top, data }) => {
      const values = at(x, z, r, i);
      for (let c = 0; c < size; c += 1)
        data[i * size + c] = pack
          ? Math.round(clamp(values[c], 0, 1) * top)
          : values[c];
    });
  };
  vertex(0, 0, 0, 0);
  let started = performance.now();
  for (let ring = 0; ring < rings; ring += 1) {
    const r = radii[ring];
    for (let j = 0; j < segments; j += 1)
      vertex(1 + ring * segments + j, r * sines[j], -r * cosines[j], r);
    if (performance.now() - started > SLICE_MS) {
      await nextSlice();
      started = performance.now();
    }
  }
  const index = new Uint32Array(segments * 3 + (rings - 1) * segments * 6);
  let k = 0;
  const v = (i, j) => 1 + i * segments + (j % segments);
  for (let j = 0; j < segments; j += 1) {
    index[k++] = 0;
    index[k++] = v(0, j + 1);
    index[k++] = v(0, j);
  }
  for (let i = 0; i < rings - 1; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      index[k++] = v(i, j);
      index[k++] = v(i, j + 1);
      index[k++] = v(i + 1, j);
      index[k++] = v(i, j + 1);
      index[k++] = v(i + 1, j + 1);
      index[k++] = v(i + 1, j);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  attributes.forEach(({ name, size, data, pack }) =>
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(data, size, Boolean(pack)),
    ),
  );
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setAttribute("normal", await slicedNormals(positions, index));
  return geometry;
};

export const createGround = ({
  renderer,
  shared,
  settings,
  land: landSettings,
  covers,
  shores,
  landCover,
  urls,
  loadTile,
  loadPixels,
  loadBytes,
  progress,
}) => {
  const scene = new THREE.Scene();
  const textureLoader = new THREE.TextureLoader();
  // A model's own files (its .bin and textures) are named relative to it; they
  // load from `models/<id>/…` through `urls.models` rather than beside the
  // .gltf, since hosted assets have no folders.
  const modelFile = "model-file:";
  const modelManager = new THREE.LoadingManager();
  modelManager.setURLModifier((url) =>
    url.startsWith(modelFile) ? urls.models(url.slice(modelFile.length)) : url,
  );
  const modelLoader = new GLTFLoader(modelManager);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const light = {
    uMoonLight: { value: 0 },
    uSunLight: { value: 0 },
    uHaze: { value: 2e-5 },
    uOverhead: { value: new THREE.Vector4() },
    uNightVision: { value: settings.nightVision },
    uCeiling: { value: settings.ceiling },
    uLamp: { value: 0 },
    uLampPos: { value: new THREE.Vector3() },
    uLampDir: { value: new THREE.Vector3(0, 0, -1) },
    uLampCone: { value: new THREE.Vector3(1, 1, 1) },
    uLampSpill: { value: 0 },
    // The lamp's own display curve: the light (nanolamberts) shown at half
    // brightness, and how the eye compresses it below that.
    uLampHalf: { value: settings.lampDisplay.halfLux * 1e5 },
    uLampPower: { value: settings.lampDisplay.power },
    uShadowMap: { value: null },
    uShadowFar: { value: null },
    uShadowMatrix: { value: null },
    uShadowFarMatrix: { value: null },
    uShadowOn: { value: 0 },
    uShadowBias: { value: new THREE.Vector2(...landSettings.shadows.bias) },
    uShadowTexel: {
      value: new THREE.Vector2(
        1 / landSettings.shadows.mapSize,
        1 / landSettings.shadows.mapSize,
      ),
    },
    uContactMap: { value: null },
    uContactCentre: { value: new THREE.Vector2() },
    uContactReach: { value: landSettings.contact.reach },
    uContactStrength: { value: landSettings.contact.strength },
  };
  const time = { value: 0 };

  // --- Shadows: the Moon's or the Sun's light blocked by trees, plants and
  // rocks, as depth maps seen from the light over squares around the walker: a
  // near one that everything is drawn into, fine enough for grass, and a far one
  // for the trees alone, whose shadows reach across a clearing. Each is drawn
  // again every `interval` seconds and as the walker moves, with each caster's
  // own shadow material standing in for it.
  const { shadows: shadowSettings } = landSettings;
  const shadowMap = (reach, treesOnly, slices) => {
    const target = () => {
      const made = new THREE.WebGLRenderTarget(
        shadowSettings.mapSize,
        shadowSettings.mapSize,
        {
          depthTexture: new THREE.DepthTexture(
            shadowSettings.mapSize,
            shadowSettings.mapSize,
            THREE.UnsignedIntType,
          ),
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
        },
      );
      made.depthTexture.minFilter = THREE.NearestFilter;
      made.depthTexture.magFilter = THREE.NearestFilter;
      return made;
    };
    return {
      reach,
      treesOnly,
      slices,
      // Two maps: one in use while the next is drawn, a slice of its casters a frame.
      targets: [target(), target()],
      shown: 0,
      slice: 0,
      groups: [],
      camera: new THREE.OrthographicCamera(
        -reach,
        reach,
        reach,
        -reach,
        1,
        shadowSettings.depth,
      ),
      matrix: new THREE.Matrix4(),
      next: new THREE.Matrix4(),
      drawn: new THREE.Vector3(Infinity, Infinity, Infinity),
      at: 0,
    };
  };
  const shadow = {
    near: shadowMap(shadowSettings.reach[0], false, shadowSettings.slices),
    far: shadowMap(shadowSettings.reach[1], true, 1),
    direction: new THREE.Vector3(0, -1, 0),
    direct: 0,
  };
  light.uShadowMap.value = shadow.near.targets[0].depthTexture;
  light.uShadowFar.value = shadow.far.targets[0].depthTexture;
  light.uShadowMatrix.value = shadow.near.matrix;
  light.uShadowFarMatrix.value = shadow.far.matrix;
  const shadowLightDir = { value: shadow.direction };
  const shadowPlantMaterial = (uniforms) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uMap: uniforms.uMap,
        uAlpha: uniforms.uAlpha,
        uUseAlpha: uniforms.uUseAlpha,
        uAlphaTest: uniforms.uAlphaTest,
        uSway: uniforms.uSway,
        uTime: time,
        ...windUniforms,
      },
      vertexShader: shadowPlantVertex,
      fragmentShader: shadowPlantFragment,
      side: THREE.DoubleSide,
    });
  const shadowTreeMaterial = (uniforms) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uMap: uniforms.uMap,
        uCard: uniforms.uCard,
        uTop: uniforms.uTop,
        uFrames: uniforms.uFrames,
        uReach: uniforms.uReach,
        uAppear: uniforms.uAppear,
        uTime: time,
        uTreeSway: uniforms.uTreeSway,
        ...windUniforms,
        ...flatUniforms,
        uLightDir: shadowLightDir,
      },
      vertexShader: shadowTreeVertex,
      fragmentShader: shadowTreeFragment,
      side: THREE.DoubleSide,
    });
  const lightSpace = new THREE.Vector3();
  const sideways = new THREE.Vector3();
  const upward = new THREE.Vector3();
  const trianglesOf = (mesh) =>
    ((mesh.geometry.index
      ? mesh.geometry.index.count
      : mesh.geometry.attributes.position.count) /
      3) *
    (mesh.count ?? 1);
  // Aims the map's camera from the light at the eye, its centre snapped to its
  // own texels so shadows hold still as the walker moves, and gathers the
  // casters into slices of about equal weight, one drawn each frame.
  const beginShadowMap = (map, eye) => {
    const { camera, reach } = map;
    camera.position
      .copy(eye)
      .addScaledVector(shadow.direction, shadowSettings.depth * 0.5);
    camera.up.set(0, 1, 0);
    camera.lookAt(eye);
    camera.updateMatrixWorld();
    const texel = (2 * reach) / shadowSettings.mapSize;
    lightSpace.copy(eye).applyMatrix4(camera.matrixWorldInverse);
    const dx = Math.round(lightSpace.x / texel) * texel - lightSpace.x;
    const dy = Math.round(lightSpace.y / texel) * texel - lightSpace.y;
    sideways.setFromMatrixColumn(camera.matrixWorld, 0);
    upward.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.position.addScaledVector(sideways, dx).addScaledVector(upward, dy);
    camera.updateMatrixWorld();
    map.next.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const casters = [];
    scene.traverse((object) => {
      if (!object.isMesh || !object.visible || !object.userData.shadowMaterial)
        return;
      if (map.treesOnly && object.userData.leafy === undefined) return;
      casters.push(object);
    });
    const total = casters.reduce((sum, mesh) => sum + trianglesOf(mesh), 0);
    map.groups = Array.from({ length: map.slices }, () => []);
    let filled = 0;
    casters.forEach((mesh) => {
      map.groups[
        Math.min(map.slices - 1, Math.floor((filled / total) * map.slices))
      ].push(mesh);
      filled += trianglesOf(mesh);
    });
  };
  const drawShadowMap = (renderer, map, eye, seconds) => {
    if (map.slice === 0) {
      const moved = eye.distanceTo(map.drawn) > (map.treesOnly ? 2 : 0.5);
      if (!moved && seconds - map.at < shadowSettings.interval) return;
      map.at = seconds;
      map.drawn.copy(eye);
      beginShadowMap(map, eye);
    }
    const back = map.targets[1 - map.shown];
    const swapped = [];
    scene.traverse((object) => {
      if (!object.isMesh) return;
      swapped.push([object, object.material, object.visible]);
      if (map.groups[map.slice].includes(object))
        object.material = object.userData.shadowMaterial;
      else object.visible = false;
    });
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(back);
    if (map.slice === 0) renderer.clear(true, true, false);
    renderer.render(scene, map.camera);
    renderer.setRenderTarget(was);
    swapped.forEach(([object, material, visible]) => {
      object.material = material;
      object.visible = visible;
    });
    map.slice += 1;
    if (map.slice < map.slices) return;
    // The new map is whole: it takes over from the one in use.
    map.slice = 0;
    map.shown = 1 - map.shown;
    map.matrix.copy(map.next);
    if (map.treesOnly) light.uShadowFar.value = back.depthTexture;
    else light.uShadowMap.value = back.depthTexture;
  };
  const castShadows = (renderer, eye, seconds) => {
    const on = shadow.direct > 0 && shadow.direction.y > 0.03;
    const wanted = on ? 1 : 0;
    if (light.uShadowOn.value !== wanted) light.uShadowOn.value = wanted;
    if (!on) return;
    drawShadowMap(renderer, shadow.near, eye, seconds);
    drawShadowMap(renderer, shadow.far, eye, seconds);
  };

  // --- Contact: the sky's light kept from the ground under every footing,
  // painted as soft discs on a map over a square around the walker, again
  // whenever they have moved `repaint` metres from where it was painted.
  const contact = {
    ...landSettings.contact,
    canvas: document.createElement("canvas"),
    disc: document.createElement("canvas"),
    texture: null,
    centre: new THREE.Vector2(Infinity, Infinity),
  };
  contact.canvas.width = contact.size;
  contact.canvas.height = contact.size;
  contact.disc.width = 64;
  contact.disc.height = 64;
  {
    const ctx = contact.disc.getContext("2d");
    const fill = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fill.addColorStop(0, "rgba(255,255,255,1)");
    fill.addColorStop(0.45, "rgba(255,255,255,0.75)");
    fill.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 64, 64);
  }
  contact.texture = new THREE.CanvasTexture(contact.canvas);
  contact.texture.minFilter = THREE.LinearFilter;
  contact.texture.magFilter = THREE.LinearFilter;
  contact.texture.generateMipmaps = false;
  light.uContactMap.value = contact.texture;
  const paintContact = (cx, cz) => {
    const { canvas, disc, reach, size, radius } = contact;
    // Painted over black, with the disc's cover as its brightness, so the map
    // needs no alpha (a canvas's clear pixels do not upload as zero).
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    const scale = size / (2 * reach);
    const draw = (x, z, r) => {
      const px = (x - cx + reach) * scale;
      const pz = (z - cz + reach) * scale;
      const d = r * scale;
      if (px < -d || pz < -d || px > size + d || pz > size + d) return;
      ctx.drawImage(disc, px - d, pz - d, 2 * d, 2 * d);
    };
    current.plants?.forEach(
      ({ userData: { stood, spots, footprint, sway } }) => {
        if (!stood) return;
        for (let i = 0, k = 0; k < stood.length; i += 1, k += 5) {
          if (Number.isNaN(stood[k + 2])) continue;
          const grown = spots[i].size;
          if (!grown) continue;
          draw(
            stood[k],
            stood[k + 1],
            footprint ? footprint * grown * radius.rock : grown * radius.plant,
          );
        }
      },
    );
    if (forest) {
      const { trunks, shift } = forest;
      for (const trunk of trunks.values())
        draw(
          trunk.x + shift.x,
          trunk.z + shift.z,
          radius.trunk + trunk.h * 0.025,
        );
    }
    contact.texture.needsUpdate = true;
    contact.centre.set(cx, cz);
    light.uContactCentre.value.set(cx, cz);
  };
  // Assists: trees can be taken away, and the land beyond the walker's
  // surroundings laid flat (out from `uFlatRange.x` metres, wholly by `.y`), so
  // mountains no longer stand in the way.
  const assist = { trees: true, flat: false };
  const flatUniforms = {
    uFlat: { value: 0 },
    uFlatLevel: { value: 0 },
    uFlatCentre: { value: new THREE.Vector2() },
    uFlatRange: { value: new THREE.Vector2(...landSettings.flatRange) },
    uCurve: { value: (1 - settings.refraction) / (2 * EARTH_RADIUS) },
  };
  // The wind on everything that grows: the way it blows, and its force with gusts.
  const windUniforms = {
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindForce: { value: 0 },
  };
  // Snow on the ground, shared by every terrain material: its cover close by and
  // to the far horizon (textures over the site's frame, each `uSnowSpan` metres
  // from its centre to its edge), its photograph once arrived, and how far it has
  // faded in.
  const noSnow = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  noSnow.needsUpdate = true;
  const snowUniforms = {
    uSnowNear: { value: noSnow },
    uSnowFar: { value: noSnow },
    uSnowSpan: { value: new THREE.Vector2(1, 1) },
    uSnowPhoto: { value: noSnow },
    uSnowBumps: { value: noSnow },
    uSnowReady: { value: 0 },
    uSnowSurface: { value: new THREE.Vector2(...covers.snow.surface) },
    uSnowAlbedo: { value: new THREE.Vector3(...covers.snow.farAlbedo) },
    uSnowOn: { value: 0 },
  };
  const curvature = (r) =>
    ((1 - settings.refraction) * r * r) / (2 * EARTH_RADIUS);

  // Photographs load once and are kept: `ready` resolves with each when it arrives.
  const textures = new Map();
  const texture = (path, color) => {
    if (!textures.has(path)) {
      let arrived;
      const ready = new Promise((resolve) => {
        arrived = resolve;
      });
      const map = textureLoader.load(
        path,
        () => arrived(map),
        undefined,
        () => arrived(null),
      );
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = maxAnisotropy;
      map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      textures.set(path, { map, ready });
    }
    return textures.get(path);
  };
  // A kind with two photographs shows them side by side on the land, picked by a
  // broad noise; the shader reads both from one picture, the first in the lower
  // half and the second in the upper, since the ground's shader has no texture
  // unit to spare for a second.
  const atlases = new Map();
  const atlas = (first, second, color) => {
    const key = `${first}|${second}|${color}`;
    if (!atlases.has(key)) {
      const a = texture(first, color);
      const b = texture(second, color);
      const ready = Promise.all([a.ready, b.ready]).then(([top, bottom]) => {
        if (!top || !bottom) return top ?? bottom;
        const width = Math.max(top.image.width, bottom.image.width);
        const height = Math.max(top.image.height, bottom.image.height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bottom.image, 0, 0, width, height);
        ctx.drawImage(top.image, 0, height, width, height);
        const map = new THREE.CanvasTexture(canvas);
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        map.anisotropy = maxAnisotropy;
        map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        map.needsUpdate = true;
        return map;
      });
      atlases.set(key, { ready });
    }
    return atlases.get(key);
  };
  const blank = new THREE.DataTexture(
    new Uint8Array([128, 128, 255, 255]),
    1,
    1,
  );
  const noise = noiseTexture();
  blank.needsUpdate = true;

  // Scanned models: every mesh at its node's transform, ready to instance.
  const models = new Map();
  const modelParts = (id) => {
    if (!models.has(id)) {
      models.set(
        id,
        modelLoader
          .setResourcePath(`${modelFile}${id}/`)
          .loadAsync(urls.models(`${id}/${id}.gltf`))
          .then((gltf) => {
            gltf.scene.updateMatrixWorld(true);
            const parts = [];
            gltf.scene.traverse((node) => {
              if (node.isMesh && !/LOD[12]/.test(node.name)) {
                parts.push({
                  name: node.name,
                  geometry: node.geometry
                    .clone()
                    .applyMatrix4(node.matrixWorld),
                  map: node.material.map,
                });
              }
            });
            return parts;
          }),
      );
    }
    return models.get(id);
  };

  // What the land around the site is like: its elevation, what covers it and
  // where its water lies. `classify` reads the cover and water; a walker's rebuilds
  // keep what was read when they set out, and skip it.
  const survey = async (site, { classify = true } = {}) => {
    const work = progress.phase("Reading the land");
    const counted =
      (load) =>
      (...args) => {
        work.add();
        return load(...args).finally(work.step);
      };
    const [near, far, sea] = await Promise.all([
      heightField(
        site,
        settings.nearZoom,
        settings.nearTiles,
        counted(loadTile),
      ),
      heightField(site, settings.farZoom, settings.farTiles, counted(loadTile)),
      seaMap(site, settings.outerRadius, landSettings, counted(loadPixels)),
    ]);
    // Elevation tiles give the sea floor; where the sea is, the ground is its
    // surface. Land below sea level (Death Valley, the Dead Sea) stays as it is.
    const raw = (x, z) => {
      const { latitude, longitude } = placeOf(site, x, z);
      const h =
        near.sample(latitude, longitude) ?? far.sample(latitude, longitude);
      return h !== null && h < 0 && sea(x, z) ? 0 : h;
    };
    const h0 = raw(0, 0) ?? 0;
    const cover = classify
      ? await readLand({
          site,
          raw,
          h0,
          settings: landSettings,
          covers,
          landCover,
          outerRadius: settings.outerRadius,
          load: counted(loadPixels),
          bytes: counted(loadBytes),
        })
      : null;
    return { site, near, raw, h0, cover, kind: cover?.kind ?? null };
  };

  const reflection = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
  });
  const waves = texture(urls.waves, false);
  const origin = { value: new THREE.Vector2() };
  // The sea: its mean level in the ground's frame (far below everything when
  // there is no sea), the tide on it, the way to the shore from the walker, and
  // the swash of its waves up the beach.
  const seaLevel = { value: -1e6 };
  const seaUniforms = {
    uSeaLevel: seaLevel,
    uTide: { value: 0 },
    uShoreDir: { value: new THREE.Vector2(0, 1) },
    uSwash: {
      value: new THREE.Vector3(
        landSettings.swash.height,
        landSettings.swash.period,
        landSettings.swash.wavelength,
      ),
    },
  };
  // Inland water is near still; the sea moves in longer, livelier waves.
  const waterMaterial = () =>
    new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        ...light,
        uReflection: { value: reflection.texture },
        uWaves: { value: waves.map },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: time,
        uRoughness: { value: new THREE.Vector2(0.06, 0.22) },
        uWaveScale: { value: new THREE.Vector2(6, 14) },
        uFlow: { value: new THREE.Vector2(0, 0) },
        uOrigin: origin,
        ...seaUniforms,
      },
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      // Shallow water at the shore lets the sand show through.
      transparent: true,
    });

  // The land's detailed kinds of ground, a slot each. A photograph that has not
  // arrived shows its kind's color from afar, then fades in.
  const kindOf = (slot) =>
    slot.startsWith("shore:") ? shores[slot.slice(6)] : covers[slot];
  const terrainMaterial = (slots) => {
    const uniforms = {
      ...shared,
      ...light,
      ...flatUniforms,
      ...snowUniforms,
      uTile: { value: new THREE.Vector4(1, 1, 1, 1) },
      uFarPatch: { value: new THREE.Vector2(...landSettings.farPatch) },
      uFarBreakup: { value: landSettings.farBreakup },
      uNearRelief: { value: new THREE.Vector3(...landSettings.nearRelief) },
      uNoise: { value: noise },
      uMidDetail: { value: new THREE.Vector2(...landSettings.midDetail) },
      uSlotAlbedo: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uPair: { value: new THREE.Vector4() },
      uSlotShine: { value: new THREE.Vector4() },
      uSlotPools: { value: new THREE.Vector4() },
      uSlotSparkle: { value: new THREE.Vector4() },
      uReady: { value: new THREE.Vector4() },
      uOrigin: origin,
      ...windUniforms,
    };
    const loads = [];
    const work = progress.phase("Laying the ground");
    uniforms.uShoreMask = {
      value: new THREE.Vector4(
        ...[0, 1, 2, 3].map((i) => (slots[i] === "shore:ocean" ? 1 : 0)),
      ),
    };
    uniforms.uFieldSlot = {
      value: new THREE.Vector4(
        ...[0, 1, 2, 3].map((i) => (slots[i] === "cropland" ? 1 : 0)),
      ),
    };
    Object.assign(uniforms, seaUniforms);
    uniforms.uFieldSize = { value: landSettings.fieldSize };
    [0, 1, 2, 3].forEach((i) => {
      const kind = kindOf(slots[i] ?? slots.find(Boolean));
      uniforms[`uMap${i}`] = { value: blank };
      uniforms[`uNormal${i}`] = { value: blank };
      uniforms.uTile.value.setComponent(i, kind.tileSize);
      uniforms.uSlotAlbedo.value[i].set(...kind.farAlbedo);
      const [shine = 0, sparkle = 0, pools = 0] = kind.surface ?? [];
      uniforms.uSlotShine.value.setComponent(i, shine);
      uniforms.uSlotSparkle.value.setComponent(i, sparkle);
      uniforms.uSlotPools.value.setComponent(i, pools);
      if (!slots[i]) return;
      const pair = (file, color) =>
        kind.second
          ? atlas(
              urls.ground(`${kind.texture}/${file}`),
              urls.ground(`${kind.second}/${file}`),
              color,
            )
          : texture(urls.ground(`${kind.texture}/${file}`), color);
      const map = pair("diffuse.jpg", true);
      const bumps = pair("normal.jpg", false);
      uniforms.uPair.value.setComponent(i, kind.second ? 1 : 0);
      work.add(2);
      map.ready.finally(work.step);
      bumps.ready.finally(work.step);
      loads.push(
        Promise.all([map.ready, bumps.ready]).then(([m, b]) => {
          if (!m || !b) return;
          uniforms[`uMap${i}`].value = m;
          uniforms[`uNormal${i}`].value = b;
          const fade = { value: 0 };
          gsap.to(fade, {
            value: 1,
            duration: 0.9,
            ease: "power1.out",
            onUpdate: () => uniforms.uReady.value.setComponent(i, fade.value),
          });
        }),
      );
    });
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
    });
    return { material, loads };
  };

  const plantMaterial = (map, sway, alphaTest, alpha = null) =>
    new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        ...light,
        uMap: { value: map },
        uAlpha: { value: alpha ?? blank },
        uUseAlpha: { value: alpha ? 1 : 0 },
        ...windUniforms,
        uTime: time,
        uSway: { value: sway },
        uAlphaTest: { value: alphaTest },
      },
      vertexShader: plantVertex,
      fragmentShader: plantFragment,
      side: THREE.DoubleSide,
    });

  // Scatter a model's meshes as instances on a square tile that repeats across
  // the land, so plants and rocks surround a walker wherever they go. `follow`
  // places the copy of the tile around the walker; the tile is as dense as the
  // ring it fills and fades out toward its edge.
  const cutoutOf = (model) => {
    const cut = texture(
      urls.models(`${model}/textures/${model}_alpha_1k.jpg`),
      false,
    );
    // As glTF textures are: first row at v = 0.
    cut.map.flipY = false;
    return cut.ready;
  };
  // `parts` keeps only the model's pieces whose names match (its small tufts, say).
  const scatter = async (
    {
      model,
      parts: wanted = null,
      count,
      radius,
      scale,
      sway = 0,
      alpha = false,
    },
    random,
  ) => {
    const [all, cut] = await Promise.all([
      modelParts(model),
      alpha ? cutoutOf(model) : null,
    ]);
    const parts = wanted ? all.filter(({ name }) => wanted.test(name)) : all;
    const [inner, outer] = Array.isArray(radius) ? radius : [1.3, radius];
    const tile = outer * 2;
    const total = Math.round(
      (count * tile * tile) / (Math.PI * (outer * outer - inner * inner)),
    );
    const spots = Array.from({ length: total }, () => ({
      x: (random() - 0.5) * tile,
      z: (random() - 0.5) * tile,
      turn: random() * Math.PI * 2,
      size: scale[0] + random() * (scale[1] - scale[0]),
      part: Math.floor(random() * parts.length),
    })).filter((spot) => Math.hypot(spot.x, spot.z) >= inner);
    return parts.map(({ geometry, map }, index) => {
      const mine = spots.filter((spot) => spot.part === index);
      const alphaTest = cut ? 0.5 : sway > 0 ? 0.45 : 0;
      const mesh = new THREE.InstancedMesh(
        geometry,
        plantMaterial(map, sway, alphaTest, cut),
        Math.max(mine.length, 1),
      );
      mesh.count = mine.length;
      mesh.userData.shadowMaterial = shadowPlantMaterial(
        mesh.material.uniforms,
      );
      mesh.frustumCulled = false;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      // Rocks are solid: a walker stops at their footprint.
      const footprint =
        sway > 0
          ? 0
          : ((box.max.x - box.min.x + box.max.z - box.min.z) / 4) * 0.8;
      mesh.userData = {
        ...mesh.userData,
        spots: mine,
        tile,
        outer,
        footprint,
        sway,
      };
      return mesh;
    });
  };

  // Trees: each kind's pictures and size, loaded once.
  const treeKinds = new Map();
  const treeKind = (id) => {
    if (!treeKinds.has(id)) {
      const picture = texture(urls.trees(`${id}.png`), true);
      picture.map.wrapS = THREE.ClampToEdgeWrapping;
      picture.map.wrapT = THREE.ClampToEdgeWrapping;
      // Cards are seen face on; filtering along them buys nothing.
      picture.map.anisotropy = 1;
      const size = fetch(urls.trees(`${id}.json`)).then((response) =>
        response.json(),
      );
      treeKinds.set(
        id,
        Promise.all([size, picture.ready])
          .then(([card, map]) => (map ? { card, map } : null))
          .catch(() => null),
      );
    }
    return treeKinds.get(id);
  };
  const treeMaterial = ({ card, map }) => {
    const { rings, fade, albedo } = landSettings.trees;
    const radius = rings[rings.length - 1][0];
    // The pictures are all one shape; the card is cut down to the tree's own height,
    // so a low, wide tree is not drawn on a tall card that is mostly clear.
    const top = Math.min(
      1,
      (card.height + card.groundOffset * 3) / card.cardHeight,
    );
    return new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        ...light,
        uMap: { value: map },
        uCard: {
          value: new THREE.Vector3(
            card.cardWidth,
            card.cardHeight * top,
            card.groundOffset,
          ),
        },
        uTop: { value: top },
        uFrames: { value: card.frames },
        uReach: { value: new THREE.Vector2(radius * fade, radius) },
        uAlbedo: { value: albedo },
        uAppear: { value: 0 },
        ...flatUniforms,
        ...windUniforms,
        uTime: time,
        uTreeSway: { value: landSettings.trees.sway },
      },
      vertexShader: treeVertex,
      fragmentShader: treeFragment,
      side: THREE.DoubleSide,
    });
  };

  // Trees across the land around the centre: each kind of land grows its own, as
  // many as it holds where it lies. Each cell of the land itself (not of the
  // ground's frame) draws its tree from fixed random numbers, so a walker's
  // rebuilds find the same trees where they stood. Built a slice at a time.
  const treeCard = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const plantTrees = async (land, slots, weights, surfaceAt) => {
    const { rings, clearing, treeline } = landSettings.trees;
    const latitude = Math.abs(land.site.latitude);
    // Beyond the polar treeline nothing grows taller than a shrub.
    if (latitude > treeline.latitude) return null;
    const [highest, from, perDegree] = treeline.elevation;
    const treelineHeight = highest - Math.max(0, latitude - from) * perDegree;
    // Each kind of tree keeps to its latitudes and to its part of the world.
    const region = regionOf(land.site);
    const grows = (kind) =>
      (!kind.latitudes ||
        (latitude >= kind.latitudes[0] && latitude <= kind.latitudes[1])) &&
      (!kind.regions || kind.regions.includes(region));
    const specs = slots.map((slot) => {
      const spec = slot && kindOf(slot)?.trees;
      const kinds = spec?.kinds.filter(grows) ?? [];
      return kinds.length ? { density: spec.density, kinds } : null;
    });
    if (!specs.some(Boolean)) return null;
    const ids = [
      ...new Set(
        specs.flatMap((spec) => spec?.kinds.map((kind) => kind.id) ?? []),
      ),
    ];
    const winters = new Map(
      specs.flatMap(
        (spec) =>
          spec?.kinds
            .filter((kind) => kind.winter)
            .map((kind) => [kind.id, kind.winter]) ?? [],
      ),
    );
    const loaded = new Map(
      await Promise.all(ids.map(async (id) => [id, await treeKind(id)])),
    );
    const [ox, oz] = land.offset;
    const placed = new Map(ids.map((id) => [id, []]));
    const trunks = new Map();
    let started = performance.now();
    // Ring by ring, from the cells close by to the coarse ones toward the horizon;
    // each ring's cells draw their own random numbers, so the rings never line up.
    for (let ring = 0; ring < rings.length; ring += 1) {
      const [radius, cell] = rings[ring];
      const from = ring ? rings[ring - 1][0] : 0;
      const share = (cell * cell) / 10000;
      const seed = ring * 16;
      for (
        let i = Math.floor((ox - radius) / cell);
        i <= Math.ceil((ox + radius) / cell);
        i += 1
      ) {
        for (
          let j = Math.floor((oz - radius) / cell);
          j <= Math.ceil((oz + radius) / cell);
          j += 1
        ) {
          const x = (i + cellRandom(i, j, seed + 1)) * cell - ox;
          const z = (j + cellRandom(i, j, seed + 2)) * cell - oz;
          const r = Math.hypot(x, z);
          if (r > radius || r < from) continue;
          // The clearing stays where the observer was set down, wherever they walk.
          const open = smoothstepJs(
            clearing[0],
            clearing[1],
            Math.hypot(x + ox, z + oz),
          );
          if (open === 0) continue;
          // Fewer toward the mountain treeline, none above it.
          const altitude = land.raw(x, z) ?? 0;
          const below = smoothstepJs(
            treelineHeight,
            treelineHeight - treeline.band,
            altitude,
          );
          if (below === 0) continue;
          // Which kind of land's tree, if any: each has its chance by how much of it lies here.
          const weight = weights(x, z);
          let u = cellRandom(i, j, seed) / (open * below);
          let spec = null;
          for (let s = 0; s < 4 && !spec; s += 1) {
            if (!specs[s]) continue;
            const chance = specs[s].density * share * weight[s];
            if (u < chance) spec = specs[s];
            else u -= chance;
          }
          if (!spec) continue;
          const kind =
            spec.kinds[
              Math.floor(cellRandom(i, j, seed + 3) * spec.kinds.length)
            ];
          const tree = loaded.get(kind.id);
          const y = tree ? surfaceAt(x, z) : null;
          if (y === null) continue;
          const height =
            kind.height[0] +
            cellRandom(i, j, seed + 4) * (kind.height[1] - kind.height[0]);
          placed.get(kind.id).push({
            x,
            y,
            z,
            r,
            size: height / tree.card.height,
            turn: cellRandom(i, j, seed + 5) * Math.PI * 2,
            // No two trees of a kind alike: some mirrored, each a little warmer or
            // cooler, paler or darker, broader or narrower than its picture.
            mirror: cellRandom(i, j, seed + 6) < 0.5 ? -1 : 1,
            tint: (cellRandom(i, j, seed + 7) - 0.5) * 2,
            shade: 0.82 + cellRandom(i, j, seed + 8) * 0.36,
            breadth: 0.88 + cellRandom(i, j, seed + 9) * 0.24,
          });
          // Only the trees close by have trunks to walk into.
          if (ring === 0)
            trunks.set(`${i},${j}`, {
              x,
              y,
              z,
              h: height,
              r: clamp(height * 0.012, 0.12, 0.45),
            });
        }
        if (performance.now() - started > SLICE_MS) {
          await nextSlice();
          started = performance.now();
        }
      }
    }
    const meshes = [];
    const place = new THREE.Matrix4();
    for (const [id, spots] of placed) {
      if (!spots.length) continue;
      // Nearest first, so the nearer trees hide the farther before they are drawn.
      spots.sort((a, b) => a.r - b.r);
      const geometry = treeCard.clone();
      const turns = new Float32Array(spots.length);
      const varies = new Float32Array(spots.length * 4);
      for (let k = 0; k < spots.length; k += 1) {
        turns[k] = spots[k].turn;
        varies.set(
          [spots[k].mirror, spots[k].tint, spots[k].shade, spots[k].breadth],
          k * 4,
        );
      }
      geometry.setAttribute(
        "aTurn",
        new THREE.InstancedBufferAttribute(turns, 1),
      );
      geometry.setAttribute(
        "aVary",
        new THREE.InstancedBufferAttribute(varies, 4),
      );
      const mesh = new THREE.InstancedMesh(
        geometry,
        treeMaterial(loaded.get(id)),
        spots.length,
      );
      mesh.userData = {
        leafy: loaded.get(id).map,
        winter: winters.get(id) ?? null,
        shadowMaterial: shadowTreeMaterial(mesh.material.uniforms),
      };
      // Tens of thousands of trees: their places are written a slice at a time too.
      for (let k = 0; k < spots.length; k += 1) {
        const spot = spots[k];
        mesh.setMatrixAt(
          k,
          place
            .makeScale(spot.size, spot.size, spot.size)
            .setPosition(spot.x, spot.y - 0.1, spot.z),
        );
        if ((k & 1023) === 1023 && performance.now() - started > SLICE_MS) {
          await nextSlice();
          started = performance.now();
        }
      }
      mesh.frustumCulled = false;
      meshes.push(mesh);
    }
    // Land whose kinds grow trees may still hold none here (a desert's scrub, say).
    if (!meshes.length) return null;
    // Trunks stop a walker. `shift` is how far the ground's frame has moved since.
    return { meshes, trunks, offset: [ox, oz], shift: new THREE.Vector3() };
  };
  let forest = null;
  // Broadleaf trees bare or in leaf, by the season at the site.
  let leafless = false;
  const dressTrees = () => {
    forest?.meshes.forEach(async (mesh) => {
      const { leafy, winter } = mesh.userData;
      if (!winter) return;
      const bare = leafless ? await treeKind(winter) : null;
      mesh.material.uniforms.uMap.value = bare?.map ?? leafy;
    });
  };
  const leafOffAt = (latitude, date) => {
    const { latitude: from, from: starts, to: ends } = landSettings.leafOff;
    const away = Math.abs(latitude);
    if (away < from) return false;
    const month = Number(date.slice(5, 7));
    const season = latitude < 0 ? ((month + 5) % 12) + 1 : month;
    const pick = (pairs) => pairs.filter(([at]) => away >= at).at(-1)[1];
    return season >= pick(starts) || season <= pick(ends);
  };
  const trunkNear = (x, z, radius) => {
    if (!forest || !assist.trees) return false;
    const [[, cell]] = landSettings.trees.rings;
    const fx = x - forest.shift.x;
    const fz = z - forest.shift.z;
    const ci = Math.floor((fx + forest.offset[0]) / cell);
    const cj = Math.floor((fz + forest.offset[1]) / cell);
    for (let i = ci - 1; i <= ci + 1; i += 1) {
      for (let j = cj - 1; j <= cj + 1; j += 1) {
        const trunk = forest.trunks.get(`${i},${j}`);
        if (trunk && Math.hypot(fx - trunk.x, fz - trunk.z) < trunk.r + radius)
          return true;
      }
    }
    return false;
  };

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const wrap = (v, tile) => v - tile * Math.round(v / tile);
  // (cx, cz): the walker in the ground's frame; (px, pz): how far they have walked
  // from where the ground was first built, the frame the tile is anchored to.
  let followed = null;
  const placeAt = new THREE.Vector3();
  const sizeAt = new THREE.Vector3();
  const follow = (cx, cz, px, pz) => {
    flatUniforms.uFlatCentre.value.set(cx, cz);
    flatUniforms.uFlatLevel.value =
      current.surfaceAt(cx, cz) ?? flatUniforms.uFlatLevel.value;
    const key = [cx, cz, px, pz, current];
    if (followed?.every((v, i) => v === key[i])) return;
    const fresh = !followed || (followed[4] !== current && !current.shifted);
    followed = key;
    obstacles.length = 0;
    current.plants.forEach((mesh) => {
      const { spots, tile, outer, footprint, sway } = mesh.userData;
      // Where each plant last stood (x, z), the ground's height there, how much of
      // its kind of ground lies there and the snow: a plant keeps its place in the
      // ground's frame as the walker moves, so this is worked out again only for
      // the ones that wrap round the tile, or when the ground itself is new.
      const stood = (mesh.userData.stood ??= new Float64Array(
        spots.length * 5,
      ).fill(NaN));
      spots.forEach((spot, i) => {
        const wx = wrap(spot.x - px, tile);
        const wz = wrap(spot.z - pz, tile);
        const x = cx + wx;
        const z = cz + wz;
        const k = i * 5;
        if (
          fresh ||
          Math.abs(stood[k] - x) > 1e-4 ||
          Math.abs(stood[k + 1] - z) > 1e-4
        ) {
          const y = current.surfaceAt(x, z);
          stood[k] = x;
          stood[k + 1] = z;
          stood[k + 2] = y === null ? NaN : y;
          stood[k + 3] = current.weights(x, z)[mesh.userData.slot ?? 0];
          stood[k + 4] = snowAt(x, z);
        }
        const y = stood[k + 2];
        // Each grows only where its kind of ground lies, fading toward the tile's
        // edge; snow buries what grows low, while rocks stand out of it.
        const fade = Number.isNaN(y)
          ? 0
          : smoothstepJs(outer, outer * 0.8, Math.hypot(wx, wz)) *
            smoothstepJs(0.25, 0.6, stood[k + 3]) *
            (sway > 0 ? 1 - smoothstepJs(0.3, 0.7, stood[k + 4]) : 1);
        const size = spot.size * fade;
        rotation.setFromAxisAngle(up, spot.turn);
        matrix.compose(
          placeAt.set(x, (Number.isNaN(y) ? 0 : y) - 0.03, z),
          rotation,
          sizeAt.set(size, size, size),
        );
        mesh.setMatrixAt(i, matrix);
        if (footprint && fade > 0.5)
          obstacles.push({ x, z, r: footprint * size });
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (
      fresh ||
      Math.hypot(cx - contact.centre.x, cz - contact.centre.y) > contact.repaint
    )
      paintContact(cx, cz);
  };
  const obstacles = [];

  // Snow on the date at the site, read and laid on the land as it arrives.
  let snow = null;
  let snowRequest = 0;
  let snowPlace = null;
  const snowAt = (x, z) =>
    snow
      ? snow.at(
          x + (current.land?.offset[0] ?? 0),
          z + (current.land?.offset[1] ?? 0),
        )
      : 0;
  const snowTexture = ({ n, values }) => {
    const texture = new THREE.DataTexture(
      Uint8Array.from(values, (v) => Math.round(v * 255)),
      n,
      n,
      THREE.RedFormat,
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };
  const setSnow = async (site, date) => {
    const mine = ++snowRequest;
    // A new place shows no snow until its own arrives and fades in; another night
    // at the same place just changes.
    const place = `${site.latitude},${site.longitude}`;
    if (place !== snowPlace) {
      snowPlace = place;
      gsap.killTweensOf(snowUniforms.uSnowOn);
      snowUniforms.uSnowOn.value = 0;
      snow = null;
    }
    leafless = leafOffAt(site.latitude, date);
    dressTrees();
    const work = progress.phase("Reading the snow");
    work.add();
    const read = await readSnow({
      site,
      date,
      settings: landSettings.snow,
      outerRadius: settings.outerRadius,
      gibs: landSettings.gibs,
      bytes: loadBytes,
      progress: work,
    }).finally(work.step);
    if (mine !== snowRequest) return null;
    [snowUniforms.uSnowNear, snowUniforms.uSnowFar].forEach((u) => {
      if (u.value !== noSnow) u.value.dispose();
    });
    snow = read;
    snowUniforms.uSnowNear.value = snowTexture(read.near);
    snowUniforms.uSnowFar.value = snowTexture(read.far);
    snowUniforms.uSnowSpan.value.set(read.near.radius, read.far.radius);
    followed = null;
    gsap.to(snowUniforms.uSnowOn, {
      value: 1,
      duration: 1.2,
      ease: "power1.out",
    });
    // The photograph of snow, only once there is snow to show.
    if (read.any && snowUniforms.uSnowPhoto.value === noSnow) {
      const photo = texture(
        urls.ground(`${covers.snow.texture}/diffuse.jpg`),
        true,
      );
      const bumps = texture(
        urls.ground(`${covers.snow.texture}/normal.jpg`),
        false,
      );
      Promise.all([photo.ready, bumps.ready]).then(([map, normal]) => {
        if (!map) return;
        snowUniforms.uSnowPhoto.value = map;
        if (normal) snowUniforms.uSnowBumps.value = normal;
        gsap.to(snowUniforms.uSnowReady, {
          value: 1,
          duration: 0.9,
          ease: "power1.out",
        });
      });
    }
    return read;
  };

  const clear = (keep = []) => {
    scene.children
      .slice()
      .filter((child) => !keep.includes(child))
      .forEach((child) => {
        scene.remove(child);
        child.geometry?.dispose();
      });
  };

  let current = {
    water: null,
    plants: [],
    land: null,
    surfaceAt: () => 0,
    weights: () => [1, 0, 0, 0],
  };
  // Wind (km/h at 10 m, and the compass direction it blows from) pushes as
  // about its speed to the 1.5 power; plants hardly stir in calm air.
  let wind = 0;
  let windDirection = 0;
  let windForce = 0;
  const setWind = (speed, direction = windDirection) => {
    wind = speed;
    windDirection = direction;
    windForce = Math.min(
      (Math.max(speed, 0) / settings.windForceAt) ** 1.5,
      settings.windForceMax,
    );
    const toward = ((direction + 180) * Math.PI) / 180;
    windUniforms.uWindDir.value.set(Math.sin(toward), -Math.cos(toward));
  };
  // Gusts come and go over tens of seconds, with quicker puffs inside them.
  const gust = (t) =>
    1 + 0.35 * wanderJs(t * 0.12, 1) + 0.18 * wanderJs(t * 0.7, 2);
  let request = 0;
  const size = new THREE.Vector2(1, 1);

  // Build the ground for a site; `kind` forces one kind of land everywhere instead
  // of reading the region. `walked` rebuilds the land around a walker whose new
  // centre is [dx, dz] from the old one: it keeps the land read when they set out,
  // its plants and rocks, and is not levelled, so nothing shifts under their feet.
  const setSite = async (site, kind = null, { walked = null } = {}) => {
    const mine = ++request;
    const before = current;
    const surveyed = await survey(site, { classify: !walked });
    if (mine !== request) return null;
    const land = { ...surveyed };
    if (walked) {
      land.cover = before.land.cover;
      land.kind = before.land.kind;
      land.offset = [
        before.land.offset[0] + walked[0],
        before.land.offset[1] + walked[1],
      ];
      land.origin = before.land.origin;
    } else {
      land.offset = [0, 0];
      land.origin = surveyed.h0;
    }
    const { cover } = land;
    const forced = covers[kind] ? kind : null;
    const view = cover.view(
      land.offset[0],
      land.offset[1],
      land.h0 - land.origin,
    );
    const slots = forced
      ? [forced, null, null, cover.slots[3] ?? null]
      : cover.slots;
    const weights = forced
      ? (x, z) => {
          const shore = cover.slots[3]?.startsWith("shore:")
            ? view.weights(x, z)[3]
            : 0;
          return [1 - shore, 0, 0, shore];
        }
      : view.weights;
    land.dominant = forced ?? cover.dominant;
    if (forced && !cover.shore) land.kind = forced;
    origin.value.set(land.offset[0], land.offset[1]);

    const level = !walked;
    const flat = (r) =>
      level
        ? smoothstepJs(
            settings.flatRadius,
            settings.flatRadius + settings.flatBlend,
            r,
          )
        : 1;
    // The land, carved where water lies: the sea floor well down, inland water
    // shelving from its edge.
    // Each vertex's water, worked out once while the meshes are built.
    const waters = [];
    const heightAt = (x, z, r, vertex) => {
      const water =
        vertex === undefined
          ? view.water(x, z)
          : (waters[vertex] ??= view.water(x, z));
      const h = land.raw(x, z);
      let rel = h === null ? 0 : (h - land.h0) * flat(r);
      // The shore of the sea is shaped by its distance to the water: a beach
      // sloping down to the water's edge, and the sea floor falling away beyond
      // it, so the tide and the waves can run up and down the sand.
      const { beach: shape } = landSettings;
      if (
        water.level !== null &&
        water.coast < shape.reach &&
        (water.sea > 0.001 || water.coast < shape.reach)
      ) {
        const { coast } = water;
        const profile =
          coast >= 0
            ? water.level + 0.03 + coast * shape.slope
            : Math.max(
                water.level - shape.depth,
                water.level - 0.03 + coast * shape.floor,
              );
        const blend = smoothstepJs(shape.reach * 0.6, shape.reach, coast);
        rel = Math.min(rel, profile) * (1 - blend) + rel * blend;
        if (coast < -shape.depth / shape.floor) rel = water.level - shape.depth;
      } else if (water.fraction > 0.5 && water.level !== null) {
        const t = smoothstepJs(0.5, 0.85, water.fraction);
        rel = rel * (1 - t) + Math.min(rel, water.level - water.depth) * t;
      }
      return rel - curvature(r);
    };
    const terrainLook = terrainMaterial(slots);
    const terrainMesh = new THREE.Mesh(
      await radialGeometry(settings, heightAt, {
        aCover: [
          4,
          (x, z, r, i) =>
            forced ? weights(x, z) : view.weightsWith(x, z, waters[i]),
          8,
        ],
        aFar: [3, (x, z) => view.color(x, z), 16],
      }),
      terrainLook.material,
    );
    const random = seededRandom(
      Math.abs(site.latitude * 1e5 + site.longitude * 1e3),
    );
    const surfaceAt = (x, z) => {
      const y = heightAt(x, z, Math.hypot(x, z));
      const water = view.water(x, z);
      return water.fraction > 0.55 &&
        water.level !== null &&
        y < water.level + 0.05
        ? null
        : y;
    };

    // Water, drawn wherever the land holds it; out to the far horizon if the sea is in view.
    const surfaceWaters = [];
    const farSea = Array.from({ length: 36 }, (_, a) =>
      [8000, 20000, 50000, 100000].some(
        (r) =>
          view.water(r * Math.sin(a / 5.73), -r * Math.cos(a / 5.73)).sea > 0.5,
      ),
    ).some(Boolean);
    // The sea's level, from the nearest sea the water grid holds, or the far sea.
    seaLevel.value = -1e6;
    for (let r = 20; r < 6000 && seaLevel.value < -1e5; r *= 1.25) {
      for (let a = 0; a < 24 && seaLevel.value < -1e5; a += 1) {
        const w = view.water(r * Math.sin(a / 3.82), -r * Math.cos(a / 3.82));
        if (w.sea > 0.5 && w.level !== null) {
          seaLevel.value = w.level;
          seaUniforms.uShoreDir.value.set(
            Math.sin(a / 3.82),
            -Math.cos(a / 3.82),
          );
        }
      }
    }
    const waterMesh =
      cover.anyWater || farSea
        ? new THREE.Mesh(
            await radialGeometry(
              {
                ...settings,
                rings: farSea ? settings.rings : 90,
                segments: farSea ? settings.segments : 360,
                outerRadius: farSea
                  ? settings.outerRadius
                  : landSettings.waterRadius,
              },
              (x, z, r, i) => {
                const water = (surfaceWaters[i] = view.water(x, z));
                return (water.level ?? heightAt(x, z, r) - 2) - curvature(r);
              },
              {
                aWater: [1, (x, z, r, i) => [surfaceWaters[i].fraction], 8],
                aSea: [1, (x, z, r, i) => [surfaceWaters[i].sea], 8],
                // How far from the shore (metres, negative out at sea), over -100 to 100.
                aCoast: [
                  1,
                  (x, z, r, i) => [surfaceWaters[i].coast / 200 + 0.5],
                  16,
                ],
              },
            ),
            waterMaterial(),
          )
        : null;
    waterMesh?.material.uniforms.uResolution.value.copy(size);
    // A newer request may have begun while these were built.
    if (mine !== request) {
      terrainMesh.geometry.dispose();
      waterMesh?.geometry.dispose();
      return null;
    }

    // A walker keeps the trees they walk among, moved into the new frame, until
    // the trees around the new centre are ready.
    const standing = walked && forest ? forest : null;
    if (standing) {
      standing.shift.x -= walked[0];
      standing.shift.z -= walked[1];
      standing.shift.y -= land.h0 - before.land.h0;
      standing.meshes.forEach((mesh) => mesh.position.copy(standing.shift));
    }
    const kept = walked ? [...before.plants, ...(standing?.meshes ?? [])] : [];
    clear(kept);
    if (!standing) forest = null;
    scene.add(terrainMesh, ...(waterMesh ? [waterMesh] : []), ...kept);
    // A walker's plants keep their footings, moved into the new frame, whose ground
    // stands `dh` higher; only the ones that wrap round their tile are read again.
    if (walked) {
      const dh = land.h0 - before.land.h0;
      before.plants.forEach(({ userData: { stood } }) => {
        if (!stood) return;
        for (let k = 0; k < stood.length; k += 5) {
          stood[k] -= walked[0];
          stood[k + 1] -= walked[1];
          stood[k + 2] -= dh;
        }
      });
    }
    current = {
      water: waterMesh,
      plants: walked ? before.plants : [],
      land,
      slots,
      weights,
      surfaceAt,
      heightAt,
      shifted: Boolean(walked),
    };

    // Trees, and the plants and rocks close by, arrive after the land, where their
    // kind of ground lies. The trees reach far beyond a walker's rebuilds, so they
    // are planted again only once the walker is well away from where they were.
    const growing = walked
      ? []
      : slots.flatMap((slot, index) =>
          slot
            ? (kindOf(slot).growth ?? []).map((spec) => ({ spec, index }))
            : [],
        );
    const replant =
      !standing ||
      Math.hypot(standing.shift.x, standing.shift.z) >
        landSettings.trees.replantAfter;
    const work = progress.phase("Placing trees and plants");
    work.add(growing.length + (replant ? 1 : 0));
    if (replant)
      plantTrees(land, slots, weights, surfaceAt)
        .then((grown) => {
          work.step();
          if (mine !== request) {
            grown?.meshes.forEach((mesh) => mesh.geometry.dispose());
            return;
          }
          forest?.meshes.forEach((mesh) => {
            scene.remove(mesh);
            mesh.geometry.dispose();
          });
          forest = grown;
          if (!grown) return;
          grown.meshes.forEach((mesh) => {
            mesh.visible = assist.trees;
          });
          dressTrees();
          scene.add(...grown.meshes);
          if (Number.isFinite(contact.centre.x))
            paintContact(contact.centre.x, contact.centre.y);
          grown.meshes.forEach(({ material }) => {
            // Trees a walker already stood among are there at once; new ones grow in.
            if (standing) material.uniforms.uAppear.value = 1;
            else
              gsap.to(material.uniforms.uAppear, {
                value: 1,
                duration: 1.4,
                ease: "power1.out",
              });
          });
        })
        .catch((error) => console.error(error));
    if (walked) {
      setWind(wind);
      return land;
    }
    Promise.all(
      growing.map(({ spec, index }) =>
        scatter(spec, random)
          .then((meshes) => {
            meshes.forEach((mesh) => {
              mesh.userData.slot = index;
            });
            return meshes;
          })
          .finally(work.step),
      ),
    )
      .then((sets) => {
        if (mine !== request) return;
        const plants = sets.flat();
        if (plants.length) scene.add(...plants);
        current.plants = plants;
        followed = null;
        setWind(wind);
      })
      .catch((error) => console.error(error));
    return land;
  };

  return {
    scene,
    reflection,
    setSite,
    setSnow,
    // How much snow lies at (x, z) in the ground's frame (0 to 1).
    snowAt,
    get water() {
      return current.water;
    },
    get kind() {
      return current.land?.kind ?? null;
    },
    get land() {
      return current.land;
    },
    // Height of the walkable ground (metres, relative to its centre), or null over water.
    surfaceAt: (x, z) => current.surfaceAt(x, z),
    // The highest the land rises (radians above level) looking toward azimuth
    // (radians from north) from eyes at (x, eye, z), out to the far horizon.
    horizonAt: (x, z, eye, azimuth) => {
      if (!current.heightAt) return 0;
      const east = Math.sin(azimuth);
      const north = -Math.cos(azimuth);
      let best = -Math.PI / 2;
      for (let r = 3; r < settings.outerRadius; r *= 1.07) {
        const px = x + east * r;
        const pz = z + north * r;
        const from = Math.hypot(px, pz);
        let h = current.heightAt(px, pz, from);
        if (assist.flat) {
          const [near, far] = landSettings.flatRange;
          h +=
            (flatUniforms.uFlatLevel.value - curvature(from) - h) *
            smoothstepJs(near, far, r);
        }
        best = Math.max(best, Math.atan2(h - eye, r));
      }
      return best;
    },
    // Whether trees stand in the way looking toward azimuth (radians from north)
    // at altitude (radians) from eyes at (x, eye, z): the line of sight passes
    // through a crown (a column a fifth of the tree's height across).
    treesAbove: (x, z, eye, azimuth, altitude) => {
      if (!forest || !assist.trees) return false;
      const [[radius, cell]] = landSettings.trees.rings;
      const east = Math.sin(azimuth);
      const north = -Math.cos(azimuth);
      const rise = Math.tan(altitude);
      for (let d = 1.5; d < radius; d += 1.5) {
        const fx = x + east * d - forest.shift.x;
        const fz = z + north * d - forest.shift.z;
        const height = eye + d * rise - forest.shift.y;
        // Above every tree from here on.
        if (height > 45) return false;
        const ci = Math.floor((fx + forest.offset[0]) / cell);
        const cj = Math.floor((fz + forest.offset[1]) / cell);
        for (let i = ci - 1; i <= ci + 1; i += 1) {
          for (let j = cj - 1; j <= cj + 1; j += 1) {
            const tree = forest.trunks.get(`${i},${j}`);
            if (
              tree &&
              Math.hypot(fx - tree.x, fz - tree.z) < tree.h * 0.2 &&
              height < tree.y + tree.h &&
              height > tree.y + tree.h * 0.3
            )
              return true;
          }
        }
      }
      return false;
    },
    setTrees: (on) => {
      assist.trees = on;
      forest?.meshes.forEach((mesh) => {
        mesh.visible = on;
      });
    },
    setFlat: (on) => {
      assist.flat = on;
      flatUniforms.uFlat.value = on ? 1 : 0;
    },
    // Whether a rock stands at (x, z), for a walker of the given radius.
    blocked: (x, z, radius) =>
      obstacles.some(
        (rock) => Math.hypot(x - rock.x, z - rock.z) < rock.r + radius,
      ) || trunkNear(x, z, radius),
    follow,
    setLight: ({ overhead, moon, sun, moonDir, sunDir, extinction }) => {
      light.uOverhead.value.set(...overhead);
      light.uMoonLight.value = moon;
      light.uSunLight.value = sun;
      // Shadows fall from the brighter of the two, once it is bright enough beside
      // the sky to cast any.
      const skyLight = overhead.reduce((sum, v) => sum + v, 0) * 1.3;
      const [direct, dir] = sun > moon ? [sun, sunDir] : [moon, moonDir];
      shadow.direct =
        direct > skyLight * landSettings.shadows.castFrom ? direct : 0;
      shadow.direction.set(...dir);
      // Haze lives mostly in the lowest air: a 14 km column for its scale height.
      light.uHaze.value = extinction / 1.086 / 14000;
    },
    setWind,
    // Draws the shadow map from the eye's surroundings when it is due.
    castShadows,
    // The tide's height (metres) above mean sea level.
    setTide: (metres) => {
      seaUniforms.uTide.value = metres;
    },
    // A plain painted surface for things set on the ground, lit as the land is.
    painted: (rgb) => {
      const map = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1);
      map.colorSpace = THREE.SRGBColorSpace;
      map.needsUpdate = true;
      return plantMaterial(map, 0, 0);
    },
    // The headlamp: candela (0 when off), its position and direction in the
    // ground's frame, and its beam ({ hotspot, spill, edge } half-angles in degrees, spill share).
    setLamp: (candela, position, direction, beam) => {
      light.uLamp.value = candela;
      light.uLampPos.value.copy(position);
      light.uLampDir.value.copy(direction);
      const cos = (degrees) => Math.cos((degrees * Math.PI) / 180);
      light.uLampCone.value.set(
        cos(beam.hotspot),
        cos(beam.spill),
        cos(beam.edge),
      );
      light.uLampSpill.value = beam.spillShare;
    },
    resize: (width, height, ratio) => {
      size.set(width * ratio, height * ratio);
      reflection.setSize(Math.round(size.x / 2), Math.round(size.y / 2));
      current.water?.material.uniforms.uResolution.value.copy(size);
    },
    tick: (seconds) => {
      time.value = seconds;
      windUniforms.uWindForce.value = windForce * gust(seconds);
    },
  };
};

// A fixed random number in [0, 1) for each cell (i, j) and each use k of it.
const cellRandom = (i, j, k) => {
  let h =
    Math.imul(i, 0x27d4eb2d) ^
    Math.imul(j, 0x165667b1) ^
    Math.imul(k + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// A smooth wander between -1 and 1, one per seed.
const wanderJs = (t, seed) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const at = (n) => cellRandom(n, seed, 7) * 2 - 1;
  return at(i) * (1 - u) + at(i + 1) * u;
};

const smoothstepJs = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// --- Soundscape: looping field recordings, mixed by place and weather
export const createSoundscape = ({
  sound,
  settings,
  layers: tones,
  progress,
}) => {
  let context = null;
  let master = null;
  const layers = new Map();
  let wanted = {};

  const load = async (name) => {
    const response = await fetch(sound(`${name}.mp3`));
    if (!response.ok)
      throw new Error(`Sound "${name}" answered ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  };

  const layer = (name) => {
    if (!layers.has(name)) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(master);
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = tones[name]?.lowpass ?? 20000;
      filter.connect(gain);
      const entry = { gain, ready: null };
      // Each recording is fetched the first time the place calls for it.
      const work = progress.phase("Bringing in the sounds");
      work.add();
      entry.ready = load(name)
        .then((buffer) => {
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(filter);
          // Start each loop at a different point so layers never pulse together.
          source.start(0, Math.random() * buffer.duration);
        })
        .catch((error) => console.error(error))
        .finally(work.step);
      layers.set(name, entry);
    }
    return layers.get(name);
  };

  // Wind never holds steady: a wind layer swells and ebbs about its level, slowly.
  const swellOf = (name, now) => {
    const swell = tones[name]?.swell ?? 0;
    return 1 - swell / 2 + (swell / 2) * wanderJs(now / 6, name.length);
  };

  const apply = () => {
    if (!context) return;
    const now = context.currentTime;
    const names = new Set([...layers.keys(), ...Object.keys(wanted)]);
    names.forEach((name) => {
      const level = wanted[name] ?? 0;
      if (level <= 0 && !layers.has(name)) return;
      layer(name).gain.gain.setTargetAtTime(
        level * swellOf(name, now),
        now,
        settings.fade / 3,
      );
    });
  };
  setInterval(apply, 700);

  return {
    enable: async () => {
      context ??= new AudioContext();
      if (!master) {
        master = context.createGain();
        master.gain.value = 0;
        master.connect(context.destination);
      }
      await context.resume();
      master.gain.setTargetAtTime(
        settings.master,
        context.currentTime,
        settings.fadeIn / 3,
      );
      apply();
    },
    disable: () => {
      if (!context) return;
      master.gain.setTargetAtTime(0, context.currentTime, 0.3);
    },
    mix: (levels) => {
      wanted = levels;
      apply();
    },
    // A quiet chime for a target logged: two soft notes, a third for one seen in
    // detail, through the master so it keeps to the sound's own level.
    chime: (detail = false) => {
      if (!context || !master) return;
      const now = context.currentTime;
      const notes = detail ? [1046.5, 1318.5, 1568] : [1046.5, 1318.5];
      notes.forEach((frequency, i) => {
        const at = now + i * 0.13;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(settings.chime, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.9);
        gain.connect(master);
        // A sine with a touch of its octave, like a small bell.
        [
          [1, 1],
          [2, 0.18],
        ].forEach(([harmonic, share]) => {
          const osc = context.createOscillator();
          osc.type = "sine";
          osc.frequency.value = frequency * harmonic;
          const part = context.createGain();
          part.gain.value = share;
          osc.connect(part);
          part.connect(gain);
          osc.start(at);
          osc.stop(at + 1);
        });
      });
    },
  };
};
