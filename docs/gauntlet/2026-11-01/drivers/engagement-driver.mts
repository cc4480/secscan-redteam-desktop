import { runEngagement } from "/home/hatch/workspace/secscan-redteam-desktop/apps/redteam-runner/src/index.ts";
try {
  const r = await runEngagement({
    target: "http://127.0.0.1:8080",
    mode: "red",
    objective: process.env.GAUNTLET_OBJECTIVE ?? "Assess the local lab web application end to end.",
    roe: { scope: ["127.0.0.1"] },
    operatorName: "Carlos",
  });
  console.log("RESULT", JSON.stringify({ id: r.engagementId, status: r.status, findings: r.findings.length, blocked: r.blockedReason }));
} catch (e: any) {
  console.error("STACK:", e?.stack ?? e);
  process.exit(1);
}
