import type {
  PowerPoint,
  SolarSite,
  SystemStatus,
  WeatherSnapshot,
} from "../types";

export type AgentTool =
  | "daily_summary"
  | "data_quality"
  | "power_anomalies"
  | "site_comparison"
  | "weather_context"
  | "forecast_evaluation"
  | "remote_agent";

export interface AgentPageContext {
  site_id: number;
  site_name: string;
  start_time: string;
  end_time: string;
  timezone: "Australia/Darwin";
  page: "history";
  selected_metric: "power_kw";
  selected_site_ids: number[];
  data_source: string;
}

export interface AgentContext extends AgentPageContext {
  sites: SolarSite[];
  points: PowerPoint[];
  weather: WeatherSnapshot | null;
  systemStatus: SystemStatus | null;
}

export interface AgentEvidence {
  label: string;
  value: string;
  source: string;
}

export interface AgentFinding {
  type: string;
  site_id?: number;
  start_time?: string;
  end_time?: string;
  severity: "info" | "low" | "medium" | "high";
  description: string;
}

export interface AgentInference {
  statement: string;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export interface AgentAction {
  type: "highlight_time_range" | "open_data_quality";
  label: string;
  start_time?: string;
  end_time?: string;
}

export interface AgentResponse {
  tool: AgentTool;
  summary: string;
  evidence: AgentEvidence[];
  findings: AgentFinding[];
  inferences: AgentInference[];
  unknowns: string[];
  actions: AgentAction[];
  generated_at: string;
}
