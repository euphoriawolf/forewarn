// Your place in 3D at true scale: the satellite photo on the real ground, buildings from their
// footprints, measured trees, and the water as a surface you can see through.
// Loads in stages so a slow phone shows something early: ground and photo, then buildings and
// roads, then trees and water. A progress line in the stage says what is coming.
import * as THREE from 'three';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/environments/RoomEnvironment.js';

const SKY = new THREE.Color('#c9d3d6');

export async function placeScene({ stage, canvas, base, view = 'street', progress }) {
  const say = progress ?? (() => {});
  say(0.1, 'Loading the ground');
  const [G, photo] = await Promise.all([
    fetch(`${base}-ground.json`).then((r) => r.json()),
    new THREE.TextureLoader().loadAsync(`${base}.jpg`),
  ]);
  photo.colorSpace = THREE.SRGBColorSpace; photo.anisotropy = 8;
  const { grid: g, half: HALF } = G, G0 = G.ground0;

  // bilinear read of a 60 m cell grid at x, z (metres from the pin)
  const bil = (arr, x, z) => {
    const fx = Math.max(0, Math.min(g.w - 1.001, (x - g.x0) / g.dx)), fz = Math.max(0, Math.min(g.h - 1.001, (z - g.z0) / g.dz));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, A = (a, b) => arr[b * g.w + a];
    return (A(i, j) * (1 - tx) + A(i + 1, j) * tx) * (1 - tz) + (A(i, j + 1) * (1 - tx) + A(i + 1, j + 1) * tx) * tz;
  };
  const gy = (x, z) => bil(G.ground, x, z) - G0;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = SKY; scene.fog = new THREE.Fog(SKY, 700, 2600);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight('#f4f6ff', '#6b5a48', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e2', 2.4); sun.position.set(-300, 500, 200); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, near: 10, far: 1500 }); sun.shadow.bias = -0.0004;
  scene.add(sun); scene.add(sun.target);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 4000);

  // ground with the photo
  {
    const n = 240, geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, n, n); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, gy(p.getX(i), p.getZ(i)));
    geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: photo, roughness: 1 })); land.receiveShadow = true; scene.add(land);
  }

  // camera: drag to turn around the target; two set views
  const target = new THREE.Vector3();
  const views = {
    street: { yaw: 2.35, pitch: 0.24, dist: 320, tx: 0, tz: 0 },
    overview: { yaw: 2.6, pitch: 0.62, dist: 1150, tx: 0, tz: 40 },
    roads: { yaw: 2.9, pitch: 0.9, dist: 1050, tx: -120, tz: 120 },
  };
  let V = { ...views[view] }, drag = null, idle = true, prev = 0;
  stage.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, V.yaw, V.pitch]; idle = false; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (!drag) return; V.yaw = drag[2] - (e.clientX - drag[0]) * 0.006; V.pitch = Math.max(0.05, Math.min(1.4, drag[3] + (e.clientY - drag[1]) * 0.004)); });
  stage.addEventListener('pointerup', () => (drag = null));
  stage.addEventListener('wheel', (e) => { e.preventDefault(); V.dist = Math.max(60, Math.min(1600, V.dist * (1 + e.deltaY * 0.001))); }, { passive: false });
  const size = () => { renderer.setSize(stage.clientWidth, stage.clientHeight, false); camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix(); };
  new ResizeObserver(size).observe(stage); size();

  const tags = [], pv = new THREE.Vector3();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let water = null, ripple = null, onFrame = null;
  function frame(t) {
    if (idle && !still) V.yaw += (t - prev) * 0.000012; prev = t;
    target.set(V.tx, gy(V.tx, V.tz) + 2, V.tz);
    camera.position.set(target.x + Math.sin(V.yaw) * Math.cos(V.pitch) * V.dist, target.y + Math.sin(V.pitch) * V.dist + 6, target.z + Math.cos(V.yaw) * Math.cos(V.pitch) * V.dist);
    camera.lookAt(target);
    if (ripple && !still) { ripple.offset.set(t * 0.00002, t * 0.000013); }
    onFrame?.(t);
    renderer.render(scene, camera);
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
  let roofColor = null, bCenters = [];
  {
    const pos = [], col = [], idx = [], c = new THREE.Color();
    const wall = new THREE.Color('#ece7dc'), roofs = ['#8d9196', '#a4a7a8', '#7c6a5c', '#b8b5ad', '#94796a'].map((h) => new THREE.Color(h));
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const roofStart = [];
    for (const b of C.buildings) {
      let ring = b.p; if (ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
      if (ring.length < 3) continue;
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const h = b.h > 0 ? b.h : 3 + Math.floor(rnd() * 3) * 3; // unknown: 1 to 3 storeys, as Flood Check seeds them
      const y0 = Math.min(...ring.map(([x, z]) => gy(x, z))) - 0.3, y1 = gy(cx, cz) + h;
      const v0 = pos.length / 3;
      for (const [x, z] of ring) { pos.push(x, y0, z, x, y1, z); c.copy(wall).multiplyScalar(0.9); col.push(c.r, c.g, c.b); c.copy(wall); col.push(c.r, c.g, c.b); }
      const n = ring.length;
      for (let k = 0; k < n; k++) { const a = v0 + k * 2, b2 = v0 + ((k + 1) % n) * 2; idx.push(a, b2, a + 1, b2, b2 + 1, a + 1); }
      const r0 = pos.length / 3, rc = roofs[Math.floor(rnd() * roofs.length)];
      for (const [x, z] of ring) { pos.push(x, y1, z); col.push(rc.r, rc.g, rc.b); }
      const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b2, d] of tris) idx.push(r0 + a, r0 + d, r0 + b2);
      roofStart.push([r0, n, rc]); bCenters.push([cx, cz]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const colAttr = new THREE.Float32BufferAttribute(col, 3); geo.setAttribute('color', colAttr);
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    // amber roofs mark buildings with water at the door, as on Flood Check
    roofColor = (wet) => {
      const amber = new THREE.Color('#e7962a');
      roofStart.forEach(([r0, n, rc], k) => { const cc = wet[k] ? amber : rc; for (let i = 0; i < n; i++) colAttr.setXYZ(r0 + i, cc.r, cc.g, cc.b); });
      colAttr.needsUpdate = true;
    };
  }
  const roadLayer = new THREE.Group(); scene.add(roadLayer);
  function ribbons(roads, width, color, lift = 0.25, opacity = 1) {
    const pos = [];
    for (const rd of roads) {
      const w = width(rd);
      for (let k = 0; k < rd.p.length - 1; k++) {
        const [ax, az] = rd.p[k], [bx, bz] = rd.p[k + 1], L = Math.hypot(bx - ax, bz - az) || 1, steps = Math.max(1, Math.ceil(L / 20));
        for (let s = 0; s < steps; s++) {
          const x0 = ax + ((bx - ax) * s) / steps, z0 = az + ((bz - az) * s) / steps, x1 = ax + ((bx - ax) * (s + 1)) / steps, z1 = az + ((bz - az) * (s + 1)) / steps;
          const nx = (-(bz - az) / L) * w / 2, nz = ((bx - ax) / L) * w / 2;
          const q = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz]].map(([x, z]) => [x, gy(x, z) + lift, z]);
          pos.push(...q[0], ...q[1], ...q[2], ...q[1], ...q[3], ...q[2]);
        }
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: opacity < 1, opacity, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  }
  roadLayer.add(ribbons(C.roads, (r) => (r.k === 'secondary' ? 9 : r.k === 'tertiary' ? 7 : 5), '#d9d4c8', 0.2, 0.55));

  // ---- stage 3: trees and water
  say(0.75, 'Loading trees and the March water');
  const L = await fetch(`${base}-life.json`).then((r) => r.json());
  {
    const trunk = new THREE.CylinderGeometry(0.15, 0.22, 1, 5), crown = new THREE.IcosahedronGeometry(1, 2);
    const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 1 }), L.trees.length);
    const cm = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), L.trees.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    L.trees.forEach(([x, z, h, s], k) => {
      const y = gy(x, z), H = Math.max(4, h), Rr = Math.max(1.4, Math.min(H * 0.32, s / 2 || H * 0.3));
      o.position.set(x, y + H * 0.3, z); o.scale.set(1, H * 0.6, 1); o.rotation.set(0, 0, 0); o.updateMatrix(); tm.setMatrixAt(k, o.matrix);
      o.position.set(x, y + H - Rr * 0.8, z); o.scale.set(Rr * (0.9 + (k % 5) * 0.05), Rr * 0.7, Rr * (0.95 + (k % 3) * 0.05)); o.rotation.y = k; o.updateMatrix(); cm.setMatrixAt(k, o.matrix);
      c.setHSL(0.2 + ((k * 37) % 10) / 250, 0.22, 0.24 + ((k * 13) % 10) / 150); cm.setColorAt(k, c);
    });
    tm.castShadow = cm.castShadow = true; cm.receiveShadow = true; scene.add(tm, cm);
  }

  // water: a 10 m mesh, height = ground + depth, see-through where shallow, darker where deep
  const n = 300, wgeo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, n, n); wgeo.rotateX(-Math.PI / 2);
  const wcol = new THREE.Float32BufferAttribute(new Float32Array(wgeo.attributes.position.count * 4), 4); wgeo.setAttribute('color', wcol);
  ripple = makeRipple(); ripple.repeat.set(100, 100);
  water = new THREE.Mesh(wgeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, normalMap: ripple, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false }));
  water.renderOrder = 2; water.visible = false; scene.add(water);
  const shallow = new THREE.Color('#7fb2e5'), deep = new THREE.Color('#163f94'), c = new THREE.Color();
  function setWater(cm) {
    if (!cm) { water.visible = false; roofColor(bCenters.map(() => false)); return; }
    const p = wgeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.max(0, bil(cm, x, z) / 100);
      p.setY(i, gy(x, z) + d + 0.03);
      const a = Math.min(1, Math.max(0, (d - 0.03) / 0.12)) * 0.82; c.lerpColors(shallow, deep, Math.min(1, d / 0.9));
      wcol.setXYZW(i, c.r, c.g, c.b, a);
    }
    p.needsUpdate = true; wcol.needsUpdate = true; wgeo.computeVertexNormals(); water.visible = true;
    roofColor(bCenters.map(([x, z]) => bil(cm, x, z) >= 10));
  }

  // named roads lit by what March did to them
  let lit = null;
  const peak = new Float32Array(g.w * g.h); for (const h of L.cm) for (let i = 0; i < peak.length; i++) peak[i] = Math.max(peak[i], h[i]);
  function lightRoads(names) {
    if (lit) { roadLayer.remove(...lit); lit = null; }
    if (!names?.length) return;
    const roads = C.roads.filter((r) => names.includes(r.n)), wetSeg = [], drySeg = [];
    for (const r of roads) for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1], mx = (ax + bx) / 2, mz = (az + bz) / 2;
      (bil(peak, mx, mz) >= 10 || bil(peak, ax, az) >= 10 || bil(peak, bx, bz) >= 10 ? wetSeg : drySeg).push({ p: [r.p[k], r.p[k + 1]] });
    }
    lit = [ribbons(drySeg, () => 16, '#2f7d4f', 2.5), ribbons(wetSeg, () => 16, '#b42318', 2.6)];
    for (const m of lit) m.renderOrder = 3;
    roadLayer.add(...lit);
  }

  say(1, '');
  return {
    setWater, lightRoads, hours: L.cm.length, cmAt: (h) => L.cm[h], peak, start: L.start, roads: C.roads,
    depthAt: (cm, x, z) => Math.round(bil(cm, x, z)),
    tag(text, x, z, cls = '', lift = 4) { const el = document.createElement('div'); el.className = 'tag ' + cls; el.textContent = text; stage.append(el); const t = { el, p: new THREE.Vector3(x, gy(x, z) + lift, z) }; tags.push(t); return el; },
    view(name, o = {}) { V = { ...views[name], ...o }; },
    onFrame: (fn) => (onFrame = fn),
  };
}

// a tiling normal map of soft noise, for small moving ripples on the water
function makeRipple() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), hgt = new Float32Array(S * S);
  for (let k = 0; k < 6; k++) { const fx = 1 + k, fy = 2 + ((k * 3) % 5), ph = k * 1.7; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] += Math.sin(((x * fx + y * fy) / S) * Math.PI * 2 + ph) / (k + 1); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)], dy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
    const v = new THREE.Vector3(-dx, -dy, 2).normalize(), o = (y * S + x) * 4;
    img.data[o] = (v.x * 0.5 + 0.5) * 255; img.data[o + 1] = (v.y * 0.5 + 0.5) * 255; img.data[o + 2] = (v.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
