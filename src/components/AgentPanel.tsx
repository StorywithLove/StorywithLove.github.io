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
  AgentRangeError,
  compareSites,
  executeAgentRequest,
  forecastUnavailable,
  getWeatherContext,
} from "../agent/analysis";
import { fetchPowerRange } from "../services/dataAdapter";
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
  { label: "过去 7 天发了多少电？", message: "过去 7 天发了多少电？", icon: SunMedium },
  { label: "总结最近一天", message: "总结最近一天的发电情况", icon: ChartNoAxesCombined },
  { label: "检查异常", message: "检查最近一天是否有异常", icon: CircleAlert },
  { label: "检查数据质量", message: "检查最近一天的数据质量", icon: DatabaseZap },
] as const;

const welcome: ConversationMessage = {
  id: "welcome",
  role: "agent",
  text: "我只分析当前选中的站点。可以查询 1—30 天的累计发电量、发电概览、简单异常候选和数据质量。",
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

  const appendAuxiliary = (label: string, response: AgentResponse) => {
    if (loading) return;
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: label },
      { id: crypto.randomUUID(), role: "agent", response },
    ]);
  };

  const sendMessage = async (rawMessage = input) => {
    const message = rawMessage.trim().slice(0, 500);
    if (!message || loading) return;
    setInput("");
    setLoading(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: message },
    ]);
    try {
      const response = await executeAgentRequest(message, context, fetchPowerRange);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "agent", response },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: error instanceof AgentRangeError
            ? error.message
            : "历史数据暂时无法读取，分析未完成。原页面的数据、图表和下载功能不受影响，请稍后重试。",
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
          <small>默认范围：累计发电量 7 天 · 其余分析 1 天</small>
          <small>单站点历史功率 · Australia/Darwin · {context.data_source}</small>
        </div>

        <div className="agent-quick-actions" aria-label="快捷分析">
          {quickActions.map(({ label, message, icon: Icon }) => (
            <button type="button" key={label} disabled={loading} onClick={() => void sendMessage(message)}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>

        <details className="agent-auxiliary-actions">
          <summary>保留的辅助功能</summary>
          <div>
            <button type="button" disabled={loading} onClick={() => appendAuxiliary("对比页面所选站点", compareSites(context))}>
              <BarChart3 size={14} />站点对比
            </button>
            <button type="button" disabled={loading} onClick={() => appendAuxiliary("查看附近天气", getWeatherContext(context))}>
              <SunMedium size={14} />天气快照
            </button>
            <button type="button" disabled={loading} onClick={() => appendAuxiliary("评估预测表现", forecastUnavailable())}>
              <ChartNoAxesCombined size={14} />预测占位
            </button>
          </div>
        </details>

        <div className="agent-messages" ref={listRef} aria-live="polite">
          {messages.map((message) => (
            <div className={`agent-message is-${message.role}`} key={message.id}>
              {message.text && <p>{message.text}</p>}
              {message.response && <StructuredAnswer response={message.response} onAction={onAction} />}
            </div>
          ))}
          {loading && (
            <div className="agent-message is-agent agent-loading" role="status">
              <span /><span /><span /> 正在读取真实历史数据并计算…
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
            placeholder="例如：最近 14 天累计发电量是多少？"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <div>
            <small>确定性单站点分析 · 1—30 天 · {input.length}/500</small>
            <button type="submit" disabled={!input.trim() || loading} aria-label="发送问题">
              <Send size={16} />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
