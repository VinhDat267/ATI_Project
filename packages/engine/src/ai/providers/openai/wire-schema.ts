/** OpenAI capability entry point. The canonical lossless envelope is shared,
 * while this module keeps provider selection explicit at the adapter boundary. */
export {
  decodePlannerWire,
  encodePlannerWire,
  openAiPlannerWireJsonSchema as plannerWireJsonSchema,
  openAiPlannerWireJsonSchema,
  PlannerWireSchemaError,
} from "../wire-schema.js";
