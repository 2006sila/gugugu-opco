# VERIFY — 验收记录（2026-10-17，本机实跑输出）

环境：Windows / Node v24.19.0 / npm 11.17.0，工作目录为仓库根目录。

## 1. 构建

```
npm run typecheck        -> exit 0
npm run build            -> exit 0  (tsc，产出 dist/)
build.cmd                -> [1/3] typecheck  [2/3] build backend  [3/3] build web console
                            vite v6.4.2, 2661 modules, dist/assets/index-1KHkPHrO.js 905.45 kB
```

## 2. 启动（S1）

```
  zen-hub 0.2.0  (loopback build)
  API base : http://127.0.0.1:8790/v1
  Console  : http://127.0.0.1:8790/app/
  Health   : http://127.0.0.1:8790/health
  Console password (generated now, stored in .env.local):  ****
  New API key [admin] (shown once): oc-****
  New API key [user-default] (shown once): oc-****
{"level":30,"msg":"Server listening at http://127.0.0.1:8790"}
{"level":30,"state":"ok","statusCode":200,"message":"gate open","msg":"upstream_gate_probe"}
```

## 3. 体检（S8）

```
$ node scripts/doctor.mjs        -> exit 0
  [ 1] runtime          PASS   node 24.19.0 on win32
  [ 2] config           INFO   127.0.0.1:8790 auth=key egress=direct
  [ 3] data-dir         PASS   ...\zen-hub\data writable
  [ 4] admin-password   PASS   set (from .env.local)
  [ 5] console          PASS   web/dist present
  [ 6] port             PASS   8790 held by this gateway
  [ 7] catalog          PASS   10 live free ids, 0 not yet in models.json
  [ 8] gate             PASS   ok — gate open
  [ 9] service          PASS   v0.2.0 models=10 gate=ok
summary: 9 pass, 0 warn, 0 fail, 0 skipped
```

## 4. 端到端（S2 / S3 / S6）

```
$ node scripts/e2e.mjs           -> exit 0  (AUTH_MODE=key)
  health             PASS   v0.2.0 gate=ok
  models             PASS   10 models advertised
  chat               PASS   content=pong            (首轮)
  chat-stream        PASS   14 data frames, [DONE]=true
  tools              PASS   finish=tool_calls calls=get_time
  responses-api      PASS   {"id":"resp_...","object":"response","status":"completed",...}
  anthropic-api      PASS   {"id":"msg_...","type":"message","content":[{"type":"text","text":"pong"}]}
  auth-reject        PASS   wrong key -> HTTP 401
summary: 8 pass, 0 fail

$ (AUTH_MODE=off, 端口 8793, 不带任何 key)
  health/models/chat/chat-stream/tools/responses-api/anthropic-api 全 PASS
summary: 8 pass, 0 fail
```

## 5. 端口（S4）

```
$ node scripts/port-check.mjs 8786 8791
 8786  free
 8787  free
 8788  RESERVED  reserved by another local tool
 8789  free
 8790  IN USE
 8791  free

第二个实例（8790 被占）：
{"level":40,"wanted":8790,"using":8791,"msg":"port_in_use_fell_back"}
  API base : http://127.0.0.1:8791/v1
```

## 6. 目录对账（退休路径）

注入一条假模型 `ghost-model-free` 后重启：

```
{"level":30,"added":[],"retired":["ghost-model-free"],"revived":[],"liveFreeCount":10,"msg":"catalog_reconciled"}
GET /v1/models -> 10 条（ghost 已隐藏）
data/models.json 中保留该行：
{"id":"ghost-model-free","enabled":false,"retiredAt":"...","retiredReason":"not listed by the upstream free catalog"}
```

## 7. 离线 / 出口不可用（S5）

用 `UPSTREAM_PROXY=http://127.0.0.1:9`（死端口）模拟：

```
  Egress   : proxy http://127.0.0.1:9
{"level":30,"msg":"Server listening at http://127.0.0.1:8792"}
{"level":40,"error":"connect ECONNREFUSED 127.0.0.1:9","msg":"catalog_reconcile_skipped"}
{"level":30,"state":"unreachable","statusCode":null,"message":"connect ECONNREFUSED 127.0.0.1:9","msg":"upstream_gate_probe"}

GET /health ->
{"status":"ok","version":"0.2.0","port":8792,"models":10,"retiredModels":1,
 "upstream":{"state":"unreachable",...,"lastError":"connect ECONNREFUSED 127.0.0.1:9"},
 "gate":{"state":"unknown",...}}
GET /v1/models -> 10 条（服务照常）
```

## 8. 控制台（S7）

```
GET /app/            -> 200  <!doctype html> ... lang="zh-CN"
GET /app/assets/index-1KHkPHrO.js -> 200, 905448 bytes
GET /  (未登录)      -> 302 /app/
```

## 9. 上游自带回归脚本

本机沙箱内 `tsx` 无法启动 esbuild 服务进程（`spawn EPERM`），因此用
`node --experimental-transform-types --import ./scripts/ts-run.mjs` 直接跑 TS 源码：

| 脚本 | 结果 |
|---|---|
| tool-mapping-check | PASS（15 条断言） |
| opencode-compat-check | PASS |
| responses-conversion-check | PASS |
| models-transport-check | PASS |
| retry-settings-check | PASS |
| response-lifecycle-check | PASS |
| systemone-routing-check | PASS |
| proxy-routing-check | PASS |
| json-store-check | **FAIL（平台差异）**：断言 POSIX 权限 `0600`，NTFS 上普通文件恒报 `0666`；被断言的 `src/storage/jsonFile.ts` 本次未改动 |

## 10. 未执行 / 已知缺口

- 未在 Linux/macOS 验证（本机无 WSL/Docker）。
- 未对 `/v1/systemone` 做真实调用（该接口需要 state/questions 结构，非本次目标；路由与转换沿用上游并有 systemone-routing-check 覆盖）。
- `/v1/responses` 与 `/v1/messages` 各只验了 1 次 happy path。
- 上游门禁探针只代表**发探针那一刻**的状态。


---

# 追加验收（2026-10-17 第二轮）：白天模式 + 免密开关

## A. 后端开关（`scripts/smoke-auth.mjs`，实跑）

```
zen-hub auth smoke  ->  http://127.0.0.1:8790
  console locked by default    PASS   GET /admin/session -> HTTP 401
  password login               PASS   POST /admin/login -> HTTP 200
  console auth -> off          PASS   PATCH /admin/settings -> HTTP 200
  console opens without token  PASS   mode=off, HTTP 200
  admin route without token    PASS   GET /admin/api-keys -> HTTP 200
  api auth -> off              PASS   PATCH /admin/settings -> HTTP 200
  v1 without API key           PASS   POST /v1/chat/completions -> HTTP 200
  restore switches             PASS   back to key + password
  console locked again         PASS   GET /admin/session -> HTTP 401
  session token still valid    PASS   GET /admin/session -> HTTP 200
summary: 10 pass, 0 fail
```

脚本不打印密码或 Key：`ADMIN_PASSWORD` 从 `.env.local` 读取后只在进程内使用。

## B. 白天模式（真实浏览器，Chrome + CDP）

```
点击右上角"白天"前： data-theme=dark   body背景 rgb(8, 9, 10)  文字 rgb(247, 248, 248)
点击右上角"白天"后： data-theme=light  body背景 rgb(246, 247, 249) 文字 rgb(18, 19, 23)
                         localStorage.oph_theme=light，按钮文字变为"夜间"
刷新（/app/?t=...）后：data-theme 仍为 light（不闪白）
```

- 设置页渲染确认：`h1=系统设置`，页面含"访问控制"卡片，两个开关 aria-label 为
  `控制台免密` / `接口免密`。
- 恢复默认后再次校验：`PATCH -> 200`，同时 `GET /admin/session -> 401`（密码门重新生效）。

## C. 本轮改动带来的注意事项

- 前端重新打包在本沙箱里需要 esbuild 子进程（`spawn EPERM`），因此**品牌文案（zen-hub / v0.2.0）是直接替换已构建 bundle 里的字符串**；源码同步改了，
  在沙箱外跑一次 `build.cmd` 得到的是同样结果。
- 背景标签页里切换视图会因 rAF 节流卡在 AnimatePresence 的退出动画上（上游行为，非本次改动），
  无头浏览器（前台）验证正常。


---

# 追加验收（2026-10-17 第三轮）：精简文件 + 配置文件改名

## A. 删除（`git rm`，历史里可取回）

| 文件 | 原因 |
|---|---|
| `Dockerfile` / `docker-compose.yml` / `docker-compose.dev.yml` / `.dockerignore` / `.env.docker.example` | 本机无 Docker |
| `.github/workflows/docker-publish.yml` | 同上 |
| `DEPLOYMENT.md` | 只讲 Docker 部署 |
| `DEVELOPMENT_LOG.md` | 上游 62 KB 开发日志 |
| `scripts/build-binary.mjs` / `scripts/binary-smoke.mjs` | 依赖 bun，且只出 Linux 二进制 |

## B. 归拢

- 18 个上游回归脚本 + `ts-run.mjs`/`ts-resolve.mjs` → `scripts/checks/`
- `scripts/` 顶层只留 6 个日常脚本：`doctor` `compat` `port-check` `e2e` `smoke-auth` `dev-console-auth`
- `package.json` 里的 `check:*` 全部指向 `scripts/checks/`

## C. 配置文件改名（实测）

```
启动横幅：
  Config   : <repo>\config.env
  Migrated .env.local -> config.env (the old name is gone)

磁盘现状：
  config.env     78 B   （PROXY_PORT / STORE_PLAINTEXT_API_KEYS / ADMIN_PASSWORD）
  .env.local     不存在
```

兼容顺序：`config.env` → `.env.local`（旧名，仍会被读）→ `.env`。

## D. 回归

```
node scripts/doctor.mjs        -> 9 pass / 0 fail（admin-password 一栏显示 "from config.env"）
node scripts/smoke-auth.mjs    -> 10 pass / 0 fail（脚本已改成先重置基线，可重复跑）
npm run typecheck / npm run build -> exit 0
```

## E. 未删（需要你自己点头）

- `.npm-cache\`：668 个文件 / 36.5 MB
- `.tmp\`：721 个文件 / 6.1 MB

两个都在 `.gitignore` 里，不影响仓库；双击 `clean.cmd` 即可清除（它只删构建产物和缓存，不动 `data\` 与 `config.env`）。


---

# 追加验收（2026-10-17 第四轮）：start.cmd 自动打开控制台

## A. 开关

| 位置 | 键 | 默认 | 生效时机 |
|---|---|---|---|
| 控制台 → 设置 → 访问与启动 | `openConsoleOnStart`（settings.json） | true | 下次启动 |
| `config.env` | `OPEN_CONSOLE=true\|false` | 不写 | **显式写了就压过控制台开关** |

## B. start.cmd 实测（沙箱内真实执行）

```
$ cmd /c start.cmd
[zen-hub] opening http://127.0.0.1:8790/app/      exit 0
```

服务在独立窗口起好后写出 `data\runtime.txt`：

```
url=http://127.0.0.1:8790/app/
open=1
port=8790
pid=12328
```

解析逻辑单独验证（两种状态都过）：

```
open=1 -> URL=http://127.0.0.1:8790/app/ OPEN=1
open=0 -> URL=http://127.0.0.1:8799/app/ OPEN=0
```

## C. 服务端自开（`node dist/main.js` 直启）

```
Browser  : opening http://127.0.0.1:8790/app/     （openConsoleOnStart=true）
Browser  : auto-open off                          （settings=false 后重启，msedge 进程数 0 -> 0）
Browser  : opening http://127.0.0.1:8795/app/     （settings=false 但 OPEN_CONSOLE=true，环境变量优先）
```

## D. 环境限制（如实记录）

本沙箱会话里 `start ""` 与 `node` 的 `spawn` 都调不起 GUI（`cmd /c start.cmd` 能跑完并打印地址，但浏览器窗口不出现，Edge 进程数保持 0）。
因此"浏览器真的弹出来"这一步**没能在沙箱里复现**；实现走的是标准 Windows 方式（`start.cmd` 里直接 `start "" <url>`），到你双击时在交互式桌面执行。
服务端那条路径（`node dist/main.js` 直启时自己开）同样只在沙箱外才有意义。


---

# 追加验收（2026-10-17 第五轮）：上下文上限实测 + 解锁开关

## A. 上游实测（直连上游，匿名免费身份，与网关同一条 wire identity）

| 模型 | 请求 | 结果 |
|---|---|---|
| deepseek-v4.1-flash-free | 320,015 字 / 154,783 tokens | 200，7.5 s |
| deepseek-v4.1-flash-free | 520,028 字 / 251,341 tokens | 200，6.2 s（cached 154,752） |
| deepseek-v4.1-flash-free | 2,080,025 字 / **1,004,443 tokens** | 200，24.3 s |
| deepseek-v4.1-flash-free（经 zen-hub） | 2,080,000 字 / **1,004,529 tokens** | 200，28.3 s |
| glm-5.3-flash-free | 520,028 字 / 287,082 tokens | 200，17.3 s |
| glm-5.3-flash-free | 900,000 字 / 496,730 tokens | 200（首次 429 "Endpoint is unavailable"，重试通过） |
| glm-5.3-flash-free | 1,000,007 字 / 551,890 tokens | 200，38.3 s |
| glm-5.3-flash-free | 1,400,000 字 / 772,586 tokens | 200 |
| glm-5.3-flash-free | 1,450,000 字 / ~800k tokens | **400 context_length_exceeded** |
| glm-5.3-flash-free | 1,800,001 字 / ~1M tokens | **400 context_length_exceeded** |
| `deepseek-v4.1-flash`（付费 id） | 小请求 | **400 Unknown or disabled model**（免费端点只挂 10 个免费 id） |

结论：200k 是目录值；deepseek 免费层实际放行到 1M，glm 到 ~786k。

## B. 开关（`contextUnlock`）

| 用例 | 结果 |
|---|---|
| A1 关闭时 `/v1/models` | `context_length` 出现次数 **0**，每条仍是 `{id,object,created,owned_by}` |
| A2 打开时 | deepseek `{context_length:1000000, context_window:1000000, max_completion_tokens:384000}`；glm `{786432, 786432, 131072}`；big-pickle 无字段 |
| A3 即时生效 | PATCH 后不重启，下一次 `/v1/models` 立即变化 |
| A4 单模型覆盖 | `PUT /admin/models/deepseek-v4.1-flash-free {context:900000,maxOutput:200000}` → `/v1/models` 报 900000/200000；随后复位 1000000/384000 |
| A6 只改元数据 | 212,792 tokens 请求：开关开 200（4.1 s）、开关关 **仍 200**（4.9 s） |

## C. 探针与体检

```
$ node scripts/probe-context.mjs
  deepseek-v4.1-flash-free   target=  200000 -> HTTP 200 tokens=  200154   4585ms
  deepseek-v4.1-flash-free   target=  500000 -> HTTP 200 tokens=  499946   6741ms
  deepseek-v4.1-flash-free   target= 1000000 -> HTTP 200 tokens=  999602   9303ms
  glm-5.3-flash-free         target=  200000 -> HTTP 200 tokens=  199894  10749ms
  glm-5.3-flash-free         target=  500000 -> HTTP 429 tokens=       0   1725ms   （瞬断，已加一次重试）
  glm-5.3-flash-free         target=  786432 -> HTTP 200 tokens=  785516  37274ms
written: data\context-probe.json

$ node scripts/doctor.mjs
  [10] context-probe    PASS   deepseek-v4.1-flash≈1000k/1000k, glm-5.3-flash≈786k/786k
summary: 10 pass, 0 warn, 0 fail, 0 skipped
```

## D. 未执行 / 已知缺口

- **opencode CLI 侧未验证**：没有安装 `opencode-ai`，所以"覆盖 `limit` 后不再压缩"只做到配置片段（schema 已确认允许 `limit:{context,output}`），未做 CLI 实跑。
- 输出上限（目录 32k）未实测：`max_tokens=200000` 被接受（200），但没有验证长生成是否在 32k 处被截断。
- deepseek 超过 1.004M 未测；glm 的精确上限落在 786,432–800,000 之间，未二分到个位。
- 开关默认关闭：`data/settings.json` 里 `contextUnlock=false`。


---

# 追加验收（2026-10-17 第六轮）：完整自检 + 修复 + 优化

## A. 自检全绿（修复后）

```
npm run typecheck            exit 0
npx tsc -b web               exit 0
node scripts/doctor.mjs      11 pass / 0 warn / 0 fail
node scripts/e2e.mjs         8 pass / 0 fail
node scripts/smoke-auth.mjs 10 pass / 0 fail
node scripts/compat.mjs      state=ok (HTTP 200)
node scripts/port-check.mjs  8788 RESERVED / 8790 IN USE / 8791 free
上游 9 个回归脚本           全 EXIT=0（含此前一直红的 json-store）
npm run probe:context        deepseek≈999602 / glm≈785516，写入 context-probe.json
```

## B. 本轮发现并修复的 bug

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | e2e 的 `auth-reject` 报 FAIL（错 key 返回 200），doctor 却仍显示 `auth=key` | 两者都只看环境变量/假设，不看**生效值**；实际 `apiAuthMode=off` 是设置里的状态 | `/health` 新增 `auth:{api,console}` 与 `contextUnlock`；doctor 读它并新增 `api-auth` 检查项；e2e 按生效值决定跑 401 用例还是 SKIP |
| 2 | 18 个上游检查脚本整批 ERR_MODULE_NOT_FOUND | 上一轮把 `scripts/*.ts` 移到 `scripts/checks/`，脚本里的 `../src/...` 变成 `scripts/src/...` | 13 个文件的相对 import 改为 `../../src` / `../../dist` |
| 3 | `json-store-check` 在 Windows 恒失败（438≠384） | 断言 POSIX 权限 `0600`；NTFS 恒报 `0666` | 权限断言加 `process.platform !== "win32"`；**写操作仍无条件执行** |
| 4 | 同上脚本第二处失败：`null !== 'SIGKILL'` | Windows 无信号，子进程只能报退出码 | POSIX 保留严格断言；Windows 记 note，安全断言（原 JSON 不被破坏）不变 |
| 5 | `probe-context.mjs <model> 200000` 把 200k 单点试跑判成"上游缩水"，并覆盖 `context-probe.json`，使 doctor 误报 FAIL | 单点模式也走了"上限判定 + 落盘" | 单点/过滤模式不下结论、不写文件，只打印 |
| 6 | `CONTEXT_UNLOCK=true` 不生效 | settings.json 一旦有该键，env 只作初值 | `AUTH_MODE` / `CONSOLE_AUTH` / `CONTEXT_UNLOCK` 显式设置时**强制覆盖**存储值（实测：设置文件为 false，env=true 启动后 /health 报 true） |
| 7 | 手工添加的模型会被对账自动"退休" | `upsert` 新建的行 `ownedBy=opencode-free`，与上游同步逻辑无法区分 | `ModelConfig.manual` 标记，`applyLiveCatalog` 跳过手工行 |

## C. 顺手的优化

- `/health`：`models.list()` 由 2 次减为 1 次；
- `/v1/models`：同样合并为一次遍历；
- `catalog.applyLiveCatalog`：新增判定从 `Array.some`（O(n²)）改为 `Set`；
- `e2e`：`/v1/responses` 与 `/v1/messages` 的 `max_tokens` 由 32 提到 256——之前 32 token 常被推理吃光，返回空答案也算 PASS，属于假绿。

## D. 未执行

- 浏览器 UI 本轮未再截图（页面结构未变，仅数据字段增加）。
- `probe:context --full` 未跑（会发 6 次 1M 级请求，约 2–3 分钟）；默认阶梯已覆盖两个模型的上限点。
