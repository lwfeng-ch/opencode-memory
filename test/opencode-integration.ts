// Quick integration test: can OpenCode load the memory plugin?
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
  const hookKeys = Object.keys(hooks)
  console.log("Plugin loaded successfully!")
  console.log("Hook keys:", hookKeys)
  
  if (hooks.tool) {
    const toolNames = Object.keys(hooks.tool)
    console.log("Tools registered:", toolNames)
  }
  
  // Test system prompt injection
  if (hooks["experimental.chat.system.transform"]) {
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]({ sessionID: "test" }, output)
    console.log("System prompt injected:", output.system.length, "sections")
    console.log("First section starts with:", output.system[0]?.substring(0, 80))
  }
  
  console.log("")
  console.log("OpenCode integration test PASSED")
} catch (e) {
  console.error("Plugin load failed:", e)
  process.exit(1)
}
