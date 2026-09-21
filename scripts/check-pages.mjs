// Zkontroluje syntaxi inline skriptů ve všech stránkách a souborů public/*.js.
// Chytá překlepy v uvozovkách ještě před nasazením (jedna chyba a celá stránka zůstane prázdná).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const tmp = join(".wrangler", "chk");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
let bad = 0;

const check = (file, label) => {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (e) {
    bad++;
    console.log(`CHYBA v ${label}:\n${String(e.stderr).split("\n").slice(0, 6).join("\n")}`);
  }
};

for (const f of readdirSync("public").filter((n) => n.endsWith(".html"))) {
  const html = readFileSync(join("public", f), "utf8");
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
    const file = join(tmp, `${f}_${i}.js`);
    writeFileSync(file, m[1]);
    check(file, `public/${f} (skript ${i + 1})`);
  });
}
for (const f of readdirSync("public").filter((n) => n.endsWith(".js"))) check(join("public", f), `public/${f}`);

console.log(bad ? `\n${bad} chyb` : "Všechny stránky a skripty mají v pořádku syntaxi.");
process.exit(bad ? 1 : 0);
