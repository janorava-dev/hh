import type { Env } from "./index";
import { addDays, levelOf, MAX_STRIKES, pragueDay } from "./game";

/** Denní souhrn dítěte. Počítá se ze zdrojových tabulek, uložený je kvůli historii a dalšímu využití. */
export interface DayStat {
  day: string;
  xpEarned: number;
  minutesEarned: number; // získané tento den, platí od dalšího dne
  minutesUsable: number; // k dispozici tento den (0 v Den regenerace)
  minutesCarry: number; // z toho přenesené ze Dne regenerace
  minutesLocked: number; // zamčené Dnem regenerace, přesunuté na další den
  regen: boolean;
  strikes: number;
  missionStatus: "none" | "open" | "pending" | "approved";
  missionDone: number;
  bonusDone: number;
  trainSessions: number;
  trainCorrect: number;
  trainTotal: number;
  xpTotal: number;
  level: number;
}

type Row = Record<string, number | string>;

export async function computeDaily(env: Env, childId: string, from: string, to: string): Promise<DayStat[]> {
  const pre = addDays(from, -30); // kvůli řetězci Dnů regenerace
  const [led, xpBefore, strk, miss, claims, train] = await env.DB.batch([
    env.DB.prepare(
      "SELECT earned_day AS d, kind, SUM(amount) AS a FROM ledger WHERE child_id = ? AND earned_day >= ? AND earned_day <= ? GROUP BY earned_day, kind",
    ).bind(childId, pre, to),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM ledger WHERE child_id = ? AND kind = 'xp' AND earned_day < ?").bind(
      childId,
      pre,
    ),
    env.DB.prepare("SELECT day AS d, COUNT(*) AS n FROM strikes WHERE child_id = ? AND day >= ? AND day <= ? GROUP BY day").bind(
      childId,
      pre,
      to,
    ),
    env.DB.prepare("SELECT day AS d, status, items FROM mission_days WHERE child_id = ? AND day >= ? AND day <= ?").bind(childId, from, to),
    env.DB.prepare(
      "SELECT day AS d, COUNT(*) AS n FROM bonus_claims WHERE child_id = ? AND status = 'approved' AND day >= ? AND day <= ? GROUP BY day",
    ).bind(childId, from, to),
    env.DB.prepare(
      "SELECT day AS d, COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c, COALESCE(SUM(total), 0) AS t FROM train_sessions WHERE child_id = ? AND status = 'done' AND day >= ? AND day <= ? GROUP BY day",
    ).bind(childId, from, to),
  ]);

  const minutesBy = new Map<string, number>();
  const xpBy = new Map<string, number>();
  for (const r of led.results as Row[]) (r.kind === "minutes" ? minutesBy : xpBy).set(r.d as string, r.a as number);
  const strikeBy = new Map((strk.results as Row[]).map((r) => [r.d as string, r.n as number]));
  const missionBy = new Map((miss.results as Row[]).map((r) => [r.d as string, r]));
  const bonusBy = new Map((claims.results as Row[]).map((r) => [r.d as string, r.n as number]));
  const trainBy = new Map((train.results as Row[]).map((r) => [r.d as string, r]));

  const regenOf = (d: string) => (strikeBy.get(addDays(d, -1)) ?? 0) >= MAX_STRIKES;
  const carryBy = new Map<string, number>();
  let xpTotal = (xpBefore.results[0] as { a: number }).a;
  const out: DayStat[] = [];

  for (let d = pre; d <= to; d = addDays(d, 1)) {
    const prev = addDays(d, -1);
    // co bylo včera zamčené Dnem regenerace (základ + dřívější přenos), platí až dnes
    const carry = regenOf(prev) ? (minutesBy.get(addDays(prev, -1)) ?? 0) + (carryBy.get(prev) ?? 0) : 0;
    carryBy.set(d, carry);
    xpTotal += xpBy.get(d) ?? 0;
    if (d < from) continue;

    const base = minutesBy.get(prev) ?? 0;
    const regen = regenOf(d);
    const held = base + carry;
    const m = missionBy.get(d);
    const t = trainBy.get(d);
    out.push({
      day: d,
      xpEarned: xpBy.get(d) ?? 0,
      minutesEarned: minutesBy.get(d) ?? 0,
      minutesUsable: regen ? 0 : held,
      minutesCarry: carry,
      minutesLocked: regen ? held : 0,
      regen,
      strikes: strikeBy.get(d) ?? 0,
      missionStatus: (m?.status as DayStat["missionStatus"]) ?? "none",
      missionDone: m ? (JSON.parse(m.items as string) as number[]).filter(Boolean).length : 0,
      bonusDone: bonusBy.get(d) ?? 0,
      trainSessions: (t?.n as number) ?? 0,
      trainCorrect: (t?.c as number) ?? 0,
      trainTotal: (t?.t as number) ?? 0,
      xpTotal,
      level: levelOf(xpTotal),
    });
  }
  return out;
}

const UPSERT = `INSERT INTO daily_stats (child_id, day, xp_earned, minutes_earned, minutes_usable, minutes_carry, minutes_locked, regen,
    strikes, mission_status, mission_done, bonus_done, train_sessions, train_correct, train_total, xp_total, level, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (child_id, day) DO UPDATE SET xp_earned = excluded.xp_earned, minutes_earned = excluded.minutes_earned,
    minutes_usable = excluded.minutes_usable, minutes_carry = excluded.minutes_carry, minutes_locked = excluded.minutes_locked,
    regen = excluded.regen, strikes = excluded.strikes, mission_status = excluded.mission_status, mission_done = excluded.mission_done,
    bonus_done = excluded.bonus_done, train_sessions = excluded.train_sessions, train_correct = excluded.train_correct,
    train_total = excluded.train_total, xp_total = excluded.xp_total, level = excluded.level, updated_at = excluded.updated_at`;

export async function saveDaily(env: Env, childId: string, rows: DayStat[]): Promise<void> {
  const now = new Date().toISOString();
  const stmts = rows.map((s) =>
    env.DB.prepare(UPSERT).bind(
      childId, s.day, s.xpEarned, s.minutesEarned, s.minutesUsable, s.minutesCarry, s.minutesLocked, s.regen ? 1 : 0,
      s.strikes, s.missionStatus, s.missionDone, s.bonusDone, s.trainSessions, s.trainCorrect, s.trainTotal, s.xpTotal, s.level, now,
    ),
  );
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
}

export async function refreshStats(env: Env, childId: string, from: string, to: string): Promise<void> {
  await saveDaily(env, childId, await computeDaily(env, childId, from, to));
}

/** Přepočet po změně. Chyba přepočtu nikdy nesmí shodit akci uživatele. */
export async function touchStats(env: Env, childId: string, sinceDay: string, today: string): Promise<void> {
  try {
    await refreshStats(env, childId, sinceDay < today ? sinceDay : today, today);
  } catch (e) {
    console.error("touchStats", e);
  }
}

export async function readDaily(env: Env, childId: string, from: string, to: string): Promise<DayStat[]> {
  const r = await env.DB.prepare(
    `SELECT day, xp_earned AS xpEarned, minutes_earned AS minutesEarned, minutes_usable AS minutesUsable, minutes_carry AS minutesCarry,
            minutes_locked AS minutesLocked, regen, strikes, mission_status AS missionStatus, mission_done AS missionDone,
            bonus_done AS bonusDone, train_sessions AS trainSessions, train_correct AS trainCorrect, train_total AS trainTotal,
            xp_total AS xpTotal, level
       FROM daily_stats WHERE child_id = ? AND day >= ? AND day <= ? ORDER BY day`,
  )
    .bind(childId, from, to)
    .all<Omit<DayStat, "regen"> & { regen: number }>();
  return r.results.map((x) => ({ ...x, regen: !!x.regen }));
}

/** Historie za posledních `days` dní včetně dneška: nejdřív přepočet, pak čtení uložených řádků. */
export async function history(env: Env, childId: string, today: string, days: number): Promise<DayStat[]> {
  const from = addDays(today, -(days - 1));
  await refreshStats(env, childId, from, today);
  return readDaily(env, childId, from, today);
}

export const clampDays = (v: string | null, def = 30, max = 180) => Math.min(max, Math.max(1, Math.floor(Number(v)) || def));

/** Noční úloha: dopočítá poslední dny všem dětem, i těm, které dnes nic nedělaly. */
export async function refreshAll(env: Env): Promise<void> {
  const today = pragueDay();
  const kids = await env.DB.prepare(
    "SELECT DISTINCT m.user_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'child' AND u.disabled = 0",
  ).all<{ id: string }>();
  for (const k of kids.results) await refreshStats(env, k.id, addDays(today, -2), today);
}
