export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new HttpError(415, "Očekávám JSON");
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Neplatný JSON");
  }
}

/** Ořezaný text v rozsahu min–max znaků. */
export function text(v: unknown, label: string, min = 1, max = 100): string {
  if (typeof v !== "string") throw new HttpError(400, `Chybí pole „${label}“`);
  const s = v.trim();
  if (s.length < min || s.length > max) {
    throw new HttpError(400, `Pole „${label}“ musí mít ${min}–${max} znaků`);
  }
  return s;
}

/** Heslo se neořezává. */
export function password(v: unknown, label = "heslo"): string {
  if (typeof v !== "string" || v.length < 8 || v.length > 200) {
    throw new HttpError(400, `Pole „${label}“ musí mít 8–200 znaků`);
  }
  return v;
}

export function username(v: unknown): string {
  const s = text(v, "uživatelské jméno", 3, 32).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(s)) {
    throw new HttpError(400, "Uživatelské jméno smí obsahovat jen a–z, čísla, tečku, pomlčku a podtržítko");
  }
  return s;
}

export type FamilyRole = "parent" | "child";

export function familyRole(v: unknown): FamilyRole {
  if (v !== "parent" && v !== "child") throw new HttpError(400, "Role musí být „parent“ nebo „child“");
  return v;
}
