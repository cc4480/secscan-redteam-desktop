/**
 * Embedded pino stand-in for the vendored SecScan engine.
 *
 * logger.ts (byte-frozen) calls pino({ level, redact, transport }) once.
 * This shim implements the call shape and the level methods the engine
 * uses (trace/debug/info/warn/error/fatal/child) and writes one JSON line
 * per call to stderr. It is NOT pino: transports are ignored (there is no
 * pino-pretty in the embedded build), redact paths are not applied, and
 * serializers do not exist. The SecScan engine only ever logs its own
 * scan progress through this logger — never target data that the runner
 * has not already handled — and stderr keeps the lines out of the CLI's
 * stdout protocol.
 */

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

function expand(value) {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  return value;
}

function emit(minLevel, bindings, level, args) {
  if (LEVELS[level] < minLevel) return;
  const msg = args.find((a) => typeof a === "string") ?? "";
  const fields = {};
  for (const a of args) {
    if (a && typeof a === "object" && a !== msg) {
      for (const [k, v] of Object.entries(a)) fields[k] = expand(v);
    }
  }
  const line = { level, time: new Date().toISOString(), ...bindings, ...fields, msg };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

export default function pino(options = {}) {
  const minLevel = LEVELS[options.level] ?? LEVELS.info;
  const make = (bindings) => {
    const logger = { level: options.level ?? "info" };
    for (const name of Object.keys(LEVELS)) {
      logger[name] = (...args) => emit(minLevel, bindings, name, args);
    }
    logger.child = (childBindings) => make({ ...bindings, ...(childBindings ?? {}) });
    return logger;
  };
  return make({});
}
