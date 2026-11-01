import type { BolaIdentity } from "../src/types.js";
import type { DiagnosticResult } from "./scanner.js";
export declare function bolaProbe(baseOrigin: string, identities: [BolaIdentity, BolaIdentity], baseHeaders: Record<string, string>): Promise<DiagnosticResult["apiSecFindings"]>;
