import { describe, test, expect } from "vitest"
import { detectStructuredObservations, getCandidateDir } from "../src/candidate.js"

describe("detectStructuredObservations", () => {
  test("detects user role reveal", () => {
    const messages = [
      { role: "user", content: "I'm a senior Go engineer working on microservices" },
    ]
    const candidates = detectStructuredObservations(messages)
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    expect(candidates[0].candidateType).toBe("user")
    expect(candidates[0].content).toContain("Go")
  })

  test("detects Chinese user role reveal", () => {
    const messages = [
      { role: "user", content: "我是一个高级Go工程师" },
    ]
    const candidates = detectStructuredObservations(messages)
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    expect(candidates[0].candidateType).toBe("user")
  })

  test("detects project decision", () => {
    const messages = [
      { role: "user", content: "We decided to use PostgreSQL for the new service" },
    ]
    const candidates = detectStructuredObservations(messages)
    const projectCandidate = candidates.find((c) => c.candidateType === "project")
    expect(projectCandidate).toBeDefined()
    expect(projectCandidate!.content).toContain("PostgreSQL")
  })

  test("returns empty for casual conversation", () => {
    const messages = [
      { role: "user", content: "Can you help me with this function?" },
      { role: "assistant", content: "Sure, let me look at it." },
    ]
    expect(detectStructuredObservations(messages)).toEqual([])
  })

  test("detects external reference mention", () => {
    const messages = [
      { role: "user", content: "Check the dashboard at grafana.internal:3000" },
    ]
    const candidates = detectStructuredObservations(messages)
    const refCandidate = candidates.find((c) => c.candidateType === "reference")
    expect(refCandidate).toBeDefined()
  })
})

describe("getCandidateDir", () => {
  test("returns semantic/candidates path", () => {
    const result = getCandidateDir("/memory")
    expect(result).toContain("semantic")
    expect(result).toContain("candidates")
  })
})
