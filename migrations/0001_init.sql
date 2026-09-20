-- Household Hero: rodiny, uživatelé, členství, relace

CREATE TABLE families (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name         TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  is_superadmin        INTEGER NOT NULL DEFAULT 0,
  disabled             INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Role v rodině. Superadmin je příznak na uživateli, ne role v rodině.
CREATE TABLE memberships (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  PRIMARY KEY (family_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);
-- Dítě patří nejvýš do jedné rodiny.
CREATE UNIQUE INDEX one_family_per_child ON memberships(user_id) WHERE role = 'child';

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
