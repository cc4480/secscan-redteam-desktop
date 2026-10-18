/** `steps.role` union. */
export const STEP_ROLES = ["prompt", "tool", "observation"];
/** `metrics.failure_mode` union. */
export const FAILURE_MODES = ["missed-vuln", "fp-blowup", "tool-error", "step-exhaustion", "timeout", "none"];
/** Run outcomes kept for the CLI/list filter; derived from success+crashed+failure_mode. */
export const RUN_OUTCOMES = ["success", "partial", "failure", "aborted"];
//# sourceMappingURL=store-model.js.map