// Planner — builds prompts and parses AI responses using shared parser utilities
import { safeExtractJSON } from "./parser.js";

export class Planner {
  buildPlanPrompt(goal, memoryContext = []) {
    const memSection = memoryContext.length > 0
      ? `\n### Project Context\n${memoryContext.map(m => `- ${m.key}: ${m.value}`).join("\n")}\n`
      : "";

    return `You MUST respond ONLY in valid JSON. No markdown, no explanation, no code fences.
${memSection}
Create a step-by-step execution plan for this goal:
"${goal}"

Respond with this exact JSON structure:
{
  "goal": "${goal}",
  "tasks": [
    {
      "name": "Descriptive task name",
      "steps": [
        { "action": "write_file", "path": "relative/path.ts", "content": "file content" },
        { "action": "execute_command", "cmd": "npm install" },
        { "action": "read_file", "path": "path/to/read" },
        { "action": "run_tests" },
        { "action": "git_commit", "message": "feat: add feature" }
      ]
    }
  ]
}

Rules:
- action must be one of: write_file, read_file, execute_command, install_package, run_tests, git_commit
- Use relative paths only
- write_file needs "path" + "content"
- execute_command needs "cmd"
- Order steps logically (install deps before running)
- Keep steps atomic`;
  }

  buildFixPrompt(failedStep, error) {
    return `You MUST respond ONLY in valid JSON. No explanation.

A step in my coding agent plan failed. Fix it.

Failed step:
${JSON.stringify(failedStep, null, 2)}

Error message:
${error}

Return ONLY the corrected step as JSON:
{ "action": "...", "path": "...", "content": "...", "cmd": "..." }`;
  }

  parsePlan(responseText) {
    const plan = safeExtractJSON(responseText);
    if (!plan || !Array.isArray(plan.tasks)) return null;
    return plan;
  }

  parseFixedStep(responseText) {
    const step = safeExtractJSON(responseText);
    if (!step || !step.action) return null;
    return step;
  }
}
