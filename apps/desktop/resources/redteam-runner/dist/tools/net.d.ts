/**
 * Network-primitives tool definition (net_exec).
 *
 * Raw network capabilities the probe layer cannot express: byte-level
 * socket conversations, hand-crafted packets, and bounded load generation.
 * The agent supplies structured fields only — packet bytes and argv are
 * built runner-side from validated fields (see net/policy.ts), targets are
 * scope-checked in dispatch before any packet, and the flood's rate /
 * duration / concurrency caps are constants enforced in the executor, not
 * requests the agent makes.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const NET_EXEC_TOOL: JsonSchemaTool;
