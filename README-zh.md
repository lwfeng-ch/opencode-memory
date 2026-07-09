# opencode-memory

[English](README.md) | 简体中文

面向 [OpenCode](https://opencode.ai) 的流水线化、模型无关的长期记忆系统。

借鉴 Claude Code 的记忆流水线设计，基于 OpenCode 事件驱动的插件架构重新构建。免费模型优先：每个 LLM 调用点均可独立配置，支持优雅降级。

## 特性

- **KAIROS 模式** — 活跃会话期间追加式日志（零 LLM 开销），`session.idle` 时批量提取
- **两阶段召回** — 规则筛选（免费，零模型调用）+ LLM 精排（仅对候选集发一次轻量调用）
- **Dream 蒸馏** — 四阶段流水线：定向 → 收集 → 合并 → 清理，三重门控调度，周期运行
- **跨项目分层** — 用户级记忆（全局偏好）+ 项目级记忆（仓库上下文），支持优先级覆盖
- **6 个自定义工具** — `memory_save`、`memory_list`、`memory_search`、`memory_read`、`memory_delete`、`memory_append`
- **时效感知** — 超过 N 天的记忆自动注入"时间点观察"警示标记
- **模型无关** — 免费模型默认配置（`explore`/`quick`/`deep` 类别），每个阶段独立可配

## 架构

```
src/
├── index.ts        插件入口 — 串联 hooks（system.transform, chat.message, event, tool）
├── config.ts       配置、类型分类（user/feedback/project/reference）、scope 路由
├── store.ts        存储抽象（FileSystemStore）、frontmatter 解析器
├── paths.ts        路径解析（项目 + 用户记忆目录、git 根检测）
├── prompt.ts       系统提示词构建（指令 + MEMORY.md 索引注入）
├── recall.ts       两阶段召回：规则筛选 → LLM 精排，多 scope 支持
├── extraction.ts   KAIROS 会话提取（session.idle 触发）
├── dream.ts        Dream 蒸馏：四阶段流水线 + 三重门控调度
├── scan.ts         目录扫描 + 清单/选择格式化
├── staleness.ts    时效计算 + 新鲜度警示（纯函数，无 I/O）
├── lock.ts         文件锁互斥（PID + 超时）
└── tools.ts        6 个自定义工具定义
```

### 记忆流水线

```
用户消息
    │
    ▼
chat.message hook ──► 召回（异步，非阻塞）
    │                     │
    │              阶段一：规则筛选（免费）
    │              阶段二：LLM 精排（一次调用）
    │                     │
    ▼                     ▼
system.transform hook ──► 注入 MEMORY.md 索引 + 召回的记忆
    │
    ▼
Agent 运行（带记忆上下文）
    │
    ▼
session.idle 事件 ──► 提取（批量，KAIROS）
                   └──► Dream 蒸馏（门控通过时）
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

编辑 `memory.config.json` 调整模型、阈值和功能开关：

```jsonc
{
  "enabled": true,
  "features": {
    "recall": {
      "enabled": true,           // 启用/禁用召回流水线
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
      "min_tokens_between_update": 5000
    },
    "dream": {
      "enabled": true,
      "category": "deep",        // Dream 子 Agent 类别
      "min_hours_since_last": 24,
      "min_sessions_since_last": 5
    },
    "scope": {
      "user_scope_enabled": true,       // 跨项目用户记忆
      "project_overrides_user": true     // 冲突时项目优先
    }
  },
  "models": {
    "recall": null,     // null = 使用 Agent 默认值；或设为 "opencode/north-mini-code-free"
    "extraction": null,
    "dream": null
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
# 运行全部验证测试
bun run test/verify-all-fixes.ts   # 第一轮（22 项测试）
bun run test/verify-round2.ts       # 第二轮（24 项测试）

# 运行集成测试
bun run test/integration.test.ts
bun run test/scope-integration.ts
```

共 46 项测试，全部通过。

## 设计原则

1. **流水线优先，而非复刻** — 不是 Claude Code 的克隆，而是面向 OpenCode 架构的流水线化设计
2. **免费模型优先** — 每个 LLM 阶段均可优雅降级；规则筛选在零模型调用下即可工作
3. **松耦合** — `type` ≠ `scope`；type 是语义分类，scope 是生命周期边界，可逐条覆盖
4. **协作而非竞争** — 主 Agent 主动写记忆；提取/Dream 是安全网，不抢占
5. **纵深防御** — 工具层和存储层双重路径遍历保护

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
