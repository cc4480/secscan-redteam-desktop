#!/usr/bin/env node
/**
 * redteam-runner CLI.
 *
 *   redteam-runner start --target secscan.us --mode red \
 *     --objective "assess the external attack surface" \
 *     --scope secscan.us --exclude T1110
 *
 *   redteam-runner watch [--queue <dir>]   # run queued console jobs
 *
 * Fleet credentials resolve per dispatch through the router's fleet
 * configuration resolver: the launching environment first (MODEL_API_KEY
 * — the fleet's Meta key; DEEPSEEK_API_KEY, QWEN_API_KEY likewise), then
 * the app credentials store ($DSH_HOME/.credentials.yaml — the file the
 * Secure Vault writes), so a key seated in the app reaches the next
 * engagement without a restart. The provider selection follows the same
 * resolver, with the desktop's published fleet provider record
 * ($DSH_HOME/fleet-provider.json) consulted after the store, so a
 * provider change in the app reaches the fleet the same way. SECSCAN_MCP_TOKEN + SECSCAN_MCP_URL stay
 * environment-only (only the REDTEAM_VERIFY_VIA_SERVICE=1 verification
 * opt-in reads them).
 *
 * Local dev convenience: a .env file is loaded automatically (Node's
 * built-in process.loadEnvFile — no dotenv dependency). Checked in order:
 * cwd's .env first (so a project-local override always wins), then the
 * repo root's .env (so `cd runner && npx redteam-runner ...`, the
 * documented workflow, still finds the root-level .env next to
 * .env.example even though cwd is runner/, not the repo root). Variables
 * already present in the real environment (e.g. from a Secure Vault) take
 * precedence over anything in .env, per Node's documented behavior — this
 * never overrides a production credential source. No .env anywhere is fine.
 */
export {};
