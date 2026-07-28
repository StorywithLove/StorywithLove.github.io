import type { PowerPoint, SiteId, SolarSite } from "../types";
import type {
  AgentContext,
  AgentFinding,
  AgentResponse,
  AgentTool,
} from "./types";

const INTERVAL_MINUTES = 5;
const POINTS_PER_DAY = 24 * 60 / INTERVAL_MINUTES;
const DARWIN_TZ = "Australia/Darwin";

const localTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: DARWIN_TZ,
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const localHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: DARWIN_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function baseResponse(tool: AgentTool, summary: string): AgentResponse {
  return {
    tool,
    summary,
    evidence: [],
    findings: [],
    inferences: [],
    unknowns: [],
    actions: [],
    generated_at: new Date().toISOString(),
  };
}

function offsetDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function darwinDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DARWIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function expectedTimestamps(start: string, end: string): number {
  const today = darwinDate();
  let count = 0;
  let cursor = start;
  while (cursor <= end) {
    if (cursor < today) count += POINTS_PER_DAY;
    if (cursor === today) {
      const [hour, minute] = localHour.format(new Date()).split(":").map(Number);
      count += Math.min(POINTS_PER_DAY, Math.floor((hour * 60 + minute) / 5) + 1);
    }
    cursor = offsetDate(cursor, 1);
  }
  return count;
}

function selectedSites(context: AgentContext): SolarSite[] {
  const selected = new Set(context.selected_site_ids);
  return context.sites.filter((site) => selected.has(site.id));
}

function selectedPoints(context: AgentContext): PowerPoint[] {
  const selected = new Set(context.selected_site_ids);
  return context.points.filter((point) => selected.has(point.siteId));
}

function uniquePoints(points: PowerPoint[]) {
  const unique = new Map<string, PowerPoint>();
  let duplicates = 0;
  for (const point of points) {
    const key = `${point.observedAt}:${point.siteId}`;
    if (unique.has(key)) duplicates += 1;
    unique.set(key, point);
  }
  return { points: [...unique.values()], duplicates };
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function formatKw(value: number): string {
  return `${value.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kW`;
}

function formatTime(value: string): string {
  return `${localTime.format(new Date(value))} ACST`;
}

function emptyData(tool: AgentTool, context: AgentContext): AgentResponse {
  const response = baseResponse(tool, "当前页面范围没有可分析的功率记录。");
  response.unknowns.push(
    `${context.start_time} 至 ${context.end_time} 尚未获取到数据，或接口暂时不可用。`,
  );
  return response;
}

function missingPeriods(points: PowerPoint[], sites: SolarSite[]): AgentFinding[] {
  const findings: AgentFinding[] = [];
  for (const site of sites) {
    const sitePoints = points
      .filter((point) => point.siteId === site.id)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    for (let index = 1; index < sitePoints.length; index += 1) {
      const previous = new Date(sitePoints[index - 1].observedAt).getTime();
      const current = new Date(sitePoints[index].observedAt).getTime();
      const gapMinutes = Math.round((current - previous) / 60_000);
      if (gapMinutes <= INTERVAL_MINUTES * 1.5) continue;
      findings.push({
        type: "missing_period",
        site_id: site.id,
        start_time: new Date(previous + INTERVAL_MINUTES * 60_000).toISOString(),
        end_time: new Date(current - INTERVAL_MINUTES * 60_000).toISOString(),
        severity: gapMinutes >= 60 ? "medium" : "low",
        description: `${site.name} 检测到约 ${gapMinutes - INTERVAL_MINUTES} 分钟的记录间隔。`,
      });
    }
  }
  return findings
    .sort((a, b) => (b.end_time ?? "").localeCompare(a.end_time ?? ""))
    .slice(0, 5);
}

function constantRuns(points: PowerPoint[], sites: SolarSite[]): number {
  let runs = 0;
  for (const site of sites) {
    const values = points
      .filter((point) => point.siteId === site.id && point.powerKw !== null)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    let length = 1;
    for (let index = 1; index < values.length; index += 1) {
      const consecutive =
        new Date(values[index].observedAt).getTime() -
          new Date(values[index - 1].observedAt).getTime() <=
        6 * 60_000;
      const unchanged = Math.abs((values[index].powerKw ?? 0) - (values[index - 1].powerKw ?? 0)) < 0.001;
      if (consecutive && unchanged) {
        length += 1;
      } else {
        if (length >= 12) runs += 1;
        length = 1;
      }
    }
    if (length >= 12) runs += 1;
  }
  return runs;
}

export function checkDataQuality(context: AgentContext): AgentResponse {
  const rawPoints = selectedPoints(context);
  if (rawPoints.length === 0) return emptyData("data_quality", context);

  const sites = selectedSites(context);
  const { points, duplicates } = uniquePoints(rawPoints);
  const expected = Math.max(1, expectedTimestamps(context.start_time, context.end_time) * sites.length);
  const available = points.filter((point) => point.powerKw !== null).length;
  const nullCount = points.filter((point) => point.powerKw === null).length;
  const negativeCount = points.filter(
    (point) => point.powerKw !== null && point.powerKw < 0,
  ).length;
  const completeness = available / expected * 100;
  const latest = points.reduce(
    (value, point) => point.observedAt > value ? point.observedAt : value,
    "",
  );
  const delayMinutes = latest
    ? Math.max(0, Math.round((Date.now() - new Date(latest).getTime()) / 60_000))
    : null;
  const frozenRuns = constantRuns(points, sites);
  const response = baseResponse(
    "data_quality",
    completeness >= 95
      ? "当前所选范围的数据整体完整，仍需结合少量异常记录判断可用性。"
      : "当前所选范围存在数据缺口，分析结论应结合完整率谨慎解释。",
  );

  response.evidence = [
    { label: "数据完整率", value: formatPercent(completeness), source: "check_data_quality" },
    { label: "实际 / 预期有值点", value: `${available.toLocaleString()} / ${expected.toLocaleString()}`, source: "check_data_quality" },
    { label: "显式空值", value: nullCount.toLocaleString(), source: "check_data_quality" },
    { label: "负值", value: negativeCount.toLocaleString(), source: "check_data_quality" },
    { label: "重复记录", value: duplicates.toLocaleString(), source: "check_data_quality" },
    { label: "更新延迟", value: delayMinutes === null ? "未知" : `${delayMinutes} 分钟`, source: "check_data_quality" },
    { label: "长时间恒定值", value: `${frozenRuns} 段`, source: "check_data_quality" },
  ];
  response.findings = missingPeriods(points, sites);
  if (nullCount > 0) {
    response.findings.unshift({
      type: "null_values",
      severity: nullCount > expected * 0.05 ? "medium" : "low",
      description: `发现 ${nullCount} 个显式空值；分析中未用 0 替代。`,
    });
  }
  if (negativeCount > 0) {
    response.findings.push({
      type: "negative_values",
      severity: "low",
      description: `发现 ${negativeCount} 个负功率值；可能与夜间待机或测量口径有关，当前仅标记、不改写。`,
    });
  }
  if (frozenRuns > 0) {
    response.findings.push({
      type: "constant_values",
      severity: "medium",
      description: `发现 ${frozenRuns} 段至少持续一小时的恒定读数，建议核对采集链路。`,
    });
  }
  if (delayMinutes !== null && delayMinutes > 90) {
    response.findings.push({
      type: "stale_data",
      severity: "high",
      description: `最新记录距今约 ${delayMinutes} 分钟，数据可能已停止更新。`,
    });
  }
  response.unknowns.push("公开数据不包含采集设备心跳，无法仅凭功率记录确认缺失发生在传感器、网络还是归档环节。");
  response.actions.push({ type: "open_data_quality", label: "查看页面数据质量指标" });
  return response;
}

function aggregateByTimestamp(points: PowerPoint[]) {
  const rows = new Map<string, number>();
  for (const point of points) {
    if (point.powerKw === null) continue;
    rows.set(point.observedAt, (rows.get(point.observedAt) ?? 0) + point.powerKw);
  }
  return [...rows.entries()]
    .map(([observedAt, powerKw]) => ({ observedAt, powerKw }))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

export function getDailySummary(context: AgentContext): AgentResponse {
  const points = selectedPoints(context);
  if (points.length === 0) return emptyData("daily_summary", context);
  const rows = aggregateByTimestamp(points);
  if (rows.length === 0) return emptyData("daily_summary", context);
  const peak = rows.reduce((best, row) => row.powerKw > best.powerKw ? row : best, rows[0]);
  const energyKwh = rows.reduce((sum, row) => sum + row.powerKw * (INTERVAL_MINUTES / 60), 0);
  const capacity = selectedSites(context).reduce((sum, site) => sum + site.capacityKw, 0);
  const response = baseResponse(
    "daily_summary",
    `${context.start_time} 至 ${context.end_time} 的已加载真实数据已完成确定性汇总。`,
  );
  response.evidence = [
    { label: "区间发电量", value: `${(energyKwh / 1000).toFixed(2)} MWh`, source: "calculate_energy" },
    { label: "峰值总功率", value: formatKw(peak.powerKw), source: "calculate_peak_metrics" },
    { label: "峰值时间", value: formatTime(peak.observedAt), source: "calculate_peak_metrics" },
    { label: "所选装机容量", value: formatKw(capacity), source: "site_catalog" },
    { label: "参与记录", value: points.length.toLocaleString(), source: "get_power_history" },
  ];
  const quality = checkDataQuality(context);
  response.findings = quality.findings.slice(0, 3);
  response.unknowns = quality.unknowns;
  response.inferences.push({
    statement: quality.evidence[0]?.value === "100.0%"
      ? "汇总覆盖了当前预期时点。"
      : "区间电量可能因缺失记录而被低估。",
    confidence: "high",
    reason: `数据完整率为 ${quality.evidence[0]?.value ?? "未知"}。`,
  });
  response.actions = quality.actions;
  return response;
}

export function detectPowerAnomalies(context: AgentContext): AgentResponse {
  const points = uniquePoints(selectedPoints(context)).points;
  if (points.length === 0) return emptyData("power_anomalies", context);
  const sites = selectedSites(context);
  const findings: AgentFinding[] = [];

  for (const site of sites) {
    const values = points
      .filter((point) => point.siteId === site.id && point.powerKw !== null)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1];
      const current = values[index];
      const interval = (new Date(current.observedAt).getTime() - new Date(previous.observedAt).getTime()) / 60_000;
      const drop = (previous.powerKw ?? 0) - (current.powerKw ?? 0);
      if (interval > 10 || drop < Math.max(20, site.capacityKw * 0.2)) continue;
      findings.push({
        type: "power_drop",
        site_id: site.id,
        start_time: previous.observedAt,
        end_time: current.observedAt,
        severity: drop >= site.capacityKw * 0.45 ? "high" : "medium",
        description: `${site.name} 在 ${interval.toFixed(0)} 分钟内下降 ${formatKw(drop)}。`,
      });
    }
  }

  findings.sort((a, b) => (b.start_time ?? "").localeCompare(a.start_time ?? ""));
  const selectedFindings = findings.slice(0, 8);
  const response = baseResponse(
    "power_anomalies",
    selectedFindings.length
      ? `按规则检测到 ${findings.length} 个快速功率下降候选，以下显示最近 ${selectedFindings.length} 个。`
      : "在当前已加载范围内，规则未检测到超过阈值的快速功率下降。",
  );
  response.evidence = [
    { label: "检测记录", value: points.length.toLocaleString(), source: "detect_power_anomalies" },
    { label: "下降候选", value: findings.length.toLocaleString(), source: "detect_power_anomalies" },
    { label: "规则阈值", value: "≤10 分钟且下降 ≥20% 装机（最少 20 kW）", source: "detect_power_anomalies" },
  ];
  response.findings = selectedFindings;
  if (selectedFindings.length) {
    response.inferences.push({
      statement: "这些区间是“可疑快速下降”，不是已经确认的设备故障或限发事件。",
      confidence: "high",
      reason: "规则只使用公开功率曲线，没有现场辐照度、逆变器告警或 SCADA 限发指令。",
    });
    const first = selectedFindings[0];
    if (first.start_time && first.end_time) {
      response.actions.push({
        type: "highlight_time_range",
        label: "在历史图中查看最近候选",
        start_time: first.start_time,
        end_time: first.end_time,
      });
    }
  }
  response.unknowns.push("缺少现场辐照度、组件温度、逆变器状态和限发设定值，无法确定快速下降的真实原因。");
  return response;
}

export function compareSites(context: AgentContext): AgentResponse {
  const points = uniquePoints(selectedPoints(context)).points;
  if (points.length === 0) return emptyData("site_comparison", context);
  const expectedPerSite = Math.max(1, expectedTimestamps(context.start_time, context.end_time));
  const rows = selectedSites(context).map((site) => {
    const values = points.filter((point) => point.siteId === site.id && point.powerKw !== null);
    const energyKwh = values.reduce(
      (sum, point) => sum + (point.powerKw ?? 0) * (INTERVAL_MINUTES / 60),
      0,
    );
    const completeness = values.length / expectedPerSite * 100;
    const equivalentHours = energyKwh / site.capacityKw;
    return { site, energyKwh, completeness, equivalentHours };
  }).sort((a, b) => b.equivalentHours - a.equivalentHours);

  const response = baseResponse(
    "site_comparison",
    "已按单位装机发电量对所选站点排序；该指标便于比较规模不同的阵列。",
  );
  response.evidence = rows.map((row) => ({
    label: row.site.name,
    value: `${row.equivalentHours.toFixed(2)} kWh/kWp · 完整率 ${formatPercent(row.completeness)}`,
    source: "compare_sites",
  }));
  const lowQuality = rows.filter((row) => row.completeness < 80);
  if (lowQuality.length) {
    response.findings.push({
      type: "comparison_data_gap",
      severity: "medium",
      description: `${lowQuality.map((row) => row.site.name).join("、")} 的完整率低于 80%，排名可能受缺失数据影响。`,
    });
  }
  response.inferences.push({
    statement: "排名差异可能来自天气、阵列结构、设备状态、限发或数据缺失，不能直接等同于设备效率差异。",
    confidence: "high",
    reason: "当前比较未使用现场辐照度和可用功率作为归一化基准。",
  });
  response.unknowns.push("缺少站点级辐照度和逆变器可用率，暂不能计算性能比 PR。");
  return response;
}

export function getWeatherContext(context: AgentContext): AgentResponse {
  const response = baseResponse(
    "weather_context",
    context.weather
      ? "已读取当前附近网格天气，但单个天气快照不足以解释历史功率变化。"
      : "当前天气接口没有可用结果，无法进行天气与功率关联分析。",
  );
  if (context.weather) {
    response.evidence = [
      { label: "气温", value: context.weather.temperatureC === null ? "未知" : `${context.weather.temperatureC} °C`, source: "get_weather_context" },
      { label: "短波辐射 GHI", value: context.weather.shortwaveRadiationWm2 === null ? "未知" : `${context.weather.shortwaveRadiationWm2} W/m²`, source: "get_weather_context" },
      { label: "风速", value: context.weather.windSpeedKmh === null ? "未知" : `${context.weather.windSpeedKmh} km/h`, source: "get_weather_context" },
      { label: "天气时刻", value: formatTime(context.weather.observedAt), source: "get_weather_context" },
    ];
  }
  response.unknowns.push("尚未接入与功率序列同时间粒度的历史天气，因此不能计算相关性或归因。");
  return response;
}

export function forecastUnavailable(): AgentResponse {
  const response = baseResponse(
    "forecast_evaluation",
    "预测结果尚未接入，当前不能评估模型表现。",
  );
  response.unknowns = [
    "缺少同一时间范围的预测值。",
    "缺少模型版本、预测提前量和评估口径。",
  ];
  return response;
}

export function runLocalAgent(message: string, context: AgentContext): AgentResponse {
  if (/质量|完整|缺失|空值|更新/.test(message)) return checkDataQuality(context);
  if (/异常|下降|骤降|掉功率|限发/.test(message)) return detectPowerAnomalies(context);
  if (/对比|比较|站点表现|排名/.test(message)) return compareSites(context);
  if (/天气|辐照|云|风/.test(message)) return getWeatherContext(context);
  if (/预测|模型|误差|mae|rmse/i.test(message)) return forecastUnavailable();
  const response = getDailySummary(context);
  response.summary = `当前未配置自然语言模型服务，我先基于真实数据返回确定性摘要。${response.summary}`;
  response.unknowns.unshift("自由问答需要配置服务端 Agent API；浏览器不会直接调用模型或保存模型密钥。");
  return response;
}
