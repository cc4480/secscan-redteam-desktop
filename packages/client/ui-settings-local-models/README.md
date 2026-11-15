---
description: "Local models settings section for the dsh web client: the local endpoint's status, the models it serves, and the model files stored on the host."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-local-models

English | [中文](README.zh.md)

## Summary

Use the **Local models** settings section to see what this host serves locally: whether the local endpoint is up and at which address, which models it serves with their load state, and which model files sit in the local models folder on disk. Being on disk does not mean being served, so the folder files are listed separately, labeled as such. A loaded model's runtime context allocation and its maximum context are labeled as the different facts they are.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open **Local models** in Settings. The section reads its status on mount through the Host's `localModels` Remote namespace and offers a Refresh control for a fresh read. When the endpoint is down, the section says so plainly and shows no serving controls; when the status read itself fails, the section shows its error line instead of a model list. A host whose local models folder does not exist or holds no files shows the folder's empty line. In both serving modes, each model also carries its lifecycle controls — Start or Stop by its load state, and Delete behind an inline confirm — and a settled action re-reads the status it changed; a failed action shows its failure in the row. On a host serving through Ollama, each served model also carries Download (with the pull's own progress while it runs). On a llama-mode host the model rows are the registry, the loaded row is the model the endpoint currently serves, and a Hugging Face download form — a repository input whose List action lists the repository's files with their sizes — downloads the file the operator picks into the local models folder with the pull job's own progress, after which the refreshed list shows it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section registers into `settings.section` with id `local-models` at order 12, through `ctx.slots.inject`, so it installs whenever the Settings shell's declaration arrives. The plugin's `apply` unwraps the Remote result once: the section is injected with plain promises — `loadStatus` for the status read and the lifecycle actions (`startModel`, `stopModel`, `deleteModel`, `startPull`, `pullStatus`, `listRepoFiles`) — each resolving to its payload and rejecting on a failed Remote call, and the component renders its pending, error, and ready states from those promises. The component accepts optional per-model action renderers as props — the seam per-model actions slot into — and the registration provides them: the registered wrapper component (`LocalModelsSectionWithActions`) renders the lifecycle controls for model rows in both modes (the per-row Download only in Ollama mode), renders the Hugging Face download form through the section's download seam in llama mode only, leaves folder rows without a control (in llama mode the model rows are the registry; in Ollama mode no honest action exists for an on-disk registry GGUF), and remounts the section after a settled action so it re-reads its status. The bare component renders no action control without the renderers. The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-models](../ui-settings-models/README.md) — the Models settings section beside this one.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section`.
- [ui-settings-plugins](../ui-settings-plugins/README.md) — the Built-in plugins section, whose registration this package follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface. The models it lists are served by the host's local endpoint, whose own package owns their model experience.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The picked file travels to the pull as one string** — the Remote pull (`startPull`) takes a single `modelId`, so when the operator picks a listed file the form sends the Hugging Face repository with that file appended after a `/`; the Host's llama-mode pull is responsible for reading that string as repository-plus-file. The operator never types the file name: the form's `listRepoFiles` action returns the repository's files and the pick names the file. On-disk folder rows carry no action of their own in either mode: in llama mode the model rows are the same registry entries and carry the controls; in Ollama mode no honest action exists for a registry GGUF.
- **Status is read on mount and on Refresh only** — the section does not subscribe to pushed changes, so a model loaded elsewhere appears after a refresh.
- **Runtime invariant:** No companion is published. The section owns no relationship beyond the Remote status read it renders.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
