import { HttpError, json, readJson, text, password } from "./http";
import type { Env } from "./index";
import type { FamilyRole } from "./http";

const ITERATIONS = 100_000; // Workers povolují nejvýš 100 000
const SESSION_DAYS = 30;
const COOKIE = "hh_session";
const MAX_FAILED = 5;
const LOCK_MINUTES = 10;

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  memberships: { familyId: string; familyName: string; role: FamilyRole }[];
  sessionHash: string;
}

/* ---------- hesla ---------- */

const enc = new TextEncoder();
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pw: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Formát: pbkdf2-sha256$iterace$sůl(b64)$hash(b64). Stejný formát píše scripts/create-superadmin.mjs. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pw, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
  return timingSafeEqual(await derive(pw, fromB64(salt), Number(iter)), fromB64(hash));
}

let dummyHash: Promise<string> | undefined;

/* ---------- relace ---------- */

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const toB64Url = (b: Uint8Array) => toB64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function cookie(token: string, secure: boolean, maxAge: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = toB64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
      await sha256Hex(token),
      userId,
      expires,
    ),
  ]);
  return token;
}

export async function getUser(req: Request, env: Env): Promise<AuthUser | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const sessionHash = await sha256Hex(token);
  const u = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.is_superadmin, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
  )
    .bind(sessionHash, new Date().toISOString())
    .first<{ id: string; username: string; display_name: string; is_superadmin: number; must_change_password: number }>();
  if (!u) return null;
  const mem = await env.DB.prepare(
    `SELECT m.family_id, f.name, m.role FROM memberships m JOIN families f ON f.id = m.family_id
      WHERE m.user_id = ? ORDER BY f.name`,
  )
    .bind(u.id)
    .all<{ family_id: string; name: string; role: FamilyRole }>();
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    isSuperadmin: !!u.is_superadmin,
    mustChangePassword: !!u.must_change_password,
    memberships: mem.results.map((m) => ({ familyId: m.family_id, familyName: m.name, role: m.role })),
    sessionHash,
  };
}

export const publicUser = ({ sessionHash: _s, ...rest }: AuthUser) => rest;

export async function requireUser(req: Request, env: Env): Promise<AuthUser> {
  const user = await getUser(req, env);
  if (!user) throw new HttpError(401, "Přihlas se");
  return user;
}

/* ---------- endpointy /api/auth/* ---------- */

export async function login(req: Request, env: Env, url: URL): Promise<Response> {
  const body = await readJson(req);
  const name = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const pw = typeof body.password === "string" ? body.password : "";
  const fail = () => new HttpError(401, "Špatné jméno nebo heslo");

  const u = await env.DB.prepare(
    "SELECT id, password_hash, disabled, failed_logins, locked_until FROM users WHERE username = ?",
  )
    .bind(name)
    .first<{ id: string; password_hash: string; disabled: number; failed_logins: number; locked_until: string | null }>();

  if (!u) {
    // stejná doba odpovědi jako u existujícího účtu
    dummyHash ??= hashPassword("dummy-password");
    await verifyPassword(pw, await dummyHash);
    throw fail();
  }
  if (u.locked_until && u.locked_until > new Date().toISOString()) {
    throw new HttpError(429, "Příliš mnoho pokusů. Zkus to za pár minut.");
  }
  if (u.disabled || !(await verifyPassword(pw, u.password_hash))) {
    const failed = u.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    await env.DB.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?")
      .bind(lock ? 0 : failed, lock, u.id)
      .run();
    throw fail();
  }

  await env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").bind(u.id).run();
  const token = await createSession(env, u.id);
  const user = await getUser(new Request(url, { headers: { cookie: `${COOKIE}=${token}` } }), env);
  return json({ user: publicUser(user!) }, 200, {
    "set-cookie": cookie(token, url.protocol === "https:", SESSION_DAYS * 86_400),
  });
}

export async function logout(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await getUser(req, env);
  if (user) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.sessionHash).run();
  return json({ ok: true }, 200, { "set-cookie": cookie("", url.protocol === "https:", 0) });
}

export async function changePassword(req: Request, env: Env): Promise<Response> {
  const user = await requireUser(req, env);
  const body = await readJson(req);
  const current = text(body.current, "současné heslo", 1, 200);
  const next = password(body.next, "nové heslo");
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    throw new HttpError(403, "Současné heslo nesedí");
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").bind(
      await hashPassword(next),
      user.id,
    ),
    // ostatní přihlášení (jiná zařízení) se ukončí
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, user.sessionHash),
  ]);
  return json({ ok: true });
}
