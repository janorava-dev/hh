// Smoke test malé násobilky (extra výzva vedle tréninku podle ročníku): generátor, dvoudílná odpověď
// (podíl a zbytek), úspěšnost, žádné XP, žádný denní strop, žádný požadavek na rok narození.
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
  day = "2027-01-01";
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

const sa = new Client();
await sa.req("POST", "/api/auth/login", { username: "admin", password: "test-heslo-123" });
const fam = (await sa.req("POST", "/api/admin/families", { name: "Tab " + rnd })).data.id;
const mk = async (u, role, family) => {
  const r = await sa.req("POST", "/api/admin/users", { username: `${u}_${rnd}`, displayName: u, password: "docasne-heslo1", familyId: family, role });
  const c = new Client();
  await c.req("POST", "/api/auth/login", { username: `${u}_${rnd}`, password: "docasne-heslo1" });
  await c.req("POST", "/api/auth/password", { current: "docasne-heslo1", next: "nove-heslo-123" });
  c.id = r.data.id;
  return c;
};
const parent = await mk("mama", "parent", fam);
const kid = await mk("Kid", "child", fam);
kid.day = "2027-01-01";

/* ---- generátor: sada je vždy 10 příkladů, jednodílné násobení nebo dvoudílné dělení ---- */
{
  const r = await kid.req("GET", "/api/me/train/sample?kind=tables");
  const qs = r.data?.questions ?? [];
  check("sample: 200 příkladů", qs.length === 200, String(qs.length));
  const bad = qs.filter((q) => {
    if (/×/.test(q.q)) {
      const [a, b] = q.q.match(/(\d+) × (\d+)/).slice(1).map(Number);
      return String(a * b) !== q.a || a < 1 || a > 10 || b < 1 || b > 10;
    }
    const m = q.q.match(/(\d+) : (\d+) = \? zb\. \?/);
    if (!m) return true;
    const [n, d] = m.slice(1).map(Number);
    const [qq, rr] = q.a.split(" ").map(Number);
    return d < 2 || d > 9 || qq < 1 || qq > 9 || rr < 1 || rr >= d || n !== d * qq + rr;
  });
  check("sample: násobení je 1–10×1–10, dělení dává jednociferný podíl a nenulový zbytek", bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  check("sample: obsahuje oba typy (× i :)", qs.some((q) => q.q.includes("×")) && qs.some((q) => q.q.includes(":")));
}

/* ---- start nevyžaduje rok narození, na rozdíl od hlavního tréninku ---- */
let r = await kid.req("GET", "/api/me/train?kind=tables");
check("stav násobilky bez needsBirthYear", r.data.kind === "tables" && r.data.needsBirthYear === undefined && r.data.questions === 10 && r.data.minutesPerSession === 2, JSON.stringify(r.data));
r = await kid.req("POST", "/api/me/train/start", { kind: "tables" });
check("start bez roku narození projde (na rozdíl od hlavního tréninku)", r.status === 201 && r.data.session.kind === "tables" && r.data.session.total === 10, JSON.stringify(r.data));
const openId = r.data.session.id;
check("otázky mají parts 1 nebo 2, bez prozrazené odpovědi", r.data.session.questions.every((q) => (q.parts === 1 || q.parts === 2) && q.q) && !JSON.stringify(r.data.session).includes('"a"'));
const debugAns = r.data.debugAnswers;
check("dvoudílná odpověď má tvar 'podíl zbytek'", debugAns.some((a) => /^\d+ \d+$/.test(a)) && debugAns.some((a) => /^\d+$/.test(a)), JSON.stringify(debugAns));

/* ---- odpověď: dvoudílnou lze poslat jako "cislo cislo", i s více mezerami ---- */
// bez prodlevy mezi odpověďmi: v testovacím režimu je hranice "příliš rychle" 1 s (stejně jako u hlavního tréninku)
let last;
for (let i = 0; i < 10; i++) {
  const ans = i === 0 ? debugAns[i].replace(" ", "   ") : debugAns[i]; // ověř toleranci na víc mezer
  last = await kid.req("POST", "/api/me/train/answer", { sessionId: openId, answer: ans });
}
check("10/10 správně, ale příliš rychle = bez odměny", last.data.done === true && last.data.summary.correct === 10 && last.data.summary.tooFast === true && last.data.summary.minutes === 0 && last.data.summary.passed === false, JSON.stringify(last.data));
check("v souhrnu násobilky není pole xp ani minutesCap", !("xp" in last.data.summary) && !("minutesCap" in last.data.summary), JSON.stringify(last.data.summary));

const play = async (correctCount) => {
  const st = await kid.req("POST", "/api/me/train/start", { kind: "tables" });
  const sess = st.data.session, ans = st.data.debugAnswers;
  let l;
  for (let i = 0; i < sess.total; i++) {
    await sleep(130); // dost na to, aby sada nebyla "příliš rychlá" (testovací hranice 1 s)
    l = await kid.req("POST", "/api/me/train/answer", { sessionId: sess.id, answer: i < correctCount ? ans[i] : "0 0" });
  }
  return l;
};

let p = await play(10);
check("sada 2 (10/10, pomalu): +2 min, bez XP", p.data.summary.minutes === 2 && p.data.summary.passed === true && !("xp" in p.data.summary), JSON.stringify(p.data.summary));
p = await play(7);
check("sada 3 (7/10 = 70 %): pod hranicí 80 %, bez odměny", p.data.summary.correct === 7 && p.data.summary.passed === false && p.data.summary.minutes === 0, JSON.stringify(p.data.summary));
p = await play(8);
check("sada 4 (8/10 = 80 %): projde", p.data.summary.passed === true && p.data.summary.minutes === 2, JSON.stringify(p.data.summary));

/* ---- bez denního stropu: opakované úspěšné sady dál dávají +2 min ---- */
for (let n = 0; n < 3; n++) {
  p = await play(9);
  check(`opakovaná sada ${n + 1}: pořád +2 min (bez stropu)`, p.data.summary.minutes === 2, JSON.stringify(p.data.summary));
}
r = await kid.req("GET", "/api/me/train?kind=tables");
check("sessionsToday počítá všechny dokončené sady, i tu bez odměny (7)", r.data.sessionsToday === 7, JSON.stringify(r.data));

r = await kid.req("GET", "/api/me/game");
check("celkem 5 úspěšných sad × 2 min = 10 min na zítřek, XP se z násobilky nepřipsalo (0)", r.data.state.tomorrow === 10 && r.data.state.xp === 0, JSON.stringify(r.data.state));

/* ---- hlavní trénink (math) běží dál nezávisle na násobilce ---- */
r = await kid.req("GET", "/api/me/train?kind=math");
check("hlavní trénink pořád vyžaduje rok narození", r.data.kind === "math" && r.data.needsBirthYear === true);
r = await kid.req("POST", "/api/me/train/start", { kind: "math" });
check("hlavní trénink bez roku narození odmítne start (409)", r.status === 409);
await parent.req("PATCH", `/api/family/${fam}/children/${kid.id}`, { birthYear: 2016 });
r = await kid.req("POST", "/api/me/train/start", { kind: "math" });
check("po vyplnění roku narození hlavní trénink začne", r.status === 201 && r.data.session.kind === "math");
r = await kid.req("GET", "/api/me/train?kind=tables");
check("otevřená sada násobilky se neplete s otevřenou sadou hlavního tréninku", r.data.open === null);

/* ---- rodičovský přehled rozlišuje obě výzvy ---- */
r = await parent.req("GET", `/api/family/${fam}/game`);
const kc = r.data.children[0];
check("přehled: training (math) i tablesTraining (násobilka) odděleně", kc.tablesTraining && kc.tablesTraining.sessionsToday === 7 && kc.training.sessionsToday === 0, JSON.stringify([kc.training, kc.tablesTraining]));

console.log(`\n${pass} OK, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
