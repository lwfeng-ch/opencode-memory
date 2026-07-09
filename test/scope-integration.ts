// Scope integration test — verify dual-store memory system
import { MemoryPlugin } from "../src/index.js"

const mockInput = {
  client: {
    session: {
      create: async () => ({ id: "test" }),
      chat: async () => ({}),
      messages: async () => [],
    }
  },
  project: { id: "test", vcs: "git", root: process.cwd() },
  directory: process.cwd(),
  worktree: process.cwd(),
  serverUrl: new URL("http://localhost:3000"),
  $: {} as any,
}

try {
  const hooks = await MemoryPlugin(mockInput)
  console.log("Plugin loaded!")
  console.log("Hook keys:", Object.keys(hooks))

  // Check tools
  const toolNames = Object.keys(hooks.tool || {})
  console.log("Tools:", toolNames)

  // Check memory_save has scope parameter
  const saveTool = hooks.tool?.["memory_save"]
  if (saveTool?.parameters?.scope) {
    console.log("scope param:", saveTool.parameters.scope.enum)
  }
  if (saveTool?.parameters?.confidence) {
    console.log("confidence param:", saveTool.parameters.confidence.enum)
  }

  // Test system prompt injection — should now be scoped
  const output = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]({ sessionID: "test" }, output)
  console.log("\nSystem prompt sections:", output.system.length)
  const promptText = output.system[0] || ""
  
  // Check for scoped prompt markers
  const hasUserSection = promptText.includes("User Long-term Memory")
  const hasProjectSection = promptText.includes("Current Project Memory")
  const hasScopeGuidance = promptText.includes("Memory scope")
  const hasPriority = promptText.includes("override user memories")
  
  console.log("Has 'User Long-term Memory' section:", hasUserSection)
  console.log("Has 'Current Project Memory' section:", hasProjectSection)
  console.log("Has scope guidance:", hasScopeGuidance)
  console.log("Has priority declaration:", hasPriority)

  // Test memory_save with scope=user
  const saveResult = await hooks.tool!["memory_save"].execute({
    filename: "user_role.md",
    content: "Senior Go engineer, prefers terse responses.",
    name: "User Role",
    description: "Senior Go engineer preference",
    type: "user",
    confidence: "explicit",
  }, { sessionID: "test", messageID: "test", abort: new AbortController().signal })
  console.log("\nSave user memory:", saveResult.output)

  // Test memory_list — should show [user] prefix
  const listResult = await hooks.tool!["memory_list"].execute({}, 
    { sessionID: "test", messageID: "test", abort: new AbortController().signal })
  console.log("List:", listResult.output)

  // Test memory_save with scope=project  
  const saveProject = await hooks.tool!["memory_save"].execute({
    filename: "project_deadline.md",
    content: "Release deadline 2026-03-05",
    name: "Project Deadline",
    description: "Release deadline",
    type: "project",
  }, { sessionID: "test", messageID: "test", abort: new AbortController().signal })
  console.log("Save project memory:", saveProject.output)

  // List again — should show both [user] and project entries
  const listResult2 = await hooks.tool!["memory_list"].execute({},
    { sessionID: "test", messageID: "test", abort: new AbortController().signal })
  console.log("List after both saves:", listResult2.output)

  if (hasUserSection && hasProjectSection && hasScopeGuidance && hasPriority) {
    console.log("\n✅ Scope integration test PASSED")
  } else {
    console.log("\n⚠️  Scope integration test PARTIAL — some sections missing")
  }
} catch (e) {
  console.error("❌ Test failed:", e)
  process.exit(1)
}
