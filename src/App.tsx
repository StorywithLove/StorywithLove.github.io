import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  Github,
  HeartHandshake,
  MapPinned,
  RefreshCw,
  Satellite,
  Sun,
  ThermometerSun,
  Wind,
} from "lucide-react";
import { HistoryChart } from "./components/HistoryChart";
import { SiteMap } from "./components/SiteMap";
import { SITES } from "./data/sites";
import {
  fetchSiteCatalog,
  fetchSystemStatus,
  darwinDate,
  fetchLatestPower,
  fetchPowerRange,
  powerApiHostnames,
} from "./services/dataAdapter";
import { fetchYularaWeather } from "./services/weatherAdapter";
import type { AgentAction, AgentContext } from "./agent/types";
import type {
  LoadState,
  PowerPoint,
  PowerSnapshot,
  SiteCatalog,
  SiteId,
  SystemStatus,
  WeatherSnapshot,
} from "./types";

const DARWIN_TZ = "Australia/Darwin";
const ARENA_CURTAILMENT_REPORT_URL =
  "https://www.arena.gov.au/assets/2018/12/the-power-of-far-flung-arrays-yularas-dispersed-design-to-reduce-system-variability.pdf";
const DESERT_GARDENS_SOURCE_URL =
  "https://dkasolarcentre.com.au/source/yulara/yulara-1-fixed";
const PAYPAL_SUPPORT_URL = "https://www.paypal.com/paypalme/storywithlove";
const AgentPanel = lazy(() =>
  import("./components/AgentPanel").then((module) => ({ default: module.AgentPanel })),
);
const dateTimeDarwin = new Intl.DateTimeFormat("zh-CN", {
  timeZone: DARWIN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateTimeUtc = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function offsetDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatPower(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : value.toLocaleString("en-AU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}

function weatherLabel(code: number | null): string {
  if (code === null) return "天气状态未知";
  if (code === 0) return "晴朗";
  if ([1, 2].includes(code)) return "少云";
  if (code === 3) return "多云";
  if ([45, 48].includes(code)) return "雾";
  if (code >= 51 && code <= 67) return "降雨";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code >= 95) return "雷暴";
  return "天气变化中";
}

function directionLabel(degrees: number | null): string {
  if (degrees === null) return "—";
  const directions = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return directions[Math.round(degrees / 45) % 8];
}

function latestAtTimestamp(points: PowerPoint[]) {
  const observedAt = points.reduce(
    (latest, point) => (point.observedAt > latest ? point.observedAt : latest),
    "",
  );
  const values = new Map<SiteId, PowerPoint>();
  points
    .filter((point) => point.observedAt === observedAt)
    .forEach((point) => values.set(point.siteId, point));
  return { observedAt, values };
}

function statusFor(observedAt: string, missingCount: number) {
  if (!observedAt) return { label: "暂时不可用", tone: "offline" };
  if (missingCount > 0) return { label: "部分缺失", tone: "warning" };
  const ageMinutes = (Date.now() - new Date(observedAt).getTime()) / 60_000;
  if (ageMinutes <= 20) return { label: "数据正常", tone: "ok" };
  if (ageMinutes <= 90) return { label: "数据延迟", tone: "warning" };
  return { label: "源数据较旧", tone: "offline" };
}

function apiStatusDisplay(status: SystemStatus["status"]) {
  const labels: Record<SystemStatus["status"], string> = {
    fresh: "数据正常",
    delayed: "数据延迟",
    stale: "源数据较旧",
    partial: "站点时间不一致",
    degraded: "部分站点缺失",
    unavailable: "数据暂时不可用",
  };
  return {
    label: labels[status],
    tone: status === "fresh" ? "ok" : status === "delayed" || status === "partial" ? "warning" : "offline",
  };
}

function freshness(observedAt: string): string {
  if (!observedAt) return "尚无成功观测";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(observedAt).getTime()) / 60_000));
  if (minutes < 1) return "不足 1 分钟前更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  return `${Math.floor(minutes / 60)} 小时前更新`;
}

function getRangeQuality(points: PowerPoint[], selected: Set<SiteId>, start: string, end: string) {
  const selectedPoints = points.filter((point) => selected.has(point.siteId));
  const nullCount = selectedPoints.filter((point) => point.powerKw === null).length;
  const negativeCount = selectedPoints.filter(
    (point) => point.powerKw !== null && point.powerKw < 0,
  ).length;
  const today = darwinDate();
  let cursor = start;
  let timestamps = 0;
  while (cursor <= end) {
    if (cursor < today) timestamps += 288;
    else if (cursor === today) {
      const localParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: DARWIN_TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date()).split(":");
      timestamps += Math.floor((Number(localParts[0]) * 60 + Number(localParts[1])) / 5) + 1;
    }
    cursor = offsetDate(cursor, 1);
  }
  const expected = Math.max(1, timestamps * selected.size);
  const available = selectedPoints.filter((point) => point.powerKw !== null).length;
  return {
    completeness: Math.min(100, (available / expected) * 100),
    nullCount,
    negativeCount,
    available,
    expected,
  };
}

function App() {
  const today = darwinDate();
  const [power, setPower] = useState<PowerSnapshot | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [history, setHistory] = useState<PowerSnapshot | null>(null);
  const [siteCatalog, setSiteCatalog] = useState<SiteCatalog | null>(null);
  const [apiStatus, setApiStatus] = useState<SystemStatus | null>(null);
  const [powerState, setPowerState] = useState<LoadState>("loading");
  const [historyState, setHistoryState] = useState<LoadState>("loading");
  const [weatherState, setWeatherState] = useState<LoadState>("loading");
  const [selectedSiteId, setSelectedSiteId] = useState<SiteId>(5);
  const [selectedHistorySites, setSelectedHistorySites] = useState<Set<SiteId>>(
    new Set(SITES.map((site) => site.id)),
  );
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [rangeError, setRangeError] = useState("");
  const [showUtc, setShowUtc] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [agentHighlight, setAgentHighlight] = useState<{ start: string; end: string } | null>(null);
  const sites = siteCatalog?.sites ?? SITES;
  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const totalCapacityKw = siteCatalog?.totalCapacityKw ?? sites.reduce(
    (total, site) => total + site.capacityKw,
    0,
  );
  const totalCapacityLabel = totalCapacityKw.toLocaleString("en-AU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const loadLatest = useCallback(async (showLoading = true) => {
    if (showLoading) setPowerState("loading");
    try {
      const snapshot = await fetchLatestPower();
      setPower(snapshot);
      setPowerState("success");
      setHistory((current) => current ?? snapshot);
      setHistoryState((current) => current === "loading" ? "success" : current);
    } catch {
      setPowerState("error");
    }
  }, []);

  const loadProjectMetadata = useCallback(async () => {
    const [catalogResult, statusResult] = await Promise.allSettled([
      fetchSiteCatalog(),
      fetchSystemStatus(),
    ]);
    if (catalogResult.status === "fulfilled") setSiteCatalog(catalogResult.value);
    if (statusResult.status === "fulfilled") setApiStatus(statusResult.value);
    else setApiStatus(null);
  }, []);

  const loadWeather = useCallback(async () => {
    setWeatherState("loading");
    try {
      setWeather(await fetchYularaWeather());
      setWeatherState("success");
    } catch {
      setWeatherState("error");
    }
  }, []);

  const loadHistory = useCallback(async (start: string, end: string) => {
    const days = Math.round(
      (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
    if (start > end) {
      setRangeError("开始日期不能晚于结束日期。");
      return;
    }
    if (end > darwinDate()) {
      setRangeError("结束日期不能晚于 Yulara 当地今天。");
      return;
    }
    if (days > 30) {
      setRangeError("公开源首版单次最多查询 30 天，请缩短范围。");
      return;
    }
    setRangeError("");
    setHistoryState("loading");
    try {
      setHistory(await fetchPowerRange(start, end));
      setHistoryState("success");
    } catch {
      setHistoryState("error");
    }
  }, []);

  useEffect(() => {
    void loadLatest();
    void loadWeather();
    void loadProjectMetadata();
  }, [loadLatest, loadProjectMetadata, loadWeather]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadLatest(false);
      void loadWeather();
      void loadProjectMetadata();
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [loadLatest, loadProjectMetadata, loadWeather]);

  const latest = useMemo(() => latestAtTimestamp(power?.points ?? []), [power]);
  const missingCount = sites.filter((site) => !latest.values.has(site.id) || latest.values.get(site.id)?.powerKw === null).length;
  const totalPower = [...latest.values.values()].reduce(
    (total, point) => total + (point.powerKw ?? 0),
    0,
  );
  const utilization = (totalPower / totalCapacityKw) * 100;
  const systemStatus = apiStatus ? apiStatusDisplay(apiStatus.status) : statusFor(latest.observedAt, missingCount);
  const quality = useMemo(
    () => getRangeQuality(history?.points ?? [], selectedHistorySites, startDate, endDate),
    [history, selectedHistorySites, startDate, endDate],
  );
  const todaysEnergy = useMemo(() => {
    if (!history || startDate !== today || endDate !== today || quality.completeness < 80) return null;
    return history.points.reduce(
      (sum, point) => sum + (point.powerKw === null ? 0 : point.powerKw * (5 / 60)),
      0,
    );
  }, [history, startDate, endDate, today, quality.completeness]);

  const chooseQuickRange = (days: number) => {
    const start = offsetDate(today, -(days - 1));
    setStartDate(start);
    setEndDate(today);
    void loadHistory(start, today);
  };

  const toggleHistorySite = (siteId: SiteId) => {
    setSelectedHistorySites((current) => {
      const next = new Set(current);
      if (next.has(siteId) && next.size > 1) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
    setSelectedSiteId(siteId);
  };

  const handleSiteSelect = (siteId: SiteId) => {
    setSelectedSiteId(siteId);
    setSelectedHistorySites((current) =>
      current.has(siteId) ? current : new Set([...current, siteId]),
    );
  };

  const downloadCsv = () => {
    if (!history?.points.length) return;
    const rows = [
      ["observed_at_utc", "observed_at_darwin", "timezone", "site_id", "site_name", "power", "unit"],
      ...history.points
        .filter((point) => selectedHistorySites.has(point.siteId))
        .map((point) => [
          point.observedAt,
          dateTimeDarwin.format(new Date(point.observedAt)),
          DARWIN_TZ,
          String(point.siteId),
          siteById.get(point.siteId)?.name ?? "",
          point.powerKw === null ? "" : String(point.powerKw),
          "kW",
        ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `yulara-power-${startDate}-${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const agentContext = useMemo<AgentContext>(() => ({
    site_id: selectedSiteId,
    site_name: siteById.get(selectedSiteId)?.name ?? `site_id ${selectedSiteId}`,
    start_time: startDate,
    end_time: endDate,
    timezone: DARWIN_TZ,
    page: "history",
    selected_metric: "power_kw",
    selected_site_ids: [...selectedHistorySites],
    data_source: history?.source ?? power?.source ?? "暂未连接",
    sites,
    points: history?.points ?? [],
    weather,
    systemStatus: apiStatus,
  }), [
    apiStatus,
    endDate,
    history,
    power?.source,
    selectedHistorySites,
    selectedSiteId,
    siteById,
    sites,
    startDate,
    weather,
  ]);

  const handleAgentAction = (action: AgentAction) => {
    if (action.type === "highlight_time_range" && action.start_time && action.end_time) {
      setAgentHighlight({ start: action.start_time, end: action.end_time });
    }
    document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">跳至主要内容</a>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <span className="brand-mark" aria-hidden="true">RE</span>
          <span><strong>RED EARTH LAB</strong><small>ENERGY × AI PROJECT LIBRARY</small></span>
        </a>
        <button
          className="nav-toggle"
          type="button"
          aria-expanded={mobileNav}
          aria-controls="primary-nav"
          onClick={() => setMobileNav((value) => !value)}
        >
          导航
        </button>
        <nav id="primary-nav" className={mobileNav ? "primary-nav is-open" : "primary-nav"} aria-label="主要导航">
          <a href="#live">实时功率</a>
          <a href="#map">站点地图</a>
          <a href="#history">历史回看</a>
          <a href="#sources">数据方法</a>
          <a href="#support">支持项目</a>
          <a href="#roadmap">路线图</a>
        </nav>
      </header>

      <main id="main">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">PROJECT 001 <span>AUSTRALIA · YULARA</span></p>
            <h1 id="hero-title">把一座沙漠电站，<br />变成可追溯的数据现场。</h1>
            <p className="hero-intro">
              面向能源数据、光伏预测与 AI Agent 的长期项目库。首个档案连接 Yulara
              五个分布式光伏子系统的公开五分钟功率观测。
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#live">查看实时数据 <ArrowDownToLine size={16} /></a>
              <a className="button button-ghost" href="#sources">了解数据口径</a>
            </div>
          </div>
          <div className="hero-metrics" aria-live="polite">
            <div className="status-line">
              <span className={`status-dot ${systemStatus.tone}`} aria-hidden="true" />
              <strong>{powerState === "loading" && !power ? "正在连接公开数据源" : systemStatus.label}</strong>
              {power?.fromCache && <em>显示上次成功数据</em>}
            </div>
            <div className="hero-power">
              <span>当前总功率</span>
              <strong>{power ? formatPower(totalPower, 1) : "—"}</strong>
              <b>kW</b>
            </div>
            <div className="hero-grid">
              <div><span>装机容量</span><strong>{totalCapacityLabel} kW</strong></div>
              <div><span>容量利用率</span><strong>{power ? `${utilization.toFixed(1)}%` : "—"}</strong></div>
              <div><span>最新观测 · ACST</span><strong>{latest.observedAt ? dateTimeDarwin.format(new Date(latest.observedAt)) : "—"}</strong></div>
              <div><span>五个子系统</span><strong>{apiStatus ? `${apiStatus.reportingSiteCount} / ${apiStatus.expectedSiteCount} 上报` : `${5 - missingCount} / 5 有值`}</strong></div>
            </div>
            <p className="freshness"><Clock3 size={14} /> {freshness(latest.observedAt)}</p>
          </div>
        </section>

        <section className="weather-ribbon" aria-label="Yulara 附近网格模型天气">
          <div className="weather-source">
            <Satellite size={20} />
            <span><strong>附近网格模型天气</strong><small>Open‑Meteo · 五站共享同一附近网格，并非现场传感器实测值</small></span>
          </div>
          <div className="weather-value"><ThermometerSun size={18} /><span>气温<strong>{weather ? `${weather.temperatureC ?? "—"} °C` : "—"}</strong></span></div>
          <div className="weather-value"><span>相对湿度<strong>{weather ? `${weather.humidityPercent ?? "—"}%` : "—"}</strong></span></div>
          <div className="weather-value"><Wind size={18} /><span>10 m 风<strong>{weather ? `${weather.windSpeedKmh ?? "—"} km/h · ${directionLabel(weather.windDirectionDeg)}` : "—"}</strong></span></div>
          <div className="weather-value"><Sun size={18} /><span>短波辐射 GHI<strong>{weather ? `${weather.shortwaveRadiationWm2 ?? "—"} W/m²` : "—"}</strong></span></div>
          <div className="weather-value"><span>昼夜<strong>{weather ? `${weather.isDay ? "白昼" : "夜间"} · ${weatherLabel(weather.weatherCode)}` : "—"}</strong></span></div>
          <div className="weather-value"><span>日出 / 日落<strong>{weather?.sunrise?.slice(11, 16) ?? "—"} / {weather?.sunset?.slice(11, 16) ?? "—"} ACST</strong></span></div>
          {weatherState === "error" && <span className="weather-error">天气数据暂时不可用</span>}
        </section>

        <section className="section live-section" id="live" aria-labelledby="live-title">
          <div className="section-heading">
            <div><p className="eyebrow">01 / LIVE ARRAY</p><h2 id="live-title">五站实时功率</h2></div>
            <div className="section-tools">
              <button className="text-button" type="button" onClick={() => setShowUtc((value) => !value)}>{showUtc ? "显示 ACST" : "查看 UTC"}</button>
              <button className="button button-dark" type="button" onClick={() => { void loadLatest(); void loadWeather(); }} disabled={powerState === "loading"}>
                <RefreshCw size={15} className={powerState === "loading" ? "is-spinning" : ""} /> 手动刷新
              </button>
            </div>
          </div>
          <div className="observation-strip">
            <span>观测时间 <strong>{latest.observedAt ? (showUtc ? `${dateTimeUtc.format(new Date(latest.observedAt))} UTC` : `${dateTimeDarwin.format(new Date(latest.observedAt))} ACST`) : "—"}</strong></span>
            <span>网页获取 <strong>{power?.fetchedAt ? `${dateTimeDarwin.format(new Date(power.fetchedAt))} ACST` : "—"}</strong></span>
            <span>更新周期 <strong>5 分钟自动刷新</strong></span>
            <span>数据源 <strong>{!power ? "正在连接 OCI 只读 REST API" : power.source === "oci-api" ? "OCI 只读 REST API · DKA 归档" : "DKA Solar Centre 公开接口 · 降级"}</strong></span>
          </div>
          {powerState === "error" && !power && (
            <div className="inline-alert" role="alert"><CircleAlert size={18} /> 实时功率暂时无法读取。页面不会用模拟数据替代，请稍后手动刷新。</div>
          )}
          {!!power?.partialFailures.length && (
            <div className="inline-alert" role="status"><CircleAlert size={18} /> 部分公开接口请求失败，当前数值可能只覆盖成功返回的日期或站点。</div>
          )}
          <div className="site-cards">
            {sites.map((site) => {
              const point = latest.values.get(site.id);
              const value = point?.powerKw ?? null;
              const siteUtilization = value === null ? null : (value / site.capacityKw) * 100;
              const contribution = totalPower > 0 && value !== null ? (value / totalPower) * 100 : null;
              const selected = selectedSiteId === site.id;
              return (
                <button
                  type="button"
                  className={`site-card ${selected ? "is-selected" : ""}`}
                  key={site.id}
                  onClick={() => handleSiteSelect(site.id)}
                  aria-pressed={selected}
                  style={{ "--site-color": site.color } as React.CSSProperties}
                >
                  <span className="site-card-index">{site.arrayLabel.padStart(2, "0")}</span>
                  <span className="site-card-title">
                    <strong>{site.name}</strong>
                    {site.id === 5 && <span className="site-card-status">可调度阵列</span>}
                    <small>site_id {site.id} · {site.capacityKw.toLocaleString()} kW</small>
                  </span>
                  <span className="site-card-power"><strong>{formatPower(value)}</strong><small>kW</small></span>
                  <span className="mini-meter" aria-label={siteUtilization === null ? "容量利用率不可用" : `容量利用率 ${siteUtilization.toFixed(1)}%`}>
                    <i style={{ width: `${Math.max(0, Math.min(100, siteUtilization ?? 0))}%` }} />
                  </span>
                  <span className="site-card-meta"><span>容量利用率 <b>{siteUtilization === null ? "—" : `${siteUtilization.toFixed(1)}%`}</b></span><span>实时贡献 <b>{contribution === null ? "—" : `${contribution.toFixed(1)}%`}</b></span></span>
                  {value !== null && value < 0 && <em className="data-flag">负值保留 · 可能为夜间待机或测量口径</em>}
                  {value === null && <em className="data-flag">该时间点缺失 · 未以 0 替代</em>}
                </button>
              );
            })}
          </div>
          <aside className="curtailment-note live-curtailment-note" aria-label="Desert Gardens 限发说明">
            <span className="note-mark" aria-hidden="true">*</span>
            <p>
              Desert Gardens 可接受中央电站的实时
              <a href={ARENA_CURTAILMENT_REPORT_URL} target="_blank" rel="noreferrer">限发控制</a>。
              晴朗正午的实际并网功率可能低于上午或下午，这通常反映电网负荷与稳定性约束，并不一定代表设备故障。
            </p>
          </aside>
        </section>

        <section className="section map-section" id="map" aria-labelledby="map-title">
          <div className="section-heading light">
            <div><p className="eyebrow">02 / FIELD MAP</p><h2 id="map-title">散落在 Yulara 的五块阵列</h2></div>
            <p>点击地图标记或上方功率卡片，地图、站点详情与历史曲线会同步聚焦。</p>
          </div>
          <div className="map-layout">
            <SiteMap sites={sites} selectedSiteId={selectedSiteId} onSelect={handleSiteSelect} />
            <aside className="site-detail" aria-live="polite">
              {(() => {
                const site = siteById.get(selectedSiteId)!;
                return (
                  <>
                    <p>SELECTED ARRAY · {site.arrayLabel}</p>
                    <h3>{site.name}</h3>
                    <div className="detail-power"><span>最新功率</span><strong>{formatPower(latest.values.get(site.id)?.powerKw)} <small>kW</small></strong></div>
                    <dl>
                      <div><dt>site_id</dt><dd>{site.id}</dd></div>
                      <div><dt>装机容量</dt><dd>{site.capacityKw.toLocaleString()} kW</dd></div>
                      <div><dt>坐标 · WGS84</dt><dd>{site.latitude}, {site.longitude}</dd></div>
                      <div><dt>组件技术</dt><dd>{site.technology}</dd></div>
                      <div><dt>阵列结构</dt><dd>{site.structure}</dd></div>
                      <div><dt>倾角 / 方位角</dt><dd>{site.tiltDeg}° / {site.azimuthDeg}°</dd></div>
                      <div><dt>安装年份</dt><dd>{site.installedYear}</dd></div>
                    </dl>
                    <p className="map-note"><MapPinned size={15} /> 坐标用于项目级定位，不代表设备级测量点。</p>
                  </>
                );
              })()}
            </aside>
          </div>
        </section>

        <section className="section history-section" id="history" aria-labelledby="history-title">
          <div className="section-heading">
            <div><p className="eyebrow">03 / TIME SERIES</p><h2 id="history-title">历史功率回看</h2></div>
            <p>原始五分钟平均功率 · Australia/Darwin · 最长单次 30 天</p>
          </div>
          <div className="history-controls">
            <div className="quick-ranges" aria-label="快捷日期范围">
              <button type="button" onClick={() => chooseQuickRange(1)}>今天</button>
              <button type="button" onClick={() => chooseQuickRange(7)}>最近 7 天</button>
              <button type="button" onClick={() => chooseQuickRange(30)}>最近 30 天</button>
            </div>
            <div className="date-fields">
              <label>开始日期<input type="date" value={startDate} max={today} onChange={(event) => setStartDate(event.target.value)} /></label>
              <label>结束日期<input type="date" value={endDate} max={today} onChange={(event) => setEndDate(event.target.value)} /></label>
              <button className="button button-dark" type="button" onClick={() => void loadHistory(startDate, endDate)}>读取真实数据</button>
            </div>
          </div>
          {rangeError && <p className="form-error" role="alert">{rangeError}</p>}
          {!!history?.partialFailures.length && (
            <p className="form-error" role="status">部分日期分段读取失败；曲线仅显示已成功返回的真实数据。</p>
          )}
          <fieldset className="site-filter">
            <legend>曲线站点（至少保留一个）</legend>
            {sites.map((site) => (
              <label key={site.id} style={{ "--site-color": site.color } as React.CSSProperties}>
                <input type="checkbox" checked={selectedHistorySites.has(site.id)} onChange={() => toggleHistorySite(site.id)} />
                <span>{site.name}</span>
              </label>
            ))}
          </fieldset>
          <div className="chart-panel">
            <div className="chart-toolbar">
              <span>{historyState === "loading" ? "正在分段读取公开接口…" : `${startDate} — ${endDate}`}</span>
              <button className="text-button" type="button" onClick={downloadCsv} disabled={!history?.points.length}><ArrowDownToLine size={15} /> 下载真实数据 CSV</button>
            </div>
            {historyState === "error" ? (
              <div className="chart-empty" role="alert"><strong>历史数据暂时无法读取</strong><span>已保留当前页面上的最后一次实时数据；请缩短范围后重试。</span></div>
            ) : (
              <HistoryChart
                sites={sites}
                points={history?.points ?? []}
                selectedSiteIds={selectedHistorySites}
                focusedSiteId={selectedSiteId}
                highlightedRange={agentHighlight}
              />
            )}
          </div>
          <aside className="curtailment-note history-curtailment-note" aria-label="Desert Gardens 历史曲线解读">
            <CircleAlert size={17} aria-hidden="true" />
            <p>
              <strong>曲线解读：</strong>Desert Gardens 的双峰或正午谷值可能来自电网限发；曲线表示实际输出，不表示理论可发功率。
              该形态与已确认的限发机制高度一致，但若要确认某一个五分钟点的具体限发量，仍需 SCADA 功率设定值、现场辐照度和逆变器可用功率。
            </p>
          </aside>
          <div className="quality-grid">
            <article><span>数据完整率</span><strong>{history ? `${quality.completeness.toFixed(1)}%` : "—"}</strong><small>{quality.available.toLocaleString()} / {quality.expected.toLocaleString()} 个预期站点时点有值</small></article>
            <article><span>缺失值</span><strong>{history ? quality.nullCount.toLocaleString() : "—"}</strong><small>保留为空，不以 0 替代</small></article>
            <article><span>负功率值</span><strong>{history ? quality.negativeCount.toLocaleString() : "—"}</strong><small>保留原始语义，并在分析时单独识别</small></article>
            <article><span>今日累计发电量</span><strong>{todaysEnergy === null ? "数据不足" : `${(todaysEnergy / 1000).toFixed(2)} MWh`}</strong><small>派生指标：五分钟平均功率 × 5/60 小时，仅完整率 ≥ 80% 时展示</small></article>
          </div>
        </section>

        <section className="section sources-section" id="sources" aria-labelledby="sources-title">
          <div className="section-heading light">
            <div><p className="eyebrow">04 / PROVENANCE</p><h2 id="sources-title">数据从哪里来，页面做了什么</h2></div>
            <a className="source-link" href="https://dkasolarcentre.com.au/locations/yulara/" target="_blank" rel="noreferrer">前往官方项目页 <ArrowUpRight size={16} /></a>
          </div>
          <div className="source-cards">
            <article><Database size={22} /><p>RAW OBSERVATION</p><h3>五分钟功率观测</h3><p>主接口读取 OCI 上的只读 DKA Solar Centre 归档；OCI 不可用时才降级到 Solar Centre 官方公开接口。原始时间按 Australia/Darwin 解释，单位为 kW。</p><dl><div><dt>当前查询覆盖</dt><dd>{startDate} — {endDate}</dd></div><div><dt>当前功率来源</dt><dd>{!power ? "正在连接 OCI" : power.source === "oci-api" ? "OCI 只读 REST API" : "Solar Centre 公开源（降级）"}</dd></div><div><dt>站点元数据</dt><dd>{!siteCatalog ? "正在连接 OCI /sites" : siteCatalog.source === "oci-api" ? "OCI /sites" : "已验证的静态公开元数据（降级）"}</dd></div></dl></article>
            <article><Gauge size={22} /><p>DERIVED METRICS</p><h3>页面计算指标</h3><p>总功率、容量利用率、站点贡献、数据新鲜度、完整率和满足阈值时的今日发电量，均由浏览器基于真实功率序列计算，不是官方结算口径。</p><dl><div><dt>空值处理</dt><dd>保留缺失，不用 0 填充</dd></div><div><dt>负值处理</dt><dd>保留并明确标注</dd></div></dl></article>
            <article><Satellite size={22} /><p>MODEL WEATHER</p><h3>附近网格模型天气</h3><p>气温、湿度、10 m 风、GHI、日出与日落来自 Open‑Meteo 的附近网格模型。五站位置接近，因此共享同一网格结果。</p><dl><div><dt>重要说明</dt><dd>并非五个站点各自的现场传感器实测值</dd></div><div><dt>天气观测时刻</dt><dd>{weather?.observedAt ? `${dateTimeDarwin.format(new Date(weather.observedAt))} ACST` : "暂不可用"}</dd></div></dl></article>
          </div>
          <aside className="curtailment-brief" aria-labelledby="curtailment-title">
            <div className="curtailment-brief-heading">
              <p>OPERATIONAL CONTEXT</p>
              <h3 id="curtailment-title">限发机制 <span>/ Curtailment</span></h3>
            </div>
            <div className="curtailment-brief-copy">
              <p>Desert Gardens 是 Yulara 系统中容量最大的光伏阵列，同时也是主要的可调度阵列。ARENA 项目报告指出，该阵列会根据当地电力负荷响应中央电站的实时限发指令，以维持远端小型电网的稳定。因此，公开数据展示的是<strong>实际并网功率</strong>，并不等同于当时太阳资源能够产生的<strong>理论可用功率</strong>。</p>
              <p className="curtailment-caveat">公开曲线可以支持机制层面的解释，但不能单独证明某一个五分钟时点的具体限发量。</p>
            </div>
            <div className="curtailment-brief-evidence">
              <dl>
                <div><dt>年度弃光估算</dt><dd>约 28%</dd></div>
                <div><dt>较高限发案例</dt><dd>约 800 kW</dd></div>
              </dl>
              <a href={ARENA_CURTAILMENT_REPORT_URL} target="_blank" rel="noreferrer">ARENA 官方报告 <ArrowUpRight size={14} /></a>
              <a href={DESERT_GARDENS_SOURCE_URL} target="_blank" rel="noreferrer">DKA 站点资料 <ArrowUpRight size={14} /></a>
            </div>
          </aside>
          <div className="method-flow" aria-label="项目数据处理流程">
            {["采集", "校验与保留原值", "按站点与时间归档", "交互展示与派生计算"].map((label, index) => (
              <div key={label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>{index < 3 && <i aria-hidden="true" />}</div>
            ))}
          </div>
          <div className="disclaimer">
            <CircleAlert size={20} />
            <p><strong>独立技术项目声明</strong> 本站不是 DKA Solar Centre 官方网站。内容仅用于项目展示、数据研究与技术实验，不应用于运行控制、财务结算或安全关键决策。</p>
          </div>
        </section>

        <section className="section support-section" id="support" aria-labelledby="support-title">
          <div className="support-copy">
            <p className="eyebrow">05 / SUPPORT THE WORK</p>
            <h2 id="support-title">支持这个开放的能源数据项目</h2>
            <p>
              Red Earth Lab 持续整理真实能源数据、可复现分析与 AI Agent 实验。
              你可以通过 PayPal 提供数字项目支持，用于网站维护、数据归档和后续公开实验。
            </p>
            <ul>
              <li>数字项目支持，无实物商品或物流配送</li>
              <li>支持金额可在 PayPal 页面自行填写</li>
              <li>付款与账户信息由 PayPal 安全处理，本站不采集银行卡资料</li>
            </ul>
          </div>
          <aside className="support-card" aria-label="PayPal 项目支持入口">
            <HeartHandshake size={28} aria-hidden="true" />
            <p>DIGITAL PROJECT SUPPORT</p>
            <h3>通过 PayPal 支持</h3>
            <p>打开 StorywithLove 的 PayPal.Me 页面，确认收款方与金额后完成付款。</p>
            <a
              className="button support-button"
              href={PAYPAL_SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
            >
              前往 PayPal 安全支付 <ArrowUpRight size={16} />
            </a>
            <small>收款页面：paypal.com/paypalme/storywithlove</small>
          </aside>
        </section>

        <section className="section roadmap-section" id="roadmap" aria-labelledby="roadmap-title">
          <div className="section-heading">
            <div><p className="eyebrow">06 / PROJECT LIBRARY</p><h2 id="roadmap-title">从一座电站，走向一组可复用的能源数据系统</h2></div>
            <a className="button button-ghost" href="https://github.com/StorywithLove/storywithlove.github.io" target="_blank" rel="noreferrer"><Github size={16} /> 查看公开网站代码</a>
          </div>
          <div className="roadmap-grid">
            <article className="is-current"><span>NOW · 001</span><h3>澳大利亚 Yulara</h3><p>真实功率采集、站点地图、模型天气、历史回看与数据质量。</p><b><CheckCircle2 size={16} /> 第一版运行中</b></article>
            <article><span>NEXT · 002</span><h3>欧洲光伏项目</h3><p>沿用同一项目档案结构，扩展国家、区域与站点层级。</p><b>规划中</b></article>
            <article><span>MODEL · 003</span><h3>光伏功率预测</h3><p>天气融合、基线模型、误差诊断与可复现实验记录。</p><b>规划中</b></article>
            <article><span>AGENT · 004</span><h3>AI Agent 工作流</h3><p>数据质量巡检、异常候选、站点对比与受控的能源数据协作流程。</p><b><CheckCircle2 size={16} /> 第一版已接入</b></article>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div><span className="brand-mark" aria-hidden="true">RE</span><p><strong>RED EARTH LAB</strong><br />长期维护的能源与 AI 项目库</p></div>
        <div><p>POWER · OCI read-only API / DKA Solar Centre fallback</p><p>WEATHER · Open‑Meteo model grid</p><p>MAP · OpenStreetMap / Esri imagery</p></div>
        <div><p>站点时间 · Australia/Darwin (ACST, UTC+09:30)</p><p>浏览器公开请求 · {powerApiHostnames().join(" · ")} · api.open-meteo.com</p><p>页面最后获取 · {power?.fetchedAt ? dateTimeDarwin.format(new Date(power.fetchedAt)) : "尚未成功"}</p></div>
      </footer>
      <Suspense fallback={null}>
        <AgentPanel context={agentContext} onAction={handleAgentAction} />
      </Suspense>
    </div>
  );
}

export default App;
