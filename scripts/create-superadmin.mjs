// Založí (nebo přepíše heslo) superadmina přímo v databázi D1. Nic se neposílá přes veřejné API.
//   npm run create-superadmin -- <uzivatelske_jmeno> "<Zobrazované jméno>" [--local|--remote|--sql]
//   --sql jen vypíše příkaz, který se vloží do D1 Console v dashboardu (nepotřebuje wrangler login)
// Heslo se zeptá v terminálu, nebo se vezme z proměnné HH_PASSWORD.
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const [, , usernameArg, displayName, target = "--local"] = process.argv;
if (!usernameArg || !displayName || !["--local", "--remote", "--sql"].includes(target)) {
  console.error('Použití: npm run create-superadmin -- <jmeno> "<Zobrazované jméno>" [--local|--remote|--sql]');
  process.exit(1);
}
const username = usernameArg.toLowerCase();
if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error("Uživatelské jméno: 3–32 znaků, jen a–z, čísla, tečka, pomlčka, podtržítko.");
  process.exit(1);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s); // zadávaný text se nevypisuje
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = process.env.HH_PASSWORD ?? (await ask("Heslo (min. 8 znaků): "));
if (password.length < 8) {
  console.error("Heslo musí mít aspoň 8 znaků.");
  process.exit(1);
}

// stejné parametry jako src/auth.ts
const ITERATIONS = 100_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password.normalize("NFC"), salt, ITERATIONS, 32, "sha256");
const stored = `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;

const q = (s) => `'${s.replaceAll("'", "''")}'`;
const sql = `INSERT INTO users (id, username, display_name, password_hash, is_superadmin, must_change_password)
VALUES (${q(randomUUID())}, ${q(username)}, ${q(displayName)}, ${q(stored)}, 1, 0)
ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash, display_name = excluded.display_name,
  is_superadmin = 1, disabled = 0, must_change_password = 0, failed_logins = 0, locked_until = NULL;`;

if (target === "--sql") {
  // bez wrangleru: SQL (obsahuje jen hash hesla) se vloží do D1 Console v dashboardu Cloudflare
  console.log(`\n${sql}\n`);
  process.exit(0);
}

const file = join(tmpdir(), `hh-superadmin-${randomUUID()}.sql`);
writeFileSync(file, sql);
try {
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "hh", target, "--file", file], {
    stdio: "inherit",
  });
  console.log(`\nSuperadmin „${username}“ je připraven (${target.slice(2)}).`);
} finally {
  unlinkSync(file);
}
