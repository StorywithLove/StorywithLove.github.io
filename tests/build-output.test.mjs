import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("build emits a GitHub Pages-ready entry document", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Red Earth Lab · 能源与 AI 项目库<\/title>/);
  assert.match(html, /id="root"/);
  assert.match(html, /src="\/assets\//);
  assert.doesNotMatch(html, /codex-preview|database password|private key/i);
});

test("build includes a bespoke social preview", async () => {
  const image = await stat(new URL("../dist/og.png", import.meta.url));
  assert.ok(image.size > 10_000);
});

test("production bundle contains the OCI primary and Solar Centre fallback", async () => {
  const assets = await import("node:fs/promises").then(({ readdir }) =>
    readdir(new URL("../dist/assets/", import.meta.url)),
  );
  const javascript = assets.filter((name) => name.endsWith(".js"));
  const bundle = (
    await Promise.all(
      javascript.map((name) => readFile(new URL(`../dist/assets/${name}`, import.meta.url), "utf8")),
    )
  ).join("\n");
  assert.match(bundle, /api\.xn--fhq9f80kj05g\.com\/api\/v1/);
  assert.match(bundle, /solarcentre\.spinifexvalley\.com\.au\/power\/average/);
  assert.match(bundle, /可调度阵列/);
  assert.match(bundle, /理论可用功率/);
  assert.match(bundle, /the-power-of-far-flung-arrays-yularas-dispersed-design-to-reduce-system-variability\.pdf/);
  assert.match(bundle, /dkasolarcentre\.com\.au\/source\/yulara\/yulara-1-fixed/);
  assert.match(bundle, /paypal\.com\/paypalme\/storywithlove/);
  assert.match(bundle, /通过 PayPal 支持/);
});

test("production build includes the controlled photovoltaic agent", async () => {
  const assets = await import("node:fs/promises").then(({ readdir }) =>
    readdir(new URL("../dist/assets/", import.meta.url)),
  );
  const javascript = assets.filter((name) => name.endsWith(".js"));
  assert.ok(javascript.some((name) => name.startsWith("AgentPanel-")));
  const bundle = (
    await Promise.all(
      javascript.map((name) => readFile(new URL(`../dist/assets/${name}`, import.meta.url), "utf8")),
    )
  ).join("\n");
  assert.match(bundle, /光伏数据分析助手/);
  assert.match(bundle, /确定性单站点分析/);
  assert.match(bundle, /calculate_energy_summary/);
  assert.match(bundle, /check_data_quality/);
  assert.match(bundle, /预测、故障诊断、多站点比较和复杂归因功能尚未接入/);
  assert.doesNotMatch(bundle, /sk-[A-Za-z0-9_-]{20,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
});
