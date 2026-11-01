import { listProviders, roleModelPolicy, ROLE_ORDER } from '@secscan/redteam-llm-router';
import { json } from './http.js';
export function handleModels(res) {
    const policy = roleModelPolicy();
    const seats = ROLE_ORDER.map((role) => {
        const route = policy[role];
        return { role, provider: route.provider, model: route.model };
    });
    json(res, 200, {
        providers: listProviders(),
        activeProvider: seats[0]?.provider ?? null,
        seats,
    });
}
//# sourceMappingURL=models.js.map