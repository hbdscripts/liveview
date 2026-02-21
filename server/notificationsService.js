/**
 * Notifications: create, list, get, mark read/archived.
 * Preferences (notifications_preferences_v1) control which types are shown and created.
 */
const { getDb } = require('./db');
const store = require('./store');

const PREFS_KEY = 'notifications_preferences_v1';

const DEFAULT_PREFS = {
  daily_report: true,
  sale: true,
  sentry: true,
  pending_signup: true,
  diagnostics_unresolved: true,
};

function safeJsonParse(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    const v = JSON.parse(str);
    return typeof v === 'object' && v !== null ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

async function getPreferences() {
  const raw = await store.getSetting(PREFS_KEY);
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
  return { ...DEFAULT_PREFS, ...parsed };
}

function isTypeEnabled(prefs, type) {
  const key = type === 'diagnostics_unresolved' ? 'diagnostics_unresolved' : type;
  return prefs[key] !== false;
}

/**
 * Create a notification. Does not check preferences (caller checks for create-side toggles).
 */
async function create({ type, title, body, link, meta, forAdminOnly }) {
  const db = getDb();
  const now = Date.now();
  const metaStr = meta != null && typeof meta === 'object' ? JSON.stringify(meta) : null;
  const forAdmin = forAdminOnly ? 1 : 0;
  if (typeof title !== 'string') title = String(title ?? '');
  if (typeof body !== 'string') body = body != null ? String(body) : null;
  if (typeof link !== 'string') link = link != null ? String(link) : null;

  await db.run(
    `INSERT INTO notifications (type, title, body, link, created_at, meta, for_admin_only)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [String(type || '').slice(0, 64), title.slice(0, 512), body ? body.slice(0, 65535) : null, link ? link.slice(0, 1024) : null, now, metaStr, forAdmin]
  );
  const row = await db.get('SELECT id FROM notifications WHERE created_at = ? ORDER BY id DESC LIMIT 1', [now]);
  return row ? row.id : null;
}

/**
 * List notifications for the current user. Options: { userEmail, isMaster, status?: 'unread'|'read'|'archived' }.
 * Returns { unread, read, archived } each an array of { id, type, title, created_at, read_at?, archived_at? }.
 */
async function list(options = {}) {
  const { userEmail, isMaster, status: filterStatus } = options;
  const prefs = await getPreferences();
  const db = getDb();

  let sql = `
    SELECT n.id, n.type, n.title, n.body, n.link, n.created_at, n.for_admin_only,
           r.read_at, r.archived_at
    FROM notifications n
    LEFT JOIN notification_read_state r ON r.notification_id = n.id AND r.user_email = ?
    WHERE 1=1
  `;
  const params = [userEmail || ''];

  if (!isMaster) {
    sql += ' AND n.for_admin_only = 0';
  }

  sql += ' ORDER BY n.created_at DESC';

  const rows = await db.all(sql, params);

  const unread = [];
  const read = [];
  const archived = [];

  for (const row of rows || []) {
    if (!isTypeEnabled(prefs, row.type)) continue;
    const forAdmin = row.for_admin_only === 1 || row.for_admin_only === true;
    if (forAdmin && !isMaster) continue;

    const item = {
      id: row.id,
      type: row.type,
      title: row.title,
      created_at: row.created_at,
      read_at: row.read_at || null,
      archived_at: row.archived_at || null,
    };
    if (row.archived_at) {
      archived.push(item);
    } else if (row.read_at) {
      read.push(item);
    } else {
      unread.push(item);
    }
  }

  if (filterStatus === 'unread') return { unread, read: [], archived: [] };
  if (filterStatus === 'read') return { unread: [], read, archived: [] };
  if (filterStatus === 'archived') return { unread: [], read: [], archived };

  return { unread, read, archived };
}

/**
 * Get one notification by id. Returns null if not found or not visible.
 */
async function get(id, options = {}) {
  const { isMaster } = options;
  const prefs = await getPreferences();
  const db = getDb();
  const nId = Number(id);
  if (!Number.isFinite(nId)) return null;

  const row = await db.get('SELECT * FROM notifications WHERE id = ?', [nId]);
  if (!row) return null;
  if (row.for_admin_only === 1 && !isMaster) return null;
  if (!isTypeEnabled(prefs, row.type)) return null;

  let read_at = null;
  let archived_at = null;
  if (options.userEmail) {
    const r = await db.get(
      'SELECT read_at, archived_at FROM notification_read_state WHERE notification_id = ? AND user_email = ?',
      [nId, options.userEmail]
    );
    if (r) {
      read_at = r.read_at;
      archived_at = r.archived_at;
    }
  }

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    created_at: row.created_at,
    meta: row.meta ? safeJsonParse(row.meta, null) : null,
    read_at,
    archived_at,
  };
}

async function markRead(notificationId, userEmail) {
  if (!userEmail) return;
  const db = getDb();
  const nId = Number(notificationId);
  if (!Number.isFinite(nId)) return;
  const now = Date.now();
  await db.run(
    `INSERT INTO notification_read_state (notification_id, user_email, read_at, archived_at)
     VALUES (?, ?, ?, 0)
     ON CONFLICT (notification_id, user_email) DO UPDATE SET read_at = ?`,
    [nId, userEmail, now, now]
  );
}

async function markArchived(notificationId, userEmail) {
  if (!userEmail) return;
  const db = getDb();
  const nId = Number(notificationId);
  if (!Number.isFinite(nId)) return;
  const now = Date.now();
  await db.run(
    `INSERT INTO notification_read_state (notification_id, user_email, read_at, archived_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (notification_id, user_email) DO UPDATE SET read_at = COALESCE(read_at, excluded.read_at), archived_at = excluded.archived_at`,
    [nId, userEmail, now, now]
  );
}

/**
 * Create a Sentry error notification (admin-only). Call from instrument.js after capture.
 * Checks preference so we don't create if sentry notifications are disabled.
 */
async function createSentryNotification(messageOrError) {
  try {
    const prefs = await getPreferences();
    if (!isTypeEnabled(prefs, 'sentry')) return null;
    const title = 'Sentry error logged';
    const body = typeof messageOrError === 'string' ? messageOrError : (messageOrError && messageOrError.message ? messageOrError.message : 'Error');
    return create({ type: 'sentry', title, body, forAdminOnly: true });
  } catch (_) {
    return null;
  }
}

module.exports = {
  getPreferences,
  create,
  list,
  get,
  markRead,
  markArchived,
  createSentryNotification,
};
