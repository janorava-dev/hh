import type { Env } from "./index";

/* ---------- pravidla (musí sedět s docs/pravidla.md) ---------- */

export const MISSION_ITEMS = 5;
export const MISSION_MINUTES = 30;
export const MISSION_XP = 40;
export const BONUS_CAP = 30; // max. bonusových minut za den
export const MAX_STRIKES = 3;

export const XPT = [0, 100, 240, 420, 640, 900, 1200, 1540, 1920, 2340]; // práh XP pro level 1..10
export const levelOf = (xp: number) => XPT.reduce((l, t, i) => (xp >= t ? i + 1 : l), 1);

export const HEROES = ["knight", "wizard", "ninja", "astro", "robot", "fox", "ondatra"];
export const SLOTS: Record<string, { lvl: number; opts: string[] }> = {
  cape: { lvl: 2, opts: ["red", "blue", "gold"] },
  neck: { lvl: 3, opts: ["scarf", "medal", "gem"] },
  tool: { lvl: 5, opts: ["broom", "spray", "sponge"] },
  pet: { lvl: 7, opts: ["slime", "kitten", "dragon"] },
  aura: { lvl: 9, opts: ["gold", "ice", "fire"] },
};

/* ---------- dny (Europe/Prague) ---------- */

const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" });
export const pragueDay = (d = new Date()) => fmt.format(d);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Dnešek. Jen s ALLOW_TEST_DAY=1 (lokální .dev.vars) jde den přepsat hlavičkou x-test-day pro testy. */
export function today(req: Request, env: Env): string {
  const t = req.headers.get("x-test-day");
  if (env.ALLOW_TEST_DAY === "1" && t && isDay(t)) return t;
  return pragueDay();
}

const mondayOf = (day: string) => {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = neděle
  return addDays(day, -((dow + 6) % 7));
};

/* ---------- stav dítěte ---------- */

export interface ChildState {
  today: string;
  regen: boolean; // dnes je Den regenerace
  regenTomorrow: boolean; // dnes už je 3. trhlina
  usable: number; // minuty k dispozici dnes
  base: number; // z toho vyděláno včera
  carry: number; // z toho přeneseno ze Dne regenerace
  tomorrow: number; // minuty, které bude mít zítra
  tomorrowPending: number; // + čeká na schválení
  strikes: { id: string; reason: string; at: string }[];
  mission: { items: number[]; status: "open" | "pending" | "approved" };
  bonus: { id: string; label: string; minutes: number; xp: number; status: "open" | "pending" | "approved" }[];
  xp: number;
  weekXp: number;
  streak: number;
  hero: { hero: string; name: string | null; equipment: Record<string, string> };
}

export async function childState(env: Env, childId: string, familyId: string, day: string): Promise<ChildState> {
  const from = addDays(day, -30);
  await env.DB.prepare("INSERT OR IGNORE INTO mission_days (child_id, day) VALUES (?, ?)").bind(childId, day).run();

  const [minutesRows, xpRow, weekRow, strikeRows, missionRow, approvedRows, claimRows, choreRows, heroRow, bonusGrant] =
    await env.DB.batch([
      env.DB.prepare(
        "SELECT earned_day AS d, SUM(amount) AS a FROM ledger WHERE child_id = ? AND kind = 'minutes' AND earned_day >= ? GROUP BY earned_day",
      ).bind(childId, from),
      env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM ledger WHERE child_id = ? AND kind = 'xp'").bind(childId),
      env.DB.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS a FROM ledger WHERE child_id = ? AND kind = 'xp' AND earned_day >= ?",
      ).bind(childId, mondayOf(day)),
      env.DB.prepare("SELECT id, day, reason, created_at FROM strikes WHERE child_id = ? AND day >= ? ORDER BY created_at").bind(
        childId,
        from,
      ),
      env.DB.prepare("SELECT items, status FROM mission_days WHERE child_id = ? AND day = ?").bind(childId, day),
      env.DB.prepare("SELECT day FROM mission_days WHERE child_id = ? AND status = 'approved' AND day >= ?").bind(childId, from),
      env.DB.prepare("SELECT id, chore_id, status FROM bonus_claims WHERE child_id = ? AND day = ? AND status != 'rejected'").bind(
        childId,
        day,
      ),
      env.DB.prepare(
        "SELECT id, label, minutes, xp FROM chores WHERE family_id = ? AND active = 1 ORDER BY created_at, label",
      ).bind(familyId),
      env.DB.prepare("SELECT hero, name, equipment FROM heroes WHERE child_id = ?").bind(childId),
      env.DB.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS a FROM ledger WHERE child_id = ? AND kind = 'minutes' AND source = 'bonus' AND earned_day = ?",
      ).bind(childId, day),
    ]);

  const minutesBy = new Map((minutesRows.results as { d: string; a: number }[]).map((r) => [r.d, r.a]));
  const strikes = strikeRows.results as { id: string; day: string; reason: string; created_at: string }[];
  const strikeCount = (d: string) => strikes.filter((s) => s.day === d).length;
  const regenOf = (d: string) => strikeCount(addDays(d, -1)) >= MAX_STRIKES;

  // přenos minut ze Dne regenerace: co bylo den předtím zamčené, platí o den později
  const carryBy = new Map<string, number>();
  for (let d = from; d <= day; d = addDays(d, 1)) {
    const prev = addDays(d, -1);
    const lockedPrev = regenOf(prev) ? (minutesBy.get(addDays(prev, -1)) ?? 0) + (carryBy.get(prev) ?? 0) : 0;
    carryBy.set(d, lockedPrev);
  }

  const base = minutesBy.get(addDays(day, -1)) ?? 0;
  const carry = carryBy.get(day) ?? 0;
  const regen = regenOf(day);
  const earnedToday = minutesBy.get(day) ?? 0;

  const mission = missionRow.results[0] as { items: string; status: "open" | "pending" | "approved" };
  const claims = new Map((claimRows.results as { chore_id: string; status: "pending" | "approved" }[]).map((c) => [c.chore_id, c.status]));
  const chores = choreRows.results as { id: string; label: string; minutes: number; xp: number }[];

  const grantedBonus = (bonusGrant.results[0] as { a: number }).a;
  const pendingBonus = chores.filter((c) => claims.get(c.id) === "pending").reduce((s, c) => s + c.minutes, 0);
  const tomorrowPending =
    (mission.status === "pending" ? MISSION_MINUTES : 0) + Math.min(pendingBonus, Math.max(0, BONUS_CAP - grantedBonus));

  const approved = new Set((approvedRows.results as { day: string }[]).map((r) => r.day));
  let streak = 0;
  for (let d = approved.has(day) ? day : addDays(day, -1); approved.has(d); d = addDays(d, -1)) streak++;

  const h = heroRow.results[0] as { hero: string; name: string | null; equipment: string } | undefined;
  return {
    today: day,
    regen,
    regenTomorrow: strikeCount(day) >= MAX_STRIKES,
    usable: regen ? 0 : base + carry,
    base,
    carry,
    tomorrow: earnedToday + (regen ? base + carry : 0),
    tomorrowPending,
    strikes: strikes.filter((s) => s.day === day).map((s) => ({ id: s.id, reason: s.reason, at: s.created_at })),
    mission: { items: JSON.parse(mission.items) as number[], status: mission.status },
    bonus: chores.map((c) => ({ ...c, status: claims.get(c.id) ?? "open" })),
    xp: (xpRow.results[0] as { a: number }).a,
    weekXp: (weekRow.results[0] as { a: number }).a,
    streak,
    hero: { hero: h?.hero ?? "knight", name: h?.name ?? null, equipment: h ? JSON.parse(h.equipment) : {} },
  };
}
