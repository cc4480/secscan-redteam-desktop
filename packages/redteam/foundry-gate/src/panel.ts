import { bootApp, resolvePython, runProbe, stopProcess } from './runner.js'
import type { BundleSpec, LayerResult, PanelLayer, PanelResult } from './types.js'

/** Panel version, matching the Foundry reference panel. */
export const PANEL_VERSION = 'panel-v1'

/** Layers in evaluation order, weakest to strongest. */
export const LAYERS: PanelLayer[] = ['baseline-benign', 'payload-basic', 'payload-extended', 'bundle-probe']

/** Canary token the XSS layers watch for verbatim reflection of. */
export const CANARY = 'PNL9Z7CANARY'

type Attempt = [label: string, body: string]

/**
 * Percent-encode exactly as Python's urllib.parse.quote with safe="%":
 * alphanumerics and `_.-~` stay literal, `%` stays literal, all else is
 * encoded. encodeURIComponent encodes `%` itself, so its %25 sequences are
 * restored afterwards; deliberately pre-encoded payloads (e.g. `..%2f`)
 * reach the server as authored instead of being double-encoded.
 *
 * @param value - the payload to encode
 * @returns the encoded payload
 */
function pyQuote(value: string): string {
  return encodeURIComponent(value).replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
    .replace(/%25/g, '%')
}

/**
 * Encode one form value as Python's urllib.parse.urlencode does (quote_plus).
 *
 * @param value - the value to encode
 * @returns the encoded value, with spaces as `+`
 */
function quotePlus(value: string): string {
  return pyQuote(value).replace(/%20/g, '+')
}

/**
 * Build a query string for one attack attempt.
 *
 * @param param - the parameter name
 * @param payload - the payload, deliberately pre-encoded forms kept intact
 * @returns the `param=payload` query string
 */
function q(param: string, payload: string): string {
  return `${param}=${pyQuote(payload)}`
}

/**
 * GET a URL and return the response body; failures yield an empty string.
 *
 * @param url - the URL to fetch
 * @returns the decoded body, or "" on any failure
 */
async function httpGet(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'foundry-panel/1.0' },
      signal: AbortSignal.timeout(5000),
    })
    return await resp.text()
  } catch {
    return ''
  }
}

/**
 * Find the parameterized attack endpoint declared by a spec.
 *
 * @param spec - the bundle spec
 * @returns the [path, param] pair, or [null, null] when none is declared
 */
export function attackSurface(spec: BundleSpec): [string | null, string | null] {
  for (const ep of spec.endpoints) {
    const match = /^GET\s+(\S+?)\?(\w+)=/.exec(ep)
    if (match) return [match[1] as string, match[2] as string]
  }
  return [null, null]
}

/**
 * Find the parameterless internal path declared by a spec.
 *
 * @param spec - the bundle spec
 * @returns the internal path, defaulting to "/internal/report"
 */
export function internalPath(spec: BundleSpec): string {
  for (const ep of spec.endpoints) {
    const match = /^GET\s+(\/[^\s?=]+)$/.exec(ep)
    if (match) return match[1] as string
  }
  return '/internal/report'
}

/**
 * Ordinary-use attempts for the baseline layer.
 *
 * @param base - the booted variant's base URL
 * @param spec - the bundle spec
 * @returns the labeled response bodies
 */
async function attemptsBenign(base: string, spec: BundleSpec): Promise<Attempt[]> {
  const [path, param] = attackSurface(spec)
  const out: Attempt[] = [['home', await httpGet(`${base}/`)]]
  if (path && param) {
    if (spec.vuln_class === 'ssrf') {
      out.push(['preview-own-home', await httpGet(`${base}${path}?${param}=${quotePlus(`${base}/`)}`)])
    } else if (spec.vuln_class === 'path-traversal') {
      out.push(['listed-file', await httpGet(`${base}${path}?${param}=${quotePlus('welcome.txt')}`)])
    } else {
      out.push(['benign-search', await httpGet(`${base}${path}?${param}=${quotePlus('coffee')}`)])
    }
  }
  return out
}

/**
 * Canonical-payload attempts for the basic layer.
 *
 * @param base - the booted variant's base URL
 * @param spec - the bundle spec
 * @returns the labeled response bodies
 */
async function attemptsBasic(base: string, spec: BundleSpec): Promise<Attempt[]> {
  const [path, param] = attackSurface(spec)
  if (!path || !param) return []
  const port = new URL(base).port
  const payloads: Record<string, string[]> = {
    'sql-injection': ["' OR '1'='1') -- ", "' OR '1'='1' -- "],
    'cross-site-scripting': [`<script>${CANARY}</script>`],
    'path-traversal': ['../secret.txt', '../secret', '../../etc/passwd'],
    'ssrf': [`http://127.0.0.1:${port}${internalPath(spec)}`],
  }
  const list = payloads[spec.vuln_class] ?? []
  const out: Attempt[] = []
  for (const payload of list) out.push([payload, await httpGet(`${base}${path}?${q(param, payload)}`)])
  return out
}

/**
 * Variant-payload attempts for the extended layer.
 *
 * @param base - the booted variant's base URL
 * @param spec - the bundle spec
 * @returns the labeled response bodies
 */
async function attemptsExtended(base: string, spec: BundleSpec): Promise<Attempt[]> {
  const [path, param] = attackSurface(spec)
  if (!path || !param) return []
  const port = new URL(base).port
  const target = internalPath(spec)
  const payloads: Record<string, string[]> = {
    'sql-injection': ["' OR 1=1) -- ", "' OR 1=1 -- ", "' OR 'x'='x') -- ", "' OR '1'='1')--"],
    'cross-site-scripting': [
      `<svg onload=${CANARY}>`,
      `<img src=x onerror=${CANARY}>`,
      `"><script>${CANARY}</script>`,
      `<body onload=${CANARY}>`,
    ],
    'path-traversal': ['..%2fsecret.txt', '....//secret.txt', '%2e%2e%2fsecret.txt', '..;/secret.txt'],
    'ssrf': [
      `http://localhost:${port}${target}`,
      `http://2130706433:${port}${target}`,
      `http://0x7f.0.0.1:${port}${target}`,
      `http://127.1:${port}${target}`,
    ],
  }
  const list = payloads[spec.vuln_class] ?? []
  const out: Attempt[] = []
  for (const payload of list) out.push([payload, await httpGet(`${base}${path}?${q(param, payload)}`)])
  return out
}

/**
 * Score a layer's attempts: did it observe the flaw's evidence? For XSS the
 * evidence is a markup payload reflected verbatim; for other classes it is
 * the bundle marker appearing in a response body.
 *
 * @param spec - the bundle spec
 * @param attempts - the labeled response bodies
 * @returns whether evidence was observed, and the label that produced it
 */
export function detected(spec: BundleSpec, attempts: Attempt[]): { hit: boolean; label: string | null } {
  for (const [label, body] of attempts) {
    if (spec.vuln_class === 'cross-site-scripting') {
      if (label.startsWith('<') && body.includes(label)) return { hit: true, label }
    } else if (spec.marker && body.includes(spec.marker)) {
      return { hit: true, label }
    }
  }
  return { hit: false, label: null }
}

/**
 * Map a panel pass rate to its observed difficulty tier.
 *
 * @param rate - the fraction of layers that passed, 0 to 1
 * @returns tier 1, 2, or 3, or null when the rate is outside every band
 */
export function tierFor(rate: number): number | null {
  if (rate >= 0.70 && rate <= 0.95) return 1
  if (rate >= 0.40 && rate < 0.70) return 2
  if (rate >= 0.10 && rate < 0.40) return 3
  return null
}

/**
 * Run one layer against one booted variant.
 *
 * @param dir - the bundle directory
 * @param spec - the bundle spec
 * @param layer - the layer to run
 * @param base - the variant's base URL
 * @param port - the variant's port
 * @param python - the Python interpreter command
 * @returns whether the layer observed the flaw's evidence, and the evidence text
 */
async function runLayer(
  dir: string,
  spec: BundleSpec,
  layer: PanelLayer,
  base: string,
  port: number,
  python: string,
): Promise<{ hit: boolean; evidence: string }> {
  if (layer === 'bundle-probe') {
    const rc = await runProbe(python, dir, port)
    return { hit: rc === 0, evidence: `probe exit ${rc}` }
  }
  const attempts = layer === 'baseline-benign'
    ? await attemptsBenign(base, spec)
    : layer === 'payload-basic'
      ? await attemptsBasic(base, spec)
      : await attemptsExtended(base, spec)
  const { hit, label } = detected(spec, attempts)
  return { hit, evidence: hit ? `hit via ${JSON.stringify(label)}` : 'no evidence observed' }
}

/**
 * Run the full reference panel against one bundle: both variants are booted,
 * every layer attacks each, and a layer passes only when it observes the
 * evidence on the vulnerable variant and not on the patched twin. All child
 * processes are stopped before this settles.
 *
 * @param dir - the bundle directory
 * @param spec - the bundle spec
 * @param python - the Python interpreter command; resolved when omitted
 * @returns the per-layer results, pass vector, pass rate, and observed tier
 */
export async function panelRun(dir: string, spec: BundleSpec, python?: string): Promise<PanelResult> {
  const interpreter = resolvePython(python)
  const vuln = await bootApp(interpreter, dir, 'vuln')
  let patched: Awaited<ReturnType<typeof bootApp>> | null = null
  try {
    patched = await bootApp(interpreter, dir, 'patched')
    const layers = {} as Record<PanelLayer, LayerResult>
    for (const layer of LAYERS) {
      const v = await runLayer(dir, spec, layer, vuln.base, vuln.port, interpreter)
      const p = await runLayer(dir, spec, layer, patched.base, patched.port, interpreter)
      layers[layer] = {
        detected_vuln: v.hit,
        detected_patched: p.hit,
        passed: v.hit && !p.hit,
        evidence_vuln: v.evidence,
        evidence_patched: p.evidence,
      }
    }
    const vector: number[] = LAYERS.map(layer => (layers[layer].passed ? 1 : 0))
    const passRate = vector.reduce((a, b) => a + b, 0) / LAYERS.length
    return { slug: spec.slug, layers, vector, pass_rate: passRate, observed_tier: tierFor(passRate) }
  } finally {
    await stopProcess(vuln.proc)
    if (patched) await stopProcess(patched.proc)
  }
}
