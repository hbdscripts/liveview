/**
 * Asset uploads (Settings → Assets)
 *
 * POST /api/assets/upload (multipart/form-data)
 * GET  /api/asset-overrides
 *
 * Uploads go to Cloudflare R2 (S3-compatible) and return a public URL.
 * URLs are persisted separately via POST /api/settings (asset_overrides) or POST /api/theme-defaults.
 */
const crypto = require('crypto');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const config = require('../config');
const store = require('../store');
const { isMasterRequest } = require('../authz');

const ASSET_OVERRIDES_KEY = 'asset_overrides';

function safeJsonParseObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function safeSlot(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  return s.replace(/[^a-z0-9_-]+/g, '').slice(0, 40);
}

function extFromMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/x-icon' || m === 'image/vnd.microsoft.icon') return 'ico';
  if (m === 'audio/mpeg' || m === 'audio/mp3') return 'mp3';
  return '';
}

function normalizeUploadSlot(rawSlot) {
  const slot = safeSlot(rawSlot);
  const allowed = new Set([
    'favicon',
    'header_logo',
    'footer_logo',
    'login_logo',
    'kexo_logo_fullcolor',
    'sale_sound',
    'other',
  ]);
  if (!slot) return null;
  if (allowed.has(slot)) return slot;
  return null;
}

function buildPublicUrl(base, key) {
  const b = String(base || '').replace(/\/+$/, '');
  const parts = String(key || '').split('/').filter(Boolean).map(encodeURIComponent);
  return b + '/' + parts.join('/');
}

function r2Client() {
  const r2 = (config && config.r2) ? config.r2 : {};
  const accountId = (r2 && r2.accountId) ? String(r2.accountId).trim() : '';
  const accessKeyId = (r2 && r2.accessKeyId) ? String(r2.accessKeyId).trim() : '';
  const secretAccessKey = (r2 && r2.secretAccessKey) ? String(r2.secretAccessKey).trim() : '';
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
  },
});

async function getAssetOverrides(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const raw = await store.getSetting(ASSET_OVERRIDES_KEY);
    const obj = safeJsonParseObject(raw) || {};
    res.json({ ok: true, assetOverrides: obj });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err && err.message ? String(err.message) : 'Failed to read asset overrides',
    });
  }
}

async function postUploadAsset(req, res) {
  const r2 = (config && config.r2) ? config.r2 : {};
  const bucket = (r2 && r2.bucket) ? String(r2.bucket).trim() : '';
  const publicBaseUrl = (r2 && r2.publicBaseUrl) ? String(r2.publicBaseUrl).trim() : '';
  const client = r2Client();
  if (!bucket || !publicBaseUrl || !client) {
    return res.status(500).json({
      ok: false,
      error: 'R2 is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL)',
    });
  }

  const rawSlot = (req.query && req.query.slot != null) ? req.query.slot : (req.body && req.body.slot != null ? req.body.slot : '');
  const slot = normalizeUploadSlot(rawSlot);
  if (!slot) {
    return res.status(400).json({ ok: false, error: 'Invalid slot' });
  }
  // Plan-based lock: normal (non-master) accounts cannot upload branding overrides yet.
  if (slot === 'favicon' || slot === 'header_logo' || slot === 'footer_logo' || slot === 'login_logo' || slot === 'kexo_logo_fullcolor') {
    let isMaster = false;
    try { isMaster = await isMasterRequest(req); } catch (_) { isMaster = false; }
    if (!isMaster) return res.status(402).json({ ok: false, error: 'upgrade_required', upgradeUrl: '/upgrade' });
  }

  const file = req.file;
  if (!file || !file.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length <= 0) {
    return res.status(400).json({ ok: false, error: 'Missing file' });
  }

  const contentType = (file.mimetype || '').toLowerCase();
  const allowedTypes = new Set([
    'image/png', 'image/webp', 'image/jpeg', 'image/jpg', 'image/x-icon', 'image/vnd.microsoft.icon',
    'audio/mpeg', 'audio/mp3',
  ]);
  const isImage = /^image\//.test(contentType);
  const isAudio = /^audio\/(mpeg|mp3)$/i.test(contentType);
  if (!allowedTypes.has(contentType)) {
    return res.status(400).json({ ok: false, error: 'Unsupported file type (use PNG/WebP/JPG/ICO for images, MP3 for audio)' });
  }
  if (slot === 'sale_sound' && !isAudio) {
    return res.status(400).json({ ok: false, error: 'Sale sound must be an MP3 file' });
  }

  const ext = extFromMime(contentType) || 'bin';
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ts = Date.now();
  const rand = crypto.randomBytes(8).toString('hex');
  const key = `settings-assets/${slot}/${yyyy}-${mm}/${ts}-${rand}.${ext}`;

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? String(err.message) : 'Upload failed',
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    slot,
    key,
    contentType,
    size: file.buffer.length,
    url: buildPublicUrl(publicBaseUrl, key),
  });
}

module.exports = {
  uploadSingle: upload.single('file'),
  getAssetOverrides,
  postUploadAsset,
};

