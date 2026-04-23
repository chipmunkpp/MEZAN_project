(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.SV98Utils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function toIsoDate(input) {
    if (input instanceof Date) {
      return input.toISOString().slice(0, 10);
    }
    return String(input || "").slice(0, 10);
  }

  function buildSearchBlob(txn) {
    return [txn.description || "", txn.category || "", txn.account || ""]
      .join(" ")
      .toLowerCase();
  }

  function filterTransactions(txns, filters) {
    const q = (filters && filters.q ? String(filters.q) : "").trim().toLowerCase();
    const from = filters && filters.from ? String(filters.from) : "";
    const to = filters && filters.to ? String(filters.to) : "";
    const type = filters && filters.type ? String(filters.type) : "";

    return txns.filter((txn) => {
      if (q && !buildSearchBlob(txn).includes(q)) return false;
      if (from && String(txn.date || "") < from) return false;
      if (to && String(txn.date || "") > to) return false;
      if (type && txn.type !== type) return false;
      return true;
    });
  }

  function sortTransactions(txns, histSort) {
    const col = histSort && histSort.col ? histSort.col : "date";
    const dir = histSort && histSort.dir ? histSort.dir : -1;
    return txns.slice().sort((a, b) => {
      let av = a[col];
      let bv = b[col];
      if (col === "amount") {
        av = +av;
        bv = +bv;
      }
      return (av < bv ? 1 : av > bv ? -1 : 0) * dir;
    });
  }

  function summarizeTransactions(txns, referenceDate) {
    const today = toIsoDate(referenceDate || new Date());
    const month = today.slice(0, 7);
    const year = today.slice(0, 4);
    const summary = {
      today: { inc: 0, exp: 0, net: 0 },
      month: { inc: 0, exp: 0, net: 0 },
      year: { inc: 0, exp: 0, net: 0 },
      total: 0,
      count: txns.length,
    };

    for (const txn of txns) {
      const amount = Number(txn.amount) || 0;
      const isIncome = txn.type === "income";
      const delta = isIncome ? amount : -amount;
      const date = String(txn.date || "");

      summary.total += delta;
      if (date === today) {
        if (isIncome) summary.today.inc += amount;
        else summary.today.exp += amount;
      }
      if (date.startsWith(month)) {
        if (isIncome) summary.month.inc += amount;
        else summary.month.exp += amount;
      }
      if (date.startsWith(year)) {
        if (isIncome) summary.year.inc += amount;
        else summary.year.exp += amount;
      }
    }

    summary.today.net = summary.today.inc - summary.today.exp;
    summary.month.net = summary.month.inc - summary.month.exp;
    summary.year.net = summary.year.inc - summary.year.exp;
    return summary;
  }

  function buildSevenDayNet(txns, referenceDate) {
    const base = new Date(`${toIsoDate(referenceDate || new Date())}T00:00:00Z`);
    const byDate = new Map();

    for (const txn of txns) {
      const key = String(txn.date || "");
      const bucket = byDate.get(key) || { inc: 0, exp: 0 };
      if (txn.type === "income") bucket.inc += Number(txn.amount) || 0;
      else bucket.exp += Number(txn.amount) || 0;
      byDate.set(key, bucket);
    }

    const labels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const current = new Date(base);
      current.setUTCDate(current.getUTCDate() - i);
      const key = current.toISOString().slice(0, 10);
      const bucket = byDate.get(key) || { inc: 0, exp: 0 };
      out.push({
        lbl: labels[current.getUTCDay()],
        inc: bucket.inc,
        exp: bucket.exp,
        net: bucket.inc - bucket.exp,
      });
    }
    return out;
  }

  function buildSixMonthTrend(txns, referenceDate) {
    const base = new Date(`${toIsoDate(referenceDate || new Date()).slice(0, 7)}-01T00:00:00Z`);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const current = new Date(base);
      current.setUTCMonth(current.getUTCMonth() - i);
      months.push(current.toISOString().slice(0, 7));
    }

    const monthly = new Map(months.map((month) => [month, { inc: 0, exp: 0 }]));
    for (const txn of txns) {
      const key = String(txn.date || "").slice(0, 7);
      if (!monthly.has(key)) continue;
      const bucket = monthly.get(key);
      if (txn.type === "income") bucket.inc += Number(txn.amount) || 0;
      else bucket.exp += Number(txn.amount) || 0;
    }

    return months.map((month) => {
      const bucket = monthly.get(month) || { inc: 0, exp: 0 };
      return {
        lbl: month.slice(5),
        inc: bucket.inc,
        exp: bucket.exp,
        net: bucket.inc - bucket.exp,
      };
    });
  }

  return {
    buildSearchBlob: buildSearchBlob,
    filterTransactions: filterTransactions,
    sortTransactions: sortTransactions,
    summarizeTransactions: summarizeTransactions,
    buildSevenDayNet: buildSevenDayNet,
    buildSixMonthTrend: buildSixMonthTrend,
  };
});
