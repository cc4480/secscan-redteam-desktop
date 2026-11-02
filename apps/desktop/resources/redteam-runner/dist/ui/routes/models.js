import { listProviders, roleModelPolicy, ROLE_ORDER } from '@secscan/redteam-llm-router';
import { readLocalModelEntry } from '../local-model.js';
import { json } from './http.js';
export async function handleModels(res, deps = {}) {
    const env = deps.env ?? process.env;
    const policy = roleModelPolicy(env);
    const seats = ROLE_ORDER.map((role) => {
        const route = policy[role];
        return { role, provider: route.provider, model: route.model };
    });
    const localModel = await readLocalModelEntry(env, deps.probe);
    json(res, 200, {
        providers: listProviders(),
        activeProvider: seats[0]?.provider ?? null,
        seats,
        localModel,
    });
}
//# sourceMappingURL=models.js.map