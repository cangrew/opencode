# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [AGENTS.md](./AGENTS.md) for branch naming, commit conventions, style guide, testing rules, and V2 Session Core architecture constraints. All of those rules apply here.

## Commands

```bash
bun install               # install dependencies
bun dev                   # run TUI against current dir
bun dev <path>            # run TUI against another directory
bun dev:desktop           # run desktop app
bun dev:web               # run web interface
bun lint                  # run oxlint
bun typecheck             # type-check all packages via Turbo
```

Tests must be run from a package directory, not the repo root:

```bash
cd packages/core && bun test
cd packages/opencode && bun test
```

Type-checking also runs per-package:

```bash
cd packages/opencode && bun typecheck
```

## Monorepo Structure

This is a Bun workspace monorepo using Turbo. Key packages:

| Package | Role |
|---|---|
| `packages/opencode` | Main CLI entry point and HTTP server |
| `packages/core` | Session runtime, database (Drizzle + SQLite), tool registry, LLM integration |
| `packages/tui` | Terminal UI built with SolidJS + opentui |
| `packages/app` | Web UI components (SolidJS + Vite + Tailwind) |
| `packages/desktop` | Electron desktop app wrapping `packages/app` |
| `packages/llm` | LLM provider integrations via Vercel AI SDK |
| `packages/plugin` | Plugin SDK for third-party extensions |
| `packages/sdk/js` | JavaScript SDK; regenerate with `./packages/sdk/js/script/build.ts` |

## Tech Stack

- **Runtime**: Bun (prefer Bun APIs like `Bun.file()` over Node equivalents)
- **Language**: TypeScript with Effect 4.x for functional patterns in `packages/core`
- **UI**: SolidJS across TUI, web, and desktop surfaces
- **Database**: SQLite via Drizzle ORM; schema uses snake_case column names (see AGENTS.md)
- **Default branch**: `dev` (local `main` may not exist; diff against `origin/dev`)
