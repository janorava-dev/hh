import { HttpError, json, readJson, text } from "./http";
import type { AuthUser } from "./auth";
import type { Env } from "./index";
import {
  childState,
  today,
  isDay,
  XPT,
  MAX_STRIKES,
  MISSION_MINUTES,
  MISSION_XP,
  MISSION_ITEMS,
} from "./game";
import { gradeOf, TRAIN_MINUTES_CAP } from "./train";
import { addDays } from "./game";
import { history, clampDays, touchStats, type DayStat } from "./stats";
import { getSettings, grantCredit, saveSettings, playsFor } from "./arcade";

const csvCell = (v: string | number | boolean) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const int =(v: unknown, label: string, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new HttpError(400, `Pole „${label}“ musí být celé číslo ${min}–${max}`);
  }
  return v;
};

/** /api/family/:id/* – členové rodiny; hra (schvalování, trhliny, úkoly) jen pro rodiče. */
export async function family(req: Request, env: Env, url: URL, me: AuthUser): Promise<Response> {
  const m = url.pathname.match(/^\/api\/family\/([\w-]+)(\/.*)?$/);
  if (!m) throw new HttpError(404, "Nenalezeno");
  const familyId = m[1];
  const path = m[2] ?? "";
  const role = me.memberships.find((x) => x.familyId === familyId)?.role;
  if (!role && !me.isSuperadmin) throw new HttpError(403, "Do této rodiny nepatříš");
  const fam = await env.DB.prepare("SELECT id, name FROM families WHERE id = ?").bind(familyId).first<{ id: string; name: string }>();
  if (!fam) throw new HttpError(404, "Rodina neexistuje");

  if (path === "" && req.method === "GET") {
    const members = await env.DB.prepare(
      `SELECT u.id, u.display_name AS displayName, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.family_id = ? AND u.disabled = 0 ORDER BY m.role, u.display_name`,
    )
      .bind(familyId)
      .all();
    return json({ family: fam, members: members.results });
  }

  // vše ostatní smí jen rodič této rodiny
  if (role !== "parent") throw new HttpError(403, "Jen pro rodiče této rodiny");
  const day = today(req, env);
  let r: RegExpMatchArray | null;

  const childInFamily = async (childId: string) => {
    const c = await env.DB.prepare(
      "SELECT u.id, u.display_name AS name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? AND m.user_id = ? AND m.role = 'child'",
    )
      .bind(familyId, childId)
      .first<{ id: string; name: string }>();
    if (!c) throw new HttpError(404, "Dítě v rodině neexistuje");
    return c;
  };

  if (path === "/game" && req.method === "GET") {
    const kids = await env.DB.prepare(
      "SELECT u.id, u.display_name AS name, u.birth_year AS birthYear FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? AND m.role = 'child' AND u.disabled = 0 ORDER BY u.display_name",
    )
      .bind(familyId)
      .all<{ id: string; name: string; birthYear: number | null }>();
    const children = await Promise.all(
      kids.results.map(async (k) => {
        const t = await env.DB.prepare(
          "SELECT COUNT(*) AS n, COALESCE(SUM(minutes_awarded), 0) AS m, COALESCE(SUM(correct), 0) AS c, COALESCE(SUM(total), 0) AS t FROM train_sessions WHERE child_id = ? AND day = ? AND status = 'done'",
        )
          .bind(k.id, day)
          .first<{ n: number; m: number; c: number; t: number }>();
        return {
          id: k.id,
          displayName: k.name,
          birthYear: k.birthYear,
          grade: k.birthYear === null ? null : gradeOf(k.birthYear, day),
          training: { sessionsToday: t?.n ?? 0, minutesToday: t?.m ?? 0, correctToday: t?.c ?? 0, totalToday: t?.t ?? 0 },
          state: await childState(env, k.id, familyId, day),
          plays: await playsFor(env, k.id, familyId, day),
        };
      }),
    );
    const missions = await env.DB.prepare(
      `SELECT d.child_id AS childId, u.display_name AS childName, d.day, d.items FROM mission_days d
         JOIN memberships m ON m.user_id = d.child_id AND m.family_id = ? AND m.role = 'child'
         JOIN users u ON u.id = d.child_id WHERE d.status = 'pending' ORDER BY d.day, u.display_name`,
    )
      .bind(familyId)
      .all<{ childId: string; childName: string; day: string; items: string }>();
    const claims = await env.DB.prepare(
      `SELECT c.id, c.child_id AS childId, u.display_name AS childName, c.day, c.label, c.minutes, c.xp FROM bonus_claims c
         JOIN memberships m ON m.user_id = c.child_id AND m.family_id = ? AND m.role = 'child'
         JOIN users u ON u.id = c.child_id WHERE c.status = 'pending' ORDER BY c.created_at`,
    )
      .bind(familyId)
      .all();
    const chores = await env.DB.prepare(
      "SELECT id, label, minutes, xp, game_plays AS gamePlays, active FROM chores WHERE family_id = ? ORDER BY active DESC, created_at, label",
    )
      .bind(familyId)
      .all<{ id: string; label: string; minutes: number; xp: number; gamePlays: number; active: number }>();
    return json({
      family: fam,
      day,
      children,
      queue: {
        missions: missions.results.map((x) => ({ ...x, items: JSON.parse(x.items) })),
        claims: claims.results,
      },
      chores: chores.results.map((c) => ({ ...c, active: !!c.active })),
      gameSettings: await getSettings(env, familyId),
      limits: { maxStrikes: MAX_STRIKES, missionMinutes: MISSION_MINUTES, missionXp: MISSION_XP, levels: XPT, trainCap: TRAIN_MINUTES_CAP },
    });
  }

  /* --- hra: nastavení odměn a ruční přidání spuštění --- */
  if (path === "/game-settings" && req.method === "PATCH") {
    return json({ ok: true, settings: await saveSettings(env, familyId, await readJson(req)) });
  }
  if ((r = path.match(/^\/children\/([\w-]+)\/game-credit$/)) && req.method === "POST") {
    await childInFamily(r[1]);
    const plays = int((await readJson(req)).plays, "počet spuštění", 1, 10);
    await grantCredit(env, r[1], plays, addDays(day, -1), "manual", crypto.randomUUID()); // platí hned dnes
    return json({ ok: true, plays: await playsFor(env, r[1], familyId, day) }, 201);
  }

  /* --- rok narození dítěte (z něj se odvozuje ročník a obtížnost příkladů) --- */
  if ((r = path.match(/^\/children\/([\w-]+)$/)) && req.method === "PATCH") {
    await childInFamily(r[1]);
    const b = await readJson(req);
    const year = new Date(`${day}T12:00:00Z`).getUTCFullYear();
    const birthYear = b.birthYear === null ? null : int(b.birthYear, "rok narození", 2000, year - 4);
    await env.DB.prepare("UPDATE users SET birth_year = ? WHERE id = ?").bind(birthYear, r[1]).run();
    return json({ ok: true, birthYear, grade: birthYear === null ? null : gradeOf(birthYear, day) });
  }

  /* --- historie: denní souhrny dětí, na požádání jako CSV --- */
  if (path === "/history" && req.method === "GET") {
    const days = clampDays(url.searchParams.get("days"), 30, 365);
    const kids = await env.DB.prepare(
      "SELECT u.id, u.display_name AS name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? AND m.role = 'child' AND u.disabled = 0 ORDER BY u.display_name",
    )
      .bind(familyId)
      .all<{ id: string; name: string }>();
    const children = await Promise.all(kids.results.map(async (k) => ({ id: k.id, displayName: k.name, days: await history(env, k.id, day, days) })));
    if (url.searchParams.get("format") === "csv") {
      const head = ["Dítě", "Den", "XP získané", "Minuty získané (platí od dalšího dne)", "Minuty k dispozici", "Z toho přenesené", "Minuty zamčené (přesunuté)", "Den regenerace", "Trhliny štítu", "Mise", "Úkolů mise hotovo", "Bonusy schválené", "Sady příkladů", "Správně", "Odpovědí", "XP celkem", "Level"];
      const rows = children.flatMap((c) =>
        c.days.map((d: DayStat) => [c.displayName, d.day, d.xpEarned, d.minutesEarned, d.minutesUsable, d.minutesCarry, d.minutesLocked, d.regen ? "ano" : "ne", d.strikes, d.missionStatus, d.missionDone, d.bonusDone, d.trainSessions, d.trainCorrect, d.trainTotal, d.xpTotal, d.level]),
      );
      const csv = "﻿" + [head, ...rows].map((r2) => r2.map(csvCell).join(";")).join("\r\n") + "\r\n";
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="household-hero-historie-${day}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return json({ family: fam, day, children });
  }

  /* --- mise: schválit / vrátit --- */
  if ((r = path.match(/^\/missions\/([\w-]+)\/(\d{4}-\d{2}-\d{2})\/(approve|return)$/)) && req.method === "POST") {
    const [, childId, mDay, action] = r;
    await childInFamily(childId);
    if (!isDay(mDay) || mDay > day) throw new HttpError(400, "Neplatný den");
    const now = new Date().toISOString();
    if (action === "approve") {
      const upd = await env.DB.prepare(
        "UPDATE mission_days SET status = 'approved', decided_by = ?, decided_at = ? WHERE child_id = ? AND day = ? AND status = 'pending'",
      )
        .bind(me.id, now, childId, mDay)
        .run();
      if (!upd.meta.changes) throw new HttpError(409, "Mise už není ke schválení");
      const ref = `${childId}:${mDay}`;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO ledger (id, child_id, kind, amount, earned_day, source, ref) VALUES (?, ?, 'minutes', ?, ?, 'mission', ?)",
        ).bind(crypto.randomUUID(), childId, MISSION_MINUTES, mDay, ref),
        env.DB.prepare(
          "INSERT OR IGNORE INTO ledger (id, child_id, kind, amount, earned_day, source, ref) VALUES (?, ?, 'xp', ?, ?, 'mission', ?)",
        ).bind(crypto.randomUUID(), childId, MISSION_XP, mDay, ref),
      ]);
      await grantCredit(env, childId, (await getSettings(env, familyId)).missionPlays, mDay, "mission", ref);
      await touchStats(env, childId, mDay, day);
      return json({ ok: true });
    }
    // vrátit: rodič označí, které úkoly nejsou hotové
    const body = await readJson(req);
    const un = body.uncheck;
    if (!Array.isArray(un) || !un.length || !un.every((i) => Number.isInteger(i) && i >= 0 && i < MISSION_ITEMS)) {
      throw new HttpError(400, "Označ aspoň jeden nesplněný úkol");
    }
    const row = await env.DB.prepare("SELECT items FROM mission_days WHERE child_id = ? AND day = ? AND status = 'pending'")
      .bind(childId, mDay)
      .first<{ items: string }>();
    if (!row) throw new HttpError(409, "Mise už není ke schválení");
    const items = JSON.parse(row.items) as number[];
    for (const i of un as number[]) items[i] = 0;
    await env.DB.prepare("UPDATE mission_days SET items = ?, status = 'open', submitted_at = NULL WHERE child_id = ? AND day = ? AND status = 'pending'")
      .bind(JSON.stringify(items), childId, mDay)
      .run();
    await touchStats(env, childId, mDay, day);
    return json({ ok: true });
  }

  /* --- bonusy: schválit / zamítnout --- */
  if ((r = path.match(/^\/claims\/([\w-]+)\/(approve|reject)$/)) && req.method === "POST") {
    const claim = await env.DB.prepare(
      `SELECT c.id, c.child_id, c.chore_id, c.day, c.minutes, c.xp FROM bonus_claims c
         JOIN memberships m ON m.user_id = c.child_id AND m.family_id = ? AND m.role = 'child'
        WHERE c.id = ? AND c.status = 'pending'`,
    )
      .bind(familyId, r[1])
      .first<{ id: string; child_id: string; chore_id: string; day: string; minutes: number; xp: number }>();
    if (!claim) throw new HttpError(409, "Úkol už není ke schválení");
    const now = new Date().toISOString();
    const status = r[2] === "approve" ? "approved" : "rejected";
    const upd = await env.DB.prepare(
      "UPDATE bonus_claims SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(status, me.id, now, claim.id)
      .run();
    if (!upd.meta.changes) throw new HttpError(409, "Úkol už není ke schválení");
    if (status === "approved") {
      const minutes = claim.minutes; // bez denního stropu
      const stmts = [
        env.DB.prepare(
          "INSERT OR IGNORE INTO ledger (id, child_id, kind, amount, earned_day, source, ref) VALUES (?, ?, 'xp', ?, ?, 'bonus', ?)",
        ).bind(crypto.randomUUID(), claim.child_id, claim.xp, claim.day, claim.id),
      ];
      if (minutes > 0) {
        stmts.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO ledger (id, child_id, kind, amount, earned_day, source, ref) VALUES (?, ?, 'minutes', ?, ?, 'bonus', ?)",
          ).bind(crypto.randomUUID(), claim.child_id, minutes, claim.day, claim.id),
        );
      }
      await env.DB.batch(stmts);
      const gp = await env.DB.prepare("SELECT game_plays AS n FROM chores WHERE id = ?").bind(claim.chore_id).first<{ n: number }>();
      await grantCredit(env, claim.child_id, gp?.n ?? 0, claim.day, "bonus", claim.id);
      await touchStats(env, claim.child_id, claim.day, day);
      return json({ ok: true, grantedMinutes: minutes });
    }
    return json({ ok: true });
  }

  /* --- trhliny štítu --- */
  if ((r = path.match(/^\/children\/([\w-]+)\/strikes$/)) && req.method === "POST") {
    await childInFamily(r[1]);
    const reason = text((await readJson(req)).reason, "důvod", 2, 60);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM strikes WHERE child_id = ? AND day = ?")
      .bind(r[1], day)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_STRIKES) throw new HttpError(409, "Štít je už dnes rozbitý (3 trhliny)");
    await env.DB.prepare("INSERT INTO strikes (id, child_id, day, reason, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), r[1], day, reason, me.id)
      .run();
    await touchStats(env, r[1], day, day);
    return json({ ok: true, count: (count?.n ?? 0) + 1 }, 201);
  }

  if ((r = path.match(/^\/children\/([\w-]+)\/strikes\/last$/)) && req.method === "DELETE") {
    await childInFamily(r[1]);
    await env.DB.prepare(
      "DELETE FROM strikes WHERE id = (SELECT id FROM strikes WHERE child_id = ? AND day = ? ORDER BY created_at DESC, rowid DESC LIMIT 1)",
    )
      .bind(r[1], day)
      .run();
    await touchStats(env, r[1], day, day);
    return json({ ok: true });
  }

  /* --- bonusové úkoly rodiny --- */
  if (path === "/chores" && req.method === "POST") {
    const b = await readJson(req);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO chores (id, family_id, label, minutes, xp, game_plays) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, familyId, text(b.label, "název", 2, 60), int(b.minutes, "minuty", 0, 60), int(b.xp, "XP", 0, 200), b.gamePlays === undefined ? 0 : int(b.gamePlays, "spuštění hry", 0, 5))
      .run();
    return json({ id }, 201);
  }

  if ((r = path.match(/^\/chores\/([\w-]+)$/)) && req.method === "PATCH") {
    const b = await readJson(req);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (b.label !== undefined) { sets.push("label = ?"); vals.push(text(b.label, "název", 2, 60)); }
    if (b.minutes !== undefined) { sets.push("minutes = ?"); vals.push(int(b.minutes, "minuty", 0, 60)); }
    if (b.xp !== undefined) { sets.push("xp = ?"); vals.push(int(b.xp, "XP", 0, 200)); }
    if (b.gamePlays !== undefined) { sets.push("game_plays = ?"); vals.push(int(b.gamePlays, "spuštění hry", 0, 5)); }
    if (b.active !== undefined) {
      if (typeof b.active !== "boolean") throw new HttpError(400, "Pole „active“ musí být true/false");
      sets.push("active = ?"); vals.push(b.active ? 1 : 0);
    }
    if (!sets.length) throw new HttpError(400, "Nic ke změně");
    const upd = await env.DB.prepare(`UPDATE chores SET ${sets.join(", ")} WHERE id = ? AND family_id = ?`)
      .bind(...vals, r[1], familyId)
      .run();
    if (!upd.meta.changes) throw new HttpError(404, "Úkol neexistuje");
    return json({ ok: true });
  }

  throw new HttpError(404, "Nenalezeno");
}
