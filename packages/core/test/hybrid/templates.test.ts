import { describe, expect, test } from "bun:test"
import { HybridTemplates } from "@opencode-ai/core/hybrid/templates"

const proseLines = Array.from({ length: 10 }, (_, i) => `This is an ordinary sentence number ${i} about the design.`).join("\n")

describe("HybridTemplates.selectTemplate", () => {
  test("grep selects EXTRACT", () => {
    expect(HybridTemplates.selectTemplate("grep", "src/a.ts:12: const x = 1\nsrc/b.ts:4: const y = 2")).toBe("EXTRACT")
  })

  test("glob selects EXTRACT", () => {
    expect(HybridTemplates.selectTemplate("glob", "src/a.ts\nsrc/b.ts\nsrc/c.ts")).toBe("EXTRACT")
  })

  test("bash selects EXTRACT for non-log output", () => {
    expect(HybridTemplates.selectTemplate("bash", "total 12\ndrwxr-xr-x 3 user 96 a\n-rw-r--r-- 1 user 10 b")).toBe(
      "EXTRACT",
    )
  })

  test("read selects SUMMARIZE for prose", () => {
    expect(HybridTemplates.selectTemplate("read", proseLines)).toBe("SUMMARIZE")
  })

  test("diff content selects FILTER regardless of tool", () => {
    const diff = "diff --git a/x.ts b/x.ts\n@@ -1,3 +1,3 @@\n-const a = 1\n+const a = 2"
    expect(HybridTemplates.selectTemplate("read", diff)).toBe("FILTER")
  })

  test("log content selects FILTER", () => {
    const logs = [
      "2026-06-19 ERROR boom",
      "2026-06-19 WARN careful",
      "2026-06-19 INFO ok",
      "2026-06-19 DEBUG trace",
    ].join("\n")
    expect(HybridTemplates.selectTemplate("bash", logs)).toBe("FILTER")
  })
})

describe("HybridTemplates.buildPrompt", () => {
  test("wraps content in tool-output tags", () => {
    const prompt = HybridTemplates.buildPrompt("EXTRACT", "hello")
    expect(prompt).toContain("<tool-output>\nhello\n</tool-output>")
  })
})
