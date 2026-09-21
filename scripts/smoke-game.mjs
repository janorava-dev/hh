// Smoke test herní smyčky (mise, bonusy, trhliny, minuty na zítřek, hrdina).
// Vyžaduje lokální dev server s ALLOW_TEST_DAY=1 v .dev.vars, migrace a superadmina "admin" / "test-heslo-123".
// Vytváří testovací data v LOKÁLNÍ databázi. Nespouštět proti ostrému nasazení.
const BASE = "http://localhost:8787";
let pass = 0, failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) pass++; else { failed++; console.log("FAIL:", name, extra); }
};
const rnd = Math.random().toString(36).slice(2, 7);

class Client {
  cookie = "";
  day = "2026-10-01";
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
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
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
const kid = await mk("kid1", "child", fam);
const kid2 = await mk("kid2", "child", fam);
const outsider = await mk("cizi", "parent", fam2);

let r = await parent.req("GET", `/api/family/${fam}/game`);
check("nová rodina má 3 výchozí bonusové úkoly", r.status === 200 && r.data.chores.length === 3, JSON.stringify(r.data?.chores));
const chores = Object.fromEntries(r.data.chores.map((c) => [c.label, c]));
const trash = chores["Vynést koš"];

/* ---- den 1: mise + bonus ---- */
setDay("2026-10-01", parent, kid, kid2, outsider);
r = await kid.req("GET", "/api/me/game");
check("dítě vidí stav", r.status === 200 && r.data.state.mission.status === "open" && r.data.state.usable === 0 && r.data.state.bonus.length === 3, JSON.stringify(r.data));
check("sourozenec je v odpovědi", r.data.siblings.length === 1);
check("server posílá prahy levelů (pomalejší křivka)", Array.isArray(r.data.levels) && r.data.levels.length === 10 && r.data.levels[2] === 500 && r.data.levels[9] === 10000, JSON.stringify(r.data.levels));
r = await parent.req("GET", `/api/family/${fam}/game`);
check("rodič dostává prahy levelů a žádný strop bonusů", r.data.limits.levels[9] === 10000 && r.data.limits.bonusCap === undefined, JSON.stringify(r.data.limits));
r = await kid.req("GET", "/api/me/game");
for (let i = 0; i < 4; i++) r = await kid.req("POST", "/api/me/mission", { index: i, checked: true });
check("po 4 úkolech mise pořád otevřená", r.data.state.mission.status === "open");
r = await kid.req("POST", "/api/me/mission", { index: 9, checked: true });
check("neplatný index = 400", r.status === 400);
r = await kid.req("POST", "/api/me/mission", { index: 4, checked: true });
check("po 5. úkolu odesláno rodiči", r.data.state.mission.status === "pending" && r.data.state.tomorrowPending === 30, JSON.stringify(r.data));
r = await kid.req("POST", "/api/me/mission", { index: 0, checked: false });
check("odeslanou misi nejde měnit (409)", r.status === 409);

r = await parent.req("GET", `/api/family/${fam}/game`);
check("mise je ve frontě rodiče", r.data.queue.missions.length === 1 && r.data.queue.missions[0].childId === kid.id);
r = await parent.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-01/return`, { uncheck: [] });
check("vrácení bez označení = 400", r.status === 400);
r = await parent.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-01/return`, { uncheck: [2] });
r = await kid.req("GET", "/api/me/game");
check("vrácená mise je otevřená a úkol 3 odškrtnutý", r.data.state.mission.status === "open" && r.data.state.mission.items[2] === 0);
await kid.req("POST", "/api/me/mission", { index: 2, checked: true });

r = await outsider.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-01/approve`);
check("cizí rodič nesmí schvalovat", r.status === 403);
r = await kid2.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-01/approve`);
check("dítě nesmí schvalovat", r.status === 403);
r = await parent.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-01/approve`);
check("schválení mise", r.status === 200);
r = await parent.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-01/approve`);
check("druhé schválení = 409", r.status === 409);

r = await kid.req("POST", "/api/me/bonus", { choreId: trash.id });
check("bonus odeslán", r.status === 200 && r.data.state.bonus.find((b) => b.id === trash.id).status === "pending");
r = await kid.req("POST", "/api/me/bonus", { choreId: trash.id });
check("stejný bonus podruhé = 409", r.status === 409);
r = await kid.req("POST", "/api/me/bonus", { choreId: "neexistuje" });
check("cizí/neexistující bonus = 404", r.status === 404);
r = await parent.req("GET", `/api/family/${fam}/game`);
const claim = r.data.queue.claims[0];
r = await parent.req("POST", `/api/family/${fam}/claims/${claim.id}/approve`);
check("schválení bonusu", r.status === 200 && r.data.grantedMinutes === 5);
r = await parent.req("POST", `/api/family/${fam}/claims/${claim.id}/approve`);
check("bonus podruhé 409", r.status === 409);

r = await kid.req("GET", "/api/me/game");
check("den 1: dnes nic, zítra 35 min (30 mise + 5 bonus), 60 XP, série 1", r.data.state.usable === 0 && r.data.state.tomorrow === 35 && r.data.state.xp === 60 && r.data.state.streak === 1, JSON.stringify(r.data.state));

/* ---- bonusy bez denního stropu ---- */
const mkChore = async (label, minutes) => (await parent.req("POST", `/api/family/${fam}/chores`, { label, minutes, xp: 10 })).data.id;
const big1 = await mkChore("Velký A", 20), big2 = await mkChore("Velký B", 20);
await kid.req("POST", "/api/me/bonus", { choreId: big1 });
await kid.req("POST", "/api/me/bonus", { choreId: big2 });
const q = (await parent.req("GET", `/api/family/${fam}/game`)).data.queue.claims;
const a1 = await parent.req("POST", `/api/family/${fam}/claims/${q.find((c) => c.label === "Velký A").id}/approve`);
const a2 = await parent.req("POST", `/api/family/${fam}/claims/${q.find((c) => c.label === "Velký B").id}/approve`);
check("bez stropu: 5 + 20 + 20 minut se připíše celé", a1.data.grantedMinutes === 20 && a2.data.grantedMinutes === 20, JSON.stringify([a1.data, a2.data]));
await parent.req("PATCH", `/api/family/${fam}/chores/${big1}`, { active: false });
await parent.req("PATCH", `/api/family/${fam}/chores/${big2}`, { active: false });

/* ---- den 2: minuty platí, 3 trhliny ---- */
setDay("2026-10-02", parent, kid, kid2, outsider);
r = await kid.req("GET", "/api/me/game");
check("den 2: k dispozici 75 min (30 mise + 45 bonusů)", r.data.state.usable === 75 && r.data.state.base === 75 && !r.data.state.regen, JSON.stringify(r.data.state));
for (let i = 0; i < 3; i++) r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/strikes`, { reason: "Odmlouvání" });
check("3. trhlina OK", r.status === 201 && r.data.count === 3);
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/strikes`, { reason: "Odmlouvání" });
check("4. trhlina = 409", r.status === 409);
r = await kid.req("GET", "/api/me/game");
check("den 2 po 3 trhlinách: hrát ještě může, ale zítra je regenerace", r.data.state.usable === 75 && r.data.state.regenTomorrow && r.data.state.strikes.length === 3);
r = await parent.req("DELETE", `/api/family/${fam}/children/${kid.id}/strikes/last`);
r = await kid.req("GET", "/api/me/game");
check("vrácení trhliny", r.data.state.strikes.length === 2 && !r.data.state.regenTomorrow);
await parent.req("POST", `/api/family/${fam}/children/${kid.id}/strikes`, { reason: "Hrubé chování" });
for (let i = 0; i < 5; i++) await kid.req("POST", "/api/me/mission", { index: i, checked: true });
await parent.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-02/approve`);

/* ---- den 3: Den regenerace ---- */
setDay("2026-10-03", parent, kid, kid2, outsider);
r = await kid.req("GET", "/api/me/game");
check("den 3: Den regenerace, dnes 0 min, zítra 30 (přesunuto)", r.data.state.regen && r.data.state.usable === 0 && r.data.state.tomorrow === 30, JSON.stringify(r.data.state));
for (let i = 0; i < 5; i++) await kid.req("POST", "/api/me/mission", { index: i, checked: true });
await parent.req("POST", `/api/family/${fam}/missions/${kid.id}/2026-10-03/approve`);
r = await kid.req("GET", "/api/me/game");
check("den 3 po misi: zítra 30 přesunutých + 30 nových = 60", r.data.state.tomorrow === 60 && r.data.state.usable === 0, JSON.stringify(r.data.state));

/* ---- den 4: přenesené minuty ---- */
setDay("2026-10-04", parent, kid, kid2, outsider);
r = await kid.req("GET", "/api/me/game");
check("den 4: 30 nových + 30 přenesených = 60, série 3", r.data.state.usable === 60 && r.data.state.carry === 30 && r.data.state.base === 30 && !r.data.state.regen && r.data.state.streak === 3, JSON.stringify(r.data.state));
setDay("2026-10-05", parent, kid, kid2, outsider);
r = await kid.req("GET", "/api/me/game");
check("den 5: přenos se neopakuje", r.data.state.carry === 0 && r.data.state.usable === 0, JSON.stringify(r.data.state));
r = await kid2.req("GET", "/api/me/game");
check("druhé dítě není ovlivněno", r.data.state.usable === 0 && r.data.state.xp === 0 && r.data.state.streak === 0);

/* ---- hrdina ---- */
setDay("2026-10-04", kid);
r = await kid.req("PUT", "/api/me/hero", { hero: "wizard", name: "Blesk", equipment: { cape: "blue" } });
check("hrdina: level 2 odemyká plášť", r.status === 200 && r.data.state.hero.hero === "wizard" && r.data.state.hero.equipment.cape === "blue", JSON.stringify(r.data));
r = await kid.req("PUT", "/api/me/hero", { hero: "ondatra", name: "SuperOndatra", equipment: { cape: "red" } });
check("hrdina SuperOndatra jde vybrat", r.status === 200 && r.data.state.hero.hero === "ondatra", JSON.stringify(r.data));
r = await kid.req("PUT", "/api/me/hero", { hero: "wizard", name: "Blesk", equipment: { tool: "broom" } });
check("nástroj je zamčený do levelu 5 (403)", r.status === 403);
r = await kid.req("PUT", "/api/me/hero", { hero: "dragonzord", name: "X", equipment: {} });
check("neznámý hrdina = 400", r.status === 400);
r = await kid.req("PUT", "/api/me/hero", { hero: "fox", name: "A".repeat(30), equipment: {} });
check("dlouhé jméno = 400", r.status === 400);

/* ---- oprávnění ---- */
r = await kid.req("GET", `/api/family/${fam}/game`);
check("dítě nevidí rodičovský přehled", r.status === 403);
r = await outsider.req("GET", `/api/family/${fam}/game`);
check("cizí rodič nevidí rodinu", r.status === 403);
r = await parent.req("GET", "/api/me/game");
check("rodič nemá dětské API", r.status === 403);
r = await parent.req("POST", `/api/family/${fam}/children/${outsider.id}/strikes`, { reason: "Test" });
check("trhlinu nejde dát cizímu člověku", r.status === 404);

console.log(`\n${pass} OK, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
