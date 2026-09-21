/* Hrdinské bludiště: jádro hry (bez DOM), aby šlo testovat v Node i běžet v prohlížeči.
   Souřadnice jsou v dlaždicích. Postavy se pohybují po dlaždicích plynule (tx,ty -> nx,ny, postup p 0..1). */
(function (root) {
  "use strict";

  const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: "down", down: "up", left: "right", right: "left" };
  const ORDER = ["up", "left", "down", "right"]; // pořadí při shodě, jako v klasice

  /* ---------- bludiště: levá polovina (10 sloupců), pravá se zrcadlí ----------
     #=zeď  .=tečka  o=velká tečka  ' '=prázdno  -=dvířka domečku (jen pro duchy)  P=start hráče */
  const LEFT_A = [
    "##########",
    "#........#",
    "#o##.###.#",
    "#.........",
    "#.##.#.###",
    "#....#...#",
    "####.### #",
    "   #.#    ",
    "####.# ##-",
    "    .  #  ",
    "####.# ###",
    "   #.#    ",
    "####.# ###",
    "#........#",
    "#.##.###.#",
    "#o.#.....P",
    "##.#.#.###",
    "#....#...#",
    "#.######.#",
    "#.........",
    "##########",
  ];
  const mirror = (left) => left.map((r) => r + r.slice(0, 9).split("").reverse().join(""));
  const openCells = (rows, cells) => {
    const g = rows.map((r) => r.split(""));
    for (const [x, y] of cells) g[y][x] = ".";
    return g.map((r) => r.join(""));
  };
  const A = mirror(LEFT_A);
  // B: otevřenější varianta (několik zdí navíc chybí, vznikají zkratky)
  const B = openCells(A, [[2, 4], [3, 4], [16, 4], [15, 4], [6, 14], [12, 14], [3, 16], [15, 16]]);
  const MAZES = [A, B, A];
  const LEVELS = MAZES.length;

  const HOUSE = { x: 9, y: 9 }; // střed domečku duchů
  const EXIT = { x: 9, y: 7 }; // políčko těsně nad dvířky
  const GHOST_STARTS = [
    { x: 9, y: 7, mode: "normal" },
    { x: 8, y: 9, mode: "house" },
    { x: 9, y: 9, mode: "house" },
    { x: 10, y: 9, mode: "house" },
  ];
  const CORNERS = [{ x: 17, y: 1 }, { x: 1, y: 1 }, { x: 17, y: 19 }, { x: 1, y: 19 }]; // kam duchové míří v klidové fázi
  const SCHEDULE = [
    [7, 20, 7, 20, 5, 20, 5],
    [6, 20, 6, 20, 4, 25, 3],
    [5, 20, 5, 25, 3, 30, 2],
  ];
  const FRIGHT = [7, 6, 5];
  const PLAYER_SPEED = 6.0;

  /* ---------- pomocné ---------- */
  const wrapX = (s, x) => ((x % s.W) + s.W) % s.W;
  const cellAt = (s, x, y) => (y < 0 || y >= s.H ? "#" : s.grid[y][wrapX(s, x)]);

  function passable(s, x, y, who) {
    const c = cellAt(s, x, y);
    if (c === "#") return false;
    if (c === "-") return who === "ghostDoor";
    return true;
  }
  const canGo = (s, e, d, who) => passable(s, e.tx + D[d][0], e.ty + D[d][1], who);
  const setNext = (s, e, d) => { e.nx = wrapX(s, e.tx + D[d][0]); e.ny = e.ty + D[d][1]; };
  const newEntity = (x, y) => ({ tx: x, ty: y, nx: x, ny: y, p: 0, dir: null });

  function bfs(s, tx, ty) {
    const dist = new Int16Array(s.W * s.H).fill(-1);
    const q = [[tx, ty]];
    dist[ty * s.W + tx] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const d of ORDER) {
        const nx = wrapX(s, x + D[d][0]), ny = y + D[d][1];
        if (ny < 0 || ny >= s.H || !passable(s, nx, ny, "ghostDoor") || dist[ny * s.W + nx] !== -1) continue;
        dist[ny * s.W + nx] = dist[y * s.W + x] + 1;
        q.push([nx, ny]);
      }
    }
    return dist;
  }

  /** Souřadnice postavy včetně mezipolohy (může být mimo bludiště při přechodu tunelem). */
  function pos(e) {
    let x = e.tx, y = e.ty;
    if (e.dir) { x += D[e.dir][0] * e.p; y += D[e.dir][1] * e.p; }
    return { x, y };
  }
  function dist(s, a, b) {
    let dx = Math.abs(a.x - b.x);
    dx = Math.min(dx, s.W - dx);
    return Math.hypot(dx, a.y - b.y);
  }

  /* ---------- vytvoření a načtení levelu ---------- */
  function createGame(opts) {
    opts = opts || {};
    const s = {
      lives: opts.lives || 3,
      score: 0,
      level: 0,
      rng: opts.rng || Math.random,
      ghostsEnabled: opts.ghosts !== false,
      input: null,
      events: [],
      mode: "ready",
      timer: 0,
    };
    loadLevel(s, 1);
    return s;
  }

  function loadLevel(s, level) {
    s.level = level;
    const rows = MAZES[level - 1];
    s.H = rows.length;
    s.W = rows[0].length;
    s.grid = rows.map((r) => r.split(""));
    s.dotsLeft = 0;
    for (let y = 0; y < s.H; y++) {
      for (let x = 0; x < s.W; x++) {
        const c = s.grid[y][x];
        if (c === "P") { s.start = { x, y }; s.grid[y][x] = " "; }
        else if (c === "." || c === "o") s.dotsLeft++;
      }
    }
    s.dotsTotal = s.dotsLeft;
    s.distExit = bfs(s, EXIT.x, EXIT.y);
    s.distHouse = bfs(s, HOUSE.x, HOUSE.y);
    resetPositions(s);
    s.mode = "ready";
    s.timer = 2;
  }

  function resetPositions(s) {
    s.player = newEntity(s.start.x, s.start.y);
    s.input = null;
    s.clock = 0; // čas od začátku života, řídí vypouštění duchů
    s.chase = false; // začíná se klidovou fází (scatter)
    s.phaseIdx = 0;
    s.phaseTime = SCHEDULE[s.level - 1][0];
    s.fright = 0;
    s.chain = 0;
    const scale = 1 - 0.15 * (s.level - 1);
    s.ghosts = s.ghostsEnabled
      ? GHOST_STARTS.map((g, i) => ({
          id: i,
          ...newEntity(g.x, g.y),
          mode: g.mode,
          release: i === 0 ? 0 : i * 2.5 * scale,
          forceReverse: false,
        }))
      : [];
    s.ghosts.forEach((g) => { if (g.mode === "normal") { g.dir = "left"; setNext(s, g, "left"); } });
  }

  /* ---------- pohyb po dlaždicích ---------- */
  function advance(s, e, speed, dt, choose, arrive) {
    let move = speed * dt;
    let guard = 0;
    while (move > 0 && guard++ < 8) {
      if (!e.dir) {
        const d = choose(s, e);
        if (!d) return;
        e.dir = d;
        setNext(s, e, d);
        e.p = 0;
      }
      const need = 1 - e.p;
      if (move < need) { e.p += move; return; }
      move -= need;
      e.tx = e.nx; e.ty = e.ny; e.p = 0;
      arrive(s, e);
      if (s.mode !== "play") return;
      const d = choose(s, e);
      if (!d) { e.dir = null; return; }
      e.dir = d;
      setNext(s, e, d);
    }
  }

  function playerChoose(s, e) {
    const w = s.input;
    if (w && canGo(s, e, w, "player")) return w;
    if (e.dir && canGo(s, e, e.dir, "player")) return e.dir;
    return null;
  }

  function startFright(s) {
    s.fright = FRIGHT[s.level - 1];
    s.chain = 0;
    for (const g of s.ghosts) if (g.mode === "normal") { g.mode = "frightened"; g.forceReverse = true; }
  }

  function playerArrive(s, e) {
    const c = s.grid[e.ty][e.tx];
    if (c === ".") {
      s.grid[e.ty][e.tx] = " "; s.score += 10; s.dotsLeft--; s.events.push("dot");
    } else if (c === "o") {
      s.grid[e.ty][e.tx] = " "; s.score += 50; s.dotsLeft--; s.events.push("power");
      startFright(s);
    }
    if (s.dotsLeft <= 0) {
      s.mode = "levelclear";
      s.timer = 1.6;
      s.score += 500;
      s.events.push("clear");
    }
  }

  /* ---------- duchové ---------- */
  function ghostSpeed(s, g) {
    if (g.mode === "eaten") return 9;
    if (g.mode === "frightened") return 3.0;
    if (g.mode === "leaving") return 3.4;
    return 4.4 + 0.5 * (s.level - 1);
  }

  function ghostTarget(s, g) {
    if (!s.chase) return CORNERS[g.id];
    const p = pos(s.player), pt = { x: s.player.tx, y: s.player.ty };
    const dir = s.player.dir ? D[s.player.dir] : [0, 0];
    switch (g.id) {
      case 0: return pt; // červený: přímo za hráčem
      case 1: return { x: pt.x + dir[0] * 4, y: pt.y + dir[1] * 4 }; // růžový: před hráčem
      case 2: { // modrý: zrcadlí červeného přes bod před hráčem
        const red = s.ghosts[0] || g, ax = pt.x + dir[0] * 2, ay = pt.y + dir[1] * 2;
        return { x: 2 * ax - red.tx, y: 2 * ay - red.ty };
      }
      default: return dist(s, pos(g), p) > 8 ? pt : CORNERS[3]; // oranžový: zblízka utíká
    }
  }

  function ghostChoose(s, g) {
    const door = g.mode === "leaving" || g.mode === "eaten";
    const who = door ? "ghostDoor" : "ghost";
    const opts = ORDER.filter((d) => canGo(s, g, d, who));
    if (!opts.length) return null;

    if (door) { // po nejkratší cestě k východu z domečku, resp. zpět do domečku
      const field = g.mode === "leaving" ? s.distExit : s.distHouse;
      let best = null, bestV = 1e9;
      for (const d of opts) {
        const v = field[(g.ty + D[d][1]) * s.W + wrapX(s, g.tx + D[d][0])];
        if (v >= 0 && v < bestV) { bestV = v; best = d; }
      }
      return best || opts[0];
    }

    const rev = g.dir ? OPP[g.dir] : null;
    if (g.forceReverse) {
      g.forceReverse = false;
      if (rev && opts.includes(rev)) return rev;
    }
    let cand = opts.filter((d) => d !== rev);
    if (!cand.length) cand = opts;
    if (g.mode === "frightened") return cand[Math.floor(s.rng() * cand.length)];

    const t = ghostTarget(s, g);
    let best = cand[0], bestV = 1e9;
    for (const d of cand) {
      const nx = g.tx + D[d][0], ny = g.ty + D[d][1];
      const v = (nx - t.x) * (nx - t.x) + (ny - t.y) * (ny - t.y);
      if (v < bestV) { bestV = v; best = d; }
    }
    return best;
  }

  function ghostArrive(s, g) {
    if (g.mode === "leaving" && g.tx === EXIT.x && g.ty === EXIT.y) g.mode = s.fright > 0 ? "frightened" : "normal";
    else if (g.mode === "eaten" && g.tx === HOUSE.x && g.ty === HOUSE.y) g.mode = "leaving";
  }

  /* ---------- hlavní krok ---------- */
  function update(s, dtRaw) {
    const dt = Math.min(dtRaw, 0.05);

    if (s.mode === "ready") {
      s.timer -= dt;
      if (s.timer <= 0) s.mode = "play";
      return;
    }
    if (s.mode === "dying") {
      s.timer -= dt;
      if (s.timer <= 0) {
        if (s.lives > 0) { resetPositions(s); s.mode = "ready"; s.timer = 1.6; }
        else s.mode = "over";
      }
      return;
    }
    if (s.mode === "levelclear") {
      s.timer -= dt;
      if (s.timer <= 0) {
        if (s.level >= LEVELS) {
          s.score += 1000 + 500 * s.lives;
          s.mode = "won";
          s.events.push("won");
        } else loadLevel(s, s.level + 1);
      }
      return;
    }
    if (s.mode !== "play") return;

    s.clock += dt;

    // klidová a útočná fáze duchů (při strachu stojí)
    if (s.fright > 0) {
      s.fright -= dt;
      if (s.fright <= 0) {
        s.fright = 0;
        for (const g of s.ghosts) if (g.mode === "frightened") g.mode = "normal";
      }
    } else {
      s.phaseTime -= dt;
      const sched = SCHEDULE[s.level - 1];
      if (s.phaseTime <= 0 && s.phaseIdx < sched.length - 1) {
        s.phaseIdx++;
        s.phaseTime = sched[s.phaseIdx];
        s.chase = !s.chase;
        for (const g of s.ghosts) if (g.mode === "normal") g.forceReverse = true;
      }
    }

    // hráč: otočka o 180° je možná kdykoli, ostatní zatáčky na křižovatce
    const pl = s.player;
    if (pl.dir && s.input === OPP[pl.dir] && pl.p > 0) {
      const ox = pl.tx, oy = pl.ty;
      pl.tx = pl.nx; pl.ty = pl.ny; pl.nx = ox; pl.ny = oy;
      pl.p = 1 - pl.p;
      pl.dir = s.input;
    }
    advance(s, pl, PLAYER_SPEED, dt, playerChoose, playerArrive);
    if (s.mode !== "play") return;

    for (const g of s.ghosts) {
      if (g.mode === "house") {
        if (s.clock >= g.release) g.mode = "leaving";
        else continue;
      }
      advance(s, g, ghostSpeed(s, g), dt, ghostChoose, ghostArrive);
    }

    // srážky
    const pp = pos(pl);
    for (const g of s.ghosts) {
      if (g.mode === "eaten" || g.mode === "house") continue;
      if (dist(s, pp, pos(g)) > 0.6) continue;
      if (g.mode === "frightened") {
        g.mode = "eaten";
        s.chain++;
        s.score += 100 * Math.pow(2, s.chain);
        s.events.push("ghost");
      } else {
        s.lives--;
        s.mode = "dying";
        s.timer = 1.3;
        s.events.push("die");
        return;
      }
    }
  }

  function setInput(s, dir) { s.input = dir && D[dir] ? dir : null; }

  const api = { D, OPP, ORDER, MAZES, LEVELS, HOUSE, EXIT, PLAYER_SPEED, createGame, update, setInput, pos, dist, bfs, passable, wrapX };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HHGame = api;
})(typeof window !== "undefined" ? window : globalThis);
