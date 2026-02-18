function resolveBuildEnv(nodeEnv) {
  return nodeEnv === 'production' ? 'production' : 'development';
}

function resolveGitSha(input) {
  const s = input != null ? String(input).trim() : '';
  if (!s) return 'unknown';
  return s.length > 64 ? s.slice(0, 64) : s;
}

function buildVersionPayload({ pkg, assetVersion, sentryDsn, nodeEnv, gitSha }) {
  const payload = {
    ok: true,
    version: String((pkg && pkg.version) || '0.0.0'),
    git_sha: resolveGitSha(gitSha),
    build_env: resolveBuildEnv(nodeEnv),
    assetVersion: assetVersion ? String(assetVersion) : null,
  };
  const dsn = sentryDsn != null ? String(sentryDsn).trim() : '';
  if (dsn) payload.sentryDsn = dsn;
  return payload;
}

function makeHandler({ pkg, config, assetVersion }) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const payload = buildVersionPayload({
      pkg,
      assetVersion,
      sentryDsn: config && config.sentryDsn ? config.sentryDsn : '',
      nodeEnv: config && config.nodeEnv ? config.nodeEnv : 'development',
      gitSha: (config && (config.gitSha || config.assetVersion)) || '',
    });
    res.json(payload);
  };
}

module.exports = {
  resolveBuildEnv,
  resolveGitSha,
  buildVersionPayload,
  makeHandler,
};
