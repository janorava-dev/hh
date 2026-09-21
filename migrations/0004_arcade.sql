-- Hrdinské bludiště: nastavení odměn, spuštění hry (kredity) a odehrané hry

-- Kolik spuštění hry dítě dostává a za co. Výchozí pravidlo: schválená večerní mise = 1 spuštění na další den.
CREATE TABLE game_settings (
  family_id     TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  daily_plays   INTEGER NOT NULL DEFAULT 0, -- základ každý den zdarma (nekumuluje se)
  mission_plays INTEGER NOT NULL DEFAULT 1, -- za schválenou večerní misi (platí od dalšího dne)
  train_plays   INTEGER NOT NULL DEFAULT 0  -- za sadu příkladů s úspěšností aspoň 80 %
);

-- Bonusový úkol může dávat i spuštění hry
ALTER TABLE chores ADD COLUMN game_plays INTEGER NOT NULL DEFAULT 0;

-- Získaná spuštění. Platí od dne po earned_day a kumulují se, dokud je dítě nespotřebuje.
CREATE TABLE game_credits (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  earned_day TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('mission', 'train', 'bonus', 'manual')),
  ref        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gcredits_child ON game_credits(child_id, earned_day);
CREATE UNIQUE INDEX gcredits_once ON game_credits(source, ref);

-- Každé spuštění hry (dítě i rodič). via = z čeho se spuštění zaplatilo; rodiče hrají bez omezení ('free').
CREATE TABLE game_runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  via         TEXT NOT NULL CHECK (via IN ('allowance', 'credit', 'free')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  score       INTEGER NOT NULL DEFAULT 0,
  level       INTEGER NOT NULL DEFAULT 1,
  won         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_gruns_user ON game_runs(user_id, day);

-- Zpětně: už schválené večerní mise dávají spuštění na další den
INSERT OR IGNORE INTO game_credits (id, child_id, amount, earned_day, source, ref)
  SELECT lower(hex(randomblob(16))), child_id, 1, day, 'mission', child_id || ':' || day
    FROM mission_days WHERE status = 'approved';
