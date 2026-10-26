// Your place in 3D at true scale: the satellite photo on the real ground, buildings from their
// footprints and measured heights, measured trees, and the water as a surface you can see through.
//
// Light: a physical sky (three's Sky) with the sun where it really is over Nairobi at that
// hour, the same sky lighting every surface through an environment map, soft sun shadows,
// screen-space ambient occlusion so walls and streets get contact shadows, and AgX tone mapping.
//
// Loads in stages so a slow phone shows something early: ground and photo, then buildings and
// roads, then trees and water. `progress(f, text)` reports each stage.
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

// Eastleigh colours: plaster and paint on walls, mabati (iron sheet) roofs bare, rusted or
// painted, concrete on flat roofs. No orange: amber marks water at the door.
const WALLS = ['#e9e1cf', '#efece6', '#e6cdb4', '#e8dba8', '#c9d2d6', '#d9d3c7', '#efe7d6'];
const ROOFS_PITCHED = ['#9a9d9f', '#8b8f91', '#7d6455', '#6f3c33', '#4f6b5b', '#4d6178', '#56585c'];
const ROOFS_FLAT = ['#a7a49c', '#b8b4ab', '#9d9a92', '#c4c0b6'];

export async function placeScene({ stage, canvas, base, view = 'street', weather = 'clear', hour = 16.3, day = 300, progress }) {
  const say = progress ?? (() => {});
  say(0.08, 'Loading the ground');
  const [G, photo] = await Promise.all([fetch(`${base}-ground.json`).then((r) => r.json()), new THREE.TextureLoader().loadAsync(`${base}.jpg`)]);
  photo.colorSpace = THREE.SRGBColorSpace; photo.anisotropy = 8;
  const { grid: g, half: HALF } = G, G0 = G.ground0;
  const bil = (arr, x, z) => {
    const fx = Math.max(0, Math.min(g.w - 1.001, (x - g.x0) / g.dx)), fz = Math.max(0, Math.min(g.h - 1.001, (z - g.z0) / g.dz));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, A = (a, b) => arr[b * g.w + a];
    return (A(i, j) * (1 - tx) + A(i + 1, j) * tx) * (1 - tz) + (A(i, j + 1) * (1 - tx) + A(i + 1, j + 1) * tx) * tz;
  };
  const gy = (x, z) => bil(G.ground, x, z) - G0;

  // ---- renderer, sky, light
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = weather === 'storm' ? 0.85 : 1.0;
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
  scene.environmentIntensity = weather === 'storm' ? 0.55 : 0.75;
  const haze = weather === 'storm' ? new THREE.Color('#9aa3a8') : new THREE.Color('#c3cfd8');
  scene.fog = new THREE.FogExp2(haze, weather === 'storm' ? 0.00042 : 0.00016);

  const sun = new THREE.DirectionalLight('#fff1dc', weather === 'storm' ? 0.9 : 3.0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.6;
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
  let V = { ...views[view] }, drag = null, idle = true, prev = 0;
  stage.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, V.yaw, V.pitch]; idle = false; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (!drag) return; V.yaw = drag[2] - (e.clientX - drag[0]) * 0.006; V.pitch = Math.max(0.05, Math.min(1.4, drag[3] + (e.clientY - drag[1]) * 0.004)); });
  stage.addEventListener('pointerup', () => (drag = null));
  stage.addEventListener('wheel', (e) => { e.preventDefault(); V.dist = Math.max(60, Math.min(1800, V.dist * (1 + e.deltaY * 0.001))); }, { passive: false });

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.5, thickness: 4, scale: 1.4, samples: 16, distanceFallOff: 1 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(size).observe(stage); size();

  const tags = [], pv = new THREE.Vector3();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let onFrame = null, waterMat = null;
  function frame(t) {
    if (idle && !still) V.yaw += (t - prev) * 0.00001; prev = t;
    target.set(V.tx, gy(V.tx, V.tz) + 2, V.tz);
    camera.position.set(target.x + Math.sin(V.yaw) * Math.cos(V.pitch) * V.dist, target.y + Math.sin(V.pitch) * V.dist + 6, target.z + Math.cos(V.yaw) * Math.cos(V.pitch) * V.dist);
    camera.lookAt(target);
    // the shadow box follows what you look at, sized to the view, so shadows stay sharp
    const r = Math.min(1600, Math.max(250, V.dist * 0.9));
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 6000 }); sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(target); sun.position.copy(target).addScaledVector(sd, 2500);
    if (waterMat && !still) waterMat.normalMap.offset.set(t * 0.000012, t * 0.000008);
    onFrame?.(t);
    composer.render();
    for (const g2 of tags) {
      pv.copy(g2.p).project(camera);
      const off = pv.z > 1 || Math.abs(pv.x) > 1.1 || Math.abs(pv.y) > 1.1;
      g2.el.style.display = off ? 'none' : '';
      g2.el.style.left = ((pv.x + 1) / 2) * stage.clientWidth + 'px'; g2.el.style.top = ((1 - pv.y) / 2) * stage.clientHeight + 'px';
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- stage 2: buildings and roads
  say(0.4, 'Loading buildings and roads');
  const C = await fetch(`${base}-city.json`).then((r) => r.json());
  const bld = buildBuildings(C.buildings, gy);
  scene.add(bld.mesh);

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
  const L = await fetch(`${base}-life.json`).then((r) => r.json());
  scene.add(buildTrees(L.trees, gy));

  const n = 300, wgeo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, n, n); wgeo.rotateX(-Math.PI / 2);
  const wcol = new THREE.Float32BufferAttribute(new Float32Array(wgeo.attributes.position.count * 4), 4); wgeo.setAttribute('color', wcol);
  const ripple = makeRipple(); ripple.repeat.set(140, 140);
  // Brown-green where shallow, blue-grey where deep, and the sky reflects in it.
  waterMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, roughness: 0.03, metalness: 0, ior: 1.33, envMapIntensity: 1.8, clearcoat: 0.6, clearcoatRoughness: 0.02, normalMap: ripple, normalScale: new THREE.Vector2(0.25, 0.25), depthWrite: false });
  const water = new THREE.Mesh(wgeo, waterMat); water.renderOrder = 2; water.visible = false; scene.add(water);
  // floodwater is muddy: tea-brown where shallow, darker olive-grey where deep
  const shallow = new THREE.Color('#8d7a55'), mid = new THREE.Color('#6b6448'), deep = new THREE.Color('#3f4a42'), c = new THREE.Color();
  function setWater(cm) {
    if (!cm) { water.visible = false; bld.mark(null); return; }
    const p = wgeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.max(0, bil(cm, x, z) / 100);
      p.setY(i, gy(x, z) + d + 0.05);
      const a = Math.min(1, Math.max(0, (d - 0.03) / 0.1));
      c.lerpColors(shallow, mid, Math.min(1, d / 0.3)).lerp(deep, Math.max(0, Math.min(1, (d - 0.3) / 0.8)));
      wcol.setXYZW(i, c.r, c.g, c.b, a * (0.7 + 0.28 * Math.min(1, d / 0.4)));
    }
    p.needsUpdate = true; wcol.needsUpdate = true; wgeo.computeVertexNormals(); water.visible = true;
    bld.mark((x, z) => bil(cm, x, z) >= 10);
  }

  let lit = null;
  const peak = new Float32Array(g.w * g.h); for (const h of L.cm) for (let i = 0; i < peak.length; i++) peak[i] = Math.max(peak[i], h[i]);
  function lightRoads(names) {
    if (lit) { roadLayer.remove(...lit); lit = null; }
    if (!names?.length) return;
    const wetSeg = [], drySeg = [];
    for (const r of C.roads.filter((r) => names.includes(r.n))) for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
      (bil(peak, (ax + bx) / 2, (az + bz) / 2) >= 10 || bil(peak, ax, az) >= 10 || bil(peak, bx, bz) >= 10 ? wetSeg : drySeg).push({ p: [r.p[k], r.p[k + 1]] });
    }
    lit = [ribbons(drySeg, () => 16, '#2f9a5c', 2.5), ribbons(wetSeg, () => 16, '#d0342a', 2.6)];
    for (const m of lit) { m.renderOrder = 3; m.material.emissive = new THREE.Color(m.material.color).multiplyScalar(0.35); }
    roadLayer.add(...lit);
  }

  say(1, '');
  return {
    setWater, lightRoads, hours: L.cm.length, cmAt: (h) => L.cm[h], peak, start: L.start, roads: C.roads,
    depthAt: (cm, x, z) => Math.round(bil(cm, x, z)),
    tag(text, x, z, cls = '', lift = 4) { const el = document.createElement('div'); el.className = 'tag ' + cls; el.textContent = text; stage.append(el); tags.push({ el, p: new THREE.Vector3(x, gy(x, z) + lift, z) }); return el; },
    view(name, o = {}) { V = { ...views[name], ...o }; },
    onFrame: (fn) => (onFrame = fn),
  };
}

// ---- buildings: walls to the eaves, hip roofs on houses, flat roofs with a parapet on the rest.
// Walls carry storey lines and windows in the shader, from the height above the wall's foot
// (aRel) and the distance along the wall (aU). aKind: 0 wall, 1 pitched roof, 2 flat roof.
function buildBuildings(list, gy) {
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
  geo.setIndex(idx); geo.computeVertexNormals();
  const orig = Float32Array.from(col);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRel, aU, aKind; varying float vRel, vU, vKind; varying vec3 vWpos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRel = aRel; vU = aU; vKind = aKind; vWpos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vRel, vU, vKind; varying vec3 vWpos;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float winMask = 0.0;
        if (vKind < 0.5) {
          // walls: a darker foot (splash and dirt), storey lines, then windows
          float fl = vRel / 3.2, fw1 = fwidth(fl);
          float slab = (1.0 - smoothstep(0.0, 0.05 + fw1, fract(fl))) * step(1.0, fl) * (1.0 - smoothstep(0.15, 0.4, fw1));
          diffuseColor.rgb *= (1.0 - 0.14 * slab) * mix(0.72, 1.0, smoothstep(0.2, 1.4, vRel));
          vec2 wc = vec2(vU / 3.6, vRel / 3.2), fw = fwidth(wc);
          float detail = 1.0 - smoothstep(0.12, 0.3, max(fw.x, fw.y));
          vec2 cell = fract(wc);
          vec2 e = smoothstep(vec2(0.3) - fw, vec2(0.3) + fw, cell) * (1.0 - smoothstep(vec2(0.72, 0.8) - fw, vec2(0.72, 0.8) + fw, cell));
          winMask = e.x * e.y * step(1.0, wc.y) * step(0.15, h12(floor(wc) + floor(vWpos.xz * 0.05))) * detail;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.1, 0.12), winMask * 0.75);
        } else if (vKind < 1.5) {
          // pitched mabati: corrugation down the slope, fading out before it can shimmer
          vec3 nn = normalize(cross(dFdx(vWpos), dFdy(vWpos)));
          vec2 across = normalize(vec2(-nn.z, nn.x) + 1e-5);
          float c = dot(vWpos.xz, across) / 0.75, fc = fwidth(c);
          diffuseColor.rgb *= 1.0 - 0.1 * (0.5 + 0.5 * cos(c * 6.2832)) * (1.0 - smoothstep(0.2, 0.5, fc));
        } else {
          // flat concrete: soft stains
          diffuseColor.rgb *= 0.92 + 0.12 * h12(floor(vWpos.xz * 0.5));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, winMask); if (vKind > 0.5 && vKind < 1.5) roughnessFactor = 0.55;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  // amber roofs mark buildings with 10 cm of water or more at the door, as on Flood Check
  const amber = new THREE.Color('#f0a12e'), kindA = geo.attributes.aKind.array;
  function mark(wetAt) {
    roofRanges.forEach(([a, b2], k) => {
      const wet = wetAt && wetAt(...centres[k]);
      for (let i = a; i < b2; i++) if (kindA[i] > 0.5) {
        if (wet) colA.setXYZ(i, amber.r, amber.g, amber.b); else colA.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
      }
    });
    colA.needsUpdate = true;
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
