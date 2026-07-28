import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Bot,
  ChartNoAxesCombined,
  CircleAlert,
  DatabaseZap,
  RotateCcw,
  Send,
  Sparkles,
  SunMedium,
  X,
} from "lucide-react";
import {
  checkDataQuality,
  compareSites,
  detectPowerAnomalies,
  forecastUnavailable,
  getDailySummary,
  getWeatherContext,
  runLocalAgent,
} from "../agent/analysis";
import { agentApiConfigured, askRemoteAgent } from "../agent/apiClient";
import type {
  AgentAction,
  AgentContext,
  AgentResponse,
} from "../agent/types";

interface AgentPanelProps {
  context: AgentContext;
  onAction: (action: AgentAction) => void;
}

interface ConversationMessage {
  id: string;
  role: "user" | "agent";
  text?: string;
  response?: AgentResponse;
}

const quickActions = [
  { label: "总结当前数据", icon: ChartNoAxesCombined, run: getDailySummary },
  { label: "检查数据质量", icon: DatabaseZap, run: checkDataQuality },
  { label: "分析异常功率", icon: CircleAlert, run: detectPowerAnomalies },
  { label: "对比站点表现", icon: BarChart3, run: compareSites },
  { label: "分析天气影响", icon: SunMedium, run: getWeatherContext },
] as const;

const welcome: ConversationMessage = {
  id: "welcome",
  role: "agent",
  text: "我只分析页面已加载的真实数据。先选择一个快捷分析，或直接提出问题。",
};

function StructuredAnswer({
  response,
  onAction,
}: {
  response: AgentResponse;
  onAction: (action: AgentAction) => void;
}) {
  return (
    <div className="agent-answer">
      <p className="agent-summary">{response.summary}</p>
      {!!response.evidence.length && (
        <div className="agent-evidence" aria-label="数据证据">
          {response.evidence.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.source}</small>
            </div>
          ))}
        </div>
      )}
      {!!response.findings.length && (
        <section className="agent-answer-section">
          <h4>分析发现</h4>
          {response.findings.map((finding, index) => (
            <article className={`agent-finding severity-${finding.severity}`} key={`${finding.type}-${index}`}>
              <span>{finding.severity.toUpperCase()}</span>
              <p>{finding.description}</p>
            </article>
          ))}
        </section>
      )}
      {!!response.inferences.length && (
        <section className="agent-answer-section">
          <h4>推断与边界</h4>
          {response.inferences.map((inference, index) => (
            <p className="agent-inference" key={`${inference.statement}-${index}`}>
              <strong>{inference.statement}</strong>
              <span>{inference.reason} · 置信度 {inference.confidence}</span>
            </p>
          ))}
        </section>
      )}
      {!!response.unknowns.length && (
        <section className="agent-answer-section agent-unknowns">
          <h4>仍未知</h4>
          <ul>
            {response.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}
          </ul>
        </section>
      )}
      {!!response.actions.length && (
        <div className="agent-response-actions">
          {response.actions.map((action, index) => (
            <button type="button" key={`${action.type}-${index}`} onClick={() => onAction(action)}>
              {action.label}<ArrowRight size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentPanel({ context, onAction }: AgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([welcome]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const titleId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  const appendAnalysis = (label: string, response: AgentResponse) => {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: label },
      { id: crypto.randomUUID(), role: "agent", response },
    ]);
  };

  const runQuickAction = (
    label: string,
    run: (value: AgentContext) => AgentResponse,
  ) => {
    appendAnalysis(label, run(context));
  };

  const sendMessage = async () => {
    const message = input.trim().slice(0, 500);
    if (!message || loading) return;
    setInput("");
    setLoading(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: message },
    ]);
    try {
      const response = agentApiConfigured()
        ? await askRemoteAgent(message, context)
        : runLocalAgent(message, context);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", response },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: "分析服务暂时不可用。原页面的数据、图表和下载功能不受影响，请稍后重试。",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const resetConversation = () => {
    setMessages([welcome]);
    setInput("");
  };

  return (
    <>
      <button
        className="agent-launcher"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="energy-agent-panel"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={18} />
        <span>分析助手</span>
      </button>
      {open && <button className="agent-backdrop" type="button" aria-label="关闭分析助手" onClick={() => setOpen(false)} />}
      <aside
        id="energy-agent-panel"
        className={open ? "agent-panel is-open" : "agent-panel"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
      >
        <header className="agent-panel-header">
          <div>
            <span className="agent-kicker"><Bot size={14} /> RED EARTH AGENT</span>
            <h2 id={titleId}>光伏数据分析助手</h2>
          </div>
          <div className="agent-header-actions">
            <button type="button" aria-label="清空当前会话" onClick={resetConversation}><RotateCcw size={17} /></button>
            <button type="button" aria-label="关闭分析助手" onClick={() => setOpen(false)}><X size={20} /></button>
          </div>
        </header>

        <div className="agent-context">
          <span>当前上下文</span>
          <strong>{context.site_name}</strong>
          <small>{context.start_time} — {context.end_time} · ACST</small>
          <small>历史功率 · {context.selected_site_ids.length} 个站点 · {context.data_source}</small>
        </div>

        <div className="agent-quick-actions" aria-label="快捷分析">
          {quickActions.map(({ label, icon: Icon, run }) => (
            <button type="button" key={label} onClick={() => runQuickAction(label, run)}>
              <Icon size={15} />{label}
            </button>
          ))}
          <button
            type="button"
            className="is-disabled"
            onClick={() => appendAnalysis("评估预测表现", forecastUnavailable())}
            title="预测结果尚未接入"
          >
            <ChartNoAxesCombined size={15} />评估预测表现<small>未接入</small>
          </button>
        </div>

        <div className="agent-messages" ref={listRef} aria-live="polite">
          {messages.map((message) => (
            <div className={`agent-message is-${message.role}`} key={message.id}>
              {message.text && <p>{message.text}</p>}
              {message.response && <StructuredAnswer response={message.response} onAction={onAction} />}
            </div>
          ))}
          {loading && (
            <div className="agent-message is-agent agent-loading" role="status">
              <span /><span /><span /> 正在调用受控分析服务…
            </div>
          )}
        </div>

        <form
          className="agent-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <label htmlFor="agent-question">询问当前数据</label>
          <textarea
            id="agent-question"
            value={input}
            maxLength={500}
            rows={2}
            placeholder={agentApiConfigured() ? "例如：为什么最近出现功率下降？" : "可询问质量、异常、站点对比或天气"}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <div>
            <small>{agentApiConfigured() ? "服务端 Agent 已配置" : "确定性本地分析 · 未配置模型服务"} · {input.length}/500</small>
            <button type="submit" disabled={!input.trim() || loading} aria-label="发送问题">
              <Send size={16} />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
