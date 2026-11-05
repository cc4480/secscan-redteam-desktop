import { DEVICE_ORDER, DEVICE_TEMPLATES, TOOL_CATALOGUE } from './catalog.js';
import { DEVICE_RULES } from './roe.js';
/** The purpose line for one tool, or an empty string when the catalogue lacks it. */
function purposeOf(tool) {
    return TOOL_CATALOGUE.find((entry) => entry.name === tool)?.purpose ?? '';
}
/**
 * Which device classes this engagement covers.
 *
 * A local-host engagement is whatever machine it runs on; a full-battery run covers
 * every selected battery; a plain web engagement is the webapp class.
 *
 * @param ctx - The prompt context.
 * @returns The device classes, in a stable order.
 */
export function resolveDeviceClasses(ctx) {
    if (ctx.localSandbox === true) {
        return [process.platform === 'win32' ? 'windows' : 'linux'];
    }
    const selected = (ctx.targets ?? []).filter((target) => DEVICE_ORDER.includes(target));
    const unique = [...new Set(selected)];
    if (unique.length > 0)
        return DEVICE_ORDER.filter((device) => unique.includes(device));
    return ['webapp'];
}
/**
 * Render the device brief for an engagement.
 *
 * @param ctx - The prompt context.
 * @returns Markdown, or an empty string when nothing could be resolved.
 */
export function deviceBriefText(ctx) {
    const devices = resolveDeviceClasses(ctx);
    if (devices.length === 0)
        return '';
    const sections = devices.map((device) => renderOneDevice(device));
    const heading = devices.length === 1
        ? `## Systems in scope — ${devices[0]}`
        : `## Systems in scope (${devices.length} device classes — cover each)`;
    return [heading, ...sections].join('\n\n');
}
/** One device's tool set, evidence bar, prerequisites and rules. */
function renderOneDevice(device) {
    const template = DEVICE_TEMPLATES[device];
    const rules = DEVICE_RULES[device];
    if (!template || !rules)
        return '';
    const toolLines = template.tools.map((tool) => {
        const purpose = purposeOf(tool);
        return purpose.length > 0 ? `- \`${tool}\` — ${purpose}` : `- \`${tool}\``;
    });
    return [
        `### ${template.label} (\`${device}\`)`,
        template.summary,
        `Phases: ${template.phases.join(' → ')}.`,
        'Tools for this system — use them, do not substitute a guess:',
        ...toolLines,
        'Evidence that counts here:',
        ...template.evidence.map((line) => `- ${line}`),
        ...(template.prerequisites.length > 0
            ? ['Needs an operator-provided prerequisite:', ...template.prerequisites.map((line) => `- ${line}`)]
            : []),
        'Rules of engagement for this system:',
        ...rules.aggression.map((line) => `- ${line}`),
        ...rules.limits.map((line) => `- Limit: ${line}`),
    ].join('\n');
}
//# sourceMappingURL=brief.js.map