# Household Hero

Rodinná aplikace na domácí práce s gamifikací. Děti za úkoly získávají minuty herního času a XP pro svého hrdinu.

- **Web:** https://hh.oliv.cz
- **Hosting:** Cloudflare Workers (statické soubory + API), databáze D1
- **Pravidla hry:** [docs/pravidla.md](docs/pravidla.md)

## Uživatelé a role

| Role | Co smí |
|---|---|
| **Superadmin** | zakládá uživatele a rodiny, připojuje uživatele do rodin, resetuje hesla, zakazuje účty |
| **Rodič** | (v rodině) schvaluje mise, uděluje trhliny štítu, vidí členy rodiny |
| **Dítě** | plní mise a bonusy, spravuje svého hrdinu |

Superadmin je příznak na účtu, ne role v rodině – jeden člověk tedy může být superadmin i rodič. Dítě patří nejvýš do jedné rodiny.

Účty se nezakládají samy. Superadmin vytvoří uživatele s dočasným heslem, které si uživatel při prvním přihlášení změní. Hesla se ukládají jako PBKDF2-SHA256, přihlášení je přes cookie (`HttpOnly`, `SameSite=Lax`), po 5 chybných pokusech se účet na 10 minut zamkne.

## Vývoj

```bash
npm install
npm run db:migrate                    # lokální databáze
HH_PASSWORD='dev-heslo-123' npm run create-superadmin -- admin "Admin"   # lokální superadmin
npm run dev                           # http://localhost:8787
echo ALLOW_TEST_DAY=1 > .dev.vars     # jen lokálně: testy smí přepsat den hlavičkou x-test-day
npm run test:smoke                    # v druhém terminálu, když běží dev server
npm run test:game                     # herní smyčka: mise, bonusy, trhliny, přenos minut
npm run test:train                    # trénink počítání, rok narození, historie a CSV
npm run test:core                     # jádro hry (bludiště, duchové, bodování)
npm run test:arcade                   # spuštění hry, nastavení odměn, Den regenerace
npm run test:pages                    # syntaxe skriptů ve stránkách (spouštět před každým nasazením)
```

## Nasazení (jednorázově)

```bash
npx wrangler login
npx wrangler d1 create hh             # vypíše database_id -> vlož do wrangler.jsonc
npm run db:migrate:remote
npm run deploy
npm run create-superadmin -- <jmeno> "<Jméno>" --remote   # zeptá se na heslo v terminálu
# bez wrangleru: přepínač --sql vypíše SQL, které vložíte do D1 Console v dashboardu
```

## Struktura

- `public/` – frontend (`index.html` přihlášení, `admin.html`, `parent.html`, `child.html`, `password.html`, sdílené `hero.js`, `app.js`, `app.css`)
- `src/` – Worker: `index.ts` (routování, ochrana stránek), `auth.ts` (hesla, relace), `admin.ts` (správa uživatelů a rodin), `game.ts` (pravidla a výpočet minut), `child.ts` (API dítěte), `family.ts` (API rodiče)
- `migrations/` – schéma databáze D1
- `scripts/` – zakládání superadmina, smoke test
- `wrangler.jsonc` – konfigurace Cloudflare
