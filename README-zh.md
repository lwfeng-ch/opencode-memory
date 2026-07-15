# opencode-memory

[English](README.md) | 简体中文

面向 [OpenCode](https://opencode.ai) 的流水线化、模型无关的长期记忆系统。

借鉴 Claude Code 的记忆流水线设计和 Qwen Code 的 Fact Layer 架构，基于 OpenCode 事件驱动的插件架构重新构建。免费模型优先：每个 LLM 调用点均可独立配置，支持优雅降级。

## 特性

### 核心流水线
- **KAIROS 模式** — 活跃会话期间追加式日志（零 LLM 开销），`session.idle` 时批量提取
- **增量提取** — 基于 Cursor 的消息偏移追踪；仅将上次提取后的新消息发送给 LLM（降低长会话成本）
- **两阶段召回** — 规则筛选（免费，零模型调用）+ LLM 精排（仅对候选集发一次轻量调用）
- **RecallHandle** — 异步召回在 `chat.message` 时启动，后台结算，在下一轮 `system.transform` 时注入——不阻塞、不丢结果
- **活动工具过滤** — 工具活跃时的临时调试记忆（如 "npm install failed"）被过滤；持久标记（"workaround"、"known issue"）保留
- **记忆压力检测** — 三级检测（normal/elevated/critical），基于文件数、索引大小和总大小；critical 绕过 Dream 时间门控，elevated 减半
- **Dream 蒸馏** — 四阶段流水线：Prepare（orient+gather 合并）→ 合并 → 清理，三重门控调度 + 压力感知触发——3 次 LLM 调用（原 4 次）
- **条目级删除** — `memory_delete` 支持 `entryId` 参数，可删除多条目记忆文件中的单条记录，而非整文件
- **遥测事件** — 结构化 JSONL 事件日志（`logEvent`/`queryEvents`/`cleanupOldEvents`），覆盖提取、召回、Dream 生命周期——永不阻塞流水线
- **跨项目分层** — 用户级记忆（全局偏好）+ 项目级记忆（仓库上下文），支持优先级覆盖
- **6 个自定义工具** — `memory_save`、`memory_list`、`memory_search`、`memory_read`、`memory_delete`（支持条目级）、`memory_append`
- **时效感知** — 超过 N 天的记忆自动注入"时间点观察"警示标记
- **模型无关** — 免费模型默认配置（`explore`/`quick`/`deep` 类别），每个阶段独立可配，`resolveAgentConfig` 安全检查

### 质量与安全 (v0.2+)
- **提取验证器** — 4 层质量门（schema → section → placeholder → length）写入前检查；防止垃圾内容污染记忆库
- **相关记忆过滤** — `scoreMemory()` 按关键词相关性预筛 top-10；提取 prompt token 减少 60~80%
- **语义描述** — LLM 输出 `name`/`description` frontmatter；会话记忆可被召回关键词匹配命中
- **语义指纹** — TF-IDF 关键词提取 + Jaccard 相似度 > 0.8 → 合并；即使文本不同也能捕获语义重叠（非 SHA256）
- **召回追踪** — `store.touch()` 在召回命中时更新；180 天未召回的非 explicit 记忆自动清理；**explicit 记忆永不自动删除**
- **消息缓存** — `chat.message` hook 写入 `fact/messages/*.jsonl`；解耦提取与 SDK API，支持离线回放
- **路径安全守卫** — Symlink 保护、`realpath()` 检查、路径逃逸防护；自动写入系统的安全层
- **显式反馈快速通道** — 检测显式信号（"记住"/"always use"/"never use"）直接以 `confidence: explicit` 保存；绕过 Dream
- **类型化记忆候选** — 提取产出 `semantic/candidates/` 带置信度；explicit/observed 自动提升，inferred/derived 走 Dream 审批
- **提取游标增强** — 优先从本地消息缓存读取，SDK API 回退；真正的增量处理

### 可观测性与评估 (v0.3+)
- **记忆审计** — `bun run audit` 扫描记忆目录，检测质量问题（截断描述、缺失字段、空内容）、重复（TF-IDF Jaccard）、冲突（版本号/技术切换检测）、过期（180 天未召回）。只读——永不修改文件
- **基准测试框架** — `bun run benchmark` 运行 5 个测试套件（Dedup、Recall、Conflict、ExtractionPipeline、Forgetting），Mock 模式含 strict + adversarial 双模式执行器。输出 JSON/Markdown/Console
- **评估层** — 独立评价原语（fingerprint、scoring、comparison、metrics、types），Audit 和 Benchmark 共享，无循环依赖
- **CLI 工具** — `scripts/audit-cli.ts` 和 `scripts/benchmark-cli.ts`，支持 `--json`、`--scope`、`--suite`、`--format` 参数

## 架构

```
src/
├── index.ts              插件入口 — 串联 hooks（system.transform, chat.message, event, tool）
├── config.ts             配置、类型分类、scope 路由、resolveAgentConfig、DreamMode
├── store.ts              存储抽象（FileSystemStore）、frontmatter 解析、touch()、pathguard 集成
├── paths.ts              路径解析（项目 + 用户目录、git 根、cursor + 消息缓存路径）
├── prompt.ts             系统提示词构建（指令 + MEMORY.md 索引注入）
├── recall.ts             两阶段召回：规则筛选 → LLM 精排、RecallHandle（scoreMemory 从 evaluation 层重导出）
├── extraction.ts         KAIROS 提取：验证器 + 指纹 + 语义描述 + 显式反馈 + 候选检测
├── extraction-validator.ts  4 层质量门（schema/section/placeholder/length）— 纯函数
├── evaluation/           共享评价原语 (v0.3+)
│   ├── types.ts          EvaluationResult, EvaluationContext — audit/benchmark 统一类型
│   ├── metrics.ts        纯数学函数：precision, recallAtK, f1, reductionRate
│   ├── fingerprint.ts    TF-IDF + Jaccard 相似度（从 src/ 迁移）
│   ├── scoring.ts        scoreMemory 从 recall.ts 提取 — 关键词匹配 + 类型加分 + 新鲜度
│   └── comparison.ts     SemanticComparator<T> + TokenJaccardComparator + ArrayOverlapComparator
├── audit/                只读记忆健康扫描 (v0.3+)
│   ├── index.ts          MemoryAuditService — 插件模式分析器编排
│   ├── report.ts         AuditReport 生成 + JSON/Markdown/Console 格式化
│   └── analyzer/
│       ├── duplicate.ts  TF-IDF Jaccard >0.8 配对检测（复用 evaluation/fingerprint）
│       ├── conflict.ts   配对主题相似度 + 版本号/技术切换冲突检测
│       ├── quality.ts    frontmatter 完整性、截断描述、空内容
│       └── staleness.ts  180 天清理规则，explicit 记忆永不过期
├── message-cache.ts      追加式 JSONL 消息缓存（chat.message → fact/messages/*.jsonl）
├── explicit-feedback.ts  检测显式信号（"记住"/"always use"）— 直接保存，绕过 Dream
├── candidate.ts          类型化记忆候选，置信度分层 Dream 路由
├── dream.ts              Dream 蒸馏：prepareDreamContext（orient+gather）→ 合并 → 清理 + 180 天召回清理
├── pathguard.ts          Symlink 保护、realpath 检查、路径逃逸防护
├── cursor.ts             增量提取追踪（readCursor/writeCursor）
├── health.ts             记忆压力检测（三级）、健康评分、DreamMode 类型窗口
├── state.ts              管线状态（state.json）、DreamMode 联合类型、mergeState 验证
├── telemetry.ts          结构化 JSONL 事件日志（logEvent/queryEvents/cleanupOldEvents）
├── scan.ts               目录扫描 + 清单/选择格式化
├── staleness.ts          时效计算 + 新鲜度警示（纯函数，无 I/O）
├── promotion.ts          Dream 变更验证 + 置信度冲突解决
├── capture.ts            Fact Layer：不可变会话记录，session 专属 $id
├── adapter.ts            Runtime 适配器（SDK → 干净接口、git 快照、健康检查）
├── migration.ts          跨版本数据迁移
├── log.ts                文件日志（避免 stdout 污染，Windows CJK 安全）
├── lock.ts               文件锁互斥（PID + 超时）
├── tools.ts              6 个自定义工具定义
└── fingerprint.ts        重导出 shim → evaluation/fingerprint.ts（已弃用，请用新路径）

benchmark/                项目根目录测试框架（不在 src/ 中，不打包）
├── runner.ts             BenchmarkRunner — 通过 executor 编排用例执行
├── dataset.ts            数据集加载器（从 data/ 加载 JSON 用例）
├── metrics.ts            Metric<T> 实现（Dedup, Recall@K, Conflict, F1, Obsolete）
├── reporter.ts           BenchmarkReport 生成 → reports/benchmark/latest.json
├── executor/mock.ts      Mock 执行器：strict（返回期望值）+ adversarial（返回垃圾）
├── suites/               5 个套件实现（dedup, recall, conflict, extraction_pipeline, forgetting）
└── data/                 11 个基准测试用例（真实会话风格数据）

scripts/                  CLI 入口 (v0.3+)
├── audit-cli.ts          bun run audit [--json] [--scope user|project] [--format markdown]
└── benchmark-cli.ts      bun run benchmark [--suite X] [--json] [--adversarial]
```

### 记忆流水线

```
用户消息
    │
    ▼
chat.message hook ──► 召回（异步，RecallHandle）
    │                     │
    │              阶段一：规则筛选（免费）+ 临时工具过滤
    │              阶段二：LLM 精排（一次调用）— critical 压力时跳过
    │                     │
    ▼                     ▼
system.transform hook ──► 注入 MEMORY.md 索引 + 召回记忆（来自 RecallHandle）
    │
    ▼
Agent 运行（带记忆上下文）
    │
    ▼
session.idle 事件 ──► 提取（批量，KAIROS，cursor 增量）
                   └──► Dream 蒸馏（门控通过 + 压力感知）
                             │
                             └──► 遥测事件（JSONL，非阻塞）
```

### 记忆类型

| 类型 | 默认 scope | 用途 |
|------|-----------|------|
| `user` | user | 用户角色、目标、偏好、专业领域 |
| `feedback` | user | 工作方式指导 — 纠正与确认 |
| `project` | project | 进行中的工作上下文、决策、截止日期 |
| `reference` | project | 外部系统指针（仪表盘、追踪器） |

type 与 scope 松绑定 — Agent 可通过 `memory_save` 的 `scope` 参数覆盖默认路由。

## 安装

### 作为 OpenCode 插件

在 `opencode.jsonc` 中添加：

```jsonc
{
  "plugins": {
    "opencode-memory": {
      "path": "path/to/opencode-memory",
      "enabled": true
    }
  }
}
```

或将插件目录放置在 `~/.config/opencode/plugins/opencode-memory/` 下。

### 依赖

- [OpenCode](https://opencode.ai)（需支持插件系统）
- [Bun](https://bun.sh) 运行时（或 Node.js 18.17+）
- [oh-my-openagent](https://github.com/anthropics/oh-my-openagent) Agent 体系（可选但推荐 — 提供 `explore`/`quick`/`deep` 类别）

## 配置

将 `memory.config.example.json` 复制为 `memory.config.json` 后按需编辑：

```bash
cp memory.config.example.json memory.config.json
```

```jsonc
{
  "enabled": true,
  "features": {
    "recall": {
      "enabled": true,
      "agent": "explore",        // LLM 精排使用的子 Agent 类型
      "background": true,        // 异步预取（非阻塞）
      "llm_rerank": true,        // 设为 false 则仅用规则筛选（最弱模型模式）
      "max_candidates": 20,      // 阶段一候选数量
      "max_results": 5,          // 最终返回数量
      "min_query_length": 5      // 跳过过短的查询（如 "ok"）
    },
    "extraction": {
      "enabled": true,
      "category": "quick",       // 提取子 Agent 类别
      "min_tokens_to_init": 10000,
      "min_tokens_between_update": 5000,
      "max_section_length": 2000,
      "max_total_tokens": 12000
    },
    "dream": {
      "enabled": true,
      "category": "deep",        // Dream 子 Agent 类别
      "min_hours_since_last": 24,
      "min_sessions_since_last": 5,
      "min_messages_since_last": 10,
      "lock_stale_timeout_ms": 3600000
    },
    "staleness": {
      "warn_after_days": 1
    },
    "scope": {
      "user_scope_enabled": true,       // 跨项目用户记忆
      "project_overrides_user": true     // 冲突时项目优先
    }
  },
  "models": {
    "recall": null,       // null = 使用 Agent 默认值；或设为 "opencode/north-mini-code-free"
    "extraction": null,
    "dream": null
  },
  "memoryPressure": {
    "maxFiles": 500,         // 文件数阈值
    "maxIndexSize": 25000,   // MEMORY.md 字节上限
    "maxTotalSize": 5242880, // 记忆目录总大小（估算）
    "elevatedRatio": 0.7,    // ≥70% → elevated
    "criticalRatio": 0.9     // ≥90% → critical
  },
  "telemetry": {
    "enabled": true,         // 设为 false 禁用所有事件日志
    "maxAgeDays": 7,         // 自动清理 7 天前的事件
    "maxEventsPerFile": 1000
  },
  "agents": {
    "recall":     { "agent": "explore", "model": null },
    "extraction": { "category": "quick", "model": null },
    "dream":      { "category": "deep", "model": null }
  }
}
```

### 记忆存储位置

| scope | 路径 |
|-------|------|
| 项目 | `~/.config/opencode/memory/projects/<清洗后的-git-根路径>/` |
| 用户 | `~/.config/opencode/memory/user/` |

每个记忆文件是带 YAML frontmatter 的 Markdown 文件：

```markdown
---
name: 用户角色
description: 用户是高级后端工程师
type: user
scope: user
confidence: explicit
schema_version: 1
---

记忆正文内容...
```

## 测试

```bash
# 运行全部单元 + 集成测试（258 项，34 个文件）
bun test test/chain.test.ts test/candidate.test.ts test/config-pressure.test.ts \
     test/cursor.test.ts test/dream-prepare.test.ts test/entry-delete.test.ts \
     test/explicit-feedback.test.ts test/extraction-validator.test.ts \
     test/health-pressure.test.ts test/integration.test.ts test/lock-recall.test.ts \
     test/lock.test.ts test/message-cache.test.ts test/paths.test.ts test/pathguard.test.ts \
     test/promotion.test.ts test/prompt.test.ts test/recall-tracking.test.ts \
     test/resolve-agent.test.ts test/round10-integration.test.ts test/scan.test.ts \
     test/state-pressure.test.ts test/staleness.test.ts test/telemetry.test.ts \
     test/tools.test.ts test/transient-filter.test.ts \
     test/evaluation/fingerprint.test.ts test/evaluation/scoring.test.ts \
     test/audit/duplicate.test.ts test/audit/conflict.test.ts \
     test/audit/quality.test.ts test/audit/staleness.test.ts \
     test/benchmark/runner.test.ts test/benchmark/metrics.test.ts

# 运行单个测试套件
bun test test/extraction-validator.test.ts   # 4 层质量门（10 项）
bun test test/evaluation/fingerprint.test.ts  # TF-IDF Jaccard 去重（11 项）
bun test test/evaluation/scoring.test.ts     # scoreMemory 关键词匹配（8 项）
bun test test/recall-tracking.test.ts       # touch() + 追踪（4 项）
bun test test/message-cache.test.ts          # JSONL 消息缓存（5 项）
bun test test/pathguard.test.ts             # Symlink/路径安全（6 项）
bun test test/explicit-feedback.test.ts      # 显式信号检测（5 项）
bun test test/dream-prepare.test.ts          # 合并 orient+gather（5 项）
bun test test/candidate.test.ts              # 类型候选检测（6 项）
bun test test/promotion.test.ts             # 置信度覆盖规则（25 项）
bun test test/audit/duplicate.test.ts        # 重复分析器（4 项）
bun test test/audit/conflict.test.ts         # 冲突分析器（5 项）
bun test test/audit/quality.test.ts          # 质量分析器（5 项）
bun test test/audit/staleness.test.ts        # 过期分析器（4 项）
bun test test/benchmark/runner.test.ts       # 基准运行器（4 项）
bun test test/benchmark/metrics.test.ts      # 基准指标（12 项）
bun test test/integration.test.ts            # Dream + Extraction + Plugin（12 项）
bun test test/round10-integration.test.ts    # Cursor + Pressure + RecallHandle（14 项）

# Audit CLI — 记忆健康扫描
bun run audit                                # 控制台输出
bun run audit --json                         # JSON 输出
bun run audit --scope user                   # 仅扫描用户 scope

# Benchmark CLI — 运行评估套件
bun run benchmark                            # 全部套件，mock 模式
bun run benchmark --suite dedup              # 仅指定套件
bun run benchmark --adversarial              # 对抗模式 mock（测试防御能力）
```

共 258 项测试，覆盖 34 个文件，257 项通过（1 个 C1 超时需活跃 OpenCode 实例）。

## 设计原则

1. **流水线优先，而非复刻** — 不是 Claude Code 的克隆，而是面向 OpenCode 架构的流水线化设计
2. **免费模型优先** — 每个 LLM 阶段均可优雅降级；规则筛选在零模型调用下即可工作
3. **增量优于重处理** — Cursor 追踪消息偏移；重新提取时仅发送新消息给 LLM
4. **压力感知调度** — Dream 蒸馏响应记忆压力（critical 立即触发，elevated 减半时间门控）
5. **遥测永不阻塞** — 所有事件日志均为 fire-and-forget（`void logEvent`），失败静默
6. **松耦合** — `type` ≠ `scope`；type 是语义分类，scope 是生命周期边界，可逐条覆盖
7. **协作而非竞争** — 主 Agent 主动写记忆；提取/Dream 是安全网，不抢占
8. **纵深防御** — PathGuard（symlink/realpath/escape）+ 存储层遍历检查 = 双层安全
9. **写入前质量门** — 提取输出经 4 层检查后方可进入记忆库
10. **语义去重优于哈希** — TF-IDF Jaccard 相似度捕获语义重叠，即使文本不同
11. **置信度分层路由** — explicit/observed 自动提升；inferred/derived 走 Dream 审批
12. **召回驱动治理** — 180 天未召回的非 explicit 记忆自动清理；explicit 记忆永久保留
13. **可观测优于假设** — Audit 从真实记忆状态发现问题；确认的问题转化为 Benchmark 用例 (v0.3+)
14. **评估层独立性** — 共享评价原语（fingerprint、scoring、comparison）服务 audit、benchmark 和未来模块，无循环依赖 (v0.3+)
15. **CLI ≠ Library** — CLI 脚本是薄入口层；runner/service 是库代码，不可反过来 (v0.3+)

## 记忆系统概念问答

> 以下是从用户视角对记忆系统工作原理的归纳，与上文的技术实现文档互补。

### 记忆系统是什么

跨会话的文件式持久化机制，让 Agent 在每次新对话开始时仍能带上：

- 你是谁（身份、角色、偏好）
- 你怎么喜欢协作（已纠正的错误、已验证的方法）
- 项目背景（动机、进展、谁在做什么）
- 外部资源在哪（Linear、Slack 等指针）

记忆分两个作用域：

- **用户级**（跨项目共享）：身份与偏好
- **项目级**（仅当前项目）：项目上下文，冲突时优先于用户级

### 背后的设计张力

记忆系统在四个张力之间找平衡：

1. **持久性 vs 新鲜度** — 记忆是"写时为真"的时间快照，推荐前必须验证（文件还在？函数还在？），过期就更新或删除
2. **完整性 vs 相关性** — `MEMORY.md` 只放指针索引（永远加载，<200 行），完整内容按需读取，避免上下文爆炸
3. **自动 vs 受控** — 半自动设计：Agent 主导判断 + 兜底自动提取，拒绝强制自动记录（避免噪声与失控）
4. **可推导 vs 不可推导** — 只存"从当前状态推不出来的"信息；代码模式、git 历史、AGENTS.md 内容、调试方案均不记

补充原则：

- **类型分类对应生命周期**：`user`（稳定）、`feedback`（次次生效，需同时记纠正与确认）、`project`（易变）、`reference`（导航用）
- **记忆 ≠ Plan ≠ Tasks**：Plan 在对话内对齐方案、Tasks 在对话内跟踪进度、Memory 跨对话持久
- **指令优先级**：用户 > 技能 > 系统提示词，记忆是工具不是权威

### 什么时候写入

两种触发模式：

1. **显式触发** — 你说"记住……""忘掉……""以后都这样"，Agent 立即写入或删除
2. **推断触发** — Agent 从对话信号主动判断该记：
   - 你透露角色/偏好/知识 → `user`
   - 你纠正做法（"不是这样""别"）或确认非显而易见的方案（"对，就这样"）→ `feedback`
   - 你提到项目谁/做什么/为什么/何时 → `project`（相对日期转绝对日期）
   - 你提到外部系统资源 → `reference`

关键：`feedback` 不仅记纠正，也要记确认 —— 只记失败会让 Agent 越来越保守，偏离已验证的方法。

### 信息来源透明度

Agent 关于记忆系统的陈述分三层可信度：

- **机制层**（怎么运作、规则）：来自系统提示词，可靠
- **索引层**（已存什么）：来自 `MEMORY.md` 摘要，正文需另行读取核实
- **推理层**（为什么这么设计）：Agent 基于机制反推的合理化解释，可能有偏差

## 许可证

MIT

## 致谢

- [Claude Code](https://claude.ai) — 原始记忆流水线设计灵感
- [OpenCode](https://opencode.ai) — 插件架构与事件驱动 hooks
- [oh-my-openagent](https://github.com/anthropics/oh-my-openagent) — Agent 类别体系
- [Qwen Code](https://github.com/QwenLM/qwen-code) — Fact Layer 架构、recall-selection 概念、symlink 保护

## 更新日志

### v0.3.0 — 记忆可观测性与评估基础 (2026-07-15)

**评估层**
- 评价原语（types、metrics、fingerprint、scoring、comparison）作为独立共享层
- `fingerprint.ts` 从 `src/` 迁移到 `src/evaluation/`（重导出 shim 保持向后兼容）
- `scoreMemory` 从 `recall.ts` 提取到 `src/evaluation/scoring.ts`
- `SemanticComparator<T>` 泛型接口 + `TokenJaccardComparator` + `ArrayOverlapComparator`

**审计模块**
- `MemoryAuditService` 插件模式分析器注册
- 4 个分析器：Duplicate（TF-IDF）、Conflict（配对+版本/技术切换）、Quality（frontmatter）、Staleness（180天）
- 只读约束：永不修改记忆文件
- 报告生成：JSON/Markdown/Console 带严重度评分

**基准测试框架**
- `BenchmarkRunner` + `BenchmarkExecutor` 策略模式（runner=编排，executor=逐例执行）
- `MockExecutor` strict（返回期望值）+ adversarial（返回垃圾）双模式
- 5 个测试套件：Dedup、Recall、Conflict、ExtractionPipeline、Forgetting
- 11 个基准测试用例，真实会话风格数据
- 报告含环境元数据 + 基线支持

**CLI 工具**
- `bun run audit` — 记忆健康扫描，输出发现 + 建议
- `bun run benchmark` — Mock 模式评估套件
- 参数：`--json`、`--scope`、`--suite`、`--format`、`--adversarial`

**修复**
- `store.ts` LSP 类型注解修复（recall_count、last_recalled_at）
- 冲突分析器精度修复（101 误报 → 0，配对 + 去重）
- 添加 `vitest` 到 devDependencies（测试文件 LSP 类型解析）
- N-issue 修复：promotion uncertain:0、capture $id、DreamMode 联合类型

**测试增长：** 216 → 258 项（+42），34 个文件，0 回归

### v0.2.0 — 提取质量与安全 (2026-07-15)

**质量门 (P0)**
- 提取验证器 — 4 层质量门（schema/section/placeholder/length）写入前检查
- 相关记忆过滤 — `scoreMemory()` 预筛 top-10，token 减少 60~80%

**质量基础设施 (P1)**
- 语义描述 — LLM 输出 `name`/`description` frontmatter，召回可命中
- 语义指纹 — TF-IDF Jaccard > 0.8 去重，非 SHA256
- 召回追踪 — `store.touch()` + 180 天清理（永不删 explicit）
- 消息缓存 — `chat.message` → `fact/messages/*.jsonl`，SDK 解耦

**智能化与安全 (P2)**
- 路径安全守卫 — symlink 保护、realpath 检查、路径逃逸防护
- 显式反馈快速通道 — "记住"/"always use" 信号直接保存
- Dream 合并 — 4 阶段逻辑，3 次 LLM 调用（orient+gather 合并）
- 类型化记忆候选 — 置信度分层路由（explicit/observed 自动提升）
- 提取游标增强 — 优先从本地缓存读取，SDK 回退

**早期修复**
- 置信度级别不一致 — `uncertain: 0` 加入 `promotion.ts` 优先级映射
- `$id` 唯一性 — `capture.ts` 和 `extraction.ts` 使用 session 专属 URI
- `DreamMode` 联合类型 — `state.ts` 和 `health.ts` 类型安全

**测试增长：** 139 → 216 项（+77），27 个文件，0 回归

### v0.1.0 — 初始版本

- KAIROS 提取、两阶段召回、Dream 蒸馏、遥测、记忆压力
- 139 项测试，18 个文件
