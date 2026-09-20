import { HttpError, json } from "./http";
import { getUser, requireUser, publicUser, login, logout, changePassword, type AuthUser } from "./auth";
import { admin } from "./admin";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

type View = "admin" | "parent" | "child";

const PAGES: Record<string, View> = {
  "/admin": "admin",
  "/admin.html": "admin",
  "/parent": "parent",
  "/parent.html": "parent",
  "/child": "child",
  "/child.html": "child",
};

const canSee = (u: AuthUser, view: View) =>
  view === "admin" ? u.isSuperadmin : u.memberships.some((m) => m.role === view);

const homeFor = (u: AuthUser) =>
  u.isSuperadmin ? "/admin" : u.memberships.some((m) => m.role === "parent") ? "/parent" : u.memberships.length ? "/child" : "/";

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);

      const view = PAGES[url.pathname];
      if (view) {
        const user = await getUser(request, env);
        if (!user) return redirect("/");
        if (user.mustChangePassword) return redirect("/password");
        if (!canSee(user, view)) return redirect(homeFor(user));
        const res = await env.ASSETS.fetch(request);
        const out = new Response(res.body, res);
        out.headers.set("cache-control", "no-store");
        out.headers.set("x-frame-options", "DENY");
        return out;
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Chyba serveru" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const { pathname: path } = url;

  if (path === "/api/health") return json({ ok: true, app: "Household Hero" });

  // Ochrana proti CSRF: změny jen ze stejného originu
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "Zakázaný původ požadavku");
  }

  if (path === "/api/auth/login" && req.method === "POST") return login(req, env, url);
  if (path === "/api/auth/logout" && req.method === "POST") return logout(req, env, url);
  if (path === "/api/auth/password" && req.method === "POST") return changePassword(req, env);

  if (path === "/api/auth/me" && req.method === "GET") {
    return json({ user: publicUser(await requireUser(req, env)) });
  }

  if (path.startsWith("/api/admin/")) {
    const me = await requireUser(req, env);
    if (me.mustChangePassword) throw new HttpError(403, "Nejdřív si změň heslo");
    return admin(req, env, url, me);
  }

  const fam = path.match(/^\/api\/family\/([\w-]+)$/);
  if (fam && req.method === "GET") {
    const me = await requireUser(req, env);
    if (me.mustChangePassword) throw new HttpError(403, "Nejdřív si změň heslo");
    if (!me.isSuperadmin && !me.memberships.some((m) => m.familyId === fam[1])) {
      throw new HttpError(403, "Do této rodiny nepatříš");
    }
    const family = await env.DB.prepare("SELECT id, name FROM families WHERE id = ?").bind(fam[1]).first();
    if (!family) throw new HttpError(404, "Rodina neexistuje");
    const members = await env.DB.prepare(
      `SELECT u.id, u.display_name AS displayName, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.family_id = ? AND u.disabled = 0 ORDER BY m.role, u.display_name`,
    )
      .bind(fam[1])
      .all();
    return json({ family, members: members.results });
  }

  throw new HttpError(404, "Nenalezeno");
}
