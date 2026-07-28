# Red Earth Lab · 能源与 AI 项目库

这是一个长期维护的个人项目实验室与项目档案馆，而不是传统简历网站。第一版完整展示澳大利亚 Yulara Solar System：五个分布式光伏子系统的真实五分钟功率、站点地图、附近网格模型天气、历史曲线与数据质量说明。

网站发布于 [https://storywithlove.github.io/](https://storywithlove.github.io/)，源码仓库为公开仓库。前端不保存秘密，也不直接连接数据库。

## 第一版能力

- 以 OCI 只读 HTTPS API 为主接口，读取五站归档功率、站点元数据和系统状态
- OCI 请求失败时自动降级到 DKA Solar Centre 官方公开功率接口，并在页面明确标注
- 每五分钟自动刷新，支持手动刷新、失败超时、有限重试和上次成功数据缓存
- 显示总功率、装机容量、容量利用率、站点贡献、观测时间、获取时间和数据新鲜度
- 保留负值和空值的真实语义，不用零替代缺失值
- OpenStreetMap 普通地图与 Esri World Imagery 卫星影像切换
- 地图标记、功率卡片和历史曲线联动
- Open‑Meteo 附近网格模型天气：气温、湿度、10 m 风、GHI、日出、日落与昼夜
- 最长单次 30 天历史查询；OCI 单次读取，降级公共源在适配层内自动拆成最多三天的分段请求
- 多站曲线、时间缩放、数据点提示和真实数据 CSV 下载
- 数据完整率、缺失点、负值和条件式今日发电量派生指标
- 延迟加载的光伏数据分析助手：页面上下文、确定性质量诊断、异常候选、站点对比与结构化证据
- OCI 服务端 Agent API：确定性分析加 DeepSeek 解释，浏览器不保存模型密钥
- 响应式布局、触摸与键盘操作、清晰焦点样式和减少动态效果支持

没有使用 Demo 功率或 Demo 天气。接口失败时页面显示明确的不可用或缓存状态，不会伪造数据。

## 数据来源与口径

### 原始功率观测

功率原始来源是 [DKA Solar Centre 的 Yulara 项目](https://dkasolarcentre.com.au/locations/yulara/)。浏览器默认通过版本化 OCI 只读 REST API 读取归档数据；该 API 不可用时才请求 Solar Centre 官方公开功率接口。时间序列粒度为五分钟，功率单位为 `kW`。站点日历按 `Australia/Darwin` 解释，API 时间使用 RFC 3339 / ISO 8601，页面也可切换查看 UTC。

数据可能存在延迟、缺失值、负值、异常值、跨域失败或临时不可用。页面保留空值和负值，不把空值改成零。OCI 历史接口支持最多 31 天，页面主动限制为 30 天；降级到 Solar Centre 时按最多三天拆分，并以最多三个并发请求合并、排序和去重。任何降级或部分失败都会被明确标注。

### Desert Gardens 限发口径

Desert Gardens（`site_id 5`，1058.4 kW）是 Yulara 最大且主要可调度的光伏阵列。[ARENA 官方项目报告](https://www.arena.gov.au/assets/2018/12/the-power-of-far-flung-arrays-yularas-dispersed-design-to-reduce-system-variability.pdf)说明，该阵列会按当地负荷响应中央电站实时限发（curtailment）信号，以维护小型远端电网稳定。页面曲线展示的是实际并网功率，不是理论可用功率；双峰或正午谷值与该机制高度一致，但不能仅凭公开曲线确定某一个五分钟点的具体限发量。单点归因仍需要 SCADA 功率设定值、现场辐照度与逆变器可用功率。

### 附近网格模型天气

天气来自 [Open‑Meteo Forecast API](https://open-meteo.com/en/docs)。它是 Yulara 附近网格的天气模型结果，不是五个光伏站点各自现场传感器的实测值。由于站点相距很近，第一版共享一个附近网格，不制造虚假的站点级天气差异。

### 页面派生指标

以下指标由浏览器基于真实功率序列计算：

- 总功率与总体容量利用率
- 各站容量利用率和实时贡献
- 数据新鲜度、缺失数、负值数和查询范围完整率
- 今日累计发电量：五分钟平均功率乘以 `5/60` 小时后求和；仅当今天查询完整率不低于 80% 时显示精确值

这些指标用于研究和项目展示，不是官方运行、结算或财务口径。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

终端会显示本地预览地址。浏览器必须能访问文末列出的公开域名，实时数据、地图和天气才会完整显示。

## 构建与验证

```bash
npm run build
npm test
npm run api:check
npm run security:check
```

生产产物写入 `dist/`。Vite 的 `base` 为 `/`，适用于个人主页仓库根路径。

## GitHub Pages 发布

`.github/workflows/deploy-pages.yml` 已配置官方 GitHub Pages Actions：

1. 从 `main` 分支检出代码；
2. 使用 Node.js 22 和 `npm ci` 安装锁定依赖；
3. 执行生产构建；
4. 上传 `dist/`；
5. 使用 GitHub Pages 的短期身份权限部署。

工作流不读取自定义 Secrets，不输出环境变量，并使用最小必要权限。正式发布前，需要在仓库 Pages 设置中确认 Source 为 GitHub Actions，并由仓库所有者确认后再推送或手动运行工作流。

## 目录结构

```text
src/
  agent/            Agent 上下文、白名单分析工具与可选服务端 API 客户端
  components/       地图与历史曲线组件
  data/             可公开站点元数据
  services/         功率与天气数据适配器、超时和重试
  App.tsx            页面信息架构与交互状态
  styles.css         视觉系统和响应式布局
docs/
  agent-api-contract.md  可选服务端 Agent 接口与安全边界
  oci-api-contract.md 未来只读 API 契约
scripts/
  security-check.mjs 公开仓库安全扫描
tests/               生产构建检查
.github/workflows/   GitHub Pages 工作流
```

新增其他国家或能源项目时，应增加项目配置和数据适配器，不需要重写整页结构。

## 环境配置

默认无需 `.env`。`.env.example` 只列出浏览器必须知道的公开 API 地址。所有 `VITE_*` 值都会进入浏览器产物，因此禁止放入数据库密码、私密 API Key、Token、云凭据或任何其他秘密。

当前浏览器会访问：

- `api.xn--fhq9f80kj05g.com`：OCI 版本化只读站点、实时功率、历史功率和状态 JSON
- `solarcentre.spinifexvalley.com.au`：仅在 OCI 功率请求失败时使用的公开降级来源
- `api.open-meteo.com`：公开天气模型 JSON
- `tile.openstreetmap.org`：普通地图图块
- `server.arcgisonline.com`：Esri World Imagery 图块

浏览器会向 `VITE_PUBLIC_AGENT_API_BASE` 指向的 OCI HTTPS Agent 网关发送
站点、时间范围和指标上下文。这个地址不是模型服务本身，浏览器不携带模型
API Key；Provider 凭据由 OCI 服务端保存。

官方项目页和来源说明链接还会指向 `dkasolarcentre.com.au`、`open-meteo.com`、`openstreetmap.org` 和 `github.com`，但只有用户点击链接时才会导航。

这些公开地址必须出现在浏览器中才能发起 HTTPS 请求；地址本身不是凭据。任何私密数据库或后端身份都不得进入前端。

## 隐私与安全原则

- GitHub Pages 仅消费公开 HTTPS API，从不直接连接 PostgreSQL
- 不提交 `.env`、连接字符串、密码、私钥、SSH 配置、Token 或云管理信息
- `localStorage` 只缓存公开功率和天气响应，用于网络失败时保留上次成功数据
- 错误界面只提供用户可理解的状态，不显示内部异常堆栈
- CSV 只能导出本次从真实功率接口读取的数据
- 地图图层不需要前端私密 Key，并保留必要版权署名
- 本地分析只执行代码中注册的确定性工具，不执行用户提供的 SQL、Shell、Python 或 JavaScript
- 自由问答发送到 OCI Agent API；接口失败不会阻塞现有数据页面

## OCI 只读 API

正式架构已经接入：GitHub Pages 通过 HTTPS 调用版本化只读 REST API，由服务端在内部访问归档数据。浏览器会使用以下公开端点：

- `GET /api/v1/sites`
- `GET /api/v1/power/latest`
- `GET /api/v1/power/history`
- `GET /api/v1/status`

前端只依赖公开响应字段，不依赖数据库表名、服务器内部路径或部署方式。接口字段和降级逻辑见 [OCI API 契约](docs/oci-api-contract.md)。

## 光伏数据分析助手

页面右下角的分析助手会自动携带当前站点、所选日期、时区、指标、数据源和已加载
功率序列。质量诊断、运行摘要、异常候选和站点对比由确定性工具计算，输出明确区分
数据证据、分析发现、推断和未知因素。天气目前只有实时附近网格快照，因此不会伪造
历史相关性；预测结果尚未接入，也不会生成虚构评估。

自然语言解释已经通过 [Agent API 契约](docs/agent-api-contract.md) 接入 OCI。
模型 Provider、白名单工具执行和安全校验均留在服务端。

## 免责声明

本站是独立技术项目，不是 DKA Solar Centre 官方网站。数据和计算仅用于项目展示、研究与技术实验，不应用于运行控制、财务结算或安全关键决策。
