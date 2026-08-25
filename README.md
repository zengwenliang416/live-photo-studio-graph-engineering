# Live Photo Studio

一个面向 iPhone 的“封面驱动 AI 图片系列生成 + 动态照片导出”网页项目骨架。仓库采用模块化单体 API、异步 Worker、事件驱动 Outbox、S3 兼容对象存储，以及可替换的图片模型 Provider。

## 已包含

- Next.js 移动端网页工作台。
- NestJS 模块化单体 API。
- PostgreSQL 数据模型与 SQL Migration。
- Redis + BullMQ 异步任务。
- RustFS S3-compatible 预签名直传。
- HEIC/JPEG/PNG/WebP 素材接入管道。
- `mock` 与 OpenAI GPT Image Provider。
- 低质量多候选生成、结果选择和风格策略。
- FFmpeg 轻微推近动态导出。
- SSE 项目事件通知。
- Transactional Outbox + 幂等 Job ID。
- PostgreSQL 事务级 `Idempotency-Key`：重复请求复用首次响应，请求体冲突返回 409。
- 根目录与各子系统的 `AGENTS.md`。

## 当前边界

本仓库的网页导出物是 `cover.jpg + motion.mov + manifest.json` 的 ZIP 包。它为后续 iOS Importer 写入 Live Photo 配对元数据做好了协议准备，但**网页本身不会声称已经把 ZIP 直接保存为系统照片库中的 Live Photo**。真正的一键保存需要 iOS PhotoKit 导入层。

## 快速启动

要求：Node.js 24 LTS、Corepack、Docker。

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm dev
```

也可以用容器启动整套应用：

```bash
docker compose -f docker-compose.yml -f docker-compose.apps.yml up --build
```

访问：

- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- RustFS Console：使用部署环境提供的管理地址，不在应用配置中公开。

本地默认 `AI_PROVIDER=mock`，无需 OpenAI Key。要调用真实模型：

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=你的服务端密钥
OPENAI_IMAGE_MODEL=gpt-image-2-2026-04-21
```

重启 `worker-ai` 后生效。密钥不得放进 `NEXT_PUBLIC_*` 或浏览器代码。

## 主流程

网页入口：`/` 重定向到 `/projects`（项目列表/创建）→ `/projects/[id]/upload`（上传原图、选封面、选风格）→ `/projects/[id]`(Graph 工作流投影页：生成、选择 anchor、渲染、下载导出包）。生图接口在 `/settings` 按用户配置（OpenAI/NewAPI 兼容端点 + Key + 模型，密钥经 AES-256-GCM 加密后只存服务端，浏览器不直连生图 API);未配置时回退服务端 env，再回退 `mock`。

```text
创建项目(POST /v1/projects,幂等)
→ 获取预签名 URL(POST /v1/projects/:id/upload-intents)
→ 浏览器直传原图到 S3 兼容端点
→ API 校验大小与 Magic Bytes 并完成上传(POST /v1/assets/:id/confirm)
→ 设置封面(POST /v1/projects/:id/cover)
→ 选择风格 preset(GET /v1/style-presets)
→ 启动 Graph 工作流(POST /v1/projects/:id/workflow-runs,input.styleKey,同事务写 Outbox)
→ AI Worker 按用户配置解析 Provider,编译 Prompt(含 prompt_version/prompt_hash)生成候选
→ 用户在工作流页选择 anchor
→ Media Worker 渲染 MOV 与导出包
→ 网页下载 ZIP(短期签名 URL)
```

## 常用命令

```bash
pnpm dev             # 所有应用与包的开发模式
pnpm build           # 构建
pnpm lint            # ESLint
pnpm typecheck       # TypeScript
pnpm test            # 单元测试
pnpm check           # 完整质量门禁
pnpm db:migrate      # 执行迁移
pnpm db:reset        # 清空本地 schema 并重建，严禁生产使用
pnpm infra:logs      # 查看基础设施日志
```

## 目录

```text
apps/web             Next.js Web
apps/api             NestJS API
apps/worker-ai       图片生成 Worker
apps/worker-media    素材处理与动态渲染 Worker
packages/contracts   Zod API 契约
packages/database    PostgreSQL、事务和迁移
packages/logger      结构化日志
packages/prompt-kit  Strategy + Builder 提示词系统
packages/queue       BullMQ、Redis 与事件协议
packages/storage     S3 Storage Port/Adapter
docs                 架构与 ADR
```

## HEIC 说明

浏览器可上传 HEIC/HEIF。Media Worker 优先调用 ImageMagick `magick` 做自动方向修正和 JPEG/WebP 派生。你的生产镜像必须带 HEIC/HEIF 解码能力；仅安装 npm 包并不能保证系统级编解码器可用。

## 生产化待办

- 接入真实鉴权与租户权限，不再使用演示 `x-user-id`。
- 使用固定版本容器镜像，避免 `latest`。
- 为 RustFS S3-compatible API、Redis、PostgreSQL 配置 TLS、备份与密钥管理。
- 添加病毒扫描、内容安全、配额和积分账本。
- 增加 iOS Importer，写入 Live Photo 配对元数据并调用 PhotoKit。
- 为 OpenAI Provider 增加组织验证、限流、成本预算和评估集。
- 为 Media Worker 构建包含 FFmpeg、ImageMagick、libheif 的固定镜像。

用户级生图接口(OpenAI 兼容端点)已支持：在 `/settings` 配置后由 `worker-ai` 在服务端调用，密钥经 `SETTINGS_ENCRYPTION_KEY`(AES-256-GCM）加密落库。风格 preset 由 `packages/prompt-kit` 管理，修改蓝图必须递增 preset version。

协作和代码规则以根目录 [`AGENTS.md`](./AGENTS.md) 为准。交付校验、未验证项和上线前清单见 [`DELIVERY_NOTES.md`](./DELIVERY_NOTES.md)，完整文件目录见 [`FILE_INDEX.md`](./FILE_INDEX.md)。

## Graph Engineering edition

This project edition adds a versioned LangGraph control plane under
`apps/orchestrator`, shared contracts/runtime packages, workflow database tables,
a runnable in-memory demo and a complete Codex ExecPlan.

Start with:

```bash
pnpm install
pnpm db:migrate
pnpm graph:check
pnpm graph:test
pnpm graph:demo
```

Architecture and migration guidance:

- `docs/graph-engineering/README.md`
- `docs/execplans/graph-engineering-full-migration.md`
- `CODEX_FULL_EXECUTION_PROMPT.md`
- `scripts/codex/README.md`
