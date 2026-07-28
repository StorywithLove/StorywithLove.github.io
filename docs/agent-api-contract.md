# 光伏数据 Agent API 契约

当前仓库是 GitHub Pages 静态前端，不包含模型凭据或数据库身份。页面内置的
确定性分析可以独立运行；自然语言模型解释通过部署在 OCI 的 HTTPS API 完成。

## 前端调用

配置公开网关地址：

```text
VITE_PUBLIC_AGENT_API_BASE=https://api.xn--fhq9f80kj05g.com/api/v1/agent
```

页面调用：

```http
POST /api/v1/agent/query
Content-Type: application/json
Accept: application/json
```

请求体：

```json
{
  "message": "为什么这个时段功率下降？",
  "context": {
    "site_id": 5,
    "site_name": "Desert Gardens",
    "start_time": "2026-07-21",
    "end_time": "2026-07-27",
    "timezone": "Australia/Darwin",
    "page": "history",
    "selected_metric": "power_kw",
    "selected_site_ids": [5, 8, 10, 11, 3051],
    "data_source": "oci-api"
  }
}
```

`message` 最长 500 个字符。前端不发送数据库连接信息、模型密钥、任意 SQL、
Shell 命令或服务器路径。服务端应根据站点和时间范围重新查询可信数据，不应信任
浏览器提交的计算结果。

## 结构化响应

```json
{
  "tool": "remote_agent",
  "summary": "分析摘要",
  "evidence": [
    {
      "label": "数据完整率",
      "value": "98.2%",
      "source": "check_data_quality"
    }
  ],
  "findings": [
    {
      "type": "power_drop",
      "site_id": 5,
      "start_time": "2026-07-24T02:30:00Z",
      "end_time": "2026-07-24T02:35:00Z",
      "severity": "medium",
      "description": "五分钟内出现快速功率下降。"
    }
  ],
  "inferences": [
    {
      "statement": "可能与云量变化或限发有关，但尚未确认。",
      "confidence": "medium",
      "reason": "功率变化时刻与可用天气背景接近，但缺少现场辐照度。"
    }
  ],
  "unknowns": [
    "缺少 SCADA 限发设定值"
  ],
  "actions": [
    {
      "type": "highlight_time_range",
      "label": "在历史图中查看",
      "start_time": "2026-07-24T02:30:00Z",
      "end_time": "2026-07-24T02:35:00Z"
    }
  ],
  "generated_at": "2026-07-28T00:00:00Z"
}
```

字段可以扩展，但不得省略“摘要、证据、发现、推断、未知因素、可选页面动作”的
语义。无数据、范围不匹配、预测未接入或工具失败时必须明确说明，不得填充模拟结果。

## 推荐服务端分层

```text
AgentService
├─ ContextBuilder
├─ ToolRegistry
├─ ToolExecutor
├─ ModelProvider
├─ ResponseFormatter
└─ SafetyValidator
```

当前 OCI 第一版使用 DeepSeek `deepseek-v4-flash`。Provider 配置和 Key
只存在于 OCI 服务端，浏览器只知道公开 Agent API 地址。模型只解释服务端白名单
工具产生的紧凑结构化结果，不接收数据库身份，也不能获得任意代码执行能力。

建议首版白名单：

- `get_power_history`
- `get_daily_summary`
- `calculate_energy`
- `calculate_peak_metrics`
- `check_data_quality`
- `detect_power_anomalies`
- `compare_sites`
- `get_weather_context`
- `get_forecast_results`
- `evaluate_forecast`

## 安全要求

- Provider 凭据、数据库凭据和 OCI 私密配置仅存服务端环境变量。
- 对请求体、站点 ID、时间范围和工具参数做模式校验；不接受任意 SQL。
- 限制 30 天查询范围、请求频率、工具调用次数和模型上下文大小。
- 设置上游数据与模型超时；模型失败时可退回确定性工具结果。
- CORS 仅允许正式站点和明确的本地开发 Origin。
- 日志记录工具名、耗时和脱敏错误，不记录模型密钥或完整原始数据。
- Prompt Injection 不能改变工具白名单、读写权限或服务器资源权限。
- 第一版禁止 Shell、sudo、文件修改、Git、服务重启、数据库写入及任意代码执行。
