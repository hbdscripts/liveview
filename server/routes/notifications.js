/**
 * Notifications API: list, get, mark read/archived.
 */
const notificationsService = require('../notificationsService');
const { isMasterRequest, getRequestEmail } = require('../authz');

async function getList(req, res) {
  try {
    let isMaster = false;
    try {
      isMaster = await isMasterRequest(req);
    } catch (_) {}
    const userEmail = getRequestEmail(req) || null;
    const status = (req.query && req.query.status) ? String(req.query.status).trim().toLowerCase() : null;
    const validStatus = status === 'unread' || status === 'read' || status === 'archived' ? status : null;

    const payload = await notificationsService.list({
      userEmail,
      isMaster,
      status: validStatus || undefined,
    });

    const unreadCount = (payload.unread || []).length;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return res.json({
      ok: true,
      unread: payload.unread,
      read: payload.read,
      archived: payload.archived,
      unreadCount,
    });
  } catch (err) {
    console.error('[notifications.list]', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'list_failed' });
  }
}

async function getOne(req, res) {
  try {
    let isMaster = false;
    try {
      isMaster = await isMasterRequest(req);
    } catch (_) {}
    const userEmail = getRequestEmail(req) || null;
    const id = req.params && req.params.id ? req.params.id : null;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

    const notification = await notificationsService.get(id, { userEmail, isMaster });
    if (!notification) return res.status(404).json({ ok: false, error: 'not_found' });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return res.json({ ok: true, notification });
  } catch (err) {
    console.error('[notifications.get]', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'get_failed' });
  }
}

async function patchOne(req, res) {
  try {
    const userEmail = getRequestEmail(req);
    if (!userEmail) return res.status(401).json({ ok: false, error: 'auth_required' });

    const id = req.params && req.params.id ? req.params.id : null;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const read = body.read === true || body.read === 'true';
    const archived = body.archived === true || body.archived === 'true';

    if (read) await notificationsService.markRead(id, userEmail);
    if (archived) await notificationsService.markArchived(id, userEmail);

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  } catch (err) {
    console.error('[notifications.patch]', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'patch_failed' });
  }
}

async function deleteOne(req, res) {
  try {
    const userEmail = getRequestEmail(req);
    if (!userEmail) return res.status(401).json({ ok: false, error: 'auth_required' });

    const id = req.params && req.params.id ? req.params.id : null;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

    await notificationsService.markDeleted(id, userEmail);

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  } catch (err) {
    console.error('[notifications.delete]', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'delete_failed' });
  }
}

module.exports = {
  getList,
  getOne,
  patchOne,
  deleteOne,
};
