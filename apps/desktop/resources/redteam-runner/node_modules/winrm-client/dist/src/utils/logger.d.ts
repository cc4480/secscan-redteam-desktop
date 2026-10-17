/**
 * Logger interface for debug output
 */
interface Logger {
    debug(message: string, ...args: unknown[]): void;
}
/**
 * Create a namespaced logger instance
 * @param namespace - The namespace for this logger. Possible values are:
 * - 'http'
 * - 'shell'
 * - 'command'
 * - 'interactive'
 * - 'runCommand'
 * - 'runPowershell'
 * @returns Logger object.
 */
export declare function createLogger(namespace: string): Logger;
declare const _default: {
    createLogger: typeof createLogger;
};
export default _default;
