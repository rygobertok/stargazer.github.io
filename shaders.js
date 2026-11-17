/*!
 * Stargazer
 * Copyright (c) Cliff Pyles
 * Released under the MIT License: https://opensource.org/license/mit
 * Original: https://codepen.io/editor/cliffpyles/pen/01a163ce-0f11-718c-bebc-68c338f10030
 */

// --- Sky model, shared by every sky shader
// Brightness is in nanolamberts, the unit of the Schaefer and
// Krisciunas–Schaefer formulas. Directions are in the scene: x east, y up, z south.
const skyModel = /* glsl */ `
  #define PI 3.141592653589793
  #define DOME_SECTORS 32
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uMoonPhaseAngle;
  uniform float uNatural;
  uniform float uArtificial;
  uniform float uDomes[DOME_SECTORS];
  uniform float uDomeHeight;
  uniform float uExtinction;
  uniform float uSkyFactor;
  uniform float uGain;
  uniform float uCloudCover;
  uniform vec2 uCloudOffset;

  // Kasten–Young air mass: how much atmosphere a ray crosses, 1 at the zenith.
  float airMass(float sinAltitude) {
    float altitude = degrees(asin(clamp(sinAltitude, 0.0, 1.0)));
    return 1.0 / (max(sinAltitude, 0.0) + 0.50572 * pow(altitude + 6.07995, -1.6364));
  }

  // Air mass for scattered light (Krisciunas & Schaefer).
  float scatterMass(float sinAltitude) {
    float s = clamp(sinAltitude, 0.0, 1.0);
    return inversesqrt(1.0 - 0.96 * (1.0 - s * s));
  }

  float nanoLamberts(float magnitude) {
    return 34.08 * exp(20.7233 - 0.92104 * magnitude);
  }

  float domeAt(vec3 d) {
    float azimuth = mod(degrees(atan(d.x, -d.z)) + 360.0, 360.0);
    float f = azimuth / (360.0 / float(DOME_SECTORS)) - 0.5;
    int i = int(floor(mod(f, float(DOME_SECTORS))));
    int j = (i + 1) % DOME_SECTORS;
    return mix(uDomes[i], uDomes[j], fract(f));
  }

  // Natural, artificial, lunar and twilight sky brightness toward d.
  vec4 skySources(vec3 d) {
    float s = max(d.y, 0.0);
    float altitude = degrees(asin(s));
    // Airglow brightens toward the horizon as the line of sight crosses more of
    // the glowing layer, and dims as the air in front absorbs it (Krisciunas & Schaefer).
    float x = scatterMass(s);
    float natural = uNatural * x * pow(10.0, -0.4 * uExtinction * (x - 1.0));
    float artificial = uNatural * (uArtificial * (1.0 + 1.6 * pow(1.0 - s, 3.0)) + domeAt(d) * exp(-altitude / uDomeHeight));

    float moon = 0.0;
    if (uMoonDir.y > 0.0) {
      float a = uMoonPhaseAngle;
      float illuminance = pow(10.0, -0.4 * (3.84 + 0.026 * a + 4e-9 * a * a * a * a));
      float cosRho = clamp(dot(d, uMoonDir), -1.0, 1.0);
      float rho = degrees(acos(cosRho));
      float scattering = pow(10.0, 5.36) * (1.06 + cosRho * cosRho) + pow(10.0, 6.15 - rho / 40.0);
      moon = scattering * illuminance * pow(10.0, -0.4 * uExtinction * scatterMass(uMoonDir.y))
        * (1.0 - pow(10.0, -0.4 * uExtinction * scatterMass(s)));
      moon *= smoothstep(0.0, 0.02, uMoonDir.y);
    }

    float twilight = 0.0;
    float sunAltitude = degrees(asin(clamp(uSunDir.y, -1.0, 1.0)));
    if (sunAltitude > -20.0) {
      float zenith = nanoLamberts(sunAltitude <= 0.0 ? 6.5 - 0.95 * sunAltitude : 6.5 - 0.25 * min(sunAltitude, 10.0));
      vec2 toSun = normalize(uSunDir.xz + vec2(1e-5));
      vec2 toView = normalize(d.xz + vec2(1e-5));
      float facing = max(dot(toSun, toView), 0.0);
      twilight = zenith * (1.0 + 1.4 * pow(1.0 - s, 2.0) + 3.0 * pow(facing, 3.0) * exp(-altitude / 14.0));
    }
    return vec4(natural, artificial, moon, twilight);
  }

  float total(vec4 sources) {
    return sources.x + sources.y + sources.z + sources.w;
  }

  // Faintest star the dark-adapted eye sees against brightness b (Schaefer 1990).
  float eyeLimit(float b) {
    bool night = b < 1479.0;
    float c1 = night ? 1.5849e-10 : 4.4668e-9;
    float c2 = night ? 0.012589 : 1.2589e-6;
    float root = 1.0 + sqrt(c2 * b);
    return -16.57 - 2.5 * log(c1 * root * root) / log(10.0);
  }

  // --- Clouds: a drifting layer whose patchiness follows the cloud cover
  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amplitude * valueNoise(p);
      p = mat2(1.6, 1.2, -1.2, 1.6) * p;
      amplitude *= 0.5;
    }
    return sum / 0.96875;
  }

  float cloudDensity(vec3 d) {
    if (uCloudCover < 0.005) return 0.0;
    float s = max(d.y, 0.0);
    vec2 p = d.xz / (s + 0.06) * 0.55 + uCloudOffset;
    float density = smoothstep(1.0 - uCloudCover - 0.14, 1.0 - uCloudCover + 0.2, fbm(p));
    // Far clouds crowd together toward the horizon.
    return mix(density, smoothstep(0.0, 0.7, uCloudCover), smoothstep(0.3, 0.02, s));
  }
`;

// --- Sky color and the eye: shared by the sky and everything it lights
const skyDisplay = /* glsl */ `
  const vec3 NATURAL = vec3(0.81, 0.95, 1.38);
  const vec3 ARTIFICIAL = vec3(1.42, 0.95, 0.62);
  const vec3 MOONLIT = vec3(0.68, 0.94, 1.62);
  const vec3 TWILIGHT_HIGH = vec3(0.45, 0.85, 1.9);
  const vec3 TWILIGHT_LOW = vec3(1.7, 0.86, 0.45);

  float lum(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  // What the eye is adapted to (nL): the sky overhead. At night it is the dark-
  // adapted curve below; by day the eye sets its exposure to the scene, and sees
  // full color. Between the two (twilight, the brightest Moon) it is a blend.
  uniform float uAdapt;
  uniform float uDayKey;
  uniform vec2 uDayRange;
  float daylight() {
    return smoothstep(uDayRange.x, uDayRange.y, log(uAdapt) / log(10.0));
  }

  // Brightness (nL) on screen: compressed like an adapted eye, and close to
  // grey at night when the eye loses color.
  // The soft ceiling the night curve rolls off toward: low for the sky, so its
  // brightest glow never clips, higher for the ground, which the eye sees with
  // its cones under the Moon and whose light and dark it still tells apart.
  uniform float uCeiling;
  vec3 display(vec3 tint, float brightness) {
    float x = uDisplay * pow(brightness / uNatural, 0.7);
    float color = clamp(log(brightness / uNatural) / log(10.0) / 2.6, 0.22, 1.0);
    vec3 c = mix(vec3(lum(tint)), tint, color);
    // A soft ceiling keeps the brightest night sky from clipping.
    vec3 night = c * x / (1.0 + x / uCeiling);
    // By day: exposed to what the eye is adapted to, rolled off softly, in full color.
    float r = brightness / uAdapt * uDayKey;
    vec3 day = tint * (r / (1.0 + r));
    return mix(night, day, daylight());
  }

  vec3 skyTint(vec4 sources, vec3 d) {
    float sunward = max(dot(normalize(uSunDir.xz + vec2(1e-5)), normalize(d.xz + vec2(1e-5))), 0.0);
    // The warm glow toward the Sun belongs to twilight; with the Sun well up the
    // horizon is pale, not pink.
    float low = 1.0 - smoothstep(0.03, 0.17, uSunDir.y);
    vec3 twilight = mix(TWILIGHT_HIGH, TWILIGHT_LOW, pow(sunward, 2.0) * exp(-max(d.y, 0.0) * 6.0) * low);
    return (sources.x * NATURAL + sources.y * ARTIFICIAL + sources.z * MOONLIT + sources.w * twilight)
      / max(total(sources), 1e-6);
  }
`;

// --- Sky dome: sky glow, clouds, the Milky Way, and the ground below the horizon
export const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The sky's four sources toward every direction, worked out once a frame on a
// small map (azimuth across, altitude up) and read by every sky pixel, instead of
// the full model running per pixel. Stored as log2(1 + nanolamberts), so a
// half-float texel holds daylight and the darkest night alike.
const skyLookup = /* glsl */ `
  uniform sampler2D uSkyMap;
  uniform sampler2D uCloudMap;
  vec2 mapAt(vec3 d) {
    return vec2(mod(atan(d.x, -d.z) / (2.0 * PI) + 1.0, 1.0), asin(clamp(d.y, 0.0, 1.0)) / (0.5 * PI));
  }
  vec4 lookupSources(vec3 d) {
    return exp2(texture2D(uSkyMap, mapAt(d))) - 1.0;
  }
  // The clouds too: their noise is far coarser than the map, and they are
  // worked out once a frame, not once a pixel.
  float lookupCloud(vec3 d) {
    return uCloudCover < 0.005 ? 0.0 : texture2D(uCloudMap, mapAt(d)).r;
  }
`;

export const skyFragment = /* glsl */ `
  uniform sampler2D uMilkyWay;
  uniform mat3 uToEquatorial;
  uniform vec3 uGround;
  uniform float uMilkyWayGain;
  uniform float uMilkyWaySaturation;
  uniform float uDisplay;
  uniform float uExposure;
  uniform float uDither;
  uniform sampler2D uDeep;
  uniform vec3 uDeepWeights;
  uniform float uDeepGain;
  varying vec3 vDirection;
  ${skyModel}

  ${skyDisplay}

  ${skyLookup}

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec3 d = normalize(vDirection);
    vec3 color;
    if (d.y < 0.0) {
      // The ground, lit only by the sky above it.
      vec3 up = vec3(0.0, 1.0, 0.0);
      vec4 overhead = lookupSources(up);
      color = display(skyTint(overhead, up), total(overhead) * 0.16) * (1.0 + 2.5 * exp(d.y * 30.0)) + uGround;
    } else {
      vec4 sources = lookupSources(d);
      float sky = total(sources);
      float cloud = lookupCloud(d);
      // Clouds take light from below (towns), from the Moon, and from twilight.
      float cloudLight = sources.x * 0.7 + sources.y * 2.4 + sources.z * 1.3 + sources.w * 1.05;
      color = display(skyTint(sources, d), mix(sky, cloudLight, cloud));

      vec3 e = uToEquatorial * d;
      vec2 uv = vec2(fract(0.5 - atan(e.y, e.x) / (2.0 * PI)), 0.5 + asin(clamp(e.z, -1.0, 1.0)) / PI);
      vec3 milkyWay = max(texture2D(uMilkyWay, uv).rgb - 0.006, 0.0);
      milkyWay = mix(vec3(lum(milkyWay)), milkyWay, uMilkyWaySaturation);
      // The Milky Way fades as the sky brightens around it.
      float contrast = 1.0 - smoothstep(0.0, 1.25, log(sky / uNatural) / log(10.0));
      // Through optics its glow dims like any surface (the stars it is made of are
      // drawn one by one instead).
      float transmission = pow(10.0, -0.4 * uExtinction * airMass(d.y));
      color += milkyWay * uMilkyWayGain * uSkyFactor * transmission * contrast * (1.0 - cloud);
      // Stars only a large telescope reaches, too many to draw one by one.
      if (uDeepGain > 0.0) {
        float deep = dot(texture2D(uDeep, uv).rgb, uDeepWeights);
        color += vec3(0.92, 0.94, 1.0) * log(1.0 + deep) * uDeepGain * transmission * contrast * (1.0 - cloud);
      }
    }
    gl_FragColor = vec4(color * uExposure, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) * uDither / 255.0;
  }
`;

// --- Stars: one point per star, shown when brighter than the limit toward it
export const starVertex = /* glsl */ `
  attribute vec2 magColor;
  uniform mat3 uSky;
  uniform float uMarkers;
  uniform float uCloudDimming;
  uniform float uPixelRatio;
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uFaintAlpha;
  uniform float uAlphaPower;
  uniform float uSizePower;
  uniform float uSaturation;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uTwinkleRate;
  uniform float uTwinkleChroma;
  // How much the air is churning (wind), and how much the aperture averages the
  // flicker out (1 for the eye, less for binoculars and telescopes).
  uniform float uTurbulence;
  uniform float uApertureFlicker;
  // Planets are discs, not points: they shine steadily.
  uniform float uSteady;
  uniform float uGlare;
  uniform float uCrowd;
  uniform float uOptics;
  uniform sampler2D uVisibility;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGlow;
  varying float vGlare;
  varying float vCore;
  varying float vSprite;
  ${skyModel}

  // A star's color from its B-V index: its surface temperature (Ballesteros 2012),
  // then the color of a body that hot, brightest channel at 1.
  vec3 starColor(float bv) {
    bv = clamp(bv, -0.4, 2.0);
    float t = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62)) / 100.0;
    vec3 c;
    c.r = t <= 66.0 ? 1.0 : clamp(1.293 * pow(t - 60.0, -0.1332), 0.0, 1.0);
    c.g = t <= 66.0 ? clamp(0.39 * log(t) - 0.6318, 0.0, 1.0) : clamp(1.1299 * pow(t - 60.0, -0.0755), 0.0, 1.0);
    c.b = t >= 66.0 ? 1.0 : t <= 19.0 ? 0.0 : clamp(0.5432 * log(t - 10.0) - 1.1963, 0.0, 1.0);
    return c / max(max(c.r, c.g), c.b);
  }

  // Scintillation: the air's turbulence makes a star's light flicker at random,
  // never in a beat. Smooth value noise in time, two octaves, from -1 to 1.
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(float t) {
    float i = floor(t);
    float f = fract(t);
    return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  float flicker(float seed, float t) {
    float a = t * uTwinkleRate + seed * 917.0;
    return (noise(a) * 0.65 + noise(a * 2.37 + 31.0) * 0.35) * 2.0 - 1.0;
  }

  void cull() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }

  void main() {
    vec3 d = normalize(uSky * position);
    if (d.y < 0.0) { cull(); return; }
    float x = airMass(d.y);
    float magnitude = magColor.x / 16.0 - 1.5;
    // Limits and clouds for this part of the sky, from the visibility map.
    vec2 at = vec2(mod(atan(d.x, -d.z) / (2.0 * PI) + 1.0, 1.0), asin(clamp(d.y, 0.0, 1.0)) / (0.5 * PI));
    vec4 visibility = texture2D(uVisibility, at);
    float eye = visibility.x;
    float reach = visibility.y;
    magnitude += uExtinction * x + visibility.z * uCloudDimming;
    bool seen = magnitude <= reach;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(d * 400.0, 1.0);

    if (uMarkers > 0.5) {
      // Stars in the field of view that this sky and instrument cannot show.
      if (seen) { cull(); return; }
      vAlpha = mix(0.55, 0.12, smoothstep(0.0, 3.0, magnitude - reach));
      vColor = vec3(1.0);
      vGlow = 0.0;
      vGlare = 0.0;
      vCore = 4.0 * uPixelRatio;
      vSprite = vCore * 1.6;
      gl_PointSize = vSprite;
      return;
    }
    if (!seen) { cull(); return; }

    float seed = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453);
    // Barely there overhead, plain near the horizon, where the light crosses the
    // most air (as air mass to the 1.75); more in wind; less through a wide aperture.
    float depth = (1.0 - uSteady) * min(uTwinkle * pow(x, 1.75) * uTurbulence * uApertureFlicker, 0.25);
    float twinkle = 1.0 + depth * flicker(seed, uTime);

    // Brightness is judged against what the eye alone would see; stars only an
    // instrument reveals stay faint and fill the sky in. In an eyepiece the
    // instrument's own reach is the measure, so its light-gathering shows.
    eye = mix(eye, reach, uOptics);
    float flux = pow(10.0, -0.4 * (magnitude - eye));
    float alpha = magnitude <= eye
      ? uFaintAlpha * pow(flux, uAlphaPower)
      : uFaintAlpha * uCrowd * mix(0.25, 1.0, clamp((reach - magnitude) / max(reach - eye, 0.01), 0.0, 1.0));
    alpha *= twinkle;
    // Brighter stars grow steadily, so the sky keeps its hierarchy from the
    // faintest specks to the few that dominate it.
    float lift = max(flux, 1.0);
    float core = clamp(uMinSize * pow(lift, uSizePower), uMinSize, uMaxSize) * uPixelRatio;
    float saturation = uSaturation * smoothstep(0.3, 2.2, log(lift) / log(10.0));

    vColor = mix(vec3(1.0), starColor(magColor.y / 80.0 - 0.5), saturation);
    // Low down, the air splits a bright star's colors and they flicker apart.
    float chroma = uTwinkleChroma * depth * smoothstep(1.6, 4.0, x) * smoothstep(1.2, 2.4, log(lift) / log(10.0));
    vColor *= 1.0 + chroma * vec3(flicker(seed + 0.31, uTime * 1.3), flicker(seed + 0.57, uTime * 1.3), flicker(seed + 0.83, uTime * 1.3));
    vAlpha = min(alpha, 1.0);
    vGlow = smoothstep(1.4, 3.2, log(lift) / log(10.0));
    // Only the brightest (Sirius, Jupiter, Venus) dazzle with a wide, soft glare.
    vGlare = uGlare * smoothstep(2.4, 4.6, log(lift) / log(10.0));
    vCore = core;
    // Only stars with a halo need room for it; faint ones stay tight.
    vSprite = core * (mix(2.4, 3.2, vGlow) + vGlare * 4.0);
    gl_PointSize = vSprite;
  }
`;

export const starFragment = /* glsl */ `
  uniform float uExposure;
  uniform float uMarkers;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGlow;
  varying float vGlare;
  varying float vCore;
  varying float vSprite;

  void main() {
    float r = length(gl_PointCoord - 0.5) * vSprite;
    float intensity;
    if (uMarkers > 0.5) {
      // A thin ring: a place where a star is, not a star.
      float ring = 1.0 - smoothstep(0.0, 0.75, abs(r - vCore * 0.5));
      intensity = vAlpha * ring * 0.5;
      gl_FragColor = vec4(vec3(0.88, 0.34, 0.25) * intensity * uExposure, 1.0);
    } else {
      float sigma = max(vCore * 0.36, 0.8);
      // A round window, so no star ever shows the square it is drawn in.
      float round = 1.0 - smoothstep(0.32, 0.5, r / vSprite);
      float core = exp(-(r * r) / (2.0 * sigma * sigma)) * round;
      // The halo reaches zero before the sprite's edge, so no square shows.
      float halo = vGlow * 0.14 * exp(-r / (vCore * 0.8)) * (1.0 - smoothstep(0.3, 0.5, r / vSprite));
      // The glare of a dazzling light in a dark-adapted eye: wide, faint, round.
      float glare = vGlare * 0.1 * exp(-r / (vCore * 1.6)) * (1.0 - smoothstep(0.25, 0.5, r / vSprite));
      intensity = vAlpha * (core + halo + glare);
      gl_FragColor = vec4(vColor * intensity * uExposure, 1.0);
    }
    if (intensity < 0.002) discard;
    #include <colorspace_fragment>
  }
`;

// --- The Moon: a lit sphere with NASA's map, phase from the Sun's direction
export const moonVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const moonFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform float uBrightness;
  uniform float uExposure;
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    float light = smoothstep(-0.04, 0.12, dot(normalize(vNormal), uSunDir));
    vec3 surface = texture2D(uMap, vUv).rgb;
    surface = mix(vec3(dot(surface, vec3(0.2126, 0.7152, 0.0722))), surface, 0.35);
    // Earthshine keeps the dark limb faintly visible.
    vec3 color = surface * (light * uBrightness + 0.012);
    gl_FragColor = vec4(color * uExposure, 1.0);
    #include <colorspace_fragment>
  }
`;

// --- Soft scattered glow around the Moon
export const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const haloFragment = /* glsl */ `
  uniform float uStrength;
  uniform float uExposure;
  varying vec2 vUv;

  void main() {
    float r = length(vUv - 0.5) * 2.0;
    // The sky model already brightens the wide area around the Moon; this is
    // only the bright aureole close to its disc, gone well before the edge.
    float glow = uStrength * (exp(-r * r * 60.0) * 0.5 + exp(-r * r * 9.0) * 0.08);
    gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * glow * uExposure, 1.0);
    #include <colorspace_fragment>
  }
`;

// --- Globe: the Earth at night, its atmosphere, and sharper tiles near the focus
export const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const earthFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uFeather;
  uniform float uExposure;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 night = texture2D(uMap, vUv).rgb;
    // Sharper tiles fade out toward their edges so they melt into the globe.
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float alpha = uOpacity * (uFeather > 0.0 ? smoothstep(0.0, uFeather, edge) : 1.0);
    // City lights carry a little more than the dim land around them.
    night += night * night * 0.7;
    vec3 color = night;
    gl_FragColor = vec4(color * uExposure, alpha);
    #include <colorspace_fragment>
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform float uExposure;
  uniform vec3 uLight;
  uniform float uScaleHeight;
  uniform float uStrength;
  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // Air along each line of sight through an exponential atmosphere (Chapman):
  // rays that reach the ground cross H / cos(angle) of it; rays that pass over
  // the limb cross sqrt(2 pi H) of it at their lowest point. The two meet at
  // the limb, so the glow runs on without an edge.
  void main() {
    vec3 ray = normalize(vWorld - cameraPosition);
    float b = dot(cameraPosition, ray);
    float lowest = -b;
    if (lowest < 0.0) discard;
    float grazing = sqrt(2.0 * 3.14159265 * uScaleHeight);
    float c = dot(cameraPosition, cameraPosition) - 1.0;
    float disc = b * b - c;
    vec3 limb;
    float air;
    if (disc > 0.0) {
      vec3 ground = cameraPosition + ray * (-b - sqrt(disc));
      limb = normalize(ground);
      air = min(uScaleHeight / max(dot(limb, -ray), 1e-4), grazing);
    } else {
      vec3 closest = cameraPosition + ray * lowest;
      limb = normalize(closest);
      air = grazing * exp(-(length(closest) - 1.0) / uScaleHeight);
    }
    float depth = air / grazing;
    // A soft key light: the atmosphere glows on one side and fades on the other.
    float lit = 0.06 + 0.94 * smoothstep(-0.3, 0.9, dot(limb, uLight));
    // Thicker air scatters more and looks paler; the peak is held low so the
    // limb reads as glowing air, not a drawn line.
    vec3 tone = mix(vec3(0.04, 0.13, 0.5), vec3(0.26, 0.48, 0.95), depth);
    vec3 color = tone * pow(depth, 1.3) * lit * uStrength * uExposure;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  }
`;

// --- The ground: lit only by the sky, the Moon and (by day) the Sun, then seen
// through the same eye as the sky. Light is in nanolamberts for an albedo of 1.
const groundLight = /* glsl */ `
  uniform float uDisplay;
  uniform float uMoonLight;
  uniform float uSunLight;
  uniform float uExposure;
  uniform vec4 uOverhead;
  uniform float uNightVision;
  // A red headlamp at the walker's forehead: intensity in candela (0 when off),
  // where it points, and the cosines of its hotspot, spill and outer edge.
  uniform float uLamp;
  uniform vec3 uLampPos;
  uniform vec3 uLampDir;
  uniform vec3 uLampCone;
  uniform float uLampSpill;
  ${skyModel}
  ${skyDisplay}

  // Deep red LED light, scaled to unit luminance.
  const vec3 LAMP_RED = vec3(1.0, 0.06, 0.015) / 0.2566;

  // Lux from the lamp falls off with distance squared; a lit surface of
  // albedo 1 shows 1e5 nL per lux. The eye's dark adaptation adds nothing:
  // red light is seen by the cones, which is why it leaves that adaptation alone.
  vec3 lampOn(vec3 albedo, vec3 n, vec3 world) {
    if (uLamp <= 0.0) return vec3(0.0);
    vec3 d = world - uLampPos;
    float r2 = max(dot(d, d), 0.04);
    vec3 l = d * inversesqrt(r2);
    float c = dot(l, uLampDir);
    float spill = smoothstep(uLampCone.z, uLampCone.y, c);
    float beam = uLampSpill * spill * spill + (1.0 - uLampSpill) * smoothstep(uLampCone.y, uLampCone.x, c);
    float lux = uLamp * beam * max(dot(n, -l), 0.0) / r2;
    return albedo * LAMP_RED * lux * 1e5;
  }

  // Shadows: the Moon's or the Sun's light blocked by what stands close by, as
  // depth maps seen from the light over squares around the walker (each matrix
  // takes the ground's frame into its map): a near one, fine enough for grass
  // and rocks, and a far one that only trees are drawn into. On while uShadowOn.
  // Receivers step off the surface along their normal by uShadowBias.y metres and
  // compare uShadowBias.x nearer than they lie, so a surface never shadows itself.
  uniform sampler2D uShadowMap;
  uniform sampler2D uShadowFar;
  uniform mat4 uShadowMatrix;
  uniform mat4 uShadowFarMatrix;
  uniform float uShadowOn;
  uniform vec2 uShadowBias;
  uniform vec2 uShadowTexel;
  // Four taps a texel and a half apart, turned a little from pixel to pixel so
  // the edge of a shadow softens instead of stepping. within is how far inside
  // the map the point lies (1 well inside, 0 at its edge).
  float shadowFrom(sampler2D map, mat4 matrix, float texel, vec3 at, float turn, out float within) {
    vec4 p = matrix * vec4(at, 1.0);
    vec3 c = p.xyz / p.w * 0.5 + 0.5;
    float edge = max(abs(c.x - 0.5), abs(c.y - 0.5)) * 2.0;
    within = 1.0 - smoothstep(0.86, 0.98, edge);
    if (within <= 0.001) return 1.0;
    float z = c.z - uShadowBias.x;
    vec2 a = vec2(cos(turn), sin(turn)) * texel * 1.5;
    vec2 b = vec2(-a.y, a.x);
    return (step(z, texture2D(map, c.xy + a).r) + step(z, texture2D(map, c.xy - a).r)
      + step(z, texture2D(map, c.xy + b).r) + step(z, texture2D(map, c.xy - b).r)) * 0.25;
  }
  float shadowAt(vec3 world, vec3 n) {
    if (uShadowOn <= 0.001) return 1.0;
    vec3 at = world + n * uShadowBias.y;
    float turn = fract(sin(dot(world.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
    float nearIn;
    float farIn;
    float near = shadowFrom(uShadowMap, uShadowMatrix, uShadowTexel.x, at, turn, nearIn);
    float far = shadowFrom(uShadowFar, uShadowFarMatrix, uShadowTexel.y, at, turn, farIn);
    // Inside the near map the trees are in both maps; beyond it only the far one holds them.
    float lit = mix(mix(1.0, far, farIn), min(near, far), nearIn);
    return mix(1.0, lit, uShadowOn);
  }

  // Contact: the sky's light does not reach the ground under a tuft, a shrub, a
  // rock or a trunk, painted as a map over a square (uContactReach metres from
  // centre to edge) around uContactCentre, darkening the ambient by uContactStrength.
  uniform sampler2D uContactMap;
  uniform vec2 uContactCentre;
  uniform float uContactReach;
  uniform float uContactStrength;
  float contactAt(vec2 at) {
    vec2 c = (at - uContactCentre) / (2.0 * uContactReach) + 0.5;
    float edge = max(abs(c.x - 0.5), abs(c.y - 0.5)) * 2.0;
    float within = 1.0 - smoothstep(0.9, 1.0, edge);
    return texture2D(uContactMap, c).r * within * uContactStrength;
  }

  // The eye's gain in the dark, which lifts moonlight as much as the sky's light
  // (so a shadow stays as deep beside the lit ground as it is in the field), and
  // which the Moon itself takes away as it brightens the night: under a full
  // Moon the eye is far less dark-adapted than under the stars alone.
  float nightGain() {
    float sky = total(uOverhead) * 1.3 + uNatural * 0.8;
    float moon = uMoonLight * max(uMoonDir.y, 0.0);
    return mix(uNightVision / (1.0 + 0.26 * moon / max(sky, 1.0)), 1.0, daylight());
  }

  vec3 lightOn(vec3 albedo, vec3 n, float shadow, float occlusion) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec4 overhead = uOverhead;
    // Eyes long in the dark make out the ground better than its light alone
    // suggests; by day there is no such gain.
    float gain = nightGain();
    float sky = (total(overhead) * 1.3 + uNatural * 0.8) * gain;
    float ambient = sky * (0.55 + 0.45 * n.y) * (1.0 - occlusion);
    float moon = uMoonLight * gain * max(dot(n, uMoonDir), 0.0) * shadow;
    float sun = uSunLight * max(dot(n, uSunDir), 0.0) * shadow;
    vec3 tint = skyTint(overhead, up);
    return albedo * (ambient * tint + moon * MOONLIT + sun * vec3(1.0, 0.96, 0.9));
  }
  vec3 lightOn(vec3 albedo, vec3 n) {
    return lightOn(albedo, n, 1.0, 0.0);
  }

  // The Moon's or the Sun's light mirrored off a surface toward the eye: wet
  // mud, rock and snow shine a little, by shine, in a lobe tightness wide.
  vec3 glint(vec3 n, vec3 world, float shine, float tightness, float shadow) {
    if (shine <= 0.001) return vec3(0.0);
    vec3 toEye = normalize(cameraPosition - world);
    float gain = nightGain();
    vec3 moonH = normalize(toEye + uMoonDir);
    vec3 sunH = normalize(toEye + uSunDir);
    float moon = uMoonLight * gain * pow(max(dot(n, moonH), 0.0), tightness) * step(0.0, uMoonDir.y);
    float sun = uSunLight * pow(max(dot(n, sunH), 0.0), tightness) * step(0.0, uSunDir.y);
    // Mirrored light is strongest at a grazing view.
    float fresnel = 0.12 + 0.88 * pow(1.0 - max(dot(n, toEye), 0.0), 4.0);
    return (moon * MOONLIT + sun * vec3(1.0, 0.96, 0.9)) * shine * fresnel * shadow;
  }

  vec3 shade(vec3 radiance) {
    float b = max(lum(radiance), 1e-6);
    return display(radiance / b, b) * uExposure;
  }

  // The lamp's light is seen by the cones, not the dark-adapted rods that the
  // sky's display curve stands for, so it has its own: compressed like the eye
  // (a power), then rolled off softly at the brightest, so the hotspot keeps its
  // gradient and the ground its texture instead of clipping to one flat red.
  uniform float uLampHalf;
  uniform float uLampPower;
  vec3 lampShade(vec3 radiance) {
    vec3 c = radiance / uLampHalf;
    float l = lum(c);
    if (l <= 1e-7) return vec3(0.0);
    float t = pow(l, uLampPower);
    return c * (t / l) / (1.0 + t) * uExposure;
  }
`;

// Distant ground fades into the sky glow along the line of sight; worked out
// per vertex, since the glow changes slowly across the land.
const airThrough = /* glsl */ `
  uniform float uHaze;
  varying vec3 vAir;
  varying float vClear;

  void throughAir(vec3 world) {
    float distance = length(world.xz);
    // A little lift keeps the direction defined at the land's own centre.
    vec3 toward = normalize(vec3(world.x, max(world.y, 0.0) + distance * 0.004 + 1e-3, world.z));
    vec4 sources = skySources(toward);
    vAir = total(sources) * skyTint(sources, toward);
    vClear = exp(-distance * uHaze);
  }
`;
const groundAir = /* glsl */ `
  uniform float uDisplay;
  ${skyModel}
  ${skyDisplay}
  ${airThrough}
`;

// The land: up to four kinds of ground drawn in detail close by, each with how
// much of it covers this point (aCover), and the land's own color from afar (aFar).
export const terrainVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 aCover;
  attribute vec3 aFar;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec4 vCover;
  varying vec3 vFar;
  ${groundAir}
  // The land laid flat beyond the walker's surroundings (an assist).
  uniform float uFlat;
  uniform float uFlatLevel;
  uniform vec2 uFlatCentre;
  uniform vec2 uFlatRange;
  uniform float uCurve;
  float levelled(vec3 world) {
    float t = uFlat * smoothstep(uFlatRange.x, uFlatRange.y, distance(world.xz, uFlatCentre));
    return mix(world.y, uFlatLevel - uCurve * dot(world.xz, world.xz), t);
  }
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y = levelled(world.xyz);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vCover = aCover;
    vFar = aFar;
    throughAir(vWorld);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

export const terrainFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap0;
  uniform sampler2D uMap1;
  uniform sampler2D uMap2;
  uniform sampler2D uMap3;
  uniform sampler2D uNormal0;
  uniform sampler2D uNormal1;
  uniform sampler2D uNormal2;
  uniform sampler2D uNormal3;
  // Per slot: metres per repeat of its photograph, its color from afar, and how far
  // its photograph has faded in since arriving.
  uniform vec4 uTile;
  // Per slot, whether its picture holds two photographs, one above the other.
  uniform vec4 uPair;
  uniform vec3 uSlotAlbedo[4];
  uniform vec4 uReady;
  // Where the ground's frame sits on the land, so photographs stay put as it moves.
  uniform vec2 uOrigin;
  // Snow: its cover close by and to the far horizon (each uSnowSpan metres from
  // centre to edge), its photograph and how far that has faded in, its color from
  // afar, and how far the snow has faded in.
  uniform sampler2D uSnowNear;
  uniform sampler2D uSnowFar;
  uniform vec2 uSnowSpan;
  uniform sampler2D uSnowPhoto;
  uniform float uSnowReady;
  uniform vec3 uSnowAlbedo;
  uniform float uSnowOn;
  // The snow's own relief, and how the wind lies across it (its drifts run downwind).
  uniform sampler2D uSnowBumps;
  uniform vec2 uWindDir;
  // Per slot: how much its surface mirrors direct light (wet mud, rock), how much
  // of it lies in pools of standing water (marsh), and how much it sparkles
  // (sand's grains, snow's crystals).
  uniform vec4 uSlotShine;
  uniform vec4 uSlotPools;
  uniform vec4 uSlotSparkle;
  // The same for snow lying on the ground.
  uniform vec2 uSnowSurface;
  // The sea's shore: which slot is beach sand, and the sea's level (y), for the
  // wet band the tide leaves. Farmland: which slot, and how wide its fields are.
  uniform vec4 uShoreMask;
  uniform float uSeaLevel;
  uniform float uTide;
  uniform vec3 uSwash;
  uniform vec4 uFieldSlot;
  uniform float uFieldSize;
  // Far land's patchiness: the scales (metres) of its broad and fine patches,
  // and how much they vary its colour.
  uniform vec2 uFarPatch;
  uniform float uFarBreakup;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec4 vCover;
  varying vec3 vFar;
  varying vec3 vAir;
  varying float vClear;
  ${groundLight}

  // Smooth value noise, about one unit a feature, read from a tiling picture of
  // it (uNoise: its slope in red and green, its height in blue), so a read costs
  // one texture tap instead of four hashes.
  uniform sampler2D uNoise;
  const float NOISE_CELLS = 16.0;
  float lumps(vec2 p) {
    return texture2D(uNoise, p / NOISE_CELLS).b;
  }
  // The noise's slope per unit of p, at p = at / scale, scaled to the 0.3-unit
  // difference the ground's relief was tuned with.
  vec2 lumpsSlope(vec2 at, float scale) {
    return (texture2D(uNoise, at / (scale * NOISE_CELLS)).rg * 2.0 - 1.0) * 4.0 * 0.3;
  }

  // A second copy of a photograph, turned and shifted, so the two never line up.
  const float TURN_C = 0.7986;
  const float TURN_S = 0.6018;
  vec2 turned(vec2 uv) {
    return vec2(TURN_C * uv.x - TURN_S * uv.y, TURN_S * uv.x + TURN_C * uv.y) * 0.83 + vec2(0.37, 0.61);
  }
  // A slope read from the turned copy, turned back into the land's frame.
  vec2 turnedBack(vec2 slope) {
    return vec2(TURN_C * slope.x + TURN_S * slope.y, -TURN_S * slope.x + TURN_C * slope.y);
  }

  // One kind of ground: each point takes the photograph or its turned copy by a
  // slow noise (about two repeats a feature), with a soft edge between, so no
  // lattice of repeats forms. Its slope follows the same choice.
  // Where a slot holds two photographs, the land shows one or the other in
  // patches a few repeats wide, with a soft edge between.
  vec2 stacked(vec2 uv, float pair, float which) {
    return pair > 0.5 ? vec2(uv.x, fract(uv.y) * 0.5 + 0.5 * which) : uv;
  }
  vec3 photoAt(sampler2D map, vec2 uv, float pair, float which) {
    if (pair < 0.5 || which < 0.002) return texture2D(map, stacked(uv, pair, 0.0)).rgb;
    if (which > 0.998) return texture2D(map, stacked(uv, pair, 1.0)).rgb;
    return mix(texture2D(map, stacked(uv, pair, 0.0)).rgb, texture2D(map, stacked(uv, pair, 1.0)).rgb, which);
  }
  void layer(sampler2D map, sampler2D bumps, float tile, float pair, vec3 farAlbedo, float ready, float weight, vec2 at,
             inout vec3 albedo, inout vec2 slope) {
    if (weight < 0.002) return;
    vec2 uv = at / tile;
    vec2 uv2 = turned(uv);
    float pick = smoothstep(0.38, 0.62, lumps(at / (tile * 2.1) + 7.0));
    float which = pair > 0.5 ? smoothstep(0.44, 0.56, lumps(at / (tile * 6.5) + 13.0)) : 0.0;
    vec3 photo = mix(photoAt(map, uv, pair, which), photoAt(map, uv2, pair, which), pick);
    vec2 bump = mix(photoAt(bumps, uv, pair, which).xy * 2.0 - 1.0, turnedBack(photoAt(bumps, uv2, pair, which).xy * 2.0 - 1.0), pick);
    albedo += mix(farAlbedo, photo, ready) * weight;
    slope += bump * ready * weight;
  }

  // From tens of metres off a photograph's grain is gone (read down to one colour),
  // so a coarse read of it, uMidDetail.x times its near repeat, stands for the
  // ground's pattern at that scale: its light and dark against its own mean laid
  // over the land's colour, and its slope at that scale. One copy is enough: the
  // far land's patches break its repeat.
  uniform vec2 uMidDetail;
  void coarse(sampler2D map, sampler2D bumps, float tile, float pair, float ready, float weight, vec2 at,
              inout float tone, inout vec2 slope) {
    if (weight < 0.002) return;
    float repeat = tile * uMidDetail.x;
    vec2 uv = stacked(at / repeat, pair, 0.0);
    vec3 photo = texture2D(map, uv).rgb;
    // The photograph's mean is its smallest level of detail.
    float mean = max(lum(texture2D(map, vec2(0.5, 0.25), 12.0).rgb), 0.01);
    float relative = clamp(lum(photo) / mean, 0.4, 2.2);
    tone += mix(1.0, relative, ready * uMidDetail.y) * weight;
    vec2 bump = texture2D(bumps, uv).xy * 2.0 - 1.0;
    slope += bump * ready * weight;
  }

  // Close by the mesh is smooth at the half metre, so the ground's small rises
  // and hollows come as a tilt of the normal from noise at two scales (metres,
  // uNearRelief.xy), by uNearRelief.z, fading out past 45 m.
  uniform vec3 uNearRelief;
  vec2 microRelief(vec2 at, float distance) {
    float fade = 1.0 - smoothstep(12.0, 45.0, distance);
    if (fade < 0.002) return vec2(0.0);
    return (lumpsSlope(at + 11.0, uNearRelief.x) + lumpsSlope(at + 23.0, uNearRelief.y) * 0.5) * uNearRelief.z * fade;
  }

  float snowCover(vec2 at) {
    vec2 near = at / (2.0 * uSnowSpan.x) + 0.5;
    vec2 edge = abs(near - 0.5);
    float inside = 1.0 - smoothstep(0.44, 0.49, max(edge.x, edge.y));
    float far = texture2D(uSnowFar, at / (2.0 * uSnowSpan.y) + 0.5).r;
    return mix(far, texture2D(uSnowNear, near).r, inside) * uSnowOn;
  }

  void main() {
    #include <logdepthbuf_fragment>
    float distance = length(vWorld.xz);
    vec2 at = vWorld.xz + uOrigin;
    vec3 near = vec3(0.0);
    vec2 slope = vec2(0.0);
    layer(uMap0, uNormal0, uTile.x, uPair.x, uSlotAlbedo[0], uReady.x, vCover.x, at, near, slope);
    layer(uMap1, uNormal1, uTile.y, uPair.y, uSlotAlbedo[1], uReady.y, vCover.y, at, near, slope);
    layer(uMap2, uNormal2, uTile.z, uPair.z, uSlotAlbedo[2], uReady.z, vCover.z, at, near, slope);
    layer(uMap3, uNormal3, uTile.w, uPair.w, uSlotAlbedo[3], uReady.w, vCover.w, at, near, slope);
    // Where the detailed kinds do not reach, the land keeps its color from afar.
    float covered = clamp(vCover.x + vCover.y + vCover.z + vCover.w, 0.0, 1.0);
    near += vFar * (1.0 - covered);
    float far = smoothstep(60.0, 500.0, distance);
    vec3 albedo = mix(near, vFar, far);
    // The ground's pattern at tens of metres, from 30 m out to the edge of the
    // detailed land cover (6 km), over the colour from afar.
    float mid = smoothstep(30.0, 120.0, distance) * (1.0 - smoothstep(2500.0, 6000.0, distance));
    vec2 midSlope = vec2(0.0);
    if (mid > 0.002 && covered > 0.002) {
      float tone = 0.0;
      coarse(uMap0, uNormal0, uTile.x, uPair.x, uReady.x, vCover.x, at, tone, midSlope);
      coarse(uMap1, uNormal1, uTile.y, uPair.y, uReady.y, vCover.y, at, tone, midSlope);
      coarse(uMap2, uNormal2, uTile.z, uPair.z, uReady.z, vCover.z, at, tone, midSlope);
      coarse(uMap3, uNormal3, uTile.w, uPair.w, uReady.w, vCover.w, at, tone, midSlope);
      tone = tone / covered;
      albedo *= mix(1.0, tone, mid * covered);
      midSlope *= mid;
    }
    slope += microRelief(at, distance);
    // Far land is never one flat colour: its cover thins and thickens, and rock
    // shows through, in patches of a few hundred metres and of a few tens. The
    // patches tilt the land's normal a little too, so the light reads them.
    vec3 relief = vec3(0.0);
    if (far > 0.002) {
      float broad = lumps(at / uFarPatch.x);
      float fine = lumps(at / uFarPatch.y);
      float mottle = broad * 0.6 + fine * 0.4;
      albedo *= mix(1.0, 1.0 - uFarBreakup * (0.5 - mottle), far);
      vec2 fineSlope = lumpsSlope(at, uFarPatch.y) * 0.8;
      relief = vec3(fineSlope.x, 0.0, fineSlope.y) * (uFarBreakup * 2.5 * far);
    }
    // The surface's own response, by how much of each kind lies here.
    float shine = dot(uSlotShine, vCover);
    float sparkle = dot(uSlotSparkle, vCover);
    float pools = dot(uSlotPools, vCover);
    // The beach: sand the tide has just left is dark, smooth and wet, with a
    // line of wrack where the water reached.
    float beach = dot(uShoreMask, vCover);
    if (beach > 0.002 && far < 0.999) {
      // Above the water as it stands now (the tide, and the reach of the swash):
      // wet where the last waves ran, drying out above, with the wrack where
      // the tide last turned.
      float above = vWorld.y - (uSeaLevel + uTide + uSwash.x);
      float wet = (1.0 - smoothstep(0.0, 0.9, above)) * beach * (1.0 - far);
      float wrack = smoothstep(0.5, 0.65, above) * (1.0 - smoothstep(0.65, 1.0, above)) * beach * (1.0 - far)
        * smoothstep(0.35, 0.6, lumps(at / 3.0 + 21.0));
      albedo *= mix(1.0, 0.36, wet) * (1.0 - 0.35 * wrack);
      shine += 0.5 * wet;
      slope *= 1.0 - 0.6 * wet;
      sparkle *= 1.0 - wet;
    }
    // Farmland lies in fields, each its own crop: paler or darker, greener or
    // browner, its furrows run its own way, and a strip of grass at its edge.
    float crop = dot(uFieldSlot, vCover);
    if (crop > 0.002 && far < 0.999) {
      vec2 cell = floor((at + 37.0) / uFieldSize);
      vec2 inside = fract((at + 37.0) / uFieldSize);
      float id = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      float h1 = fract(id * 7.31);
      float h2 = fract(id * 13.7);
      vec3 tone = mix(vec3(0.78, 0.7, 0.6), vec3(1.12, 1.18, 0.92), h1);
      float angle = h2 * 3.1416;
      vec2 across = vec2(-sin(angle), cos(angle));
      float furrow = sin(dot(at, across) * 6.2832 / 0.8) * 0.5 + 0.5;
      float margin = 1.0 - smoothstep(0.012, 0.03, min(min(inside.x, 1.0 - inside.x), min(inside.y, 1.0 - inside.y)));
      vec3 field = albedo * tone * (1.0 - 0.14 * furrow * (1.0 - far));
      field = mix(field, vec3(0.07, 0.09, 0.05), margin * 0.8);
      albedo = mix(albedo, field, crop);
      slope += across * (furrow - 0.5) * 0.5 * crop * (1.0 - smoothstep(20.0, 80.0, distance));
    }
    // Marsh holds standing water in its hollows: dark, flat and mirror-bright.
    float puddle = 0.0;
    if (pools > 0.001 && far < 0.999) {
      float hollow = lumps(at / 7.0 + 5.0) * 0.7 + lumps(at / 1.9 + 9.0) * 0.3;
      puddle = smoothstep(0.66, 0.72, hollow) * pools * (1.0 - far);
      albedo = mix(albedo, albedo * 0.25, puddle);
      slope *= 1.0 - puddle;
      shine = mix(shine, 0.7, puddle);
    }
    // Snow lies in patches as it thins, and slides off steep ground. From afar it
    // is the share of the land it covers.
    float cover = snowCover(at);
    float lying = 0.0;
    if (cover > 0.002) {
      // Patches at three scales, their edges ragged at the half metre and soft,
      // so thinning snow lies as drifts and rags rather than painted blobs; the
      // bare ground between keeps a dusting.
      float patches = lumps(at / 9.0) * 0.5 + lumps(at / 2.3) * 0.3 + lumps(at / 0.65 + 3.0) * 0.2;
      float level = smoothstep(0.5, 0.82, normalize(vNormal).y);
      lying = mix(smoothstep(0.78 - cover, 1.14 - cover, patches) * level, cover * mix(level, 1.0, 0.5), far);
      vec3 photo = mix(uSnowAlbedo, texture2D(uSnowPhoto, at / 6.0).rgb, uSnowReady);
      float dusting = cover * cover * 0.5 * (1.0 - far);
      albedo = mix(albedo, mix(albedo, photo, dusting), 1.0 - lying);
      albedo = mix(albedo, mix(photo, uSnowAlbedo, far), lying);
      // Snow has its own surface: the photograph's relief, and drifts the wind
      // has combed downwind, long along it and short across.
      vec2 along = vec2(dot(at, uWindDir), dot(at, vec2(-uWindDir.y, uWindDir.x)));
      vec2 drift = lumpsSlope(along * vec2(0.22, 1.0) + 17.0, 0.9);
      vec2 snowSlope = (texture2D(uSnowBumps, at / 6.0).xy * 2.0 - 1.0) * uSnowReady * 0.5
        + (uWindDir * drift.x * 0.22 + vec2(-uWindDir.y, uWindDir.x) * drift.y) * 0.6 * (1.0 - far);
      slope = mix(slope, snowSlope, lying);
      shine = mix(shine, uSnowSurface.x, lying);
      sparkle = mix(sparkle, uSnowSurface.y, lying);
      puddle *= 1.0 - lying;
    }
    vec3 nearN = normalize(vNormal + vec3(slope.x, 0.0, -slope.y) * 0.6 + vec3(midSlope.x, 0.0, -midSlope.y) * 0.35);
    vec3 n = normalize(mix(nearN, normalize(vNormal - relief + vec3(midSlope.x, 0.0, -midSlope.y) * 0.35), far));
    float shadow = far < 0.999 ? shadowAt(vWorld, n) : 1.0;
    float occlusion = far < 0.999 ? contactAt(vWorld.xz) : 0.0;
    vec3 radiance = lightOn(albedo, n, shadow, occlusion);
    if (far < 0.999) {
      // Sparkle: grains and crystals that happen to mirror the light to the eye,
      // a different few from each place the eye stands.
      vec3 toEye = normalize(cameraPosition - vWorld);
      float near = 1.0 - smoothstep(8.0, 40.0, distance);
      if (sparkle > 0.001 && near > 0.0) {
        vec2 cell = floor(at * 40.0) + floor(toEye.xz * 24.0);
        float grain = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
        float lit = smoothstep(0.975, 1.0, grain) * sparkle * near;
        shine += lit * 6.0;
      }
      radiance += glint(n, vWorld, shine * (1.0 - far), mix(48.0, 160.0, puddle), shadow);
    }
    gl_FragColor = vec4(shade(mix(vAir, radiance, vClear)) + lampShade(lampOn(albedo, n, vWorld) * vClear), 1.0);
    #include <colorspace_fragment>
  }
`;

// --- Plants and rocks: scanned models, instanced, swaying with the wind
export const plantVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uTime;
  // How easily it bends (0 for rocks), and the wind: the way it blows (in the
  // ground's frame) and its force, gusts included (1 at about 20 km/h).
  uniform float uSway;
  uniform vec2 uWindDir;
  uniform float uWindForce;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  ${groundAir}
  void main() {
    vUv = uv;
    vec4 local = vec4(position, 1.0);
    vec4 world = modelMatrix * instanceMatrix * local;
    float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
    // Leaning downwind as the wind pushes, fluttering about that lean, and
    // swinging a little across it.
    float flutter = 0.7 + 0.3 * sin(uTime * 1.9 + phase) + 0.12 * sin(uTime * 4.3 + phase * 2.1);
    vec2 across = vec2(-uWindDir.y, uWindDir.x);
    world.xz += (uWindDir * flutter + across * 0.25 * sin(uTime * 1.3 + phase * 1.3)) * uWindForce * uSway * position.y * position.y;
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    // Plants and rocks stand close by, where the air adds nothing.
    vAir = vec3(0.0);
    vClear = 1.0;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

export const plantFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  // Leaves cut from a separate alpha map (its green channel), when uUseAlpha is set.
  uniform sampler2D uAlpha;
  uniform float uUseAlpha;
  uniform float uAlphaTest;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vAir;
  varying float vClear;
  ${groundLight}

  void main() {
    #include <logdepthbuf_fragment>
    vec4 texel = texture2D(uMap, vUv);
    if (uUseAlpha > 0.5) texel.a = texture2D(uAlpha, vUv).g;
    if (texel.a < uAlphaTest) discard;
    vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
    float shadow = shadowAt(vWorld, n);
    float occlusion = contactAt(vWorld.xz) * 0.6;
    // Thin leaves pass some sky light through from behind.
    vec3 radiance = lightOn(texel.rgb, n, shadow, occlusion) + lightOn(texel.rgb, -n, shadow, occlusion) * 0.25;
    vec3 lamp = lampOn(texel.rgb, n, vWorld) + lampOn(texel.rgb, -n, vWorld) * 0.25;
    gl_FragColor = vec4(shade(mix(vAir, radiance, vClear)) + lampShade(lamp * vClear), 1.0);
    #include <colorspace_fragment>
  }
`;

// --- Trees: a picture of a scanned tree from eight sides (tools/build-trees.mjs),
// on a card that stands at each instance and turns to face the eye. The two
// pictures nearest the side being seen are blended, so a tree turns smoothly as
// the walker goes round it. aTurn is how far the tree is turned about its trunk.
export const treeVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aTurn;
  // Per tree: mirrored (-1) or not, warmer (+) or cooler (-), paler or darker,
  // broader or narrower, so a forest edge is not one picture over and over.
  attribute vec4 aVary;
  varying vec3 vTint;
  // The card's width, height and how far below its foot the picture's ground lies
  // (metres, at the tree's scanned size), and how many pictures go round.
  uniform vec3 uCard;
  // How much of the picture's height the card shows.
  uniform float uTop;
  uniform float uFrames;
  // Trees stand out to uReach.y from the centre, fading from uReach.x.
  uniform vec2 uReach;
  // The wind, as for plants; a tree's crown sways slowly about its lean.
  uniform float uTime;
  uniform vec2 uWindDir;
  uniform float uWindForce;
  uniform float uTreeSway;
  // The land laid flat beyond the walker's surroundings (an assist).
  uniform float uFlat;
  uniform float uFlatLevel;
  uniform vec2 uFlatCentre;
  uniform vec2 uFlatRange;
  uniform float uCurve;
  float levelled(vec3 world) {
    float t = uFlat * smoothstep(uFlatRange.x, uFlatRange.y, distance(world.xz, uFlatCentre));
    return mix(world.y, uFlatLevel - uCurve * dot(world.xz, world.xz), t);
  }

  varying vec2 vUv;
  varying vec2 vFrames;
  varying float vBlend;
  varying float vFade;
  varying vec3 vWorld;
  varying vec3 vFacing;
  // The sky's light on the card (per unit albedo): a card is flat, so it is lit once a corner.
  varying vec3 vLight;
  ${groundLight}
  ${airThrough}
  void main() {
    vec3 base = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    base.y = levelled(base);
    float size = length(instanceMatrix[0].xyz);
    vec2 toEye = cameraPosition.xz - base.xz;
    vec2 dir = length(toEye) > 1e-3 ? normalize(toEye) : vec2(0.0, 1.0);
    vec3 right = vec3(dir.y, 0.0, -dir.x);
    vec3 world = base + right * (position.x * uCard.x * size * aVary.w) + vec3(0.0, (position.y * uCard.y - uCard.z) * size, 0.0);
    float phase = base.x * 0.13 + base.z * 0.29;
    float sway = (0.7 + 0.3 * sin(uTime * 1.6 + phase)) * uWindForce * uTreeSway * position.y * position.y * uCard.y * size;
    world.xz += uWindDir * sway;
    // Which pictures show the side facing the eye: picture k was drawn with the
    // tree turned k / uFrames of a turn, seen from +z. A mirrored tree turns the
    // other way, so its sides still follow the eye round.
    float side = (aVary.x * atan(-dir.x, dir.y) + aTurn) / (2.0 * PI) * uFrames;
    side = mod(side, uFrames);
    float k = floor(side);
    vFrames = vec2(k, mod(k + 1.0, uFrames));
    vBlend = side - k;
    vUv = vec2(0.5 + position.x * aVary.x, position.y * uTop);
    vTint = mix(vec3(1.0), mix(vec3(0.92, 1.0, 1.06), vec3(1.1, 1.0, 0.82), aVary.y * 0.5 + 0.5), abs(aVary.y)) * aVary.z;
    vFade = 1.0 - smoothstep(uReach.x, uReach.y, length(base.xz));
    vWorld = world;
    vFacing = normalize(vec3(dir.x, 0.7, dir.y));
    // Thin leaves pass some light through from behind: by day a canopy glows
    // with the light it scatters, so a backlit tree is no silhouette.
    vLight = lightOn(vec3(1.0), vFacing) + lightOn(vec3(1.0), -vFacing) * mix(0.25, 0.6, daylight());
    throughAir(world);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

export const treeFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform float uFrames;
  // The pictures were lit brighter than daylight shows leaves; this brings them to their albedo.
  uniform float uAlbedo;
  // How far the trees have grown in since arriving (0 to 1).
  uniform float uAppear;
  varying vec2 vUv;
  varying vec2 vFrames;
  varying float vBlend;
  varying float vFade;
  varying vec3 vWorld;
  varying vec3 vFacing;
  varying vec3 vLight;
  varying vec3 vTint;
  varying vec3 vAir;
  varying float vClear;
  ${groundLight}

  void main() {
    #include <logdepthbuf_fragment>
    vec4 a = texture2D(uMap, vec2((vFrames.x + vUv.x) / uFrames, vUv.y));
    vec4 b = texture2D(uMap, vec2((vFrames.y + vUv.x) / uFrames, vUv.y));
    vec4 texel = mix(a, b, vBlend);
    // Thin foliage is partly clear in the picture; it fades out by rising past the cut.
    float cut = mix(1.0, 0.3, vFade * uAppear);
    if (texel.a < cut) discard;
    vec3 albedo = texel.rgb * uAlbedo * vTint;
    vec3 lamp = lampOn(albedo, vFacing, vWorld) + lampOn(albedo, -vFacing, vWorld) * 0.25;
    gl_FragColor = vec4(shade(mix(vAir, albedo * vLight, vClear)) + lampShade(lamp * vClear), 1.0);
    #include <colorspace_fragment>
  }
`;

// --- The shadow pass: depth from the light, over a square around the walker.
// Plants and rocks sway as they do in view; the cut of their leaves is kept.
export const shadowPlantVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  uniform vec2 uWindDir;
  uniform float uWindForce;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
    float flutter = 0.7 + 0.3 * sin(uTime * 1.9 + phase) + 0.12 * sin(uTime * 4.3 + phase * 2.1);
    vec2 across = vec2(-uWindDir.y, uWindDir.x);
    world.xz += (uWindDir * flutter + across * 0.25 * sin(uTime * 1.3 + phase * 1.3)) * uWindForce * uSway * position.y * position.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
export const shadowPlantFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uAlpha;
  uniform float uUseAlpha;
  uniform float uAlphaTest;
  varying vec2 vUv;
  void main() {
    float a = uUseAlpha > 0.5 ? texture2D(uAlpha, vUv).g : texture2D(uMap, vUv).a;
    if (a < max(uAlphaTest, 0.3)) discard;
    gl_FragColor = vec4(1.0);
  }
`;

// A tree's card turns to face the light (uLightDir, toward it) and shows the
// pictures of the side the light sees, so its shadow is the tree's own outline.
export const shadowTreeVertex = /* glsl */ `
  #define PI 3.141592653589793
  attribute float aTurn;
  attribute vec4 aVary;
  uniform vec3 uCard;
  uniform float uTop;
  uniform float uFrames;
  uniform vec2 uReach;
  uniform float uTime;
  uniform vec2 uWindDir;
  uniform float uWindForce;
  uniform float uTreeSway;
  uniform vec3 uLightDir;
  uniform float uFlat;
  uniform float uFlatLevel;
  uniform vec2 uFlatCentre;
  uniform vec2 uFlatRange;
  uniform float uCurve;
  float levelled(vec3 world) {
    float t = uFlat * smoothstep(uFlatRange.x, uFlatRange.y, distance(world.xz, uFlatCentre));
    return mix(world.y, uFlatLevel - uCurve * dot(world.xz, world.xz), t);
  }
  varying vec2 vUv;
  varying vec2 vFrames;
  varying float vBlend;
  varying float vFade;
  void main() {
    vec3 base = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    base.y = levelled(base);
    float size = length(instanceMatrix[0].xyz);
    vec2 dir = length(uLightDir.xz) > 1e-3 ? normalize(uLightDir.xz) : vec2(0.0, 1.0);
    vec3 right = vec3(dir.y, 0.0, -dir.x);
    vec3 world = base + right * (position.x * uCard.x * size * aVary.w) + vec3(0.0, (position.y * uCard.y - uCard.z) * size, 0.0);
    float phase = base.x * 0.13 + base.z * 0.29;
    float sway = (0.7 + 0.3 * sin(uTime * 1.6 + phase)) * uWindForce * uTreeSway * position.y * position.y * uCard.y * size;
    world.xz += uWindDir * sway;
    float side = mod((aVary.x * atan(-dir.x, dir.y) + aTurn) / (2.0 * PI) * uFrames, uFrames);
    float k = floor(side);
    vFrames = vec2(k, mod(k + 1.0, uFrames));
    vBlend = side - k;
    vUv = vec2(0.5 + position.x * aVary.x, position.y * uTop);
    vFade = 1.0 - smoothstep(uReach.x, uReach.y, length(base.xz));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;
export const shadowTreeFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uFrames;
  uniform float uAppear;
  varying vec2 vUv;
  varying vec2 vFrames;
  varying float vBlend;
  varying float vFade;
  void main() {
    vec4 a = texture2D(uMap, vec2((vFrames.x + vUv.x) / uFrames, vUv.y));
    vec4 b = texture2D(uMap, vec2((vFrames.y + vUv.x) / uFrames, vUv.y));
    float alpha = mix(a.a, b.a, vBlend);
    if (alpha < mix(1.0, 0.45, vFade * uAppear)) discard;
    gl_FragColor = vec4(1.0);
  }
`;

// --- Water: the sky reflected (rendered mirrored into uReflection), broken by waves
// Water is drawn only where the land holds it (aWater over a half), with the sea's
// livelier waves blended in where it is sea (aSea).
export const waterVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aWater;
  attribute float aSea;
  attribute float aCoast;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vWater;
  varying float vSea;
  varying float vCoast;
  // The sea rides on the tide, and at the shore each wave runs up the beach:
  // a swell uSwash.x high, every uSwash.y seconds, uSwash.z metres apart,
  // coming in along uShoreDir. vSwash is how far up the beach this wave has
  // run (0 to 1); vSurge is positive while it is still running up.
  uniform float uTime;
  uniform float uTide;
  uniform vec2 uShoreDir;
  uniform vec3 uSwash;
  uniform vec2 uOrigin;
  varying float vSwash;
  varying float vSurge;
  ${groundAir}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // The swash lives in the last 25 m before the shore.
    vCoast = (aCoast - 0.5) * 200.0;
    float shore = smoothstep(-25.0, -5.0, vCoast) * aSea;
    float phase = uTime * 6.2832 / uSwash.y - dot(world.xz + uOrigin, uShoreDir) * 6.2832 / uSwash.z;
    float wave = sin(phase);
    vSwash = max(wave, 0.0) * shore;
    vSurge = cos(phase) * shore;
    world.y += (uTide + uSwash.x * vSwash) * aSea;
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWater = aWater;
    vSea = aSea;
    throughAir(vWorld);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

export const waterFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uReflection;
  uniform sampler2D uWaves;
  uniform vec2 uResolution;
  uniform float uTime;
  // Ripple strength and scale: x for still inland water, y for the sea.
  uniform vec2 uRoughness;
  uniform vec2 uWaveScale;
  uniform vec2 uFlow;
  uniform vec2 uOrigin;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vWater;
  varying float vSea;
  varying float vCoast;
  varying float vSwash;
  varying float vSurge;
  varying vec3 vAir;
  varying float vClear;
  ${groundLight}

  void main() {
    // The sea runs on over the shelving shore, as far as the sand it wets.
    if (vWater < 0.5 && vSea < 0.2) discard;
    // Shallow water at the shore lets the sand beneath show through.
    float alpha = 1.0 - 0.75 * smoothstep(-9.0, 0.5, vCoast) * vSea;
    #include <logdepthbuf_fragment>
    float roughness = mix(uRoughness.x, uRoughness.y, vSea);
    vec2 p = (vWorld.xz + uOrigin) / mix(uWaveScale.x, uWaveScale.y, vSea);
    vec2 drift = uFlow * uTime;
    vec3 a = texture2D(uWaves, p + drift + vec2(uTime * 0.011, uTime * 0.007)).xyz * 2.0 - 1.0;
    vec3 b = texture2D(uWaves, p * 0.43 - drift * 0.6 - vec2(uTime * 0.006, -uTime * 0.009)).xyz * 2.0 - 1.0;
    vec2 ripple = (a.xy + b.xy) * roughness;
    float distance = length(vWorld.xz);
    // Far water flattens out: its ripples are too small to see.
    ripple *= 1.0 / (1.0 + distance * 0.004);
    vec3 view = normalize(vWorld - cameraPosition);
    float facing = clamp(-view.y, 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
    vec2 screen = gl_FragCoord.xy / uResolution + ripple * 0.06;
    vec3 reflection = texture2D(uReflection, screen).rgb;
    // The water's own body: the faintest glow of the sky scattered within it.
    vec3 body = shade(lightOn(vec3(0.02, 0.025, 0.03), vec3(0.0, 1.0, 0.0)))
      + lampShade(lampOn(vec3(0.02, 0.025, 0.03), vec3(0.0, 1.0, 0.0), vWorld));
    // The lamp glints off the ripples, mirrored as the sky is.
    vec3 surface = normalize(vec3(-ripple.x, 1.0, -ripple.y));
    vec3 glint = vec3(0.0);
    if (uLamp > 0.0) {
      vec3 toLamp = normalize(uLampPos - vWorld);
      float mirror = pow(max(dot(reflect(view, surface), toLamp), 0.0), 220.0);
      glint = lampShade(lampOn(vec3(1.0), toLamp, vWorld) * mirror * fresnel * 40.0);
    }
    // The Moon and the Sun glitter off the waves: a path of broken light toward them.
    vec3 bounced = reflect(view, surface);
    float gain = nightGain();
    float moonPath = pow(max(dot(bounced, uMoonDir), 0.0), mix(500.0, 120.0, vSea)) * step(0.0, uMoonDir.y);
    float sunPath = pow(max(dot(bounced, uSunDir), 0.0), mix(500.0, 120.0, vSea)) * step(0.0, uSunDir.y);
    glint += shade(MOONLIT * uMoonLight * gain * moonPath * fresnel * 30.0 + vec3(1.0, 0.96, 0.9) * uSunLight * sunPath * fresnel * 2.0);
    // Waves never let water mirror the sky perfectly, which keeps a horizon line.
    vec3 color = mix(body, reflection, mix(0.3, 0.78, fresnel)) + glint;
    // Surf: where the sea meets the shore, each wave breaks into foam as it runs
    // up the sand, laced and torn, and thins out as it drains back.
    if (vSea > 0.2) {
      float edge = smoothstep(-12.0, -1.0, vCoast) * vSea;
      float lace = texture2D(uWaves, p * 0.3 + vec2(uTime * 0.015, uTime * 0.01)).z;
      float breaking = vSwash * (0.55 + 0.45 * max(vSurge, 0.0)) + 0.25 * max(-vSurge, 0.0) * (1.0 - vSwash);
      float foam = edge * smoothstep(0.35, 0.75, lace * 0.5 + breaking * 0.6 + edge * 0.15);
      // Foam is white: it scatters the whole sky's light as well as the Moon's.
      vec3 white = max(shade(lightOn(vec3(0.95), vec3(0.0, 1.0, 0.0))), reflection * 1.6);
      color = mix(color, white, foam * 0.9);
      alpha = max(alpha, foam * 0.9);
    }
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

// --- Constellation figures: thin arcs on the celestial sphere, fading at the horizon
// Constellation figures: whether one of their stars can be seen, the same test
// the stars themselves pass, plus the land, which can hide a star the sky shows.
const figureVisibility = /* glsl */ `
  uniform sampler2D uVisibility;
  uniform float uCloudDimming;
  uniform sampler2D uHorizon;
  uniform float uHorizonSize;
  uniform sampler2D uFigures;
  uniform float uFigureCount;
  uniform sampler2D uSegments;
  uniform float uSegmentCount;
  ${skyModel}

  float seenAt(vec3 d, float magnitude) {
    float azimuth = atan(d.x, -d.z) / (2.0 * PI);
    float land = texture2D(uHorizon, vec2(fract(azimuth) + 0.5 / uHorizonSize, 0.5)).r;
    float altitude = asin(clamp(d.y, -1.0, 1.0));
    if (d.y <= 0.0 || altitude < land + 0.004) return 0.0;
    vec4 visibility = texture2D(uVisibility, vec2(fract(azimuth + 1.0), altitude / (0.5 * PI)));
    float apparent = magnitude + uExtinction * airMass(d.y) + visibility.z * uCloudDimming;
    return smoothstep(visibility.y + 0.25, visibility.y - 0.25, apparent);
  }

  // Per figure: x, how shown it is; y, how lit up.
  vec4 figure(float index) {
    return texture2D(uFigures, vec2((index + 0.5) / uFigureCount, 0.5));
  }

  // Per line: whether it belongs to the shape being drawn.
  float kept(float index) {
    return texture2D(uSegments, vec2((index + 0.5) / uSegmentCount, 0.5)).r;
  }
`;

export const lineVertex = /* glsl */ `
  // Each piece of a figure line is a thin ribbon facing the screen: its two ends
  // (aStart, aEnd), which end this corner sits at (aAt) and on which side (aSide);
  // aFrom and aTo are the stars its whole line joins, aMagnitudes their brightness.
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aAt;
  attribute float aSide;
  attribute float aGap;
  attribute float aLength;
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute vec2 aMagnitudes;
  attribute float aFigure;
  attribute float aSegment;
  uniform mat3 uSky;
  uniform vec2 uResolution;
  uniform float uWidth;
  varying float vAltitude;
  varying float vGap;
  varying float vLength;
  varying float vSide;
  varying float vShown;
  varying float vLit;
  ${figureVisibility}
  void main() {
    vec4 state = figure(aFigure);
    // A line shows only while both its stars can be seen.
    vShown = state.x * kept(aSegment) * seenAt(normalize(uSky * aFrom), aMagnitudes.x) * seenAt(normalize(uSky * aTo), aMagnitudes.y);
    vLit = state.y;
    vec3 start = normalize(uSky * aStart);
    vec3 end = normalize(uSky * aEnd);
    vec4 a = projectionMatrix * modelViewMatrix * vec4(start * 380.0, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(end * 380.0, 1.0);
    if (vShown < 0.002 || a.w <= 0.0 || b.w <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 along = normalize((b.xy / b.w - a.xy / a.w) * uResolution + 1e-6);
    vec2 across = vec2(-along.y, along.x);
    vec4 here = mix(a, b, aAt);
    // The ribbon is three times the stroke wide, so its soft edges have room to fade;
    // a lit-up figure's strokes grow a little.
    here.xy += across * aSide * uWidth * (1.0 + 0.3 * vLit) * 1.5 / uResolution * 2.0 * here.w;
    gl_Position = here;
    vAltitude = mix(start.y, end.y, aAt);
    vGap = aGap;
    vLength = aLength;
    vSide = aSide;
  }
`;

export const lineFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uExposure;
  uniform vec3 uColor;
  uniform float uClear;
  uniform float uRamp;
  uniform float uHighlight;
  varying float vAltitude;
  varying float vGap;
  varying float vLength;
  varying float vSide;
  varying float vShown;
  varying float vLit;
  void main() {
    // A soft stroke: brightest along its middle, feathering out to nothing.
    float profile = exp(-9.0 * vSide * vSide);
    // Lines are evenly faint between their stars, and leave each star clear sky
    // with a soft fade, so none touches a star; short lines shrink the clearance.
    float clear = min(uClear, 0.25 * vLength);
    float fade = smoothstep(clear, clear + min(uRamp, 0.2 * vLength), vGap);
    float alpha = uOpacity * profile * fade * smoothstep(0.0, 0.12, vAltitude) * uExposure * vShown * (1.0 + uHighlight * vLit);
    gl_FragColor = vec4(uColor * alpha, 1.0);
    #include <colorspace_fragment>
  }
`;

// A lit-up figure's stars: each gets a soft glow, as if seen more keenly.
export const figureStarVertex = /* glsl */ `
  attribute float aMagnitude;
  attribute float aFigure;
  uniform mat3 uSky;
  uniform float uSize;
  uniform float uPixelRatio;
  varying float vAlpha;
  ${figureVisibility}
  void main() {
    vec3 d = normalize(uSky * position);
    vec4 state = figure(aFigure);
    vAlpha = state.x * state.y * seenAt(d, aMagnitude);
    if (vAlpha < 0.002) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(d * 390.0, 1.0);
    gl_PointSize = uSize * uPixelRatio * (0.85 + 0.15 * state.y);
  }
`;

export const figureStarFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uExposure;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    // A small, faint bloom, as if the star were seen a little more keenly.
    float halo = exp(-r * r * 10.0) * 0.12;
    gl_FragColor = vec4(uColor * halo * vAlpha * uExposure, 1.0);
    #include <colorspace_fragment>
  }
`;

// --- Visibility map: per direction (azimuth across, altitude up), the eye's
// limit, the instrument's reach and the cloud cover; read by every star.
export const visibilityVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const visibilityFragment = /* glsl */ `
  varying vec2 vUv;
  ${skyModel}
  void main() {
    float azimuth = vUv.x * 2.0 * PI;
    float altitude = vUv.y * 0.5 * PI;
    vec3 d = vec3(cos(altitude) * sin(azimuth), sin(altitude), -cos(altitude) * cos(azimuth));
    float sky = total(skySources(d));
    gl_FragColor = vec4(eyeLimit(sky), eyeLimit(sky * uSkyFactor) + uGain, cloudDensity(d), 1.0);
  }
`;

// --- Sky map: the four sky sources per direction, as log2(1 + nanolamberts),
// read by the sky dome (see skyLookup) instead of the model running per pixel.
export const skyMapFragment = /* glsl */ `
  varying vec2 vUv;
  ${skyModel}
  void main() {
    float azimuth = vUv.x * 2.0 * PI;
    float altitude = vUv.y * 0.5 * PI;
    vec3 d = vec3(cos(altitude) * sin(azimuth), sin(altitude), -cos(altitude) * cos(azimuth));
    gl_FragColor = log2(1.0 + skySources(d));
  }
`;

// --- Cloud map: the cloud layer's density per direction, once a frame.
export const cloudMapFragment = /* glsl */ `
  varying vec2 vUv;
  ${skyModel}
  void main() {
    float azimuth = vUv.x * 2.0 * PI;
    float altitude = vUv.y * 0.5 * PI;
    vec3 d = vec3(cos(altitude) * sin(azimuth), sin(altitude), -cos(altitude) * cos(azimuth));
    gl_FragColor = vec4(cloudDensity(d), 0.0, 0.0, 1.0);
  }
`;
