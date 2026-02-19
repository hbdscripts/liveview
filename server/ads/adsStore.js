const crypto = require('crypto');
const store = require('../store');
const config = require('../config');

const LEGACY_KEY = 'ads_provider_google_ads_config';

function normalizeShop(shop) {
  if (shop == null || typeof shop !== 'string') return '';
  return String(shop).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] || '';
}

function keyForProvider(providerKey, shop) {
  const k = providerKey != null ? String(providerKey).trim().toLowerCase() : '';
  if (!k) return null;
  const norm = normalizeShop(shop);
  if (norm) return `ads_provider_${k}_config_${norm}`;
  return `ads_provider_${k}_config`;
}

function deriveEncryptionKey() {
  const raw = config.adsRefreshTokenEncryptionKey || '';
  if (!raw.length) return null;
  if (raw.length >= 32) return Buffer.from(raw.slice(0, 32), 'utf8');
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encryptRefreshToken(plain) {
  const key = deriveEncryptionKey();
  if (!key || !plain || typeof plain !== 'string') return plain;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64');
  } catch (_) {
    return plain;
  }
}

function decryptRefreshToken(encrypted) {
  const key = deriveEncryptionKey();
  if (!key || !encrypted || typeof encrypted !== 'string') return encrypted;
  if (!encrypted.startsWith('enc:')) return encrypted;
  try {
    const buf = Buffer.from(encrypted.slice(4), 'base64');
    if (buf.length < 16 + 16 + 1) return null;
    const iv = buf.subarray(0, 16);
    const tag = buf.subarray(16, 32);
    const data = buf.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  } catch (_) {
    return null;
  }
}

async function getProviderConfig(providerKey, shop) {
  const shopKey = keyForProvider(providerKey, shop);
  const legacyKey = keyForProvider(providerKey, null);
  const key = shopKey || legacyKey;
  if (!key) return null;
  let raw = await store.getSetting(key);
  if (!raw && shopKey && shopKey !== legacyKey) {
    raw = await store.getSetting(legacyKey);
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.refresh_token && typeof parsed.refresh_token === 'string') {
      const dec = decryptRefreshToken(parsed.refresh_token);
      if (dec === null) {
        return { ...parsed, refresh_token: undefined };
      }
      if (dec !== parsed.refresh_token) {
        return { ...parsed, refresh_token: dec };
      }
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

async function setProviderConfig(providerKey, cfg, shop) {
  const key = keyForProvider(providerKey, shop) || keyForProvider(providerKey, null);
  if (!key) throw new Error('Invalid providerKey');
  const next = cfg && typeof cfg === 'object' ? { ...cfg } : {};
  if (next.refresh_token && typeof next.refresh_token === 'string' && !next.refresh_token.startsWith('enc:')) {
    const enc = encryptRefreshToken(next.refresh_token);
    if (enc !== next.refresh_token) next.refresh_token = enc;
  }
  await store.setSetting(key, JSON.stringify(next));
  return true;
}

function getResolvedCustomerIds(cfg) {
  const n = (s) => String(s ?? '').replace(/[^0-9]/g, '').slice(0, 32);
  return {
    customerId: n(cfg && cfg.customer_id != null ? cfg.customer_id : config.googleAdsCustomerId),
    loginCustomerId: n(cfg && cfg.login_customer_id != null ? cfg.login_customer_id : config.googleAdsLoginCustomerId),
    conversionCustomerId: n(cfg && cfg.conversion_customer_id != null ? cfg.conversion_customer_id : ''),
  };
}

async function getGoogleAdsConfig(shop) {
  // When OAuth disabled, use env-based config (GOOGLE_ADS_REFRESH_TOKEN + GOOGLE_ADS_*).
  if (!config.googleAdsOAuthEnabled && config.googleAdsRefreshToken) {
    return {
      refresh_token: config.googleAdsRefreshToken,
      customer_id: config.googleAdsCustomerId || undefined,
      login_customer_id: config.googleAdsLoginCustomerId || undefined,
      conversion_customer_id: undefined,
    };
  }
  return getProviderConfig('google_ads', shop);
}

async function setGoogleAdsConfig(cfg, shop) {
  return setProviderConfig('google_ads', cfg, shop);
}

module.exports = {
  keyForProvider,
  getProviderConfig,
  setProviderConfig,
  getGoogleAdsConfig,
  setGoogleAdsConfig,
  getResolvedCustomerIds,
  normalizeShop,
};
