# Household Hero

Rodinná aplikace na domácí práce s gamifikací. Děti za úkoly získávají minuty herního času a XP pro svého hrdinu.

- **Web:** https://hh.oliv.cz
- **Hosting:** Cloudflare Workers (statické soubory + API), databáze D1
- **Pravidla:** [docs/pravidla.md](docs/pravidla.md)

## Vývoj

```bash
npm install
npm run dev        # lokálně na http://localhost:8787
npm run deploy     # nasazení na Cloudflare (vyžaduje wrangler login)
```

## Struktura

- `public/` – frontend
- `src/index.ts` – Worker (API pod `/api/*`)
- `wrangler.jsonc` – konfigurace Cloudflare
