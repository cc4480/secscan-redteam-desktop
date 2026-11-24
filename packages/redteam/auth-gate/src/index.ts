export {
  SERVER_CHALLENGE_PREFIX,
  SERVER_TOKEN_PREFIX,
  extractDomain,
  isDomainVerified,
  normalizeDomain,
  parseVerifiedDomains,
  verificationInstructions,
} from './verify.js'
export {
  LocalDomainVerifier,
  challengeRecordName,
  emptyRecord,
  recordIsVerified,
  txtRecordsContainToken,
  withPending,
  withVerified,
} from './local.js'
export type { LocalVerifierDeps, VerificationRecord } from './local.js'
export { fetchVerifiedDomains, isServerVerified } from './server.js'
export type { ServerVerificationConfig } from './server.js'
export { defaultVerificationStoreFile, VerificationStore, writeFileAtomic } from './local-store.js'
export type { StoreDoc, VerifiedRecord, PendingRecord } from './local-store.js'
export { decide, isHostFamilyProbe, isScanTool, targetDomain, wantsActiveTesting } from './hook.js'
export type { GateContext, GateDecision, PreExecuteEvent } from './hook.js'
