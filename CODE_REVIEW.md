# opencode-memory 插件代码审查报告

**审查日期**: 2026-07-09  
**审查范围**: `D:\opencode\.config\opencode\plugins\opencode-memory\src\` 全部 12 个源文件  
**审查标准**: 类型安全、逻辑正确性、安全性、跨平台兼容、代码质量

---

## 一、问题汇总

| 严重度 | 数量 | 说明 |
|--------|------|------|
| 🔴 严重 | 3 | 可能导致功能错误或数据损坏 |
| 🟡 中等 | 6 | 逻辑缺陷或潜在运行时问题 |
| 🟢 轻微 | 8 | 死代码、命名不一致、注释过时 |

---

## 二、严重问题 (🔴)

### S1. `prompt.ts:81-95` — truncateEntrypoint 字节截断标志误报

**问题**: `wasByteTruncated` 在未实际截断时被设为 `true`。

```typescript
// 第 81 行: byteCount 是原始内容的字节数
if (byteCount > maxBytes) {        // ← 检查的是原始内容
  const bytes = encoder.encode(content)  // ← content 是行截断后的内容
  if (bytes.length > maxBytes) {   // ← 行截断后可能已不超限
    // ... 实际截断 ...
  }
  wasByteTruncated = true          // ← 第 95 行: 无论是否实际截断都设 true
}
```

**场景**: 原始内容 300 行 30KB（超字节限制），行截断后 200 行 20KB（不超字节限制）。此时 `wasByteTruncated = true` 但未实际截断字节。警告消息会错误地提到"byte size exceeds maximum"。

**修复**: 将 `wasByteTruncated = true`（第 95 行）移入 `if (bytes.length > maxBytes)` 块内。

---

### S2. `dream.ts:445` — prunePhase 用 formatManifest 重建索引格式错误

**问题**: `prunePhase` 使用 `formatManifest(sorted)` 生成 MEMORY.md 索引内容，但 `formatManifest` 输出格式是 `- [scope:type] filename (timestamp): description`，而 MEMORY.md 索引的正确格式是 `- [Title](filename.md) — description`（见 `tools.ts:88` 的 `buildIndexLine`）。

```typescript
// dream.ts 第 445 行:
let newIndex = formatManifest(sorted)  // ← 格式错误

// 正确格式 (tools.ts 第 87-89 行):
function buildIndexLine(name, filename, description) {
  return `- [${name}](${filename}) — ${description}`
}
```

**影响**: dream 蒸馏后 MEMORY.md 索引被重建为 manifest 格式，与 `memory_save` 写入的索引格式不一致。Agent 读取索引时看到的不是可点击的 Markdown 链接格式。

**修复**: `prunePhase` 应该读取每个文件的 frontmatter 获取 `name`，然后用 `buildIndexLine` 格式重建索引，而非直接用 `formatManifest`。

---

### S3. `config.ts:437` — catch 块返回浅拷贝导致默认配置被污染

**问题**: `loadConfig` 的 catch 块返回 `{ ...DEFAULT_CONFIG }`，这是浅拷贝。嵌套对象（`recall`、`extraction`、`dream` 等）仍然是 `DEFAULT_CONFIG` 中对象的引用。

```typescript
// config.ts 第 435-438 行:
} catch {
  return { ...DEFAULT_CONFIG }  // ← 浅拷贝，嵌套对象是引用
}
```

**影响**: 如果调用方修改了返回配置的嵌套字段（如 `config.recall.maxCandidates = 999`），会污染 `DEFAULT_CONFIG`，影响后续所有调用。

**修复**: 使用 `resolveConfig()`（已有深合并逻辑）或手动深拷贝：
```typescript
return resolveConfig()
```

---

## 三、中等问题 (🟡)

### M1. `store.ts:57` — frontmatter 正则不兼容 Windows 换行符

**问题**: `content.match(/^---\n([\s\S]*?)\n---/)` 严格要求 `\n`，不匹配 Windows 的 `\r\n`。

```typescript
// store.ts 第 57 行:
const match = content.match(/^---\n([\s\S]*?)\n---/)
```

**影响**: 如果记忆文件以 `\r\n` 换行保存（Windows Notepad 等），frontmatter 解析失败，`description` 和 `type` 字段返回 `null`/`undefined`，导致 recall 无法匹配。

**修复**: 改用 `\r?\n`：
```typescript
const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
```

---

### M2. `store.ts:117` — confidence 字段未经验证直接类型转换

**问题**: `fm.confidence as MemoryHeader["confidence"] ?? "inferred"` 直接将字符串转换为 `ConfidenceLevel` 类型，未验证值是否合法。

```typescript
// store.ts 第 117 行:
confidence: fm.confidence as MemoryHeader["confidence"] ?? "inferred",
```

**影响**: 如果 frontmatter 中 `confidence: "high"`（非法值），它会被直接通过，后续代码可能基于无效值做判断。

**修复**: 使用 `parseConfidence(fm.confidence)`（已在 `config.ts:50` 导出）：
```typescript
confidence: parseConfidence(fm.confidence),
```

---

### M3. `extraction.ts:74` — sessionId 清洗未阻止 `..` 序列

**问题**: `sessionId.replace(/[^a-zA-Z0-9_.-]/g, "-")` 允许点号，如果 sessionId 包含 `..`，清洗后仍保留。

```typescript
// extraction.ts 第 74 行:
const safe = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "-")
return `session-memory/${safe}.md`
```

**影响**: `store.resolvePath` 的 `..` 检查是最终安全网，但 defense-in-depth 原则建议在此处也阻止。

**修复**: 从允许字符集中移除点号，或在替换后额外处理 `..`：
```typescript
const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
```

---

### M4. `index.ts:134, 203, 217` — `input.client || input` 回退无意义

**问题**: 当 `input.client` 为 `undefined` 时，回退到 `input` 本身，但 `input`（PluginInput）没有 `session` 属性，调用必然失败。

```typescript
// index.ts 第 134 行:
input.client || input,  // ← input 没有 .session.create/.session.chat
```

**影响**: 不会崩溃（被 `.catch(() => {})` 捕获），但回退逻辑给读者虚假的安全感。

**修复**: 如果 `input.client` 不存在，直接跳过 recall/extraction/dream：
```typescript
const client = input.client
if (!client) return
```

---

### M5. `recall.ts:80-112` — recency bonus 导致无关记忆也被返回

**问题**: `scoreMemory` 的 recency bonus 对所有新文件（ageDays=0）给 +3 分。即使关键词匹配为 0、类型匹配为 0，新文件仍得 3 分（>0），通过 `nonZero` 过滤。

**影响**: recall 几乎总是返回所有新文件，即使完全无关。这会浪费 token 注入无关记忆。

**修复建议**: 将 recency bonus 改为乘数而非加法，或要求 keywordScore > 0 才参与排序：
```typescript
if (keywordScore === 0 && typeBonus === 0) return 0
return (keywordScore + typeBonus) * (1 + recencyBonus * 0.1)
```

---

### M6. `dream.ts:389, 395` — 路径清洗不完整

**问题**: `w.filename.replace(/\.\./g, "")` 只移除 `..`，但不阻止绝对路径。

```typescript
// dream.ts 第 389 行:
const safeFilename = w.filename.replace(/\.\./g, "")
```

**影响**: 如果 LLM 返回 `filename: "/etc/passwd"`，清洗后仍为 `/etc/passwd`。`store.resolvePath` 会捕获绝对路径（store.ts:187），但 defense-in-depth 建议此处也检查。

**修复**: 复用 `store.resolvePath` 的验证逻辑，或在此处也检查绝对路径。

---

## 四、轻微问题 (🟢)

### L1. `store.ts:12-13` — 重复导入 path 模块

```typescript
// store.ts 第 12-13 行:
import { join, basename } from "path"   // 命名导入
import * as path from "path"            // 命名空间导入 — 仅为 path.isAbsolute
```

**修复**: 合并为 `import { join, basename, isAbsolute } from "path"`，将 `path.isAbsolute(filename)` 改为 `isAbsolute(filename)`。

---

### L2. `store.ts:51` — 注释过时

```typescript
// store.ts 第 51 行注释:
// Frontmatter parser (minimal — reads only name/description/type)
```

实际已支持 `scope`、`confidence`、`schema_version`。注释应更新。

---

### L3. `scan.ts:8` — 死导入

```typescript
// scan.ts 第 8 行:
import type { MemoryHeader, MemoryType } from "./config.js"
```

`MemoryType` 未在 scan.ts 中使用。移除。

---

### L4. `scan.ts:76-106` — formatSelectedMemories 与 formatMemoryBlock 代码重复

`formatSelectedMemories`（第 76 行）和 `formatMemoryBlock`（第 156 行）构造 `<memory>` 块的逻辑完全相同。`formatSelectedMemories` 应调用 `formatMemoryBlock` 而非内联重复逻辑。

---

### L5. `recall.ts:15` — 死导入

```typescript
// recall.ts 第 15 行:
import type { MemoryHeader, MemoryPluginConfig, MemoryScope } from "./config.js"
```

`MemoryScope` 未在 recall.ts 中直接使用（`ScoredCandidate.source` 用的是字符串字面量 `"user" | "project"`）。移除 `MemoryScope`。

---

### L6. `index.ts:17, 19, 21, 23, 26` — 多个死导入

| 行 | 导入 | 状态 |
|----|------|------|
| 17 | `MemoryHeader` from config.js | 未使用（类型推断） |
| 19 | `buildDailyLogPrompt` from prompt.js | 未调用 |
| 21 | `RecallResult` from recall.js | 未直接引用 |
| 23 | `ToolDefinition` from tools.js | 未直接引用 |
| 26 | `formatSelectedMemories` from scan.js | 未调用（用 `formatMemoriesByScope` 替代） |

---

### L7. `tools.ts:18` — 死类型导入

```typescript
// tools.ts 第 18 行:
import type { ..., MemoryScope, ConfidenceLevel } from "./config.js"
```

`MemoryScope` 和 `ConfidenceLevel` 未在 tools.ts 中直接作为类型注解使用。它们通过 `resolveMemoryScope` 和 `parseConfidence` 间接使用。

---

### L8. `tools.ts:195` — scope enum 硬编码未复用常量

```typescript
// tools.ts 第 195 行:
enum: ["user", "project"],  // ← 硬编码
```

应使用 `[...MEMORY_SCOPES]`（与第 189 行 `enum: [...MEMORY_TYPES]` 一致）。

---

## 五、跨文件一致性检查

| 检查项 | 结果 |
|--------|------|
| MemoryHeader 字段在所有文件中一致 | ✅ config.ts 定义，store.ts 构造，scan/recall/tools 消费 |
| MemoryStore 接口实现完整 | ✅ FileSystemStore 实现全部 9 个方法 |
| resolveMemoryScope 路由逻辑 | ✅ config.ts 定义，tools.ts:221 正确调用 |
| frontmatter 格式一致 | ⚠️ tools.ts:62 写入 `schema_version: 1`，但 buildMemoryPrompt 的模板（prompt.ts:249-253）不含此字段 |
| 索引格式一致 | 🔴 tools.ts 用 `buildIndexLine`，dream.ts:445 用 `formatManifest` — **格式不一致** (S2) |
| 降级路径完整 | ✅ recall.ts 所有 LLM 调用有 try/catch 回退 |

---

## 六、建议修复优先级

| 优先级 | 问题 | 修复复杂度 |
|--------|------|-----------|
| **立即修复** | S2: dream.ts 索引格式错误 | 中 — 需读取 frontmatter 重建索引 |
| **立即修复** | S3: config.ts 浅拷贝污染 | 低 — 改用 `resolveConfig()` |
| **尽快修复** | S1: prompt.ts 截断标志误报 | 低 — 移动一行代码 |
| **尽快修复** | M1: store.ts Windows 换行符 | 低 — 正则改 `\r?\n` |
| **尽快修复** | M2: store.ts confidence 验证 | 低 — 改用 `parseConfidence()` |
| **择期修复** | M3-M6: 安全/逻辑增强 | 低-中 |
| **择期修复** | L1-L8: 死代码清理 | 低 |

---

## 七、总体评价

**架构设计**: 清晰的分层（config → store → scan → prompt → recall → tools → extraction → dream → index），职责分离良好。Scope Resolver 抽象和两阶段 recall 设计是亮点。

**代码质量**: 主要逻辑正确，降级路径完整。问题集中在：(1) 跨文件格式一致性（索引格式）、(2) 类型安全（`as` 转换代替验证函数）、(3) 死代码积累（subagent 并行开发导致导入冗余）。

**安全**: 路径遍历防护到位（`resolvePath` 检查 `..` 和绝对路径），但 defense-in-depth 层次不够（部分中转节点未独立检查）。

**建议**: 优先修复 S2（索引格式不一致）和 S3（浅拷贝），其余可在后续迭代中逐步处理。
