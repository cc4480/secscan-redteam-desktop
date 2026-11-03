/**
 * Device-template validation — the mechanical form of "every device uses its
 * whole toolset".
 *
 * Pure: takes the catalogue and the templates, returns the violations. The
 * runner's test suite calls it with the real constants; nothing here touches
 * the network or the model, so a gap fails the build rather than surfacing as
 * a scan that quietly skipped half its capability.
 */
import { type DeviceId, type DeviceTemplate } from './catalog.js';
export interface Violation {
    rule: string;
    detail: string;
}
/**
 * Validate a template set against the catalogue.
 *
 * @param templates - device id → template
 * @param catalogue - every tool the product exposes
 * @returns every violation found, empty when the set is sound
 */
export declare function validateDeviceTemplates(templates: Record<DeviceId, DeviceTemplate>, catalogue?: readonly {
    name: string;
}[]): Violation[];
