import { z } from 'zod';

export const V2SourceFixtureSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  requestId: z.string().min(1),
  spreadsheetId: z.string().optional(),
  tabId: z.string().optional(),
}).strict();

export type V2SourceFixture = z.infer<typeof V2SourceFixtureSchema>;

export const V2ExpectedToolCallSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
}).strict();

export type V2ExpectedToolCall = z.infer<typeof V2ExpectedToolCallSchema>;

export const V2ExpectedSchema = z.object({
  kind: z.enum(['plan', 'refusal', 'clarification']),
  terminalStatus: z.enum([
    'planning',
    'awaiting_approval',
    'running',
    'succeeded',
    'failed',
    'rejected',
    'expired',
    'refused',
    'needs_input',
    'reconciliation_required',
  ]),
  writeCount: z.number().int().min(0).max(1),
  missingFields: z.array(z.string()).optional(),
  toolCalls: z.array(V2ExpectedToolCallSchema).optional(),
  refusalReason: z.string().optional(),
  clarificationQuestion: z.string().optional(),
  evidencePositions: z.record(z.string(), z.string()).optional(),
}).strict();

export type V2Expected = z.infer<typeof V2ExpectedSchema>;

export const V2EvidenceSchema = z.object({
  mode: z.enum([
    'CONTRACT_TESTED',
    'SAAS_LIVE_EXERCISED',
    'AI_QUALITY_MEASURED',
    'CUSTOMER_VALIDATED',
  ]),
  commit: z.string().min(1),
  artifactPath: z.string().optional(),
  observed: z.record(z.string(), z.unknown()).optional(),
  verdict: z.enum(['PASS', 'FAIL', 'NOT_RUN']),
}).strict();

export type V2Evidence = z.infer<typeof V2EvidenceSchema>;

export const V2ResourcePolicySchema = z.object({
  allowedSources: z.array(z.string()),
  allowedTargets: z.array(z.string()),
  allowedPrincipals: z.array(z.string()),
}).strict();

export type V2ResourcePolicy = z.infer<typeof V2ResourcePolicySchema>;

export const V2FaultTypeSchema = z.enum([
  'none',
  'timeout',
  'crash',
  'unauthorized',
  'duplicate_intent',
  'expired_ttl',
  'double_click',
]);

export type V2FaultType = z.infer<typeof V2FaultTypeSchema>;

export const V2TestCaseSchema = z.object({
  caseId: z.string().regex(/^(?:V2-(?:0[1-9]|1[0-9]|20)|H-(?:0[1-9]|10))$/),
  variantId: z.string().min(1),
  language: z.enum(['vi', 'en']),
  origin: z.literal('reconstructed_synthetic'),
  sourceRefs: z.array(z.string()),
  sourceFixture: V2SourceFixtureSchema,
  prompt: z.string().min(1),
  principal: z.string().min(1),
  resourcePolicy: V2ResourcePolicySchema,
  fault: V2FaultTypeSchema,
  expected: V2ExpectedSchema,
  evidence: V2EvidenceSchema,
  note: z.string().optional(),
}).strict();

export type V2TestCase = z.infer<typeof V2TestCaseSchema>;

export const V2DatasetSchema = z.object({
  profile: z.literal('pilot-v2'),
  evidence: z.literal('RECONSTRUCTED_SYNTHETIC_DATASET_NOT_CUSTOMER_VALIDATED'),
  version: z.string().min(1),
  cases: z.array(V2TestCaseSchema),
}).strict();

export type V2Dataset = z.infer<typeof V2DatasetSchema>;
