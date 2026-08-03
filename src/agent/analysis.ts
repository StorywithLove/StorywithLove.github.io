import type { PowerPoint, SiteId, SolarSite } from "../types";
import type {
  AgentContext,
  AgentFinding,
  AgentIntent,
  AgentResponse,
  AgentTool,
  ParsedAgentRequest,
} from "./types";

export const ANALYSIS_THRESHOLDS = {
  missingMinutes: 15,
  frozenMinutes: 60,
  rapidDropWindowMinutes: 10,
  rapidDropCapacityRatio: 0.2,
  rapidDropMinimumKw: 20,
} as const;

const INTERVAL_MINUTES = 5;
const INTERVAL_MS = INTERVAL_MINUTES * 60_000;
const POINTS_PER_DAY = 24 * 60 / INTERVAL_MINUTES;
const DARWIN_TZ = "Australia/Darwin" as const;
const MAX_ANALYSIS_DAYS = 30;
const UNSUPPORTED_MESSAGE =
  "当前助手只支持页面所选单个站点的历史发电量、近期概览、简单异常候选和数据质量分析。预测、故障诊断、多站点比较和复杂归因功能尚未接入。";

const localTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: DARWIN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export interface AnalysisInput {
  siteId: SiteId;
  siteName: string;
  startDate: string;
  endDate: string;
  capacityKw: number;
  points: PowerPoint[];
  timezone: typeof DARWIN_TZ;
  now?: Date;
}

export interface EnergySummaryResult {
  energyKwh: number;
  completeness: number;
  validPointCount: number;
  expectedPointCount: number;
  isPartial: boolean;
}

export interface SiteSummaryResult extends EnergySummaryResult {
  peakPowerKw: number | null;
  peakTime: string | null;
  averagePowerKw: number | null;
  latestPowerKw: number | null;
  latestObservedAt: string | null;
}

export interface AnalysisPeriod {
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface RapidDropPeriod extends AnalysisPeriod {
  dropKw: number;
}

export interface SimpleAnomalyResult {
  missingPeriods: AnalysisPeriod[];
  frozenPeriods: AnalysisPeriod[];
  rapidDrops: RapidDropPeriod[];
  totalCandidateCount: number;
}

export interface DataQualityResult {
  expectedPointCount: number;
  validPointCount: number;
  completeness: number;
  nullCount: number;
  negativeCount: number;
  duplicateCount: number;
  missingPeriods: AnalysisPeriod[];
  frozenPeriodCount: number;
  latestObservedAt: string | null;
  delayMinutes: number | null;
  suitableForEnergyCalculation: boolean;
}

export interface AgentHistoryResult {
  points: PowerPoint[];
}

export type AgentHistoryLoader = (
  startDate: string,
  endDate: string,
) => Promise<AgentHistoryResult>;

export class AgentRangeError extends Error {
  constructor(message = "当前单次最多分析 30 天，请缩短查询范围。") {
    super(message);
    this.name = "AgentRangeError";
  }
}

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

export function darwinDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DARWIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function darwinStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00+09:30`);
}

function rangeEndMs(endDate: string, now: Date): number {
  const today = darwinDate(now);
  if (endDate === today) {
    return Math.floor(now.getTime() / INTERVAL_MS) * INTERVAL_MS;
  }
  return darwinStartMs(offsetDate(endDate, 1)) - INTERVAL_MS;
}

function expectedPointTimes(startDate: string, endDate: string, now: Date): number[] {
  const start = darwinStartMs(startDate);
  const end = rangeEndMs(endDate, now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const result: number[] = [];
  for (let timestamp = start; timestamp <= end; timestamp += INTERVAL_MS) {
    result.push(timestamp);
  }
  return result;
}

export function expectedPointCount(
  startDate: string,
  endDate: string,
  now = new Date(),
): number {
  return expectedPointTimes(startDate, endDate, now).length;
}

function chineseNumber(value: string): number | null {
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, units] = value.split("十");
    return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  }
  return digits[value] ?? null;
}

function extractExplicitDays(message: string): number | null {
  if (/一周|一个星期|1\s*(?:周|星期)/.test(message)) return 7;
  const match = message.match(/([0-9０-９]{1,3}|[一二两三四五六七八九十]{1,3})\s*(?:天|日)/);
  if (!match) return /今天|今日|昨天|昨日|一天/.test(message) ? 1 : null;
  const normalized = match[1].replace(/[０-９]/g, (digit) =>
    String(digit.charCodeAt(0) - "０".charCodeAt(0)),
  );
  return /^\d+$/.test(normalized) ? Number(normalized) : chineseNumber(normalized);
}

function intentForMessage(message: string): AgentIntent {
  if (/预测|明天|未来|故障|限发|多站点|两个?电站|哪个更好|归因|天气.*(?:造成|导致)|为什么.*(?:下降|异常)/i.test(message)) {
    return "unsupported";
  }
  if (/数据质量|完整|缺失|缺数据|空值|更新时间|更新延迟|曲线断/.test(message)) {
    return "data_quality";
  }
  if (/异常|掉功率|突然下降|骤降|冻结|不变|数据正常|正常吗/.test(message)) {
    return "anomaly_check";
  }
  if (/发了多少电|发电量|累计电量|累计发电/.test(message)) {
    return "energy_summary";
  }
  if (/总结|发电情况|表现如何|怎么样|运行情况|当前电站/.test(message)) {
    return "site_summary";
  }
  return "unsupported";
}

export function parseAgentRequest(message: string): ParsedAgentRequest {
  const intent = intentForMessage(message.trim());
  const explicitDays = extractExplicitDays(message);
  if (explicitDays !== null && (explicitDays < 1 || explicitDays > MAX_ANALYSIS_DAYS)) {
    throw new AgentRangeError(
      explicitDays > MAX_ANALYSIS_DAYS
        ? undefined
        : "当前单次至少分析 1 天，请调整查询范围。",
    );
  }
  const defaultDays = intent === "energy_summary" ? 7 : 1;
  return { intent, days: explicitDays ?? defaultDays };
}

export function calculateAgentDateRange(
  message: string,
  request: ParsedAgentRequest,
  now = new Date(),
): { startDate: string; endDate: string } {
  const today = darwinDate(now);
  const endDate = /昨天|昨日/.test(message) ? offsetDate(today, -1) : today;
  return {
    startDate: offsetDate(endDate, -(request.days - 1)),
    endDate,
  };
}

function uniqueSitePoints(input: AnalysisInput): {
  points: PowerPoint[];
  duplicateCount: number;
} {
  const unique = new Map<number, PowerPoint>();
  let duplicateCount = 0;
  const start = darwinStartMs(input.startDate);
  const end = rangeEndMs(input.endDate, input.now ?? new Date());
  for (const point of input.points) {
    if (point.siteId !== input.siteId) continue;
    const timestamp = new Date(point.observedAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end) continue;
    if (unique.has(timestamp)) {
      duplicateCount += 1;
      const previous = unique.get(timestamp)!;
      if (previous.powerKw !== null && point.powerKw === null) continue;
    }
    unique.set(timestamp, point);
  }
  return {
    points: [...unique.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt)),
    duplicateCount,
  };
}

function completeness(valid: number, expected: number): number {
  if (expected === 0) return 0;
  return Math.max(0, Math.min(100, valid / expected * 100));
}

export function calculateEnergySummary(input: AnalysisInput): EnergySummaryResult {
  const { points } = uniqueSitePoints(input);
  const valid = points.filter((point) => point.powerKw !== null);
  const expected = expectedPointCount(input.startDate, input.endDate, input.now);
  const resultCompleteness = completeness(valid.length, expected);
  return {
    energyKwh: valid.reduce(
      (sum, point) => sum + (point.powerKw as number) * INTERVAL_MINUTES / 60,
      0,
    ),
    completeness: resultCompleteness,
    validPointCount: valid.length,
    expectedPointCount: expected,
    isPartial: resultCompleteness < 100,
  };
}

export function calculateSiteSummary(input: AnalysisInput): SiteSummaryResult {
  const { points } = uniqueSitePoints(input);
  const valid = points.filter(
    (point): point is PowerPoint & { powerKw: number } => point.powerKw !== null,
  );
  const energy = calculateEnergySummary(input);
  const peak = valid.length
    ? valid.reduce((best, point) => point.powerKw > best.powerKw ? point : best)
    : null;
  const latest = valid.at(-1) ?? null;
  return {
    ...energy,
    peakPowerKw: peak?.powerKw ?? null,
    peakTime: peak?.observedAt ?? null,
    averagePowerKw: valid.length
      ? valid.reduce((sum, point) => sum + point.powerKw, 0) / valid.length
      : null,
    latestPowerKw: latest?.powerKw ?? null,
    latestObservedAt: latest?.observedAt ?? null,
  };
}

function findMissingPeriods(input: AnalysisInput): AnalysisPeriod[] {
  const now = input.now ?? new Date();
  const validTimes = new Set(
    uniqueSitePoints(input).points
      .filter((point) => point.powerKw !== null)
      .map((point) => new Date(point.observedAt).getTime()),
  );
  const periods: AnalysisPeriod[] = [];
  let runStart: number | null = null;
  let runEnd: number | null = null;
  const flush = () => {
    if (runStart === null || runEnd === null) return;
    const durationMinutes = (runEnd - runStart) / 60_000 + INTERVAL_MINUTES;
    if (durationMinutes > ANALYSIS_THRESHOLDS.missingMinutes) {
      periods.push({
        startTime: new Date(runStart).toISOString(),
        endTime: new Date(runEnd).toISOString(),
        durationMinutes,
      });
    }
    runStart = null;
    runEnd = null;
  };
  for (const timestamp of expectedPointTimes(input.startDate, input.endDate, now)) {
    if (!validTimes.has(timestamp)) {
      runStart ??= timestamp;
      runEnd = timestamp;
    } else {
      flush();
    }
  }
  flush();
  return periods;
}

function findFrozenPeriods(input: AnalysisInput): AnalysisPeriod[] {
  const points = uniqueSitePoints(input).points.filter(
    (point): point is PowerPoint & { powerKw: number } =>
      point.powerKw !== null && point.powerKw > 0,
  );
  const periods: AnalysisPeriod[] = [];
  let start = 0;
  const flush = (end: number) => {
    if (end <= start) return;
    const durationMinutes = (
      new Date(points[end].observedAt).getTime() -
      new Date(points[start].observedAt).getTime()
    ) / 60_000;
    if (durationMinutes >= ANALYSIS_THRESHOLDS.frozenMinutes) {
      periods.push({
        startTime: points[start].observedAt,
        endTime: points[end].observedAt,
        durationMinutes,
      });
    }
  };
  for (let index = 1; index < points.length; index += 1) {
    const interval = (
      new Date(points[index].observedAt).getTime() -
      new Date(points[index - 1].observedAt).getTime()
    ) / 60_000;
    const sameValue = Math.abs(points[index].powerKw - points[index - 1].powerKw) < 0.001;
    if (interval <= INTERVAL_MINUTES * 1.1 && sameValue) continue;
    flush(index - 1);
    start = index;
  }
  if (points.length) flush(points.length - 1);
  return periods;
}

function findRapidDrops(input: AnalysisInput): RapidDropPeriod[] {
  const points = uniqueSitePoints(input).points.filter(
    (point): point is PowerPoint & { powerKw: number } => point.powerKw !== null,
  );
  const capacityDrop = input.capacityKw * ANALYSIS_THRESHOLDS.rapidDropCapacityRatio;
  const periods: RapidDropPeriod[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const durationMinutes = (
      new Date(current.observedAt).getTime() - new Date(previous.observedAt).getTime()
    ) / 60_000;
    const dropKw = previous.powerKw - current.powerKw;
    if (
      durationMinutes > 0 &&
      durationMinutes <= ANALYSIS_THRESHOLDS.rapidDropWindowMinutes &&
      dropKw >= ANALYSIS_THRESHOLDS.rapidDropMinimumKw &&
      dropKw > capacityDrop
    ) {
      periods.push({
        startTime: previous.observedAt,
        endTime: current.observedAt,
        durationMinutes,
        dropKw,
      });
    }
  }
  return periods;
}

export function detectSimpleAnomalies(input: AnalysisInput): SimpleAnomalyResult {
  const missingPeriods = findMissingPeriods(input);
  const frozenPeriods = findFrozenPeriods(input);
  const rapidDrops = findRapidDrops(input);
  return {
    missingPeriods,
    frozenPeriods,
    rapidDrops,
    totalCandidateCount: missingPeriods.length + frozenPeriods.length + rapidDrops.length,
  };
}

export function checkDataQuality(input: AnalysisInput): DataQualityResult {
  const now = input.now ?? new Date();
  const { points, duplicateCount } = uniqueSitePoints(input);
  const valid = points.filter((point) => point.powerKw !== null);
  const expected = expectedPointCount(input.startDate, input.endDate, now);
  const latestObservedAt = points.at(-1)?.observedAt ?? null;
  const delayReference = rangeEndMs(input.endDate, now);
  const delayMinutes = latestObservedAt
    ? Math.max(0, Math.round((delayReference - new Date(latestObservedAt).getTime()) / 60_000))
    : null;
  const anomalies = detectSimpleAnomalies(input);
  const resultCompleteness = completeness(valid.length, expected);
  return {
    expectedPointCount: expected,
    validPointCount: valid.length,
    completeness: resultCompleteness,
    nullCount: points.filter((point) => point.powerKw === null).length,
    negativeCount: valid.filter((point) => (point.powerKw as number) < 0).length,
    duplicateCount,
    missingPeriods: anomalies.missingPeriods,
    frozenPeriodCount: anomalies.frozenPeriods.length,
    latestObservedAt,
    delayMinutes,
    suitableForEnergyCalculation: valid.length > 0 && resultCompleteness >= 80,
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatKw(value: number | null): string {
  return value === null
    ? "无有效数据"
    : `${value.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kW`;
}

function formatEnergy(value: number): string {
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(2)} MWh`
    : `${value.toFixed(2)} kWh`;
}

function formatTime(value: string | null): string {
  return value ? `${localTime.format(new Date(value))} ACST` : "无有效数据";
}

function rangeEvidence(input: AnalysisInput) {
  return [
    { label: "当前站点", value: input.siteName, source: "page_context" },
    { label: "分析日期", value: `${input.startDate} — ${input.endDate}`, source: "darwin_date_range" },
  ];
}

function missingFindings(periods: AnalysisPeriod[], siteId: SiteId): AgentFinding[] {
  return periods.map((period) => ({
    type: "missing_period",
    site_id: siteId,
    start_time: period.startTime,
    end_time: period.endTime,
    severity: period.durationMinutes >= 60 ? "medium" : "low",
    description: `检测到约 ${period.durationMinutes} 分钟的数据缺失区间。`,
  }));
}

function energyResponse(input: AnalysisInput): AgentResponse {
  const result = calculateEnergySummary(input);
  const response = baseResponse(
    "energy_summary",
    `${input.siteName} 在 ${input.startDate} 至 ${input.endDate} 的累计发电量为 ${formatEnergy(result.energyKwh)}。`,
  );
  response.evidence = [
    ...rangeEvidence(input),
    { label: "累计发电量", value: formatEnergy(result.energyKwh), source: "calculate_energy_summary" },
    { label: "数据完整率", value: formatPercent(result.completeness), source: "calculate_energy_summary" },
    { label: "实际 / 预期有值点", value: `${result.validPointCount} / ${result.expectedPointCount}`, source: "calculate_energy_summary" },
  ];
  if (result.isPartial) {
    response.inferences.push({
      statement: "发电量可能因缺失数据而被低估。",
      confidence: "high",
      reason: `数据完整率为 ${formatPercent(result.completeness)}，空值未按 0 补齐。`,
    });
  }
  return response;
}

function siteSummaryResponse(input: AnalysisInput): AgentResponse {
  const result = calculateSiteSummary(input);
  const response = baseResponse(
    "site_summary",
    result.validPointCount
      ? `${input.siteName} 在所选 ${input.startDate} 至 ${input.endDate} 区间累计发电 ${formatEnergy(result.energyKwh)}，峰值功率 ${formatKw(result.peakPowerKw)}。`
      : `${input.siteName} 在所选日期内没有有效功率记录，暂时无法形成发电概览。`,
  );
  response.evidence = [
    ...rangeEvidence(input),
    { label: "累计发电量", value: formatEnergy(result.energyKwh), source: "calculate_site_summary" },
    { label: "峰值功率", value: formatKw(result.peakPowerKw), source: "calculate_site_summary" },
    { label: "峰值时间", value: formatTime(result.peakTime), source: "calculate_site_summary" },
    { label: "平均功率", value: formatKw(result.averagePowerKw), source: "calculate_site_summary" },
    { label: "最新功率", value: formatKw(result.latestPowerKw), source: "calculate_site_summary" },
    { label: "最新数据时间", value: formatTime(result.latestObservedAt), source: "calculate_site_summary" },
    { label: "数据完整率", value: formatPercent(result.completeness), source: "calculate_site_summary" },
  ];
  if (result.isPartial) {
    response.inferences.push({
      statement: "区间汇总可能因缺失记录而偏低。",
      confidence: "high",
      reason: "电量只累加真实非空的五分钟平均功率记录。",
    });
  }
  response.unknowns.push("未使用设备告警、限发设定值或现场辐照度，本概览不作故障诊断或天气归因。");
  return response;
}

function anomalyResponse(input: AnalysisInput): AgentResponse {
  const result = detectSimpleAnomalies(input);
  const response = baseResponse(
    "simple_anomalies",
    result.totalCandidateCount
      ? `${input.siteName} 在所选区间检测到 ${result.totalCandidateCount} 个简单异常候选。`
      : `${input.siteName} 在所选区间未检测到达到当前阈值的简单异常候选。`,
  );
  response.evidence = [
    ...rangeEvidence(input),
    { label: "异常候选", value: String(result.totalCandidateCount), source: "detect_simple_anomalies" },
    { label: "缺失 / 冻结 / 快速下降", value: `${result.missingPeriods.length} / ${result.frozenPeriods.length} / ${result.rapidDrops.length}`, source: "detect_simple_anomalies" },
  ];
  response.findings = [
    ...missingFindings(result.missingPeriods, input.siteId),
    ...result.frozenPeriods.map((period): AgentFinding => ({
      type: "frozen_period",
      site_id: input.siteId,
      start_time: period.startTime,
      end_time: period.endTime,
      severity: "medium",
      description: `检测到持续 ${period.durationMinutes} 分钟的正功率恒定值，标记为数据冻结候选。`,
    })),
    ...result.rapidDrops.map((period): AgentFinding => ({
      type: "rapid_drop",
      site_id: input.siteId,
      start_time: period.startTime,
      end_time: period.endTime,
      severity: period.dropKw > input.capacityKw * 0.45 ? "high" : "medium",
      description: `${period.durationMinutes} 分钟内功率下降 ${formatKw(period.dropKw)}，标记为快速下降候选。`,
    })),
  ].slice(0, 8);
  response.inferences.push({
    statement: "仅凭公开功率数据无法确认异常的具体原因。",
    confidence: "high",
    reason: "当前规则只检测数据缺失、恒定值和短时快速下降。",
  });
  response.unknowns = ["没有逆变器告警、限发设定值、SCADA 状态或现场辐照度，不能将候选直接判定为设备故障、限发或云层遮挡。"];
  const first = response.findings.find((finding) => finding.start_time && finding.end_time);
  if (first?.start_time && first.end_time) {
    response.actions.push({
      type: "highlight_time_range",
      label: "在历史图中查看最近候选",
      start_time: first.start_time,
      end_time: first.end_time,
    });
  }
  return response;
}

function dataQualityResponse(input: AnalysisInput): AgentResponse {
  const result = checkDataQuality(input);
  const response = baseResponse(
    "data_quality",
    result.suitableForEnergyCalculation
      ? `${input.siteName} 在所选区间的数据完整率为 ${formatPercent(result.completeness)}，适合进行发电量统计。`
      : `${input.siteName} 在所选区间的数据完整率为 ${formatPercent(result.completeness)}，暂不适合直接进行可靠的发电量统计。`,
  );
  response.evidence = [
    ...rangeEvidence(input),
    { label: "理论预期记录", value: String(result.expectedPointCount), source: "check_data_quality" },
    { label: "实际有效记录", value: String(result.validPointCount), source: "check_data_quality" },
    { label: "数据完整率", value: formatPercent(result.completeness), source: "check_data_quality" },
    { label: "空值 / 负值 / 重复", value: `${result.nullCount} / ${result.negativeCount} / ${result.duplicateCount}`, source: "check_data_quality" },
    { label: "长时间恒定值", value: `${result.frozenPeriodCount} 段`, source: "check_data_quality" },
    { label: "最新数据时间", value: formatTime(result.latestObservedAt), source: "check_data_quality" },
    { label: "更新延迟", value: result.delayMinutes === null ? "未知" : `${result.delayMinutes} 分钟`, source: "check_data_quality" },
    { label: "适合电量统计", value: result.suitableForEnergyCalculation ? "是" : "否", source: "check_data_quality" },
  ];
  response.findings = missingFindings(result.missingPeriods, input.siteId).slice(0, 8);
  if (result.nullCount) {
    response.findings.unshift({
      type: "null_values",
      severity: result.nullCount > result.expectedPointCount * 0.05 ? "medium" : "low",
      description: `发现 ${result.nullCount} 个显式空值；分析中未用 0 替代。`,
    });
  }
  if (result.negativeCount) {
    response.findings.push({
      type: "negative_values",
      severity: "low",
      description: `发现 ${result.negativeCount} 个负值；已保留原始语义并单独标记。`,
    });
  }
  if (result.frozenPeriodCount) {
    response.findings.push({
      type: "frozen_periods",
      severity: "medium",
      description: `发现 ${result.frozenPeriodCount} 段至少持续 60 分钟的正功率恒定值。`,
    });
  }
  response.unknowns.push("公开数据不包含采集设备心跳，无法确认缺失发生在传感器、网络还是归档环节。");
  response.actions.push({ type: "open_data_quality", label: "查看页面数据质量指标" });
  return response;
}

export function unsupportedResponse(): AgentResponse {
  const response = baseResponse("unsupported", UNSUPPORTED_MESSAGE);
  response.unknowns = ["尚未接入预测结果、故障诊断数据、多站点对比所需统一口径或复杂归因数据。"];
  return response;
}

function responseForIntent(intent: AgentIntent, input: AnalysisInput): AgentResponse {
  if (intent === "energy_summary") return energyResponse(input);
  if (intent === "site_summary") return siteSummaryResponse(input);
  if (intent === "anomaly_check") return anomalyResponse(input);
  if (intent === "data_quality") return dataQualityResponse(input);
  return unsupportedResponse();
}

function selectedSite(context: AgentContext): SolarSite | undefined {
  return context.sites.find((site) => site.id === context.site_id);
}

function inputFromContext(
  context: AgentContext,
  startDate: string,
  endDate: string,
  points: PowerPoint[],
  now?: Date,
): AnalysisInput {
  return {
    siteId: context.site_id as SiteId,
    siteName: context.site_name,
    startDate,
    endDate,
    capacityKw: selectedSite(context)?.capacityKw ?? 0,
    points,
    timezone: DARWIN_TZ,
    now,
  };
}

export async function executeAgentRequest(
  message: string,
  context: AgentContext,
  loadHistory: AgentHistoryLoader,
  now = new Date(),
): Promise<AgentResponse> {
  const parsed = parseAgentRequest(message);
  if (parsed.intent === "unsupported") return unsupportedResponse();
  const { startDate, endDate } = calculateAgentDateRange(message, parsed, now);
  // The page can temporarily label a latest-only snapshot with today's date.
  // Always load the requested history range so a single realtime point is not
  // mistaken for complete range coverage and reported as a day-long data gap.
  const history = await loadHistory(startDate, endDate);
  return responseForIntent(
    parsed.intent,
    inputFromContext(context, startDate, endDate, history.points, now),
  );
}

// Compatibility wrappers keep the existing auxiliary capabilities available,
// while the main panel uses executeAgentRequest for the four supported questions.
export function getDailySummary(context: AgentContext): AgentResponse {
  return siteSummaryResponse(
    inputFromContext(context, context.start_time, context.end_time, context.points),
  );
}

export function detectPowerAnomalies(context: AgentContext): AgentResponse {
  return anomalyResponse(
    inputFromContext(context, context.start_time, context.end_time, context.points),
  );
}

export function compareSites(context: AgentContext): AgentResponse {
  const selected = new Set(context.selected_site_ids);
  const unique = new Map<string, PowerPoint>();
  for (const point of context.points) {
    if (!selected.has(point.siteId)) continue;
    unique.set(`${point.siteId}:${point.observedAt}`, point);
  }
  const expected = Math.max(1, expectedPointCount(context.start_time, context.end_time));
  const rows = context.sites
    .filter((site) => selected.has(site.id))
    .map((site) => {
      const points = [...unique.values()].filter(
        (point): point is PowerPoint & { powerKw: number } =>
          point.siteId === site.id && point.powerKw !== null,
      );
      const energyKwh = points.reduce(
        (sum, point) => sum + point.powerKw * INTERVAL_MINUTES / 60,
        0,
      );
      return {
        site,
        equivalentHours: site.capacityKw > 0 ? energyKwh / site.capacityKw : 0,
        completeness: completeness(points.length, expected),
      };
    })
    .sort((a, b) => b.equivalentHours - a.equivalentHours);
  const response = baseResponse(
    "site_comparison",
    "站点对比辅助功能已保留，并按页面当前曲线所选站点的单位装机发电量排序。",
  );
  response.evidence = rows.map((row) => ({
    label: row.site.name,
    value: `${row.equivalentHours.toFixed(2)} kWh/kWp · 完整率 ${formatPercent(row.completeness)}`,
    source: "compare_sites",
  }));
  response.inferences.push({
    statement: "该排序仅为辅助观察，不能直接等同于设备效率差异。",
    confidence: "high",
    reason: "当前没有统一的现场辐照度、设备可用率和限发设定值。",
  });
  response.unknowns.push("缺少统一辐照度和设备可用率口径，不能据此判断哪个站点更好。");
  return response;
}

export function getWeatherContext(context: AgentContext): AgentResponse {
  const response = baseResponse(
    "weather_context",
    context.weather
      ? "天气辅助信息已保留，但单个附近网格快照不能解释历史功率变化。"
      : "当前没有可用的附近网格天气结果。",
  );
  if (context.weather) {
    response.evidence = [
      { label: "气温", value: context.weather.temperatureC === null ? "未知" : `${context.weather.temperatureC} °C`, source: "weather_grid" },
      { label: "短波辐射 GHI", value: context.weather.shortwaveRadiationWm2 === null ? "未知" : `${context.weather.shortwaveRadiationWm2} W/m²`, source: "weather_grid" },
    ];
  }
  response.unknowns.push("尚未接入与功率序列同粒度的现场天气，不能进行复杂归因。");
  return response;
}

export function forecastUnavailable(): AgentResponse {
  const response = baseResponse("forecast_evaluation", "预测结果尚未接入，当前不能评估模型表现。");
  response.unknowns = ["缺少预测值、模型版本、预测提前量和评估口径。"];
  return response;
}

export function runLocalAgent(message: string, context: AgentContext): AgentResponse {
  if (/对比|比较|排名/.test(message)) return compareSites(context);
  if (/天气|辐照|云|风/.test(message)) return getWeatherContext(context);
  if (/预测|模型|误差|mae|rmse/i.test(message)) return forecastUnavailable();
  const parsed = parseAgentRequest(message);
  if (parsed.intent === "unsupported") return unsupportedResponse();
  return responseForIntent(
    parsed.intent,
    inputFromContext(context, context.start_time, context.end_time, context.points),
  );
}
