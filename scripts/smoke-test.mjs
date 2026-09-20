// Smoke test API a ochrany stránek. Vyžaduje lokální dev server (npm run dev), migrace (npm run db:migrate)
// a superadmina: HH_PASSWORD='test-heslo-123' npm run create-superadmin -- admin "Testovací Admin"
// Vytváří testovací rodiny a uživatele v LOKÁLNÍ databázi. Nespouštět proti ostrému nasazení.
const BASE = "http://localhost:8787";
let pass = 0, failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) pass++; else { failed++; console.log("FAIL:", name, extra); }
};

class Client {
  cookie = "";
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.startsWith("hh_session=;") || /Max-Age=0/.test(sc) ? "" : sc.split(";")[0];
    let data = null;
    try { data = await res.clone().json(); } catch {}
    return { status: res.status, data, res };
  }
}

const rnd = Math.random().toString(36).slice(2, 6), M = "maminka" + rnd, B = "blesk" + rnd;
const anon = new Client();
let r = await anon.req("GET", "/api/auth/me");
check("me bez přihlášení = 401", r.status === 401, r.status);

r = await anon.req("POST", "/api/auth/login", { username: "admin", password: "spatne" });
check("špatné heslo = 401", r.status === 401);
r = await anon.req("POST", "/api/auth/login", { username: "neexistuje", password: "spatne" });
check("neznámý uživatel = 401 (stejná zpráva)", r.status === 401 && r.data.error === "Špatné jméno nebo heslo");

const sa = new Client();
r = await sa.req("POST", "/api/auth/login", { username: "Admin", password: "test-heslo-123" });
check("login superadmin (jméno bez ohledu na velikost)", r.status === 200 && r.data.user.isSuperadmin, JSON.stringify(r.data));
check("cookie nastavena", sa.cookie.startsWith("hh_session="));
check("v odpovědi není sessionHash", r.data.user.sessionHash === undefined);

r = await sa.req("POST", "/api/auth/login", { username: "admin", password: "test-heslo-123" }, { origin: "https://evil.example" });
check("cizí Origin = 403", r.status === 403, r.status);

r = await sa.req("GET", "/api/admin/overview");
check("overview", r.status === 200 && Array.isArray(r.data.families));

r = await sa.req("POST", "/api/admin/families", { name: "Testovi" });
const fam1 = r.data.id;
check("vytvoření rodiny", r.status === 201 && fam1);
r = await sa.req("POST", "/api/admin/families", { name: "Druzí" });
const fam2 = r.data.id;

r = await sa.req("POST", "/api/admin/users", { username: M, displayName: "Maminka", password: "docasne-heslo1", familyId: fam1, role: "parent" });
const parentId = r.data.id;
check("vytvoření rodiče s rodinou", r.status === 201 && parentId, JSON.stringify(r.data));
r = await sa.req("POST", "/api/admin/users", { username: B, displayName: "Blesk", password: "docasne-heslo2", familyId: fam1, role: "child" });
const childId = r.data.id;
check("vytvoření dítěte s rodinou", r.status === 201 && childId);
r = await sa.req("POST", "/api/admin/users", { username: M.toUpperCase(), displayName: "Dup", password: "docasne-heslo1" });
check("duplicitní username = 409", r.status === 409, JSON.stringify(r.data));
r = await sa.req("POST", "/api/admin/users", { username: "x y", displayName: "Bad", password: "docasne-heslo1" });
check("špatné username = 400", r.status === 400);
r = await sa.req("POST", "/api/admin/users", { username: "kratke", displayName: "Bad", password: "abc" });
check("krátké heslo = 400", r.status === 400);

r = await sa.req("POST", `/api/admin/families/${fam2}/members`, { userId: childId, role: "child" });
check("dítě do druhé rodiny = 409", r.status === 409, JSON.stringify(r.data));
r = await sa.req("POST", `/api/admin/families/${fam2}/members`, { userId: childId, role: "parent" });
check("stejný uživatel jako rodič v jiné rodině = OK", r.status === 201, JSON.stringify(r.data));
r = await sa.req("DELETE", `/api/admin/families/${fam2}/members/${childId}`);
check("odpojení z rodiny", r.status === 200);
r = await sa.req("DELETE", `/api/admin/families/${fam1}`);
check("smazání rodiny s členy = 409", r.status === 409);
r = await sa.req("DELETE", `/api/admin/families/${fam2}`);
check("smazání prázdné rodiny", r.status === 200);
r = await sa.req("PATCH", `/api/admin/users/${(await sa.req("GET", "/api/auth/me")).data.user.id}`, { disabled: true });
check("superadmin nezakáže sám sebe", r.status === 400);

// dítě: musí změnit heslo
const kid = new Client();
r = await kid.req("POST", "/api/auth/login", { username: B, password: "docasne-heslo2" });
check("login dítěte", r.status === 200 && r.data.user.mustChangePassword === true && r.data.user.memberships[0].role === "child", JSON.stringify(r.data));
r = await kid.req("GET", "/api/admin/overview");
check("dítě nesmí na admin API (403)", r.status === 403);
r = await kid.req("GET", "/child");
check("stránka /child před změnou hesla -> redirect /password", r.status === 302 && r.res.headers.get("location") === "/password", r.status + " " + r.res.headers.get("location"));
r = await kid.req("POST", "/api/auth/password", { current: "vubec-spatne", next: "nove-heslo-123" });
check("změna hesla se špatným současným = 403", r.status === 403);
r = await kid.req("POST", "/api/auth/password", { current: "docasne-heslo2", next: "nove-heslo-123" });
check("změna hesla", r.status === 200);
r = await kid.req("GET", "/child");
check("/child po změně hesla = 200", r.status === 200, r.status);
r = await kid.req("GET", "/admin");
check("/admin pro dítě -> redirect /child", r.status === 302 && r.res.headers.get("location") === "/child", r.status + " " + r.res.headers.get("location"));
r = await kid.req("GET", "/parent");
check("/parent pro dítě -> redirect", r.status === 302);
r = await kid.req("GET", `/api/family/${fam1}`);
check("dítě vidí svou rodinu", r.status === 200 && r.data.members.length === 2, JSON.stringify(r.data));

// rodič
const par = new Client();
await par.req("POST", "/api/auth/login", { username: M, password: "docasne-heslo1" });
await par.req("POST", "/api/auth/password", { current: "docasne-heslo1", next: "maminka-nove-1" });
r = await par.req("GET", "/parent");
check("/parent pro rodiče = 200", r.status === 200);
r = await par.req("GET", `/api/family/${fam1}`);
check("rodič vidí rodinu", r.status === 200);
r = await par.req("GET", `/api/family/${fam2}`);
check("cizí rodina = 403/404", r.status === 403 || r.status === 404, r.status);
r = await par.req("POST", "/api/admin/families", { name: "Hack" });
check("rodič nesmí vytvářet rodiny", r.status === 403);

// anon na stránky
r = await anon.req("GET", "/admin");
check("/admin bez přihlášení -> redirect /", r.status === 302 && r.res.headers.get("location") === "/");
r = await anon.req("GET", "/");
check("/ je veřejná", r.status === 200);

// reset hesla + disable
r = await sa.req("PATCH", `/api/admin/users/${childId}`, { password: "reset-heslo-999" });
check("reset hesla", r.status === 200);
r = await kid.req("GET", "/api/auth/me");
check("po resetu je stará relace mrtvá", r.status === 401, r.status);
r = await sa.req("PATCH", `/api/admin/users/${childId}`, { disabled: true });
const kid2 = new Client();
r = await kid2.req("POST", "/api/auth/login", { username: B, password: "reset-heslo-999" });
check("zakázaný uživatel se nepřihlásí", r.status === 401);
await sa.req("PATCH", `/api/admin/users/${childId}`, { disabled: false });

// lockout
const lk = new Client();
let last;
for (let i = 0; i < 5; i++) last = await lk.req("POST", "/api/auth/login", { username: M, password: "spatne" + i });
r = await lk.req("POST", "/api/auth/login", { username: M, password: "maminka-nove-1" });
check("po 5 chybách je účet zamčený (429)", r.status === 429, r.status);

// logout
r = await sa.req("POST", "/api/auth/logout");
r = await sa.req("GET", "/api/auth/me");
check("po odhlášení 401", r.status === 401);

console.log(`\n${pass} OK, ${failed} selhalo`);
process.exit(failed ? 1 : 0);
