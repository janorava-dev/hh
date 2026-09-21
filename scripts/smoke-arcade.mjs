// Smoke test hry: spuštění (kredity), nastavení odměn, Den regenerace, omezení pro rodiče, skóre.
// Vyžaduje lokální dev server s ALLOW_TEST_DAY=1 v .dev.vars, migrace a superadmina "admin" / "test-heslo-123".
// Vytváří testovací data v LOKÁLNÍ databázi. Nespouštět proti ostrému nasazení.
const BASE = "http://localhost:8787";
let pass = 0, failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) pass++; else { failed++; console.log("FAIL:", name, extra); }
};
const rnd = Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  cookie = "";
  day = "2026-11-01";
  async req(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { "x-test-day": this.day, ...(body ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    let data = null;
    try { data = (res.headers.get("content-type") || "").includes("json") ? await res.clone().json() : null; } catch {}
    return { status: res.status, data, res };
  }
}
const setDay = (d, ...cs) => cs.forEach((c) => (c.day = d));

const sa = new Client();
await sa.req("POST", "/api/auth/login", { username: "admin", password: "test-heslo-123" });
const fam = (await sa.req("POST", "/api/admin/families", { name: "Hra " + rnd })).data.id;
const fam2 = (await sa.req("POST", "/api/admin/families", { name: "Cizí " + rnd })).data.id;
const mk = async (u, role, family) => {
  const r = await sa.req("POST", "/api/admin/users", { username: `${u}_${rnd}`, displayName: u, password: "docasne-heslo1", familyId: family, role });
  const c = new Client();
  await c.req("POST", "/api/auth/login", { username: `${u}_${rnd}`, password: "docasne-heslo1" });
  await c.req("POST", "/api/auth/password", { current: "docasne-heslo1", next: "nove-heslo-123" });
  c.id = r.data.id;
  return c;
};
const parent = await mk("mama", "parent", fam);
const kid = await mk("Jony", "child", fam);
const kid2 = await mk("Mikus", "child", fam);
const outsider = await mk("cizi", "parent", fam2);
const nobody = await mk("nikdo", undefined, undefined);
const all = [parent, kid, kid2, outsider];
const D = (n) => `2026-11-${String(n).padStart(2, "0")}`;

const approveMission = async (child, day) => {
  for (let i = 0; i < 5; i++) await child.req("POST", "/api/me/mission", { index: i, checked: true });
  return parent.req("POST", `/api/family/${fam}/missions/${child.id}/${day}/approve`);
};
const status = async (c) => (await c.req("GET", "/api/game/status")).data;

/* ---- základ: bez spuštění nejde hrát ---- */
setDay(D(1), ...all);
let s = await status(kid);
check("dítě: žádná spuštění, hra není neomezená", s.unlimited === false && s.plays.available === 0 && s.plays.tomorrow === 0 && s.plays.locked === false, JSON.stringify(s.plays));
check("stav hry obsahuje hrdinu a prahy levelů", s.hero.hero === "knight" && s.levels.length === 10, JSON.stringify(s.hero));
let r = await kid.req("POST", "/api/game/start");
check("bez spuštění nejde začít (403)", r.status === 403, r.status + JSON.stringify(r.data));
r = await kid.req("GET", "/api/me/game");
check("stav dítěte obsahuje počet spuštění", r.data.arcade && r.data.arcade.available === 0, JSON.stringify(r.data.arcade));

/* ---- rodič hraje bez omezení ---- */
s = await status(parent);
check("rodič: neomezené spuštění, bez hrdiny", s.unlimited === true && s.plays === null && s.hero === null);
for (let i = 0; i < 3; i++) {
  r = await parent.req("POST", "/api/game/start");
  check(`rodič spustí hru ${i + 1}. bez omezení`, r.status === 201 && r.data.runId, JSON.stringify(r.data));
  const f = await parent.req("POST", "/api/game/finish", { runId: r.data.runId, score: 50000, level: 1, won: false });
  check(`nesmyslné skóre se ořízne časem (${f.data?.score})`, f.status === 200 && f.data.score <= 240, JSON.stringify(f.data));
}
r = await parent.req("POST", "/api/game/finish", { runId: "neexistuje", score: 10, level: 1, won: false });
check("neznámá hra při ukončení = 404", r.status === 404);

/* ---- večerní mise = spuštění na další den ---- */
r = await approveMission(kid, D(1));
check("schválení mise", r.status === 200);
s = await status(kid);
check("den 1: zatím nic k dispozici, zítra +1", s.plays.available === 0 && s.plays.tomorrow === 1, JSON.stringify(s.plays));
setDay(D(2), ...all);
s = await status(kid);
check("den 2: dítě má 1 spuštění", s.plays.available === 1 && s.plays.creditsLeft === 1, JSON.stringify(s.plays));

r = await kid.req("POST", "/api/game/start");
check("dítě spustí hru (spotřebuje 1)", r.status === 201 && r.data.plays.available === 0, JSON.stringify(r.data));
const run1 = r.data.runId;
r = await kid.req("POST", "/api/game/start");
check("dvojité klepnutí = stejná hra, žádné další spuštění", r.status === 200 && r.data.runId === run1 && r.data.plays.available === 0, JSON.stringify(r.data));
await sleep(1100);
r = await kid.req("POST", "/api/game/finish", { runId: run1, score: 90, level: 1, won: false });
check("skóre uloženo, nový rekord", r.status === 200 && r.data.score === 90 && r.data.best === 90 && r.data.isBest === true, JSON.stringify(r.data));
check("žebříček obsahuje obě děti, já jsem označený", r.data.scores.length === 2 && r.data.scores[0].me === true && r.data.scores[0].best === 90, JSON.stringify(r.data.scores));
r = await kid.req("POST", "/api/game/finish", { runId: run1, score: 500, level: 1, won: false });
check("uzavřenou hru nejde přepsat (404)", r.status === 404);
r = await kid.req("POST", "/api/game/start");
check("po spotřebování dalších spuštění není (403)", r.status === 403);
r = await kid2.req("POST", "/api/game/finish", { runId: run1, score: 90, level: 1, won: false });
check("cizí hru druhé dítě neukončí (404)", r.status === 404);
r = await kid.req("POST", "/api/game/finish", { runId: run1, score: -5, level: 1, won: false });
check("záporné skóre = 400", r.status === 400 || r.status === 404);

/* ---- nastavení odměn ---- */
r = await kid.req("PATCH", `/api/family/${fam}/game-settings`, { dailyPlays: 5 });
check("dítě nesmí měnit nastavení hry", r.status === 403);
r = await outsider.req("PATCH", `/api/family/${fam}/game-settings`, { dailyPlays: 5 });
check("cizí rodič nesmí měnit nastavení", r.status === 403);
r = await parent.req("PATCH", `/api/family/${fam}/game-settings`, { dailyPlays: 11 });
check("denně 11 = 400", r.status === 400);
r = await parent.req("PATCH", `/api/family/${fam}/game-settings`, { missionPlays: -1 });
check("záporná hodnota = 400", r.status === 400);
r = await parent.req("PATCH", `/api/family/${fam}/game-settings`, { dailyPlays: 2, missionPlays: 2, trainPlays: 1 });
check("nastavení uloženo", r.status === 200 && r.data.settings.dailyPlays === 2 && r.data.settings.missionPlays === 2 && r.data.settings.trainPlays === 1, JSON.stringify(r.data));
r = await parent.req("GET", `/api/family/${fam}/game`);
check("rodičovský přehled ukazuje nastavení a spuštění dětí", r.data.gameSettings.missionPlays === 2 && r.data.children.every((c) => c.plays && typeof c.plays.available === "number"), JSON.stringify(r.data.gameSettings));
s = await status(kid);
check("denní základ 2 spuštění zdarma (nekumuluje se)", s.plays.allowanceLeft === 2 && s.plays.available === 2, JSON.stringify(s.plays));
for (let i = 0; i < 2; i++) {
  r = await kid.req("POST", "/api/game/start");
  check(`denní základ: spuštění ${i + 1}`, r.status === 201, JSON.stringify(r.data));
  await sleep(1100);
  await kid.req("POST", "/api/game/finish", { runId: r.data.runId, score: 30, level: 1, won: false });
}
r = await kid.req("POST", "/api/game/start");
check("denní základ vyčerpán (403)", r.status === 403);
setDay(D(3), ...all);
s = await status(kid);
check("další den se základ obnoví (2), nasbíraná spuštění nejsou", s.plays.allowanceLeft === 2 && s.plays.creditsLeft === 0, JSON.stringify(s.plays));

/* ---- ruční přidání, bonusový úkol, trénink ---- */
r = await kid.req("POST", `/api/family/${fam}/children/${kid.id}/game-credit`, { plays: 1 });
check("dítě si spuštění nepřidá (403)", r.status === 403);
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/game-credit`, { plays: 0 });
check("přidat 0 spuštění = 400", r.status === 400);
r = await parent.req("PATCH", `/api/family/${fam}/game-settings`, { dailyPlays: 0, missionPlays: 1, trainPlays: 1 });
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/game-credit`, { plays: 2 });
check("rodič přidá 2 spuštění, platí hned", r.status === 201 && r.data.plays.creditsLeft === 2 && r.data.plays.available === 2, JSON.stringify(r.data));
r = await parent.req("POST", `/api/family/${fam}/children/${outsider.id}/game-credit`, { plays: 1 });
check("cizímu člověku spuštění nejde přidat (404)", r.status === 404);

const chore = (await parent.req("POST", `/api/family/${fam}/chores`, { label: "Vysát byt", minutes: 5, xp: 10, gamePlays: 2 })).data.id;
r = await parent.req("GET", `/api/family/${fam}/game`);
check("úkol má gamePlays 2", r.data.chores.find((c) => c.id === chore)?.gamePlays === 2);
r = await parent.req("PATCH", `/api/family/${fam}/chores/${chore}`, { gamePlays: 9 });
check("gamePlays 9 = 400 (max 5)", r.status === 400);
await kid.req("POST", "/api/me/bonus", { choreId: chore });
const claim = (await parent.req("GET", `/api/family/${fam}/game`)).data.queue.claims[0];
r = await parent.req("POST", `/api/family/${fam}/claims/${claim.id}/approve`);
s = await status(kid);
check("schválený úkol s gamePlays 2: zítra +2 spuštění", r.status === 200 && s.plays.tomorrow === 2, JSON.stringify(s.plays));
await parent.req("POST", `/api/family/${fam}/claims/${claim.id}/approve`);
s = await status(kid);
check("druhé schválení nepřidá další spuštění", s.plays.tomorrow === 2);

await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2018 });
const before = (await status(kid)).plays.tomorrow;
let ok = false;
{
  const st = await kid.req("POST", "/api/me/train/start");
  const ans = st.data.debugAnswers;
  let last;
  for (let i = 0; i < 10; i++) { await sleep(130); last = await kid.req("POST", "/api/me/train/answer", { sessionId: st.data.session.id, answer: ans[i] }); }
  ok = last.data.summary.xp === 15;
}
s = await status(kid);
check("sada příkladů nad 80 %: zítra +1 spuštění (trainPlays 1)", ok && s.plays.tomorrow === before + 1, JSON.stringify([before, s.plays]));

/* ---- Den regenerace zamkne hru ---- */
setDay(D(5), ...all);
for (let i = 0; i < 3; i++) await parent.req("POST", `/api/family/${fam}/children/${kid.id}/strikes`, { reason: "Test" });
s = await status(kid);
check("den 5 po 3 trhlinách: hrát ještě lze", s.plays.locked === false && s.plays.available > 0, JSON.stringify(s.plays));
setDay(D(6), ...all);
s = await status(kid);
check("den 6 = Den regenerace: hra zamčená, nasbíraná spuštění zůstávají", s.plays.locked === true && s.plays.available === 0 && s.plays.creditsLeft > 0, JSON.stringify(s.plays));
r = await kid.req("POST", "/api/game/start");
check("v Den regenerace nejde hru spustit (403)", r.status === 403 && /regenerace/i.test(r.data.error), JSON.stringify(r.data));
r = await parent.req("POST", "/api/game/start");
check("rodič může hrát i v Den regenerace dítěte", r.status === 201);
setDay(D(7), ...all);
s = await status(kid);
check("den 7: hra znovu odemčená, spuštění zůstala", s.plays.locked === false && s.plays.available > 0, JSON.stringify(s.plays));

/* ---- přístup a stránka ---- */
r = await nobody.req("GET", "/api/game/status");
check("uživatel bez rodiny nemá přístup ke hře (403)", r.status === 403);
r = await sa.req("GET", "/api/game/status");
check("superadmin má přístup (neomezeně)", r.status === 200 && r.data.unlimited === true);
const anon = new Client();
r = await anon.req("GET", "/api/game/status");
check("bez přihlášení 401", r.status === 401);
r = await anon.req("GET", "/game");
check("stránka /game bez přihlášení -> přesměrování", r.status === 302);
r = await kid.req("GET", "/game");
check("stránka /game pro dítě = 200", r.status === 200);
r = await parent.req("GET", "/game");
check("stránka /game pro rodiče = 200", r.status === 200);
r = await nobody.req("GET", "/game");
check("stránka /game pro uživatele bez rodiny -> přesměrování", r.status === 302);
r = await kid.req("GET", "/game-core.js");
check("game-core.js se načítá", r.status === 200);

console.log(`\n${pass} OK, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
