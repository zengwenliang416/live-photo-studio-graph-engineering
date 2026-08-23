# 用 Codex 执行完整 Graph Engineering 计划

## 1. 准备安全工作区

不要直接在主分支或带生产密钥的目录中运行长任务。

```bash
unzip live-photo-studio-graph-engineering-2026-08-23.zip
cd live-photo-studio-graph-engineering
git init                         # 仅在压缩包没有 .git 时需要
git add .
git commit -m "chore: graph engineering baseline"
git checkout -b feat/graph-engineering
```

保持 `.env` 使用本地 PostgreSQL、Redis、MinIO 和 `AI_PROVIDER=mock`。不要把生产
OpenAI Key、数据库凭据或云存储凭据交给自动执行会话。

## 2. 建立依赖基线

```bash
corepack enable
pnpm install
```

首次成功安装后生成并保留 `pnpm-lock.yaml`。先不要把 CI 改成 frozen lockfile，
直到锁文件存在并通过完整检查。

## 3. 启动首次完整执行

```bash
./scripts/codex/run-graph-migration.sh
```

脚本等价于：

```bash
codex exec --full-auto "$(cat CODEX_FULL_EXECUTION_PROMPT.md)"
```

Codex 会被要求依次读取：

- `AGENTS.md` 和所有生效的子目录 `AGENTS.md`
- `PLANS.md`
- `docs/execplans/graph-engineering-full-migration.md`
- Graph 架构、ADR 和交付说明

随后从 ExecPlan 第一个未完成里程碑开始，不停留在只写计划的阶段。

## 4. 断点续跑

一次会话结束、上下文切换或遇到暂时外部阻塞后，查看 ExecPlan 的 `Progress`、
`Surprises & Discoveries` 和 `Decision Log`，然后运行：

```bash
./scripts/codex/continue-graph-migration.sh
```

它会让新的 Codex 会话从仓库和生活化 ExecPlan 恢复，而不是依赖旧聊天记录。

## 5. 每轮执行后的人工检查

```bash
git status --short
git diff --check
git diff --stat
pnpm graph:check
pnpm graph:test
```

同时检查：

1. Codex 是否真实更新了 ExecPlan，而不是只在聊天里汇报。
2. 是否删除、跳过或放宽了原有测试和 TypeScript 严格规则。
3. Worker 是否仍在自行更新 Graph 路径的项目阶段。
4. 是否出现未受约束的循环、重复重试或非幂等副作用。
5. 是否把密钥、签名 URL、图片 Base64 或完整提示词写入日志/Graph State。
6. 是否把旧 Graph 版本或旧节点直接删除。

## 6. 完成标准

只有当 ExecPlan 所有里程碑和验收标准完成、测试命令真实通过、回滚路径可执行、
`Outcomes and retrospective` 已填写时，才视为完整迁移结束。

不要使用跳过审批和沙箱的危险参数。`--full-auto` 已足够用于当前干净工作区中的
自动编辑与命令执行；仍应在每轮后审查差异。
