import { describe, test, expect } from "vitest"
import { resolveConfig, resolveAgentConfig } from "../src/config.js"

describe("resolveAgentConfig", () => {
  test("recall: uses default agent from config", () => {
    const config = resolveConfig()
    const opts = resolveAgentConfig(config, "recall")
    // "explore" is a category label → NOT passed as body.agent
    expect(opts.agent).toBeUndefined()
  })

  test("extraction: uses category, not agent", () => {
    const config = resolveConfig()
    const opts = resolveAgentConfig(config, "extraction")
    // "quick" is a category label → NOT passed as body.agent
    expect(opts.agent).toBeUndefined()
  })

  test("dream: uses category, not agent", () => {
    const config = resolveConfig()
    const opts = resolveAgentConfig(config, "dream")
    // "deep" is a category label → NOT passed as body.agent
    expect(opts.agent).toBeUndefined()
  })

  test("custom agent name is passed through", () => {
    const config = resolveConfig()
    config.agents.extraction.agent = "memory-extractor"
    const opts = resolveAgentConfig(config, "extraction")
    expect(opts.agent).toBe("memory-extractor")
  })

  test("model override from agents section", () => {
    const config = resolveConfig()
    config.agents.recall.model = "qwen3-14b"
    const opts = resolveAgentConfig(config, "recall")
    expect(opts.model).toBe("qwen3-14b")
  })

  test("model fallback to legacy config.models", () => {
    const config = resolveConfig()
    config.models.extraction = "deepseek-v4-flash"
    config.agents.extraction.model = undefined
    const opts = resolveAgentConfig(config, "extraction")
    expect(opts.model).toBe("deepseek-v4-flash")
  })

  test("agents.model takes priority over legacy models", () => {
    const config = resolveConfig()
    config.models.dream = "old-model"
    config.agents.dream.model = "new-model"
    const opts = resolveAgentConfig(config, "dream")
    expect(opts.model).toBe("new-model")
  })

  test("category labels never passed as agent", () => {
    const config = resolveConfig()
    // All three stages use category labels by default
    const recallOpts = resolveAgentConfig(config, "recall")
    const extractionOpts = resolveAgentConfig(config, "extraction")
    const dreamOpts = resolveAgentConfig(config, "dream")
    // None should have agent set (all use category labels)
    expect(recallOpts.agent).toBeUndefined()
    expect(extractionOpts.agent).toBeUndefined()
    expect(dreamOpts.agent).toBeUndefined()
  })

  test("no model configured returns undefined", () => {
    const config = resolveConfig()
    config.models.recall = null
    config.agents.recall.model = undefined
    const opts = resolveAgentConfig(config, "recall")
    expect(opts.model).toBeUndefined()
  })
})
