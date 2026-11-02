# Build & install

## Building from source

Prerequisites: **Node.js `^22.19.0 || >=24.0.0`** and **pnpm** (the repository is a pnpm workspace). Windows is the primary desktop target; the harness and runner are cross-platform Node.

```sh
git clone https://github.com/cc4480/secscan-redteam-desktop.git
cd secscan-redteam-desktop
pnpm install
pnpm run build            # tsc + tsdown: libraries for host and client faces
pnpm run dev:desktop      # build, then launch the desktop app
```

`pnpm run start:desktop` launches the app from existing build outputs. The desktop package's own scripts (`apps/desktop`) expose the same lifecycle (`build`, `dev`, `start`, `prepare:package`, `package`).

## Packaging the Windows installer locally

```sh
pnpm run package:desktop:win:x64:unsigned
```

This runs the desktop packaging with the EV signing stages skipped (a signed build uses `package:desktop:win:x64` on an operator's machine with the signing token). Packaging identity comes from `apps/desktop/scripts/electron-builder-config.mjs`: product name **SecScan RedTeam**, application ID from `DSH_DESKTOP_APP_ID` (shipped `com.secscan.redteam`), and an NSIS installer artifact named `secscan-redteam-<version>-<os>-<arch>[-unsigned].exe`.

Before the installer is assembled, the packaging prepares the **vendored tool payload** (`apps/desktop/scripts/vendor-tools.mjs`): nmap, ffuf, gobuster, and the content-discovery wordlist are staged into the package so a clean install has its core engines without operator installs. Npcap is **not** bundled; without it, the bundled nmap runs connect scans rather than raw-socket scan types.

## The CI pipeline

Published installers are built by the `windows-installer` GitHub Actions workflow (`.github/workflows/windows-installer.yml`), which exists because the repository's other release workflows publish npm tarballs for the harness packages and produce no desktop installer:

- **Triggers.** A `v*` tag push (the installer is uploaded as a run artifact and attached to the tag's GitHub release, creating a prerelease when none exists), or a manual `workflow_dispatch` — pass the optional `release_tag` input to also attach the build to that release.
- **Runner.** The repository variable `WINDOWS_RUNNER_LABELS` selects the runner as a JSON label array (for example `["self-hosted", "windows", "x64"]` for a self-hosted machine); unset, the job runs on the hosted `windows-2022` image.
- **Signing.** The workflow is **unsigned by design**: it invokes the `package:desktop:win:x64:unsigned` entry point precisely so it needs no signing secret. Expect Windows to ask the user to confirm an unsigned installer; that prompt is the documented behavior, not a defect.
- **Concurrency.** Runs are grouped per ref with cancel-in-progress, so a superseded tag build never publishes over a newer one.

## First run

The installed app opens straight to chat. The supervisor starts the bundled runner console on loopback before the profile composes; a console that cannot start is a visible startup failure. The welcome flow seats the keys (Meta required; SecScan and Seclayer optional) into the credential store — see [MCP services](mcp-services.md#seating-keys) and [Configuration](configuration.md). Nothing about first run phones home: the only network calls are the ones the operator's own keys authorize, to the Meta Model API and the two services.
