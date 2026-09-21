-- Trénink počítání, rok narození dítěte a denní souhrny (historie)

-- Rok narození: z něj se odvozuje ročník a obtížnost příkladů
ALTER TABLE users ADD COLUMN birth_year INTEGER;

-- Účetní kniha dostává další zdroj odměn: 'train'. SQLite neumí změnit CHECK, proto tabulku přestavíme.
CREATE TABLE ledger_new (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('minutes', 'xp')),
  amount     INTEGER NOT NULL,
  earned_day TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('mission', 'bonus', 'train')),
  ref        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO ledger_new (id, child_id, kind, amount, earned_day, source, ref, created_at)
  SELECT id, child_id, kind, amount, earned_day, source, ref, created_at FROM ledger;
DROP TABLE ledger;
ALTER TABLE ledger_new RENAME TO ledger;
CREATE INDEX idx_ledger_child ON ledger(child_id, kind, earned_day);
CREATE UNIQUE INDEX ledger_once ON ledger(source, ref, kind);

-- Sada příkladů. Správné odpovědi jsou jen na serveru, dítě posílá odpovědi jednu po druhé.
CREATE TABLE train_sessions (
  id              TEXT PRIMARY KEY,
  child_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('math')),
  grade           INTEGER NOT NULL,
  day             TEXT NOT NULL,
  questions       TEXT NOT NULL,                 -- JSON [{q, a}]
  answers         TEXT NOT NULL DEFAULT '[]',    -- JSON [{a, ok, ms}]
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  correct         INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  minutes_awarded INTEGER NOT NULL DEFAULT 0,
  xp_awarded      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_train_child_day ON train_sessions(child_id, day);

-- Denní souhrn za každé dítě a den. Zdroj pravdy zůstává účetní kniha, trhliny, mise a trénink;
-- tabulka se z nich přepočítává (při každé změně, při zobrazení historie a v noci).
CREATE TABLE daily_stats (
  child_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day            TEXT NOT NULL,              -- YYYY-MM-DD (Europe/Prague)
  xp_earned      INTEGER NOT NULL DEFAULT 0, -- XP získané tento den
  minutes_earned INTEGER NOT NULL DEFAULT 0, -- minuty získané tento den (platí od dalšího dne)
  minutes_usable INTEGER NOT NULL DEFAULT 0, -- minuty k dispozici tento den (0 v Den regenerace)
  minutes_carry  INTEGER NOT NULL DEFAULT 0, -- z toho přenesené ze Dne regenerace
  minutes_locked INTEGER NOT NULL DEFAULT 0, -- minuty zamčené Dnem regenerace, přesunuté na další den
  regen          INTEGER NOT NULL DEFAULT 0, -- 1 = Den regenerace
  strikes        INTEGER NOT NULL DEFAULT 0, -- trhliny štítu udělené tento den
  mission_status TEXT NOT NULL DEFAULT 'none' CHECK (mission_status IN ('none', 'open', 'pending', 'approved')),
  mission_done   INTEGER NOT NULL DEFAULT 0, -- kolik z 5 úkolů mise bylo odškrtnuto
  bonus_done     INTEGER NOT NULL DEFAULT 0, -- schválené bonusové úkoly
  train_sessions INTEGER NOT NULL DEFAULT 0, -- dokončené sady příkladů
  train_correct  INTEGER NOT NULL DEFAULT 0, -- správné odpovědi v tréninku
  train_total    INTEGER NOT NULL DEFAULT 0, -- všechny odpovědi v tréninku
  xp_total       INTEGER NOT NULL DEFAULT 0, -- XP celkem na konci dne
  level          INTEGER NOT NULL DEFAULT 1, -- level na konci dne (podle prahů platných při přepočtu)
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (child_id, day)
);
