import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadAnalysisModule() {
  const source = await readFile(new URL("../src/agent/analysis.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const analysis = await loadAnalysisModule();
const NOW = new Date("2026-08-03T02:30:00.000Z"); // 12:00 in Darwin

function point(observedAt, powerKw, siteId = 5) {
  return { observedAt, powerKw, siteId };
}

function input(overrides = {}) {
  return {
    siteId: 5,
    siteName: "Yulara 1",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    capacityKw: 100,
    points: [],
    timezone: "Australia/Darwin",
    now: NOW,
    ...overrides,
  };
}

test("parses the four primary intents and their day counts", () => {
  assert.deepEqual(analysis.parseAgentRequest("过去 7 天发了多少电？"), {
    intent: "energy_summary",
    days: 7,
  });
  assert.deepEqual(analysis.parseAgentRequest("最近一周累计发电量"), {
    intent: "energy_summary",
    days: 7,
  });
  assert.deepEqual(analysis.parseAgentRequest("总结最近一天"), {
    intent: "site_summary",
    days: 1,
  });
  assert.deepEqual(analysis.parseAgentRequest("最近 3 天有没有异常？"), {
    intent: "anomaly_check",
    days: 3,
  });
  assert.deepEqual(analysis.parseAgentRequest("检查过去 5 天的数据质量"), {
    intent: "data_quality",
    days: 5,
  });
});

test("uses intent defaults and rejects unsupported or oversized requests", () => {
  assert.deepEqual(analysis.parseAgentRequest("发了多少电？"), {
    intent: "energy_summary",
    days: 7,
  });
  assert.deepEqual(analysis.parseAgentRequest("最近有没有异常？"), {
    intent: "anomaly_check",
    days: 1,
  });
  assert.deepEqual(analysis.parseAgentRequest("预测准确率是多少？"), {
    intent: "unsupported",
    days: 1,
  });
  assert.throws(
    () => analysis.parseAgentRequest("最近 60 天发了多少电？"),
    /最多分析 30 天/,
  );
});

test("maps today and yesterday to Darwin calendar ranges", () => {
  const today = analysis.calculateAgentDateRange(
    "今天累计发电量是多少？",
    { intent: "energy_summary", days: 1 },
    NOW,
  );
  const yesterday = analysis.calculateAgentDateRange(
    "昨天发了多少电？",
    { intent: "energy_summary", days: 1 },
    NOW,
  );
  assert.deepEqual(today, { startDate: "2026-08-03", endDate: "2026-08-03" });
  assert.deepEqual(yesterday, { startDate: "2026-08-02", endDate: "2026-08-02" });
});

test("calculates five-minute energy without filling nulls and deduplicates timestamps", () => {
  const result = analysis.calculateEnergySummary(input({
    points: [
      point("2026-07-31T14:30:00.000Z", 60),
      point("2026-07-31T14:30:00.000Z", 60),
      point("2026-07-31T14:35:00.000Z", null),
      point("2026-07-31T14:40:00.000Z", 60),
    ],
  }));
  assert.equal(result.energyKwh, 10);
  assert.equal(result.validPointCount, 2);
  assert.equal(result.expectedPointCount, 288);
  assert.equal(result.isPartial, true);

  const quality = analysis.checkDataQuality(input({
    points: [
      point("2026-07-31T14:30:00.000Z", 60),
      point("2026-07-31T14:30:00.000Z", 60),
      point("2026-07-31T14:35:00.000Z", null),
    ],
  }));
  assert.equal(quality.duplicateCount, 1);
  assert.equal(quality.nullCount, 1);
});

test("counts complete historical days and only elapsed points today", () => {
  assert.equal(analysis.expectedPointCount("2026-08-01", "2026-08-01", NOW), 288);
  assert.equal(analysis.expectedPointCount("2026-08-03", "2026-08-03", NOW), 145);

  const justAfterMidnightDarwin = new Date("2026-08-02T14:45:00.000Z");
  assert.equal(analysis.darwinDate(justAfterMidnightDarwin), "2026-08-03");
  assert.equal(
    analysis.expectedPointCount("2026-08-03", "2026-08-03", justAfterMidnightDarwin),
    4,
  );
});

test("detects rapid drops, positive frozen runs, and long missing periods", () => {
  const frozenPoints = Array.from({ length: 13 }, (_, index) =>
    point(new Date(Date.parse("2026-07-31T14:30:00.000Z") + index * 300_000).toISOString(), 50),
  );
  const frozen = analysis.detectSimpleAnomalies(input({ points: frozenPoints }));
  assert.equal(frozen.frozenPeriods.length, 1);
  assert.equal(frozen.frozenPeriods[0].durationMinutes, 60);
  assert.ok(frozen.missingPeriods.length >= 1);

  const rapid = analysis.detectSimpleAnomalies(input({
    points: [
      point("2026-07-31T14:30:00.000Z", 80),
      point("2026-07-31T14:35:00.000Z", 50),
    ],
  }));
  assert.equal(rapid.rapidDrops.length, 1);
  assert.equal(rapid.rapidDrops[0].dropKw, 30);

  const minimumDrop = analysis.detectSimpleAnomalies(input({
    capacityKw: 50,
    points: [
      point("2026-07-31T14:30:00.000Z", 40),
      point("2026-07-31T14:35:00.000Z", 20),
    ],
  }));
  assert.equal(minimumDrop.rapidDrops.length, 1);
});

function context(siteId = 5, siteName = "Yulara 1") {
  return {
    site_id: siteId,
    site_name: siteName,
    start_time: "2026-07-01",
    end_time: "2026-07-01",
    timezone: "Australia/Darwin",
    page: "history",
    selected_metric: "power_kw",
    selected_site_ids: [siteId],
    data_source: "test",
    sites: [
      { id: 5, name: "Yulara 1", capacityKw: 100 },
      { id: 8, name: "Yulara 2", capacityKw: 200 },
    ],
    points: [],
    weather: null,
    systemStatus: null,
  };
}

test("all four primary questions return structured single-site responses", async () => {
  const calls = [];
  const loader = async (startDate, endDate) => {
    calls.push({ startDate, endDate });
    return {
      points: [
        point(`${startDate}T00:00:00+09:30`, 40, 5),
        point(`${startDate}T00:00:00+09:30`, 150, 8),
      ],
    };
  };
  const cases = [
    ["过去 7 天发了多少电？", "energy_summary"],
    ["总结最近一天的发电情况", "site_summary"],
    ["检查最近一天是否有异常", "simple_anomalies"],
    ["检查最近一天的数据质量", "data_quality"],
  ];
  for (const [message, tool] of cases) {
    const response = await analysis.executeAgentRequest(message, context(), loader, NOW);
    assert.equal(response.tool, tool);
    assert.match(response.summary, /Yulara 1/);
    assert.ok(Array.isArray(response.evidence));
  }
  assert.equal(calls.length, 4);
});

test("follows the current site and does not fetch history for unsupported questions", async () => {
  let calls = 0;
  const loader = async (startDate) => {
    calls += 1;
    return {
      points: [
        point(`${startDate}T00:00:00+09:30`, 40, 5),
        point(`${startDate}T00:00:00+09:30`, 150, 8),
      ],
    };
  };
  const response = await analysis.executeAgentRequest(
    "过去一天发了多少电？",
    context(8, "Yulara 2"),
    loader,
    NOW,
  );
  assert.match(response.summary, /Yulara 2/);
  assert.match(response.summary, /12\.50 kWh/);
  assert.equal(calls, 1);

  const unsupported = await analysis.executeAgentRequest(
    "明天会发多少电？",
    context(),
    loader,
    NOW,
  );
  assert.equal(unsupported.tool, "unsupported");
  assert.equal(calls, 1);
});

test("does not reuse a latest-only page snapshot as full history", async () => {
  const current = context();
  current.start_time = "2026-08-03";
  current.end_time = "2026-08-03";
  current.points = [point("2026-08-03T02:30:00.000Z", 24)];
  let calls = 0;
  const start = Date.parse("2026-08-02T14:30:00.000Z");
  const loader = async () => {
    calls += 1;
    return {
      points: Array.from({ length: 145 }, (_, index) =>
        point(new Date(start + index * 300_000).toISOString(), 10 + index * 0.1),
      ),
    };
  };

  const response = await analysis.executeAgentRequest(
    "检查最近一天是否有异常",
    current,
    loader,
    NOW,
  );

  assert.equal(calls, 1);
  assert.equal(response.tool, "simple_anomalies");
  assert.match(response.summary, /未检测到/);
  assert.equal(response.evidence.find((item) => item.label === "异常候选")?.value, "0");
});

test("the panel exposes exactly the four primary shortcuts and a safe API error message", async () => {
  const source = await readFile(new URL("../src/components/AgentPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /过去 7 天发了多少电？/);
  assert.match(source, /总结最近一天/);
  assert.match(source, /检查异常/);
  assert.match(source, /检查数据质量/);
  assert.match(source, /原页面的数据、图表和下载功能不受影响/);
  assert.doesNotMatch(source, /label: "对比站点表现"/);
});
