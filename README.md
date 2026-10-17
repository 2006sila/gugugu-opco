# zen-hub

把 **OpenCode Zen 免费模型**接到本机的 OpenAI / Responses / Anthropic 兼容接口上，只给自己用。

它基于 [OpenCodeProxyHub](https://github.com/JiuliNuoyi/OpenCodeProxyHub)（MIT，取值于 `7c3ea8a`）改造，协议层原样保留，运维形态按"一个人一台机"重做；同时吸收了 Go 版插件 [opencodehub](https://github.com/ki11a-Conton/opencodehub) 的三条经验：**启动不依赖网络、目录只认上游真有的模型、门禁变化要能一眼看出来**。

> 上游是第三方服务。本项目只做协议与工程实现，是否可用、是否合规由你和上游的服务条款决定，见文末"许可与免责"。

---

## 一、它现在长什么样

| 项 | 值 |
|---|---|
| 地址 | `http://127.0.0.1:8790` （控制台 `/app/`，健康 `/health`，接口 `/v1`） |
| 绑定 | `127.0.0.1`（默认只允许本机） |
| 进程 | 单进程 Node，无 Docker、无 Redis、无外部数据库 |
| 数据 | 全部在 `data/`（keys / models / settings / proxies / logs） |
| 协议 | Chat Completions、Responses、Anthropic Messages、TypeSafe System One |
| 鉴权 | 默认 API Key；控制台里可一键关闭（见"访问控制"） |
| 外观 | 夜间 / 白天两套配色，右上角一键切换并记住选择 |
| 出口 | 默认直连；`UPSTREAM_PROXY` 可切代理 |

**端口说明**：`8788` 是本机另一个软件占用的端口，本项目**默认和回退区间都不使用它**。默认 `8790`，被占用时自动试 `8791..8799`，并把实际地址打在启动横幅里。要换端口只改 `config.env` 里一行 `PROXY_PORT`。

---

## 二、快速开始

```bat
build.cmd      :: 首次：装依赖 → typecheck → 编译后端 → 构建控制台
start.cmd      :: 启动（没构建过会自动先构建）
```

启动后控制台会打印三样东西（**只打印一次，请自行保存**）：

```
Console password (generated now, stored in config.env):  <随机密码>
New API key [admin] (shown once):                       oc-xxxxxxxx...
New API key [user-default] (shown once):                oc-yyyyyyyy...
```

然后打开 <http://127.0.0.1:8790/app/>，用上面的密码进控制台；客户端用 `oc-...` 那把 Key。

### 客户端接法

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H "Authorization: Bearer oc-你的key" \
  -H "Content-Type: application/json" \
  -d '{"model":"big-pickle","messages":[{"role":"user","content":"hi"}]}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8790/v1", api_key="oc-你的key")
print(client.chat.completions.create(
    model="big-pickle",
    messages=[{"role": "user", "content": "hi"}],
).choices[0].message.content)
```

Claude 系 SDK 用 `base_url=http://127.0.0.1:8790`（走 `/v1/messages`）。

---

## 三、命令

| 命令 | 作用 |
|---|---|
| `start.cmd` / `npm start` | 启动网关 |
| `build.cmd` | 构建（后端 + 控制台），临时目录固定在 `.tmp/` |
| `doctor.cmd` / `npm run doctor` | 九项体检：运行时、配置、数据目录、管理员密码、控制台产物、端口、上游目录、**门禁探针**、本机服务 |
| `npm run compat` | 只问一件事：上游还认不认这套客户端身份 |
| `npm run ports` | 列出 8790..8799 谁被占、谁会回退、8788 为什么留着 |
| `npm run e2e` | 对运行中的网关跑 8 条端到端（四协议 + 流式 + 工具 + 鉴权） |
| `npm run smoke:auth` | 验证两个免密开关：默认 401 → 关闭 → 无 token 放行 → 复原 |
| `npm run probe:context` | 探针实测上游能吃多少上下文，结果写 `data/context-probe.json`（`--full` 做二分） |

`doctor` 与 `compat` 的退出码：`0` 正常，`1` 异常，`2` **门禁被改**（这是最需要立刻处理的一种）。

---

## 四、行为说明

### 1. 上游身份与门禁

免费层是匿名的（`Authorization: Bearer public`），上游只校验请求**像不像官方 CLI**：十个固定头 + 一个**降序**的 `ses_` 会话 id（`ms*0x1000+counter` 取反后塞进 6 字节）。方向写反就是 403 `FreeTierError`。

这套契约集中在两个文件，上游改了只需要动这里再重新构建：

- `src/utils/ids.ts` —— 会话/消息 id 编码
- `src/providers/opencodeHeaders.ts` —— 十个请求头 + UA 版本

启动时会用同一套身份发一条 `max_tokens:1` 的探针，结果写进 `/health` 的 `gate` 字段：`ok` / `blocked` / `unknown`。

### 2. 模型目录会自动对账

`data/models.json` 不是"只增不减"的清单。启动时（以及每 6 小时）拉一次上游免费列表：

- 上游有、本地没有 → 自动追加并启用；
- 本地有、上游没有 → **退休**（`enabled=false` + `retiredReason`），**不删除**，控制台可见，可手动恢复；
- 上游重新上架 → 自动恢复。

拉取失败时**什么都不改**，离线也能正常启动。

### 3. 出口

```ini
UPSTREAM_PROXY=                      # 空 = 直连
UPSTREAM_PROXY=http://127.0.0.1:7897 # 所有出站（推理 + 目录 + 探针）走这个代理
UPSTREAM_PROXY=direct                # 显式直连
```

代理池代码仍在（控制台有页面），默认没有节点，等于不启用。

### 4. 鉴权与"免密开关"

控制台「设置 → 访问控制」有两个开关，改完立即生效（不用重启）：

| 开关 | 含义 | 关掉以后 |
|---|---|---|
| 控制台免密 | 进 `/app` 是否要密码 | 打开控制台直接进入，右上角显示"控制台免密" |
| 接口免密 | `/v1` 是否校验 API Key | 客户端不用再填 `Authorization` |

默认两个都是开启（要密码、要 Key）。关闭后任何能访问 `127.0.0.1:8790` 的本机程序都能直接用，所以只建议在本机自用、且不放公网时关。

环境变量仍是冷启动的默认值（`config.env`）：`CONSOLE_AUTH=off` / `AUTH_MODE=off`；之后以控制台里的开关为准（存在 `data/settings.json`）。

命令行等价操作：`node scripts/dev-console-auth.mjs off|password`。

### 5. 启动后自动打开控制台

双击 `start.cmd`：它把服务起在独立的 **zen-hub** 窗口里，等服务把真实地址写进 `data\runtime.txt`，再由脚本自己打开浏览器 —— 所以端口回退到 8791 时打开的也是对的地址。

- 开关在控制台：**设置 → 访问与启动 → 「启动后自动打开控制台」**（下次启动生效，存 `data/settings.json`）；
- 也可以直接改 `config.env` 里的 `OPEN_CONSOLE=true|false`（**显式写了就以它为准**，压过控制台开关）；
- 直接跑 `node dist/main.js` / `npm start` 时，由服务自己拉起浏览器，同样受这个开关控制；
- 打不开浏览器不影响服务：`start.cmd` 会打印地址，服务端失败会留一条 `open_console_failed` 日志；
- 地址来源：服务监听成功后写 `data\runtime.txt`（`url` / `open` / `port` / `pid` 四行），`start.cmd` 只读它。

### 6. 上下文上限（解锁开关）

官方目录（models.dev）给免费模型标的是 **200k**，但这是"目录数字"，不是上游的推理限制 —— 实测：

| 模型 | 目录 | 实测能吃 |
|---|---|---|
| `deepseek-v4.1-flash-free` | 200,000 | **1,004,443** tokens（HTTP 200） |
| `glm-5.3-flash-free` | 200,000 | **785,516** 通过；~800k 被拒（`context_length_exceeded`） |

客户端（opencode CLI）是按目录值决定何时压缩的，所以真正的杠杆在客户端配置；网关能做的是**把实测值广播出去**。

- 控制台：**设置 → 上下文上限 → 对外宣称实测上限**（默认关闭；关闭时 `/v1/models` 不输出预算字段，与官方口径一致）；
- 开启后 `/v1/models` 每条带 `context_length` / `context_window` / `max_completion_tokens`；
- 单模型可在 `data/models.json`（或 `PUT /admin/models/:id`）用 `context`/`maxOutput` 覆盖；
- `config.env` 里 `CONTEXT_UNLOCK=true` 可设冷启动默认值。

**注意：开关只改元数据，不拦请求。** 关着也一样能发 21 万 tokens（实测 200），只是客户端会按 200k 提前压缩。超过上游真实上限（glm ≈800k）时上游自己回 400，网关原样透传。

opencode CLI 侧要让模型真的用满 1M，得在它自己的配置里覆盖 `limit`：

```jsonc
"models": {
  "deepseek-v4.1-flash-free": { "limit": { "context": 1000000, "output": 384000 } },
  "glm-5.3-flash-free":       { "limit": { "context": 786432,  "output": 131072 } }
}
```

### 7. 白天模式

右上角「白天 / 夜间」按钮切换，选择记在浏览器 localStorage（`oph_theme`），刷新不闪白。两套配色都走同一组 CSS 变量（`web/src/styles.css`），组件里没有主题分支。

---

## 五、故障排查

| 现象 | 处理 |
|---|---|
| 启动没反应 / 端口被占 | 看启动横幅里的实际端口；`npm run ports` 看占用；改 `config.env` 的 `PROXY_PORT` |
| `/health` 的 `gate.state=blocked` | 上游改了身份校验：比对官方客户端，改 `ids.ts` / `opencodeHeaders.ts` 后重新构建 |
| `upstream.state=unreachable` | 网络/代理问题：先 `npm run compat` 看具体报错 |
| `/v1/models` 里有模型一调就 4xx | 该 id 已被上游下线：`npm run doctor` 的 catalog 项会指出来，重启即自动退休 |
| 控制台 404 | `web/dist` 没构建：`build.cmd` |
| 忘记 API Key 明文 | 库里只存哈希；控制台里重新生成一把，或删掉 `data/api-keys.json` 重启（会重建两把） |
| Key 填错了也能用 / Key 不生效 | 先看 `GET /health` 的 `auth.api`：`off` 表示"接口免密"开着（设置 → 访问与启动），关掉即可恢复校验 |

---

## 六、与上游的差异（本次改造清单）

| 文件 | 改动 |
|---|---|
| `src/config/env.ts` | 绑定 127.0.0.1、端口 8790、数据目录 `./data`；新增 `AUTH_MODE` / `UPSTREAM_PROXY` / `PORT_FALLBACK` |
| `src/config/bootstrap.ts` | 新增：首启建目录、生成随机管理员密码写 `config.env` |
| `src/models/catalog.ts` | 内置清单换成线上真实 10 个；新增 `applyLiveCatalog`（退休/复活/追加）；新增实测 `CONTEXT_DEFAULTS` 与 `budgetFor()` |
| `src/routes/models.ts` | 上下文开关打开时输出 `context_length`/`context_window`/`max_completion_tokens`；关闭时保持原样 |
| `src/models/reconcile.ts` | 新增：目录对账（启动 + 每 6 小时，失败不改动） |
| `src/providers/compat.ts` | 新增：门禁探针 + URL/UA 单点 |
| `src/runtime/runtimeStatus.ts` | 新增：进程级状态，供 `/health` 与脚本读取 |
| `src/auth/apiKeys.ts` | 新增 `AUTH_MODE=off` 分支 |
| `src/routes/health.ts` | 新增 `uptimeSec` / `port` / `upstream` / `gate` / `retiredModels` |
| `src/routes/web.ts` | `/` 重定向到 `/app/` |
| `src/main.ts` | 端口回退、启动横幅、首启密钥打印、对账与探针、优雅退出 |
| `scripts/*.mjs` | 新增 `doctor` / `compat` / `port-check` / `e2e` |
| `start.cmd` `build.cmd` `doctor.cmd` | 新增 Windows 启动器 |

其余（协议转换、SSE 聚合、工具门禁、代理池、限流、控制台）**未改动**，继续沿用上游实现。

---

## 七、已知限制

- 只在 Windows + Node 24 上验证过；Linux/macOS 需要自己写启动脚本（`node dist/main.js` 即可）。
- 上游 `scripts/json-store-check.ts` 在小节 `POSIX 0600` 断言上**无法在 Windows 通过**（NTFS 下普通文件固定报 `0666`），与本项目改动无关。
- 免费层限速由上游控制，429 会原样透传（`autoRetryCount` 默认 1 次重试）。
- 本项目不保证上游长期可用；门禁变更属于"随时可能发生"的常态，用 `npm run compat` 兜。

---

## 九、文件布局（精简后）

```
zen-hub\
├─ start.cmd  build.cmd  doctor.cmd  clean.cmd     ← 双击就能用
├─ config.env                                     ← 唯一要改的配置文件（端口/密码/出口）
├─ data\                                          ← 运行期数据：api-keys.json / models.json
│                                                    model-aliases.json / settings.json / proxies.json / logs\
├─ dist\                后端编译产物（build.cmd 生成）
├─ src\                 后端源码（28 个文件）
├─ web\                 控制台源码 + web\dist 构建产物
├─ scripts\             6 个日常脚本：doctor / compat / ports / e2e / smoke-auth / dev-console-auth
│  └─ checks\           上游自带的 18 个回归脚本（一般不用手动跑）
├─ LICENSE  NOTICE  THIRD_PARTY_NOTICES.md
└─ README.md  VERIFY.md  .env.example  package.json  tsconfig.json
```

- **Docker 相关文件全部删除**（本机没有 Docker）：`Dockerfile`、`docker-compose*.yml`、`.dockerignore`、`.env.docker.example`、`.github/`、`DEPLOYMENT.md`。
- **上游 62 KB 的 `DEVELOPMENT_LOG.md` 已删除**（需要时在 git 历史里取）。
- **`.env.local` 改名为 `config.env`**：不再是隐藏文件，资源管理器里直接可见；旧安装首次启动会自动改名，并在横幅里打印一行提示。
- `.npm-cache\`（约 37 MB）和 `.tmp\`（约 6 MB）是安装/构建的临时产物，随时可删：双击 `clean.cmd` 或手动删除即可，删了不影响运行。

## 八、许可与免责

MIT，继承自 [OpenCodeProxyHub](https://github.com/JiuliNuoyi/OpenCodeProxyHub)；该上游又派生自 [opencode-free-proxy](https://github.com/bigdata2211it-web/opencode-free-proxy)。原始版权与授权见 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`。

本项目仅供个人学习与技术研究，用于理解 OpenAI/Anthropic 兼容协议、流式转换与 API 网关实现。与 OpenCode、OpenCodeProxyHub、CLIProxyAPI 及任何上游服务方**均无隶属或授权关系**。使用本项目对接第三方服务时，使用者须自行确认并遵守其服务条款与所在地法律，由此产生的一切后果由使用者承担。