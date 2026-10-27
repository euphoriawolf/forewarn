// Your place in 3D at true scale: the satellite photo on the real ground, buildings from their
// footprints and measured heights, measured trees, and the water as a surface you can see through.
//
// Light: a physical sky (three's Sky) with the sun where it really is over Nairobi at that
// hour, the same sky lighting every surface through an environment map, soft sun shadows,
// screen-space ambient occlusion so walls and streets get contact shadows, and ACES tone mapping.
//
// Loads in stages so a slow phone shows something early: ground and photo, then buildings and
// roads, then trees and water. `progress(f, text)` reports each stage.
//
// quality: 'high' (ambient occlusion, 4096 shadows, up to 2x pixels) or 'low' for slow phones
// (no ambient occlusion, 1024 shadows, 1x pixels). The answer never waits for the 3D.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const LAT = -1.28;
// Sun direction (x east, y up, z south) for a day of the year and a local hour in Nairobi (UTC+3, 36.8 E).
function sunDir(dayOfYear, hour) {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81)) * (Math.PI / 180);
  const solarNoon = 12 + (45 - 36.86) / 15 + 0.12; // clock time of solar noon, with a small equation-of-time
  const H = (hour - solarNoon) * 15 * (Math.PI / 180), lat = LAT * (Math.PI / 180);
  const el = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// Realistic building tones anywhere: low-saturation concrete, render and stone at real-world
// brightness (albedo about 0.35 to 0.55), metal and tile roofs in greys and muted browns.
// No orange: amber marks water at the door.
const WALLS = ['#9b9893', '#a8a39a', '#b3aea4', '#8c8a86', '#a59d90', '#bab4a9', '#94918b', '#aaa49a', '#9fa2a3'];
const ROOFS_PITCHED = ['#6e6a66', '#5a5856', '#7a7470', '#6b5d55', '#4e5257', '#625a52'];
const ROOFS_FLAT = ['#8a8781', '#96928a', '#7e7b75', '#a09b92'];

// source: { ground(), photo(), city(), life() }, each a promise (see tiles.ts)
export async function placeScene({ stage, canvas, source, view = 'street', weather = 'clear', hour = 16.3, day = 300, quality = 'high', progress, onSettle, onView, drift = 0, start: startView }) {
  const low = quality === 'low';
  const say = progress ?? (() => {});
  say(0.08, 'Loading the ground');
  const [G, photoCanvas] = await Promise.all([source.ground(), source.photo()]);
  const photo = new THREE.CanvasTexture(photoCanvas);
  photo.colorSpace = THREE.SRGBColorSpace; photo.anisotropy = 8;
  const { grid: g, half: HALF } = G, G0 = G.ground0;
  const bil = (arr, x, z) => {
    const fx = Math.max(0, Math.min(g.w - 1.001, (x - g.x0) / g.dx)), fz = Math.max(0, Math.min(g.h - 1.001, (z - g.z0) / g.dz));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, A = (a, b) => arr[b * g.w + a];
    return (A(i, j) * (1 - tx) + A(i + 1, j) * tx) * (1 - tz) + (A(i, j + 1) * (1 - tx) + A(i + 1, j + 1) * tx) * tz;
  };
  const gy = (x, z) => bil(G.ground, x, z) - G0;
  // depth in the one 60 m square a point falls in, the same rule as Flood Check's API and the answer
  const cell = (arr, x, z) => { const i = Math.round((x - g.x0) / g.dx), j = Math.round((z - g.z0) / g.dz); return i < 0 || j < 0 || i >= g.w || j >= g.h ? 0 : arr[j * g.w + i]; };

  // ---- renderer, sky, light
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = weather === 'storm' ? 0.8 : 0.9;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);

  const sd = sunDir(day, hour);
  const setSky = (s) => {
    const u = s.material.uniforms;
    if (weather === 'storm') { u.turbidity.value = 18; u.rayleigh.value = 0.6; u.mieCoefficient.value = 0.03; u.mieDirectionalG.value = 0.6; }
    else { u.turbidity.value = 6; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8; }
    u.sunPosition.value.copy(sd); s.scale.setScalar(10000); return s;
  };
  scene.add(setSky(new Sky()));
  // the environment map is the same sky, so every reflection and the ambient light agree with it
  const envScene = new THREE.Scene(); envScene.add(setSky(new Sky()));
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0).texture;
  scene.environmentIntensity = weather === 'storm' ? 0.28 : 0.3; // the Sky shader is very bright: keep it a fill, not a second sun
  const haze = weather === 'storm' ? new THREE.Color('#9aa3a8') : new THREE.Color('#c3cfd8');
  scene.fog = new THREE.FogExp2(haze, weather === 'storm' ? 0.0003 : 0.0001);

  const sun = new THREE.DirectionalLight('#fff1dc', weather === 'storm' ? 0.8 : 2.4);
  sun.castShadow = true; sun.shadow.mapSize.set(low ? 1024 : 4096, low ? 1024 : 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  // ---- ground: the photo on the real heights, plain land beyond it so there is no edge
  {
    const n = 300, geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, n, n); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, gy(p.getX(i), p.getZ(i)));
    geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: photo, roughness: 0.95, envMapIntensity: 0.6 }));
    land.receiveShadow = true; scene.add(land);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ color: '#7a7866', roughness: 1 }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.y = Math.min(...G.ground) - G0 - 1; scene.add(skirt);
  }

  // ---- camera and post
  const target = new THREE.Vector3();
  const views = {
    street: { yaw: 2.35, pitch: 0.2, dist: 300, tx: 0, tz: 0 },
    overview: { yaw: 2.6, pitch: 0.6, dist: 1150, tx: 0, tz: 40 },
    roads: { yaw: 2.9, pitch: 0.9, dist: 1050, tx: -120, tz: 120 },
  };
  let V = { ...views[view], ...(startView ?? {}) }, prev = 0;
  // Controls work like Google Maps. Touch: one finger drags the ground, two fingers pinch to zoom and
  // twist to turn around the point between them, two fingers moved up or down together tilt, a
  // double tap zooms in. Mouse: drag moves, right drag or Ctrl/Shift drag turns and tilts, the wheel
  // (or a trackpad pinch) zooms on the pointer, a double click zooms in. A drag that is let go while
  // moving glides to a stop. Moving stops at the edge of what is loaded, and onSettle(x, z) reports
  // where the view came to rest, so the page can load the next tiles.
  const limit = HALF - 150;
  const clampV = () => {
    V.tx = Math.max(-limit, Math.min(limit, V.tx)); V.tz = Math.max(-limit, Math.min(limit, V.tz));
    V.dist = Math.max(60, Math.min(2200, V.dist)); V.pitch = Math.max(0.12, Math.min(1.45, V.pitch));
  };
  const place = () => {
    target.set(V.tx, gy(V.tx, V.tz) + 2, V.tz);
    camera.position.set(target.x + Math.sin(V.yaw) * Math.cos(V.pitch) * V.dist, target.y + Math.sin(V.pitch) * V.dist + 6, target.z + Math.cos(V.yaw) * Math.cos(V.pitch) * V.dist);
    camera.lookAt(target); camera.updateMatrixWorld();
  };
  // the point on the ground (a level plane at height h) under a screen point, or null near the horizon
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
  const groundAt = (sx, sy, h) => {
    const r = stage.getBoundingClientRect();
    ndc.set(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); plane.constant = -h;
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    return hit && hit.distanceTo(camera.position) < 7000 ? hit : null;
  };
  // keep the ground point `anchor` under the screen point (sx, sy)
  const pin = (anchor, sx, sy) => {
    place(); const hit = anchor && groundAt(sx, sy, anchor.y);
    if (hit) { V.tx += anchor.x - hit.x; V.tz += anchor.z - hit.z; clampV(); }
    place();
  };
  const zoomAt = (sx, sy, f) => { place(); const a = groundAt(sx, sy, target.y); V.dist *= f; clampV(); pin(a, sx, sy); };

  // every listener goes when the scene is disposed, so a reloaded scene does not answer twice
  const off = new AbortController(), on = { signal: off.signal };
  const pts = new Map(); let gesture = null, settle = null, glide = null, fly = null, zoomAnim = null, lastTap = null;
  const stop = () => { glide = null; fly = null; zoomAnim = null; clearTimeout(settle); };
  const settled = () => { clearTimeout(settle); settle = setTimeout(() => onSettle?.(V.tx, V.tz), 400); };
  const midOf = (p) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const begin = () => {
    const p = [...pts.values()];
    place();
    if (p.length === 1) {
      gesture = p[0].turn
        ? { kind: 'turn', x: p[0].x, y: p[0].y, yaw: V.yaw, pitch: V.pitch }
        : { kind: 'drag', anchor: groundAt(p[0].x, p[0].y, target.y), trail: [] };
    } else if (p.length >= 2) {
      const m = midOf(p);
      gesture = { kind: 'two', mode: null, p0: p.slice(0, 2).map((q) => ({ ...q })), d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), a: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), m, dist: V.dist, yaw: V.yaw, pitch: V.pitch, anchor: groundAt(m.x, m.y, target.y) };
    } else gesture = null;
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return; // buttons on the map keep their own clicks
    stop();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), turn: e.button === 2 || e.ctrlKey || e.shiftKey || e.metaKey });
    try { stage.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    begin();
  }, on);
  stage.addEventListener('pointermove', (e) => {
    const q = pts.get(e.pointerId); if (!q || !gesture) return;
    q.x = e.clientX; q.y = e.clientY;
    const p = [...pts.values()];
    if (gesture.kind === 'drag') {
      pin(gesture.anchor, q.x, q.y);
      gesture.trail.push({ t: performance.now(), x: V.tx, z: V.tz }); if (gesture.trail.length > 6) gesture.trail.shift();
    } else if (gesture.kind === 'turn') {
      V.yaw = gesture.yaw - (q.x - gesture.x) * 0.006; V.pitch = gesture.pitch + (q.y - gesture.y) * 0.004; clampV(); place();
    } else if (p.length >= 2) {
      const [a0, b0] = gesture.p0, dya = p[0].y - a0.y, dyb = p[1].y - b0.y, dxa = p[0].x - a0.x, dxb = p[1].x - b0.x;
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), ang = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), m = midOf(p);
      // decide once per gesture: both fingers going up or down together is a tilt, anything else moves the map
      if (!gesture.mode && Math.max(Math.abs(dya), Math.abs(dyb), Math.abs(dxa), Math.abs(dxb), Math.abs(d - gesture.d)) > 10) {
        const together = Math.sign(dya) === Math.sign(dyb) && Math.abs(dya) > 6 && Math.abs(dyb) > 6;
        gesture.mode = together && Math.abs(dya) > 2 * Math.abs(dxa) && Math.abs(dyb) > 2 * Math.abs(dxb) && Math.abs(d - gesture.d) < 30 ? 'tilt' : 'map';
      }
      if (gesture.mode === 'tilt') { V.pitch = gesture.pitch + (m.y - gesture.m.y) * 0.005; clampV(); pin(gesture.anchor, gesture.m.x, gesture.m.y); }
      else if (gesture.mode === 'map') {
        V.dist = gesture.dist * (gesture.d / Math.max(20, d));
        let da = ang - gesture.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        V.yaw = gesture.yaw + da; clampV();
        pin(gesture.anchor, m.x, m.y);
      }
    }
  }, on);
  const end = (e) => {
    const q = pts.get(e.pointerId); if (!q) return;
    const g0 = gesture, now = performance.now();
    pts.delete(e.pointerId);
    // let go while moving: glide on with the speed of the last 100 ms
    if (g0?.kind === 'drag' && !pts.size) {
      const tr = g0.trail.filter((s) => now - s.t < 100);
      if (tr.length >= 2) { const a = tr[0], b = tr.at(-1), dt = Math.max(16, b.t - a.t); glide = { vx: (b.x - a.x) / dt, vz: (b.z - a.z) / dt }; }
    }
    // a double tap zooms in on the spot
    const tap = Math.hypot(q.x - q.x0, q.y - q.y0) < 8 && now - q.t0 < 300;
    if (tap && e.pointerType === 'touch') {
      if (lastTap && now - lastTap.t < 320 && Math.hypot(q.x - lastTap.x, q.y - lastTap.y) < 30) { zoomAnim = { x: q.x, y: q.y, f: 0.5, t0: now, done: 0 }; lastTap = null; }
      else lastTap = { t: now, x: q.x, y: q.y };
    }
    begin();
    if (!pts.size) { gesture = null; if (!glide && !zoomAnim) settled(); }
  };
  stage.addEventListener('pointerup', end, on); stage.addEventListener('pointercancel', end, on);
  stage.addEventListener('contextmenu', (e) => e.preventDefault(), on);
  stage.addEventListener('dblclick', (e) => { if (e.target !== canvas) return; stop(); zoomAnim = { x: e.clientX, y: e.clientY, f: e.shiftKey ? 2 : 0.5, t0: performance.now(), done: 0 }; }, on);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault(); stop();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    zoomAt(e.clientX, e.clientY, Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015))); touch(); settled();
  }, { passive: false, signal: off.signal });
  // the buttons on the map: zoom on the centre, and point north again
  const centre = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + (r.height - inset) / 2 }; };

  // Draw only when something changes: a still map costs nothing, so the page around it (the chat sheet)
  // stays smooth. While the view moves, frames skip ambient occlusion; one full frame follows when it stops.
  let ao = null, dirty = true, wasActive = false, shadowsDrawn = false;
  const touch = () => { dirty = true; };
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: low ? 0 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  if (!low) {
    ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.5, thickness: 4, scale: 1.4, samples: 16, distanceFallOff: 1 });
    ao.blendIntensity = 1.0;
    composer.addPass(ao);
  }
  composer.addPass(new OutputPass());
  // inset: how many pixels at the bottom a sheet covers. The picture shifts up by half of it (a view
  // offset, not a resize), so the place stays centred in what can be seen, and it eases there
  let inset = 0, insetGoal = 0;
  const offset = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (Math.abs(inset) < 0.5) camera.clearViewOffset(); else camera.setViewOffset(w, h, 0, inset / 2, w, h);
  };
  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; offset(); camera.updateProjectionMatrix(); dirty = true;
  };
  new ResizeObserver(size).observe(stage); size();

  const tags = [], pv = new THREE.Vector3();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let onFrame = null, waterMat = null;
  let alive = true;
  function frame(t) {
    if (!alive) return;
    const dt = Math.min(64, t - (prev || t)); prev = t;
    if (glide) {
      V.tx += glide.vx * dt; V.tz += glide.vz * dt; clampV();
      const k = Math.exp(-dt / 320); glide.vx *= k; glide.vz *= k;
      if (Math.hypot(glide.vx, glide.vz) < 0.005) { glide = null; settled(); }
    }
    if (zoomAnim) {
      const f = Math.min(1, (t - zoomAnim.t0) / 260), e2 = 1 - (1 - f) ** 3;
      zoomAt(zoomAnim.x, zoomAnim.y, Math.pow(zoomAnim.f, e2 - zoomAnim.done)); zoomAnim.done = e2;
      if (f >= 1) { zoomAnim = null; settled(); }
    }
    if (fly) {
      // fly to a view the page asked for, easing every part of the camera together
      const k = 1 - Math.exp(-dt / 170); let near = true;
      for (const key of ['tx', 'tz', 'dist', 'pitch', 'yaw']) {
        let d = fly[key] - V[key]; if (key === 'yaw') d = Math.atan2(Math.sin(d), Math.cos(d));
        V[key] += d * k; if (Math.abs(d) > (key === 'dist' || key === 'tx' || key === 'tz' ? 0.5 : 0.002)) near = false;
      }
      if (near) { Object.assign(V, fly); fly = null; settled(); }
    }
    if (drift && !gesture && !fly) V.yaw += dt * drift; // a slow turn, for the film
    if (Math.abs(insetGoal - inset) > 0.5) { inset += (insetGoal - inset) * (1 - Math.exp(-dt / 140)); offset(); }
    else if (inset !== insetGoal) { inset = insetGoal; offset(); }
    const active = !!(pts.size || glide || zoomAnim || fly || onFrame || (drift && !still) || inset !== insetGoal);
    if (wasActive && !active) dirty = true; // the full-quality frame once it stops
    wasActive = active;
    if (active || dirty) {
      dirty = false;
      place();
      onView?.(V.yaw);
      // the shadow box follows what you look at, sized to the view, so shadows stay sharp
      const r = Math.min(1600, Math.max(250, V.dist * 0.9));
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 6000 }); sun.shadow.camera.updateProjectionMatrix();
      sun.target.position.copy(target); sun.position.copy(target).addScaledVector(sd, 2500);
      if (waterMat && !still && active) waterMat.normalMap.offset.set(t * 0.000012, t * 0.000008);
      onFrame?.(t);
      if (ao) ao.enabled = !active;
      // shadows: kept from the last still frame while the view moves, redrawn when it stops
      renderer.shadowMap.autoUpdate = !active || !shadowsDrawn; shadowsDrawn = true;
      composer.render();
      for (const g2 of tags) {
        pv.copy(g2.p).project(camera);
        const off = pv.z > 1 || Math.abs(pv.x) > 1.1 || Math.abs(pv.y) > 1.1;
        g2.el.style.display = off ? 'none' : '';
        g2.el.style.left = ((pv.x + 1) / 2) * stage.clientWidth + 'px'; g2.el.style.top = ((1 - pv.y) / 2) * stage.clientHeight + 'px';
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- stage 2: buildings and roads
  say(0.4, 'Loading buildings and roads');
  const C = await source.city();
  const bld = buildBuildings(C.buildings, gy, photo, HALF);
  scene.add(bld.mesh); touch();

  const roadLayer = new THREE.Group(); scene.add(roadLayer);
  function ribbons(roads, width, color, lift, opacity = 1) {
    const pos = [];
    for (const rd of roads) {
      const w = width(rd);
      for (let k = 0; k < rd.p.length - 1; k++) {
        const [ax, az] = rd.p[k], [bx, bz] = rd.p[k + 1], L = Math.hypot(bx - ax, bz - az) || 1, steps = Math.max(1, Math.ceil(L / 15));
        const nx = (-(bz - az) / L) * w / 2, nz = ((bx - ax) / L) * w / 2;
        for (let s = 0; s < steps; s++) {
          const x0 = ax + ((bx - ax) * s) / steps, z0 = az + ((bz - az) * s) / steps, x1 = ax + ((bx - ax) * (s + 1)) / steps, z1 = az + ((bz - az) * (s + 1)) / steps;
          const q = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz]].map(([x, z]) => [x, gy(x, z) + lift, z]);
          pos.push(...q[0], ...q[1], ...q[2], ...q[1], ...q[3], ...q[2]);
        }
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: opacity >= 1 }));
    m.receiveShadow = true; return m;
  }
  // asphalt, so the street grid reads at street level; the photo shows through a little
  roadLayer.add(ribbons(C.roads, (r) => (r.k === 'secondary' ? 11 : r.k === 'tertiary' ? 9 : 6.5), '#4a4a48', 0.15, 0.72));

  // ---- stage 3: trees and water
  say(0.72, 'Loading trees and the March water');
  const L = await source.life();
  scene.add(buildTrees(L.trees, gy)); touch();

  const n = 300, wgeo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, n, n); wgeo.rotateX(-Math.PI / 2);
  const wcol = new THREE.Float32BufferAttribute(new Float32Array(wgeo.attributes.position.count * 4), 4); wgeo.setAttribute('color', wcol);
  const ripple = makeRipple(); ripple.repeat.set(140, 140);
  // Brown-green where shallow, blue-grey where deep, and the sky reflects in it.
  waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.18, metalness: 0, envMapIntensity: 0.7, normalMap: ripple, normalScale: new THREE.Vector2(0.18, 0.18), depthWrite: false, emissive: new THREE.Color('#0b3d91'), emissiveIntensity: 0.18 });
  const water = new THREE.Mesh(wgeo, waterMat); water.renderOrder = 2; water.visible = false; scene.add(water);
  // Flood Check's water: pale cyan where shallow, bright blue, then deep blue; easy to read from above
  const shallow = new THREE.Color('#8cd9ff'), mid = new THREE.Color('#1a8cf2'), deep = new THREE.Color('#0838a0'), c = new THREE.Color();
  const DEPTH_V = 4; // water is drawn 4 times thicker than real, so 25 cm still shows from 400 m (the legend says so)
  function setWater(cm) {
    touch();
    if (!cm) { water.visible = false; bld.mark(null); return; }
    const p = wgeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.max(0, bil(cm, x, z) / 100);
      p.setY(i, gy(x, z) + d * DEPTH_V + 0.15);
      const a = Math.min(1, Math.max(0, (d - 0.03) / 0.07));
      c.lerpColors(shallow, mid, Math.min(1, d / 0.25)).lerp(deep, Math.max(0, Math.min(1, (d - 0.35) / 0.65)));
      wcol.setXYZW(i, c.r, c.g, c.b, a * (0.82 + 0.14 * Math.min(1, d / 0.5)));
    }
    p.needsUpdate = true; wcol.needsUpdate = true; wgeo.computeVertexNormals(); water.visible = true;
    bld.mark((x, z) => bil(cm, x, z) >= 10);
  }

  let lit = null;
  const peak = new Float32Array(g.w * g.h); for (const h of L.cm) for (let i = 0; i < peak.length; i++) peak[i] = Math.max(peak[i], h[i]);
  function lightRoads(names) {
    touch();
    if (lit) { roadLayer.remove(...lit); lit = null; }
    if (!names?.length) return;
    const wetSeg = [], drySeg = [];
    for (const r of C.roads.filter((r) => names.includes(r.n))) for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
      (cell(peak, (ax + bx) / 2, (az + bz) / 2) >= 10 || cell(peak, ax, az) >= 10 || cell(peak, bx, bz) >= 10 ? wetSeg : drySeg).push({ p: [r.p[k], r.p[k + 1]] });
    }
    lit = [ribbons(drySeg, () => 24, '#2f9a5c', 2.5), ribbons(wetSeg, () => 24, '#d0342a', 2.6)];
    for (const m of lit) { m.renderOrder = 3; m.material.emissive = new THREE.Color(m.material.color).multiplyScalar(0.35); }
    roadLayer.add(...lit);
  }

  say(1, ''); touch();
  return {
    setWater, lightRoads, hours: L.cm.length, cmAt: (h) => L.cm[h], peak, start: L.start, roads: C.roads,
    depthAt: (cm, x, z) => Math.round(cell(cm, x, z)),
    tag(text, x, z, cls = '', lift = 4) { const el = document.createElement('div'); el.className = 'tag ' + cls; el.textContent = text; stage.append(el); tags.push({ el, p: new THREE.Vector3(x, gy(x, z) + lift, z) }); touch(); return el; },
    view(name, o = {}) { stop(); fly = { ...views[name], ...o }; },
    zoom(f) { stop(); const c = centre(); zoomAnim = { x: c.x, y: c.y, f, t0: performance.now(), done: 0 }; },
    north() { stop(); fly = { ...V, yaw: 0 }; },
    setInset(px) { insetGoal = Math.max(0, px); },
    camera: () => ({ ...V }),
    dispose() { alive = false; off.abort(); clearTimeout(settle); for (const t of tags) t.el.remove(); renderer.dispose(); },
    onFrame: (fn) => (onFrame = fn),
  };
}

// ---- buildings: walls to the eaves, hip roofs on houses, flat roofs with a parapet on the rest.
// Walls carry storey lines and windows in the shader, from the height above the wall's foot
// (aRel) and the distance along the wall (aU). aKind: 0 wall, 1 pitched roof, 2 flat roof.
// Roofs take their colour from the satellite photo straight above them (the photo only sees roofs),
// mixed with a little of the palette so a roof still reads as a roof where the photo is blurred.
function buildBuildings(list, gy, photo, HALF) {
  const pos = [], col = [], rel = [], wu = [], idx = [], kind = [], centres = [], roofRanges = [];
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hex = (h) => new THREE.Color(h), cw = WALLS.map(hex), crp = ROOFS_PITCHED.map(hex), crf = ROOFS_FLAT.map(hex);
  const push = (x, y, z, c, r, u, k) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); rel.push(r); wu.push(u); kind.push(k); return pos.length / 3 - 1; };
  const walls = (ring, y0, y1, r0, wall) => {
    let u = 0;
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length], len = Math.hypot(bx - ax, bz - az);
      const a0 = push(ax, y0, az, wall, r0, u, 0), a1 = push(ax, y1, az, wall, r0 + y1 - y0, u, 0);
      const b0 = push(bx, y0, bz, wall, r0, u + len, 0), b1 = push(bx, y1, bz, wall, r0 + y1 - y0, u + len, 0);
      idx.push(a0, b0, a1, b0, b1, a1); u += len;
    }
  };
  for (const b of list) {
    let ring = b.p;
    if (ring.length > 2 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1);
    if (ring.length < 3) continue;
    let area = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    if (area > 0) ring = [...ring].reverse(); area = Math.abs(area / 2);
    const n = ring.length, cx = ring.reduce((a, p) => a + p[0], 0) / n, cz = ring.reduce((a, p) => a + p[1], 0) / n;
    const H = b.h > 0 ? b.h : 3 + Math.floor(rnd() * 3) * 3;
    const foot = Math.min(...ring.map(([x, z]) => gy(x, z))) - 0.4, top = gy(cx, cz) + H;
    const box = H <= 9 && area >= 15 && area <= 450 ? orientedBox(ring, cx, cz) : null;
    const hip = box && area / box.A >= 0.82;
    const eave = hip ? top - Math.min(2.2, box.short * 0.3) : top;
    const wall = cw[Math.floor(rnd() * cw.length)].clone().multiplyScalar(0.94 + rnd() * 0.08);
    walls(ring, foot, eave, 0, wall);
    const r0 = pos.length / 3;
    if (hip) {
      const roof = crp[Math.floor(rnd() * crp.length)];
      const { ux, uz, vx, vz, amin, amax, bmin, bmax } = box, o = 0.35; // eaves overhang
      const P = (a, b2, y) => [cx + ux * a + vx * b2, y, cz + uz * a + vz * b2];
      const longA = amax - amin >= bmax - bmin;
      const c4 = [P(amin - o, bmin - o, eave), P(amax + o, bmin - o, eave), P(amax + o, bmax + o, eave), P(amin - o, bmax + o, eave)];
      const mb = (bmin + bmax) / 2, ma = (amin + amax) / 2, half = (longA ? bmax - bmin : amax - amin) / 2;
      const ridge = longA ? [P(amin + half, mb, top), P(amax - half, mb, top)] : [P(ma, bmin + half, top), P(ma, bmax - half, top)];
      const [p0, p1, p2, p3, q0, q1] = [...c4, ...ridge].map(([x, y, z]) => push(x, y, z, roof, -1, 0, 1));
      if (longA) idx.push(p0, q1, p1, p0, q0, q1, p2, q0, p3, p2, q1, q0, p1, q1, p2, p3, q0, p0);
      else idx.push(p1, q1, p2, p1, q0, q1, p3, q0, p0, p3, q1, q0, p0, q0, p1, p2, q1, p3);
    } else {
      const roof = crf[Math.floor(rnd() * crf.length)];
      const v = ring.map(([x, z]) => push(x, top, z, roof, -1, 0, 2));
      for (const [a, b2, d] of THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])) idx.push(v[a], v[d], v[b2]);
      walls(ring, top, top + 0.6, top - foot, wall); // a low parapet, so flat roofs read as concrete slabs
    }
    roofRanges.push([r0, pos.length / 3]); centres.push([cx, cz]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const colA = new THREE.Float32BufferAttribute(col, 3); geo.setAttribute('color', colA);
  geo.setAttribute('aRel', new THREE.Float32BufferAttribute(rel, 1));
  geo.setAttribute('aU', new THREE.Float32BufferAttribute(wu, 1));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const wetA = new THREE.Float32BufferAttribute(new Float32Array(kind.length), 1); geo.setAttribute('aWet', wetA);
  geo.setIndex(idx); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.45 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPhoto = { value: photo }; sh.uniforms.uHalf = { value: HALF };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRel, aU, aKind, aWet; varying float vRel, vU, vKind, vWet; varying vec3 vWpos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRel = aRel; vU = aU; vKind = aKind; vWet = aWet; vWpos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vRel, vU, vKind, vWet; varying vec3 vWpos; uniform sampler2D uPhoto; uniform float uHalf;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float winMask = 0.0;
        if (vKind < 0.5) {
          // walls: a darker foot (splash and dirt), storey lines, then windows
          float fl = vRel / 3.2, fw1 = fwidth(fl);
          float slab = (1.0 - smoothstep(0.0, 0.05 + fw1, fract(fl))) * step(1.0, fl) * (1.0 - smoothstep(0.15, 0.4, fw1));
          diffuseColor.rgb *= (1.0 - 0.18 * slab) * mix(0.62, 1.0, smoothstep(0.2, 2.0, vRel));
          vec2 wc = vec2(vU / 3.6, vRel / 3.2), fw = fwidth(wc);
          float detail = 1.0 - smoothstep(0.12, 0.3, max(fw.x, fw.y));
          vec2 cell = fract(wc);
          vec2 e = smoothstep(vec2(0.3) - fw, vec2(0.3) + fw, cell) * (1.0 - smoothstep(vec2(0.72, 0.8) - fw, vec2(0.72, 0.8) + fw, cell));
          winMask = e.x * e.y * step(1.0, wc.y) * step(0.15, h12(floor(wc) + floor(vWpos.xz * 0.05))) * detail;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.1, 0.12), winMask * 0.75);
        } else {
          // roofs: the photo above, decoded from sRGB, then amber where water reached the door
          vec3 seen = pow(texture2D(uPhoto, vec2((vWpos.x + uHalf) / (2.0 * uHalf), (uHalf - vWpos.z) / (2.0 * uHalf))).rgb, vec3(2.2));
          diffuseColor.rgb = mix(mix(diffuseColor.rgb, seen * 1.15, 0.8), vec3(0.93, 0.38, 0.03), vWet);
        }
        if (vKind > 0.5 && vKind < 1.5) {
          // pitched mabati: corrugation down the slope, fading out before it can shimmer
          vec3 nn = normalize(cross(dFdx(vWpos), dFdy(vWpos)));
          vec2 across = normalize(vec2(-nn.z, nn.x) + 1e-5);
          float c = dot(vWpos.xz, across) / 0.75, fc = fwidth(c);
          diffuseColor.rgb *= 1.0 - 0.1 * (0.5 + 0.5 * cos(c * 6.2832)) * (1.0 - smoothstep(0.2, 0.5, fc));
        } else if (vKind > 1.5) {
          // flat concrete: soft stains
          diffuseColor.rgb *= 0.92 + 0.12 * h12(floor(vWpos.xz * 0.5));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, winMask); if (vKind > 0.5 && vKind < 1.5) roughnessFactor = 0.55;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  // amber roofs mark buildings with 10 cm of water or more at the door, as on Flood Check
  const kindA = geo.attributes.aKind.array;
  function mark(wetAt) {
    roofRanges.forEach(([a, b2], k) => {
      const wet = wetAt && wetAt(...centres[k]);
      for (let i = a; i < b2; i++) if (kindA[i] > 0.5) wetA.setX(i, wet ? 1 : 0);
    });
    wetA.needsUpdate = true;
  }
  return { mesh, mark };
}

function orientedBox(ring, cx, cz) {
  let best = null;
  for (let p = 0; p < ring.length; p++) {
    const q = (p + 1) % ring.length, dx = ring[q][0] - ring[p][0], dz = ring[q][1] - ring[p][1], len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const ux = dx / len, uz = dz / len, vx = -uz, vz = ux;
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of ring) { const a = (x - cx) * ux + (z - cz) * uz, b = (x - cx) * vx + (z - cz) * vz; amin = Math.min(amin, a); amax = Math.max(amax, a); bmin = Math.min(bmin, b); bmax = Math.max(bmax, b); }
    const A = (amax - amin) * (bmax - bmin);
    if (!best || A < best.A) best = { A, ux, uz, vx, vz, amin, amax, bmin, bmax, short: Math.min(amax - amin, bmax - bmin) };
  }
  return best;
}

// ---- trees: lumpy crowns in a few shapes, leaf clumps and darker undersides in the vertex
// colours, a thin trunk, each tree sized to its measured height and spread.
function buildTrees(list, gy) {
  const group = new THREE.Group();
  const VARIANTS = 5, byV = Array.from({ length: VARIANTS }, () => []);
  list.forEach((t, k) => byV[k % VARIANTS].push(t));
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.5 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 });
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const o = new THREE.Object3D(), tint = new THREE.Color();
  for (let v = 0; v < VARIANTS; v++) {
    const geo = crown(v * 7.31 + 1);
    const leaves = new THREE.InstancedMesh(geo, leafMat, byV[v].length), trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, byV[v].length);
    byV[v].forEach(([x, z, h, s], k) => {
      const y = gy(x, z), H = Math.max(4, h), R = Math.max(1.6, Math.min(H * 0.45, (s || H * 0.6) / 2));
      const crownH = Math.min(H * 0.6, R * 1.5);
      o.position.set(x, y, z); o.rotation.set(0, (k * 2.4) % 6.28, 0); o.scale.set(1, H - crownH * 0.6, 1); o.updateMatrix(); trunks.setMatrixAt(k, o.matrix);
      o.position.set(x, y + H - crownH / 2, z); o.scale.set(R, crownH / 2, R); o.updateMatrix(); leaves.setMatrixAt(k, o.matrix);
      tint.setHSL(0.21 + ((k * 37) % 11) / 300, 0.3 + ((k * 7) % 5) / 40, 0.5 + ((k * 13) % 9) / 60); leaves.setColorAt(k, tint);
    });
    leaves.castShadow = trunks.castShadow = true; leaves.receiveShadow = true;
    group.add(leaves, trunks);
  }
  return group;
}
function crown(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 3), p = geo.attributes.position, col = [];
  const n3 = (x, y, z) => Math.sin(x * 3.1 + seed * 17) * Math.sin(y * 3.7 + seed * 5) * Math.sin(z * 2.9 + seed * 11);
  const n9 = (x, y, z) => Math.sin(x * 9.3 + seed) * Math.sin(y * 8.1 + seed * 3) * Math.sin(z * 9.7 + seed * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), lump = 1 + 0.2 * n3(x, y, z) + 0.07 * n9(x, y, z);
    p.setXYZ(i, x * lump, y * lump * (y < 0 ? 0.7 : 1), z * lump);
    // leaf clumps, and less light inside and underneath
    const clump = 0.5 + 0.5 * n9(x * 1.3, y * 1.3, z * 1.3), under = 0.45 + 0.55 * Math.min(1, Math.max(0, (y + 0.9) / 1.6));
    const k = under * (0.75 + 0.3 * clump) * 1.6;
    col.push(0.16 * k, 0.24 * k, 0.1 * k);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// a tiling normal map of soft noise, for small moving ripples on the water
function makeRipple() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), hgt = new Float32Array(S * S);
  for (let k = 0; k < 9; k++) { const fx = 1 + k, fy = 2 + ((k * 3) % 7), ph = k * 1.7; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] += Math.sin(((x * fx + y * fy) / S) * Math.PI * 2 + ph) / (k + 1); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)], dy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
    const v = new THREE.Vector3(-dx, -dy, 1.5).normalize(), o = (y * S + x) * 4;
    img.data[o] = (v.x * 0.5 + 0.5) * 255; img.data[o + 1] = (v.y * 0.5 + 0.5) * 255; img.data[o + 2] = (v.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
