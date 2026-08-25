# AGENTS.md — Live Photo Studio 工程协作规范

本文件是本仓库对人类开发者与代码智能体的最高优先级工程约束。修改任意文件前，先阅读本文件，再阅读目标目录中更近的 `AGENTS.md`。更近的规则可以收紧但不得放松根规则。

## 1. 产品使命与不可误导边界

本项目用于：上传多张照片、指定封面/风格参考、调用图片模型生成系列图片、选择结果、生成轻动态素材，并导出供 iOS 导入器使用的资源包。

必须明确区分：

- Web 预览/导出能力。
- 真正写入 iPhone 照片库的 Live Photo 能力。

当前 Web 导出包不是 PhotoKit 已保存资产。任何文案、接口或测试都不得把 ZIP 下载描述成“已保存到苹果相册的 Live Photo”。真正保存由未来的 iOS Importer 完成。

## 2. 架构总则

本仓库采用：

- B/S 前后端分离。
- 模块化单体 API。
- Web-Queue-Worker。
- DDD 分域与六边形依赖方向。
- 事件驱动 + Transactional Outbox。
- 媒体管道-过滤器。
- Provider Adapter、Strategy、Builder、State、Command 等模式。

### 2.1 物理进程

```text
apps/web
apps/api
apps/worker-ai
apps/worker-media
```

它们必须能独立部署和扩容。不得把 FFmpeg、图片模型调用或大文件中转放进同步 API 请求。

### 2.2 依赖方向

允许：

```text
presentation → application → domain
infrastructure → application ports
apps → packages
```

禁止：

```text
domain → NestJS / React / PostgreSQL / BullMQ / OpenAI / S3 / FFmpeg
一个业务模块 → 另一个模块的 infrastructure 私有实现
浏览器 → OpenAI API
```

## 3. 架构不变量

以下规则不可妥协：

1. 原始素材不可覆盖；每次转换生成新的 `asset_variant`。
2. 图片和视频二进制不得存进 PostgreSQL。
3. 浏览器不得持有 OpenAI Key、S3 Secret 或数据库凭证。
4. AI、HEIC 处理和 FFmpeg 必须异步执行。
5. 创建业务任务与写 Outbox 必须在同一数据库事务内。
6. Worker 必须幂等；BullMQ `jobId` 使用 Outbox Event ID。
7. 封面文字、Logo、日期和品牌元素使用确定性渲染，不交给图片模型。
8. 外部 Provider 必须位于 Port/Adapter 后面。
9. 日志不得包含图片 Base64、签名 URL、Secret、完整提示词或敏感 EXIF。
10. 生产模型必须由服务端配置，并优先固定经过验证的 Snapshot。
11. 资产权限必须以 `user_id + project_id` 校验，不能只凭资源 ID。
12. 状态转换必须显式，不能通过多个互相矛盾的布尔值表达。

## 4. 仓库地图与所有权

```text
apps/web             页面、交互、上传、SSE、前端状态
apps/api             HTTP、鉴权边界、用例、事务、Outbox Dispatcher
apps/worker-ai       图片模型调用、候选持久化、AI 错误映射
apps/worker-media    素材标准化、FFmpeg、导出包
packages/contracts   唯一 API/事件 Schema 来源
packages/database    Pool、事务、Migration
packages/prompt-kit  风格策略、提示词 Builder、版本
packages/queue       队列名、Job Payload、Redis 连接
packages/storage     Storage Port 与 S3 Adapter
packages/logger      结构化日志和脱敏
```

跨目录修改必须说明原因。不要为了一个局部需求进行全仓库重排。

## 5. 智能体工作流程

执行任何代码任务时遵循：

1. 阅读根 `AGENTS.md` 与目标目录的 `AGENTS.md`。
2. 搜索现有实现、Schema、事件名和测试，避免重复发明。
3. 先明确受影响的领域、状态、事务和异步边界。
4. 用最小闭环修改实现需求，不做无关重构。
5. 新外部依赖必须说明用途、维护状态和替代方案。
6. 改 API/事件前先改 `packages/contracts`，再改生产者与消费者。
7. 改数据库必须新增向前迁移；禁止编辑已发布迁移。
8. 改 Prompt 必须递增 `promptVersion` 并更新测试。
9. 改媒体输出必须递增 `recipeVersion`。
10. 完成后至少运行受影响范围的 lint、typecheck 和 test。
11. 若无法运行某项检查，必须明确说明原因和未验证风险。

不得把 TODO 当成完成结果。允许保留明确标注、不会破坏主链路的后续扩展点。

## 6. TypeScript 规范

### 6.1 编译约束

必须保持：

- `strict`。
- `noUncheckedIndexedAccess`。
- `exactOptionalPropertyTypes`。
- `useUnknownInCatchVariables`。
- `noFallthroughCasesInSwitch`。

禁止业务代码使用 `any`。外部输入先视为 `unknown`，再通过 Zod 解析。

### 6.2 命名

| 对象 | 规则 |
|---|---|
| 文件 | `kebab-case.ts` / `kebab-case.tsx` |
| 类、类型 | `PascalCase` |
| 函数、变量 | `camelCase` |
| 常量 | `UPPER_SNAKE_CASE` |
| 数据库字段 | `snake_case` |
| URL | 小写复数、kebab-case |
| 领域事件 | `aggregate.action.v1` |
| 错误码 | `DOMAIN_REASON` |
| 队列 | `kebab-case` |

除 Next.js 约定文件外，优先 named export。

### 6.3 函数与错误

- 一个函数只承担一个可命名职责。
- 外部错误必须映射为项目错误码，不能原样返回用户。
- `catch` 参数是 `unknown`，通过守卫提取消息。
- 不用异常表达正常分支。
- 不吞错；至少记录脱敏后的事件与 Trace/Job ID。

## 7. API 规范

- API 前缀固定 `/v1`。
- 创建异步任务返回 `202 Accepted`。
- 创建型接口支持 `Idempotency-Key`；新增接口时不得绕过。
- 同一用户、作用域和 Key 的相同请求必须返回第一次成功响应；请求体不同必须返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 幂等记录必须与业务写入处于同一事务；不得只在 Controller 内做内存去重。
- 成功响应使用 `{ data, requestId? }`。
- 错误响应使用 `application/problem+json` 思路，包含稳定 `code` 与 `retryable`。
- Controller 仅负责解析、权限边界、调用用例和响应映射。
- Controller 不写 SQL、不调用模型、不运行 FFmpeg。
- 列表接口必须有明确硬上限；数据规模可增长时使用游标分页，不得新增无上限全量接口。
- 下载 URL 必须短期签名，不在数据库持久化 URL。

## 8. 数据库与事务

- Migration 只追加，不修改历史文件。
- 生产禁止 `db:reset`。
- ID 使用 UUID，由应用生成或数据库默认生成。
- 时间统一 `timestamptz`/UTC。
- 时长使用毫秒整数；文件大小使用字节整数。
- 金额、积分使用整数，不用浮点数。
- 外键和唯一约束优先在数据库落实。
- JSONB 仅用于模板、风格、Recipe 和事件 Payload，不能代替所有关系模型。
- 外部 API 调用不得处于数据库事务中。
- 事务中创建异步工作时，必须写 `outbox_events`。

### 8.1 Outbox 消费语义

- Dispatcher 使用 `FOR UPDATE SKIP LOCKED` 抢占，并为 `PROCESSING` 记录设置可恢复的 visibility timeout。
- 发布到 BullMQ 时使用 Outbox ID 作为 `jobId`。
- Queue 成功、数据库确认失败时允许重复发布；消费者必须幂等。
- 不可恢复错误进入失败状态，不无限重试。

## 9. 队列与 Worker

- Job Payload 只能放 ID、版本和小型配置，不能放图片 Base64。
- 每个 Job 必须有稳定幂等键。
- 只重试网络、429、可恢复 5xx 和短暂 I/O 错误。
- 参数错误、内容拦截、损坏素材不自动重试。
- 重试采用指数退避和抖动。
- Worker 退出时优雅关闭队列、Redis、数据库连接。
- AI Worker 与 Media Worker 使用独立并发配置。
- 状态顺序必须合法：`QUEUED → RUNNING → SUCCEEDED|FAILED|CANCELLED`。
- `CANCEL_REQUESTED` 表示协作式取消，不承诺立刻中止已发出的第三方请求。

## 10. 存储与上传

- Bucket 默认私有。
- 原始对象 Key 不包含邮箱、手机号、昵称和未清理文件名。
- 上传必须校验声明大小、对象实际大小、Magic Bytes、像素上限。
- 预签名 PUT 要绑定 Content-Type，并设置短 TTL。
- 原图路径、展示图、模型输入、生成图和导出物分开。
- 展示图和模型输入默认移除 GPS 等非必要 EXIF。
- 删除项目时先标记，再异步清理对象；不得在 HTTP 事务里递归删大文件。

## 11. 图片模型规范

- 模型调用只存在于 `apps/worker-ai` 的 Provider Adapter。
- `AI_PROVIDER=mock` 必须保持可用，使 CI 与本地开发不产生真实费用。
- OpenAI 兼容 Key 只存在于服务端：环境变量，或 `user_image_providers` 表中经 `SETTINGS_ENCRYPTION_KEY`(AES-256-GCM)加密的用户级配置；浏览器永不持有。
- 输入图角色顺序必须稳定并在 Prompt 中解释。
- GPT Image 参考图不要盲目塞满；常规保持 3–6 张。
- 提示词由 Builder 编译，不在 Controller 拼字符串。
- 每次任务保存 `prompt_version` 和 `prompt_hash`。
- 不记录完整 Prompt；调试需要时使用受控、短期、授权的安全通道。
- 生成候选到最终精修不可假设拥有固定 Seed；应把选中候选作为参考图。
- 内容拦截映射为不可重试的产品错误。

## 12. Prompt 与风格预设

新增风格必须：

1. 在 `packages/prompt-kit` 新增 preset。
2. 提供目标视觉特征、默认保留规则、禁止元素和推荐动态。
3. 不把字体、Logo、精确标题交给模型。
4. 添加 Prompt 编译测试。
5. 评估人物身份、人数、手部、留白和系列一致性。

修改模板语义必须递增版本，例如 `style-extension.v2`。

## 13. 媒体管道规范

- 原图不可变。
- 每个输出必须可追溯到输入与 `recipeVersion`。
- 先自动方向修正，再裁剪/缩放。
- 避免多次有损转码。
- FFmpeg/ImageMagick 使用参数数组调用，禁止拼接 shell 字符串。
- 每个任务使用独立临时目录，并在 `finally` 清理。
- 对文件大小、像素、时长、帧率和并发设置上限。
- HEIC 支持属于系统镜像能力，必须在真实部署镜像验证。
- 导出包中的 `manifest.json` 必须包含 Schema Version、哈希、时长和资源类型。

## 14. 前端规范

- 路由表达业务步骤，不把整个项目只保存在 React 内存。
- 服务端状态使用 TanStack Query；编辑器临时状态才使用 Zustand。
- 不把 Blob/Base64 存入 Zustand、Context 或 LocalStorage。
- 预览使用 Object URL，并及时 `URL.revokeObjectURL()`。
- 流程使用显式状态，不维护互相冲突的多个布尔值。
- 所有 API 请求通过集中 Client；组件不得散落裸 `fetch`。
- SSE 只负责失效/提示，最终状态以 API 查询结果为准。
- 可访问性至少包括可见焦点、表单 Label、按钮状态和错误文本。
- 移动端优先，关键操作区在 390px 宽度可用。

## 15. 日志、隐私与安全

日志最少包含：

```text
service, event, timestamp, requestId/traceId, projectId, jobId, durationMs
```

禁止记录：

```text
Secret、Token、Authorization、签名 URL、图片 Base64、完整 Prompt、EXIF GPS、原始第三方响应
```

安全要求：

- 所有资源访问验证项目所有权。
- 文件扩展名不能作为真实格式依据。
- 限制上传次数、大小和像素，防止解压炸弹。
- 对用户文本做长度限制，不把其当系统指令。
- 管理接口、重放任务和删除操作写审计日志。
- 依赖升级不得忽略 Major Breaking Changes。

## 16. 测试策略

### 16.1 必测内容

- 状态转换。
- Prompt Builder 与 Style Strategy。
- API Schema 解析。
- 创建任务 + Outbox 原子性。
- Worker 幂等和重试分类。
- 资产权限。
- 媒体方向、尺寸、损坏文件和 HEIC 能力。
- 项目主链路 E2E。

### 16.2 模型测试

普通 CI 使用 Mock Provider。真实模型回归测试应：

- 由显式环境开关触发。
- 有成本上限。
- 使用固定评估素材与 Prompt Version。
- 不在 Pull Request 的默认检查中自动产生费用。

### 16.3 Definition of Done

一个改动完成必须满足：

- 需求行为已实现，不只是接口占位。
- Schema、生产者和消费者一致。
- 错误与取消路径可解释。
- 新代码有对应测试或说明无法测试的客观原因。
- 受影响范围 lint、typecheck、test 通过。
- 文档、环境变量示例和 Migration 同步。
- 没有泄露 Secret、Base64、签名 URL 或用户隐私。

## 17. 常见扩展操作

### 新增 API

1. 在 `packages/contracts` 定义请求/响应 Schema。
2. 在 API presentation 层解析。
3. 在 application service/use case 中实现。
4. 涉及异步任务时同事务写 Outbox。
5. 更新 Web API Client 与测试。

### 新增 Queue Job

1. 在 `packages/queue` 增加稳定事件名与 Payload 类型。
2. 新增 Outbox 路由。
3. 新增 Worker Consumer。
4. 定义幂等、重试、取消和失败码。
5. 加集成测试。

### 新增模型 Provider

1. 实现现有 `ImageGenerationProvider` Port。
2. 在启动配置中注册，不修改业务用例。
3. 映射第三方错误，不泄露原始响应。
4. 添加 Fake/Contract Test。

### 新增数据库字段

1. 添加新 Migration。
2. 先兼容读写，再切换业务，最后清理旧字段。
3. 大表采用 Expand–Migrate–Contract。
4. 不在应用启动时自动改生产 Schema。

## 18. 禁止的捷径

- 前端直接调用 OpenAI。
- 在 HTTP Controller 中等待生图或 FFmpeg。
- 先写数据库、再裸 `queue.add()` 而不使用 Outbox。
- 把所有图片放进一个模型请求以“提高一致性”。
- 使用巨大 `switch` 堆叠所有风格和 Provider。
- 用 `as any` 绕过契约。
- 修改历史 Migration。
- 在日志打印完整请求 Body。
- 用公开 Bucket 解决鉴权问题。
- 把“本地能打开”当成 HEIC/Live Photo 真实设备验收。

## 19. 提交与评审

提交信息建议：

```text
feat(generation): add style anchor workflow
fix(upload): verify object size before ingest
refactor(media): isolate ffmpeg command builder
test(prompt): cover identity-preservation rules
```

PR 描述至少包含：问题、方案、架构影响、数据迁移、失败/回滚方案、验证结果。数据库、权限、计费、Prompt 和媒体输出变更需要重点审查。

## Graph Engineering control-plane rules

These rules apply whenever code touches workflow orchestration, project phases,
AI generation dispatch, human review, media rendering or export.

1. `apps/orchestrator` is the only owner of Graph routing and Graph-path project
   phase transitions.
2. BullMQ remains the execution plane. Graph nodes dispatch idempotent work and
   pause; they do not hold a process open for AI or FFmpeg completion.
3. API and workers publish commands/signals through Transactional Outbox. They do
   not invoke compiled graphs directly or choose arbitrary next nodes.
4. `workflowRunId` is the LangGraph `thread_id`. A project may have multiple
   workflow runs.
5. Every run is permanently bound to `graphKey + graphVersion`.
6. Published graph names, node names, state fields and signal schemas may not be
   removed or renamed in-place. Use a new graph version for breaking changes.
7. Every side effect must be replay-safe and protected by a deterministic effect
   key or uniqueness constraint.
8. Every resume signal must be schema-validated, correlated to the pending job,
   consumed once and processed under a per-run single-writer lock.
9. Graph state contains IDs and small structured values only; never media bytes,
   Base64, secrets, clients, signed URLs, full provider responses or unredacted
   prompts.
10. Every loop is bounded and routes to a human or terminal state after the
    maximum attempt count.
11. The same transient failure must not be automatically retried by LangGraph,
    BullMQ and the provider adapter simultaneously.
12. Long Graph changes require an ExecPlan governed by `PLANS.md`; keep
    `docs/execplans/graph-engineering-full-migration.md` current.
