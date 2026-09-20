import { HttpError, json, readJson, text, password, username, familyRole } from "./http";
import { hashPassword, type AuthUser } from "./auth";
import type { Env } from "./index";

const isConstraint = (e: unknown) => e instanceof Error && /UNIQUE|constraint/i.test(e.message);

/** Vše pod /api/admin/* smí jen superadmin. */
export async function admin(req: Request, env: Env, url: URL, me: AuthUser): Promise<Response> {
  if (!me.isSuperadmin) throw new HttpError(403, "Jen pro superadmina");
  const path = url.pathname.replace(/^\/api\/admin/, "");
  const method = req.method;
  let m: RegExpMatchArray | null;

  if (path === "/overview" && method === "GET") return overview(env);

  if (path === "/families" && method === "POST") {
    const name = text((await readJson(req)).name, "název rodiny", 2, 60);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO families (id, name) VALUES (?, ?)").bind(id, name).run();
    return json({ id, name }, 201);
  }

  if ((m = path.match(/^\/families\/([\w-]+)$/)) && method === "DELETE") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE family_id = ?")
      .bind(m[1])
      .first<{ n: number }>();
    if (count && count.n > 0) throw new HttpError(409, "Rodina má členy. Nejdřív je odpoj.");
    await env.DB.prepare("DELETE FROM families WHERE id = ?").bind(m[1]).run();
    return json({ ok: true });
  }

  if ((m = path.match(/^\/families\/([\w-]+)\/members$/)) && method === "POST") {
    const body = await readJson(req);
    const userId = text(body.userId, "uživatel", 1, 64);
    return addMember(env, m[1], userId, familyRole(body.role));
  }

  if ((m = path.match(/^\/families\/([\w-]+)\/members\/([\w-]+)$/)) && method === "DELETE") {
    await env.DB.prepare("DELETE FROM memberships WHERE family_id = ? AND user_id = ?").bind(m[1], m[2]).run();
    return json({ ok: true });
  }

  if (path === "/users" && method === "POST") {
    const body = await readJson(req);
    const name = username(body.username);
    const displayName = text(body.displayName, "jméno", 1, 60);
    const pw = password(body.password);
    const isSuperadmin = body.isSuperadmin === true;
    const id = crypto.randomUUID();
    const stmts = [
      env.DB.prepare(
        "INSERT INTO users (id, username, display_name, password_hash, is_superadmin, must_change_password) VALUES (?, ?, ?, ?, ?, 1)",
      ).bind(id, name, displayName, await hashPassword(pw), isSuperadmin ? 1 : 0),
    ];
    if (body.familyId) {
      const familyId = text(body.familyId, "rodina", 1, 64);
      const exists = await env.DB.prepare("SELECT 1 AS x FROM families WHERE id = ?").bind(familyId).first();
      if (!exists) throw new HttpError(404, "Rodina neexistuje");
      stmts.push(
        env.DB.prepare("INSERT INTO memberships (family_id, user_id, role) VALUES (?, ?, ?)").bind(
          familyId,
          id,
          familyRole(body.role),
        ),
      );
    }
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      if (isConstraint(e)) throw new HttpError(409, "Uživatelské jméno už existuje");
      throw e;
    }
    return json({ id, username: name, displayName }, 201);
  }

  if ((m = path.match(/^\/users\/([\w-]+)$/)) && method === "PATCH") {
    const id = m[1];
    const body = await readJson(req);
    const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
    if (!target) throw new HttpError(404, "Uživatel neexistuje");
    const stmts = [];
    if (body.displayName !== undefined) {
      stmts.push(
        env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(text(body.displayName, "jméno", 1, 60), id),
      );
    }
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== "boolean") throw new HttpError(400, "Pole „disabled“ musí být true/false");
      if (id === me.id && body.disabled) throw new HttpError(400, "Sám sebe zakázat nemůžeš");
      stmts.push(
        env.DB.prepare("UPDATE users SET disabled = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").bind(
          body.disabled ? 1 : 0,
          id,
        ),
      );
      if (body.disabled) stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
    }
    if (body.password !== undefined) {
      stmts.push(
        env.DB.prepare(
          "UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?",
        ).bind(await hashPassword(password(body.password)), id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      );
    }
    if (!stmts.length) throw new HttpError(400, "Nic ke změně");
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  throw new HttpError(404, "Nenalezeno");
}

async function addMember(env: Env, familyId: string, userId: string, role: "parent" | "child"): Promise<Response> {
  const [fam, usr] = await Promise.all([
    env.DB.prepare("SELECT 1 AS x FROM families WHERE id = ?").bind(familyId).first(),
    env.DB.prepare("SELECT 1 AS x FROM users WHERE id = ?").bind(userId).first(),
  ]);
  if (!fam) throw new HttpError(404, "Rodina neexistuje");
  if (!usr) throw new HttpError(404, "Uživatel neexistuje");
  try {
    await env.DB.prepare(
      `INSERT INTO memberships (family_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (family_id, user_id) DO UPDATE SET role = excluded.role`,
    )
      .bind(familyId, userId, role)
      .run();
  } catch (e) {
    if (isConstraint(e)) throw new HttpError(409, "Dítě už patří do jiné rodiny");
    throw e;
  }
  return json({ ok: true }, 201);
}

async function overview(env: Env): Promise<Response> {
  const [families, users, members] = await Promise.all([
    env.DB.prepare("SELECT id, name FROM families ORDER BY name").all<{ id: string; name: string }>(),
    env.DB.prepare(
      "SELECT id, username, display_name, is_superadmin, disabled, must_change_password FROM users ORDER BY display_name",
    ).all<{
      id: string;
      username: string;
      display_name: string;
      is_superadmin: number;
      disabled: number;
      must_change_password: number;
    }>(),
    env.DB.prepare("SELECT family_id, user_id, role FROM memberships").all<{
      family_id: string;
      user_id: string;
      role: "parent" | "child";
    }>(),
  ]);
  const byUser = new Map(users.results.map((u) => [u.id, u]));
  return json({
    families: families.results.map((f) => ({
      id: f.id,
      name: f.name,
      members: members.results
        .filter((x) => x.family_id === f.id)
        .map((x) => ({
          userId: x.user_id,
          role: x.role,
          displayName: byUser.get(x.user_id)?.display_name ?? "?",
          username: byUser.get(x.user_id)?.username ?? "?",
        })),
    })),
    users: users.results.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      isSuperadmin: !!u.is_superadmin,
      disabled: !!u.disabled,
      mustChangePassword: !!u.must_change_password,
      families: members.results
        .filter((x) => x.user_id === u.id)
        .map((x) => ({ familyId: x.family_id, role: x.role })),
    })),
  });
}
