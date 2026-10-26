// The place as a 3D model the agent can drive: real ground, roads and buildings, the March water
// hour by hour, and named roads lit by what the water did to them.
import * as THREE from 'three';

export async function makeScene({ stage, canvas, data }) {
  const { T, MAP, M } = data;
  const N = T.n, R = (N - 1) / 2 - 1, EX = 0.1, BASE = -2.5;
  const hAt = (x, z) => {
    const gx = Math.min(N - 1.001, Math.max(0, x + (N - 1) / 2)), gz = Math.min(N - 1.001, Math.max(0, z + (N - 1) / 2));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, H = (a, b) => T.h[b * N + a];
    return ((H(i, j) * (1 - fx) + H(i + 1, j) * fx) * (1 - fz) + (H(i, j + 1) * (1 - fx) + H(i + 1, j + 1) * fx) * fz) * EX;
  };
  const H0 = hAt(0, 0), gy = (x, z) => hAt(x, z) - H0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8d7f70', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.1); sun.position.set(-40, 70, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 200 }); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 500);
  const world = new THREE.Group(); scene.add(world);

  // land, sides, roads, buildings
  {
    const seg = 140, rings = 70, pos = [], col = [], idx = [], c = new THREE.Color(), open = new THREE.Color('#d3d8c6'), built = new THREE.Color('#b9b4a5');
    const bAt = (x, z) => { const i = Math.round(x + (N - 1) / 2), j = Math.round(z + (N - 1) / 2); return T.buildings[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))]; };
    const put = (x, z) => { pos.push(x, gy(x, z), z); c.lerpColors(open, built, Math.min(1, bAt(x, z) / 25)); col.push(c.r, c.g, c.b); };
    put(0, 0);
    for (let r = 1; r <= rings; r++) for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2, rr = (r / rings) * R; put(Math.cos(a) * rr, Math.sin(a) * rr); }
    const v = (r, s) => (r === 0 ? 0 : 1 + (r - 1) * seg + (s % seg));
    for (let s = 0; s < seg; s++) idx.push(0, v(1, s + 1), v(1, s));
    for (let r = 1; r < rings; r++) for (let s = 0; s < seg; s++) idx.push(v(r, s), v(r, s + 1), v(r + 1, s), v(r, s + 1), v(r + 1, s + 1), v(r + 1, s));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const land = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })); land.receiveShadow = true; world.add(land);
    const side = new THREE.CylinderGeometry(R, R, 1, seg, 1, true), sp = side.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) > 0 ? gy(sp.getX(i), sp.getZ(i)) : BASE);
    side.computeVertexNormals(); world.add(new THREE.Mesh(side, new THREE.MeshStandardMaterial({ color: '#7a4630', roughness: 1, side: THREE.DoubleSide })));
    const base = new THREE.Mesh(new THREE.CircleGeometry(R, seg), new THREE.MeshStandardMaterial({ color: '#5a3324' })); base.rotation.x = Math.PI / 2; base.position.y = BASE; world.add(base);
    world.add(ribbons(MAP.roads, (rd) => (rd.k === 'secondary' ? 0.55 : rd.k === 'tertiary' ? 0.42 : 0.26), 0.05, '#f4f2ea'));
    const box = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshStandardMaterial({ color: '#efeee8', roughness: 0.8 }), spots = [];
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const n = Math.min(4, Math.round(T.buildings[j * N + i] / 8));
      for (let k = 0; k < n; k++) { const x = i - (N - 1) / 2 + rnd() - 0.5, z = j - (N - 1) / 2 + rnd() - 0.5; if (x * x + z * z < (R - 1) ** 2) spots.push([x, z, 0.25 + rnd() * 0.35]); }
    }
    const inst = new THREE.InstancedMesh(box, mat, spots.length), o = new THREE.Object3D();
    spots.forEach(([x, z, h], k) => { o.position.set(x, gy(x, z) + h / 2, z); o.scale.set(0.42, h, 0.42); o.updateMatrix(); inst.setMatrixAt(k, o.matrix); });
    inst.castShadow = true; inst.receiveShadow = true; world.add(inst);
  }

  // flat ribbons laid on the ground; colour may be a function of the point (per-vertex colours)
  function ribbons(roads, width, lift, color) {
    const pos = [], col = [], c = new THREE.Color(), fixed = typeof color === 'string' ? new THREE.Color(color) : null;
    for (const rd of roads) {
      const w = width(rd);
      for (let k = 0; k < rd.p.length - 1; k++) {
        const [ax, az] = rd.p[k], [bx, bz] = rd.p[k + 1], L = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / L) * w / 2, nz = ((bx - ax) / L) * w / 2;
        const q = [[ax + nx, az + nz], [ax - nx, az - nz], [bx + nx, bz + nz], [bx - nx, bz - nz]].map(([x, z]) => [x, gy(x, z) + lift, z]);
        for (const p of [q[0], q[1], q[2], q[1], q[3], q[2]]) { pos.push(...p); if (fixed) c.copy(fixed); else c.set(color(rd, p[0], p[2])); col.push(c.r, c.g, c.b); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  }

  // March water
  const peakCm = new Int16Array(N * N); for (const h of M.cm) for (let i = 0; i < N * N; i++) if (h[i] > peakCm[i]) peakCm[i] = h[i];
  const cellAt = (x, z) => Math.max(0, Math.min(N - 1, Math.round(z) + 30)) * N + Math.max(0, Math.min(N - 1, Math.round(x) + 30));
  const water = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.88, roughness: 0.25 }));
  world.add(water);
  const shallow = new THREE.Color('#7fa3ef'), deep = new THREE.Color('#1d3fb8');
  function setWater(cm) {
    const pos = [], col = [], idx = [], c = new THREE.Color(), id = new Int32Array(N * N).fill(-1);
    if (cm) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const d = cm[j * N + i]; if (d < 4) continue;
        const x = i - (N - 1) / 2, z = j - (N - 1) / 2; if (x * x + z * z > (R - 0.3) ** 2) continue;
        id[j * N + i] = pos.length / 3; pos.push(x, gy(x, z) + 0.08 + (Math.min(d, 150) / 100) * 0.55, z);
        c.lerpColors(shallow, deep, Math.min(1, d / 80)); col.push(c.r, c.g, c.b);
      }
      for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
        const a = id[j * N + i], b = id[j * N + i + 1], cc = id[(j + 1) * N + i], d = id[(j + 1) * N + i + 1];
        if (a >= 0 && b >= 0 && cc >= 0) idx.push(a, cc, b);
        if (b >= 0 && cc >= 0 && d >= 0) idx.push(b, cc, d);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    water.geometry.dispose(); water.geometry = g;
  }

  // named roads lit: green where March left them dry, red where water stood
  let lit = null;
  function lightRoads(names) {
    if (lit) { world.remove(lit); lit.geometry.dispose(); lit = null; }
    if (!names?.length) return;
    const roads = MAP.roads.filter((r) => names.includes(r.n));
    const wetNear = (x, z) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (peakCm[cellAt(x + dx, z + dz)] >= 10) return true; return false; };
    lit = ribbons(roads, () => 1.1, 0.12, (rd, x, z) => (wetNear(x, z) ? '#b42318' : '#2f7d4f'));
    world.add(lit);
  }

  // tags that follow points in the scene
  const tags = [];
  function tag(text, x, z, cls = '') {
    const el = document.createElement('div'); el.className = 'tag ' + cls; el.textContent = text; stage.append(el);
    tags.push({ el, p: new THREE.Vector3(x, gy(x, z) + 0.4, z) }); return el;
  }
  const clearTags = () => { for (const t of tags) t.el.remove(); tags.length = 0; };

  // camera: drag to turn, slow drift when idle
  const target = new THREE.Vector3(0, -1, 0);
  let yaw = -0.5, pitch = 0.85, dist = 112, drag = null, idle = true;
  stage.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, yaw, pitch]; idle = false; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (!drag) return; yaw = drag[2] - (e.clientX - drag[0]) * 0.008; pitch = Math.max(0.35, Math.min(1.35, drag[3] + (e.clientY - drag[1]) * 0.006)); });
  stage.addEventListener('pointerup', () => (drag = null));
  const size = () => { renderer.setSize(stage.clientWidth, stage.clientHeight, false); camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix(); };
  new ResizeObserver(size).observe(stage); size();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const v = new THREE.Vector3(); let onFrame = null, prev = 0;
  function frame(t) {
    if (idle && !still) yaw += (t - prev) * 0.00002; prev = t;
    onFrame?.(t);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist); camera.lookAt(target);
    renderer.render(scene, camera);
    for (const g of tags) { v.copy(g.p).project(camera); g.el.style.left = ((v.x + 1) / 2) * stage.clientWidth + 'px'; g.el.style.top = ((1 - v.y) / 2) * stage.clientHeight + 'px'; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setWater, lightRoads, tag, clearTags, peakCm, cellAt,
    hours: M.cm.length, cmAt: (hour) => M.cm[hour],
    view: (o) => { if (o.yaw != null) yaw = o.yaw; if (o.pitch != null) pitch = o.pitch; if (o.dist != null) dist = o.dist; },
    onFrame: (fn) => (onFrame = fn),
    roadMid: (name) => { const pts = MAP.roads.filter((r) => r.n === name).flatMap((r) => r.p); return pts[Math.floor(pts.length / 2)]; },
  };
}
