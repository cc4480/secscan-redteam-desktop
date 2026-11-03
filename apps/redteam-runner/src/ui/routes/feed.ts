/**
 * Live operation feed (v0.22.0): Server-Sent Events over events.jsonl.
 *
 * GET /api/engagements/:id/events — tails the engagement's events.jsonl
 * (readEvents after `after` seq) and follows it until the engagement
 * reaches a terminal status. The dashboard reconnects with ?after=<lastSeq>
 * if the stream drops.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readEvents, readState } from "../../events.js";
import type { UiStore } from "../store.js";
import { engagementDir } from "../store.js";
import { json } from "./http.js";

const TERMINAL = new Set(["complete", "halted", "blocked"]);

function sseWrite(res: ServerResponse, event: string, data: unknown): boolean {
  return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** GET /api/engagements/:id/events — SSE stream. */
export function handleFeed(store: UiStore, req: IncomingMessage, res: ServerResponse, id: string, query: URLSearchParams): void {
  const dir = engagementDir(store.engagementsDir, id);
  if (!dir) {
    json(res, 404, { error: "unknown engagement" });
    return;
  }
  let after = Number(query.get("after") ?? "0");
  if (!Number.isFinite(after) || after < 0) after = 0;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let closed = false;
  let idlePolls = 0;
  // Declared BEFORE push() can run. The first push used to execute while `timer`
  // was still in its temporal dead zone, so a slow client (res.write returns false
  // on a full buffer) or a terminal state on the first tick threw a ReferenceError
  // out of the route; with no uncaughtException handler in the console, that ended
  // the process. Every exit path now goes through stop().
  let timer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    closed = true;
    if (timer !== undefined) clearInterval(timer);
  };

  req.on("close", stop);

  const push = (): void => {
    if (closed) return;
    const events = readEvents(dir, after, 200);
    for (const ev of events) {
      after = ev.seq;
      if (!sseWrite(res, "event", ev)) {
        stop();
        return;
      }
    }
    const state = readState(dir);
    if (state) {
      if (!sseWrite(res, "state", state)) {
        stop();
        return;
      }
      if (TERMINAL.has(state.status)) {
        idlePolls++;
        // Terminal + quiet: close the stream so the dashboard settles.
        if (idlePolls >= 3 && events.length === 0) {
          sseWrite(res, "done", { status: state.status });
          stop();
          res.end();
          return;
        }
      } else {
        idlePolls = 0;
      }
    }
  };

  // Heartbeat comment keeps intermediaries from timing out the stream.
  res.write(": ping\n\n");
  push();
  // Only start the interval if the first push did not already settle the stream.
  if (!closed) timer = setInterval(push, 1000);}
