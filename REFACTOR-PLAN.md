# REFACTOR-PLAN

Generated from `refactor-inventory.json`. Budget: **250 lines**.
Outstanding: **1448 files** across **259 components**
(20 byte-frozen engine copies excluded — splitting them voids the AS-IS guarantee).

## Method — one batch of three

Each batch is **three files**, worked **two agents per file**:

1. **Splitter** — creates sibling modules <= 250 lines, rewrites the original as a thin barrel re-exporting the same names. No behaviour change.
2. **Verifier** — independently checks export set equality against `HEAD`, module sizes, `tsc --noEmit`, and the file's own oracle (its spec, or generator-diff). Does not fix; reports.

The Lead runs `npx tsx scripts/verify-file-budget.ts` once per batch and re-records the ratchet.

## Section queue

| # | Section | Files | Excess lines |
|---:|---|---:|---:|
| 1 | `scripts` | 86 | 24802 |
| 2 | `apps/redteam-runner` | 179 | 16883 |
| 3 | `apps/web` | 55 | 16360 |
| 4 | `api/session-controller` | 29 | 12217 |
| 5 | `client/ui-chat` | 23 | 11065 |
| 6 | `client/ui-conversation` | 34 | 10792 |
| 7 | `api/gateway` | 14 | 10224 |
| 8 | `apps/desktop` | 48 | 10029 |
| 9 | `core/agent-loop` | 16 | 9565 |
| 10 | `core/tools` | 12 | 9502 |
| 11 | `experimental/ptc-runtime-python` | 5 | 8545 |
| 12 | `session/session-persistence-jsonl` | 13 | 8232 |
| 13 | `boot/app-boot` | 15 | 7745 |
| 14 | `client/ui-workspace` | 14 | 7657 |
| 15 | `subprocess/subprocess-local` | 18 | 6571 |
| 16 | `test-support/session-snapshot` | 10 | 6424 |
| 17 | `subagent/subagent` | 14 | 6366 |
| 18 | `client/ui-trajectory` | 13 | 6228 |
| 19 | `typert/generator` | 11 | 5861 |
| 20 | `experimental/webworker-runtime` | 25 | 5779 |
| 21 | `context/agent-instructions` | 5 | 5222 |
| 22 | `client/ui-primitives` | 24 | 5020 |
| 23 | `core/session` | 11 | 4879 |
| 24 | `llm/llm-pi-ai` | 16 | 4701 |
| 25 | `client/ui-settings-models` | 11 | 4441 |
| 26 | `client/ui-plugin-manager` | 5 | 4291 |
| 27 | `experimental/inspector` | 27 | 3913 |
| 28 | `compaction/compaction-basic` | 6 | 3793 |
| 29 | `apps/cli` | 12 | 3768 |
| 30 | `llm/llm-deepseek` | 11 | 3533 |
| 31 | `llm/llm` | 10 | 3343 |
| 32 | `experimental/agent-team` | 9 | 3283 |
| 33 | `client/modules` | 6 | 3134 |
| 34 | `subagent/subagent-codex` | 5 | 3061 |
| 35 | `test-support/llm-replay` | 2 | 3019 |
| 36 | `session-query/session-query-sqlite` | 4 | 2750 |
| 37 | `client/ui-dockkit` | 10 | 2657 |
| 38 | `boot/plugin-manager` | 5 | 2609 |
| 39 | `client/ui-renderer` | 5 | 2598 |
| 40 | `terminal/terminal-bash` | 5 | 2592 |
| 41 | `session/session-format-v0-to-v1` | 9 | 2537 |
| 42 | `mcp/mcp-client` | 6 | 2481 |
| 43 | `client/ui-directory-picker-browse` | 2 | 2312 |
| 44 | `session-query/session-query` | 9 | 2296 |
| 45 | `sandbox/sandbox-windows-acl` | 8 | 2224 |
| 46 | `subagent/subagent-claude-code` | 3 | 2179 |
| 47 | `redteam/llm-router` | 17 | 2162 |
| 48 | `extensions/cordis-host-runner` | 6 | 2133 |
| 49 | `client/ui-sidebar-right` | 9 | 2132 |
| 50 | `subagent/tool-subagent` | 4 | 2129 |
| 51 | `experimental/auto-review` | 3 | 2094 |
| 52 | `schedule/schedule` | 7 | 2047 |
| 53 | `fs/fs-local` | 4 | 1972 |
| 54 | `session-query/tool-session-query` | 5 | 1964 |
| 55 | `vendor` | 9 | 1901 |
| 56 | `subagent/subagent-acp` | 3 | 1893 |
| 57 | `fs/tool-fs` | 5 | 1833 |
| 58 | `snapshots` | 2 | 1802 |
| 59 | `workspace/workspace` | 2 | 1786 |
| 60 | `shell/tool-bash` | 3 | 1774 |
| 61 | `client/connection` | 10 | 1746 |
| 62 | `acp/acp` | 6 | 1721 |
| 63 | `test-support/client-runtime` | 6 | 1701 |
| 64 | `session/session-format-v1-to-v2` | 5 | 1686 |
| 65 | `jobs/jobs-local` | 2 | 1677 |
| 66 | `skill/skill-filesystem` | 3 | 1673 |
| 67 | `skill/skill` | 2 | 1640 |
| 68 | `shell/tool-pwsh` | 3 | 1637 |
| 69 | `client/ui-commands` | 6 | 1546 |
| 70 | `client/ui-input-trigger` | 3 | 1541 |
| 71 | `fs/tool-fs-search` | 4 | 1429 |
| 72 | `host/open-in-app` | 6 | 1426 |
| 73 | `api/terminal-controller` | 5 | 1397 |
| 74 | `client/ui-tool` | 11 | 1368 |
| 75 | `client/ui-subagent` | 2 | 1359 |
| 76 | `client/ui-sidebar-documentpreview` | 10 | 1324 |
| 77 | `llm/token-meter` | 7 | 1305 |
| 78 | `context/session-reference` | 2 | 1299 |
| 79 | `extensions/cordis-client-runner` | 8 | 1266 |
| 80 | `client/ui-agent-preset` | 5 | 1210 |
| 81 | `bundle/headless` | 4 | 1203 |
| 82 | `credentials/deepseek-account-platform` | 2 | 1193 |
| 83 | `plan/plan-mode` | 2 | 1180 |
| 84 | `api/workspace-files` | 7 | 1163 |
| 85 | `web/tool-web` | 3 | 1133 |
| 86 | `sdk/server` | 3 | 1129 |
| 87 | `goal/goal` | 4 | 1118 |
| 88 | `skill/tool-skill` | 2 | 1118 |
| 89 | `jobs/tool-jobs` | 2 | 1108 |
| 90 | `session-query/session-log-export` | 2 | 1106 |
| 91 | `ptc-runtime/ptc-runtime-node` | 7 | 1092 |
| 92 | `goal/goal-round-driver` | 2 | 1081 |
| 93 | `workflow/workflow-ptc` | 4 | 1058 |
| 94 | `core/agent` | 5 | 1040 |
| 95 | `credentials/credentials-local` | 4 | 1002 |
| 96 | `session/session-title` | 3 | 995 |
| 97 | `session/session-projection` | 2 | 991 |
| 98 | `api/workspace-controller` | 5 | 977 |
| 99 | `client/ui-deliverables` | 6 | 977 |
| 100 | `llm/llm-retry` | 4 | 950 |
| 101 | `client/ui-session` | 2 | 947 |
| 102 | `client/ui-workflow-run` | 2 | 921 |
| 103 | `lsp/lsp-stdio` | 7 | 899 |
| 104 | `session/session-projection-cache` | 3 | 889 |
| 105 | `typert/registry` | 2 | 874 |
| 106 | `sdk/client` | 4 | 861 |
| 107 | `subagent/subagent-dsh-sdk` | 2 | 838 |
| 108 | `core/system-prompt` | 2 | 833 |
| 109 | `hooks/hooks-claude-code` | 3 | 831 |
| 110 | `client/ui-slots` | 4 | 810 |
| 111 | `subagent/subagent-in-process-driver` | 3 | 767 |
| 112 | `shell/tool-pwsh-persistent` | 2 | 766 |
| 113 | `subprocess/win32-process` | 5 | 753 |
| 114 | `typert/protocol` | 3 | 751 |
| 115 | `experimental/tool-agent-team` | 2 | 750 |
| 116 | `website` | 5 | 750 |
| 117 | `shell/pwsh-local` | 2 | 748 |
| 118 | `client/ui-settings-plugin-inventory` | 2 | 743 |
| 119 | `shell/tool-bash-persistent` | 2 | 734 |
| 120 | `client/ui-model-selection` | 3 | 733 |
| 121 | `interaction/commands` | 2 | 709 |
| 122 | `typert/loader` | 2 | 700 |
| 123 | `workflow/tool-workflow` | 2 | 686 |
| 124 | `client/ui-layout` | 3 | 679 |
| 125 | `fs/tool-str-replace-editor` | 2 | 677 |
| 126 | `sandbox/sandbox-local` | 3 | 671 |
| 127 | `session/session-telemetry-otel` | 2 | 656 |
| 128 | `session/session-format-v2-to-v3` | 3 | 640 |
| 129 | `test-support/llm-mock-server` | 2 | 608 |
| 130 | `client/ui-user-questions` | 4 | 589 |
| 131 | `client/ui-jobs` | 2 | 586 |
| 132 | `terminal/terminal` | 2 | 580 |
| 133 | `session/session-telemetry` | 2 | 573 |
| 134 | `boot/hmr` | 3 | 562 |
| 135 | `ssh/ssh` | 6 | 559 |
| 136 | `client/ui-theme` | 5 | 558 |
| 137 | `client/ui-redteam-console` | 8 | 550 |
| 138 | `redteam/harness-plugin` | 2 | 548 |
| 139 | `experimental/webworker-packer` | 2 | 541 |
| 140 | `attachment/attachment-local` | 6 | 540 |
| 141 | `client/ui-settings-subagent` | 3 | 524 |
| 142 | `client/locale` | 2 | 521 |
| 143 | `spill/spill-local` | 2 | 515 |
| 144 | `goal/tool-goal` | 2 | 514 |
| 145 | `credentials/authorization` | 2 | 505 |
| 146 | `compaction/compaction` | 3 | 504 |
| 147 | `feedback/message-feedback` | 2 | 503 |
| 148 | `hooks/hooks-codex` | 3 | 503 |
| 149 | `client/tsdown.client.ts` | 1 | 485 |
| 150 | `client/ui-message-feedback` | 4 | 483 |
| 151 | `redteam/llm-local` | 3 | 469 |
| 152 | `session/session-persistence` | 3 | 468 |
| 153 | `shell/bash-local` | 2 | 467 |
| 154 | `deliverables/workspace-changes` | 3 | 464 |
| 155 | `web/web-fetch-http` | 3 | 450 |
| 156 | `shell/bash-sandbox` | 2 | 448 |
| 157 | `client/ui-reference` | 2 | 441 |
| 158 | `experimental/browser-use-runtime` | 2 | 433 |
| 159 | `interaction/permission-presets` | 2 | 431 |
| 160 | `web/web-search-deepseek` | 2 | 425 |
| 161 | `experimental/client-ui-agent-team` | 2 | 423 |
| 162 | `workflow/tool-ralph` | 3 | 423 |
| 163 | `terminal/tool-terminal` | 2 | 418 |
| 164 | `api/job-controller` | 3 | 410 |
| 165 | `client/ui-settings` | 2 | 401 |
| 166 | `session/session-format-v3-to-v4` | 3 | 395 |
| 167 | `context/time-context` | 2 | 392 |
| 168 | `subagent/tool-subagent-control` | 2 | 384 |
| 169 | `spill/spill-policy` | 1 | 372 |
| 170 | `document/office-to-pdf` | 3 | 367 |
| 171 | `util/http-proxy` | 3 | 366 |
| 172 | `client/file-upload` | 3 | 348 |
| 173 | `interaction/user-approval` | 2 | 330 |
| 174 | `session/session-log-deepseek` | 1 | 328 |
| 175 | `redteam/llm-meta` | 2 | 320 |
| 176 | `util/output-retention` | 2 | 319 |
| 177 | `experimental/speech-to-text-sensevoice` | 2 | 308 |
| 178 | `storage/storage-json` | 2 | 307 |
| 179 | `client/ui-skill` | 1 | 294 |
| 180 | `util/native-command` | 2 | 292 |
| 181 | `settings/settings` | 2 | 287 |
| 182 | `test-support/remote-mock` | 3 | 274 |
| 183 | `benchmarks` | 2 | 272 |
| 184 | `storage/storage-domain` | 2 | 267 |
| 185 | `subagent/subagent-spawn-in-process` | 1 | 258 |
| 186 | `extensions/ui-cordis` | 1 | 257 |
| 187 | `bundle/web-app` | 2 | 254 |
| 188 | `preset/agent-preset-registry` | 3 | 253 |
| 189 | `app-backup-2026-11-07-pre-livingsheen` | 3 | 242 |
| 190 | `host/webserver` | 2 | 242 |
| 191 | `client/ui-settings-general` | 1 | 240 |
| 192 | `redteam/fleet-skills` | 4 | 239 |
| 193 | `session/session-format` | 4 | 214 |
| 194 | `context/file-reference-local` | 2 | 213 |
| 195 | `skill/tool-workspace-dependencies` | 2 | 204 |
| 196 | `client/ui-settings-account` | 1 | 200 |
| 197 | `context/tmux-context` | 2 | 200 |
| 198 | `client/ui-sidebar-files` | 3 | 188 |
| 199 | `client/resources` | 1 | 187 |
| 200 | `shell/pwsh-sandbox` | 1 | 183 |
| 201 | `host/directory-picker-native` | 1 | 181 |
| 202 | `compaction/compaction-image-offload` | 1 | 180 |
| 203 | `experimental/browser-use-stagehand-native` | 2 | 176 |
| 204 | `client/ui-sidebar-terminal` | 1 | 168 |
| 205 | `session/session-title-llm` | 2 | 168 |
| 206 | `client/ui-permission-presets` | 3 | 159 |
| 207 | `guard/repeat-tool-reminder` | 1 | 159 |
| 208 | `client/ui-attachment` | 2 | 156 |
| 209 | `client/ui-goal` | 1 | 142 |
| 210 | `ssh/subprocess-ssh` | 2 | 140 |
| 211 | `vitest.config.ts` | 1 | 136 |
| 212 | `client/ui-approval` | 1 | 135 |
| 213 | `boot/cmdline` | 1 | 121 |
| 214 | `session/session-stats` | 1 | 112 |
| 215 | `mcp/mcp-resources` | 1 | 111 |
| 216 | `interaction/user-questions` | 1 | 104 |
| 217 | `webhook/webhook` | 2 | 103 |
| 218 | `client/ui-plan` | 2 | 97 |
| 219 | `goal/command-goal` | 1 | 96 |
| 220 | `client/hmr` | 1 | 89 |
| 221 | `client/ui-schedule` | 1 | 86 |
| 222 | `sdk/protocol` | 2 | 86 |
| 223 | `client/ui-sidebar` | 2 | 84 |
| 224 | `interaction/tool-ask-user` | 1 | 81 |
| 225 | `client/ui-sidebar-browser` | 4 | 80 |
| 226 | `host/directory-picker-browse` | 1 | 74 |
| 227 | `credentials/credentials` | 1 | 66 |
| 228 | `runtime-diagnostics/invariants` | 1 | 60 |
| 229 | `host/directory-picker-auto` | 1 | 57 |
| 230 | `core/scope` | 2 | 56 |
| 231 | `util/values` | 1 | 56 |
| 232 | `session/session-format-catalog` | 1 | 55 |
| 233 | `redteam/command-redteam` | 1 | 54 |
| 234 | `experimental/client-ui-voice-input` | 1 | 53 |
| 235 | `todo/tool-todo` | 1 | 53 |
| 236 | `compaction/compaction-tool-result-pruner` | 1 | 49 |
| 237 | `client/web` | 1 | 47 |
| 238 | `subprocess/subprocess` | 1 | 47 |
| 239 | `fs/fs` | 1 | 46 |
| 240 | `client/store` | 1 | 45 |
| 241 | `client/ui-directory-picker-native` | 1 | 45 |
| 242 | `util/timeout` | 1 | 41 |
| 243 | `storage/storage-sqlite` | 1 | 40 |
| 244 | `client/ui-open-in-app` | 1 | 39 |
| 245 | `extensions/tool-cordis` | 1 | 37 |
| 246 | `compaction/command-compact` | 1 | 31 |
| 247 | `redteam/foundry-gate` | 1 | 28 |
| 248 | `session/session-turn-outline` | 1 | 27 |
| 249 | `api/remotes` | 2 | 25 |
| 250 | `api/settings-controller` | 1 | 20 |
| 251 | `attachment/attachment` | 1 | 15 |
| 252 | `subagent/subagent-fork-in-process` | 1 | 11 |
| 253 | `web/web-search-exa` | 1 | 11 |
| 254 | `feedback/command-feedback` | 1 | 10 |
| 255 | `session/session-checkpoint-policy` | 1 | 10 |
| 256 | `test-support/loader-smoke` | 1 | 9 |
| 257 | `webhook/webhook-github` | 1 | 8 |
| 258 | `jobs/jobs` | 1 | 4 |
| 259 | `sandbox/sandbox-policy` | 1 | 1 |

## `scripts` — 86 files, 29 batches

**Batch 1**

- [ ] `scripts/gen-doc-graphs.ts` — 1689 lines
- [ ] `scripts/run-gates.ts` — 1667 lines
- [ ] `scripts/gen-cordis-catalog.ts` — 1299 lines

**Batch 2**

- [ ] `scripts/ci-workflow.spec.ts` — 1223 lines
- [ ] `scripts/run-gates.spec.ts` — 1156 lines
- [ ] `scripts/publish-npm-baseline.ts` — 1078 lines

**Batch 3**

- [ ] `scripts/persistence-changes.spec.ts` — 1014 lines
- [ ] `scripts/verify-package-dependencies.spec.ts` — 989 lines
- [ ] `scripts/gen-config-catalog.ts` — 976 lines

**Batch 4**

- [ ] `scripts/persistence-changes.ts` — 918 lines
- [ ] `scripts/install-lefthook.spec.ts` — 891 lines
- [ ] `scripts/verify-package-dependencies.ts` — 890 lines

**Batch 5**

- [ ] `scripts/gen-tool-catalog.ts` — 879 lines
- [ ] `scripts/gen-third-party-notices.ts` — 863 lines
- [ ] `scripts/project-doc-site.spec.ts` — 855 lines

**Batch 6**

- [ ] `scripts/coverage-partitions.spec.ts` — 716 lines
- [ ] `scripts/verify-client-packages.ts` — 713 lines
- [ ] `scripts/translation-pairing-merge.spec.ts` — 704 lines

**Batch 7**

- [ ] `scripts/coverage-partitions.ts` — 688 lines
- [ ] `scripts/rescope-vendor.ts` — 661 lines
- [ ] `scripts/build-exe-for-python-sdk.ts` — 653 lines

**Batch 8**

- [ ] `scripts/check-workspace-constraints.ts` — 635 lines
- [ ] `scripts/loader-volatile-update.spec.ts` — 634 lines
- [ ] `scripts/verify-package-readme-model-experience.ts` — 614 lines

**Batch 9**

- [ ] `scripts/verify-export-jsdoc.ts` — 607 lines
- [ ] `scripts/gen-client-catalog.ts` — 594 lines
- [ ] `scripts/verify-cordis-config.ts` — 578 lines

**Batch 10**

- [ ] `scripts/project-doc-site.ts` — 577 lines
- [ ] `scripts/translation-pairing.spec.ts` — 556 lines
- [ ] `scripts/benchmark-npm-resolution.ts` — 551 lines

**Batch 11**

- [ ] `scripts/persistence-schema.spec.ts` — 549 lines
- [ ] `scripts/persistence-schema.ts` — 512 lines
- [ ] `scripts/translation-brief.ts` — 512 lines

**Batch 12**

- [ ] `scripts/verify-package-meta.spec.ts` — 491 lines
- [ ] `scripts/persistence-formats.spec.ts` — 476 lines
- [ ] `scripts/client-bundle-purity.spec.ts` — 475 lines

**Batch 13**

- [ ] `scripts/gen-third-party-notices.spec.ts` — 469 lines
- [ ] `scripts/oxlint-contract.spec.ts` — 469 lines
- [ ] `scripts/doc-standard.spec.ts` — 453 lines

**Batch 14**

- [ ] `scripts/release/families.ts` — 449 lines
- [ ] `scripts/verify-default-product-isolation.spec.ts` — 442 lines
- [ ] `scripts/migrate-sessions-to-v4.spec.ts` — 441 lines

**Batch 15**

- [ ] `scripts/translation-pairing.ts` — 440 lines
- [ ] `scripts/dev-web.ts` — 439 lines
- [ ] `scripts/cordis-core-api.ts` — 433 lines

**Batch 16**

- [ ] `scripts/slot-walk.ts` — 432 lines
- [ ] `scripts/test-invariants.spec.ts` — 419 lines
- [ ] `scripts/package-invariants.ts` — 418 lines

**Batch 17**

- [ ] `scripts/release/families.spec.ts` — 418 lines
- [ ] `scripts/release/bump.ts` — 416 lines
- [ ] `scripts/translation-pairing-merge.ts` — 408 lines

**Batch 18**

- [ ] `scripts/verify-default-product-isolation.ts` — 402 lines
- [ ] `scripts/gen-scoped-events.ts` — 399 lines
- [ ] `scripts/persistence-releases.spec.ts` — 398 lines

**Batch 19**

- [ ] `scripts/client-build-environment.ts` — 395 lines
- [ ] `scripts/check-workspace-constraints.spec.ts` — 377 lines
- [ ] `scripts/verify-type-equiv.ts` — 376 lines

**Batch 20**

- [ ] `scripts/verify-client-packages.spec.ts` — 363 lines
- [ ] `scripts/verify-client-ui-i18n.ts` — 361 lines
- [ ] `scripts/verify-translation-pairing.ts` — 357 lines

**Batch 21**

- [ ] `scripts/render-persistence-schema.spec.ts` — 349 lines
- [ ] `scripts/verify-client-route-resolution.ts` — 339 lines
- [ ] `scripts/translation-links.ts` — 328 lines

**Batch 22**

- [ ] `scripts/render-persistence-schema.ts` — 319 lines
- [ ] `scripts/gen-translation-brief.ts` — 316 lines
- [ ] `scripts/locale-dictionary-parity.spec.ts` — 313 lines

**Batch 23**

- [ ] `scripts/persistence-catalog-source.ts` — 307 lines
- [ ] `scripts/gen-dependency-catalog.ts` — 304 lines
- [ ] `scripts/migrate-sessions-to-v4.ts` — 303 lines

**Batch 24**

- [ ] `scripts/client-build-environment.client.spec.ts` — 294 lines
- [ ] `scripts/package-invariants.spec.ts` — 294 lines
- [ ] `scripts/session-fixture-layout.ts` — 294 lines

**Batch 25**

- [ ] `scripts/translation-brief.spec.ts` — 287 lines
- [ ] `scripts/persistence-schema-model.ts` — 273 lines
- [ ] `scripts/benchmark-next-package-dependency.ts` — 271 lines

**Batch 26**

- [ ] `scripts/markdown.ts` — 271 lines
- [ ] `scripts/gen-client-catalog.spec.ts` — 264 lines
- [ ] `scripts/verify-no-unknown-casts.spec.ts` — 263 lines

**Batch 27**

- [ ] `scripts/gen-session-format-catalog.ts` — 261 lines
- [ ] `scripts/publint-all.ts` — 260 lines
- [ ] `scripts/translation-prompt.ts` — 259 lines

**Batch 28**

- [ ] `scripts/persistence-releases.ts` — 257 lines
- [ ] `scripts/repo-files.ts` — 257 lines
- [ ] `scripts/web-product-bundle-isolation.spec.ts` — 257 lines

**Batch 29**

- [ ] `scripts/translation-links.spec.ts` — 253 lines
- [ ] `scripts/doc-typecheck.ts` — 252 lines

## `apps/redteam-runner` — 179 files, 60 batches

**Batch 30**

- [ ] `apps/redteam-runner/test/host-exec-v010-wave2.test.ts` — 943 lines
- [ ] `apps/redteam-runner/test/msf.test.ts` — 927 lines
- [ ] `apps/redteam-runner/test/host-exec-v010.test.ts` — 746 lines

**Batch 31**

- [ ] `apps/redteam-runner/test/harness2-trajectory.test.ts` — 740 lines
- [ ] `apps/redteam-runner/test/scope-guard.test.ts` — 730 lines
- [ ] `apps/redteam-runner/src/prompts/target-protocol.ts` — 728 lines

**Batch 32**

- [ ] `apps/redteam-runner/test/harness2-probe.test.ts` — 668 lines
- [ ] `apps/redteam-runner/test/targets.test.ts` — 660 lines
- [ ] `apps/redteam-runner/test/harness2-lifecycle.test.ts` — 635 lines

**Batch 33**

- [ ] `apps/redteam-runner/test/harness2-package.test.ts` — 609 lines
- [ ] `apps/redteam-runner/test/arsenal-ingest.test.ts` — 606 lines
- [ ] `apps/redteam-runner/test/research-tools.test.ts` — 596 lines

**Batch 34**

- [ ] `apps/redteam-runner/test/arsenal-fetch-guard.test.ts` — 588 lines
- [ ] `apps/redteam-runner/test/accountability.test.ts` — 586 lines
- [ ] `apps/redteam-runner/test/charter-completion.test.ts` — 566 lines

**Batch 35**

- [ ] `apps/redteam-runner/test/memory-core.test.ts` — 553 lines
- [ ] `apps/redteam-runner/test/workgraph.test.ts` — 544 lines
- [ ] `apps/redteam-runner/test/integrations.test.ts` — 541 lines

**Batch 36**

- [ ] `apps/redteam-runner/test/harness2-store.test.ts` — 539 lines
- [ ] `apps/redteam-runner/test/harness2-scoring.test.ts` — 537 lines
- [ ] `apps/redteam-runner/test/continuous.test.ts` — 535 lines

**Batch 37**

- [ ] `apps/redteam-runner/test/report-scribe.test.ts` — 518 lines
- [ ] `apps/redteam-runner/test/lockout.test.ts` — 517 lines
- [ ] `apps/redteam-runner/test/tool-spill.test.ts` — 497 lines

**Batch 38**

- [ ] `apps/redteam-runner/test/engagement-tools.test.ts` — 483 lines
- [ ] `apps/redteam-runner/test/report-detail.test.ts` — 480 lines
- [ ] `apps/redteam-runner/test/harness2-experience.test.ts` — 473 lines

**Batch 39**

- [ ] `apps/redteam-runner/test/report-cell-proven.test.ts` — 471 lines
- [ ] `apps/redteam-runner/test/local-host.test.ts` — 451 lines
- [ ] `apps/redteam-runner/test/nuclei.test.ts` — 446 lines

**Batch 40**

- [ ] `apps/redteam-runner/test/readiness.test.ts` — 441 lines
- [ ] `apps/redteam-runner/test/arsenal-tools.test.ts` — 438 lines
- [ ] `apps/redteam-runner/test/host-exec.test.ts` — 435 lines

**Batch 41**

- [ ] `apps/redteam-runner/test/compaction.test.ts` — 424 lines
- [ ] `apps/redteam-runner/test/memory-commit.test.ts` — 422 lines
- [ ] `apps/redteam-runner/test/report-matter.test.ts` — 398 lines

**Batch 42**

- [ ] `apps/redteam-runner/test/runner.test.ts` — 396 lines
- [ ] `apps/redteam-runner/test/arsenal-battery.test.ts` — 389 lines
- [ ] `apps/redteam-runner/test/bridge-fleet-dispatch.test.ts` — 388 lines

**Batch 43**

- [ ] `apps/redteam-runner/test/ui.test.ts` — 374 lines
- [ ] `apps/redteam-runner/test/campaign-store.test.ts` — 366 lines
- [ ] `apps/redteam-runner/test/safety.test.ts` — 350 lines

**Batch 44**

- [ ] `apps/redteam-runner/test/report-detail-render.test.ts` — 349 lines
- [ ] `apps/redteam-runner/test/arsenal-battery-swap.test.ts` — 348 lines
- [ ] `apps/redteam-runner/src/dispatch/bookkeeping.ts` — 336 lines

**Batch 45**

- [ ] `apps/redteam-runner/test/report-deliverables-autofire.test.ts` — 335 lines
- [ ] `apps/redteam-runner/test/report-regenerate.test.ts` — 328 lines
- [ ] `apps/redteam-runner/test/foundry-loop.test.ts` — 327 lines

**Batch 46**

- [ ] `apps/redteam-runner/test/memory-store.test.ts` — 321 lines
- [ ] `apps/redteam-runner/src/report/deliverables.ts` — 316 lines
- [ ] `apps/redteam-runner/test/tool-repair.test.ts` — 311 lines

**Batch 47**

- [ ] `apps/redteam-runner/test/arsenal-tags.test.ts` — 307 lines
- [ ] `apps/redteam-runner/test/host-inventory.test.ts` — 305 lines
- [ ] `apps/redteam-runner/test/reflector.test.ts` — 303 lines

**Batch 48**

- [ ] `apps/redteam-runner/test/item-ledger.test.ts` — 302 lines
- [ ] `apps/redteam-runner/src/harness2/layers.ts` — 300 lines
- [ ] `apps/redteam-runner/src/harness2/scoring.ts` — 300 lines

**Batch 49**

- [ ] `apps/redteam-runner/src/harness2/trajectory.ts` — 300 lines
- [ ] `apps/redteam-runner/src/memory/views.ts` — 300 lines
- [ ] `apps/redteam-runner/src/workgraph/graph.ts` — 300 lines

**Batch 50**

- [ ] `apps/redteam-runner/test/peer-review.test.ts` — 300 lines
- [ ] `apps/redteam-runner/src/events.ts` — 299 lines
- [ ] `apps/redteam-runner/src/foundry/loop-bundle.ts` — 299 lines

**Batch 51**

- [ ] `apps/redteam-runner/src/harness2/experience.ts` — 299 lines
- [ ] `apps/redteam-runner/src/harness2/package-parse.ts` — 299 lines
- [ ] `apps/redteam-runner/src/harness2/probe-cli.ts` — 299 lines

**Batch 52**

- [ ] `apps/redteam-runner/src/harness2/probe.ts` — 299 lines
- [ ] `apps/redteam-runner/src/harness2/store.ts` — 299 lines
- [ ] `apps/redteam-runner/src/prompts/fleet-assembly.ts` — 299 lines

**Batch 53**

- [ ] `apps/redteam-runner/src/report/detail-tables.ts` — 299 lines
- [ ] `apps/redteam-runner/src/report/predecessor.ts` — 299 lines
- [ ] `apps/redteam-runner/src/harness2/experience-record.ts` — 298 lines

**Batch 54**

- [ ] `apps/redteam-runner/src/harness2/package.ts` — 298 lines
- [ ] `apps/redteam-runner/src/report/host-inventory.ts` — 298 lines
- [ ] `apps/redteam-runner/src/ui/routes/console-benchmark.ts` — 298 lines

**Batch 55**

- [ ] `apps/redteam-runner/test/console-pages-real-roots.test.ts` — 298 lines
- [ ] `apps/redteam-runner/test/escalate.test.ts` — 298 lines
- [ ] `apps/redteam-runner/test/report-predecessor.test.ts` — 298 lines

**Batch 56**

- [ ] `apps/redteam-runner/test/proof.test.ts` — 297 lines
- [ ] `apps/redteam-runner/src/continuous/drift.ts` — 295 lines
- [ ] `apps/redteam-runner/src/prober-net.ts` — 295 lines

**Batch 57**

- [ ] `apps/redteam-runner/test/target-protocol.test.ts` — 293 lines
- [ ] `apps/redteam-runner/src/arsenal/index-store.ts` — 293 lines
- [ ] `apps/redteam-runner/src/campaign/cli.ts` — 293 lines

**Batch 58**

- [ ] `apps/redteam-runner/src/host-exec/pc-agent.ts` — 293 lines
- [ ] `apps/redteam-runner/src/targets/webapp-part-1.ts` — 293 lines
- [ ] `apps/redteam-runner/src/arsenal/collections-map.ts` — 291 lines

**Batch 59**

- [ ] `apps/redteam-runner/src/campaign/schema.ts` — 291 lines
- [ ] `apps/redteam-runner/src/gate.ts` — 291 lines
- [ ] `apps/redteam-runner/src/safety/scope-guard.ts` — 291 lines

**Batch 60**

- [ ] `apps/redteam-runner/src/coverage/items.ts` — 290 lines
- [ ] `apps/redteam-runner/src/host-exec/winrm.ts` — 290 lines
- [ ] `apps/redteam-runner/src/phases/run.ts` — 290 lines

**Batch 61**

- [ ] `apps/redteam-runner/test/report-templates-reconciliation.test.ts` — 290 lines
- [ ] `apps/redteam-runner/src/campaign/planner.ts` — 289 lines
- [ ] `apps/redteam-runner/src/operator.ts` — 289 lines

**Batch 62**

- [ ] `apps/redteam-runner/src/safety/lockout-guard.ts` — 289 lines
- [ ] `apps/redteam-runner/src/targets/webapp-part-4.ts` — 289 lines
- [ ] `apps/redteam-runner/src/campaign/gate.ts` — 288 lines

**Batch 63**

- [ ] `apps/redteam-runner/src/local-host/artifact.ts` — 287 lines
- [ ] `apps/redteam-runner/src/memory/apply.ts` — 287 lines
- [ ] `apps/redteam-runner/src/policy-containment.ts` — 287 lines

**Batch 64**

- [ ] `apps/redteam-runner/src/report/html/wire.ts` — 287 lines
- [ ] `apps/redteam-runner/src/report/scribe.ts` — 286 lines
- [ ] `apps/redteam-runner/src/targets/webapp-part-5.ts` — 286 lines

**Batch 65**

- [ ] `apps/redteam-runner/src/agents.ts` — 285 lines
- [ ] `apps/redteam-runner/src/arsenal/refresh.ts` — 285 lines
- [ ] `apps/redteam-runner/src/report/docx.ts` — 285 lines

**Batch 66**

- [ ] `apps/redteam-runner/src/targets/webapp-part-3.ts` — 285 lines
- [ ] `apps/redteam-runner/src/workflows/commands.ts` — 285 lines
- [ ] `apps/redteam-runner/src/harness2/lifecycle.ts` — 284 lines

**Batch 67**

- [ ] `apps/redteam-runner/test/fleet-assembly.test.ts` — 284 lines
- [ ] `apps/redteam-runner/src/bridge/client.ts` — 283 lines
- [ ] `apps/redteam-runner/src/ui/mcp-tools.ts` — 283 lines

**Batch 68**

- [ ] `apps/redteam-runner/test/arsenal-battery-fixture.ts` — 283 lines
- [ ] `apps/redteam-runner/src/campaign/executor.ts` — 282 lines
- [ ] `apps/redteam-runner/src/safety/scope-hostset.ts` — 282 lines

**Batch 69**

- [ ] `apps/redteam-runner/src/toolchain.ts` — 282 lines
- [ ] `apps/redteam-runner/src/dispatch/router.ts` — 281 lines
- [ ] `apps/redteam-runner/src/exploit-cell/live.ts` — 280 lines

**Batch 70**

- [ ] `apps/redteam-runner/src/harness2/lifecycle-state.ts` — 280 lines
- [ ] `apps/redteam-runner/src/ui/routes/foundry.ts` — 280 lines
- [ ] `apps/redteam-runner/test/compliance.test.ts` — 280 lines

**Batch 71**

- [ ] `apps/redteam-runner/src/host-exec/krb.ts` — 279 lines
- [ ] `apps/redteam-runner/src/tools/readiness.ts` — 279 lines
- [ ] `apps/redteam-runner/test/variants.test.ts` — 279 lines

**Batch 72**

- [ ] `apps/redteam-runner/test/memory-integration.test.ts` — 278 lines
- [ ] `apps/redteam-runner/src/foundry/store.ts` — 277 lines
- [ ] `apps/redteam-runner/src/index.ts` — 277 lines

**Batch 73**

- [ ] `apps/redteam-runner/src/memory/collapse.ts` — 277 lines
- [ ] `apps/redteam-runner/src/net/executor.ts` — 277 lines
- [ ] `apps/redteam-runner/src/charter-completion.ts` — 275 lines

**Batch 74**

- [ ] `apps/redteam-runner/src/harness2/monitor.ts` — 275 lines
- [ ] `apps/redteam-runner/src/host-exec/ntlmv2.ts` — 275 lines
- [ ] `apps/redteam-runner/src/report/html/sections.ts` — 275 lines

**Batch 75**

- [ ] `apps/redteam-runner/test/struct-adoption.test.ts` — 275 lines
- [ ] `apps/redteam-runner/src/harness2/pair-select.ts` — 273 lines
- [ ] `apps/redteam-runner/src/harness2/store-rows.ts` — 273 lines

**Batch 76**

- [ ] `apps/redteam-runner/src/cli/commands.ts` — 272 lines
- [ ] `apps/redteam-runner/src/phases/tasks.ts` — 272 lines
- [ ] `apps/redteam-runner/src/safety/lockout-classify.ts` — 272 lines

**Batch 77**

- [ ] `apps/redteam-runner/test/nuclei-exit-code.test.ts` — 272 lines
- [ ] `apps/redteam-runner/src/prober.ts` — 271 lines
- [ ] `apps/redteam-runner/src/targets/webapp-part-2.ts` — 271 lines

**Batch 78**

- [ ] `apps/redteam-runner/src/ui/engagement-tools.ts` — 271 lines
- [ ] `apps/redteam-runner/src/xtool/registry.ts` — 270 lines
- [ ] `apps/redteam-runner/src/memory/recall.ts` — 269 lines

**Batch 79**

- [ ] `apps/redteam-runner/src/report/html/style.ts` — 268 lines
- [ ] `apps/redteam-runner/src/ui/routes/console-layers.ts` — 268 lines
- [ ] `apps/redteam-runner/test/campaign-gate.test.ts` — 268 lines

**Batch 80**

- [ ] `apps/redteam-runner/src/research/scope.ts` — 267 lines
- [ ] `apps/redteam-runner/src/memory/schema.ts` — 266 lines
- [ ] `apps/redteam-runner/src/campaign/lifecycle.ts` — 265 lines

**Batch 81**

- [ ] `apps/redteam-runner/src/report/phase.ts` — 265 lines
- [ ] `apps/redteam-runner/test/report-html-design.test.ts` — 265 lines
- [ ] `apps/redteam-runner/test/tls-probe.test.ts` — 265 lines

**Batch 82**

- [ ] `apps/redteam-runner/src/arsenal/ingest-parse.ts` — 264 lines
- [ ] `apps/redteam-runner/src/harness2/probe-verdict.ts` — 264 lines
- [ ] `apps/redteam-runner/src/memory/store-instance.ts` — 264 lines

**Batch 83**

- [ ] `apps/redteam-runner/src/registry/store.ts` — 264 lines
- [ ] `apps/redteam-runner/src/ui/store.ts` — 264 lines
- [ ] `apps/redteam-runner/src/net/sockets.ts` — 262 lines

**Batch 84**

- [ ] `apps/redteam-runner/test/directive-failure.test.ts` — 261 lines
- [ ] `apps/redteam-runner/src/cli/args.ts` — 260 lines
- [ ] `apps/redteam-runner/src/types.ts` — 259 lines

**Batch 85**

- [ ] `apps/redteam-runner/test/net-dispatch.test.ts` — 259 lines
- [ ] `apps/redteam-runner/src/report/regenerate.ts` — 258 lines
- [ ] `apps/redteam-runner/src/accountability/tiers.ts` — 256 lines

**Batch 86**

- [ ] `apps/redteam-runner/src/report/detail-blocks.ts` — 256 lines
- [ ] `apps/redteam-runner/src/ui/routes/console-scope.ts` — 256 lines
- [ ] `apps/redteam-runner/test/signoff-redirect-budget.test.ts` — 256 lines

**Batch 87**

- [ ] `apps/redteam-runner/src/xtool/executor.ts` — 255 lines
- [ ] `apps/redteam-runner/src/ui/server.ts` — 254 lines
- [ ] `apps/redteam-runner/src/compaction/compact.ts` — 253 lines

**Batch 88**

- [ ] `apps/redteam-runner/src/foundry/loop.ts` — 253 lines
- [ ] `apps/redteam-runner/src/device-templates/catalog.ts` — 252 lines
- [ ] `apps/redteam-runner/src/ui/routes/console-engagements.ts` — 252 lines

**Batch 89**

- [ ] `apps/redteam-runner/test/bridge-client.test.ts` — 252 lines
- [ ] `apps/redteam-runner/src/campaign/kinds.ts` — 251 lines

## `apps/web` — 55 files, 19 batches

**Batch 90**

- [ ] `apps/web/tests/scaffold.ts` — 1737 lines
- [ ] `apps/web/tests/document-preview.e2e.ts` — 1618 lines
- [ ] `apps/web/tests/complex-history.perf.ts` — 1454 lines

**Batch 91**

- [ ] `apps/web/tests/chat-scroll-contract.e2e.ts` — 1191 lines
- [ ] `apps/web/tests/sidebar-right.e2e.ts` — 1134 lines
- [ ] `apps/web/tests/shipped-composition.e2e.ts` — 1104 lines

**Batch 92**

- [ ] `apps/web/tests/settings-chrome.e2e.ts` — 866 lines
- [ ] `apps/web/tests/smoke-real.e2e.ts` — 866 lines
- [ ] `apps/web/tests/seeded-history.e2e.ts` — 861 lines

**Batch 93**

- [ ] `apps/web/tests/schedule-after.e2e.ts` — 834 lines
- [ ] `apps/web/tests/workspace-management.e2e.ts` — 810 lines
- [ ] `apps/web/tests/changed-files-turn.e2e.ts` — 731 lines

**Batch 94**

- [ ] `apps/web/tests/subagent-conversation.e2e.ts` — 657 lines
- [ ] `apps/web/tests/lifecycle-chrome.e2e.ts` — 643 lines
- [ ] `apps/web/tests/navigation-panes.e2e.ts` — 554 lines

**Batch 95**

- [ ] `apps/web/tests/markdown-wide-table.e2e.ts` — 544 lines
- [ ] `apps/web/tests/sidebar-terminal.e2e.ts` — 540 lines
- [ ] `apps/web/tests/preview-boot.e2e.ts` — 539 lines

**Batch 96**

- [ ] `apps/web/tests/steering.e2e.ts` — 502 lines
- [ ] `apps/web/tests/clickable-links-gallery.e2e.ts` — 482 lines
- [ ] `apps/web/tests/models-settings.e2e.ts` — 455 lines

**Batch 97**

- [ ] `apps/web/tests/details-session-lifecycle.e2e.ts` — 440 lines
- [ ] `apps/web/tests/file-upload-round.e2e.ts` — 438 lines
- [ ] `apps/web/tests/plugin-manager.e2e.ts` — 433 lines

**Batch 98**

- [ ] `apps/web/tests/queue-actions.e2e.ts` — 429 lines
- [ ] `apps/web/tests/question-composer.e2e.ts` — 428 lines
- [ ] `apps/web/tests/assembled-remote.ts` — 425 lines

**Batch 99**

- [ ] `apps/web/tests/sidebar-scrollbar.e2e.ts` — 424 lines
- [ ] `apps/web/tests/reference-composer.e2e.ts` — 423 lines
- [ ] `apps/web/tests/message-actions.e2e.ts` — 420 lines

**Batch 100**

- [ ] `apps/web/tests/agent-preset-selection.e2e.ts` — 403 lines
- [ ] `apps/web/tests/composer-tab-geometry.e2e.ts` — 370 lines
- [ ] `apps/web/tests/live-interactions.e2e.ts` — 366 lines

**Batch 101**

- [ ] `apps/web/tests/subagent-interrupt-ui.e2e.ts` — 363 lines
- [ ] `apps/web/tests/trajectory-virtualization.e2e.ts` — 359 lines
- [ ] `apps/web/tests/chat-continuous-conversation.e2e.ts` — 358 lines

**Batch 102**

- [ ] `apps/web/tests/plugin-config.e2e.ts` — 355 lines
- [ ] `apps/web/tests/chat-long-interactions.e2e.ts` — 350 lines
- [ ] `apps/web/tests/composer-draft-scroll.e2e.ts` — 338 lines

**Batch 103**

- [ ] `apps/web/tests/replay-round-trip.e2e.ts` — 338 lines
- [ ] `apps/web/tests/assembled-boot.ts` — 332 lines
- [ ] `apps/web/tests/turn-tail-actions.e2e.ts` — 332 lines

**Batch 104**

- [ ] `apps/web/tests/web-search-round.e2e.ts` — 328 lines
- [ ] `apps/web/tests/plan-review.e2e.ts` — 324 lines
- [ ] `apps/web/tests/markdown-images.e2e.ts` — 322 lines

**Batch 105**

- [ ] `apps/web/tests/client-plugin-live.e2e.ts` — 312 lines
- [ ] `apps/web/tests/feedback-release.e2e.ts` — 310 lines
- [ ] `apps/web/tests/access-confirmation.e2e.ts` — 307 lines

**Batch 106**

- [ ] `apps/web/tests/thinking-markdown.e2e.ts` — 304 lines
- [ ] `apps/web/tests/present.e2e.ts` — 295 lines
- [ ] `apps/web/tests/onboarding-deepseek-config.e2e.ts` — 294 lines

**Batch 107**

- [ ] `apps/web/tests/support.ts` — 278 lines
- [ ] `apps/web/tests/idle-submission-handoff.e2e.ts` — 275 lines
- [ ] `apps/web/tests/plan-control-row.e2e.ts` — 262 lines

**Batch 108**

- [ ] `apps/web/tests/session-archive-active.e2e.ts` — 253 lines

## `api/session-controller` — 29 files, 10 batches

**Batch 109**

- [ ] `packages/api/session-controller/tests/manager.client.spec.ts` — 1422 lines
- [ ] `packages/api/session-controller/tests/sessions-service.client.spec.ts` — 1112 lines
- [ ] `packages/api/session-controller/tests/session.client.spec.ts` — 1033 lines

**Batch 110**

- [ ] `packages/api/session-controller/tests/session-history-journal.host.spec.ts` — 998 lines
- [ ] `packages/api/session-controller/tests/session-cold.host.spec.ts` — 967 lines
- [ ] `packages/api/session-controller/src/client/sessions/session.ts` — 941 lines

**Batch 111**

- [ ] `packages/api/session-controller/tests/session-search.host.spec.ts` — 898 lines
- [ ] `packages/api/session-controller/src/client/sessions/manager.ts` — 853 lines
- [ ] `packages/api/session-controller/tests/session-projections.host.spec.ts` — 796 lines

**Batch 112**

- [ ] `packages/api/session-controller/tests/transport.host.spec.ts` — 787 lines
- [ ] `packages/api/session-controller/tests/session-models.host.spec.ts` — 740 lines
- [ ] `packages/api/session-controller/tests/transport.client.spec.ts` — 725 lines

**Batch 113**

- [ ] `packages/api/session-controller/src/client/sessions/service.ts` — 708 lines
- [ ] `packages/api/session-controller/src/commands.ts` — 696 lines
- [ ] `packages/api/session-controller/tests/session-pending-submissions.client.spec.ts` — 632 lines

**Batch 114**

- [ ] `packages/api/session-controller/src/types.ts` — 624 lines
- [ ] `packages/api/session-controller/tests/commands-queue-attachment.host.spec.ts` — 563 lines
- [ ] `packages/api/session-controller/src/agent.ts` — 536 lines

**Batch 115**

- [ ] `packages/api/session-controller/tests/session-fork.host.spec.ts` — 534 lines
- [ ] `packages/api/session-controller/src/index.ts` — 510 lines
- [ ] `packages/api/session-controller/tests/agent.host.spec.ts` — 487 lines

**Batch 116**

- [ ] `packages/api/session-controller/tests/commands-upload-file.host.spec.ts` — 472 lines
- [ ] `packages/api/session-controller/src/history.ts` — 445 lines
- [ ] `packages/api/session-controller/tests/test-remote.ts` — 385 lines

**Batch 117**

- [ ] `packages/api/session-controller/tests/projection-store.client.spec.ts` — 371 lines
- [ ] `packages/api/session-controller/src/list.ts` — 341 lines
- [ ] `packages/api/session-controller/tests/reference-ownership.client.spec.ts` — 324 lines

**Batch 118**

- [ ] `packages/api/session-controller/tests/commands-create-fork.host.spec.ts` — 293 lines
- [ ] `packages/api/session-controller/tests/session-open-workspace-path.host.spec.ts` — 274 lines

## `client/ui-chat` — 23 files, 8 batches

**Batch 119**

- [ ] `packages/client/ui-chat/tests/chat-view.client.spec.tsx` — 4083 lines
- [ ] `packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts` — 2906 lines
- [ ] `packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts` — 1215 lines

**Batch 120**

- [ ] `packages/client/ui-chat/tests/chat-branch-tails.client.spec.tsx` — 1117 lines
- [ ] `packages/client/ui-chat/src/client/chat/ContextBody.tsx` — 592 lines
- [ ] `packages/client/ui-chat/tests/chat-viewport.client.spec.ts` — 553 lines

**Batch 121**

- [ ] `packages/client/ui-chat/tests/chat-snapshot-fixture.client.ts` — 537 lines
- [ ] `packages/client/ui-chat/tests/chat-stats.client.spec.tsx` — 487 lines
- [ ] `packages/client/ui-chat/src/client/chat/use-chat-viewport.ts` — 473 lines

**Batch 122**

- [ ] `packages/client/ui-chat/src/client/conversation-nodes/assistant.ts` — 457 lines
- [ ] `packages/client/ui-chat/src/client/chat/MessageItem.tsx` — 415 lines
- [ ] `packages/client/ui-chat/tests/apply-inject.client.spec.tsx` — 415 lines

**Batch 123**

- [ ] `packages/client/ui-chat/src/client/locale.ts` — 397 lines
- [ ] `packages/client/ui-chat/tests/process-groups.client.spec.ts` — 386 lines
- [ ] `packages/client/ui-chat/src/client/chat/StatsPills.tsx` — 379 lines

**Batch 124**

- [ ] `packages/client/ui-chat/src/client/chat/ChatView.tsx` — 328 lines
- [ ] `packages/client/ui-chat/tests/reasoning-row.client.spec.tsx` — 318 lines
- [ ] `packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts` — 309 lines

**Batch 125**

- [ ] `packages/client/ui-chat/src/client/conversation-nodes/tool.ts` — 306 lines
- [ ] `packages/client/ui-chat/src/client/conversation-nodes/process-groups.ts` — 303 lines
- [ ] `packages/client/ui-chat/src/client/chat/TurnNavigator.tsx` — 295 lines

**Batch 126**

- [ ] `packages/client/ui-chat/src/client/contract/slots.ts` — 273 lines
- [ ] `packages/client/ui-chat/tests/chat-apply.client.spec.tsx` — 271 lines

## `client/ui-conversation` — 34 files, 12 batches

**Batch 127**

- [ ] `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` — 1754 lines
- [ ] `packages/client/ui-conversation/tests/conversation-assembler.client.spec.ts` — 1618 lines
- [ ] `packages/client/ui-conversation/src/client/conversation/assembler.ts` — 1031 lines

**Batch 128**

- [ ] `packages/client/ui-conversation/src/client/locales.ts` — 881 lines
- [ ] `packages/client/ui-conversation/tests/service-orchestration.client.spec.ts` — 878 lines
- [ ] `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` — 870 lines

**Batch 129**

- [ ] `packages/client/ui-conversation/src/client/input/facade.ts` — 839 lines
- [ ] `packages/client/ui-conversation/tests/queue-dock.client.spec.tsx` — 764 lines
- [ ] `packages/client/ui-conversation/src/client/conversation/location-index.ts` — 632 lines

**Batch 130**

- [ ] `packages/client/ui-conversation/tests/history-transport.perf.client.ts` — 617 lines
- [ ] `packages/client/ui-conversation/src/client/service.ts` — 608 lines
- [ ] `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` — 589 lines

**Batch 131**

- [ ] `packages/client/ui-conversation/tests/conversation-registry.client.spec.ts` — 581 lines
- [ ] `packages/client/ui-conversation/src/client/contract/slots.ts` — 535 lines
- [ ] `packages/client/ui-conversation/src/client/apply.ts` — 529 lines

**Batch 132**

- [ ] `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` — 506 lines
- [ ] `packages/client/ui-conversation/tests/lexical-editor-core.client.spec.tsx` — 468 lines
- [ ] `packages/client/ui-conversation/src/client/queue/QueueDock.tsx` — 458 lines

**Batch 133**

- [ ] `packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx` — 412 lines
- [ ] `packages/client/ui-conversation/tests/submit-machine.client.spec.ts` — 394 lines
- [ ] `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx` — 370 lines

**Batch 134**

- [ ] `packages/client/ui-conversation/src/client/skeleton/HomeSections.tsx` — 367 lines
- [ ] `packages/client/ui-conversation/tests/home-start.client.spec.tsx` — 353 lines
- [ ] `packages/client/ui-conversation/src/client/contract/input.ts` — 332 lines

**Batch 135**

- [ ] `packages/client/ui-conversation/src/client/input/editor/runtime.ts` — 331 lines
- [ ] `packages/client/ui-conversation/src/client/conversation/assembly.ts` — 321 lines
- [ ] `packages/client/ui-conversation/src/client/contract/conversation.ts` — 320 lines

**Batch 136**

- [ ] `packages/client/ui-conversation/tests/conversation-groups.client.spec.ts` — 311 lines
- [ ] `packages/client/ui-conversation/src/client/contract/records.ts` — 296 lines
- [ ] `packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts` — 285 lines

**Batch 137**

- [ ] `packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx` — 266 lines
- [ ] `packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx` — 260 lines
- [ ] `packages/client/ui-conversation/src/client/input/hub.ts` — 259 lines

**Batch 138**

- [ ] `packages/client/ui-conversation/src/client/skeleton/home-commands.ts` — 257 lines

## `api/gateway` — 14 files, 5 batches

**Batch 139**

- [ ] `packages/api/gateway/tests/gateway.client.spec.ts` — 3330 lines
- [ ] `packages/api/gateway/tests/gateway-stream.host.spec.ts` — 1719 lines
- [ ] `packages/api/gateway/tests/gateway.host.spec.ts` — 1599 lines

**Batch 140**

- [ ] `packages/api/gateway/src/index.ts` — 1562 lines
- [ ] `packages/api/gateway/tests/journal-stream.client.spec.ts` — 1118 lines
- [ ] `packages/api/gateway/src/client/index.ts` — 882 lines

**Batch 141**

- [ ] `packages/api/gateway/tests/stream-server.host.spec.ts` — 628 lines
- [ ] `packages/api/gateway/src/client/journal-stream.ts` — 580 lines
- [ ] `packages/api/gateway/src/client/stream-client.ts` — 480 lines

**Batch 142**

- [ ] `packages/api/gateway/src/stream-server.ts` — 444 lines
- [ ] `packages/api/gateway/src/stream-protocol.ts` — 381 lines
- [ ] `packages/api/gateway/tests/control-retry.client.spec.ts` — 373 lines

**Batch 143**

- [ ] `packages/api/gateway/src/client/remote-events.ts` — 341 lines
- [ ] `packages/api/gateway/tests/remote-event-protocol.host.spec.ts` — 287 lines

## `apps/desktop` — 48 files, 16 batches

**Batch 144**

- [ ] `apps/desktop/tests/main-startup.spec.ts` — 1756 lines
- [ ] `apps/desktop/src/main.ts` — 1595 lines
- [ ] `apps/desktop/src/llama-server.ts` — 792 lines

**Batch 145**

- [ ] `apps/desktop/tests/redteam-runner.spec.ts` — 788 lines
- [ ] `apps/desktop/tests/llama-ipc.spec.ts` — 646 lines
- [ ] `apps/desktop/src/client/LlamaPage.tsx` — 621 lines

**Batch 146**

- [ ] `apps/desktop/src/redteam-runner.ts` — 613 lines
- [ ] `apps/desktop/tests/llama-server.spec.ts` — 586 lines
- [ ] `apps/desktop/src/redteam-msf.ts` — 583 lines

**Batch 147**

- [ ] `apps/desktop/tests/llama-integration.spec.ts` — 582 lines
- [ ] `apps/desktop/src/llama-ipc.ts` — 568 lines
- [ ] `apps/desktop/src/ollama-client.ts` — 536 lines

**Batch 148**

- [ ] `apps/desktop/scripts/package-target.ts` — 535 lines
- [ ] `apps/desktop/tests/llama-models.spec.ts` — 482 lines
- [ ] `apps/desktop/src/mcp-credentials.ts` — 473 lines

**Batch 149**

- [ ] `apps/desktop/tests/llama-hf.spec.ts` — 462 lines
- [ ] `apps/desktop/src/llama-hf.ts` — 459 lines
- [ ] `apps/desktop/tests/welcome-renderer.client.spec.tsx` — 445 lines

**Batch 150**

- [ ] `apps/desktop/src/client/WelcomePage.tsx` — 441 lines
- [ ] `apps/desktop/tests/windows-sign.spec.ts` — 421 lines
- [ ] `apps/desktop/src/llama-models.ts` — 400 lines

**Batch 151**

- [ ] `apps/desktop/tests/mcp-credentials.spec.ts` — 397 lines
- [ ] `apps/desktop/tests/ollama-client.spec.ts` — 391 lines
- [ ] `apps/desktop/tests/redteam-msf.spec.ts` — 372 lines

**Batch 152**

- [ ] `apps/desktop/tests/welcome-startup.spec.ts` — 356 lines
- [ ] `apps/desktop/src/locale.ts` — 351 lines
- [ ] `apps/desktop/tests/windows-asar-unpack.spec.ts` — 347 lines

**Batch 153**

- [ ] `apps/desktop/src/gguf-metadata.ts` — 338 lines
- [ ] `apps/desktop/tests/project-manager.spec.ts` — 332 lines
- [ ] `apps/desktop/tests/mcp-runner-settings.spec.ts` — 326 lines

**Batch 154**

- [ ] `apps/desktop/src/mandatory-update-window.ts` — 307 lines
- [ ] `apps/desktop/resources/redteam-runner/dist.bak-20261108-052337/context.d.ts` — 306 lines
- [ ] `apps/desktop/src/llama-shell.ts` — 305 lines

**Batch 155**

- [ ] `apps/desktop/resources/redteam-runner/dist.bak-20261108-052337/seclayer/src/types.d.ts` — 291 lines
- [ ] `apps/desktop/tests/primary-runtime-signing.spec.ts` — 291 lines
- [ ] `apps/desktop/src/client/OllamaPage.tsx` — 290 lines

**Batch 156**

- [ ] `apps/desktop/src/mcp-server-status.ts` — 289 lines
- [ ] `apps/desktop/scripts/desktop-upload-plan.ts` — 287 lines
- [ ] `apps/desktop/tests/redteam-runner-payload.spec.ts` — 279 lines

**Batch 157**

- [ ] `apps/desktop/scripts/installed-update-qualification.ts` — 278 lines
- [ ] `apps/desktop/src/host-process.ts` — 276 lines
- [ ] `apps/desktop/tests/macos-notarization-proxy.spec.ts` — 273 lines

**Batch 158**

- [ ] `apps/desktop/tests/installed-update-package-content.spec.ts` — 270 lines
- [ ] `apps/desktop/tests/windows-signature-cache.spec.ts` — 269 lines
- [ ] `apps/desktop/tests/platform-view.spec.ts` — 263 lines

**Batch 159**

- [ ] `apps/desktop/resources/redteam-runner/dist.bak-20261108-052337/types.d.ts` — 255 lines
- [ ] `apps/desktop/tests/installed-update-qualification.spec.ts` — 254 lines
- [ ] `apps/desktop/tests/desktop-upload-plan.spec.ts` — 252 lines

## `core/agent-loop` — 16 files, 6 batches

**Batch 160**

- [ ] `packages/core/agent-loop/tests/loop.spec.ts` — 1834 lines
- [ ] `packages/core/agent-loop/tests/contract-regressions.spec.ts` — 1552 lines
- [ ] `packages/core/agent-loop/tests/resume.spec.ts` — 1341 lines

**Batch 161**

- [ ] `packages/core/agent-loop/tests/scope-lifecycle.spec.ts` — 1188 lines
- [ ] `packages/core/agent-loop/tests/cancel.spec.ts` — 1152 lines
- [ ] `packages/core/agent-loop/tests/request-reconstruction.spec.ts` — 996 lines

**Batch 162**

- [ ] `packages/core/agent-loop/src/index.ts` — 893 lines
- [ ] `packages/core/agent-loop/tests/interception.spec.ts` — 827 lines
- [ ] `packages/core/agent-loop/tests/tool-calls.spec.ts` — 765 lines

**Batch 163**

- [ ] `packages/core/agent-loop/src/agent.ts` — 647 lines
- [ ] `packages/core/agent-loop/tests/config-session-id.spec.ts` — 541 lines
- [ ] `packages/core/agent-loop/tests/coverage-edges.spec.ts` — 539 lines

**Batch 164**

- [ ] `packages/core/agent-loop/tests/agent-initiator.spec.ts` — 408 lines
- [ ] `packages/core/agent-loop/tests/system-prompt-admission.spec.ts` — 314 lines
- [ ] `packages/core/agent-loop/src/tool-calls.ts` — 290 lines

**Batch 165**

- [ ] `packages/core/agent-loop/tests/inbox.spec.ts` — 278 lines

## `core/tools` — 12 files, 4 batches

**Batch 166**

- [ ] `packages/core/tools/tests/tools.spec.ts` — 2892 lines
- [ ] `packages/core/tools/tests/ptc.spec.ts` — 2374 lines
- [ ] `packages/core/tools/src/tool-runtime.ts` — 1285 lines

**Batch 167**

- [ ] `packages/core/tools/tests/py-types.spec.ts` — 1172 lines
- [ ] `packages/core/tools/src/py-types.ts` — 818 lines
- [ ] `packages/core/tools/src/ptc.ts` — 770 lines

**Batch 168**

- [ ] `packages/core/tools/tests/scoped.spec.ts` — 742 lines
- [ ] `packages/core/tools/src/json-schema.ts` — 656 lines
- [ ] `packages/core/tools/src/schema.ts` — 632 lines

**Batch 169**

- [ ] `packages/core/tools/tests/json-schema.spec.ts` — 455 lines
- [ ] `packages/core/tools/src/presentation.ts` — 389 lines
- [ ] `packages/core/tools/src/ts-types.ts` — 317 lines

## `experimental/ptc-runtime-python` — 5 files, 2 batches

**Batch 170**

- [ ] `packages/experimental/ptc-runtime-python/tests/runtime.spec.ts` — 5956 lines
- [ ] `packages/experimental/ptc-runtime-python/src/index.ts` — 2454 lines
- [ ] `packages/experimental/ptc-runtime-python/src/protocol.ts` — 718 lines

**Batch 171**

- [ ] `packages/experimental/ptc-runtime-python/tests/protocol.spec.ts` — 346 lines
- [ ] `packages/experimental/ptc-runtime-python/tests/boot-write-failure.spec.ts` — 321 lines

## `session/session-persistence-jsonl` — 13 files, 5 batches

**Batch 172**

- [ ] `packages/session/session-persistence-jsonl/tests/jsonl.spec.ts` — 2755 lines
- [ ] `packages/session/session-persistence-jsonl/src/index.ts` — 1725 lines
- [ ] `packages/session/session-persistence-jsonl/tests/generation.spec.ts` — 1652 lines

**Batch 173**

- [ ] `packages/session/session-persistence-jsonl/src/generation.ts` — 1059 lines
- [ ] `packages/session/session-persistence-jsonl/tests/zstd.spec.ts` — 883 lines
- [ ] `packages/session/session-persistence-jsonl/src/storage.ts` — 567 lines

**Batch 174**

- [ ] `packages/session/session-persistence-jsonl/src/format.ts` — 538 lines
- [ ] `packages/session/session-persistence-jsonl/tests/migration-refusal.spec.ts` — 527 lines
- [ ] `packages/session/session-persistence-jsonl/tests/catalog-migration.spec.ts` — 447 lines

**Batch 175**

- [ ] `packages/session/session-persistence-jsonl/tests/lease.spec.ts` — 434 lines
- [ ] `packages/session/session-persistence-jsonl/tests/v2-system-migration.spec.ts` — 306 lines
- [ ] `packages/session/session-persistence-jsonl/tests/multi-edge-publication.spec.ts` — 301 lines

**Batch 176**

- [ ] `packages/session/session-persistence-jsonl/tests/win32.spec.ts` — 288 lines

## `boot/app-boot` — 15 files, 5 batches

**Batch 177**

- [ ] `packages/boot/app-boot/tests/profile-resolution.spec.ts` — 2543 lines
- [ ] `packages/boot/app-boot/tests/app-boot.spec.ts` — 1325 lines
- [ ] `packages/boot/app-boot/src/index.ts` — 1064 lines

**Batch 178**

- [ ] `packages/boot/app-boot/src/profile-resolution/resolver.ts` — 923 lines
- [ ] `packages/boot/app-boot/tests/profile.spec.ts` — 796 lines
- [ ] `packages/boot/app-boot/src/profile.ts` — 724 lines

**Batch 179**

- [ ] `packages/boot/app-boot/tests/linked-resolution-matrix.spec.ts` — 644 lines
- [ ] `packages/boot/app-boot/tests/config-schema.spec.ts` — 608 lines
- [ ] `packages/boot/app-boot/tests/schemastery-json-schema.spec.ts` — 564 lines

**Batch 180**

- [ ] `packages/boot/app-boot/tests/user-patches.spec.ts` — 477 lines
- [ ] `packages/boot/app-boot/src/config-schema/projector.ts` — 455 lines
- [ ] `packages/boot/app-boot/tests/package-meta.spec.ts` — 435 lines

**Batch 181**

- [ ] `packages/boot/app-boot/tests/compatibility-preflight.spec.ts` — 365 lines
- [ ] `packages/boot/app-boot/tests/config-reload.spec.ts` — 304 lines
- [ ] `packages/boot/app-boot/tests/profile-resolution-service.spec.ts` — 268 lines

## `client/ui-workspace` — 14 files, 5 batches

**Batch 182**

- [ ] `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` — 2456 lines
- [ ] `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` — 1412 lines
- [ ] `packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` — 1138 lines

**Batch 183**

- [ ] `packages/client/ui-workspace/tests/rows.client.spec.tsx` — 962 lines
- [ ] `packages/client/ui-workspace/tests/tree.client.spec.ts` — 896 lines
- [ ] `packages/client/ui-workspace/src/client/rows/Rows.tsx` — 687 lines

**Batch 184**

- [ ] `packages/client/ui-workspace/src/client/tree.ts` — 655 lines
- [ ] `packages/client/ui-workspace/tests/apply.client.spec.ts` — 605 lines
- [ ] `packages/client/ui-workspace/tests/session-actions.client.spec.tsx` — 571 lines

**Batch 185**

- [ ] `packages/client/ui-workspace/src/client/navigation.ts` — 457 lines
- [ ] `packages/client/ui-workspace/src/client/contract/slots.ts` — 431 lines
- [ ] `packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx` — 323 lines

**Batch 186**

- [ ] `packages/client/ui-workspace/src/client/index.ts` — 313 lines
- [ ] `packages/client/ui-workspace/src/client/WorkspacePicker.tsx` — 251 lines

## `subprocess/subprocess-local` — 18 files, 6 batches

**Batch 187**

- [ ] `packages/subprocess/subprocess-local/tests/spawn.spec.ts` — 1533 lines
- [ ] `packages/subprocess/subprocess-local/tests/local.spec.ts` — 1107 lines
- [ ] `packages/subprocess/subprocess-local/tests/linux-scope.spec.ts` — 1085 lines

**Batch 188**

- [ ] `packages/subprocess/subprocess-local/tests/terminal.spec.ts` — 1006 lines
- [ ] `packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts` — 993 lines
- [ ] `packages/subprocess/subprocess-local/src/linux-scope.ts` — 612 lines

**Batch 189**

- [ ] `packages/subprocess/subprocess-local/src/process-inspector.ts` — 551 lines
- [ ] `packages/subprocess/subprocess-local/src/spawn.ts` — 492 lines
- [ ] `packages/subprocess/subprocess-local/src/spawn-runner.ts` — 490 lines

**Batch 190**

- [ ] `packages/subprocess/subprocess-local/tests/windows-job.spec.ts` — 481 lines
- [ ] `packages/subprocess/subprocess-local/src/terminal.ts` — 478 lines
- [ ] `packages/subprocess/subprocess-local/tests/process-inspector.spec.ts` — 360 lines

**Batch 191**

- [ ] `packages/subprocess/subprocess-local/src/windows-inspector.ts` — 346 lines
- [ ] `packages/subprocess/subprocess-local/src/index.ts` — 340 lines
- [ ] `packages/subprocess/subprocess-local/src/runner-launch.ts` — 315 lines

**Batch 192**

- [ ] `packages/subprocess/subprocess-local/src/output.ts` — 313 lines
- [ ] `packages/subprocess/subprocess-local/tests/native-containment.spec.ts` — 296 lines
- [ ] `packages/subprocess/subprocess-local/src/runner-protocol.ts` — 273 lines

## `test-support/session-snapshot` — 10 files, 4 batches

**Batch 193**

- [ ] `packages/test-support/session-snapshot/src/suite.ts` — 1753 lines
- [ ] `packages/test-support/session-snapshot/tests/suite.spec.ts` — 1607 lines
- [ ] `packages/test-support/session-snapshot/tests/harness.spec.ts` — 1432 lines

**Batch 194**

- [ ] `packages/test-support/session-snapshot/tests/normalize.spec.ts` — 1259 lines
- [ ] `packages/test-support/session-snapshot/src/harness.ts` — 815 lines
- [ ] `packages/test-support/session-snapshot/src/normalize.ts` — 625 lines

**Batch 195**

- [ ] `packages/test-support/session-snapshot/src/launcher.ts` — 465 lines
- [ ] `packages/test-support/session-snapshot/src/manifest.ts` — 432 lines
- [ ] `packages/test-support/session-snapshot/tests/fixtures/fake-acp-agent.ts` — 283 lines

**Batch 196**

- [ ] `packages/test-support/session-snapshot/src/session-files.ts` — 253 lines

## `subagent/subagent` — 14 files, 5 batches

**Batch 197**

- [ ] `packages/subagent/subagent/tests/continuation.spec.ts` — 3803 lines
- [ ] `packages/subagent/subagent/src/continuation-activation.ts` — 902 lines
- [ ] `packages/subagent/subagent/tests/list-children.spec.ts` — 790 lines

**Batch 198**

- [ ] `packages/subagent/subagent/src/index.ts` — 663 lines
- [ ] `packages/subagent/subagent/tests/service.spec.ts` — 567 lines
- [ ] `packages/subagent/subagent/src/continuation.ts` — 552 lines

**Batch 199**

- [ ] `packages/subagent/subagent/src/list-children.ts` — 402 lines
- [ ] `packages/subagent/subagent/src/types.ts` — 390 lines
- [ ] `packages/subagent/subagent/tests/control.spec.ts` — 339 lines

**Batch 200**

- [ ] `packages/subagent/subagent/src/descriptor.ts` — 323 lines
- [ ] `packages/subagent/subagent/tests/continuation-inheritance.spec.ts` — 315 lines
- [ ] `packages/subagent/subagent/src/child-agent.ts` — 289 lines

**Batch 201**

- [ ] `packages/subagent/subagent/src/lifecycle.ts` — 272 lines
- [ ] `packages/subagent/subagent/src/out-of-process.ts` — 259 lines

## `client/ui-trajectory` — 13 files, 5 batches

**Batch 202**

- [ ] `packages/client/ui-trajectory/tests/views.client.spec.tsx` — 1536 lines
- [ ] `packages/client/ui-trajectory/src/client/TrajectoryTablePane.tsx` — 1503 lines
- [ ] `packages/client/ui-trajectory/tests/table.client.spec.tsx` — 1229 lines

**Batch 203**

- [ ] `packages/client/ui-trajectory/tests/conversation-definitions.client.spec.ts` — 977 lines
- [ ] `packages/client/ui-trajectory/src/client/TrajectoryTimeline.tsx` — 739 lines
- [ ] `packages/client/ui-trajectory/tests/layout.client.spec.tsx` — 727 lines

**Batch 204**

- [ ] `packages/client/ui-trajectory/src/client/TrajectoryView.tsx` — 577 lines
- [ ] `packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts` — 467 lines
- [ ] `packages/client/ui-trajectory/src/client/layout-fold.ts` — 434 lines

**Batch 205**

- [ ] `packages/client/ui-trajectory/src/client/locales.ts` — 394 lines
- [ ] `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts` — 320 lines
- [ ] `packages/client/ui-trajectory/tests/snapshot-builder.client.spec.ts` — 301 lines

**Batch 206**

- [ ] `packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts` — 274 lines

## `typert/generator` — 11 files, 4 batches

**Batch 207**

- [ ] `packages/typert/generator/src/face-analyzer.ts` — 2190 lines
- [ ] `packages/typert/generator/tests/type-model.spec.ts` — 1659 lines
- [ ] `packages/typert/generator/tests/remote-model.spec.ts` — 1121 lines

**Batch 208**

- [ ] `packages/typert/generator/tests/schema-emitter.spec.ts` — 974 lines
- [ ] `packages/typert/generator/src/emitter-face.ts` — 502 lines
- [ ] `packages/typert/generator/src/model.ts` — 442 lines

**Batch 209**

- [ ] `packages/typert/generator/src/workspace-analyzer.ts` — 385 lines
- [ ] `packages/typert/generator/src/emitter-schema.ts` — 372 lines
- [ ] `packages/typert/generator/src/renderer.ts` — 365 lines

**Batch 210**

- [ ] `packages/typert/generator/tests/cordis-catalog-contract.spec.ts` — 343 lines
- [ ] `packages/typert/generator/src/cordis-catalog-runtime.ts` — 258 lines

## `experimental/webworker-runtime` — 25 files, 9 batches

**Batch 211**

- [ ] `packages/experimental/webworker-runtime/src/storage/memory.ts` — 1046 lines
- [ ] `packages/experimental/webworker-runtime/src/node/builtin_modules/implemented/fs.ts` — 877 lines
- [ ] `packages/experimental/webworker-runtime/tests/node/fs-watch-stream.spec.ts` — 812 lines

**Batch 212**

- [ ] `packages/experimental/webworker-runtime/tests/compile/transform.spec.ts` — 733 lines
- [ ] `packages/experimental/webworker-runtime/src/compile/transform.ts` — 625 lines
- [ ] `packages/experimental/webworker-runtime/src/client/client.ts` — 563 lines

**Batch 213**

- [ ] `packages/experimental/webworker-runtime/src/transport/tunnel.ts` — 556 lines
- [ ] `packages/experimental/webworker-runtime/tests/vfs-example-fixture.ts` — 491 lines
- [ ] `packages/experimental/webworker-runtime/src/worker-host.ts` — 462 lines

**Batch 214**

- [ ] `packages/experimental/webworker-runtime/src/module-system/module-loader.ts` — 452 lines
- [ ] `packages/experimental/webworker-runtime/src/node/builtin_modules/implemented/child_process.ts` — 452 lines
- [ ] `packages/experimental/webworker-runtime/src/node/builtin_modules/implemented/fs-watch.ts` — 428 lines

**Batch 215**

- [ ] `packages/experimental/webworker-runtime/src/node/builtin_modules/implemented/async_hooks.ts` — 406 lines
- [ ] `packages/experimental/webworker-runtime/src/node/builtin_modules/implemented/path.ts` — 398 lines
- [ ] `packages/experimental/webworker-runtime/tests/polyfill/als-runtime.spec.ts` — 393 lines

**Batch 216**

- [ ] `packages/experimental/webworker-runtime/tests/polyfill/als-shim.spec.ts` — 390 lines
- [ ] `packages/experimental/webworker-runtime/src/shell/interpret.ts` — 389 lines
- [ ] `packages/experimental/webworker-runtime/tests/transport/tunnel-client.spec.ts` — 367 lines

**Batch 217**

- [ ] `packages/experimental/webworker-runtime/src/shell/programs/text.ts` — 363 lines
- [ ] `packages/experimental/webworker-runtime/tests/storage/memory-vfs.spec.ts` — 360 lines
- [ ] `packages/experimental/webworker-runtime/tests/node/child-process.spec.ts` — 347 lines

**Batch 218**

- [ ] `packages/experimental/webworker-runtime/tests/transport/tunnel-server.spec.ts` — 305 lines
- [ ] `packages/experimental/webworker-runtime/src/shell/programs/files.ts` — 293 lines
- [ ] `packages/experimental/webworker-runtime/src/client/source-chooser.ts` — 264 lines

**Batch 219**

- [ ] `packages/experimental/webworker-runtime/src/storage/types.ts` — 257 lines

## `context/agent-instructions` — 5 files, 2 batches

**Batch 220**

- [ ] `packages/context/agent-instructions/tests/agent-instructions.spec.ts` — 4787 lines
- [ ] `packages/context/agent-instructions/src/files.ts` — 530 lines
- [ ] `packages/context/agent-instructions/src/state.ts` — 434 lines

**Batch 221**

- [ ] `packages/context/agent-instructions/src/render.ts` — 361 lines
- [ ] `packages/context/agent-instructions/src/index.ts` — 360 lines

## `client/ui-primitives` — 24 files, 8 batches

**Batch 222**

- [ ] `packages/client/ui-primitives/src/JsonTree.tsx` — 850 lines
- [ ] `packages/client/ui-primitives/src/markdown/render.tsx` — 759 lines
- [ ] `packages/client/ui-primitives/tests/atoms.client.spec.tsx` — 686 lines

**Batch 223**

- [ ] `packages/client/ui-primitives/tests/hover-card.client.spec.tsx` — 640 lines
- [ ] `packages/client/ui-primitives/tests/markdown.client.spec.tsx` — 603 lines
- [ ] `packages/client/ui-primitives/tests/markdown-incremental.client.spec.tsx` — 552 lines

**Batch 224**

- [ ] `packages/client/ui-primitives/tests/tooltip.client.spec.tsx` — 552 lines
- [ ] `packages/client/ui-primitives/src/Menu.tsx` — 534 lines
- [ ] `packages/client/ui-primitives/tests/ansi.client.spec.ts` — 506 lines

**Batch 225**

- [ ] `packages/client/ui-primitives/src/markdown/highlight.ts` — 487 lines
- [ ] `packages/client/ui-primitives/tests/json-tree.client.spec.tsx` — 475 lines
- [ ] `packages/client/ui-primitives/tests/terminal-block.client.spec.tsx` — 466 lines

**Batch 226**

- [ ] `packages/client/ui-primitives/src/ansi.ts` — 447 lines
- [ ] `packages/client/ui-primitives/src/settings-form/form-model.ts` — 393 lines
- [ ] `packages/client/ui-primitives/src/markdown/incremental.ts` — 360 lines

**Batch 227**

- [ ] `packages/client/ui-primitives/src/markdown/mathCompatibility.ts` — 349 lines
- [ ] `packages/client/ui-primitives/src/code-file-types.ts` — 338 lines
- [ ] `packages/client/ui-primitives/tests/settings-form-model.client.spec.ts` — 319 lines

**Batch 228**

- [ ] `packages/client/ui-primitives/tests/streaming-code-block.client.spec.tsx` — 299 lines
- [ ] `packages/client/ui-primitives/src/HoverCard.tsx` — 292 lines
- [ ] `packages/client/ui-primitives/src/TerminalBlock.tsx` — 283 lines

**Batch 229**

- [ ] `packages/client/ui-primitives/src/FileTypeIcon.tsx` — 282 lines
- [ ] `packages/client/ui-primitives/src/SearchBlock.tsx` — 281 lines
- [ ] `packages/client/ui-primitives/tests/markdown-dom-parity.client.spec.tsx` — 267 lines

## `core/session` — 11 files, 4 batches

**Batch 230**

- [ ] `packages/core/session/tests/session.spec.ts` — 1820 lines
- [ ] `packages/core/session/src/index.ts` — 1310 lines
- [ ] `packages/core/session/tests/surface.spec.ts` — 1024 lines

**Batch 231**

- [ ] `packages/core/session/src/surface.ts` — 718 lines
- [ ] `packages/core/session/src/types.ts` — 523 lines
- [ ] `packages/core/session/tests/fork.spec.ts` — 472 lines

**Batch 232**

- [ ] `packages/core/session/tests/invariant.spec.ts` — 469 lines
- [ ] `packages/core/session/tests/repair.spec.ts` — 383 lines
- [ ] `packages/core/session/tests/canonical-envelopes.spec.ts` — 352 lines

**Batch 233**

- [ ] `packages/core/session/tests/gen-persistence-catalog.spec.ts` — 300 lines
- [ ] `packages/core/session/src/invariant.ts` — 258 lines

## `llm/llm-pi-ai` — 16 files, 6 batches

**Batch 234**

- [ ] `packages/llm/llm-pi-ai/tests/catalog.spec.ts` — 1253 lines
- [ ] `packages/llm/llm-pi-ai/tests/adapter.spec.ts` — 1036 lines
- [ ] `packages/llm/llm-pi-ai/tests/convert.spec.ts` — 995 lines

**Batch 235**

- [ ] `packages/llm/llm-pi-ai/src/catalog.ts` — 957 lines
- [ ] `packages/llm/llm-pi-ai/tests/context.spec.ts` — 572 lines
- [ ] `packages/llm/llm-pi-ai/tests/discovery.spec.ts` — 551 lines

**Batch 236**

- [ ] `packages/llm/llm-pi-ai/src/config.ts` — 514 lines
- [ ] `packages/llm/llm-pi-ai/src/adapter.ts` — 425 lines
- [ ] `packages/llm/llm-pi-ai/src/discovery.ts` — 363 lines

**Batch 237**

- [ ] `packages/llm/llm-pi-ai/src/context.ts` — 339 lines
- [ ] `packages/llm/llm-pi-ai/src/index.ts` — 317 lines
- [ ] `packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts` — 312 lines

**Batch 238**

- [ ] `packages/llm/llm-pi-ai/tests/media-default.spec.ts` — 273 lines
- [ ] `packages/llm/llm-pi-ai/tests/loader-composition.spec.ts` — 270 lines
- [ ] `packages/llm/llm-pi-ai/tests/provider-apis.e2e.ts` — 263 lines

**Batch 239**

- [ ] `packages/llm/llm-pi-ai/src/replay.ts` — 261 lines

## `client/ui-settings-models` — 11 files, 4 batches

**Batch 240**

- [ ] `packages/client/ui-settings-models/tests/components.client.spec.tsx` — 1871 lines
- [ ] `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` — 1648 lines
- [ ] `packages/client/ui-settings-models/src/client/ModelsSection.tsx` — 704 lines

**Batch 241**

- [ ] `packages/client/ui-settings-models/src/client/ProviderEditor.tsx` — 531 lines
- [ ] `packages/client/ui-settings-models/src/client/ModelListEditor.tsx` — 461 lines
- [ ] `packages/client/ui-settings-models/tests/apply.client.spec.ts` — 364 lines

**Batch 242**

- [ ] `packages/client/ui-settings-models/src/client/store.ts` — 340 lines
- [ ] `packages/client/ui-settings-models/tests/store.client.spec.ts` — 331 lines
- [ ] `packages/client/ui-settings-models/src/client/CustomProviderCard.tsx` — 320 lines

**Batch 243**

- [ ] `packages/client/ui-settings-models/tests/onboarding-dialog.client.spec.tsx` — 314 lines
- [ ] `packages/client/ui-settings-models/src/client/DeepSeekModelsEditor.tsx` — 307 lines

## `client/ui-plugin-manager` — 5 files, 2 batches

**Batch 244**

- [ ] `packages/client/ui-plugin-manager/tests/components.client.spec.tsx` — 1420 lines
- [ ] `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx` — 1364 lines
- [ ] `packages/client/ui-plugin-manager/tests/manager-store.client.spec.ts` — 1342 lines

**Batch 245**

- [ ] `packages/client/ui-plugin-manager/src/client/manager-store.ts` — 1035 lines
- [ ] `packages/client/ui-plugin-manager/src/client/locales.ts` — 380 lines

## `experimental/inspector` — 27 files, 9 batches

**Batch 246**

- [ ] `packages/experimental/inspector/tests/cordis-tree.host.spec.ts` — 840 lines
- [ ] `packages/experimental/inspector/tests/integration.host.spec.ts` — 688 lines
- [ ] `packages/experimental/inspector/src/worker/cdp/domains/dom/session.ts` — 522 lines

**Batch 247**

- [ ] `packages/experimental/inspector/src/client/cdp/runtime.ts` — 501 lines
- [ ] `packages/experimental/inspector/src/worker/cdp/domains/runtime/session.ts` — 474 lines
- [ ] `packages/experimental/inspector/tests/network.host.spec.ts` — 474 lines

**Batch 248**

- [ ] `packages/experimental/inspector/tests/plugin.client.spec.ts` — 462 lines
- [ ] `packages/experimental/inspector/src/worker/inspection/network-store.ts` — 449 lines
- [ ] `packages/experimental/inspector/tests/fetch-observer.host.spec.ts` — 408 lines

**Batch 249**

- [ ] `packages/experimental/inspector/src/client/cdp/objects.ts` — 406 lines
- [ ] `packages/experimental/inspector/src/shared/bridge/messages/observation.ts` — 391 lines
- [ ] `packages/experimental/inspector/src/worker/bridge/runtime-rpc.ts` — 380 lines

**Batch 250**

- [ ] `packages/experimental/inspector/src/host/bridge/controller.ts` — 350 lines
- [ ] `packages/experimental/inspector/src/worker/cdp/domains/debugger/session.ts` — 350 lines
- [ ] `packages/experimental/inspector/tests/cordis-query.host.spec.ts` — 349 lines

**Batch 251**

- [ ] `packages/experimental/inspector/src/worker/realms/host/runtime.ts` — 338 lines
- [ ] `packages/experimental/inspector/src/shared/bridge/messages/runtime/value-codec.ts` — 334 lines
- [ ] `packages/experimental/inspector/src/worker/bridge/hub.ts` — 323 lines

**Batch 252**

- [ ] `packages/experimental/inspector/src/worker/cdp/domains/runtime/object-table.ts` — 323 lines
- [ ] `packages/experimental/inspector/src/client/bridge/transport.ts` — 318 lines
- [ ] `packages/experimental/inspector/src/worker/bridge/endpoint.ts` — 304 lines

**Batch 253**

- [ ] `packages/experimental/inspector/tests/client-browser.e2e.ts` — 301 lines
- [ ] `packages/experimental/inspector/src/worker/cdp/domains/dom/model.ts` — 297 lines
- [ ] `packages/experimental/inspector/tests/client-runtime.client.spec.ts` — 296 lines

**Batch 254**

- [ ] `packages/experimental/inspector/tests/protocol.host.spec.ts` — 274 lines
- [ ] `packages/experimental/inspector/src/worker/cdp/domains/runtime/cdp-params.ts` — 256 lines
- [ ] `packages/experimental/inspector/src/worker/inspection/query-router.ts` — 255 lines

## `compaction/compaction-basic` — 6 files, 2 batches

**Batch 255**

- [ ] `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` — 2393 lines
- [ ] `packages/compaction/compaction-basic/tests/manual-compaction.spec.ts` — 945 lines
- [ ] `packages/compaction/compaction-basic/src/region.ts` — 600 lines

**Batch 256**

- [ ] `packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts` — 508 lines
- [ ] `packages/compaction/compaction-basic/src/index.ts` — 464 lines
- [ ] `packages/compaction/compaction-basic/src/config.ts` — 383 lines

## `apps/cli` — 12 files, 4 batches

**Batch 257**

- [ ] `apps/cli/tests/built-bin.e2e.ts` — 1321 lines
- [ ] `apps/cli/tests/profiles/headless/tests/headless.expected.e2e.ts` — 1031 lines
- [ ] `apps/cli/tests/web-agent-presets.e2e.ts` — 895 lines

**Batch 258**

- [ ] `apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts` — 534 lines
- [ ] `apps/cli/tests/github-webhook-real.e2e.ts` — 467 lines
- [ ] `apps/cli/tests/profiles/web/tests/web-failure-matrix.expected.e2e.ts` — 424 lines

**Batch 259**

- [ ] `apps/cli/tests/dump-config-schema.expected.e2e.ts` — 420 lines
- [ ] `apps/cli/tests/profiles/headless/tests/ptc.e2e.ts` — 401 lines
- [ ] `apps/cli/tests/profiles/web/tests/web-best-effort-startup.expected.e2e.ts` — 380 lines

**Batch 260**

- [ ] `apps/cli/src/profile-boot.ts` — 324 lines
- [ ] `apps/cli/tests/profiles/headless/tests/profile-resolution.ts` — 313 lines
- [ ] `apps/cli/tests/profiles/headless/tests/workspace-context-resume.expected.e2e.ts` — 258 lines

## `llm/llm-deepseek` — 11 files, 4 batches

**Batch 261**

- [ ] `packages/llm/llm-deepseek/tests/runtime.spec.ts` — 2346 lines
- [ ] `packages/llm/llm-deepseek/tests/file-store.spec.ts` — 576 lines
- [ ] `packages/llm/llm-deepseek/tests/adapter.spec.ts` — 503 lines

**Batch 262**

- [ ] `packages/llm/llm-deepseek/tests/runtime.e2e.ts` — 462 lines
- [ ] `packages/llm/llm-deepseek/tests/serialize.spec.ts` — 461 lines
- [ ] `packages/llm/llm-deepseek/tests/files-api.spec.ts` — 400 lines

**Batch 263**

- [ ] `packages/llm/llm-deepseek/src/file-store.ts` — 344 lines
- [ ] `packages/llm/llm-deepseek/src/config.ts` — 329 lines
- [ ] `packages/llm/llm-deepseek/tests/dynamic-config.spec.ts` — 315 lines

**Batch 264**

- [ ] `packages/llm/llm-deepseek/tests/adapter.e2e.ts` — 282 lines
- [ ] `packages/llm/llm-deepseek/src/files-api.ts` — 265 lines

## `llm/llm` — 10 files, 4 batches

**Batch 265**

- [ ] `packages/llm/llm/tests/service.spec.ts` — 1465 lines
- [ ] `packages/llm/llm/src/index.ts` — 1153 lines
- [ ] `packages/llm/llm/src/assistant-stream.ts` — 534 lines

**Batch 266**

- [ ] `packages/llm/llm/src/types.ts` — 526 lines
- [ ] `packages/llm/llm/tests/assistant-stream.spec.ts` — 487 lines
- [ ] `packages/llm/llm/tests/content.spec.ts` — 401 lines

**Batch 267**

- [ ] `packages/llm/llm/src/content.ts` — 366 lines
- [ ] `packages/llm/llm/tests/topology.spec.ts` — 340 lines
- [ ] `packages/llm/llm/src/message.ts` — 307 lines

**Batch 268**

- [ ] `packages/llm/llm/tests/assembler.spec.ts` — 264 lines

## `experimental/agent-team` — 9 files, 3 batches

**Batch 269**

- [ ] `packages/experimental/agent-team/tests/team.spec.ts` — 2014 lines
- [ ] `packages/experimental/agent-team/tests/projection-events.spec.ts` — 619 lines
- [ ] `packages/experimental/agent-team/src/roster.ts` — 606 lines

**Batch 270**

- [ ] `packages/experimental/agent-team/tests/persistence.spec.ts` — 596 lines
- [ ] `packages/experimental/agent-team/src/projection.ts` — 416 lines
- [ ] `packages/experimental/agent-team/src/mailbox.ts` — 332 lines

**Batch 271**

- [ ] `packages/experimental/agent-team/src/task-board.ts` — 332 lines
- [ ] `packages/experimental/agent-team/src/types.ts` — 327 lines
- [ ] `packages/experimental/agent-team/src/index.ts` — 291 lines

## `client/modules` — 6 files, 2 batches

**Batch 272**

- [ ] `packages/client/modules/src/index.ts` — 1159 lines
- [ ] `packages/client/modules/tests/node-half.client.spec.ts` — 1128 lines
- [ ] `packages/client/modules/tests/loader.client.spec.ts` — 903 lines

**Batch 273**

- [ ] `packages/client/modules/tests/entries.client.spec.ts` — 517 lines
- [ ] `packages/client/modules/src/client/system.ts` — 479 lines
- [ ] `packages/client/modules/src/client/manifest.ts` — 448 lines

## `subagent/subagent-codex` — 5 files, 2 batches

**Batch 274**

- [ ] `packages/subagent/subagent-codex/tests/subagent-codex.spec.ts` — 2311 lines
- [ ] `packages/subagent/subagent-codex/src/wire.ts` — 703 lines
- [ ] `packages/subagent/subagent-codex/tests/real-product.spec.ts` — 530 lines

**Batch 275**

- [ ] `packages/subagent/subagent-codex/src/run.ts` — 439 lines
- [ ] `packages/subagent/subagent-codex/tests/responses-fixture.ts` — 328 lines

## `test-support/llm-replay` — 2 files, 1 batches

**Batch 276**

- [ ] `packages/test-support/llm-replay/tests/llm-replay.spec.ts` — 2323 lines
- [ ] `packages/test-support/llm-replay/src/index.ts` — 1196 lines

## `session-query/session-query-sqlite` — 4 files, 2 batches

**Batch 277**

- [ ] `packages/session-query/session-query-sqlite/tests/sqlite.spec.ts` — 1880 lines
- [ ] `packages/session-query/session-query-sqlite/src/index.ts` — 1131 lines
- [ ] `packages/session-query/session-query-sqlite/src/query.ts` — 477 lines

**Batch 278**

- [ ] `packages/session-query/session-query-sqlite/tests/query.spec.ts` — 262 lines

## `client/ui-dockkit` — 10 files, 4 batches

**Batch 279**

- [ ] `packages/client/ui-dockkit/tests/components.client.spec.tsx` — 1513 lines
- [ ] `packages/client/ui-dockkit/tests/apply.client.spec.ts` — 629 lines
- [ ] `packages/client/ui-dockkit/src/engine/operations.ts` — 464 lines

**Batch 280**

- [ ] `packages/client/ui-dockkit/src/components/TabPanel.tsx` — 433 lines
- [ ] `packages/client/ui-dockkit/tests/planner.client.spec.ts` — 406 lines
- [ ] `packages/client/ui-dockkit/src/engine/planner.ts` — 398 lines

**Batch 281**

- [ ] `packages/client/ui-dockkit/tests/controller.client.spec.ts` — 360 lines
- [ ] `packages/client/ui-dockkit/src/engine/tree.ts` — 323 lines
- [ ] `packages/client/ui-dockkit/src/components/DockSurface.tsx` — 316 lines

**Batch 282**

- [ ] `packages/client/ui-dockkit/src/engine/controller.ts` — 315 lines

## `boot/plugin-manager` — 5 files, 2 batches

**Batch 283**

- [ ] `packages/boot/plugin-manager/tests/manager.spec.ts` — 1396 lines
- [ ] `packages/boot/plugin-manager/tests/operations.spec.ts` — 821 lines
- [ ] `packages/boot/plugin-manager/src/index.ts` — 804 lines

**Batch 284**

- [ ] `packages/boot/plugin-manager/src/operations.ts` — 580 lines
- [ ] `packages/boot/plugin-manager/src/types.ts` — 258 lines

## `client/ui-renderer` — 5 files, 2 batches

**Batch 285**

- [ ] `packages/client/ui-renderer/tests/scoped-slots.client.spec.tsx` — 1170 lines
- [ ] `packages/client/ui-renderer/tests/registry.client.spec.ts` — 947 lines
- [ ] `packages/client/ui-renderer/src/client/registry.ts` — 764 lines

**Batch 286**

- [ ] `packages/client/ui-renderer/tests/factory-slots.client.spec.tsx` — 693 lines
- [ ] `packages/client/ui-renderer/tests/session-provider.client.spec.tsx` — 274 lines

## `terminal/terminal-bash` — 5 files, 2 batches

**Batch 287**

- [ ] `packages/terminal/terminal-bash/tests/session.spec.ts` — 1631 lines
- [ ] `packages/terminal/terminal-bash/src/session.ts` — 785 lines
- [ ] `packages/terminal/terminal-bash/tests/index.spec.ts` — 730 lines

**Batch 288**

- [ ] `packages/terminal/terminal-bash/tests/local.spec.ts` — 399 lines
- [ ] `packages/terminal/terminal-bash/tests/session-buffer.spec.ts` — 297 lines

## `session/session-format-v0-to-v1` — 9 files, 3 batches

**Batch 289**

- [ ] `packages/session/session-format-v0-to-v1/src/payload-validation.ts` — 1062 lines
- [ ] `packages/session/session-format-v0-to-v1/tests/validation.spec.ts` — 789 lines
- [ ] `packages/session/session-format-v0-to-v1/tests/relationships.spec.ts` — 695 lines

**Batch 290**

- [ ] `packages/session/session-format-v0-to-v1/src/relationships.ts` — 497 lines
- [ ] `packages/session/session-format-v0-to-v1/src/migration.ts` — 448 lines
- [ ] `packages/session/session-format-v0-to-v1/tests/migration.spec.ts` — 415 lines

**Batch 291**

- [ ] `packages/session/session-format-v0-to-v1/src/codec.ts` — 322 lines
- [ ] `packages/session/session-format-v0-to-v1/tests/legacy.spec.ts` — 296 lines
- [ ] `packages/session/session-format-v0-to-v1/tests/codec.spec.ts` — 263 lines

## `mcp/mcp-client` — 6 files, 2 batches

**Batch 292**

- [ ] `packages/mcp/mcp-client/tests/mcp-client.spec.ts` — 1273 lines
- [ ] `packages/mcp/mcp-client/tests/reconnect.spec.ts` — 618 lines
- [ ] `packages/mcp/mcp-client/src/tools.ts` — 564 lines

**Batch 293**

- [ ] `packages/mcp/mcp-client/tests/mcp-client.e2e.ts` — 562 lines
- [ ] `packages/mcp/mcp-client/tests/apply.spec.ts` — 544 lines
- [ ] `packages/mcp/mcp-client/src/connection.ts` — 420 lines

## `client/ui-directory-picker-browse` — 2 files, 1 batches

**Batch 294**

- [ ] `packages/client/ui-directory-picker-browse/tests/directory-browser.client.spec.tsx` — 1760 lines
- [ ] `packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx` — 1052 lines

## `session-query/session-query` — 9 files, 3 batches

**Batch 295**

- [ ] `packages/session-query/session-query/tests/session-query.spec.ts` — 1295 lines
- [ ] `packages/session-query/session-query/tests/observation.spec.ts` — 788 lines
- [ ] `packages/session-query/session-query/tests/tracing.spec.ts` — 523 lines

**Batch 296**

- [ ] `packages/session-query/session-query/src/index.ts` — 408 lines
- [ ] `packages/session-query/session-query/src/observation.ts` — 357 lines
- [ ] `packages/session-query/session-query/src/corpus.ts` — 317 lines

**Batch 297**

- [ ] `packages/session-query/session-query/tests/search-helpers.spec.ts` — 316 lines
- [ ] `packages/session-query/session-query/src/types.ts` — 288 lines
- [ ] `packages/session-query/session-query/src/tracing.ts` — 254 lines

## `sandbox/sandbox-windows-acl` — 8 files, 3 batches

**Batch 298**

- [ ] `packages/sandbox/sandbox-windows-acl/tests/acl-failure-paths.spec.ts` — 863 lines
- [ ] `packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts` — 664 lines
- [ ] `packages/sandbox/sandbox-windows-acl/tests/acl.spec.ts` — 515 lines

**Batch 299**

- [ ] `packages/sandbox/sandbox-windows-acl/tests/token-failure-paths.spec.ts` — 492 lines
- [ ] `packages/sandbox/sandbox-windows-acl/tests/index-failure-paths.spec.ts` — 482 lines
- [ ] `packages/sandbox/sandbox-windows-acl/src/acl.ts` — 448 lines

**Batch 300**

- [ ] `packages/sandbox/sandbox-windows-acl/src/index.ts` — 446 lines
- [ ] `packages/sandbox/sandbox-windows-acl/src/ffi.ts` — 314 lines

## `subagent/subagent-claude-code` — 3 files, 1 batches

**Batch 301**

- [ ] `packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts` — 1770 lines
- [ ] `packages/subagent/subagent-claude-code/src/run.ts` — 587 lines
- [ ] `packages/subagent/subagent-claude-code/tests/real-product.spec.ts` — 572 lines

## `redteam/llm-router` — 17 files, 6 batches

**Batch 302**

- [ ] `packages/redteam/llm-router/src/pool.ts` — 852 lines
- [ ] `packages/redteam/llm-router/src/resilience.ts` — 582 lines
- [ ] `packages/redteam/llm-router/test/resilience.test.ts` — 543 lines

**Batch 303**

- [ ] `packages/redteam/llm-router/test/pool.test.ts` — 437 lines
- [ ] `packages/redteam/llm-router/src/classifier.ts` — 385 lines
- [ ] `packages/redteam/llm-router/src/router.ts` — 371 lines

**Batch 304**

- [ ] `packages/redteam/llm-router/src/providers/ollama.ts` — 338 lines
- [ ] `packages/redteam/llm-router/test/meta-provider.test.ts` — 333 lines
- [ ] `packages/redteam/llm-router/test/response-format.test.ts` — 327 lines

**Batch 305**

- [ ] `packages/redteam/llm-router/src/charter/bakeoff.ts` — 304 lines
- [ ] `packages/redteam/llm-router/src/providers/anthropic.ts` — 292 lines
- [ ] `packages/redteam/llm-router/src/index.ts` — 286 lines

**Batch 306**

- [ ] `packages/redteam/llm-router/src/fleet-provider-record.ts` — 280 lines
- [ ] `packages/redteam/llm-router/src/charter/fallback.ts` — 279 lines
- [ ] `packages/redteam/llm-router/test/classifier.test.ts` — 278 lines

**Batch 307**

- [ ] `packages/redteam/llm-router/test/executor.test.ts` — 263 lines
- [ ] `packages/redteam/llm-router/src/adapter.ts` — 262 lines

## `extensions/cordis-host-runner` — 6 files, 2 batches

**Batch 308**

- [ ] `packages/extensions/cordis-host-runner/src/index.ts` — 1276 lines
- [ ] `packages/extensions/cordis-host-runner/src/guard.ts` — 836 lines
- [ ] `packages/extensions/cordis-host-runner/tests/runner.spec.ts` — 578 lines

**Batch 309**

- [ ] `packages/extensions/cordis-host-runner/src/types.ts` — 400 lines
- [ ] `packages/extensions/cordis-host-runner/src/registry.ts` — 276 lines
- [ ] `packages/extensions/cordis-host-runner/tests/sandbox-context.spec.ts` — 267 lines

## `client/ui-sidebar-right` — 9 files, 3 batches

**Batch 310**

- [ ] `packages/client/ui-sidebar-right/tests/service.client.spec.ts` — 766 lines
- [ ] `packages/client/ui-sidebar-right/tests/seat.client.spec.tsx` — 737 lines
- [ ] `packages/client/ui-sidebar-right/src/client/service.ts` — 571 lines

**Batch 311**

- [ ] `packages/client/ui-sidebar-right/tests/stores.client.spec.ts` — 452 lines
- [ ] `packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx` — 439 lines
- [ ] `packages/client/ui-sidebar-right/src/client/stores.ts` — 438 lines

**Batch 312**

- [ ] `packages/client/ui-sidebar-right/src/client/tab-registry.ts` — 411 lines
- [ ] `packages/client/ui-sidebar-right/tests/tab-registry.client.spec.ts` — 303 lines
- [ ] `packages/client/ui-sidebar-right/tests/apply.client.spec.ts` — 265 lines

## `subagent/tool-subagent` — 4 files, 2 batches

**Batch 313**

- [ ] `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` — 1472 lines
- [ ] `packages/subagent/tool-subagent/src/index.ts` — 712 lines
- [ ] `packages/subagent/tool-subagent/tests/model-selection-settings.spec.ts` — 494 lines

**Batch 314**

- [ ] `packages/subagent/tool-subagent/tests/model-selection.spec.ts` — 451 lines

## `experimental/auto-review` — 3 files, 1 batches

**Batch 315**

- [ ] `packages/experimental/auto-review/tests/auto-review.spec.ts` — 1741 lines
- [ ] `packages/experimental/auto-review/src/index.ts` — 701 lines
- [ ] `packages/experimental/auto-review/tests/auto-review.e2e.ts` — 402 lines

## `schedule/schedule` — 7 files, 3 batches

**Batch 316**

- [ ] `packages/schedule/schedule/src/domain.ts` — 834 lines
- [ ] `packages/schedule/schedule/tests/runtime.spec.ts` — 829 lines
- [ ] `packages/schedule/schedule/tests/tools.spec.ts` — 574 lines

**Batch 317**

- [ ] `packages/schedule/schedule/tests/domain.spec.ts` — 479 lines
- [ ] `packages/schedule/schedule/src/tools.ts` — 468 lines
- [ ] `packages/schedule/schedule/src/runtime.ts` — 339 lines

**Batch 318**

- [ ] `packages/schedule/schedule/tests/plugin.spec.ts` — 274 lines

## `fs/fs-local` — 4 files, 2 batches

**Batch 319**

- [ ] `packages/fs/fs-local/tests/fsio.spec.ts` — 998 lines
- [ ] `packages/fs/fs-local/tests/filesystem.spec.ts` — 837 lines
- [ ] `packages/fs/fs-local/src/fsio.ts` — 836 lines

**Batch 320**

- [ ] `packages/fs/fs-local/src/index.ts` — 301 lines

## `session-query/tool-session-query` — 5 files, 2 batches

**Batch 321**

- [ ] `packages/session-query/tool-session-query/tests/tool-session-query.spec.ts` — 2109 lines
- [ ] `packages/session-query/tool-session-query/src/input.ts` — 307 lines
- [ ] `packages/session-query/tool-session-query/src/operations.ts` — 286 lines

**Batch 322**

- [ ] `packages/session-query/tool-session-query/src/workspace-access.ts` — 257 lines
- [ ] `packages/session-query/tool-session-query/src/presentation.ts` — 255 lines

## `vendor` — 9 files, 3 batches

**Batch 323**

- [ ] `vendor/schemastery/src/index.ts` — 962 lines
- [ ] `vendor/cordis/src/fiber.ts` — 754 lines
- [ ] `vendor/hmr/src/index.ts` — 427 lines

**Batch 324**

- [ ] `vendor/cordis/src/reflect.ts` — 418 lines
- [ ] `vendor/cordis/src/events.ts` — 352 lines
- [ ] `vendor/include/src/index.ts` — 343 lines

**Batch 325**

- [ ] `vendor/cordis/src/registry.ts` — 337 lines
- [ ] `vendor/cordis/src/utils.ts` — 287 lines
- [ ] `vendor/cordis/src/logger.ts` — 271 lines

## `subagent/subagent-acp` — 3 files, 1 batches

**Batch 326**

- [ ] `packages/subagent/subagent-acp/tests/subagent-acp.spec.ts` — 1726 lines
- [ ] `packages/subagent/subagent-acp/src/run.ts` — 619 lines
- [ ] `packages/subagent/subagent-acp/tests/mock-acp-server.ts` — 298 lines

## `fs/tool-fs` — 5 files, 2 batches

**Batch 327**

- [ ] `packages/fs/tool-fs/tests/tools.spec.ts` — 1096 lines
- [ ] `packages/fs/tool-fs/tests/read-image.spec.ts` — 849 lines
- [ ] `packages/fs/tool-fs/tests/integration.spec.ts` — 515 lines

**Batch 328**

- [ ] `packages/fs/tool-fs/src/read-image.ts` — 351 lines
- [ ] `packages/fs/tool-fs/src/read-render.ts` — 272 lines

## `snapshots` — 2 files, 1 batches

**Batch 329**

- [ ] `snapshots/session/headless.snapshot.ts` — 1281 lines
- [ ] `snapshots/sdk/sdk.snapshot.ts` — 1021 lines

## `workspace/workspace` — 2 files, 1 batches

**Batch 330**

- [ ] `packages/workspace/workspace/tests/workspace.spec.ts` — 1387 lines
- [ ] `packages/workspace/workspace/src/index.ts` — 899 lines

## `shell/tool-bash` — 3 files, 1 batches

**Batch 331**

- [ ] `packages/shell/tool-bash/tests/tools.spec.ts` — 1446 lines
- [ ] `packages/shell/tool-bash/src/index.ts` — 576 lines
- [ ] `packages/shell/tool-bash/tests/background.spec.ts` — 502 lines

## `client/connection` — 10 files, 4 batches

**Batch 332**

- [ ] `packages/client/connection/tests/connection.client.spec.ts` — 800 lines
- [ ] `packages/client/connection/tests/node-half.host.spec.ts` — 673 lines
- [ ] `packages/client/connection/tests/client-apply.client.spec.ts` — 628 lines

**Batch 333**

- [ ] `packages/client/connection/src/rpc-host.ts` — 331 lines
- [ ] `packages/client/connection/src/client/index.ts` — 326 lines
- [ ] `packages/client/connection/src/client/connection.ts` — 323 lines

**Batch 334**

- [ ] `packages/client/connection/src/browser-auth.ts` — 316 lines
- [ ] `packages/client/connection/src/rpc.ts` — 291 lines
- [ ] `packages/client/connection/tests/binary-rpc.host.spec.ts` — 285 lines

**Batch 335**

- [ ] `packages/client/connection/tests/browser-auth.host.spec.ts` — 273 lines

## `acp/acp` — 6 files, 2 batches

**Batch 336**

- [ ] `packages/acp/acp/tests/bridge.spec.ts` — 1005 lines
- [ ] `packages/acp/acp/tests/turns.spec.ts` — 570 lines
- [ ] `packages/acp/acp/src/index.ts` — 536 lines

**Batch 337**

- [ ] `packages/acp/acp/src/session.ts` — 524 lines
- [ ] `packages/acp/acp/tests/harness.ts` — 309 lines
- [ ] `packages/acp/acp/tests/dispose.spec.ts` — 277 lines

## `test-support/client-runtime` — 6 files, 2 batches

**Batch 338**

- [ ] `packages/test-support/client-runtime/tests/runtime.client.spec.tsx` — 941 lines
- [ ] `packages/test-support/client-runtime/src/sessions.ts` — 836 lines
- [ ] `packages/test-support/client-runtime/src/index.ts` — 482 lines

**Batch 339**

- [ ] `packages/test-support/client-runtime/src/assembly/test-client.ts` — 349 lines
- [ ] `packages/test-support/client-runtime/tests/assembly-bundle-roster.client.spec.ts` — 320 lines
- [ ] `packages/test-support/client-runtime/tests/assembly-test-client.client.spec.ts` — 273 lines

## `session/session-format-v1-to-v2` — 5 files, 2 batches

**Batch 340**

- [ ] `packages/session/session-format-v1-to-v2/tests/migration.spec.ts` — 1251 lines
- [ ] `packages/session/session-format-v1-to-v2/src/migration.ts` — 695 lines
- [ ] `packages/session/session-format-v1-to-v2/tests/validation.spec.ts` — 444 lines

**Batch 341**

- [ ] `packages/session/session-format-v1-to-v2/tests/codec.spec.ts` — 294 lines
- [ ] `packages/session/session-format-v1-to-v2/src/codec.ts` — 252 lines

## `jobs/jobs-local` — 2 files, 1 batches

**Batch 342**

- [ ] `packages/jobs/jobs-local/tests/jobs.spec.ts` — 1490 lines
- [ ] `packages/jobs/jobs-local/src/index.ts` — 687 lines

## `skill/skill-filesystem` — 3 files, 1 batches

**Batch 343**

- [ ] `packages/skill/skill-filesystem/src/index.ts` — 1049 lines
- [ ] `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` — 922 lines
- [ ] `packages/skill/skill-filesystem/tests/skill-filesystem-watcher.spec.ts` — 452 lines

## `skill/skill` — 2 files, 1 batches

**Batch 344**

- [ ] `packages/skill/skill/tests/skill.spec.ts` — 1272 lines
- [ ] `packages/skill/skill/src/index.ts` — 868 lines

## `shell/tool-pwsh` — 3 files, 1 batches

**Batch 345**

- [ ] `packages/shell/tool-pwsh/tests/tools.spec.ts` — 1193 lines
- [ ] `packages/shell/tool-pwsh/src/index.ts` — 628 lines
- [ ] `packages/shell/tool-pwsh/tests/background.spec.ts` — 566 lines

## `client/ui-commands` — 6 files, 2 batches

**Batch 346**

- [ ] `packages/client/ui-commands/tests/service.client.spec.ts` — 1173 lines
- [ ] `packages/client/ui-commands/src/client/service.ts` — 491 lines
- [ ] `packages/client/ui-commands/tests/popup.client.spec.ts` — 422 lines

**Batch 347**

- [ ] `packages/client/ui-commands/tests/directory.client.spec.ts` — 340 lines
- [ ] `packages/client/ui-commands/src/client/popup.ts` — 313 lines
- [ ] `packages/client/ui-commands/tests/popup-view.client.spec.tsx` — 307 lines

## `client/ui-input-trigger` — 3 files, 1 batches

**Batch 348**

- [ ] `packages/client/ui-input-trigger/tests/service.client.spec.ts` — 1272 lines
- [ ] `packages/client/ui-input-trigger/src/client/controller.ts` — 643 lines
- [ ] `packages/client/ui-input-trigger/tests/menu-view.client.spec.tsx` — 376 lines

## `fs/tool-fs-search` — 4 files, 2 batches

**Batch 349**

- [ ] `packages/fs/tool-fs-search/tests/tools.spec.ts` — 1275 lines
- [ ] `packages/fs/tool-fs-search/src/search-core.ts` — 412 lines
- [ ] `packages/fs/tool-fs-search/src/glob.ts` — 375 lines

**Batch 350**

- [ ] `packages/fs/tool-fs-search/src/grep.ts` — 367 lines

## `host/open-in-app` — 6 files, 2 batches

**Batch 351**

- [ ] `packages/host/open-in-app/src/resolver.ts` — 760 lines
- [ ] `packages/host/open-in-app/tests/resolver.spec.ts` — 686 lines
- [ ] `packages/host/open-in-app/tests/host-routes.spec.ts` — 492 lines

**Batch 352**

- [ ] `packages/host/open-in-app/src/catalog.ts` — 393 lines
- [ ] `packages/host/open-in-app/src/index.ts` — 311 lines
- [ ] `packages/host/open-in-app/tests/icons.spec.ts` — 284 lines

## `api/terminal-controller` — 5 files, 2 batches

**Batch 353**

- [ ] `packages/api/terminal-controller/tests/recovery.client.spec.ts` — 737 lines
- [ ] `packages/api/terminal-controller/tests/controller.spec.ts` — 622 lines
- [ ] `packages/api/terminal-controller/tests/model.client.spec.ts` — 570 lines

**Batch 354**

- [ ] `packages/api/terminal-controller/src/index.ts` — 379 lines
- [ ] `packages/api/terminal-controller/src/client/model.ts` — 339 lines

## `client/ui-tool` — 11 files, 4 batches

**Batch 355**

- [ ] `packages/client/ui-tool/tests/tool-row.client.spec.tsx` — 599 lines
- [ ] `packages/client/ui-tool/tests/terminal-card.client.spec.tsx` — 523 lines
- [ ] `packages/client/ui-tool/tests/image-card.client.spec.tsx` — 385 lines

**Batch 356**

- [ ] `packages/client/ui-tool/tests/search-card.client.spec.tsx` — 359 lines
- [ ] `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` — 358 lines
- [ ] `packages/client/ui-tool/tests/diff-card.client.spec.tsx` — 350 lines

**Batch 357**

- [ ] `packages/client/ui-tool/tests/toolview-slot.client.spec.tsx` — 337 lines
- [ ] `packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts` — 323 lines
- [ ] `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts` — 311 lines

**Batch 358**

- [ ] `packages/client/ui-tool/tests/read-card.client.spec.tsx` — 288 lines
- [ ] `packages/client/ui-tool/tests/chat-ptc-subcalls.client.spec.tsx` — 285 lines

## `client/ui-subagent` — 2 files, 1 batches

**Batch 359**

- [ ] `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx` — 1047 lines
- [ ] `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx` — 812 lines

## `client/ui-sidebar-documentpreview` — 10 files, 4 batches

**Batch 360**

- [ ] `packages/client/ui-sidebar-documentpreview/tests/text-preview.client.spec.tsx` — 644 lines
- [ ] `packages/client/ui-sidebar-documentpreview/tests/pdf-body.client.spec.tsx` — 455 lines
- [ ] `packages/client/ui-sidebar-documentpreview/tests/face.client.spec.ts` — 439 lines

**Batch 361**

- [ ] `packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx` — 400 lines
- [ ] `packages/client/ui-sidebar-documentpreview/tests/office-cache.client.spec.ts` — 395 lines
- [ ] `packages/client/ui-sidebar-documentpreview/tests/document-toolbar.client.spec.tsx` — 333 lines

**Batch 362**

- [ ] `packages/client/ui-sidebar-documentpreview/tests/renderer-loading.client.spec.tsx` — 316 lines
- [ ] `packages/client/ui-sidebar-documentpreview/tests/html-body.client.spec.tsx` — 294 lines
- [ ] `packages/client/ui-sidebar-documentpreview/tests/office-registration.client.spec.ts` — 280 lines

**Batch 363**

- [ ] `packages/client/ui-sidebar-documentpreview/src/client/store.ts` — 268 lines

## `llm/token-meter` — 7 files, 3 batches

**Batch 364**

- [ ] `packages/llm/token-meter/tests/token-meter.spec.ts` — 642 lines
- [ ] `packages/llm/token-meter/tests/token-usage-projection.spec.ts` — 550 lines
- [ ] `packages/llm/token-meter/tests/context-breakdown-projection.spec.ts` — 529 lines

**Batch 365**

- [ ] `packages/llm/token-meter/tests/turn-usage.spec.ts` — 418 lines
- [ ] `packages/llm/token-meter/src/index.ts` — 344 lines
- [ ] `packages/llm/token-meter/tests/route-pricing.spec.ts` — 298 lines

**Batch 366**

- [ ] `packages/llm/token-meter/src/turn-usage.ts` — 274 lines

## `context/session-reference` — 2 files, 1 batches

**Batch 367**

- [ ] `packages/context/session-reference/tests/session-reference.spec.ts` — 1327 lines
- [ ] `packages/context/session-reference/src/index.ts` — 472 lines

## `extensions/cordis-client-runner` — 8 files, 3 batches

**Batch 368**

- [ ] `packages/extensions/cordis-client-runner/tests/runner.client.spec.ts` — 557 lines
- [ ] `packages/extensions/cordis-client-runner/src/client/runtime.ts` — 512 lines
- [ ] `packages/extensions/cordis-client-runner/tests/orchestrator.client.spec.ts` — 459 lines

**Batch 369**

- [ ] `packages/extensions/cordis-client-runner/src/client/orchestrator.ts` — 458 lines
- [ ] `packages/extensions/cordis-client-runner/tests/plugin.client.spec.ts` — 437 lines
- [ ] `packages/extensions/cordis-client-runner/src/client/index.ts` — 309 lines

**Batch 370**

- [ ] `packages/extensions/cordis-client-runner/tests/guard.client.spec.ts` — 271 lines
- [ ] `packages/extensions/cordis-client-runner/src/client/providers.ts` — 263 lines

## `client/ui-agent-preset` — 5 files, 2 batches

**Batch 371**

- [ ] `packages/client/ui-agent-preset/tests/apply.client.spec.ts` — 1059 lines
- [ ] `packages/client/ui-agent-preset/tests/settings-store.client.spec.ts` — 518 lines
- [ ] `packages/client/ui-agent-preset/tests/components.client.spec.tsx` — 371 lines

**Batch 372**

- [ ] `packages/client/ui-agent-preset/tests/section.client.spec.tsx` — 261 lines
- [ ] `packages/client/ui-agent-preset/src/client/seat-store.ts` — 251 lines

## `bundle/headless` — 4 files, 2 batches

**Batch 373**

- [ ] `packages/bundle/headless/tests/headless.spec.ts` — 1052 lines
- [ ] `packages/bundle/headless/tests/json-stream.spec.ts` — 419 lines
- [ ] `packages/bundle/headless/src/index.ts` — 400 lines

**Batch 374**

- [ ] `packages/bundle/headless/src/json-stream.ts` — 332 lines

## `credentials/deepseek-account-platform` — 2 files, 1 batches

**Batch 375**

- [ ] `packages/credentials/deepseek-account-platform/tests/account.spec.ts` — 1201 lines
- [ ] `packages/credentials/deepseek-account-platform/src/index.ts` — 492 lines

## `plan/plan-mode` — 2 files, 1 batches

**Batch 376**

- [ ] `packages/plan/plan-mode/tests/plan-mode.spec.ts` — 1208 lines
- [ ] `packages/plan/plan-mode/src/index.ts` — 472 lines

## `api/workspace-files` — 7 files, 3 batches

**Batch 377**

- [ ] `packages/api/workspace-files/tests/changes.spec.ts` — 831 lines
- [ ] `packages/api/workspace-files/src/index.ts` — 456 lines
- [ ] `packages/api/workspace-files/tests/provider.client.spec.ts` — 437 lines

**Batch 378**

- [ ] `packages/api/workspace-files/tests/host-path.client.spec.ts` — 315 lines
- [ ] `packages/api/workspace-files/tests/change-feed.client.spec.ts` — 307 lines
- [ ] `packages/api/workspace-files/src/client/change-feed.ts` — 293 lines

**Batch 379**

- [ ] `packages/api/workspace-files/tests/read.spec.ts` — 274 lines

## `web/tool-web` — 3 files, 1 batches

**Batch 380**

- [ ] `packages/web/tool-web/tests/tool-web.spec.ts` — 989 lines
- [ ] `packages/web/tool-web/src/fetch.ts` — 517 lines
- [ ] `packages/web/tool-web/src/search.ts` — 377 lines

## `sdk/server` — 3 files, 1 batches

**Batch 381**

- [ ] `packages/sdk/server/tests/server.spec.ts` — 1202 lines
- [ ] `packages/sdk/server/tests/plugin-apply.spec.ts` — 378 lines
- [ ] `packages/sdk/server/src/server.ts` — 299 lines

## `goal/goal` — 4 files, 2 batches

**Batch 382**

- [ ] `packages/goal/goal/tests/goal.spec.ts` — 854 lines
- [ ] `packages/goal/goal/src/index.ts` — 653 lines
- [ ] `packages/goal/goal/src/fold.ts` — 349 lines

**Batch 383**

- [ ] `packages/goal/goal/tests/projection.spec.ts` — 262 lines

## `skill/tool-skill` — 2 files, 1 batches

**Batch 384**

- [ ] `packages/skill/tool-skill/tests/tool-skill.spec.ts` — 1157 lines
- [ ] `packages/skill/tool-skill/src/index.ts` — 461 lines

## `jobs/tool-jobs` — 2 files, 1 batches

**Batch 385**

- [ ] `packages/jobs/tool-jobs/tests/tool-jobs.spec.ts` — 1191 lines
- [ ] `packages/jobs/tool-jobs/src/index.ts` — 417 lines

## `session-query/session-log-export` — 2 files, 1 batches

**Batch 386**

- [ ] `packages/session-query/session-log-export/tests/archive.host.spec.ts` — 990 lines
- [ ] `packages/session-query/session-log-export/src/archive.ts` — 616 lines

## `ptc-runtime/ptc-runtime-node` — 7 files, 3 batches

**Batch 387**

- [ ] `packages/ptc-runtime/ptc-runtime-node/tests/bootstrap.spec.ts` — 517 lines
- [ ] `packages/ptc-runtime/ptc-runtime-node/tests/host-failures.spec.ts` — 517 lines
- [ ] `packages/ptc-runtime/ptc-runtime-node/src/bootstrap.ts` — 425 lines

**Batch 388**

- [ ] `packages/ptc-runtime/ptc-runtime-node/src/json-wire.ts` — 420 lines
- [ ] `packages/ptc-runtime/ptc-runtime-node/src/index.ts` — 357 lines
- [ ] `packages/ptc-runtime/ptc-runtime-node/tests/runtime.spec.ts` — 349 lines

**Batch 389**

- [ ] `packages/ptc-runtime/ptc-runtime-node/tests/json-wire.spec.ts` — 257 lines

## `goal/goal-round-driver` — 2 files, 1 batches

**Batch 390**

- [ ] `packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts` — 1125 lines
- [ ] `packages/goal/goal-round-driver/src/index.ts` — 456 lines

## `workflow/workflow-ptc` — 4 files, 2 batches

**Batch 391**

- [ ] `packages/workflow/workflow-ptc/tests/workflow-ptc.spec.ts` — 1032 lines
- [ ] `packages/workflow/workflow-ptc/src/runtime.ts` — 367 lines
- [ ] `packages/workflow/workflow-ptc/tests/guest.spec.ts` — 353 lines

**Batch 392**

- [ ] `packages/workflow/workflow-ptc/src/host.ts` — 306 lines

## `core/agent` — 5 files, 2 batches

**Batch 393**

- [ ] `packages/core/agent/src/index.ts` — 689 lines
- [ ] `packages/core/agent/tests/verify-export-jsdoc.spec.ts` — 561 lines
- [ ] `packages/core/agent/src/runtime-types.ts` — 395 lines

**Batch 394**

- [ ] `packages/core/agent/tests/agent.spec.ts` — 380 lines
- [ ] `packages/core/agent/tests/agent-initiator.spec.ts` — 265 lines

## `credentials/credentials-local` — 4 files, 2 batches

**Batch 395**

- [ ] `packages/credentials/credentials-local/src/index.ts` — 917 lines
- [ ] `packages/credentials/credentials-local/tests/local.spec.ts` — 465 lines
- [ ] `packages/credentials/credentials-local/tests/records.spec.ts` — 349 lines

**Batch 396**

- [ ] `packages/credentials/credentials-local/tests/watcher.spec.ts` — 271 lines

## `session/session-title` — 3 files, 1 batches

**Batch 397**

- [ ] `packages/session/session-title/src/index.ts` — 835 lines
- [ ] `packages/session/session-title/tests/service-contracts.spec.ts` — 459 lines
- [ ] `packages/session/session-title/tests/provider.spec.ts` — 451 lines

## `session/session-projection` — 2 files, 1 batches

**Batch 398**

- [ ] `packages/session/session-projection/tests/registry.spec.ts` — 777 lines
- [ ] `packages/session/session-projection/src/index.ts` — 714 lines

## `api/workspace-controller` — 5 files, 2 batches

**Batch 399**

- [ ] `packages/api/workspace-controller/tests/model.client.spec.ts` — 572 lines
- [ ] `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` — 502 lines
- [ ] `packages/api/workspace-controller/src/client/model.ts` — 471 lines

**Batch 400**

- [ ] `packages/api/workspace-controller/tests/transport.client.spec.ts` — 430 lines
- [ ] `packages/api/workspace-controller/src/commands.ts` — 252 lines

## `client/ui-deliverables` — 6 files, 2 batches

**Batch 401**

- [ ] `packages/client/ui-deliverables/tests/deliverables.client.spec.tsx` — 1006 lines
- [ ] `packages/client/ui-deliverables/tests/review-tab.client.spec.tsx` — 391 lines
- [ ] `packages/client/ui-deliverables/tests/engagement-documents.client.spec.ts` — 291 lines

**Batch 402**

- [ ] `packages/client/ui-deliverables/src/client/turn-deliverables.ts` — 283 lines
- [ ] `packages/client/ui-deliverables/src/client/FileDiff.tsx` — 254 lines
- [ ] `packages/client/ui-deliverables/tests/present-open.host.spec.ts` — 252 lines

## `llm/llm-retry` — 4 files, 2 batches

**Batch 403**

- [ ] `packages/llm/llm-retry/tests/retry.spec.ts` — 1045 lines
- [ ] `packages/llm/llm-retry/tests/invariant.spec.ts` — 360 lines
- [ ] `packages/llm/llm-retry/tests/transport-recovery.spec.ts` — 286 lines

**Batch 404**

- [ ] `packages/llm/llm-retry/src/index.ts` — 259 lines

## `client/ui-session` — 2 files, 1 batches

**Batch 405**

- [ ] `packages/client/ui-session/tests/ui-session.client.spec.ts` — 742 lines
- [ ] `packages/client/ui-session/src/client/index.ts` — 705 lines

## `client/ui-workflow-run` — 2 files, 1 batches

**Batch 406**

- [ ] `packages/client/ui-workflow-run/tests/workflow-run.client.spec.tsx` — 940 lines
- [ ] `packages/client/ui-workflow-run/src/client/WorkflowRunPanel.tsx` — 481 lines

## `lsp/lsp-stdio` — 7 files, 3 batches

**Batch 407**

- [ ] `packages/lsp/lsp-stdio/tests/lifecycle.spec.ts` — 620 lines
- [ ] `packages/lsp/lsp-stdio/tests/instance.spec.ts` — 424 lines
- [ ] `packages/lsp/lsp-stdio/src/index.ts` — 381 lines

**Batch 408**

- [ ] `packages/lsp/lsp-stdio/src/instance.ts` — 350 lines
- [ ] `packages/lsp/lsp-stdio/src/connection.ts` — 323 lines
- [ ] `packages/lsp/lsp-stdio/tests/provider.spec.ts` — 291 lines

**Batch 409**

- [ ] `packages/lsp/lsp-stdio/tests/connection.spec.ts` — 260 lines

## `session/session-projection-cache` — 3 files, 1 batches

**Batch 410**

- [ ] `packages/session/session-projection-cache/tests/cache.spec.ts` — 811 lines
- [ ] `packages/session/session-projection-cache/src/index.ts` — 471 lines
- [ ] `packages/session/session-projection-cache/tests/fixtures.spec.ts` — 357 lines

## `typert/registry` — 2 files, 1 batches

**Batch 411**

- [ ] `packages/typert/registry/src/service.ts` — 749 lines
- [ ] `packages/typert/registry/tests/typert.spec.ts` — 625 lines

## `sdk/client` — 4 files, 2 batches

**Batch 412**

- [ ] `packages/sdk/client/tests/sdk-client.spec.ts` — 737 lines
- [ ] `packages/sdk/client/src/client.ts` — 491 lines
- [ ] `packages/sdk/client/tests/fake-runtime.ts` — 323 lines

**Batch 413**

- [ ] `packages/sdk/client/src/api.ts` — 310 lines

## `subagent/subagent-dsh-sdk` — 2 files, 1 batches

**Batch 414**

- [ ] `packages/subagent/subagent-dsh-sdk/tests/subagent-dsh-sdk.spec.ts` — 979 lines
- [ ] `packages/subagent/subagent-dsh-sdk/src/run.ts` — 359 lines

## `core/system-prompt` — 2 files, 1 batches

**Batch 415**

- [ ] `packages/core/system-prompt/tests/system-prompt.spec.ts` — 695 lines
- [ ] `packages/core/system-prompt/src/index.ts` — 638 lines

## `hooks/hooks-claude-code` — 3 files, 1 batches

**Batch 416**

- [ ] `packages/hooks/hooks-claude-code/tests/coverage-cases.ts` — 770 lines
- [ ] `packages/hooks/hooks-claude-code/tests/bridge.spec.ts` — 445 lines
- [ ] `packages/hooks/hooks-claude-code/src/index.ts` — 366 lines

## `client/ui-slots` — 4 files, 2 batches

**Batch 417**

- [ ] `packages/client/ui-slots/src/slot-core.ts` — 720 lines
- [ ] `packages/client/ui-slots/tests/type-chain.client.spec.tsx` — 408 lines
- [ ] `packages/client/ui-slots/tests/core.client.spec.ts` — 404 lines

**Batch 418**

- [ ] `packages/client/ui-slots/src/renderer.ts` — 278 lines

## `subagent/subagent-in-process-driver` — 3 files, 1 batches

**Batch 419**

- [ ] `packages/subagent/subagent-in-process-driver/tests/structured.spec.ts` — 771 lines
- [ ] `packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts` — 422 lines
- [ ] `packages/subagent/subagent-in-process-driver/tests/inheritance.spec.ts` — 324 lines

## `shell/tool-pwsh-persistent` — 2 files, 1 batches

**Batch 420**

- [ ] `packages/shell/tool-pwsh-persistent/tests/tools.spec.ts` — 769 lines
- [ ] `packages/shell/tool-pwsh-persistent/src/index.ts` — 497 lines

## `subprocess/win32-process` — 5 files, 2 batches

**Batch 421**

- [ ] `packages/subprocess/win32-process/src/process.ts` — 641 lines
- [ ] `packages/subprocess/win32-process/tests/process-failure-paths.spec.ts` — 437 lines
- [ ] `packages/subprocess/win32-process/src/ffi.ts` — 383 lines

**Batch 422**

- [ ] `packages/subprocess/win32-process/tests/ordinary-process.spec.ts` — 287 lines
- [ ] `packages/subprocess/win32-process/tests/process.spec.ts` — 255 lines

## `typert/protocol` — 3 files, 1 batches

**Batch 423**

- [ ] `packages/typert/protocol/src/types.ts` — 702 lines
- [ ] `packages/typert/protocol/tests/protocol.spec.ts` — 451 lines
- [ ] `packages/typert/protocol/src/index.ts` — 348 lines

## `experimental/tool-agent-team` — 2 files, 1 batches

**Batch 424**

- [ ] `packages/experimental/tool-agent-team/tests/tool-team.spec.ts` — 785 lines
- [ ] `packages/experimental/tool-agent-team/src/index.ts` — 465 lines

## `website` — 5 files, 2 batches

**Batch 425**

- [ ] `website/docs.ts` — 575 lines
- [ ] `website/tests/page-markdown-actions.spec.ts` — 415 lines
- [ ] `website/.vitepress/config.ts` — 386 lines

**Batch 426**

- [ ] `website/tests/image-viewer.spec.ts` — 350 lines
- [ ] `website/tests/mermaid-viewer.spec.ts` — 274 lines

## `shell/pwsh-local` — 2 files, 1 batches

**Batch 427**

- [ ] `packages/shell/pwsh-local/tests/executor.spec.ts` — 799 lines
- [ ] `packages/shell/pwsh-local/src/index.ts` — 449 lines

## `client/ui-settings-plugin-inventory` — 2 files, 1 batches

**Batch 428**

- [ ] `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx` — 663 lines
- [ ] `packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx` — 580 lines

## `shell/tool-bash-persistent` — 2 files, 1 batches

**Batch 429**

- [ ] `packages/shell/tool-bash-persistent/tests/tools.spec.ts` — 751 lines
- [ ] `packages/shell/tool-bash-persistent/src/index.ts` — 483 lines

## `client/ui-model-selection` — 3 files, 1 batches

**Batch 430**

- [ ] `packages/client/ui-model-selection/src/client/ModelSelect.tsx` — 510 lines
- [ ] `packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts` — 507 lines
- [ ] `packages/client/ui-model-selection/tests/model-select.client.spec.tsx` — 466 lines

## `interaction/commands` — 2 files, 1 batches

**Batch 431**

- [ ] `packages/interaction/commands/tests/commands.spec.ts` — 676 lines
- [ ] `packages/interaction/commands/src/index.ts` — 533 lines

## `typert/loader` — 2 files, 1 batches

**Batch 432**

- [ ] `packages/typert/loader/tests/loader.spec.ts` — 731 lines
- [ ] `packages/typert/loader/src/index.ts` — 469 lines

## `workflow/tool-workflow` — 2 files, 1 batches

**Batch 433**

- [ ] `packages/workflow/tool-workflow/tests/tool-workflow.spec.ts` — 694 lines
- [ ] `packages/workflow/tool-workflow/src/index.ts` — 492 lines

## `client/ui-layout` — 3 files, 1 batches

**Batch 434**

- [ ] `packages/client/ui-layout/tests/app-frame.client.spec.tsx` — 681 lines
- [ ] `packages/client/ui-layout/src/client/AppFrame.tsx` — 456 lines
- [ ] `packages/client/ui-layout/tests/layout-store.client.spec.ts` — 292 lines

## `fs/tool-str-replace-editor` — 2 files, 1 batches

**Batch 435**

- [ ] `packages/fs/tool-str-replace-editor/tests/tools.spec.ts` — 646 lines
- [ ] `packages/fs/tool-str-replace-editor/src/index.ts` — 531 lines

## `sandbox/sandbox-local` — 3 files, 1 batches

**Batch 436**

- [ ] `packages/sandbox/sandbox-local/src/index.ts` — 577 lines
- [ ] `packages/sandbox/sandbox-local/tests/local.spec.ts` — 492 lines
- [ ] `packages/sandbox/sandbox-local/tests/acl-grants.spec.ts` — 352 lines

## `session/session-telemetry-otel` — 2 files, 1 batches

**Batch 437**

- [ ] `packages/session/session-telemetry-otel/tests/otel.spec.ts` — 844 lines
- [ ] `packages/session/session-telemetry-otel/src/index.ts` — 312 lines

## `session/session-format-v2-to-v3` — 3 files, 1 batches

**Batch 438**

- [ ] `packages/session/session-format-v2-to-v3/tests/canonical-envelopes.spec.ts` — 520 lines
- [ ] `packages/session/session-format-v2-to-v3/tests/migration.spec.ts` — 499 lines
- [ ] `packages/session/session-format-v2-to-v3/src/payload.ts` — 371 lines

## `test-support/llm-mock-server` — 2 files, 1 batches

**Batch 439**

- [ ] `packages/test-support/llm-mock-server/src/index.ts` — 749 lines
- [ ] `packages/test-support/llm-mock-server/tests/server.spec.ts` — 359 lines

## `client/ui-user-questions` — 4 files, 2 batches

**Batch 440**

- [ ] `packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx` — 490 lines
- [ ] `packages/client/ui-user-questions/src/client/QuestionComposer.tsx` — 440 lines
- [ ] `packages/client/ui-user-questions/tests/plan-review-panel.client.spec.tsx` — 359 lines

**Batch 441**

- [ ] `packages/client/ui-user-questions/tests/browser-plugin.client.spec.ts` — 300 lines

## `client/ui-jobs` — 2 files, 1 batches

**Batch 442**

- [ ] `packages/client/ui-jobs/src/client/JobListAction.tsx` — 568 lines
- [ ] `packages/client/ui-jobs/tests/job-list-action.client.spec.tsx` — 518 lines

## `terminal/terminal` — 2 files, 1 batches

**Batch 443**

- [ ] `packages/terminal/terminal/tests/service.spec.ts` — 604 lines
- [ ] `packages/terminal/terminal/src/index.ts` — 476 lines

## `session/session-telemetry` — 2 files, 1 batches

**Batch 444**

- [ ] `packages/session/session-telemetry/tests/telemetry.spec.ts` — 770 lines
- [ ] `packages/session/session-telemetry/src/coordinator.ts` — 303 lines

## `boot/hmr` — 3 files, 1 batches

**Batch 445**

- [ ] `packages/boot/hmr/src/index.ts` — 590 lines
- [ ] `packages/boot/hmr/tests/modules.spec.ts` — 365 lines
- [ ] `packages/boot/hmr/tests/watch-config.spec.ts` — 357 lines

## `ssh/ssh` — 6 files, 2 batches

**Batch 446**

- [ ] `packages/ssh/ssh/src/helper-processes.ts` — 456 lines
- [ ] `packages/ssh/ssh/tests/helper-processes.spec.ts` — 412 lines
- [ ] `packages/ssh/ssh/tests/startup-behavior.spec.ts` — 340 lines

**Batch 447**

- [ ] `packages/ssh/ssh/tests/live.e2e.ts` — 304 lines
- [ ] `packages/ssh/ssh/src/index.ts` — 294 lines
- [ ] `packages/ssh/ssh/src/helper.ts` — 253 lines

## `client/ui-theme` — 5 files, 2 batches

**Batch 448**

- [ ] `packages/client/ui-theme/tests/scrollbar-styles.client.spec.ts` — 521 lines
- [ ] `packages/client/ui-theme/src/client/index.ts` — 479 lines
- [ ] `packages/client/ui-theme/tests/theme.client.spec.ts` — 303 lines

**Batch 449**

- [ ] `packages/client/ui-theme/tests/elevation-styles.client.spec.ts` — 253 lines
- [ ] `packages/client/ui-theme/tests/apply.client.spec.ts` — 252 lines

## `client/ui-redteam-console` — 8 files, 3 batches

**Batch 450**

- [ ] `packages/client/ui-redteam-console/tests/fixtures.client.ts` — 455 lines
- [ ] `packages/client/ui-redteam-console/src/client/locales.ts` — 417 lines
- [ ] `packages/client/ui-redteam-console/src/client/api.ts` — 326 lines

**Batch 451**

- [ ] `packages/client/ui-redteam-console/src/client/face.ts` — 294 lines
- [ ] `packages/client/ui-redteam-console/src/client/library-model.ts` — 290 lines
- [ ] `packages/client/ui-redteam-console/src/client/FoundryPage.tsx` — 259 lines

**Batch 452**

- [ ] `packages/client/ui-redteam-console/src/client/FindingsSection.tsx` — 258 lines
- [ ] `packages/client/ui-redteam-console/src/client/panel-face.ts` — 251 lines

## `redteam/harness-plugin` — 2 files, 1 batches

**Batch 453**

- [ ] `packages/redteam/harness-plugin/src/index.ts` — 697 lines
- [ ] `packages/redteam/harness-plugin/test/section.test.ts` — 351 lines

## `experimental/webworker-packer` — 2 files, 1 batches

**Batch 454**

- [ ] `packages/experimental/webworker-packer/src/pack.ts` — 683 lines
- [ ] `packages/experimental/webworker-packer/tests/image-loadable.spec.ts` — 358 lines

## `attachment/attachment-local` — 6 files, 2 batches

**Batch 455**

- [ ] `packages/attachment/attachment-local/src/store.ts` — 458 lines
- [ ] `packages/attachment/attachment-local/tests/request-image.spec.ts` — 403 lines
- [ ] `packages/attachment/attachment-local/tests/normalization.spec.ts` — 311 lines

**Batch 456**

- [ ] `packages/attachment/attachment-local/tests/store.spec.ts` — 299 lines
- [ ] `packages/attachment/attachment-local/src/index.ts` — 291 lines
- [ ] `packages/attachment/attachment-local/tests/file-store.spec.ts` — 278 lines

## `client/ui-settings-subagent` — 3 files, 1 batches

**Batch 457**

- [ ] `packages/client/ui-settings-subagent/tests/controllers.client.spec.ts` — 626 lines
- [ ] `packages/client/ui-settings-subagent/src/client/subagent-model-selection-card-controller.ts` — 356 lines
- [ ] `packages/client/ui-settings-subagent/tests/card.client.spec.tsx` — 292 lines

## `client/locale` — 2 files, 1 batches

**Batch 458**

- [ ] `packages/client/locale/src/client/index.ts` — 623 lines
- [ ] `packages/client/locale/tests/locale.client.spec.ts` — 398 lines

## `spill/spill-local` — 2 files, 1 batches

**Batch 459**

- [ ] `packages/spill/spill-local/tests/spill-local.spec.ts` — 584 lines
- [ ] `packages/spill/spill-local/src/cleanup.ts` — 431 lines

## `goal/tool-goal` — 2 files, 1 batches

**Batch 460**

- [ ] `packages/goal/tool-goal/tests/tool-goal.spec.ts` — 663 lines
- [ ] `packages/goal/tool-goal/src/index.ts` — 351 lines

## `credentials/authorization` — 2 files, 1 batches

**Batch 461**

- [ ] `packages/credentials/authorization/tests/authorization.spec.ts` — 548 lines
- [ ] `packages/credentials/authorization/src/index.ts` — 457 lines

## `compaction/compaction` — 3 files, 1 batches

**Batch 462**

- [ ] `packages/compaction/compaction/tests/invariant.spec.ts` — 469 lines
- [ ] `packages/compaction/compaction/tests/tool-pairing.spec.ts` — 424 lines
- [ ] `packages/compaction/compaction/src/invariant.ts` — 361 lines

## `feedback/message-feedback` — 2 files, 1 batches

**Batch 463**

- [ ] `packages/feedback/message-feedback/tests/message-feedback.spec.ts` — 690 lines
- [ ] `packages/feedback/message-feedback/src/index.ts` — 313 lines

## `hooks/hooks-codex` — 3 files, 1 batches

**Batch 464**

- [ ] `packages/hooks/hooks-codex/tests/coverage-cases.ts` — 655 lines
- [ ] `packages/hooks/hooks-codex/src/index.ts` — 334 lines
- [ ] `packages/hooks/hooks-codex/tests/bridge.spec.ts` — 264 lines

## `client/tsdown.client.ts` — 1 files, 1 batches

**Batch 465**

- [ ] `packages/client/tsdown.client.ts` — 735 lines

## `client/ui-message-feedback` — 4 files, 2 batches

**Batch 466**

- [ ] `packages/client/ui-message-feedback/tests/controller.client.spec.ts` — 512 lines
- [ ] `packages/client/ui-message-feedback/tests/browser-plugin.client.spec.tsx` — 336 lines
- [ ] `packages/client/ui-message-feedback/tests/message-feedback-actions.client.spec.tsx` — 324 lines

**Batch 467**

- [ ] `packages/client/ui-message-feedback/src/client/controller.ts` — 311 lines

## `redteam/llm-local` — 3 files, 1 batches

**Batch 468**

- [ ] `packages/redteam/llm-local/src/adapter.ts` — 596 lines
- [ ] `packages/redteam/llm-local/src/state.ts` — 317 lines
- [ ] `packages/redteam/llm-local/test/adapter.test.ts` — 306 lines

## `session/session-persistence` — 3 files, 1 batches

**Batch 469**

- [ ] `packages/session/session-persistence/tests/contract.ts` — 614 lines
- [ ] `packages/session/session-persistence/tests/storage-contract.spec.ts` — 322 lines
- [ ] `packages/session/session-persistence/tests/live-write-contract.ts` — 282 lines

## `shell/bash-local` — 2 files, 1 batches

**Batch 470**

- [ ] `packages/shell/bash-local/tests/executor.spec.ts` — 563 lines
- [ ] `packages/shell/bash-local/src/index.ts` — 404 lines

## `deliverables/workspace-changes` — 3 files, 1 batches

**Batch 471**

- [ ] `packages/deliverables/workspace-changes/tests/plugin.spec.ts` — 531 lines
- [ ] `packages/deliverables/workspace-changes/src/recorder.ts` — 404 lines
- [ ] `packages/deliverables/workspace-changes/src/git.ts` — 279 lines

## `web/web-fetch-http` — 3 files, 1 batches

**Batch 472**

- [ ] `packages/web/web-fetch-http/tests/fetch-http.spec.ts` — 628 lines
- [ ] `packages/web/web-fetch-http/src/network.ts` — 301 lines
- [ ] `packages/web/web-fetch-http/src/provider.ts` — 271 lines

## `shell/bash-sandbox` — 2 files, 1 batches

**Batch 473**

- [ ] `packages/shell/bash-sandbox/tests/sandbox.spec.ts` — 664 lines
- [ ] `packages/shell/bash-sandbox/tests/partial-landlock.spec.ts` — 284 lines

## `client/ui-reference` — 2 files, 1 batches

**Batch 474**

- [ ] `packages/client/ui-reference/tests/browser-plugin.client.spec.ts` — 663 lines
- [ ] `packages/client/ui-reference/src/client/index.ts` — 278 lines

## `experimental/browser-use-runtime` — 2 files, 1 batches

**Batch 475**

- [ ] `packages/experimental/browser-use-runtime/tests/mcp.spec.ts` — 576 lines
- [ ] `packages/experimental/browser-use-runtime/tests/resources.spec.ts` — 357 lines

## `interaction/permission-presets` — 2 files, 1 batches

**Batch 476**

- [ ] `packages/interaction/permission-presets/src/index.ts` — 475 lines
- [ ] `packages/interaction/permission-presets/tests/permission-presets.spec.ts` — 456 lines

## `web/web-search-deepseek` — 2 files, 1 batches

**Batch 477**

- [ ] `packages/web/web-search-deepseek/tests/deepseek.spec.ts` — 556 lines
- [ ] `packages/web/web-search-deepseek/src/provider.ts` — 369 lines

## `experimental/client-ui-agent-team` — 2 files, 1 batches

**Batch 478**

- [ ] `packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx` — 565 lines
- [ ] `packages/experimental/client-ui-agent-team/src/client/TeamAction.tsx` — 358 lines

## `workflow/tool-ralph` — 3 files, 1 batches

**Batch 479**

- [ ] `packages/workflow/tool-ralph/src/index.ts` — 477 lines
- [ ] `packages/workflow/tool-ralph/tests/tool-ralph.spec.ts` — 408 lines
- [ ] `packages/workflow/tool-ralph/tests/integration.spec.ts` — 288 lines

## `terminal/tool-terminal` — 2 files, 1 batches

**Batch 480**

- [ ] `packages/terminal/tool-terminal/tests/tools.spec.ts` — 514 lines
- [ ] `packages/terminal/tool-terminal/src/index.ts` — 404 lines

## `api/job-controller` — 3 files, 1 batches

**Batch 481**

- [ ] `packages/api/job-controller/tests/model.client.spec.ts` — 578 lines
- [ ] `packages/api/job-controller/tests/observe.host.spec.ts` — 305 lines
- [ ] `packages/api/job-controller/src/client/service.ts` — 277 lines

## `client/ui-settings` — 2 files, 1 batches

**Batch 482**

- [ ] `packages/client/ui-settings/tests/config-form.client.spec.ts` — 564 lines
- [ ] `packages/client/ui-settings/src/client/config-form.ts` — 337 lines

## `session/session-format-v3-to-v4` — 3 files, 1 batches

**Batch 483**

- [ ] `packages/session/session-format-v3-to-v4/tests/tool-role.spec.ts` — 458 lines
- [ ] `packages/session/session-format-v3-to-v4/src/relationships.ts` — 385 lines
- [ ] `packages/session/session-format-v3-to-v4/tests/developer.spec.ts` — 302 lines

## `context/time-context` — 2 files, 1 batches

**Batch 484**

- [ ] `packages/context/time-context/tests/time-context.spec.ts` — 543 lines
- [ ] `packages/context/time-context/tests/invariant.spec.ts` — 349 lines

## `subagent/tool-subagent-control` — 2 files, 1 batches

**Batch 485**

- [ ] `packages/subagent/tool-subagent-control/tests/tool-subagent-control.spec.ts` — 529 lines
- [ ] `packages/subagent/tool-subagent-control/tests/list-agents.spec.ts` — 355 lines

## `spill/spill-policy` — 1 files, 1 batches

**Batch 486**

- [ ] `packages/spill/spill-policy/tests/spill-policy.spec.ts` — 622 lines

## `document/office-to-pdf` — 3 files, 1 batches

**Batch 487**

- [ ] `packages/document/office-to-pdf/tests/queue.spec.ts` — 562 lines
- [ ] `packages/document/office-to-pdf/src/index.ts` — 280 lines
- [ ] `packages/document/office-to-pdf/tests/provider.spec.ts` — 275 lines

## `util/http-proxy` — 3 files, 1 batches

**Batch 488**

- [ ] `packages/util/http-proxy/tests/install.spec.ts` — 458 lines
- [ ] `packages/util/http-proxy/src/policy.ts` — 343 lines
- [ ] `packages/util/http-proxy/src/install.ts` — 315 lines

## `client/file-upload` — 3 files, 1 batches

**Batch 489**

- [ ] `packages/client/file-upload/tests/file-upload.client.spec.ts` — 495 lines
- [ ] `packages/client/file-upload/src/client/runtime.ts` — 338 lines
- [ ] `packages/client/file-upload/src/index.ts` — 265 lines

## `interaction/user-approval` — 2 files, 1 batches

**Batch 490**

- [ ] `packages/interaction/user-approval/tests/approval.spec.ts` — 520 lines
- [ ] `packages/interaction/user-approval/src/index.ts` — 310 lines

## `session/session-log-deepseek` — 1 files, 1 batches

**Batch 491**

- [ ] `packages/session/session-log-deepseek/tests/upload.spec.ts` — 578 lines

## `redteam/llm-meta` — 2 files, 1 batches

**Batch 492**

- [ ] `packages/redteam/llm-meta/src/adapter.ts` — 555 lines
- [ ] `packages/redteam/llm-meta/test/adapter.test.ts` — 265 lines

## `util/output-retention` — 2 files, 1 batches

**Batch 493**

- [ ] `packages/util/output-retention/src/index.ts` — 443 lines
- [ ] `packages/util/output-retention/tests/output-retention.spec.ts` — 376 lines

## `experimental/speech-to-text-sensevoice` — 2 files, 1 batches

**Batch 494**

- [ ] `packages/experimental/speech-to-text-sensevoice/tests/worker.spec.ts` — 481 lines
- [ ] `packages/experimental/speech-to-text-sensevoice/src/recognizer.ts` — 327 lines

## `storage/storage-json` — 2 files, 1 batches

**Batch 495**

- [ ] `packages/storage/storage-json/tests/json-backend.spec.ts` — 495 lines
- [ ] `packages/storage/storage-json/src/per-record-unit.ts` — 312 lines

## `client/ui-skill` — 1 files, 1 batches

**Batch 496**

- [ ] `packages/client/ui-skill/tests/browser-plugin.client.spec.ts` — 544 lines

## `util/native-command` — 2 files, 1 batches

**Batch 497**

- [ ] `packages/util/native-command/tests/path-opener.spec.ts` — 476 lines
- [ ] `packages/util/native-command/src/path-opener.ts` — 316 lines

## `settings/settings` — 2 files, 1 batches

**Batch 498**

- [ ] `packages/settings/settings/src/index.ts` — 431 lines
- [ ] `packages/settings/settings/tests/configuration.spec.ts` — 356 lines

## `test-support/remote-mock` — 3 files, 1 batches

**Batch 499**

- [ ] `packages/test-support/remote-mock/src/remote-mock.ts` — 413 lines
- [ ] `packages/test-support/remote-mock/src/streams.ts` — 339 lines
- [ ] `packages/test-support/remote-mock/tests/proxy.client.spec.ts` — 272 lines

## `benchmarks` — 2 files, 1 batches

**Batch 500**

- [ ] `benchmarks/session-open/session-open.bench.ts` — 457 lines
- [ ] `benchmarks/session-open/session-open.worker.ts` — 315 lines

## `storage/storage-domain` — 2 files, 1 batches

**Batch 501**

- [ ] `packages/storage/storage-domain/tests/domain.spec.ts` — 410 lines
- [ ] `packages/storage/storage-domain/src/domain.ts` — 357 lines

## `subagent/subagent-spawn-in-process` — 1 files, 1 batches

**Batch 502**

- [ ] `packages/subagent/subagent-spawn-in-process/tests/subagent-spawn-in-process.spec.ts` — 508 lines

## `extensions/ui-cordis` — 1 files, 1 batches

**Batch 503**

- [ ] `packages/extensions/ui-cordis/src/client/CordisPanel.tsx` — 507 lines

## `bundle/web-app` — 2 files, 1 batches

**Batch 504**

- [ ] `packages/bundle/web-app/tests/web-app.spec.ts` — 453 lines
- [ ] `packages/bundle/web-app/src/index.ts` — 301 lines

## `preset/agent-preset-registry` — 3 files, 1 batches

**Batch 505**

- [ ] `packages/preset/agent-preset-registry/src/index.ts` — 373 lines
- [ ] `packages/preset/agent-preset-registry/tests/registry.spec.ts` — 358 lines
- [ ] `packages/preset/agent-preset-registry/src/mount.ts` — 272 lines

## `app-backup-2026-11-07-pre-livingsheen` — 3 files, 1 batches

**Batch 506**

- [ ] `app-backup-2026-11-07-pre-livingsheen/packages/client/ui-conversation/src/client/skeleton/HomeSections.tsx` — 359 lines
- [ ] `app-backup-2026-11-07-pre-livingsheen/packages/client/ui-layout/src/client/AppFrame.tsx` — 335 lines
- [ ] `app-backup-2026-11-07-pre-livingsheen/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` — 298 lines

## `host/webserver` — 2 files, 1 batches

**Batch 507**

- [ ] `packages/host/webserver/tests/webserver.spec.ts` — 377 lines
- [ ] `packages/host/webserver/src/index.ts` — 365 lines

## `client/ui-settings-general` — 1 files, 1 batches

**Batch 508**

- [ ] `packages/client/ui-settings-general/tests/settings-root.client.spec.tsx` — 490 lines

## `redteam/fleet-skills` — 4 files, 2 batches

**Batch 509**

- [ ] `packages/redteam/fleet-skills/src/tool-guard.ts` — 341 lines
- [ ] `packages/redteam/fleet-skills/test/tool-guard.test.ts` — 337 lines
- [ ] `packages/redteam/fleet-skills/test/gauntlet.test.ts` — 290 lines

**Batch 510**

- [ ] `packages/redteam/fleet-skills/test/assemble.test.ts` — 271 lines

## `session/session-format` — 4 files, 2 batches

**Batch 511**

- [ ] `packages/session/session-format/tests/catalog.spec.ts` — 368 lines
- [ ] `packages/session/session-format/tests/chain.spec.ts` — 302 lines
- [ ] `packages/session/session-format/src/catalog.ts` — 289 lines

**Batch 512**

- [ ] `packages/session/session-format/src/chain.ts` — 255 lines

## `context/file-reference-local` — 2 files, 1 batches

**Batch 513**

- [ ] `packages/context/file-reference-local/src/search.ts` — 387 lines
- [ ] `packages/context/file-reference-local/tests/search.spec.ts` — 326 lines

## `skill/tool-workspace-dependencies` — 2 files, 1 batches

**Batch 514**

- [ ] `packages/skill/tool-workspace-dependencies/tests/tool-workspace-dependencies.spec.ts` — 427 lines
- [ ] `packages/skill/tool-workspace-dependencies/src/index.ts` — 277 lines

## `client/ui-settings-account` — 1 files, 1 batches

**Batch 515**

- [ ] `packages/client/ui-settings-account/tests/account.client.spec.tsx` — 450 lines

## `context/tmux-context` — 2 files, 1 batches

**Batch 516**

- [ ] `packages/context/tmux-context/tests/tmux-context.spec.ts` — 425 lines
- [ ] `packages/context/tmux-context/src/index.ts` — 275 lines

## `client/ui-sidebar-files` — 3 files, 1 batches

**Batch 517**

- [ ] `packages/client/ui-sidebar-files/tests/files-body.client.spec.tsx` — 319 lines
- [ ] `packages/client/ui-sidebar-files/tests/face.client.spec.ts` — 315 lines
- [ ] `packages/client/ui-sidebar-files/tests/directory-node.client.spec.ts` — 304 lines

## `client/resources` — 1 files, 1 batches

**Batch 518**

- [ ] `packages/client/resources/tests/resources.client.spec.ts` — 437 lines

## `shell/pwsh-sandbox` — 1 files, 1 batches

**Batch 519**

- [ ] `packages/shell/pwsh-sandbox/tests/sandbox.spec.ts` — 433 lines

## `host/directory-picker-native` — 1 files, 1 batches

**Batch 520**

- [ ] `packages/host/directory-picker-native/tests/win32-dialog-bindings.spec.ts` — 431 lines

## `compaction/compaction-image-offload` — 1 files, 1 batches

**Batch 521**

- [ ] `packages/compaction/compaction-image-offload/tests/image-offload.spec.ts` — 430 lines

## `experimental/browser-use-stagehand-native` — 2 files, 1 batches

**Batch 522**

- [ ] `packages/experimental/browser-use-stagehand-native/tests/provider.spec.ts` — 421 lines
- [ ] `packages/experimental/browser-use-stagehand-native/tests/native.e2e.ts` — 255 lines

## `client/ui-sidebar-terminal` — 1 files, 1 batches

**Batch 523**

- [ ] `packages/client/ui-sidebar-terminal/tests/terminal-body.client.spec.tsx` — 418 lines

## `session/session-title-llm` — 2 files, 1 batches

**Batch 524**

- [ ] `packages/session/session-title-llm/tests/llm.spec.ts` — 365 lines
- [ ] `packages/session/session-title-llm/src/index.ts` — 303 lines

## `client/ui-permission-presets` — 3 files, 1 batches

**Batch 525**

- [ ] `packages/client/ui-permission-presets/tests/browser-plugin.client.spec.ts` — 340 lines
- [ ] `packages/client/ui-permission-presets/tests/catalog.client.spec.ts` — 309 lines
- [ ] `packages/client/ui-permission-presets/tests/settings-store.client.spec.ts` — 260 lines

## `guard/repeat-tool-reminder` — 1 files, 1 batches

**Batch 526**

- [ ] `packages/guard/repeat-tool-reminder/tests/repeat-tool-reminder.spec.ts` — 409 lines

## `client/ui-attachment` — 2 files, 1 batches

**Batch 527**

- [ ] `packages/client/ui-attachment/tests/message-image.client.spec.tsx` — 348 lines
- [ ] `packages/client/ui-attachment/tests/composer-attachments.client.spec.tsx` — 308 lines

## `client/ui-goal` — 1 files, 1 batches

**Batch 528**

- [ ] `packages/client/ui-goal/tests/browser-plugin.client.spec.tsx` — 392 lines

## `ssh/subprocess-ssh` — 2 files, 1 batches

**Batch 529**

- [ ] `packages/ssh/subprocess-ssh/src/index.ts` — 345 lines
- [ ] `packages/ssh/subprocess-ssh/tests/process-behavior.spec.ts` — 295 lines

## `vitest.config.ts` — 1 files, 1 batches

**Batch 530**

- [ ] `vitest.config.ts` — 386 lines

## `client/ui-approval` — 1 files, 1 batches

**Batch 531**

- [ ] `packages/client/ui-approval/tests/ui-approval.client.spec.tsx` — 385 lines

## `boot/cmdline` — 1 files, 1 batches

**Batch 532**

- [ ] `packages/boot/cmdline/tests/cmdline.spec.ts` — 371 lines

## `session/session-stats` — 1 files, 1 batches

**Batch 533**

- [ ] `packages/session/session-stats/tests/projection.spec.ts` — 362 lines

## `mcp/mcp-resources` — 1 files, 1 batches

**Batch 534**

- [ ] `packages/mcp/mcp-resources/tests/resources.spec.ts` — 361 lines

## `interaction/user-questions` — 1 files, 1 batches

**Batch 535**

- [ ] `packages/interaction/user-questions/tests/user-questions.spec.ts` — 354 lines

## `webhook/webhook` — 2 files, 1 batches

**Batch 536**

- [ ] `packages/webhook/webhook/tests/session.spec.ts` — 321 lines
- [ ] `packages/webhook/webhook/tests/runtime.spec.ts` — 282 lines

## `client/ui-plan` — 2 files, 1 batches

**Batch 537**

- [ ] `packages/client/ui-plan/tests/plan-preview.client.spec.tsx` — 346 lines
- [ ] `packages/client/ui-plan/tests/browser-plugin.client.spec.ts` — 251 lines

## `goal/command-goal` — 1 files, 1 batches

**Batch 538**

- [ ] `packages/goal/command-goal/tests/command-goal.spec.ts` — 346 lines

## `client/hmr` — 1 files, 1 batches

**Batch 539**

- [ ] `packages/client/hmr/tests/node-half.client.spec.ts` — 339 lines

## `client/ui-schedule` — 1 files, 1 batches

**Batch 540**

- [ ] `packages/client/ui-schedule/tests/schedule-catalog-action.client.spec.tsx` — 336 lines

## `sdk/protocol` — 2 files, 1 batches

**Batch 541**

- [ ] `packages/sdk/protocol/tests/transport.spec.ts` — 307 lines
- [ ] `packages/sdk/protocol/src/transport.ts` — 279 lines

## `client/ui-sidebar` — 2 files, 1 batches

**Batch 542**

- [ ] `packages/client/ui-sidebar/src/client/SidebarRoot.tsx` — 302 lines
- [ ] `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` — 282 lines

## `interaction/tool-ask-user` — 1 files, 1 batches

**Batch 543**

- [ ] `packages/interaction/tool-ask-user/tests/tool-ask-user.spec.ts` — 331 lines

## `client/ui-sidebar-browser` — 4 files, 2 batches

**Batch 544**

- [ ] `packages/client/ui-sidebar-browser/tests/browser-body.client.spec.tsx` — 275 lines
- [ ] `packages/client/ui-sidebar-browser/src/client/electron/ElectronWebViewImpl.ts` — 271 lines
- [ ] `packages/client/ui-sidebar-browser/src/client/browser/BrowserController.ts` — 267 lines

**Batch 545**

- [ ] `packages/client/ui-sidebar-browser/tests/browser-controller.client.spec.ts` — 267 lines

## `host/directory-picker-browse` — 1 files, 1 batches

**Batch 546**

- [ ] `packages/host/directory-picker-browse/src/index.ts` — 324 lines

## `credentials/credentials` — 1 files, 1 batches

**Batch 547**

- [ ] `packages/credentials/credentials/src/index.ts` — 316 lines

## `runtime-diagnostics/invariants` — 1 files, 1 batches

**Batch 548**

- [ ] `packages/runtime-diagnostics/invariants/tests/service.spec.ts` — 310 lines

## `host/directory-picker-auto` — 1 files, 1 batches

**Batch 549**

- [ ] `packages/host/directory-picker-auto/tests/loader-composition.spec.ts` — 307 lines

## `core/scope` — 2 files, 1 batches

**Batch 550**

- [ ] `packages/core/scope/tests/store.spec.ts` — 289 lines
- [ ] `packages/core/scope/src/store.ts` — 267 lines

## `util/values` — 1 files, 1 batches

**Batch 551**

- [ ] `packages/util/values/src/index.ts` — 306 lines

## `session/session-format-catalog` — 1 files, 1 batches

**Batch 552**

- [ ] `packages/session/session-format-catalog/tests/catalog.spec.ts` — 305 lines

## `redteam/command-redteam` — 1 files, 1 batches

**Batch 553**

- [ ] `packages/redteam/command-redteam/test/commands.test.ts` — 304 lines

## `experimental/client-ui-voice-input` — 1 files, 1 batches

**Batch 554**

- [ ] `packages/experimental/client-ui-voice-input/tests/voice-input.client.spec.tsx` — 303 lines

## `todo/tool-todo` — 1 files, 1 batches

**Batch 555**

- [ ] `packages/todo/tool-todo/tests/tool-todo.spec.ts` — 303 lines

## `compaction/compaction-tool-result-pruner` — 1 files, 1 batches

**Batch 556**

- [ ] `packages/compaction/compaction-tool-result-pruner/tests/tool-result-pruner.spec.ts` — 299 lines

## `client/web` — 1 files, 1 batches

**Batch 557**

- [ ] `packages/client/web/tests/boot.client.spec.ts` — 297 lines

## `subprocess/subprocess` — 1 files, 1 batches

**Batch 558**

- [ ] `packages/subprocess/subprocess/src/types.ts` — 297 lines

## `fs/fs` — 1 files, 1 batches

**Batch 559**

- [ ] `packages/fs/fs/src/index.ts` — 296 lines

## `client/store` — 1 files, 1 batches

**Batch 560**

- [ ] `packages/client/store/tests/store.client.spec.ts` — 295 lines

## `client/ui-directory-picker-native` — 1 files, 1 batches

**Batch 561**

- [ ] `packages/client/ui-directory-picker-native/tests/client-flow.client.spec.tsx` — 295 lines

## `util/timeout` — 1 files, 1 batches

**Batch 562**

- [ ] `packages/util/timeout/tests/timeout.spec.ts` — 291 lines

## `storage/storage-sqlite` — 1 files, 1 batches

**Batch 563**

- [ ] `packages/storage/storage-sqlite/tests/sqlite-backend.spec.ts` — 290 lines

## `client/ui-open-in-app` — 1 files, 1 batches

**Batch 564**

- [ ] `packages/client/ui-open-in-app/tests/open-path-action.client.spec.tsx` — 289 lines

## `extensions/tool-cordis` — 1 files, 1 batches

**Batch 565**

- [ ] `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` — 287 lines

## `compaction/command-compact` — 1 files, 1 batches

**Batch 566**

- [ ] `packages/compaction/command-compact/tests/command-compact.spec.ts` — 281 lines

## `redteam/foundry-gate` — 1 files, 1 batches

**Batch 567**

- [ ] `packages/redteam/foundry-gate/src/panel.ts` — 278 lines

## `session/session-turn-outline` — 1 files, 1 batches

**Batch 568**

- [ ] `packages/session/session-turn-outline/tests/projection.spec.ts` — 277 lines

## `api/remotes` — 2 files, 1 batches

**Batch 569**

- [ ] `packages/api/remotes/tests/built-lib.e2e.ts` — 266 lines
- [ ] `packages/api/remotes/tests/remote-events.host.spec.ts` — 259 lines

## `api/settings-controller` — 1 files, 1 batches

**Batch 570**

- [ ] `packages/api/settings-controller/src/index.ts` — 270 lines

## `attachment/attachment` — 1 files, 1 batches

**Batch 571**

- [ ] `packages/attachment/attachment/src/index.ts` — 265 lines

## `subagent/subagent-fork-in-process` — 1 files, 1 batches

**Batch 572**

- [ ] `packages/subagent/subagent-fork-in-process/tests/subagent-fork-in-process.spec.ts` — 261 lines

## `web/web-search-exa` — 1 files, 1 batches

**Batch 573**

- [ ] `packages/web/web-search-exa/tests/exa.spec.ts` — 261 lines

## `feedback/command-feedback` — 1 files, 1 batches

**Batch 574**

- [ ] `packages/feedback/command-feedback/tests/command-feedback.spec.ts` — 260 lines

## `session/session-checkpoint-policy` — 1 files, 1 batches

**Batch 575**

- [ ] `packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts` — 260 lines

## `test-support/loader-smoke` — 1 files, 1 batches

**Batch 576**

- [ ] `packages/test-support/loader-smoke/src/index.ts` — 259 lines

## `webhook/webhook-github` — 1 files, 1 batches

**Batch 577**

- [ ] `packages/webhook/webhook-github/tests/handler.spec.ts` — 258 lines

## `jobs/jobs` — 1 files, 1 batches

**Batch 578**

- [ ] `packages/jobs/jobs/src/types.ts` — 254 lines

## `sandbox/sandbox-policy` — 1 files, 1 batches

**Batch 579**

- [ ] `packages/sandbox/sandbox-policy/tests/policy.spec.ts` — 251 lines

## Progress

| batch | section | files | state |
|---:|---|---:|---|
| 1 | scripts | 3 | in flight (workflow-2) |