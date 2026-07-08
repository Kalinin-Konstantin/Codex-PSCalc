import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  clearAnalyticsPeriodCacheForTests,
  countInclusiveDays,
  getAnalyticsPeriod
} from "../src/lib/mpstats/analyticsPeriod.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("MPStats WB analytics period uses estimated_data_period as authoritative d2", async () => {
  clearAnalyticsPeriodCacheForTests();
  const fetchCalls: string[] = [];
  const period = await getAnalyticsPeriod({
    marketplace: "wb",
    nowMs: 1000,
    fetchImpl: async (input) => {
      fetchCalls.push(String(input));
      return jsonResponse({
        date_period_start: "2025-09-01",
        date_period_end: "2026-06-24"
      });
    }
  });

  assert.equal(period.from, "2026-05-26");
  assert.equal(period.to, "2026-06-24");
  assert.equal(period.days, 30);
  assert.equal(period.source, "estimated_data_period");
  assert.equal(countInclusiveDays(period.from, period.to), 30);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /\/analytics\/v1\/public\/wb\/estimated_data_period$/);
});

test("MPStats WB analytics period falls back to a 13 day data lag", async () => {
  clearAnalyticsPeriodCacheForTests();
  const period = await getAnalyticsPeriod({
    marketplace: "wb",
    today: new Date("2026-07-07T12:00:00.000Z"),
    fetchImpl: async () => jsonResponse({ broken: true })
  });

  assert.equal(period.from, "2026-05-26");
  assert.equal(period.to, "2026-06-24");
  assert.equal(period.days, 30);
  assert.equal(period.source, "fallback");
  assert.equal(countInclusiveDays(period.from, period.to), 30);
});

test("MPStats analytics period keeps YYYY-MM-DD date format", async () => {
  clearAnalyticsPeriodCacheForTests();
  const period = await getAnalyticsPeriod({
    marketplace: "wb",
    nowMs: 1000,
    fetchImpl: async () => jsonResponse({
      date_period_start: "2025-09-01",
      date_period_end: "2026-01-01"
    })
  });
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  assert.match(period.from, datePattern);
  assert.match(period.to, datePattern);
});

test("MPStats estimated_data_period response is cached for one hour", async () => {
  clearAnalyticsPeriodCacheForTests();
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return jsonResponse({
      date_period_start: "2025-09-01",
      date_period_end: "2026-06-24"
    });
  };

  const first = await getAnalyticsPeriod({ marketplace: "wb", nowMs: 1000, fetchImpl });
  const second = await getAnalyticsPeriod({ marketplace: "wb", nowMs: 1000 + 30 * 60 * 1000, fetchImpl });
  const third = await getAnalyticsPeriod({ marketplace: "wb", nowMs: 1000 + 61 * 60 * 1000, fetchImpl });

  assert.equal(fetchCount, 2);
  assert.equal(first.source, "estimated_data_period");
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test("MPStats seller analytics endpoints use one shared period helper", () => {
  const source = readFileSync(join(projectRoot, "src/lib/mpstats/sellerReport.ts"), "utf-8");

  assert.match(source, /getAnalyticsPeriod/);
  assert.equal(source.includes("function lastThirtyDaysPeriod"), false);
  assert.equal(source.includes("new Date("), false);
  assert.equal((source.match(/d2:/g) ?? []).length, 1);
  assert.match(source, /d2:\s*period\.to/);
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
