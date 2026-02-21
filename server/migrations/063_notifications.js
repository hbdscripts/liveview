/**
 * Notifications table and per-user read/archive state.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at INTEGER NOT NULL,
  meta TEXT,
  for_admin_only INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_for_admin_only ON notifications(for_admin_only);

CREATE TABLE IF NOT EXISTS notification_read_state (
  notification_id INTEGER NOT NULL,
  user_email TEXT NOT NULL,
  read_at INTEGER,
  archived_at INTEGER,
  PRIMARY KEY (notification_id, user_email),
  FOREIGN KEY (notification_id) REFERENCES notifications(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_read_state_user ON notification_read_state(user_email);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at BIGINT NOT NULL,
  meta TEXT,
  for_admin_only SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_for_admin_only ON notifications(for_admin_only);

CREATE TABLE IF NOT EXISTS notification_read_state (
  notification_id BIGINT NOT NULL REFERENCES notifications(id),
  user_email TEXT NOT NULL,
  read_at BIGINT,
  archived_at BIGINT,
  PRIMARY KEY (notification_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_notification_read_state_user ON notification_read_state(user_email);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    const statements = pgSchema.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.run(stmt + ';');
    }
  } else {
    await db.exec(sqliteSchema);
  }
}

module.exports = { up };
