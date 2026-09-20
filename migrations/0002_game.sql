-- Herní smyčka: bonusové úkoly, večerní mise, trhliny štítu, účetní kniha, hrdinové

-- Bonusové úkoly definuje rodina (rodiče)
CREATE TABLE chores (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  minutes    INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 60),
  xp         INTEGER NOT NULL CHECK (xp BETWEEN 0 AND 200),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chores_family ON chores(family_id);

-- Večerní mise: jeden záznam na dítě a den (den = Europe/Prague)
CREATE TABLE mission_days (
  child_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  items        TEXT NOT NULL DEFAULT '[0,0,0,0,0]',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'approved')),
  submitted_at TEXT,
  decided_by   TEXT REFERENCES users(id),
  decided_at   TEXT,
  PRIMARY KEY (child_id, day)
);

-- Splněný bonusový úkol čekající na schválení (hodnoty se v okamžiku splnění opíšou)
CREATE TABLE bonus_claims (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chore_id   TEXT NOT NULL REFERENCES chores(id),
  day        TEXT NOT NULL,
  label      TEXT NOT NULL,
  minutes    INTEGER NOT NULL,
  xp         INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT
);
CREATE INDEX idx_claims_child_day ON bonus_claims(child_id, day);
CREATE UNIQUE INDEX one_claim_per_chore_day ON bonus_claims(child_id, chore_id, day) WHERE status != 'rejected';

-- Trhliny štítu (max. 3 za den hlídá aplikace)
CREATE TABLE strikes (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_strikes_child_day ON strikes(child_id, day);

-- Účetní kniha: co dítě získalo. Minuty platí od dne po earned_day.
CREATE TABLE ledger (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('minutes', 'xp')),
  amount     INTEGER NOT NULL,
  earned_day TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('mission', 'bonus')),
  ref        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ledger_child ON ledger(child_id, kind, earned_day);
-- Jedno schválení nemůže připsat odměnu dvakrát
CREATE UNIQUE INDEX ledger_once ON ledger(source, ref, kind);

CREATE TABLE heroes (
  child_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hero      TEXT NOT NULL DEFAULT 'knight',
  name      TEXT,
  equipment TEXT NOT NULL DEFAULT '{}'
);

-- Výchozí bonusové úkoly pro už existující rodiny
INSERT INTO chores (id, family_id, label, minutes, xp)
  SELECT lower(hex(randomblob(16))), f.id, 'Vynést koš', 5, 20 FROM families f;
INSERT INTO chores (id, family_id, label, minutes, xp)
  SELECT lower(hex(randomblob(16))), f.id, 'Vyndat myčku', 10, 30 FROM families f;
INSERT INTO chores (id, family_id, label, minutes, xp)
  SELECT lower(hex(randomblob(16))), f.id, 'Složit prádlo', 10, 30 FROM families f;
