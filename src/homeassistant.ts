import { HttpError, text } from "./http";
import type { Env } from "./index";
import { childState, pragueDay } from "./game";

/** Napojení na domácí Home Assistant. Household Hero je zdroj pravdy (minuty na dnešek, Den regenerace);
 *  Home Assistant/Family Link jen dostává příkaz „nastav dnes bonusový čas na X minut“. Nic se nesčítá
 *  na obou stranách zvlášť — proto se posílá „set“, ne „přidej“, a nevadí poslat totéž vícekrát. */

export interface HaSettings { webhookUrl: string; token: string; enabled: boolean }
export interface HaChild { childId: string; displayName: string; haChildId: string }
export interface HaSyncResult { ok: boolean; status?: number; message?: string; minutes: number; locked: boolean }

const TIMEOUT_MS = 8000;
const KEEP_LOGS = 20;

export async function getHaSettings(env: Env, familyId: string): Promise<HaSettings> {
  const r = await env.DB.prepare("SELECT webhook_url AS webhookUrl, token, enabled FROM ha_settings WHERE family_id = ?")
    .bind(familyId)
    .first<{ webhookUrl: string; token: string; enabled: number }>();
  return r ? { webhookUrl: r.webhookUrl, token: r.token, enabled: !!r.enabled } : { webhookUrl: "", token: "", enabled: false };
}

export async function saveHaSettings(env: Env, familyId: string, body: Record<string, unknown>): Promise<HaSettings> {
  const cur = await getHaSettings(env, familyId);
  const webhookUrl = body.webhookUrl === undefined ? cur.webhookUrl : text(body.webhookUrl, "webhook URL", 0, 500);
  // https:// mimo lokální testy (ALLOW_TEST_DAY), kde smoke test mluví s http://127.0.0.1 falešným webhookem
  const httpOk = env.ALLOW_TEST_DAY === "1" && /^http:\/\/127\.0\.0\.1[:/]/.test(webhookUrl);
  if (webhookUrl && !httpOk && !/^https:\/\//.test(webhookUrl)) throw new HttpError(400, "Webhook musí začínat https://");
  const token = body.token === undefined ? cur.token : text(body.token, "token", 0, 200);
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new HttpError(400, "Pole „enabled“ musí být true/false");
  const enabled = body.enabled === undefined ? cur.enabled : (body.enabled as boolean);
  if (enabled && !webhookUrl) throw new HttpError(400, "Bez webhooku nejde zapnutí uložit");
  await env.DB.prepare(
    `INSERT INTO ha_settings (family_id, webhook_url, token, enabled) VALUES (?, ?, ?, ?)
     ON CONFLICT (family_id) DO UPDATE SET webhook_url = excluded.webhook_url, token = excluded.token, enabled = excluded.enabled`,
  )
    .bind(familyId, webhookUrl, token, enabled ? 1 : 0)
    .run();
  return { webhookUrl, token, enabled };
}

export async function setChildMap(env: Env, childId: string, haChildId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ha_child_map (child_id, ha_child_id) VALUES (?, ?)
     ON CONFLICT (child_id) DO UPDATE SET ha_child_id = excluded.ha_child_id`,
  )
    .bind(childId, haChildId)
    .run();
}

interface LastSync { ok: boolean; minutes: number; locked: boolean; message: string | null; at: string }

export async function haOverview(env: Env, familyId: string, childIds: string[]): Promise<{ settings: HaSettings; children: Record<string, { haChildId: string; last: LastSync | null }> }> {
  const settings = await getHaSettings(env, familyId);
  const children: Record<string, { haChildId: string; last: LastSync | null }> = {};
  for (const id of childIds) {
    const map = await env.DB.prepare("SELECT ha_child_id AS h FROM ha_child_map WHERE child_id = ?").bind(id).first<{ h: string }>();
    const last = await env.DB.prepare(
      "SELECT ok, minutes, locked, message, created_at AS at FROM ha_sync_log WHERE child_id = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(id)
      .first<{ ok: number; minutes: number; locked: number; message: string | null; at: string }>();
    children[id] = { haChildId: map?.h ?? "", last: last ? { ok: !!last.ok, minutes: last.minutes, locked: !!last.locked, message: last.message, at: last.at } : null };
  }
  return { settings, children };
}

async function logSync(env: Env, childId: string, day: string, minutes: number, locked: boolean, ok: boolean, status: number | undefined, message: string | undefined): Promise<void> {
  await env.DB.prepare("INSERT INTO ha_sync_log (id, child_id, day, minutes, locked, ok, status, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), childId, day, minutes, locked ? 1 : 0, ok ? 1 : 0, status ?? null, message ?? null)
    .run();
  await env.DB.prepare(
    `DELETE FROM ha_sync_log WHERE child_id = ? AND id NOT IN (SELECT id FROM ha_sync_log WHERE child_id = ? ORDER BY created_at DESC LIMIT ?)`,
  )
    .bind(childId, childId, KEEP_LOGS)
    .run();
}

/** Pošle aktuální stav jednoho dítěte (minuty k dispozici dnes, Den regenerace) na jeho Home Assistant webhook. */
export async function syncChild(env: Env, familyId: string, childId: string, day: string): Promise<HaSyncResult> {
  const settings = await getHaSettings(env, familyId);
  const map = await env.DB.prepare("SELECT ha_child_id AS h FROM ha_child_map WHERE child_id = ?").bind(childId).first<{ h: string }>();
  const haChildId = map?.h ?? "";
  const st = await childState(env, childId, familyId, day);
  const minutes = st.usable, locked = st.regen;

  if (!settings.enabled || !settings.webhookUrl) {
    const r = { ok: false, minutes, locked, message: "Home Assistant není zapnutý" };
    await logSync(env, childId, day, minutes, locked, false, undefined, r.message);
    return r;
  }
  if (!haChildId) {
    const r = { ok: false, minutes, locked, message: "Dítě není napojené na Home Assistant (chybí ID)" };
    await logSync(env, childId, day, minutes, locked, false, undefined, r.message);
    return r;
  }

  let ok = false, status: number | undefined, message: string | undefined;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(settings.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {}) },
        body: JSON.stringify({ source: "household-hero", childId: haChildId, day, minutes, locked }),
        signal: ctrl.signal,
      });
      status = res.status;
      ok = res.ok;
      if (!ok) message = (await res.text()).slice(0, 300) || `HTTP ${res.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    message = e instanceof Error ? (e.name === "AbortError" ? "Vypršel čas (8 s), Home Assistant neodpověděl" : e.message) : String(e);
  }
  await logSync(env, childId, day, minutes, locked, ok, status, message);
  return { ok, status, minutes, locked, message };
}

/** Noční synchronizace: všechny rodiny se zapnutým HA, jejich dnešní (nový) stav. Chyba jedné rodiny nezastaví ostatní. */
export async function syncAll(env: Env): Promise<void> {
  const day = pragueDay();
  const fams = await env.DB.prepare("SELECT family_id AS id FROM ha_settings WHERE enabled = 1").all<{ id: string }>();
  for (const f of fams.results) {
    try {
      const kids = await env.DB.prepare(
        "SELECT m.user_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? AND m.role = 'child' AND u.disabled = 0",
      )
        .bind(f.id)
        .all<{ id: string }>();
      for (const k of kids.results) await syncChild(env, f.id, k.id, day);
    } catch (e) {
      console.error("syncAll", f.id, e);
    }
  }
}
