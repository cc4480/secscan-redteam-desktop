/**
 * POST /api/chat — one direct chat completion through the router, for the
 * model the operator picked in the chat view. This is the operator's own
 * conversation surface: it is NOT an engagement launch and it never touches
 * the fleet seats (roleModelPolicy is not consulted here).
 *
 * Body: { provider, model, messages: [{ role, content }] }.
 *
 * The local provider is gated on the LIVE local catalog (../local-model.ts):
 * the request is answered only while the desktop's llama-server provably
 * serves exactly the requested model, and the freshly probed endpoint is
 * published through REDTEAM_LOCAL_BASE_URL — the local provider's documented
 * configuration channel, read at call time — before dispatch. A stopped or
 * replaced local server therefore gets a 409 with the reason, never a
 * completion attempt against a dead endpoint. Other providers dispatch
 * through the router as-is; an unknown provider or a missing key surfaces
 * the router's own honest error as a 502.
 */
import type { ServerResponse } from 'node:http'
import {
  complete,
  LOCAL_BASE_URL_ENV,
  type ChatMessage,
} from '@secscan/redteam-llm-router'
import { readLocalModelEntry, type LocalModelEntry, type LocalModelProbe } from '../local-model.js'
import { badRequest, json } from './http.js'

/** Seams for tests: environment, endpoint probe, and the completion call. */
export interface ChatRouteDeps {
  readonly env?: NodeJS.ProcessEnv
  readonly probe?: LocalModelProbe
  readonly completeFn?: typeof complete
}

const CHAT_ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant'])

/**
 * Validate the request body into a dispatchable chat request.
 * @param body - the parsed JSON body.
 * @returns the request, or a string naming the first problem.
 */
function parseChatRequest(body: unknown): { provider: string; model: string; messages: ChatMessage[] } | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'body must be a JSON object'
  const record = body as Record<string, unknown>
  const provider = typeof record['provider'] === 'string' ? record['provider'].trim() : ''
  const model = typeof record['model'] === 'string' ? record['model'].trim() : ''
  if (provider === '') return 'provider is required'
  if (model === '') return 'model is required'
  const rawMessages = record['messages']
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return 'messages must be a non-empty array'
  const messages: ChatMessage[] = []
  for (const item of rawMessages as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return 'each message must be an object'
    const message = item as Record<string, unknown>
    const role = message['role']
    const content = message['content']
    if (typeof role !== 'string' || !CHAT_ROLES.has(role)) return 'each message role must be system, user or assistant'
    if (typeof content !== 'string' || content === '') return 'each message content must be a non-empty string'
    messages.push({ role: role as ChatMessage['role'], content })
  }
  return { provider, model, messages }
}

export async function handleChat(res: ServerResponse, body: unknown, deps: ChatRouteDeps = {}): Promise<void> {
  const parsed = parseChatRequest(body)
  if (typeof parsed === 'string') {
    badRequest(res, parsed)
    return
  }
  const env = deps.env ?? process.env
  const completeFn = deps.completeFn ?? complete

  if (parsed.provider === 'local') {
    const entry: LocalModelEntry | null = await readLocalModelEntry(env, deps.probe)
    if (entry === null) {
      json(res, 409, {
        error: 'the local model is not available: no local server is serving the active model',
      })
      return
    }
    if (entry.model !== parsed.model) {
      json(res, 409, {
        error: `the local server is serving ${entry.model}, not the requested ${parsed.model}`,
      })
      return
    }
    // The provider resolves its endpoint from the process environment at
    // call time; publish the endpoint this request just proved is serving.
    process.env[LOCAL_BASE_URL_ENV] = entry.baseUrl
  }

  try {
    const result = await completeFn(parsed.provider, { model: parsed.model, messages: parsed.messages })
    json(res, 200, {
      text: result.text,
      provider: result.provider,
      model: result.model,
      usage: result.usage ?? null,
    })
  } catch (err) {
    json(res, 502, { error: (err as Error).message })
  }
}
