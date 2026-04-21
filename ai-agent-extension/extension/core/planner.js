// Planner - builds AI prompts and parses structured plans

export class Planner {
  buildPlanPrompt(goal, memoryContext = []) {
    const memorySection = memoryContext.length > 0
      ? `\nProject context:\n${memoryContext.map(m => `- ${m.key}: ${m.value}`).join("\n")}\n`
      : "";

    return `You MUST respond ONLY in valid JSON. No explanations or markdown.
${memorySection}
Create a step-by-step execution plan for:
"${goal}"

Use this exact JSON structure:
{
  "goal": "${goal}",
  "tasks": [
    {
      "name": "Descriptive task name",
      "steps": [
        {
          "action": "write_file",
          "path": "relative/file/path",
          "content": "file content here"
        },
        {
          "action": "execute_command",
          "cmd": "shell command to run"
        },
        {
          "action": "read_file",
          "path": "path/to/read"
        },
        {
          "action": "run_tests"
        }
      ]
    }
  ]
}

Rules:
- action must be one of: write_file, read_file, execute_command, run_tests
- Use relative paths only
- write_file must include both "path" and "content"
- execute_command must include "cmd"
- Keep steps atomic and specific
- Order steps logically (install deps before running)`;
  }

  buildFixPrompt(failedStep, error, originalPlan) {
    return `You MUST respond ONLY in valid JSON. No explanations.

A step in my plan failed. Fix it and return the corrected step.

Failed step:
${JSON.stringify(failedStep, null, 2)}

Error:
${error}

Return ONLY the corrected step as JSON:
{
  "action": "...",
  "path": "...",
  "content": "...",
  "cmd": "..."
}`;
  }

  parsePlan(responseText) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const plan = JSON.parse(jsonMatch[0]);
      if (!plan.goal || !Array.isArray(plan.tasks)) return null;

      return plan;
    } catch {
      return null;
    }
  }

  parseFixedStep(responseText) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const step = JSON.parse(jsonMatch[0]);
      if (!step.action) return null;

      return step;
    } catch {
      return null;
    }
  }
}
