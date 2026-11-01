/**
 * Operator knobs (Prompt Pack §4). Standing values live in CHARTER.md
 * (fleet-wide) and ENGAGEMENT.md (per engagement); the deeper file wins.
 * Knobs customize behavior — they never expand scope. Only a new verified
 * engagement record can do that.
 */

export const KNOWN_KNOBS: Record<string, string> = {
  AGGRESSION: 'full',
  DEPTH: 'catalog+invent',
  STEALTH: 'normal',
  SPEED: 'thorough',
  SESSIONS: 'on',
  REPORT: 'full',
  SEAT_MODELS: '',
  RISK_LINE: '',
};

export interface ResolvedKnobs {
  values: Record<string, string>;
  warnings: string[];
}

function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}

/**
 * Parse knob assignments from charter/engagement file text.
 * Lines are `KEY = value` or `KEY: value`. Blank lines and lines whose
 * first non-space character is `#` are ignored, as are lines with no
 * separator or an empty key.
 *
 * @param text - charter or engagement file text.
 * @returns the parsed knob assignments, keys uppercased.
 */
export function parseKnobs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    const sep =
      eq === -1 ? colon : colon === -1 ? eq : Math.min(eq, colon);
    if (sep <= 0) continue;
    const key = normalizeKey(line.slice(0, sep));
    if (key === '') continue;
    out[key] = line.slice(sep + 1).trim();
  }
  return out;
}

/**
 * Resolve knob values: defaults < charter < engagement.
 * Unknown keys are kept in the values (the operator may be ahead of this
 * build) but each one is flagged in warnings.
 *
 * @param charterText - fleet-wide CHARTER.md text, if any.
 * @param engagementText - per-engagement ENGAGEMENT.md text, if any.
 * @returns the resolved values and any unknown-knob warnings.
 */
export function resolveKnobs(
  charterText?: string,
  engagementText?: string,
): ResolvedKnobs {
  const values: Record<string, string> = { ...KNOWN_KNOBS };
  const warnings: string[] = [];
  const warned = new Set<string>();

  const apply = (text: string | undefined, source: string): void => {
    if (text === undefined) return;
    for (const [key, value] of Object.entries(parseKnobs(text))) {
      values[key] = value;
      if (!(key in KNOWN_KNOBS) && !warned.has(key)) {
        warned.add(key);
        warnings.push(
          `Unknown knob "${key}" in ${source} — kept as-is, but this build does not recognize it.`,
        );
      }
    }
  };

  apply(charterText, 'charter');
  apply(engagementText, 'engagement');

  return { values, warnings };
}
