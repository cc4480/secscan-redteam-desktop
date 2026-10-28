/**
 * Compile-time surface for the embedded pino runtime shim
 * (secscan-vendor/pino). The vendored SecScan engine's logger.ts calls
 * pino(options) once and uses trace/debug/info/warn/error/fatal plus
 * child() — that is the whole surface this declaration promises. The
 * runtime shim is a small stderr logger with pino's level names; it is
 * NOT pino and does not implement transports, serializers, or redaction
 * paths (the options object is accepted and mostly ignored).
 */
export interface SecscanLogger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
  child(bindings: Record<string, unknown>): SecscanLogger;
  level: string;
}

export interface PinoShimOptions {
  level?: string;
  redact?: string[];
  transport?: unknown;
}

export default function pino(options?: PinoShimOptions): SecscanLogger;
