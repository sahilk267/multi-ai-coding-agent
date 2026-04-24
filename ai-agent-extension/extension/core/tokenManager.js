// Heuristic token estimation: ~chars/4. Builds a context that fits per-model limits,
// and budgets a raw prompt string for a specific provider before dispatch.
export const MODEL_LIMITS = {
  chatgpt: 8000,
  deepseek: 8000,
  qwen: 8000,
  gemini: 32000,
};

// Default chars per token. Override via opts.charsPerToken in tests.
export const CHARS_PER_TOKEN = 4;

// Marker inserted when we elide the middle of an oversized prompt.
export const TRUNCATION_MARKER = "\n\n... [truncated by tokenManager: %dropped% tokens dropped] ...\n\n";

export function estimateTokens(text, charsPerToken = CHARS_PER_TOKEN) {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerToken);
}

export function getModelLimit(model) {
  return MODEL_LIMITS[model] || 8000;
}

/**
 * Compute how many tokens a provider will accept for a single prompt.
 *   limit = MODEL_LIMITS[model]
 *   budget = limit - reserved   (reserved = headroom for the model's reply)
 */
export function getPromptBudget(model, reserved = 1024) {
  const limit = getModelLimit(model);
  return Math.max(0, limit - reserved);
}

/**
 * Budget a single prompt string for a provider.
 *
 * Strategy:
 *   - if it fits, return it untouched.
 *   - otherwise keep `headRatio` of the budget at the start (instructions /
 *     schema usually live there) and the remainder at the tail (the actual
 *     question / error usually lives there), with a marker in between.
 *
 * Returns { prompt, tokens, budget, dropped, truncated, model }.
 */
export function budgetPrompt(prompt, model, opts = {}) {
  const reserved = opts.reserved ?? 1024;
  const headRatio = opts.headRatio ?? 0.6;
  const charsPerToken = opts.charsPerToken ?? CHARS_PER_TOKEN;
  const budget = getPromptBudget(model, reserved);
  const text = prompt == null ? "" : String(prompt);
  const original = estimateTokens(text, charsPerToken);

  if (original <= budget || budget <= 0) {
    return {
      prompt: text,
      tokens: original,
      budget,
      dropped: 0,
      truncated: false,
      model,
    };
  }

  // Reserve enough room for the marker itself.
  const markerTokens = estimateTokens(TRUNCATION_MARKER, charsPerToken);
  const usable = Math.max(0, budget - markerTokens);

  const headTokens = Math.floor(usable * headRatio);
  const tailTokens = usable - headTokens;
  const headChars = headTokens * charsPerToken;
  const tailChars = tailTokens * charsPerToken;

  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(text.length - tailChars) : "";
  const dropped = original - headTokens - tailTokens;
  const marker = TRUNCATION_MARKER.replace("%dropped%", String(dropped));
  const out = head + marker + tail;

  return {
    prompt: out,
    tokens: estimateTokens(out, charsPerToken),
    budget,
    dropped,
    truncated: true,
    model,
  };
}

/**
 * Build a structured context that fits a model's prompt budget. Items are
 * pushed in priority order; anything that would exceed the budget is dropped.
 *
 * Priority (per spec): task > relevantFiles > summaries > recent > older.
 */
export function buildContext(
  { task, relevantFiles = [], summaries = [], recent = [], older = [] },
  model = "chatgpt",
  opts = {},
) {
  const reserved = opts.reserved ?? 1024;
  const charsPerToken = opts.charsPerToken ?? CHARS_PER_TOKEN;
  const budget = getPromptBudget(model, reserved);
  const out = [];
  let used = 0;
  const push = (label, text) => {
    if (!text) return false;
    const tokens = estimateTokens(text, charsPerToken);
    if (used + tokens > budget) return false;
    out.push(`### ${label}\n${text}`);
    used += tokens;
    return true;
  };
  push("TASK", task || "");
  for (const f of relevantFiles) push(`FILE ${f.path}`, f.content);
  for (const s of summaries) push(`SUMMARY ${s.path}`, JSON.stringify(s));
  for (const h of recent) push("RECENT", typeof h === "string" ? h : JSON.stringify(h));
  for (const h of older) push("OLDER", typeof h === "string" ? h : JSON.stringify(h));
  return { prompt: out.join("\n\n"), tokens: used, budget };
}
