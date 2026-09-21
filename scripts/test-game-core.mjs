// Testy jádra hry (public/game-core.js): bludiště, pohyb, duchové, bodování. Nepotřebuje server ani prohlížeč.
import { createRequire } from "node:module";
createRequire(import.meta.url)("../public/game-core.js"); // soubor je klasický skript, exportuje do globalThis.HHGame
const G = globalThis.HHGame;

let pass = 0, failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) pass++; else { failed++; console.log("FAIL:", name, extra); }
};
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---- bludiště ---- */
G.MAZES.forEach((rows, i) => {
  const name = `bludiště ${i + 1}`;
  const W = rows[0].length, H = rows.length;
  check(`${name}: všechny řádky stejně dlouhé (${W}×${H})`, rows.every((r) => r.length === W) && W === 19 && H === 21);
  check(`${name}: okraj nahoře a dole jsou zdi`, /^#+$/.test(rows[0]) && /^#+$/.test(rows[H - 1]));
  check(`${name}: souměrné zleva doprava`, rows.every((r) => r === r.split("").reverse().join("")));
  const s = G.createGame({ ghosts: false });
  while (s.level < i + 1) { s.dotsLeft = 0; s.mode = "levelclear"; s.timer = 0; G.update(s, 0.01); }
  check(`${name}: načteno, jeden start hráče`, s.level === i + 1 && s.start && s.start.x === 9 && s.start.y === 15);
  // dosažitelnost všech teček z místa startu (hráč nesmí přes dvířka)
  const seen = new Set([`${s.start.x},${s.start.y}`]);
  const q = [[s.start.x, s.start.y]];
  for (let k = 0; k < q.length; k++) {
    const [x, y] = q[k];
    for (const d of G.ORDER) {
      const nx = G.wrapX(s, x + G.D[d][0]), ny = y + G.D[d][1];
      if (!G.passable(s, nx, ny, "player") || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`); q.push([nx, ny]);
    }
  }
  const unreachable = [];
  for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) if ((s.grid[y][x] === "." || s.grid[y][x] === "o") && !seen.has(`${x},${y}`)) unreachable.push([x, y]);
  check(`${name}: všechny tečky dosažitelné (${s.dotsTotal} teček)`, unreachable.length === 0 && s.dotsTotal > 100, JSON.stringify(unreachable));
  check(`${name}: 4 velké tečky`, s.grid.flat().filter((c) => c === "o").length === 4);
  check(`${name}: z domečku vede cesta ven`, s.distExit[9 * s.W + 9] > 0 && s.distHouse[7 * s.W + 9] > 0);
});

/* ---- bot, který sbírá tečky ---- */
function nearestStep(s, fromX, fromY, blocked) {
  const start = `${fromX},${fromY}`, prev = new Map([[start, null]]);
  const q = [[fromX, fromY]];
  for (let k = 0; k < q.length; k++) {
    const [x, y] = q[k];
    const c = s.grid[y][x];
    if ((c === "." || c === "o") && k > 0) {
      let cur = `${x},${y}`, step = null;
      while (prev.get(cur)) { step = prev.get(cur).d; cur = prev.get(cur).from; }
      return step;
    }
    for (const d of G.ORDER) {
      const nx = G.wrapX(s, x + G.D[d][0]), ny = y + G.D[d][1];
      const key = `${nx},${ny}`;
      if (!G.passable(s, nx, ny, "player") || prev.has(key) || key === blocked) continue;
      prev.set(key, { from: `${x},${y}`, d });
      q.push([nx, ny]);
    }
  }
  return null;
}
function botInput(s) {
  const p = s.player;
  if (p.dir && p.p > 0) {
    const c = s.grid[p.ny][p.nx];
    if (c === "." || c === "o") { G.setInput(s, p.dir); return; } // tečka na dalším políčku: pokračuj
    // zpátky se neotáčí (stabilní rozhodování), jen když není kam jinam
    G.setInput(s, nearestStep(s, p.nx, p.ny, `${p.tx},${p.ty}`) || nearestStep(s, p.nx, p.ny) || s.input);
    return;
  }
  G.setInput(s, nearestStep(s, p.tx, p.ty) || s.input);
}

/* bez duchů projde bot všechna 3 levely a hra skončí výhrou */
{
  const s = G.createGame({ ghosts: false, rng: seeded(1) });
  let t = 0, lastScore = 0, monotonic = true;
  while (s.mode !== "won" && t < 900) {
    botInput(s);
    G.update(s, 1 / 60);
    t += 1 / 60;
    if (s.score < lastScore) monotonic = false;
    lastScore = s.score;
  }
  check(`bot bez duchů vyhraje všechny levely (${t.toFixed(0)} s hry)`, s.mode === "won" && s.level === 3, `mode=${s.mode} level=${s.level} t=${t}`);
  check("skóre nikdy neklesá a je rozumné (>8 000)", monotonic && s.score > 8000, String(s.score));
  check("po výhře zbývá 3 životy a skóre obsahuje bonus", s.lives === 3 && s.score >= 1000 + 500 * 3 + 3 * 500);
}

/* nečinný hráč: duchové ho chytí a hra skončí (3 životy) */
{
  const s = G.createGame({ rng: seeded(7) });
  let t = 0, deaths = 0;
  while (s.mode !== "over" && t < 1200) {
    G.update(s, 1 / 60);
    t += 1 / 60;
    deaths += s.events.filter((e) => e === "die").length;
    s.events.length = 0;
  }
  check(`nečinný hráč: 3 smrti a konec hry (${t.toFixed(0)} s)`, s.mode === "over" && s.lives === 0 && deaths === 3, `mode=${s.mode} lives=${s.lives} deaths=${deaths}`);
}

/* náhodné vstupy: nic se nerozbije */
for (let seed = 1; seed <= 12; seed++) {
  const rng = seeded(seed * 99);
  const s = G.createGame({ rng });
  let ok = true, why = "", lives = s.lives, t = 0;
  const dirs = [null, "up", "down", "left", "right"];
  while (t < 90 && s.mode !== "over" && s.mode !== "won") {
    if (Math.floor(t * 4) !== Math.floor((t - 1 / 60) * 4)) G.setInput(s, dirs[Math.floor(rng() * dirs.length)]);
    G.update(s, 1 / 60);
    t += 1 / 60;
    if (s.lives > lives) { ok = false; why = "životy přibyly"; }
    lives = s.lives;
    for (const e of [s.player, ...s.ghosts]) {
      const bad = !Number.isInteger(e.tx) || !Number.isInteger(e.ty) || e.tx < 0 || e.tx >= s.W || e.ty < 0 || e.ty >= s.H ||
        e.p < 0 || e.p >= 1.0001 || !Number.isFinite(e.p) || s.grid[e.ty][e.tx] === "#";
      if (bad) { ok = false; why = `neplatná pozice ${JSON.stringify(e)}`; break; }
    }
    if (!ok) break;
  }
  check(`náhodná hra ${seed}: pozice vždy platné, životy neroste`, ok, why);
}

/* srážky a strach */
{
  const s = G.createGame({ rng: seeded(3) });
  s.mode = "play";
  const g = s.ghosts[0];
  s.player.tx = 9; s.player.ty = 15; s.player.dir = null; s.player.p = 0;
  Object.assign(g, { tx: 9, ty: 15, nx: 9, ny: 15, dir: null, p: 0, mode: "frightened" });
  const before = s.score;
  G.update(s, 0.016);
  check("strašidelný duch se dá sníst: +200 a je 'eaten'", g.mode === "eaten" && s.score === before + 200 && s.mode === "play", `${g.mode} ${s.score - before}`);

  const s2 = G.createGame({ rng: seeded(3) });
  s2.mode = "play";
  const h = s2.ghosts[0];
  s2.player.tx = 9; s2.player.ty = 15; s2.player.dir = null; s2.player.p = 0;
  Object.assign(h, { tx: 9, ty: 15, nx: 9, ny: 15, dir: null, p: 0, mode: "normal" });
  G.update(s2, 0.016);
  check("normální duch hráče chytí: -1 život, mode dying", s2.lives === 2 && s2.mode === "dying");
  for (let i = 0; i < 120 && s2.mode === "dying"; i++) G.update(s2, 0.016);
  check("po smrti se hra vrátí do 'ready' a postavy na startu", s2.mode === "ready" && s2.player.tx === 9 && s2.player.ty === 15 && s2.lives === 2);
}

/* řetězení sněžených duchů a sníst velkou tečku spustí strach */
{
  const s = G.createGame({ rng: seeded(5) });
  s.mode = "play";
  // velká tečka vpravo od hráče: dej hráče těsně před ni
  const px = 2, py = 15; // (1,15) je 'o'
  s.player.tx = px; s.player.ty = py; s.player.nx = px; s.player.ny = py; s.player.dir = null; s.player.p = 0;
  G.setInput(s, "left");
  for (let i = 0; i < 40; i++) G.update(s, 0.016);
  check("velká tečka: +50 a duchové se bojí", s.grid[15][1] === " " && s.fright > 0 && s.ghosts.some((g) => g.mode === "frightened" || g.mode === "house"), `fright=${s.fright}`);
  const b = s.score;
  const [g1, g2] = [s.ghosts[0], s.ghosts[3]];
  for (const g of [g1, g2]) { g.mode = "frightened"; g.dir = null; g.p = 0; }
  const pl = s.player;
  Object.assign(g1, { tx: pl.tx, ty: pl.ty, nx: pl.tx, ny: pl.ty });
  G.update(s, 0.001);
  const first = s.score - b;
  Object.assign(g2, { tx: pl.tx, ty: pl.ty, nx: pl.tx, ny: pl.ty });
  G.update(s, 0.001);
  check("řetězec: první duch 200, druhý 400", first === 200 && s.score - b === 600, `${first} ${s.score - b}`);
}

/* snězený duch se vrátí do domečku a znovu vyjde */
{
  const s = G.createGame({ rng: seeded(11) });
  s.mode = "play";
  const g = s.ghosts[0];
  Object.assign(g, { tx: 5, ty: 3, nx: 5, ny: 3, dir: null, p: 0, mode: "eaten" });
  s.player.tx = 9; s.player.ty = 15;
  let t = 0, backHome = false, out = false;
  while (t < 40 && !out) {
    G.update(s, 1 / 60);
    t += 1 / 60;
    s.player.tx = 9; s.player.ty = 15; s.player.nx = 9; s.player.ny = 15; s.player.dir = null; s.player.p = 0;
    if (g.mode === "leaving") backHome = true;
    if (backHome && (g.mode === "normal")) out = true;
  }
  check("snězený duch doletí do domečku a vyjde ven", backHome && out, `t=${t} mode=${g.mode}`);
}

console.log(`\n${pass} OK, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
