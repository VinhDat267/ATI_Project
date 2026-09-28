import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AIPlanner,
  MockLLMProvider,
  WorkingMemory,
  type LLMProvider,
} from '@wap/planner';
import {
  TRELLO_TOOLS,
  SLACK_TOOLS,
  type PlannerResponse,
} from '@wap/tool-schemas';

export interface GoldenPrompt {
  id: string;
  category: 'happy_path' | 'edge_case';
  prompt: string;
  expectedKind: 'plan' | 'clarification' | 'refusal';
  expectedTools: string[];
  context?: Record<string, any>;
}

export interface EvaluationOptions {
  useMock?: boolean;
  provider?: LLMProvider;
}

export interface EvaluationDetail {
  id: string;
  category: 'happy_path' | 'edge_case';
  prompt: string;
  expectedKind: string;
  actualKind?: string;
  passed: boolean;
  syntaxValid: boolean;
  error?: string;
}

export interface EvaluationResults {
  totalPrompts: number;
  syntaxValidRate: number;
  happyPathAccuracy: number;
  edgeCaseAccuracy: number;
  usablePlanRate: number;
  details: EvaluationDetail[];
}

export function loadGoldenPrompts(): GoldenPrompt[] {
  const filePath = resolve(process.cwd(), 'evaluations', 'golden-prompts.json');
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as GoldenPrompt[];
}

function buildMockResponseForPrompt(prompt: GoldenPrompt): string {
  if (prompt.expectedKind === 'clarification') {
    return JSON.stringify({
      kind: 'clarification',
      question: `Làm rõ thông tin cho yêu cầu: ${prompt.prompt}`,
      options: ['Tùy chọn A', 'Tùy chọn B'],
      context: 'Thiếu tham số cần thiết để lập kế hoạch',
    });
  }

  if (prompt.expectedKind === 'refusal') {
    return JSON.stringify({
      kind: 'refusal',
      reason: 'Yêu cầu không thuộc phạm vi hỗ trợ hoặc vi phạm chính sách bảo mật.',
      suggestion: 'Vui lòng sử dụng các thao tác hợp lệ trên Trello hoặc Slack',
    });
  }

  // kind === 'plan'
  const steps = prompt.expectedTools.map((tool, idx) => {
    const stepId = `step_${idx + 1}`;
    const prevStepId = idx > 0 ? `step_${idx}` : undefined;
    const args: Record<string, any> = {};

    if (tool.startsWith('trello.')) {
      if (tool.includes('create_card')) {
        args.listId = 'list_123';
        args.title = 'Card title';
      } else if (tool.includes('update_card')) {
        args.cardId = 'card_123';
        args.title = 'Updated title';
      } else if (tool.includes('add_member')) {
        args.cardId = prevStepId ? { $ref: `${prevStepId}.output.id` } : 'card_123';
        args.memberId = 'member_123';
      } else if (tool.includes('add_checklist')) {
        args.cardId = prevStepId ? { $ref: `${prevStepId}.output.id` } : 'card_123';
        args.title = 'Checklist title';
      } else if (tool.includes('search_')) {
        args.query = 'search query';
        args.limit = 5;
      } else if (tool.includes('get_card')) {
        args.cardId = 'card_123';
      }
    } else if (tool.startsWith('slack.')) {
      if (tool.includes('send_message')) {
        args.channelId = 'C01234567';
        args.text = prevStepId
          ? { $template: `Hoàn tất bước: \${${prevStepId}.output.id}` }
          : 'Thông báo từ hệ thống';
      } else if (tool.includes('search_channels')) {
        args.query = 'channel query';
        args.limit = 5;
      }
    }

    return {
      id: stepId,
      tool,
      description: `Thực hiện ${tool}`,
      args,
      dependsOn: prevStepId ? [prevStepId] : [],
    };
  });

  return JSON.stringify({
    kind: 'plan',
    thinking: `Phân tích yêu cầu "${prompt.prompt}" và xây dựng kế hoạch gồm ${steps.length} bước`,
    summary: `Kế hoạch tự động hóa cho "${prompt.prompt}"`,
    steps,
    warnings: [],
  });
}

export async function runEvaluations(options: EvaluationOptions = {}): Promise<EvaluationResults> {
  const { useMock = true } = options;
  const goldenPrompts = loadGoldenPrompts();
  const allTools = [...TRELLO_TOOLS, ...SLACK_TOOLS];

  let syntaxValidCount = 0;
  let happyPathPassed = 0;
  let happyPathTotal = 0;
  let edgeCasePassed = 0;
  let edgeCaseTotal = 0;
  const details: EvaluationDetail[] = [];

  for (const item of goldenPrompts) {
    if (item.category === 'happy_path') {
      happyPathTotal++;
    } else {
      edgeCaseTotal++;
    }

    let provider: LLMProvider;
    if (useMock) {
      const mock = new MockLLMProvider();
      mock.setResponses([buildMockResponseForPrompt(item)]);
      provider = mock;
    } else if (options.provider) {
      provider = options.provider;
    } else {
      throw new Error('LLMProvider must be provided when useMock is false');
    }

    const planner = new AIPlanner({ provider, toolCatalog: allTools });
    const memory = new WorkingMemory();
    if (item.context) {
      for (const [k, v] of Object.entries(item.context)) {
        memory.setEntity(k, v);
      }
    }

    try {
      const response: PlannerResponse = await planner.processMessage({
        userMessage: item.prompt,
        history: [],
        memory,
      });

      syntaxValidCount++;

      let passed = false;
      if (item.expectedKind === response.kind) {
        if (response.kind === 'plan') {
          const usedTools = response.steps.map((s) => s.tool);
          const hasExpectedTools = item.expectedTools.every((t) => usedTools.includes(t));
          passed = hasExpectedTools;
        } else {
          // clarification or refusal
          passed = true;
        }
      }

      if (passed) {
        if (item.category === 'happy_path') {
          happyPathPassed++;
        } else {
          edgeCasePassed++;
        }
      }

      details.push({
        id: item.id,
        category: item.category,
        prompt: item.prompt,
        expectedKind: item.expectedKind,
        actualKind: response.kind,
        passed,
        syntaxValid: true,
      });
    } catch (err: any) {
      details.push({
        id: item.id,
        category: item.category,
        prompt: item.prompt,
        expectedKind: item.expectedKind,
        passed: false,
        syntaxValid: false,
        error: err?.message || String(err),
      });
    }
  }

  const totalPrompts = goldenPrompts.length;
  const syntaxValidRate = totalPrompts > 0 ? syntaxValidCount / totalPrompts : 0;
  const happyPathAccuracy = happyPathTotal > 0 ? happyPathPassed / happyPathTotal : 0;
  const edgeCaseAccuracy = edgeCaseTotal > 0 ? edgeCasePassed / edgeCaseTotal : 0;
  const usablePlanRate = totalPrompts > 0 ? (happyPathPassed + edgeCasePassed) / totalPrompts : 0;

  return {
    totalPrompts,
    syntaxValidRate,
    happyPathAccuracy,
    edgeCaseAccuracy,
    usablePlanRate,
    details,
  };
}
