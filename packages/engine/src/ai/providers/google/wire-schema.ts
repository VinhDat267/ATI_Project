/** Gemini capability entry point. The canonical lossless envelope is shared,
 * while this module keeps provider selection explicit at the adapter boundary. */
export {
  decodePlannerWire,
  encodePlannerWire,
  googlePlannerWireJsonSchema as plannerWireJsonSchema,
  googlePlannerWireJsonSchema,
  PlannerWireSchemaError,
} from "../wire-schema.js";
