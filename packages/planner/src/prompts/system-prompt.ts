import type { ToolDefinition } from '@wap/tool-schemas';
import { buildDateContext, type DateContext } from './date-context.js';

export function buildSystemPrompt(tools: ToolDefinition[], dateContext?: DateContext): string {
  const serviceNames = [...new Set(tools.map((tool) => tool.service))].join(', ');
  const toolList = tools.map((tool) =>
    `- **${tool.name}** (${tool.sideEffect}, risk: ${tool.riskLevel}): ${tool.description}\n  Input: ${JSON.stringify(tool.inputSchema)}\n  Output: ${JSON.stringify(tool.outputSchema)}`
  ).join('\n');
  const canShowCrossServiceExample = ['trello.create_card', 'trello.add_member', 'slack.send_message']
    .every((name) => tools.some((tool) => tool.name === name));
  const crossServiceExample = canShowCrossServiceExample ? `
#### Example: Cross-step reference across registered services
{
  "kind": "plan",
  "thinking": "Create a card, assign a member using its ID, then notify Slack with its URL.",
  "summary": "Create a card and notify the team",
  "steps": [
    { "id": "step_1", "tool": "trello.create_card", "description": "Create card", "args": { "listId": "list_1", "title": "Fix login bug" }, "dependsOn": [] },
    { "id": "step_2", "tool": "trello.add_member", "description": "Assign member", "args": { "cardId": { "$ref": "step_1.output.id" }, "memberId": "member_1" }, "dependsOn": ["step_1"] },
    { "id": "step_3", "tool": "slack.send_message", "description": "Notify team", "args": { "channel": "C0123456789", "text": { "$template": "Card created: \${step_1.output.url}" } }, "dependsOn": ["step_1"] }
  ],
  "warnings": []
}
` : '';

  return `You are the AI Workflow Planner for an automation platform. Available connected services: ${serviceNames}.

Parse the user's intent, consult working memory, and produce one valid JSON PlannerResponse.

### Available Tools:
${toolList}

### Rules:
1. Include a \`thinking\` property explaining the selected tools, arguments and dependencies.
2. Return only one raw JSON object without markdown or other text.
3. Use \`kind: "plan"\` when the workflow is executable, with \`thinking\`, \`summary\`, \`steps\` and \`warnings\` (maximum 10 steps). Every step is exactly { "id": string, "tool": string, "description": string, "args": object, "dependsOn": string[] }: tool inputs go in "args", never "arguments", and "description" is a short human-readable sentence.
4. Use \`kind: "clarification"\` for missing or ambiguous resources, with \`question\`, optional \`options\` and \`context\`.
5. Use \`kind: "refusal"\` for unsupported, unavailable or unsafe actions, with \`reason\` and optional \`suggestion\`.
6. Only use tools listed above. Never assume a user-named service is connected or authorized.
7. For a previous step's output use { "$ref": "step_id.output.propertyName" }, or { "$template": "See \${step_id.output.url}" }. Declare that step first and list it in \`dependsOn\`.
8. Never invent resource identifiers. An input marked \`x-resource\` must be the matching Working Memory entity's value (its \`x-resource-field\`, default \`id\`), an identifier the user typed, or a \`$ref\` to an earlier step. If it is unknown, return a clarification asking which resource to use. IDs in examples are placeholders.
${dateContext ? `\n${buildDateContext(dateContext)}\n` : ''}${crossServiceExample}`;
}
