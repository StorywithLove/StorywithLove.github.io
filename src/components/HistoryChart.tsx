import { useMemo } from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PowerPoint, SiteId, SolarSite } from "../types";

interface HistoryChartProps {
  sites: SolarSite[];
  points: PowerPoint[];
  selectedSiteIds: Set<SiteId>;
  focusedSiteId: SiteId;
  highlightedRange?: { start: string; end: string } | null;
}

interface ChartRow {
  observedAt: string;
  label: string;
  [siteId: string]: string | number | null;
}

const axisTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Australia/Darwin",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const tooltipTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Australia/Darwin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function HistoryChart({
  sites,
  points,
  selectedSiteIds,
  focusedSiteId,
  highlightedRange,
}: HistoryChartProps) {
  const data = useMemo(() => {
    const rows = new Map<string, ChartRow>();
    for (const point of points) {
      if (!selectedSiteIds.has(point.siteId)) continue;
      const row = rows.get(point.observedAt) ?? {
        observedAt: point.observedAt,
        label: axisTime.format(new Date(point.observedAt)),
      };
      row[String(point.siteId)] = point.powerKw;
      rows.set(point.observedAt, row);
    }
    const allRows = [...rows.values()].sort((a, b) =>
      a.observedAt.localeCompare(b.observedAt),
    );
    const stride = Math.max(1, Math.ceil(allRows.length / 1400));
    return allRows.filter((_, index) => index % stride === 0 || index === allRows.length - 1);
  }, [points, selectedSiteIds]);

  if (data.length === 0) {
    return (
      <div className="chart-empty" role="status">
        <strong>当前范围暂无可绘制数据</strong>
        <span>请缩短日期范围、重新读取，或检查所选站点。</span>
      </div>
    );
  }

  return (
    <div className="chart-wrap" aria-label="各站点五分钟平均功率历史曲线">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 14, left: 2, bottom: 8 }}>
          <CartesianGrid stroke="#d8cdbb" strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="label"
            minTickGap={48}
            tick={{ fill: "#625d54", fontSize: 11 }}
            axisLine={{ stroke: "#b8ad9b" }}
            tickLine={false}
          />
          <YAxis
            width={56}
            tick={{ fill: "#625d54", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            unit=" kW"
          />
          <Tooltip
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.observedAt
                ? `${tooltipTime.format(new Date(payload[0].payload.observedAt))} ACST`
                : ""
            }
            formatter={(value, name) => [
              value === null || value === undefined ? "缺失" : `${Number(value).toFixed(1)} kW`,
              sites.find((site) => String(site.id) === String(name))?.name ?? String(name),
            ]}
            contentStyle={{ border: "1px solid #9c8d79", borderRadius: 0, background: "#f4eee3" }}
          />
          <Legend
            formatter={(value) => sites.find((site) => String(site.id) === value)?.name ?? value}
          />
          {highlightedRange && (
            <ReferenceArea
              x1={axisTime.format(new Date(highlightedRange.start))}
              x2={axisTime.format(new Date(highlightedRange.end))}
              fill="#c45738"
              fillOpacity={0.16}
              stroke="#c45738"
              strokeOpacity={0.8}
              label={{ value: "Agent 候选区间", fill: "#742e1f", fontSize: 10 }}
            />
          )}
          {sites.filter((site) => selectedSiteIds.has(site.id)).map((site) => (
            <Line
              key={site.id}
              type="monotone"
              dataKey={String(site.id)}
              stroke={site.color}
              strokeWidth={site.id === focusedSiteId ? 2.8 : 1.6}
              strokeOpacity={site.id === focusedSiteId || selectedSiteIds.size === 1 ? 1 : 0.66}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 1 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          <Brush
            dataKey="label"
            height={28}
            stroke="#817462"
            fill="#e7ddcd"
            travellerWidth={9}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
