// Node test runner: `node --test ai-agent/extension/core/tokenManager.test.mjs`
// Exercises the per-provider prompt budgeting that background.js now applies
// before every AI_SEND.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_LIMITS,
  estimateTokens,
  getPromptBudget,
  budgetPrompt,
  buildContext,
  CHARS_PER_TOKEN,
} from "./tokenManager.js";

test("estimateTokens uses chars/4 heuristic", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(400)), 100);
});

test("getPromptBudget reserves headroom for reply", () => {
  assert.equal(getPromptBudget("chatgpt", 1024), MODEL_LIMITS.chatgpt - 1024);
  assert.equal(getPromptBudget("gemini", 2000), MODEL_LIMITS.gemini - 2000);
  assert.equal(getPromptBudget("unknown-model", 0), 8000);
});

test("budgetPrompt is a no-op when the prompt fits", () => {
  const prompt = "small prompt";
  const r = budgetPrompt(prompt, "chatgpt");
  assert.equal(r.truncated, false);
  assert.equal(r.dropped, 0);
  assert.equal(r.prompt, prompt);
  assert.ok(r.tokens <= r.budget);
});

test("budgetPrompt truncates oversized prompts and keeps head + tail", () => {
  const head = "HEAD_MARKER_BEGIN " + "h".repeat(50000);
  const tail = "t".repeat(50000) + " TAIL_MARKER_END";
  const prompt = head + tail;
  const r = budgetPrompt(prompt, "chatgpt"); // 8000 - 1024 = 6976 token budget
  assert.equal(r.truncated, true);
  assert.ok(r.dropped > 0, "should report dropped tokens");
  assert.ok(r.tokens <= r.budget, `tokens ${r.tokens} must fit budget ${r.budget}`);
  assert.ok(r.prompt.startsWith("HEAD_MARKER_BEGIN"), "head must be preserved");
  assert.ok(r.prompt.endsWith("TAIL_MARKER_END"), "tail must be preserved");
  assert.match(r.prompt, /truncated by tokenManager/);
});

test("budgetPrompt respects per-provider limits (gemini >> chatgpt)", () => {
  const prompt = "x".repeat(80000); // 20000 tokens
  const c = budgetPrompt(prompt, "chatgpt");
  const g = budgetPrompt(prompt, "gemini");
  assert.equal(c.truncated, true);
  assert.equal(g.truncated, false, "gemini's 32k window should swallow 20k tokens");
  assert.ok(g.tokens > c.tokens, "gemini should keep more content than chatgpt");
});

test("budgetPrompt headRatio shifts content distribution", () => {
  const prompt = "A".repeat(20000) + "B".repeat(20000);
  const headHeavy = budgetPrompt(prompt, "chatgpt", { headRatio: 0.9 });
  const tailHeavy = budgetPrompt(prompt, "chatgpt", { headRatio: 0.1 });
  const countA = (s) => (s.match(/A/g) || []).length;
  const countB = (s) => (s.match(/B/g) || []).length;
  assert.ok(countA(headHeavy.prompt) > countA(tailHeavy.prompt));
  assert.ok(countB(tailHeavy.prompt) > countB(headHeavy.prompt));
});

test("budgetPrompt handles empty / null prompts", () => {
  for (const p of ["", null, undefined]) {
    const r = budgetPrompt(p, "chatgpt");
    assert.equal(r.truncated, false);
    assert.equal(r.tokens, 0);
    assert.equal(r.prompt, "");
  }
});

test("budgetPrompt charsPerToken override changes accounting", () => {
  const prompt = "x".repeat(40000);
  const def = budgetPrompt(prompt, "chatgpt"); // chars/4 -> 10000 tokens, truncates
  const looser = budgetPrompt(prompt, "chatgpt", { charsPerToken: 8 }); // 5000 tokens, fits
  assert.equal(def.truncated, true);
  assert.equal(looser.truncated, false);
});

test("buildContext drops low-priority items first", () => {
  const big = "z".repeat(40000); // 10000 tokens
  const ctx = buildContext(
    {
      task: "do the thing",
      relevantFiles: [{ path: "main.js", content: big }],
      summaries: [{ path: "lib.js", summary: big }],
      recent: [big],
      older: [big],
    },
    "chatgpt",
  );
  assert.ok(ctx.tokens <= ctx.budget);
  assert.match(ctx.prompt, /TASK\ndo the thing/);
  // Should not contain every big blob — older/recent get dropped.
  assert.ok(ctx.prompt.length < big.length * 4);
});

test("CHARS_PER_TOKEN constant is exported and sane", () => {
  assert.equal(CHARS_PER_TOKEN, 4);
});
