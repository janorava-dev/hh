import { HttpError, json, readJson, text } from "./http";
import type { AuthUser } from "./auth";
import type { Env } from "./index";
import { childState, today, MISSION_ITEMS, HEROES, SLOTS, levelOf, XPT } from "./game";

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE|constraint/i.test(e.message);

/** Endpointy dítěte: /api/me/* */
export async function child(req: Request, env: Env, url: URL, me: AuthUser): Promise<Response> {
  const membership = me.memberships.find((m) => m.role === "child");
  if (!membership) throw new HttpError(403, "Jen pro děti");
  const day = today(req, env);
  const path = url.pathname.replace(/^\/api\/me/, "");
  const state = async () => json({ state: await childState(env, me.id, membership.familyId, day) });

  if (path === "/game" && req.method === "GET") {
    const st = await childState(env, me.id, membership.familyId, day);
    const siblings = await env.DB.prepare(
      `SELECT u.id, u.display_name AS displayName, h.hero, h.name, h.equipment,
              COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.child_id = u.id AND l.kind = 'xp'), 0) AS xp
         FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN heroes h ON h.child_id = u.id
        WHERE m.family_id = ? AND m.role = 'child' AND u.disabled = 0 AND u.id != ? ORDER BY u.display_name`,
    )
      .bind(membership.familyId, me.id)
      .all<{ id: string; displayName: string; hero: string | null; name: string | null; equipment: string | null; xp: number }>();
    return json({
      state: st,
      levels: XPT,
      displayName: me.displayName,
      familyName: membership.familyName,
      siblings: siblings.results.map((s) => ({
        displayName: s.displayName,
        hero: s.hero ?? "knight",
        name: s.name,
        equipment: s.equipment ? JSON.parse(s.equipment) : {},
        xp: s.xp,
      })),
    });
  }

  if (path === "/mission" && req.method === "POST") {
    const body = await readJson(req);
    const i = body.index;
    if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= MISSION_ITEMS || typeof body.checked !== "boolean") {
      throw new HttpError(400, "Neplatný úkol");
    }
    await env.DB.prepare("INSERT OR IGNORE INTO mission_days (child_id, day) VALUES (?, ?)").bind(me.id, day).run();
    const row = await env.DB.prepare("SELECT items, status FROM mission_days WHERE child_id = ? AND day = ?")
      .bind(me.id, day)
      .first<{ items: string; status: string }>();
    if (!row || row.status !== "open") throw new HttpError(409, "Mise je už odeslaná rodiči");
    const items = JSON.parse(row.items) as number[];
    items[i as number] = body.checked ? 1 : 0;
    const complete = items.every((x) => x === 1);
    const res = await env.DB.prepare(
      "UPDATE mission_days SET items = ?, status = ?, submitted_at = ? WHERE child_id = ? AND day = ? AND status = 'open'",
    )
      .bind(JSON.stringify(items), complete ? "pending" : "open", complete ? new Date().toISOString() : null, me.id, day)
      .run();
    if (!res.meta.changes) throw new HttpError(409, "Mise je už odeslaná rodiči");
    return state();
  }

  if (path === "/bonus" && req.method === "POST") {
    const choreId = text((await readJson(req)).choreId, "úkol", 1, 64);
    const chore = await env.DB.prepare("SELECT id, label, minutes, xp FROM chores WHERE id = ? AND family_id = ? AND active = 1")
      .bind(choreId, membership.familyId)
      .first<{ id: string; label: string; minutes: number; xp: number }>();
    if (!chore) throw new HttpError(404, "Úkol neexistuje");
    try {
      await env.DB.prepare(
        "INSERT INTO bonus_claims (id, child_id, chore_id, day, label, minutes, xp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), me.id, chore.id, day, chore.label, chore.minutes, chore.xp)
        .run();
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, "Tenhle úkol jsi dnes už odeslal(a)");
      throw e;
    }
    return state();
  }

  if (path === "/hero" && req.method === "PUT") {
    const body = await readJson(req);
    const hero = typeof body.hero === "string" && HEROES.includes(body.hero) ? body.hero : null;
    if (!hero) throw new HttpError(400, "Neznámý hrdina");
    const name = body.name === null || body.name === "" ? null : text(body.name, "jméno hrdiny", 1, 14);
    const eq = body.equipment;
    if (!eq || typeof eq !== "object" || Array.isArray(eq)) throw new HttpError(400, "Neplatná výbava");
    const xp = (await childState(env, me.id, membership.familyId, day)).xp;
    const level = levelOf(xp);
    const clean: Record<string, string> = {};
    for (const [slot, val] of Object.entries(eq as Record<string, unknown>)) {
      const def = SLOTS[slot];
      if (!def || typeof val !== "string" || !def.opts.includes(val)) throw new HttpError(400, "Neplatná výbava");
      if (level < def.lvl) throw new HttpError(403, `Tuhle výbavu odemkneš na levelu ${def.lvl}`);
      clean[slot] = val;
    }
    await env.DB.prepare(
      `INSERT INTO heroes (child_id, hero, name, equipment) VALUES (?, ?, ?, ?)
       ON CONFLICT (child_id) DO UPDATE SET hero = excluded.hero, name = excluded.name, equipment = excluded.equipment`,
    )
      .bind(me.id, hero, name, JSON.stringify(clean))
      .run();
    return state();
  }

  throw new HttpError(404, "Nenalezeno");
}
