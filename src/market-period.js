'use strict';
(function marketPeriods() {
  const localDate = iso => {
    if (typeof iso !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const timestamp = Date.parse(iso);
    return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) : null;
  };
  window.marketPeriodStatus = function marketPeriodStatus(period, row, snapshotDate) {
    const snapshot = localDate(snapshotDate);
    const asof = row && Object.hasOwn(row,'checkedAt') ? localDate(row.checkedAt) : snapshot;
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
    // A merged legacy cache may contain newer records without individual timestamps.
    // The embedded snapshot is the earliest possible fetch for those cached rows.
    const cutoff = (asof || snapshot || '').slice(0,7);
    return {asof, complete:period < cutoff && period < today.slice(0,7)};
  };
  window.latestMarketRent = function latestMarketRent(market, room, snapshotDate) {
    const months = market?.months || {};
    let latest = null;
    for (const period of Object.keys(months).sort().reverse()) {
      const row = months[period]?.[room];
      if (!Number.isFinite(row?.price) || row.price <= 0) continue;
      const observation = {period,row,...window.marketPeriodStatus(period,row,snapshotDate)};
      if (observation.complete) return observation;
      if (!latest) latest = observation;
    }
    return latest;
  };
})();
