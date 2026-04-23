"use strict";

const assert = require("node:assert/strict");
const utils = require("../renderer-utils.js");
const ocrUtils = require("../ocr-utils.js");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

run("filterTransactions matches search and date range", () => {
  const txns = [
    { date: "2026-04-10", description: "Coffee", category: "Food", account: "Cash", type: "expense", amount: 5 },
    { date: "2026-04-11", description: "Client invoice", category: "Freelance", account: "KBANK", type: "income", amount: 100 },
    { date: "2026-04-12", description: "Taxi", category: "Transport", account: "Cash", type: "expense", amount: 8 },
  ];

  const result = utils.filterTransactions(txns, {
    q: "client",
    from: "2026-04-11",
    to: "2026-04-12",
    type: "income",
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].description, "Client invoice");
});

run("summarizeTransactions computes period totals in one pass", () => {
  const txns = [
    { date: "2026-04-18", type: "income", amount: 1200 },
    { date: "2026-04-18", type: "expense", amount: 200 },
    { date: "2026-04-03", type: "expense", amount: 100 },
    { date: "2026-01-15", type: "income", amount: 300 },
  ];

  const summary = utils.summarizeTransactions(txns, "2026-04-18");
  assert.deepEqual(summary.today, { inc: 1200, exp: 200, net: 1000 });
  assert.deepEqual(summary.month, { inc: 1200, exp: 300, net: 900 });
  assert.deepEqual(summary.year, { inc: 1500, exp: 300, net: 1200 });
  assert.equal(summary.total, 1200);
  assert.equal(summary.count, 4);
});

run("buildSevenDayNet groups per day", () => {
  const txns = [
    { date: "2026-04-17", type: "income", amount: 500 },
    { date: "2026-04-17", type: "expense", amount: 50 },
    { date: "2026-04-18", type: "expense", amount: 20 },
  ];

  const days = utils.buildSevenDayNet(txns, "2026-04-18T00:00:00Z");
  assert.equal(days.length, 7);
  assert.equal(days[5].net, 450);
  assert.equal(days[6].net, -20);
});

run("buildSixMonthTrend groups per month", () => {
  const txns = [
    { date: "2026-01-15", type: "income", amount: 300 },
    { date: "2026-03-01", type: "expense", amount: 40 },
    { date: "2026-04-10", type: "income", amount: 900 },
  ];

  const months = utils.buildSixMonthTrend(txns, "2026-04-18T00:00:00Z");
  assert.equal(months.length, 6);
  assert.deepEqual(months[2], { lbl: "01", inc: 300, exp: 0, net: 300 });
  assert.deepEqual(months[5], { lbl: "04", inc: 900, exp: 0, net: 900 });
});

run("normalizeOcrText trims noisy OCR output", () => {
  assert.equal(
    ocrUtils.normalizeOcrText("  hello  \r\nworld \n\n\n"),
    "hello\nworld",
  );
});

run("pickBestOcrCandidate prefers stronger OCR output", () => {
  const best = ocrUtils.pickBestOcrCandidate([
    { engine: "native", text: "   " },
    { engine: "tha", text: "ยอดรวม 1250" },
    { engine: "eng", text: "total" },
  ]);

  assert.equal(best.engine, "tha");
  assert.equal(best.text, "ยอดรวม 1250");
});

if (!process.exitCode) {
  console.log("All tests passed.");
}
