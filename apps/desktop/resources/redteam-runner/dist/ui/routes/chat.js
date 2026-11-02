import { complete, LOCAL_BASE_URL_ENV, } from '@secscan/redteam-llm-router';
import { readLocalModelEntry } from '../local-model.js';
import { badRequest, json } from './http.js';
const CHAT_ROLES = new Set(['system', 'user', 'assistant']);
/**
 * Validate the request body into a dispatchable chat request.
 * @param body - the parsed JSON body.
 * @returns the request, or a string naming the first problem.
 */
function parseChatRequest(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return 'body must be a JSON object';
    const record = body;
    const provider = typeof record['provider'] === 'string' ? record['provider'].trim() : '';
    const model = typeof record['model'] === 'string' ? record['model'].trim() : '';
    if (provider === '')
        return 'provider is required';
    if (model === '')
        return 'model is required';
    const rawMessages = record['messages'];
    if (!Array.isArray(rawMessages) || rawMessages.length === 0)
        return 'messages must be a non-empty array';
    const messages = [];
    for (const item of rawMessages) {
        if (typeof item !== 'object' || item === null || Array.isArray(item))
            return 'each message must be an object';
        const message = item;
        const role = message['role'];
        const content = message['content'];
        if (typeof role !== 'string' || !CHAT_ROLES.has(role))
            return 'each message role must be system, user or assistant';
        if (typeof content !== 'string' || content === '')
            return 'each message content must be a non-empty string';
        messages.push({ role: role, content });
    }
    return { provider, model, messages };
}
export async function handleChat(res, body, deps = {}) {
    const parsed = parseChatRequest(body);
    if (typeof parsed === 'string') {
        badRequest(res, parsed);
        return;
    }
    const env = deps.env ?? process.env;
    const completeFn = deps.completeFn ?? complete;
    if (parsed.provider === 'local') {
        const entry = await readLocalModelEntry(env, deps.probe);
        if (entry === null) {
            json(res, 409, {
                error: 'the local model is not available: no local server is serving the active model',
            });
            return;
        }
        if (entry.model !== parsed.model) {
            json(res, 409, {
                error: `the local server is serving ${entry.model}, not the requested ${parsed.model}`,
            });
            return;
        }
        // The provider resolves its endpoint from the process environment at
        // call time; publish the endpoint this request just proved is serving.
        process.env[LOCAL_BASE_URL_ENV] = entry.baseUrl;
    }
    try {
        const result = await completeFn(parsed.provider, { model: parsed.model, messages: parsed.messages });
        json(res, 200, {
            text: result.text,
            provider: result.provider,
            model: result.model,
            usage: result.usage ?? null,
        });
    }
    catch (err) {
        json(res, 502, { error: err.message });
    }
}
//# sourceMappingURL=chat.js.map