import { HttpError, json, readJson, text } from "./http";
import type { AuthUser } from "./auth";
import type { Env } from "./index";
import { touchStats } from "./stats";
import { getSettings, grantCredit } from "./arcade";

/* ---------- pravidla tréninku (musí sedět s docs/pravidla.md) ---------- */

export const TRAIN_QUESTIONS = 10;
export const TRAIN_MINUTES_PER_SESSION = 5; // za sadu s úspěšností aspoň 80 %
export const TRAIN_MINUTES_CAP = 15; // nejvýš za den (minuty platí od zítřka jako vždy)
export const TRAIN_XP_PASS = 15; // úspěšnost aspoň 80 %
export const TRAIN_XP_PARTIAL = 5; // úspěšnost 50–79 %
const PASS = 0.8;
const PARTIAL = 0.5;
const MIN_TOTAL_MS = 12_000; // rychleji nejde, odpovědi by nebyly poctivé

/** Ročník podle roku narození. Školní rok začíná v září: dítě narozené 2018 je od 9/2026 ve 3. třídě. */
export function gradeOf(birthYear: number, day: string): number {
  const y = Number(day.slice(0, 4));
  const schoolYear = Number(day.slice(5, 7)) >= 9 ? y : y - 1;
  return Math.min(9, Math.max(1, schoolYear - birthYear - 5));
}

/* ---------- generátor příkladů ---------- */

export interface Q {
  q: string; // zadání
  a: string; // správná odpověď (desetinná čárka)
  expr?: string; // JS výraz pro test (jen aritmetika)
}

const rnd = (n: number) => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] % n;
};
const ri = (a: number, b: number) => a + rnd(b - a + 1);
const pick = <T>(xs: T[]): T => xs[rnd(xs.length)];
const f = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); // 12 345
const dec = (n: number) => String(n).replace(".", ",");

const SYM = { "+": "+", "-": "−", "*": "×", "/": ":" } as const;
function arith(a: number, op: keyof typeof SYM, b: number): Q {
  const ans = op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b;
  return { q: `${f(a)} ${SYM[op]} ${f(b)} =`, a: String(ans), expr: `${a}${op}${b}` };
}
const add = (lo: number, hi: number, step = 1): Q =>
  arith(ri(lo / step, hi / step) * step, "+", ri(lo / step, hi / step) * step);
const sub = (lo: number, hi: number, step = 1): Q => {
  let a = ri(lo / step, hi / step) * step;
  let b = ri(lo / step, hi / step) * step;
  if (b > a) [a, b] = [b, a];
  return arith(a, "-", b);
};
const mul = (aMin: number, aMax: number, bMin: number, bMax: number): Q => arith(ri(aMin, aMax), "*", ri(bMin, bMax));
const div = (dMax: number, qMax: number): Q => {
  const d = ri(2, dMax);
  return arith(d * ri(2, qMax), "/", d);
};
const blankAdd = (lo: number, hi: number): Q => {
  const x = ri(lo, hi), y = ri(lo, hi);
  return { q: `${f(x)} + ? = ${f(x + y)}`, a: String(y), expr: `${x + y}-${x}` };
};
const blankMul = (m: number): Q => {
  const x = ri(2, m), y = ri(2, 10);
  return { q: `? × ${x} = ${x * y}`, a: String(y), expr: `${x * y}/${x}` };
};
const remainder = (nMax: number, dMax: number): Q => {
  let n: number, d: number;
  do {
    d = ri(3, dMax);
    n = ri(d + 2, nMax);
  } while (n % d === 0);
  return { q: `Zbytek po dělení ${n} : ${d} =`, a: String(n % d), expr: `${n}%${d}` };
};
const priority = (paren: boolean): Q => {
  const a = ri(2, 20), b = ri(2, 9), c = ri(2, 9);
  return paren
    ? { q: `(${a} + ${b}) × ${c} =`, a: String((a + b) * c), expr: `(${a}+${b})*${c}` }
    : { q: `${a} + ${b} × ${c} =`, a: String(a + b * c), expr: `${a}+${b}*${c}` };
};
const rounding = (): Q => {
  const n = ri(1001, 99999);
  const to = pick([10, 100, 1000]);
  const name = { 10: "desítky", 100: "stovky", 1000: "tisíce" }[to as 10 | 100 | 1000];
  return { q: `Zaokrouhli ${f(n)} na ${name}:`, a: String(Math.round(n / to) * to), expr: `Math.round(${n}/${to})*${to}` };
};
const decimals = (): Q => {
  const x = ri(11, 99), y = ri(11, 99);
  if (rnd(2)) return { q: `${dec(x / 10)} + ${dec(y / 10)} =`, a: dec((x + y) / 10), expr: `(${x}+${y})/10` };
  const [hi, lo] = x >= y ? [x, y] : [y, x];
  return { q: `${dec(hi / 10)} − ${dec(lo / 10)} =`, a: dec((hi - lo) / 10), expr: `(${hi}-${lo})/10` };
};
const fractionOf = (): Q => {
  const d = pick([2, 3, 4, 5, 10]);
  const n = d * ri(2, 12);
  return { q: `1/${d} z ${n} =`, a: String(n / d), expr: `${n}/${d}` };
};
const percent = (): Q => {
  const p = pick([10, 20, 25, 50]);
  const n = pick([40, 60, 80, 120, 200]);
  return { q: `${p} % z ${n} =`, a: String((p * n) / 100), expr: `${p}*${n}/100` };
};
const negatives = (): Q => {
  const a = ri(-12, -1), b = ri(2, 15);
  return { q: `−${-a} + ${b} =`, a: String(a + b), expr: `${a}+${b}` };
};
const word = (max: number): Q => {
  switch (rnd(4)) {
    case 0: {
      const a = ri(Math.floor(max / 3), max), b = ri(5, a - 1);
      return { q: `Máš ${a} Kč a koupíš sešit za ${b} Kč. Kolik Kč ti zbyde?`, a: String(a - b) };
    }
    case 1: {
      const a = ri(3, Math.min(30, max / 4)), b = ri(5, 10);
      return { q: `Jeden sešit stojí ${a} Kč. Kolik Kč zaplatíš za ${b} kusů?`, a: String(a * b) };
    }
    case 2: {
      const d = ri(5, 10), q = ri(2, 9);
      return { q: `${d * q} bonbonů se rozdělí rovným dílem mezi ${d} kamarádů. Kolik bonbonů dostane každý?`, a: String(q) };
    }
    default: {
      const n = ri(5, 10), c = ri(6, 30);
      return { q: `Do kina jde ${n} dětí a každé zaplatí ${c} Kč. Kolik Kč zaplatí všechny dohromady?`, a: String(n * c) };
    }
  }
};

type Cat = [number, () => Q]; // [váha, generátor]

function cats(g: number): Cat[] {
  const g1: Cat[] = [
    [3, () => { const a = ri(1, 10); return arith(a, "+", ri(1, 20 - a)); }],
    [3, () => { const a = ri(5, 20); return arith(a, "-", ri(1, a - 1)); }],
    [2, () => blankAdd(1, 9)],
  ];
  const g2: Cat[] = [
    [3, () => { const a = ri(10, 60); return arith(a, "+", ri(10, 100 - a)); }],
    [3, () => sub(20, 100)],
    [3, () => arith(pick([2, 3, 4, 5, 10]), "*", ri(1, 10))],
    [2, () => { const d = pick([2, 3, 4, 5, 10]); return arith(d * ri(1, 10), "/", d); }],
    [1, () => blankMul(5)],
    [1, () => word(100)],
  ];
  const g3: Cat[] = [
    [2, () => add(100, 900, 10)],
    [2, () => add(20, 99)],
    [3, () => sub(100, 900, 10)],
    [3, () => mul(2, 10, 2, 10)],
    [3, () => div(10, 10)],
    [1, () => blankMul(10)],
    [2, () => mul(11, 24, 2, 5)],
    [1, () => remainder(50, 9)],
    [1, () => word(500)],
  ];
  const g4: Cat[] = [
    [2, () => add(1000, 9999)],
    [2, () => sub(1000, 9999)],
    [3, () => mul(12, 99, 2, 9)],
    [1, () => mul(101, 399, 2, 5)],
    [3, () => div(9, 60)],
    [2, () => remainder(200, 9)],
    [1, () => priority(false)],
    [1, () => rounding()],
    [1, () => word(1000)],
  ];
  const g5: Cat[] = [
    [2, () => add(10000, 99999)],
    [2, () => sub(10000, 99999)],
    [3, () => mul(12, 35, 11, 25)],
    [1, () => mul(101, 999, 2, 9)],
    [3, () => { const d = ri(6, 15); return arith(d * ri(5, 25), "/", d); }], // dělitel 6–15, podíl 5–25
    [2, () => remainder(500, 15)],
    [2, decimals],
    [2, fractionOf],
    [1, () => priority(true)],
    [1, rounding],
    [1, () => word(2000)],
  ];
  const g6: Cat[] = [...g5, [2, percent], [2, negatives]];
  return g <= 1 ? g1 : g === 2 ? g2 : g === 3 ? g3 : g === 4 ? g4 : g === 5 ? g5 : g6;
}

export function makeQuestions(grade: number, n = TRAIN_QUESTIONS): Q[] {
  const cs = cats(grade);
  const total = cs.reduce((s, [k]) => s + k, 0);
  const out: Q[] = [];
  const seen = new Set<string>();
  for (let tries = 0; out.length < n && tries < 300; tries++) {
    let r = rnd(total);
    const fn = cs.find(([k]) => (r -= k) < 0)![1];
    const q = fn();
    if (seen.has(q.q)) continue;
    seen.add(q.q);
    out.push(q);
  }
  return out;
}

/** Porovná odpověď dítěte s výsledkem, čárka i tečka jako desetinný oddělovač, mezery se ignorují. */
export function isCorrect(input: string, expected: string): boolean {
  const norm = (s: string) => Number(s.replace(/[\s ]/g, "").replace(",", ".").replace("−", "-"));
  if (input.trim() === "") return false;
  const x = norm(input), y = norm(expected);
  return Number.isFinite(x) && Math.abs(x - y) < 1e-9;
}

/* ---------- endpointy /api/me/train/* ---------- */

interface SessionRow {
  id: string;
  grade: number;
  day: string;
  questions: string;
  answers: string;
  status: "open" | "done";
  started_at: string;
  correct: number;
  total: number;
  minutes_awarded: number;
  xp_awarded: number;
}
interface AnswerRec { a: string; ok: boolean; t: number; ms: number }

const trainMinutesUsed = async (env: Env, childId: string, day: string) =>
  (
    await env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS a FROM ledger WHERE child_id = ? AND kind = 'minutes' AND source = 'train' AND earned_day = ?",
    )
      .bind(childId, day)
      .first<{ a: number }>()
  )?.a ?? 0;

function publicSession(s: SessionRow) {
  const qs = JSON.parse(s.questions) as Q[];
  const as = JSON.parse(s.answers) as AnswerRec[];
  return {
    id: s.id,
    grade: s.grade,
    total: qs.length,
    answered: as.length,
    questions: qs.map((x) => x.q),
    results: as.map((x, i) => ({ answer: x.a, ok: x.ok, correctAnswer: qs[i].a })),
  };
}

export async function train(req: Request, env: Env, url: URL, me: AuthUser, day: string): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/me\/train/, "");
  const testMode = env.ALLOW_TEST_DAY === "1";

  // jen pro lokální test generátoru: 200 příkladů i s výrazy
  if (path === "/sample" && testMode) {
    const g = Number(url.searchParams.get("grade")) || 3;
    return json({ questions: Array.from({ length: 20 }, () => makeQuestions(g)).flat() });
  }

  const u = await env.DB.prepare("SELECT birth_year FROM users WHERE id = ?").bind(me.id).first<{ birth_year: number | null }>();
  const birthYear = u?.birth_year ?? null;
  const grade = birthYear === null ? null : gradeOf(birthYear, day);
  const open = () =>
    env.DB.prepare("SELECT * FROM train_sessions WHERE child_id = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1")
      .bind(me.id)
      .first<SessionRow>();

  if (path === "" && req.method === "GET") {
    const used = await trainMinutesUsed(env, me.id, day);
    const done = await env.DB.prepare("SELECT COUNT(*) AS n FROM train_sessions WHERE child_id = ? AND day = ? AND status = 'done'")
      .bind(me.id, day)
      .first<{ n: number }>();
    const o = await open();
    return json({
      needsBirthYear: birthYear === null,
      grade,
      minutesToday: used,
      minutesCap: TRAIN_MINUTES_CAP,
      minutesPerSession: TRAIN_MINUTES_PER_SESSION,
      xpPerSession: TRAIN_XP_PASS,
      questions: TRAIN_QUESTIONS,
      sessionsToday: done?.n ?? 0,
      open: o ? publicSession(o) : null,
    });
  }

  if (path === "/start" && req.method === "POST") {
    if (grade === null) throw new HttpError(409, "Rodič ještě nevyplnil tvůj rok narození, podle něj se vybírají příklady.");
    const existing = await open();
    if (existing && Date.now() - Date.parse(existing.started_at) < 12 * 3_600_000) {
      return json({ session: publicSession(existing) });
    }
    const qs = makeQuestions(grade);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO train_sessions (id, child_id, kind, grade, day, questions, started_at, total) VALUES (?, ?, 'math', ?, ?, ?, ?, ?)",
    )
      .bind(id, me.id, grade, day, JSON.stringify(qs), new Date().toISOString(), qs.length)
      .run();
    const s = (await env.DB.prepare("SELECT * FROM train_sessions WHERE id = ?").bind(id).first<SessionRow>())!;
    return json({ session: publicSession(s), ...(testMode ? { debugAnswers: qs.map((x) => x.a) } : {}) }, 201);
  }

  if (path === "/answer" && req.method === "POST") {
    const body = await readJson(req);
    const sessionId = text(body.sessionId, "sada", 1, 64);
    const answer = text(body.answer, "odpověď", 1, 20);
    const s = await env.DB.prepare("SELECT * FROM train_sessions WHERE id = ? AND child_id = ? AND status = 'open'")
      .bind(sessionId, me.id)
      .first<SessionRow>();
    if (!s) throw new HttpError(404, "Tahle sada už není otevřená");
    const qs = JSON.parse(s.questions) as Q[];
    const as = JSON.parse(s.answers) as AnswerRec[];
    const idx = as.length;
    if (idx >= qs.length) throw new HttpError(409, "Sada je už hotová");

    const now = Date.now();
    const ok = isCorrect(answer, qs[idx].a);
    as.push({ a: answer, ok, t: now, ms: now - (idx ? as[idx - 1].t : Date.parse(s.started_at)) });
    const last = as.length === qs.length;

    if (!last) {
      const upd = await env.DB.prepare(
        "UPDATE train_sessions SET answers = ? WHERE id = ? AND status = 'open' AND json_array_length(answers) = ?",
      )
        .bind(JSON.stringify(as), s.id, idx)
        .run();
      if (!upd.meta.changes) throw new HttpError(409, "Odpověď už byla odeslaná");
      return json({ index: idx, ok, correctAnswer: qs[idx].a, done: false });
    }

    // poslední odpověď: vyhodnocení a odměna
    const correct = as.filter((x) => x.ok).length;
    const ratio = correct / qs.length;
    const tooFast = now - Date.parse(s.started_at) < (testMode ? 1_000 : MIN_TOTAL_MS);
    const used = await trainMinutesUsed(env, me.id, s.day);
    const xp = tooFast ? 0 : ratio >= PASS ? TRAIN_XP_PASS : ratio >= PARTIAL ? TRAIN_XP_PARTIAL : 0;
    const minutes = tooFast || ratio < PASS ? 0 : Math.min(TRAIN_MINUTES_PER_SESSION, Math.max(0, TRAIN_MINUTES_CAP - used));
    const upd = await env.DB.prepare(
      `UPDATE train_sessions SET answers = ?, status = 'done', finished_at = ?, correct = ?, total = ?, minutes_awarded = ?, xp_awarded = ?
        WHERE id = ? AND status = 'open' AND json_array_length(answers) = ?`,
    )
      .bind(JSON.stringify(as), new Date(now).toISOString(), correct, qs.length, minutes, xp, s.id, idx)
      .run();
    if (!upd.meta.changes) throw new HttpError(409, "Odpověď už byla odeslaná");
    const ins = [];
    if (xp > 0) {
      ins.push(
        env.DB.prepare("INSERT OR IGNORE INTO ledger (id, child_id, kind, amount, earned_day, source, ref) VALUES (?, ?, 'xp', ?, ?, 'train', ?)").bind(
          crypto.randomUUID(), me.id, xp, s.day, s.id,
        ),
      );
    }
    if (minutes > 0) {
      ins.push(
        env.DB.prepare("INSERT OR IGNORE INTO ledger (id, child_id, kind, amount, earned_day, source, ref) VALUES (?, ?, 'minutes', ?, ?, 'train', ?)").bind(
          crypto.randomUUID(), me.id, minutes, s.day, s.id,
        ),
      );
    }
    if (ins.length) await env.DB.batch(ins);
    if (!tooFast && ratio >= PASS) {
      const fam = me.memberships.find((m) => m.role === "child");
      if (fam) await grantCredit(env, me.id, (await getSettings(env, fam.familyId)).trainPlays, s.day, "train", s.id);
    }
    await touchStats(env, me.id, s.day, day);
    return json({
      index: idx,
      ok,
      correctAnswer: qs[idx].a,
      done: true,
      summary: {
        correct,
        total: qs.length,
        xp,
        minutes,
        tooFast,
        capReached: ratio >= PASS && !tooFast && minutes < TRAIN_MINUTES_PER_SESSION,
        minutesToday: used + minutes,
        minutesCap: TRAIN_MINUTES_CAP,
      },
    });
  }

  throw new HttpError(404, "Nenalezeno");
}
