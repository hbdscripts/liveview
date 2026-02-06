const store = require('../store');

function keyForProvider(providerKey) {
  const k = providerKey != null ? String(providerKey).trim().toLowerCase() : '';
  if (!k) return null;
  return `ads_provider_${k}_config`;
}

async function getProviderConfig(providerKey) {
  const key = keyForProvider(providerKey);
  if (!key) return null;
  const raw = await store.getSetting(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function setProviderConfig(providerKey, cfg) {
  const key = keyForProvider(providerKey);
  if (!key) throw new Error('Invalid providerKey');
  const next = cfg && typeof cfg === 'object' ? cfg : {};
  await store.setSetting(key, JSON.stringify(next));
  return true;
}

async function getGoogleAdsConfig() {
  return getProviderConfig('google_ads');
}

async function setGoogleAdsConfig(cfg) {
  return setProviderConfig('google_ads', cfg);
}

module.exports = {
  getProviderConfig,
  setProviderConfig,
  getGoogleAdsConfig,
  setGoogleAdsConfig,
};
