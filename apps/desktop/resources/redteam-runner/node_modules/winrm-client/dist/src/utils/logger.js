"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
/**
 * Check if debug logging is enabled for a namespace
 */
function isDebugEnabled(namespace) {
    const debug = process.env.DEBUG;
    if (!debug)
        return false;
    return (debug === 'winrm' ||
        debug === '*' ||
        debug.includes(`winrm:${namespace}`) ||
        debug.includes('winrm:*'));
}
/**
 * Format arguments for logging output
 */
function formatArgs(args) {
    return args.map((arg) => {
        if (arg instanceof Error) {
            return {
                name: arg.name,
                message: arg.message,
                stack: arg.stack,
                ...Object.getOwnPropertyNames(arg).reduce((acc, key) => {
                    if (key !== 'name' && key !== 'message' && key !== 'stack') {
                        acc[key] = arg[key];
                    }
                    return acc;
                }, {}),
            };
        }
        return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg;
    });
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
function createLogger(namespace) {
    const enabled = isDebugEnabled(namespace);
    return {
        debug(message, ...args) {
            if (!enabled)
                return;
            console.debug(`[DEBUG:${namespace}] ${message}`, ...formatArgs(args));
        },
    };
}
exports.default = { createLogger };
