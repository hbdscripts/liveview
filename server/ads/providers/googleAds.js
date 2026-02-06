async function fetchSummary(options = {}) {
  const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
  const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;

  return {
    ok: true,
    rangeStartTs,
    rangeEndTs,
    currency: 'GBP',
    totals: {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      roas: null,
    },
    campaigns: [],
  };
}

module.exports = {
  fetchSummary,
};
