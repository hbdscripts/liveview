/**
 * Tagged warning for promise rejections (avoids silent .catch(() => {})).
 * Use: promise.catch(warnOnReject('[tag] optional-context'))
 */
function warnOnReject(tag) {
  return function (err) {
    try {
      const msg = err && err.message ? String(err.message).slice(0, 220) : err;
      console.warn(tag, msg);
    } catch (_) {}
  };
}

module.exports = { warnOnReject };
