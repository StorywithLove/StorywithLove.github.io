# OCI 只读 REST API 前端契约

网站使用以下公开 HTTPS 基础地址：

```text
https://api.xn--fhq9f80kj05g.com/api/v1
```

地址为公开浏览器请求目标，不是凭据。前端不包含数据库身份、连接字符串、服务端目录或部署配置。

## 数据源优先级

1. OCI 只读 REST API：实时功率、历史归档、站点元数据和系统状态的主接口。
2. DKA Solar Centre 公开功率接口：仅在 OCI 实时或历史功率请求失败时使用。
3. 浏览器上次成功缓存：仅当两个真实功率来源都失败时用于保留最后一次成功的公开数据。

站点目录回退到代码内已验证的公开元数据。`status` 没有伪造回退值；读取失败时页面改用观测时间计算基础新鲜度。

## 通用约定

- 功率与状态接口使用 `GET`；Agent 精确路径使用 `POST`；支持浏览器 CORS `OPTIONS` 预检
- JSON / UTF-8；功率和容量单位为 `kW`
- API 时间为 RFC 3339 / ISO 8601；站点日历采用 `Australia/Darwin`（ACST，UTC+09:30）
- 历史 `start` 为包含端，`end` 为不包含端
- `null` 表示源数据缺失或不可用，不等同于零
- 负功率保留，不在客户端截断
- 页面错误信息不显示服务端响应正文、内部异常或基础设施信息

## `GET /sites`

前端使用：`site_id`、`site_name`、`capacity_kw`、`latitude`、`longitude`、`technology`、`array_structure`、`array_label`、`installed_year`、`tilt_deg`、`azimuth_deg` 和 `total_capacity_kw`。

必须返回五个预期站点；否则前端使用已经验证的静态公开元数据，以避免地图和卡片结构消失。

## `GET /power/latest`

前端使用响应级 `status`、`complete`、`checked_at`、`latest_observed_at`，以及站点级 `site_id`、`observed_at`、`power_kw` 和 `data_status`。

OCI 请求失败时才调用 Solar Centre 公开接口。降级状态显示在页面上，不会把降级响应伪装成 OCI 数据。

## `GET /power/history`

请求示例：

```text
GET /power/history?start=2026-07-01T00%3A00%3A00%2B09%3A30&end=2026-07-02T00%3A00%3A00%2B09%3A30
```

页面日期选择会被转换成 Darwin 当地零点，结束日期自动加一天并作为不包含端。前端使用 `observations` 中的 `observed_at`、`site_id` 和 `power_kw`。页面单次范围限制为 30 天，低于 API 的 31 天上限。

通用历史接口同时支持逗号分隔的 `site_ids`、当前白名单
`resolution=5m`、`fields=power_kw`，以及可选的 `limit` 和不透明
`cursor`。不传 `limit` 时保持原有完整区间响应；Agent 长区间查询在服务端使用
同一历史数据访问层自动分片，不新增按问题命名的业务端点。

OCI 历史请求失败时，适配层将同一日期范围切换到 Solar Centre，并按最多三天分段、有限并发、排序和去重。

## `GET /status`

前端使用：`status`、`checked_at`、`latest_observed_at`、`oldest_site_observed_at`、`freshness_seconds`、`reporting_site_count`、`expected_site_count`、`all_sites_reporting` 和 `latest_consistent`。

状态词：`fresh`、`delayed`、`stale`、`partial`、`degraded`、`unavailable`。这些词会映射成中文状态，同时通过文字和状态点共同表达，不只依赖颜色。

## `POST /agent/query`

Agent 接口接收最长 500 字符的问题，以及当前站点、日期范围、时区、指标和所选
站点列表。服务端把问题解析为受约束的站点、逻辑时间范围、指标和分组，通过
`query_power` 分片读取只读归档，再由 `analyze_power` 执行积分、峰值、平均值、
容量因子、完整率、缺失、负值和爬坡等确定性计算。DeepSeek Provider 只解释紧凑
分析结果。

请求路径：

```text
POST https://api.xn--fhq9f80kj05g.com/api/v1/agent/query
```

页面上下文最多30天；自然语言问题可以在服务端配置的总范围和点数上限内请求更长
区间，例如最近60天。单次历史读取仍不超过31天，由 `query_power` 自动拆分、有限
并发、重试、合并、排序和去重。站点 ID 必须属于公开的五个 Yulara 站点。响应保留
`summary`、`evidence`、`findings`、`inferences`、`unknowns` 和 `actions`
结构。模型失败时返回确定性分析，不伪造模型结果。DeepSeek Key 和数据库凭据只
存在于 OCI 服务端。

## CORS 与缓存

生产 Origin 为 `https://storywithlove.github.io`。接口允许 `GET`、Agent
精确路径的 `POST`、`OPTIONS` 和必要的标准内容请求头。前端不使用固定私密
API Key。

浏览器仅在设备本地缓存最后一次成功的公开实时功率数据。历史查询不会覆盖实时缓存，也不会导出模拟数据。

## 验证

运行：

```bash
npm run api:check
```

脚本检查四个端点、关键响应字段、生产 CORS、OPTIONS 预检和历史缺参防护。它不会打印完整响应、凭据或基础设施信息。
