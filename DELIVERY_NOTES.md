# 交付说明

交付日期：2026-08-22

## 交付范围

本仓库是一套可继续开发和部署的 **Web 端 MVP 工程基线**，覆盖：

- Next.js 移动端网页；
- NestJS 模块化单体 API；
- PostgreSQL Migration 与事务级幂等；
- Transactional Outbox；
- Redis + BullMQ；
- RustFS S3-compatible 预签名直传；
- Mock/OpenAI 图片模型 Provider；
- HEIC/HEIF/JPEG/PNG/WebP 素材接入；
- FFmpeg 动态渲染；
- SSE 状态通知；
- Docker、CI、ADR、代码规范与多层 `AGENTS.md`。

当前导出物为 `cover.jpg + motion.mov + manifest.json` 的 ZIP。它不是已经写入 iPhone 照片库的 Live Photo；PhotoKit 配对写入仍属于后续 iOS Importer 的职责。

## 已完成校验

- 2026-08-23：通过 80 服务器现有 RustFS 的凭证化 canary。使用
  `storage.motion-cover.com` 的私有 bucket 上传 68 bytes 测试对象，SHA-256
  校验通过，未签名访问返回 403，60 秒签名下载返回 200，测试对象已清理。
  密钥和完整 signed URL 未写入日志或仓库。
- 仓库结构校验通过；
- 80 个 TypeScript/TSX 源文件完成语法转译校验；
- Prompt/风格策略、Magic Bytes 与幂等哈希共 9 个可脱离第三方依赖执行的单元测试通过；
- 本次新增的数据库幂等、API Service/Controller 与 Web API Client 完成严格 TypeScript 定向校验；
- 所有 JSON 和 YAML 文件可解析；
- 未发现明显的真实 API Key、Token 或私钥；
- FFmpeg `zoompan` 动态命令已使用实际图片执行，输出 H.264、1080×1920、`yuv420p` MOV；
- 幂等请求已实现为 PostgreSQL 事务级记录：相同请求复用首次响应，不同请求体复用同一 Key 返回 409。

## 当前环境未完成的校验（2026-08-22 原始 MVP 交付记录）

以下内容保留原始 MVP 交付时的环境记录；当前 Graph 迁移的最新安装、测试和
RustFS 验证结果以 `docs/execplans/graph-engineering-full-migration.md` 为准。
原始生成环境无法连通 npm Registry，因此当时未能执行真实依赖安装，也未生成
`pnpm-lock.yaml`。当时要求在可访问 Registry 的开发机或 CI 中执行：

```bash
corepack enable
pnpm install
pnpm check
```

第一次成功安装后，请提交生成的 `pnpm-lock.yaml`，并将 CI、Dockerfile 中的安装参数切换为 `--frozen-lockfile`。

当前执行环境也没有 Docker CLI，因此 Docker Compose 仅完成 YAML 解析，未实际启动整套容器。

## 真实部署前必须完成

1. 用真实身份认证替换演示 `x-user-id`。
2. 固定 Postgres、Redis、RustFS 等容器镜像版本。
3. 在目标 Media Worker 镜像中验证 ImageMagick/libheif 对真实 HEIC 的解码能力。
4. 配置 TLS、Secret Manager、备份、配额、限流和内容安全。
5. 为 OpenAI 任务建立成本预算、速率限制和模型回归评估集。
6. 增加 iOS Importer，写入 Live Photo 配对元数据并通过 PhotoKit 保存。
7. 为批量任务增加管理面、死信重放、积分账本和审计。

## 推荐启动方式

仅启动基础设施：

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm dev
```

使用 Docker 构建并启动全部应用：

```bash
docker compose -f docker-compose.yml -f docker-compose.apps.yml up --build
```

默认 `AI_PROVIDER=mock`，不会产生真实模型费用。
