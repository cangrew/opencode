export * as HybridTemplates from "./templates"

export type Template = "EXTRACT" | "SUMMARIZE" | "FILTER"

const EXTRACT_PROMPT = `You compress tool output for another assistant. Extract only the key lines and keep every file path, line number, identifier, and reference verbatim. Do not paraphrase code. Drop noise (blank lines, repeated boilerplate). Output the extracted lines only, no commentary.`

const SUMMARIZE_PROMPT = `You compress tool output for another assistant. Summarize the content as 3-6 terse bullet points capturing the essential facts. Preserve any exact identifiers, paths, or error strings. Output the bullets only, no commentary.`

const FILTER_PROMPT = `You compress tool output for another assistant. Keep only the meaningful items (errors, warnings, changed lines, diff hunks, failures) and drop routine/duplicate lines. Preserve each kept line verbatim, including paths and line numbers. Output the kept lines only, no commentary.`

const PROMPTS: Record<Template, string> = {
  EXTRACT: EXTRACT_PROMPT,
  SUMMARIZE: SUMMARIZE_PROMPT,
  FILTER: FILTER_PROMPT,
}

export const buildPrompt = (template: Template, content: string): string =>
  `${PROMPTS[template]}\n\n<tool-output>\n${content}\n</tool-output>`

const EXTRACT_TOOLS = new Set(["grep", "glob", "bash"])
const SUMMARIZE_TOOLS = new Set(["read", "webfetch"])

const DIFF_MARKERS = ["diff --git ", "@@ ", "+++ ", "--- ", "index "]
const LOG_LINE = /^\s*(\[?\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL)\b/

export const looksLikeDiffOrLog = (content: string): boolean => {
  const lines = content.split("\n")
  if (lines.some((line) => DIFF_MARKERS.some((marker) => line.startsWith(marker)))) return true
  const logLines = lines.filter((line) => LOG_LINE.test(line)).length
  return lines.length > 0 && logLines / lines.length >= 0.5
}

export const selectTemplate = (toolName: string, content: string): Template => {
  if (looksLikeDiffOrLog(content)) return "FILTER"
  const tool = toolName.toLowerCase()
  if (SUMMARIZE_TOOLS.has(tool)) return "SUMMARIZE"
  if (EXTRACT_TOOLS.has(tool)) return "EXTRACT"
  return "EXTRACT"
}
