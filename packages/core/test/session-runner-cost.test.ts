import { describe, expect, test } from "bun:test"
import { SessionRunnerCost } from "@opencode-ai/core/session/runner/cost"

describe("SessionRunnerCost", () => {
  test("computes cost from usd-per-million prices", () => {
    expect(
      SessionRunnerCost.computeCost(
        [
          {
            input: 2,
            output: 4,
            cache: {
              read: 1,
              write: 3,
            },
          },
        ],
        {
          input: 100,
          output: 50,
          reasoning: 10,
          cache: {
            read: 20,
            write: 30,
          },
        },
        150,
      ),
    ).toBe((100 * 2 + (50 + 10) * 4 + 20 * 1 + 30 * 3) / 1_000_000)
  })

  test("returns zero when pricing is unknown", () => {
    expect(
      SessionRunnerCost.computeCost(
        [],
        {
          input: 100,
          output: 50,
          reasoning: 10,
          cache: {
            read: 20,
            write: 30,
          },
        },
        150,
      ),
    ).toBe(0)
  })

  test("selects the highest matching context tier", () => {
    expect(
      SessionRunnerCost.computeCost(
        [
          {
            input: 1,
            output: 1,
            cache: {
              read: 1,
              write: 1,
            },
          },
          {
            tier: {
              type: "context",
              size: 200,
            },
            input: 10,
            output: 10,
            cache: {
              read: 10,
              write: 10,
            },
          },
        ],
        {
          input: 10,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        199,
      ),
    ).toBe(10 / 1_000_000)
    expect(
      SessionRunnerCost.computeCost(
        [
          {
            input: 1,
            output: 1,
            cache: {
              read: 1,
              write: 1,
            },
          },
          {
            tier: {
              type: "context",
              size: 200,
            },
            input: 10,
            output: 10,
            cache: {
              read: 10,
              write: 10,
            },
          },
        ],
        {
          input: 10,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        200,
      ),
    ).toBe(100 / 1_000_000)
  })
})
