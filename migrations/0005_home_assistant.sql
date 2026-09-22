-- Napojení na domácí Home Assistant (odtud dál na Family Link přes neoficiální doplněk HAFamilyLink2.0)

CREATE TABLE ha_settings (
  family_id   TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  webhook_url TEXT NOT NULL DEFAULT '', -- https://.../api/webhook/<id> z automatizace v Home Assistant
  token       TEXT NOT NULL DEFAULT '', -- nepovinné: pošle se jako Authorization: Bearer <token>
  enabled     INTEGER NOT NULL DEFAULT 0
);

-- Přiřazení dítěte v Household Hero k identifikátoru zařízení/dítěte v Home Assistant
CREATE TABLE ha_child_map (
  child_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ha_child_id TEXT NOT NULL DEFAULT ''
);

-- Historie pokusů o synchronizaci (pro zobrazení rodiči, poslední pokusy stačí)
CREATE TABLE ha_sync_log (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  minutes    INTEGER NOT NULL,
  locked     INTEGER NOT NULL,
  ok         INTEGER NOT NULL,
  status     INTEGER,
  message    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ha_log_child ON ha_sync_log(child_id, created_at);
