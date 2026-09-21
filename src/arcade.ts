import { HttpError, json, readJson, text } from "./http";
import type { AuthUser } from "./auth";
import type { Env } from "./index";
import { addDays, today, MAX_STRIKES, XPT } from "./game";

/* ---------- pravidla hry (musí sedět s docs/pravidla.md) ---------- */

export const DEFAULT_SETTINGS = { dailyPlays: 0, missionPlays: 1, trainPlays: 0 };
const MAX_SCORE = 60_000;
const MAX_POINTS_PER_SECOND = 120; // rozumná horní mez, aby nešly posílat vymyšlené výsledky
export const GAME_LEVELS = 3;

export interface GameSettings { dailyPlays: number; missionPlays: number; trainPlays: number }

export async function getSettings(env: Env, familyId: string): Promise<GameSettings> {
  const r = await env.DB.prepare("SELECT daily_plays AS dailyPlays, mission_plays AS missionPlays, train_plays AS trainPlays FROM game_settings WHERE family_id = ?")
    .bind(familyId)
    .first<GameSettings>();
  return r ?? { ...DEFAULT_SETTINGS };
}

/** Připíše spuštění hry (od dne po earnedDay). Opakované volání se stejným ref nic nepřidá. */
export async function grantCredit(env: Env, childId: string, amount: number, earnedDay: string, source: "mission" | "train" | "bonus" | "manual", ref: string): Promise<void> {
  if (amount <= 0) return;
  await env.DB.prepare("INSERT OR IGNORE INTO game_credits (id, child_id, amount, earned_day, source, ref) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), childId, amount, earnedDay, source, ref)
    .run();
}

export interface Plays {
  available: number; // kolik her může dítě dnes spustit
  allowanceLeft: number; // denní základ, který ještě zbývá
  creditsLeft: number; // nasbíraná spuštění
  tomorrow: number; // spuštění získaná dnes, která se odemknou zítra
  locked: boolean; // Den regenerace
  dailyPlays: number;
}

export async function playsFor(env: Env, userId: string, familyId: string, day: string): Promise<Plays> {
  const settings = await getSettings(env, familyId);
  const [credits, credRuns, allowRuns, tom, strikes] = await env.DB.batch([
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM game_credits WHERE child_id = ? AND earned_day < ?").bind(userId, day),
    env.DB.prepare("SELECT COUNT(*) AS n FROM game_runs WHERE user_id = ? AND via = 'credit'").bind(userId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM game_runs WHERE user_id = ? AND via = 'allowance' AND day = ?").bind(userId, day),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM game_credits WHERE child_id = ? AND earned_day = ?").bind(userId, day),
    env.DB.prepare("SELECT COUNT(*) AS n FROM strikes WHERE child_id = ? AND day = ?").bind(userId, addDays(day, -1)),
  ]);
  const creditsLeft = Math.max(0, (credits.results[0] as { a: number }).a - (credRuns.results[0] as { n: number }).n);
  const allowanceLeft = Math.max(0, settings.dailyPlays - (allowRuns.results[0] as { n: number }).n);
  const locked = (strikes.results[0] as { n: number }).n >= MAX_STRIKES;
  return {
    available: locked ? 0 : allowanceLeft + creditsLeft,
    allowanceLeft,
    creditsLeft,
    tomorrow: (tom.results[0] as { a: number }).a,
    locked,
    dailyPlays: settings.dailyPlays,
  };
}

const int = (v: unknown, label: string, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `Pole „${label}“ musí být celé číslo ${min}–${max}`);
  return v;
};

/** Změna nastavení odměn (rodič): PATCH /api/family/:id/game-settings */
export async function saveSettings(env: Env, familyId: string, body: Record<string, unknown>): Promise<GameSettings> {
  const cur = await getSettings(env, familyId);
  const next = {
    dailyPlays: body.dailyPlays === undefined ? cur.dailyPlays : int(body.dailyPlays, "denně", 0, 10),
    missionPlays: body.missionPlays === undefined ? cur.missionPlays : int(body.missionPlays, "za misi", 0, 10),
    trainPlays: body.trainPlays === undefined ? cur.trainPlays : int(body.trainPlays, "za trénink", 0, 10),
  };
  await env.DB.prepare(
    `INSERT INTO game_settings (family_id, daily_plays, mission_plays, train_plays) VALUES (?, ?, ?, ?)
     ON CONFLICT (family_id) DO UPDATE SET daily_plays = excluded.daily_plays, mission_plays = excluded.mission_plays, train_plays = excluded.train_plays`,
  )
    .bind(familyId, next.dailyPlays, next.missionPlays, next.trainPlays)
    .run();
  return next;
}

/* ---------- endpointy /api/game/* (dítě i rodič) ---------- */

export async function arcade(req: Request, env: Env, url: URL, me: AuthUser): Promise<Response> {
  const child = me.memberships.find((m) => m.role === "child");
  const parent = me.memberships.find((m) => m.role === "parent");
  if (!child && !parent && !me.isSuperadmin) throw new HttpError(403, "Hra je jen pro členy rodiny");
  const day = today(req, env);
  const path = url.pathname.replace(/^\/api\/game/, "");
  const familyId = child?.familyId ?? parent?.familyId ?? null;

  const bestOf = async (userId: string) =>
    (await env.DB.prepare("SELECT COALESCE(MAX(score), 0) AS b FROM game_runs WHERE user_id = ? AND status = 'done'").bind(userId).first<{ b: number }>())?.b ?? 0;

  const scores = async () => {
    if (!familyId) return [];
    const r = await env.DB.prepare(
      `SELECT u.id, u.display_name AS name, h.name AS heroName,
              COALESCE((SELECT MAX(score) FROM game_runs g WHERE g.user_id = u.id AND g.status = 'done'), 0) AS best
         FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN heroes h ON h.child_id = u.id
        WHERE m.family_id = ? AND m.role = 'child' AND u.disabled = 0 ORDER BY best DESC, u.display_name`,
    )
      .bind(familyId)
      .all<{ id: string; name: string; heroName: string | null; best: number }>();
    return r.results.map((x) => ({ name: x.heroName || x.name, best: x.best, me: x.id === me.id }));
  };

  if (path === "/status" && req.method === "GET") {
    let hero: { hero: string; name: string | null; equipment: Record<string, string>; xp: number } | null = null;
    let plays: Plays | null = null;
    if (child) {
      const h = await env.DB.prepare("SELECT hero, name, equipment FROM heroes WHERE child_id = ?").bind(me.id).first<{ hero: string; name: string | null; equipment: string }>();
      const xp = (await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM ledger WHERE child_id = ? AND kind = 'xp'").bind(me.id).first<{ a: number }>())?.a ?? 0;
      hero = { hero: h?.hero ?? "knight", name: h?.name ?? null, equipment: h ? JSON.parse(h.equipment) : {}, xp };
      plays = await playsFor(env, me.id, child.familyId, day);
    }
    return json({
      unlimited: !child,
      plays,
      hero,
      levels: XPT,
      best: await bestOf(me.id),
      scores: await scores(),
      displayName: me.displayName,
    });
  }

  if (path === "/start" && req.method === "POST") {
    if (!child) { // rodiče (a superadmin) hrají bez omezení
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO game_runs (id, user_id, day, via, started_at) VALUES (?, ?, ?, 'free', ?)").bind(id, me.id, day, new Date().toISOString()).run();
      return json({ runId: id, plays: null }, 201);
    }
    // dvojité klepnutí nesmí utratit dvě spuštění
    const recent = await env.DB.prepare("SELECT id, started_at FROM game_runs WHERE user_id = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1")
      .bind(me.id)
      .first<{ id: string; started_at: string }>();
    if (recent && Date.now() - Date.parse(recent.started_at) < 8000) {
      return json({ runId: recent.id, plays: await playsFor(env, me.id, child.familyId, day) });
    }
    const p = await playsFor(env, me.id, child.familyId, day);
    if (p.locked) throw new HttpError(403, "Dnes je Den regenerace, hra je zamčená.");
    if (p.available <= 0) throw new HttpError(403, "Dnes už nemáš žádné spuštění hry.");
    const via = p.allowanceLeft > 0 ? "allowance" : "credit";
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO game_runs (id, user_id, day, via, started_at) VALUES (?, ?, ?, ?, ?)").bind(id, me.id, day, via, new Date().toISOString()).run();
    return json({ runId: id, plays: await playsFor(env, me.id, child.familyId, day) }, 201);
  }

  if (path === "/finish" && req.method === "POST") {
    const b = await readJson(req);
    const runId = text(b.runId, "hra", 1, 64);
    const level = int(b.level, "level", 1, GAME_LEVELS);
    const won = b.won === true;
    let score = int(b.score, "skóre", 0, MAX_SCORE);
    const run = await env.DB.prepare("SELECT id, started_at FROM game_runs WHERE id = ? AND user_id = ? AND status = 'open'").bind(runId, me.id).first<{ id: string; started_at: string }>();
    if (!run) throw new HttpError(404, "Tahle hra už je uzavřená");
    const seconds = Math.max(1, (Date.now() - Date.parse(run.started_at)) / 1000);
    score = Math.min(score, Math.floor(seconds * MAX_POINTS_PER_SECOND)); // víc bodů, než jde za ten čas získat, se neuzná
    const before = await bestOf(me.id);
    await env.DB.prepare("UPDATE game_runs SET status = 'done', finished_at = ?, score = ?, level = ?, won = ? WHERE id = ? AND status = 'open'")
      .bind(new Date().toISOString(), score, level, won && level === GAME_LEVELS ? 1 : 0, run.id)
      .run();
    return json({ score, best: Math.max(before, score), isBest: score > before, scores: await scores(), plays: child ? await playsFor(env, me.id, child.familyId, day) : null });
  }

  throw new HttpError(404, "Nenalezeno");
}
