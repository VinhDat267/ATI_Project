import { describe, expect, it } from 'vitest';
import type { WorkflowPlan } from '@wap/dsl';
import { validatePilotQualityPlan } from '../src/pilot/quality-plan-validator.js';

function readPlan(): WorkflowPlan {
  return {
    version: '1.0', name: 'Read board lists', source_prompt: 'Find lists', inputs: {},
    steps: [{
      id: 'lists', description: 'Read lists',
      tool: { server: 'trello', name: 'list_lists', args: { boardId: 'board-1' } },
      depends_on: [], condition: null,
      retry: { max_attempts: 3, backoff: 'exponential', initial_delay_ms: 500 },
      idempotency_key: null as string | null, side_effect: 'read', on_error: 'fail', timeout_ms: 30000,
    }],
    outputs: { lists: '${steps.lists.output}' },
  };
}

function writePlan() {
  const plan = readPlan();
  plan.steps[0] = {
    ...plan.steps[0]!, id: 'create', description: 'Create task', side_effect: 'write',
    idempotency_key: 'pilot:${runtime.run_id}',
    tool: { server: 'trello', name: 'create_card', args: {
      boardId: 'board-1', listName: 'Todo', title: 'Design landing page',
    } },
  };
  plan.outputs = { lists: '${steps.create.output.cardId}' };
  return plan;
}

describe('strict Pilot quality plan validation', () => {
  it('accepts a reviewed read plan without mutating the model result', () => {
    const plan = readPlan();
    const original = structuredClone(plan);
    expect(validatePilotQualityPlan(plan)).toEqual([]);
    expect(plan).toEqual(original);
  });

  it('accepts reviewed create-card planning args without runtime-managed intentKey', () => {
    const plan = writePlan();
    const original = structuredClone(plan);
    expect(plan.steps[0]!.idempotency_key).toBe('pilot:${runtime.run_id}');
    expect(plan.steps[0]!.tool.args).not.toHaveProperty('intentKey');
    expect(validatePilotQualityPlan(plan)).toEqual([]);
    expect(plan).toEqual(original);
  });

  it.each([null, ''])('rejects a write without a nonempty idempotency key: %s', (key) => {
    const plan = writePlan();
    plan.steps[0]!.idempotency_key = key;
    expect(validatePilotQualityPlan(plan)).toEqual(['workflow_schema_invalid']);
  });

  it('rejects malformed workflow structure with a fixed schema reason', () => {
    expect(validatePilotQualityPlan({ steps: [] })).toEqual(['workflow_schema_invalid']);
  });

  it.each(['delete_card', 'unknown_tool'])('rejects unreviewed tool identity %s', (name) => {
    const plan = readPlan();
    plan.steps[0]!.tool.name = name;
    expect(validatePilotQualityPlan(plan)).toEqual(['tool_contract_invalid', 'reference_path_invalid']);
  });

  it('rejects a mismatched tool server', () => {
    const plan = readPlan();
    plan.steps[0]!.tool.server = 'untrusted';
    expect(validatePilotQualityPlan(plan)).toEqual(['tool_contract_invalid', 'reference_path_invalid']);
  });

  it('rejects arguments outside the trusted input schema without coercion', () => {
    const plan = readPlan();
    plan.steps[0]!.tool.args.boardId = 42;
    expect(validatePilotQualityPlan(plan)).toEqual(['tool_contract_invalid']);
  });

  it('rejects a model side-effect policy that differs from the catalog', () => {
    const plan = writePlan();
    plan.steps[0]!.side_effect = 'read';
    plan.steps[0]!.idempotency_key = null;
    expect(validatePilotQualityPlan(plan)).toEqual(['tool_contract_invalid']);
  });

  it('rejects missing dependency targets', () => {
    const plan = readPlan();
    plan.steps[0]!.depends_on = ['missing'];
    expect(validatePilotQualityPlan(plan)).toEqual(['workflow_graph_invalid']);
  });

  it('rejects a step-output argument without the required dependency', () => {
    const plan = readPlan();
    plan.steps.push({ ...plan.steps[0]!, id: 'members',
      tool: { server: 'trello', name: 'list_members', args: { boardId: '${steps.lists.output.0.id}' } },
    });
    expect(validatePilotQualityPlan(plan)).toEqual(['workflow_graph_invalid']);
  });

  it.each(['${steps.lists.result}', '${steps.lists.output.0.id', '${steps.lists.output.constructor}'])
  ('rejects malformed or unsafe argument references: %s', (reference) => {
    const plan = readPlan();
    plan.steps[0]!.tool.args.boardId = reference;
    expect(validatePilotQualityPlan(plan)).toContain('reference_path_invalid');
  });

  it('accepts array-item property references with a declared dependency', () => {
    const plan = readPlan();
    plan.steps.push({ ...plan.steps[0]!, id: 'members', depends_on: ['lists'],
      tool: { server: 'trello', name: 'list_members', args: { boardId: '${steps.lists.output.0.id}' } },
    });
    plan.outputs = { lists: '${steps.members.output.0.fullName}' };
    expect(validatePilotQualityPlan(plan)).toEqual([]);
  });

  it.each(['${steps.lists.output.0.absent}', '${steps.lists.output.id}', '${steps.lists.output.01.id}'])
  ('rejects output paths the array schema cannot prove: %s', (reference) => {
    const plan = readPlan();
    plan.outputs.lists = reference;
    expect(validatePilotQualityPlan(plan)).toEqual(['reference_path_invalid']);
  });

  it('rejects nonexistent paths nested in tool argument objects and arrays', () => {
    const plan = readPlan();
    plan.steps.push({ ...plan.steps[0]!, id: 'members', depends_on: ['lists'],
      tool: { server: 'trello', name: 'list_members', args: {
        boardId: [{ nested: '${steps.lists.output.0.absent}' }],
      } },
    });
    expect(validatePilotQualityPlan(plan)).toEqual(['tool_contract_invalid', 'reference_path_invalid']);
  });

  it('fails closed on unstructured reviewed output objects', () => {
    const plan = readPlan();
    plan.steps[0]!.tool = { server: 'google_sheets', name: 'read_request',
      args: { spreadsheetId: 'sheet-1', tabId: 'tab-1', requestId: 'request-1' } };
    plan.outputs.lists = '${steps.lists.output.row.unreviewedField}';
    expect(validatePilotQualityPlan(plan)).toEqual(['reference_path_invalid']);
  });

  it('deduplicates fixed issue codes for multiple invalid paths', () => {
    const plan = readPlan();
    plan.outputs = { lists: '${steps.lists.output.0.absent}', another: '${steps.lists.output.0.missing}' } as typeof plan.outputs;
    expect(validatePilotQualityPlan(plan)).toEqual(['reference_path_invalid']);
  });

  it('rejects invalid concrete args alongside a valid reference', () => {
    const plan = writePlan();
    plan.steps.unshift(readPlan().steps[0]!);
    plan.steps[1]!.depends_on = ['lists'];
    plan.steps[1]!.tool.args.listName = '${steps.lists.output.0.name}';
    plan.steps[1]!.tool.args.title = 42;
    expect(validatePilotQualityPlan(plan)).toEqual(['tool_contract_invalid']);
  });

  it('rejects missing required args even when another argument is deferred', () => {
    const plan = writePlan();
    plan.steps[0]!.tool.args.title = '${runtime.today}';
    delete plan.steps[0]!.tool.args.boardId;
    expect(validatePilotQualityPlan(plan)).toEqual(['tool_contract_invalid']);
  });
});
