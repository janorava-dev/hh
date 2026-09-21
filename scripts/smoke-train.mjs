// Smoke test tréninku počítání, roku narození a denní historie.
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
    const ct = res.headers.get("content-type") || "";
    let data = null;
    try { data = ct.includes("json") ? await res.clone().json() : null; } catch {}
    return { status: res.status, data, res };
  }
}
const setDay = (d, ...cs) => cs.forEach((c) => (c.day = d));

const sa = new Client();
await sa.req("POST", "/api/auth/login", { username: "admin", password: "test-heslo-123" });
const fam = (await sa.req("POST", "/api/admin/families", { name: "Trénink " + rnd })).data.id;
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
const kid = await mk("Mikus", "child", fam);
const outsider = await mk("cizi", "parent", fam2);

/* ---- generátor: správnost výsledků ---- */
const evalExpr = (e) => Function(`"use strict"; return (${e});`)();
for (const g of [1, 2, 3, 4, 5, 6, 8]) {
  const r = await kid.req("GET", `/api/me/train/sample?grade=${g}`);
  const qs = r.data?.questions ?? [];
  const bad = qs.filter((q) => {
    const val = q.expr ? evalExpr(q.expr) : Number(q.a.replace(",", "."));
    const ans = Number(q.a.replace(",", "."));
    return !Number.isFinite(ans) || Math.abs(val - ans) > 1e-9 || !q.q || (g <= 5 && ans < 0);
  });
  check(`generátor ročník ${g}: ${qs.length} příkladů, všechny správně spočtené`, qs.length === 200 && bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  for (let i = 0; i < 20; i++) {
    const set = qs.slice(i * 10, i * 10 + 10).map((q) => q.q);
    if (new Set(set).size !== 10) { check(`ročník ${g}: příklady v sadě jsou různé`, false, set.join(" | ")); break; }
  }
}
const s3 = (await kid.req("GET", "/api/me/train/sample?grade=3")).data.questions;
check("ročník 3: násobilka a dělení v sadě", s3.some((q) => q.q.includes("×")) && s3.some((q) => q.q.includes(":")));

/* ---- rok narození ---- */
r0: {
  let r = await kid.req("GET", "/api/me/train");
  check("bez roku narození: needsBirthYear", r.data.needsBirthYear === true && r.data.grade === null, JSON.stringify(r.data));
  r = await kid.req("POST", "/api/me/train/start");
  check("bez roku narození nejde začít (409)", r.status === 409, r.status + " " + JSON.stringify(r.data));
  r = await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 1990 });
  check("rok narození 1990 = 400", r.status === 400);
  r = await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2025 });
  check("rok narození 2025 = 400", r.status === 400);
  r = await outsider.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2018 });
  check("cizí rodič nesmí nastavit rok narození", r.status === 403);
  r = await kid.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2010 });
  check("dítě si rok narození nenastaví", r.status === 403);
  r = await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2018 });
  check("rok 2018 -> 3. třída (říjen 2026)", r.status === 200 && r.data.grade === 3, JSON.stringify(r.data));
  setDay("2027-03-01", parent);
  r = await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2018 });
  check("rok 2018 -> pořád 3. třída v březnu 2027 (školní rok)", r.data.grade === 3, JSON.stringify(r.data));
  setDay("2026-10-01", parent);
  r = await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2016 });
  check("rok 2016 -> 5. třída", r.data.grade === 5);
  r = await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2018 });
}

/* ---- sady příkladů a odměny ---- */
setDay("2026-10-01", parent, kid, outsider);
const play = async (correctCount, gapMs) => {
  let r = await kid.req("POST", "/api/me/train/start");
  const sess = r.data.session, answers = r.data.debugAnswers;
  let last;
  for (let i = 0; i < sess.total; i++) {
    if (gapMs) await sleep(gapMs);
    last = await kid.req("POST", "/api/me/train/answer", { sessionId: sess.id, answer: i < correctCount ? answers[i] : "-999" });
  }
  return { start: r, sess, last };
};

let r = await kid.req("POST", "/api/me/train/start");
check("start: 201, 10 příkladů, žádné odpovědi v odpovědi serveru", r.status === 201 && r.data.session.total === 10 && r.data.session.questions.length === 10 && !JSON.stringify(r.data.session).includes('"a"'), JSON.stringify(r.data.session));
const again = await kid.req("POST", "/api/me/train/start");
check("otevřenou sadu start vrátí znovu (pokračování)", again.data.session.id === r.data.session.id);
const openId = r.data.session.id, openAns = r.data.debugAnswers;
r = await kid.req("POST", "/api/me/train/answer", { sessionId: openId, answer: "" });
check("prázdná odpověď = 400", r.status === 400);
r = await kid.req("POST", "/api/me/train/answer", { sessionId: openId, answer: openAns[0] });
check("první správná odpověď", r.status === 200 && r.data.ok === true && r.data.done === false);
r = await kid.req("POST", "/api/me/train/answer", { sessionId: openId, answer: "-999" });
check("špatná odpověď vrátí správný výsledek", r.data.ok === false && r.data.correctAnswer === openAns[1], JSON.stringify(r.data));
r = await kid.req("GET", "/api/me/train");
check("rozdělaná sada je vidět (2 odpovězené)", r.data.open?.answered === 2 && r.data.open.results.length === 2);
for (let i = 2; i < 10; i++) { await sleep(130); r = await kid.req("POST", "/api/me/train/answer", { sessionId: openId, answer: openAns[i] }); }
check("sada 1 (9 z 10, pomalu): 15 XP a 5 minut", r.data.done === true && r.data.summary.correct === 9 && r.data.summary.xp === 15 && r.data.summary.minutes === 5, JSON.stringify(r.data));
r = await kid.req("POST", "/api/me/train/answer", { sessionId: openId, answer: "1" });
check("uzavřená sada se už nedá měnit (404)", r.status === 404);

let p = await play(10, 0);
check("sada 2 odpovězená bleskově: bez odměny (příliš rychle)", p.last.data.summary.tooFast === true && p.last.data.summary.xp === 0 && p.last.data.summary.minutes === 0, JSON.stringify(p.last.data.summary));
p = await play(6, 130);
check("sada 3 (60 %): jen 5 XP, žádné minuty", p.last.data.summary.xp === 5 && p.last.data.summary.minutes === 0 && p.last.data.summary.correct === 6, JSON.stringify(p.last.data.summary));
for (let n = 4; n <= 5; n++) {
  p = await play(9, 130);
  check(`sada ${n} nad 80 %: 15 XP a 5 minut`, p.last.data.summary.xp === 15 && p.last.data.summary.minutes === 5, JSON.stringify(p.last.data.summary));
}
p = await play(10, 130);
check("sada 6 úspěšná: XP ano, minuty ne (strop 15 min/den z tréninku)", p.last.data.summary.xp === 15 && p.last.data.summary.minutes === 0 && p.last.data.summary.capReached === true && p.last.data.summary.minutesToday === 15, JSON.stringify(p.last.data.summary));

r = await kid.req("GET", "/api/me/train");
check("stav tréninku: 6 sad a 15 minut dnes", r.data.sessionsToday === 6 && r.data.minutesToday === 15 && r.data.open === null, JSON.stringify(r.data));
r = await kid.req("GET", "/api/me/game");
check("minuty z tréninku platí až zítra: dnes 0, zítra 15; XP 65", r.data.state.usable === 0 && r.data.state.tomorrow === 15 && r.data.state.xp === 65, JSON.stringify(r.data.state));

/* ---- historie ---- */
r = await kid.req("GET", "/api/me/history?days=3");
const today = r.data.days.at(-1);
check("historie dítěte: 3 řádky", r.data.days.length === 3 && today.day === "2026-10-01", JSON.stringify(r.data.days.map((d) => d.day)));
check("historie: XP 65, minuty 15, 6 sad, 60 odpovědí", today.xpEarned === 65 && today.minutesEarned === 15 && today.trainSessions === 6 && today.trainTotal === 60 && today.xpTotal === 65 && today.level === 1, JSON.stringify(today));
check("historie: dny bez aktivity jsou nulové řádky", r.data.days[0].xpEarned === 0 && r.data.days[0].minutesUsable === 0);

setDay("2026-10-02", parent, kid, outsider);
r = await kid.req("GET", "/api/me/game");
const usableD2 = r.data.state.usable;
r = await kid.req("GET", "/api/me/history?days=2");
check("historie a stav sedí: minuty k dispozici 2. den = 15", usableD2 === 15 && r.data.days.at(-1).minutesUsable === 15 && r.data.days.at(-1).minutesCarry === 0, JSON.stringify(r.data.days.at(-1)));

// 2. den ještě jedna úspěšná sada (5 minut, platí od 3. dne), pak 3 trhliny -> 3. den je Den regenerace
p = await play(9, 130);
check("2. den: další sada dá 5 minut", p.last.data.summary.minutes === 5 && p.last.data.summary.minutesToday === 5, JSON.stringify(p.last.data.summary));
setDay("2026-10-02", parent);
for (let i = 0; i < 3; i++) await parent.req("POST", `/api/family/${fam}/children/${kid.id}/strikes`, { reason: "Test" });
setDay("2026-10-03", parent, kid);
r = await kid.req("GET", "/api/me/history?days=3");
const d3 = r.data.days.at(-1);
check("historie: Den regenerace, dnes 0, zamčeno 5 (přesunuto)", d3.regen === true && d3.minutesUsable === 0 && d3.minutesLocked === 5 && d3.strikes === 0, JSON.stringify(d3));
check("historie: trhliny 2. dne = 3", r.data.days.at(-2).strikes === 3);
setDay("2026-10-04", parent, kid);
r = await kid.req("GET", "/api/me/history?days=1");
check("historie: 4. den přeneseno 5 minut", r.data.days[0].minutesUsable === 5 && r.data.days[0].minutesCarry === 5 && r.data.days[0].regen === false, JSON.stringify(r.data.days[0]));
r = await kid.req("GET", "/api/me/game");
check("stav 4. den sedí s historií (5 přeneseno)", r.data.state.usable === 5 && r.data.state.carry === 5, JSON.stringify(r.data.state));

/* ---- rodič: přehled, historie, CSV ---- */
setDay("2026-10-04", parent, kid, outsider);
r = await parent.req("GET", `/api/family/${fam}/game`);
const kc = r.data.children[0];
check("rodičovský přehled: rok narození, ročník a trénink", kc.birthYear === 2018 && kc.grade === 3 && kc.training && r.data.limits.trainCap === 15, JSON.stringify(kc.training));
r = await parent.req("GET", `/api/family/${fam}/history?days=5`);
check("rodič vidí historii dětí", r.status === 200 && r.data.children.length === 1 && r.data.children[0].days.length === 5);
r = await parent.req("GET", `/api/family/${fam}/history?days=5&format=csv`);
const buf = new Uint8Array(await r.res.arrayBuffer());
const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf);
check("CSV: typ, BOM (kvůli Excelu), hlavička a 5 dní + 1 řádek hlavičky", r.status === 200 && (r.res.headers.get("content-type") || "").startsWith("text/csv") && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf && csv.includes("Dítě;Den;") && csv.trim().split("\r\n").length === 6 && csv.includes("Mikus;2026-10-01;65;15;"), csv.slice(0, 300));
r = await kid.req("GET", `/api/family/${fam}/history?days=5`);
check("dítě nevidí rodičovskou historii", r.status === 403);
r = await outsider.req("GET", `/api/family/${fam}/history?days=5`);
check("cizí rodič nevidí historii", r.status === 403);
r = await parent.req("GET", "/api/me/history");
check("rodič nemá dětskou historii", r.status === 403);

console.log(`\n${pass} OK, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
