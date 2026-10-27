// Joins the four 2 km tiles around a pin (public/tiles, see tools/make-tiles.py) into one 4 km
// scene, in metres from the square's centre (x east, z south): the shape place3d.js draws.
// Each part is fetched once and shared, so the staged loading in place3d stays staged.

export interface PinInPack { region: string; tiles: [number, number][]; cx: number; cz: number; dx: number; dz: number; start: string }
interface Index { tile: number; cmx: number; cmz: number; hours: number; start: string }
interface TileGround { ci0: number; cj0: number; w: number; h: number; z: number[] }
interface TileCity { buildings: { h: number; p: [number, number][] }[]; roads: { k: string; n: string; p: [number, number][] }[] }
interface TileLife { trees: [number, number, number, number][]; water: { c: number; cm: number[] }[] }

export function tileSource(pin: PinInPack) {
  const base = `/tiles/${pin.region}`;
  const json = <T,>(u: string) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u} answered ${r.status}`); return r.json() as Promise<T>; });
  const index = json<Index>(`${base}/index.json`);
  const each = <T,>(f: string) => Promise.all(pin.tiles.map(([i, j]) => json<T>(`${base}/${i}_${j}/${f}`)));
  const grounds = each<TileGround>('ground.json');

  // one grid over all four tiles, on the region's 60 m cells
  const grid = Promise.all([index, grounds]).then(([ix, gs]) => {
    const ci0 = Math.min(...gs.map((g) => g.ci0)), cj0 = Math.min(...gs.map((g) => g.cj0));
    const w = Math.max(...gs.map((g) => g.ci0 + g.w)) - ci0, h = Math.max(...gs.map((g) => g.cj0 + g.h)) - cj0;
    return { ix, gs, ci0, cj0, w, h };
  });
  // tile-local half-metre steps to metres from the square's centre
  const local = (ix: Index, i: number, j: number) => ([x, z]: [number, number]): [number, number] => [i * ix.tile + x / 2 - pin.cx, j * ix.tile + z / 2 - pin.cz];

  return {
    half: 2000,
    async ground() {
      const { ix, gs, ci0, cj0, w, h } = await grid;
      const z = new Float64Array(w * h).fill(NaN);
      for (const g of gs) for (let jj = 0; jj < g.h; jj++) for (let ii = 0; ii < g.w; ii++) z[(g.cj0 - cj0 + jj) * w + (g.ci0 - ci0 + ii)] = g.z[jj * g.w + ii];
      // a missing tile (lagoon, forest: nothing built) takes the lowest ground around it
      let lo = Infinity; for (const v of z) if (!Number.isNaN(v) && v < lo) lo = v;
      const ground = Array.from(z, (v) => (Number.isNaN(v) ? lo : v));
      const gridOut = { x0: (ci0 + 0.5) * ix.cmx - pin.cx, z0: (cj0 + 0.5) * ix.cmz - pin.cz, dx: ix.cmx, dz: ix.cmz, w, h };
      const pi = Math.round((pin.dx - gridOut.x0) / ix.cmx), pj = Math.round((pin.dz - gridOut.z0) / ix.cmz);
      return { grid: gridOut, ground, ground0: ground[Math.max(0, Math.min(h - 1, pj)) * w + Math.max(0, Math.min(w - 1, pi))], half: 2000 };
    },
    async photo() {
      const ix = await index;
      const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
      const ctx = cv.getContext('2d')!; ctx.fillStyle = '#7a7866'; ctx.fillRect(0, 0, 1024, 1024);
      const i0 = Math.round(pin.cx / ix.tile) - 1, j0 = Math.round(pin.cz / ix.tile) - 1;
      await Promise.all(pin.tiles.map(([i, j]) => new Promise<void>((done) => {
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => { ctx.drawImage(im, (i - i0) * 512, (j - j0) * 512, 512, 512); done(); };
        im.onerror = () => done();
        im.src = `${base}/${i}_${j}/photo.jpg`;
      })));
      return cv;
    },
    async city() {
      const ix = await index, cs = await each<TileCity>('city.json');
      const buildings = cs.flatMap((c, k) => { const f = local(ix, ...pin.tiles[k]); return c.buildings.map((b) => ({ h: b.h, p: b.p.map(f) })); });
      const roads = cs.flatMap((c, k) => { const f = local(ix, ...pin.tiles[k]); return c.roads.map((r) => ({ k: r.k, n: r.n, p: r.p.map(f) })); });
      return { buildings, roads };
    },
    async life() {
      const { ix, gs, ci0, cj0, w, h } = await grid, ls = await each<TileLife>('life.json');
      const trees = ls.flatMap((l, k) => { const f = local(ix, ...pin.tiles[k]); return l.trees.map(([x, z, ht, s]) => [...f([x, z]), ht, s / 10]); });
      const cm = Array.from({ length: ix.hours }, () => new Array<number>(w * h).fill(0));
      ls.forEach((l, k) => {
        const g = gs[k];
        for (const wc of l.water) {
          const at = (g.cj0 - cj0 + Math.floor(wc.c / g.w)) * w + (g.ci0 - ci0 + (wc.c % g.w));
          for (let hh = 0; hh < ix.hours; hh++) if (wc.cm[hh] > cm[hh][at]) cm[hh][at] = wc.cm[hh];
        }
      });
      return { trees, cm, start: ix.start };
    },
  };
}
