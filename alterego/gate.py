#!/usr/bin/env python3
"""gate.py -- local safety gate for NATIVE shell/file actions.

Why this exists
---------------
The AlterEgo bridge exists so a REMOTE agent can drive this PC over HTTP.
An agent already running ON the PC does not need the transport: no port, no
bearer token, no supervisor, no MCP session. It needs only the policy that
made the bridge safe -- risk tiers, blast radius, recoverability, and the
command allow/deny rules.

This loads those rules in-process from pc-agent/ and gates a proposed action
BEFORE it runs. It reuses the bridge's own modules rather than re-inventing
them, so both agents answer to one policy.

Usage
-----
    python gate.py check  --tool shell_pwsh --command "rm -rf /"
    python gate.py check  --tool delete_file --path "C:\\important.txt"
    python gate.py tier   --tool write_file
    python gate.py rules

Exit codes
----------
    0  ALLOW      -- silent/routine tier, no deny-rule match
    2  CONFIRM    -- always_ask tier or deny-rule match; human must decide
    3  DENY       -- hard deny (deny rule matched) or unknown tool

With --json the decision is printed as a single JSON object.
"""
import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PC_AGENT = HERE / "pc-agent"
if not PC_AGENT.is_dir():
    sys.exit("gate.py: expected pc-agent/ beside this script")

sys.path.insert(0, str(PC_AGENT))

try:
    import command_rules
    import tool_profiles
except Exception as e:  # pragma: no cover - fail loud, never fail open
    sys.exit(f"gate.py: cannot load policy modules from {PC_AGENT}: {e}")


def decide(tool, command=None, path=None):
    """Return (verdict, code, reasons[]). Deny beats ask beats allow."""
    reasons = []
    # get_profile() silently returns a restrictive DEFAULT for unknown tools
    # (blast=system, recoverability=0) rather than raising, and that default
    # maps to CONFIRM. For a gate, an unrecognised tool must be a hard DENY:
    # a CONFIRM invites a yes for something nothing has assessed.
    if tool not in tool_profiles.PROFILES:
        return "DENY", 3, [f"unknown tool {tool!r}: not in PROFILES, refusing"]
    try:
        tier = tool_profiles.approval_tier(tool)
    except Exception as e:
        return "DENY", 3, [f"approval_tier failed ({e}); failing closed"]

    reasons.append(f"tier={tier}")

    try:
        prof = tool_profiles.get_profile(tool)
    except Exception:
        prof = {}
    if prof:
        reasons.append(
            f"blast_radius={prof.get('blast_radius')} "
            f"recoverability={prof.get('recoverability')}/10")
        for eff in prof.get("side_effects", []):
            reasons.append(f"side_effect={eff}")

    # Command allow/deny rules apply to the shell tools only.
    if command and tool in ("shell_pwsh", "shell_exec"):
        try:
            allowed, why = command_rules.check_command(command)
        except Exception as e:
            return "DENY", 3, [f"command_rules failed ({e}); failing closed"]
        reasons.append(why)
        if not allowed:
            return "DENY", 3, reasons

    if tier == "silent":
        return "ALLOW", 0, reasons
    if tier in ("routine", "ask"):
        return "CONFIRM", 2, reasons
    if tier == "always_ask":
        return "CONFIRM", 2, reasons + ["ALWAYS_ASK: destructive-class action"]
    return "CONFIRM", 2, reasons


def main(argv=None):
    ap = argparse.ArgumentParser(description="local safety gate")
    ap.add_argument("action", choices=["check", "tier", "rules"])
    ap.add_argument("--tool")
    ap.add_argument("--command")
    ap.add_argument("--path")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    if a.action == "tier":
        if not a.tool:
            ap.error("--tool required")
        print(tool_profiles.approval_tier(a.tool))
        return 0

    if a.action == "rules":
        r = command_rules.load_rules()
        payload = {"allow": r.get("allow", []), "deny": r.get("deny", []),
                   "source": str(command_rules.rules_path())}
        print(json.dumps(payload, indent=2))
        return 0

    if not a.tool:
        ap.error("--tool required for check")

    verdict, code, reasons = decide(a.tool, a.command, a.path)
    if a.json:
        print(json.dumps({"verdict": verdict, "exit": code,
                          "tool": a.tool, "reasons": reasons}, indent=2))
    else:
        print(f"{verdict} ({code}): {a.tool}")
        for r in reasons:
            print(f"  - {r}")
    return code


if __name__ == "__main__":
    sys.exit(main())
