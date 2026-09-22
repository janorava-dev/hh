// Smoke test napojení na Home Assistant: nastavení, mapování dětí, ruční sync (proti falešnému webhooku).
// Vyžaduje lokální dev server s ALLOW_TEST_DAY=1 v .dev.vars, migrace a superadmina "admin" / "test-heslo-123".
// Vytváří testovací data v LOKÁLNÍ databázi. Nespouštět proti ostrému nasazení.
import http from "node:http";

const BASE = "http://localhost:8787";
let pass = 0, failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) pass++; else { failed++; console.log("FAIL:", name, extra); }
};
const rnd = Math.random().toString(36).slice(2, 7);

class Client {
  cookie = "";
  day = "2026-12-01";
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
    return { status: res.status, data };
  }
}
const setDay = (d, ...cs) => cs.forEach((c) => (c.day = d));

/* ---- falešný webhook server, ať nezávisíme na skutečném Home Assistant ---- */
const received = [];
let webhookStatus = 200, webhookDelayMs = 0;
const hook = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    setTimeout(() => {
      received.push({ auth: req.headers.authorization || null, json: JSON.parse(body || "{}") });
      res.writeHead(webhookStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: webhookStatus === 200 }));
    }, webhookDelayMs);
  });
});
await new Promise((r) => hook.listen(0, "127.0.0.1", r));
const hookPort = hook.address().port;
const hookUrl = `http://127.0.0.1:${hookPort}/webhook`;

const sa = new Client();
await sa.req("POST", "/api/auth/login", { username: "admin", password: "test-heslo-123" });
const fam = (await sa.req("POST", "/api/admin/families", { name: "HA " + rnd })).data.id;
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
const outsider = await mk("cizi", "parent", fam2);
const D = (n) => `2026-12-${String(n).padStart(2, "0")}`;
setDay(D(1), parent, kid, outsider);

/* ---- výchozí stav ---- */
let r = await parent.req("GET", `/api/family/${fam}/game`);
check("výchozí nastavení HA je vypnuté a prázdné", r.data.haSettings.enabled === false && r.data.haSettings.webhookUrl === "", JSON.stringify(r.data.haSettings));
check("dítě v přehledu má prázdné mapování a bez historie", r.data.children[0].ha.haChildId === "" && r.data.children[0].ha.last === null, JSON.stringify(r.data.children[0].ha));

/* ---- oprávnění a validace ---- */
r = await kid.req("PATCH", `/api/family/${fam}/ha-settings`, { enabled: true, webhookUrl: hookUrl });
check("dítě nesmí měnit nastavení HA", r.status === 403);
r = await outsider.req("PATCH", `/api/family/${fam}/ha-settings`, { enabled: true, webhookUrl: hookUrl });
check("cizí rodič nesmí měnit nastavení HA", r.status === 403);
r = await parent.req("PATCH", `/api/family/${fam}/ha-settings`, { webhookUrl: "http://neni-https.example" });
check("webhook bez https = 400", r.status === 400, JSON.stringify(r.data));
r = await parent.req("PATCH", `/api/family/${fam}/ha-settings`, { enabled: true });
check("zapnutí bez webhooku = 400", r.status === 400, JSON.stringify(r.data));

/* ---- sync bez zapnutí / bez mapování ---- */
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("sync bez zapnutí selže srozumitelně", r.status === 200 && r.data.ok === false && /není zapnutý/.test(r.data.message), JSON.stringify(r.data));
check("žádný požadavek na webhook zatím neodešel", received.length === 0);

r = await parent.req("PATCH", `/api/family/${fam}/ha-settings`, { webhookUrl: hookUrl, token: "tajny-token", enabled: true });
check("nastavení uloženo", r.status === 200 && r.data.settings.enabled === true && r.data.settings.webhookUrl === hookUrl);
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("sync bez mapování dítěte selže", r.status === 200 && r.data.ok === false && /nen[íi] napojen/i.test(r.data.message), JSON.stringify(r.data));

r = await kid.req("PATCH", `/api/family/${fam}/children/${kid.id}/ha-map`, { haChildId: "switch.jony_phone" });
check("dítě si mapování samo nenastaví", r.status === 403);
r = await outsider.req("PATCH", `/api/family/${fam}/children/${kid.id}/ha-map`, { haChildId: "x" });
check("cizí rodič nenastaví mapování", r.status === 403);
r = await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}/ha-map`, { haChildId: "switch.jony_phone" });
check("mapování uloženo", r.status === 200 && r.data.haChildId === "switch.jony_phone");

/* ---- úspěšný sync: posílá se přesně vypočtený stav dítěte ---- */
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("sync bez minut a bez zamčení projde a odešle 0 minut", r.status === 200 && r.data.ok === true && r.data.minutes === 0 && r.data.locked === false, JSON.stringify(r.data));
check("webhook dostal 1 požadavek se správným tělem", received.length === 1 && received[0].json.childId === "switch.jony_phone" && received[0].json.minutes === 0 && received[0].json.locked === false && received[0].json.source === "household-hero", JSON.stringify(received[0]));
check("webhook dostal token jako Bearer", received[0].auth === "Bearer tajny-token");

for (let i = 0; i < 5; i++) await kid.req("POST", "/api/me/mission", { index: i, checked: true });
await parent.req("POST", `/api/family/${fam}/missions/${kid.id}/${D(1)}/approve`);
setDay(D(2), parent, kid);
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("po schválené misi sync pošle 30 minut na zítřejší (dnešní) den", r.data.minutes === 30 && r.data.locked === false, JSON.stringify(r.data));
check("webhook dostal správný den", received[1].json.day === D(2) && received[1].json.minutes === 30);

/* ---- Den regenerace: posílá se locked=true, minutes=0 ---- */
setDay(D(2), parent);
for (let i = 0; i < 3; i++) await parent.req("POST", `/api/family/${fam}/children/${kid.id}/strikes`, { reason: "Test" });
setDay(D(3), parent, kid);
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("v Den regenerace sync pošle locked=true a 0 minut", r.data.ok === true && r.data.locked === true && r.data.minutes === 0, JSON.stringify(r.data));
check("webhook dostal locked=true", received[2].json.locked === true && received[2].json.minutes === 0);

/* ---- chybová odpověď webhooku se zaznamená, ale nespadne ---- */
webhookStatus = 500;
r = await parent.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("chyba 500 z webhooku se vrátí jako ok:false se stavovým kódem", r.status === 200 && r.data.ok === false && r.data.status === 500, JSON.stringify(r.data));
webhookStatus = 200;

r = await parent.req("GET", `/api/family/${fam}/game`);
const last = r.data.children[0].ha.last;
check("přehled ukazuje poslední (neúspěšný) pokus", last && last.ok === false, JSON.stringify(last));

/* ---- oprávnění na čtení výsledku ---- */
r = await kid.req("POST", `/api/game/status`); // jen na ověření, že sync endpoint sám nejde volat bez role rodiče
r = await kid.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("dítě nesmí spustit sync", r.status === 403);
r = await outsider.req("POST", `/api/family/${fam}/children/${kid.id}/ha-sync`);
check("cizí rodič nesmí spustit sync cizího dítěte", r.status === 403);
r = await parent.req("POST", `/api/family/${fam}/children/${outsider.id}/ha-sync`);
check("sync nad neexistujícím dítětem v rodině = 404", r.status === 404);

hook.close();
console.log(`\n${pass} OK, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
