import type { AgentContext, AgentPageContext, AgentResponse } from "./types";

const AGENT_API_ENDPOINT = (
  import.meta.env.VITE_PUBLIC_AGENT_API_BASE ||
  "https://api.xn--fhq9f80kj05g.com/api/v1/agent"
).replace(/\/$/, "");

function publicContext(context: AgentContext): AgentPageContext {
  return {
    site_id: context.site_id,
    site_name: context.site_name,
    start_time: context.start_time,
    end_time: context.end_time,
    timezone: context.timezone,
    page: context.page,
    selected_metric: context.selected_metric,
    selected_site_ids: context.selected_site_ids,
    data_source: context.data_source,
  };
}

export function agentApiConfigured(): boolean {
  return AGENT_API_ENDPOINT.length > 0;
}

export async function askRemoteAgent(
  message: string,
  context: AgentContext,
): Promise<AgentResponse> {
  if (!agentApiConfigured()) throw new Error("Agent API is not configured");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${AGENT_API_ENDPOINT}/query`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        message: message.slice(0, 500),
        context: publicContext(context),
      }),
    });
    if (!response.ok) throw new Error(`Agent API returned HTTP ${response.status}`);
    const payload = await response.json() as AgentResponse;
    if (!payload || typeof payload.summary !== "string" || !Array.isArray(payload.evidence)) {
      throw new Error("Agent API returned an invalid response");
    }
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}
