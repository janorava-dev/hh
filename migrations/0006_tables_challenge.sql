-- Nová samostatná výzva: malá násobilka a dělení se zbytkem (train_sessions.kind = 'tables').
-- SQLite neumí měnit CHECK, proto tabulku přestavíme.

CREATE TABLE train_sessions_new (
  id              TEXT PRIMARY KEY,
  child_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('math', 'tables')),
  grade           INTEGER NOT NULL,
  day             TEXT NOT NULL,
  questions       TEXT NOT NULL,
  answers         TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  correct         INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  minutes_awarded INTEGER NOT NULL DEFAULT 0,
  xp_awarded      INTEGER NOT NULL DEFAULT 0
);
INSERT INTO train_sessions_new SELECT * FROM train_sessions;
DROP TABLE train_sessions;
ALTER TABLE train_sessions_new RENAME TO train_sessions;
CREATE INDEX idx_train_child_day ON train_sessions(child_id, day);
