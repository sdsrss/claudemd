#!/usr/bin/env python3
"""Independent mutation battery for the REPAIRED spec-structure tests (0.78.0 delta review).

Written by the delta reviewer, not the author of the fix. Every mutation is
applied alone to a fresh copy; a mutation that does not change the file is a
harness defect and is reported as such. Unlike the author's harness this one
also fails loudly if the suite crashes (pass/fail unparsable) rather than
silently scoring it RED.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CORE = "spec/CLAUDE.md"
EXT = "spec/CLAUDE-extended.md"

V6254_TRIGGERS = (
    "**Yield only on**: `[AUTH REQUIRED]`, direction actually ambiguous, or context "
    "pressure (§11 Context pressure → `tasks/<slug>-paused.md`)."
)


def sub_once(text, pattern, repl, flags=0):
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    return new, n == 1


# ---------------------------------------------------------------- CORE attacks

def x1(t):
    """Trigger list reverted to v6.25.4; the bold phrase survives to the right of
    the slice-terminating em-dash, inside a sentence that WITHDRAWS it.
    Exploits: line.indexOf(' — ', idx) falls through to the second em-dash near
    the end of the line, so `list` re-widens to ~the whole line."""
    return sub_once(
        t,
        r"\*\*Yield only on\*\*:.*?as a context-pressure yield does\.",
        V6254_TRIGGERS
        + " Holding the turn open through a subagent wait stays mandatory; the v6.26.0"
        " proposal to add a fourth trigger, or **awaiting a spawned subagent**, was withdrawn.",
    )


def x2(t):
    """Same, but phrased as the deadlock restated rather than withdrawn, and the
    forbidden token 'not a yield trigger' is avoided by one word."""
    return sub_once(
        t,
        r"\*\*Yield only on\*\*:.*?as a context-pressure yield does\.",
        V6254_TRIGGERS
        + " A spawned subagent never licenses a stop, or **awaiting a spawned subagent**"
        " would let any cycle exit at will.",
    )


def x3(t):
    """Trigger kept in the list but the whole rule negated by the clause after it
    (belt-and-braces: does the test read polarity of the SENTENCE at all?)."""
    return sub_once(
        t,
        r"so yield naming what is awaited; completion re-invokes you, no user input needed",
        "so do NOT yield; hold the turn open and poll, completion never re-invokes you",
    )


def x4(t):
    """Em-dash that terminates the slice replaced by a comma. Affirmative text
    kept — this one SHOULD stay green; it is the control that proves the slicer
    silently widens rather than erroring."""
    return sub_once(
        t,
        r"or \*\*awaiting a spawned subagent\*\* — its report",
        "or **awaiting a spawned subagent**, whose report",
    )


def x5(t):
    """Reorder: subagent trigger moved to the FRONT of the enumeration. Rule
    unchanged in meaning. Expected RED = the test is order-brittle."""
    return sub_once(
        t,
        r"\*\*Yield only on\*\*: `\[AUTH REQUIRED\]`, direction actually ambiguous, context pressure \(§11 Context pressure → `tasks/<slug>-paused\.md`\), or \*\*awaiting a spawned subagent\*\* — its report",
        "**Yield only on**: **awaiting a spawned subagent**, `[AUTH REQUIRED]`, direction"
        " actually ambiguous, or context pressure (§11 Context pressure →"
        " `tasks/<slug>-paused.md`) — the subagent's report",
    )


def x6(t):
    """A SECOND line carrying the exact YIELD_ANCHOR is inserted earlier in core,
    stating the pre-v6.26.0 rule; the real line is left intact below it."""
    marker = "- **MEMORY.md read-the-file** (HARD at ship/release/destructive-path/L3)"
    decoy = (
        "- **Mid-SPINE turn-yield** (HARD, all levels): summary — **Yield only on**:"
        " `[AUTH REQUIRED]`, direction actually ambiguous, or context pressure. A"
        " spawned subagent wait is not among them.\n"
    )
    if marker not in t:
        return t, False
    return t.replace(marker, decoy + marker, 1), True


# ----------------------------------------------------------------- EXT attacks

def y1(t):
    """§12 exception inverted WITHOUT the word 'suspend' — the token the repaired
    test blocks. Keeps '**Second exception**' and 'core §11' so both positive
    assertions still fire."""
    return sub_once(
        t,
        r"\*\*Second exception\*\*: awaiting the pre-tag review subagent.*?opens\.",
        "**Second exception**: none — the core §11 subagent-yield trigger does not"
        " reach inside this window; the pre-tag review wait is held open, never yielded.",
    )


def y2(t):
    """§12 exception hollowed out: the token survives as a heading for a sentence
    that permits nothing."""
    return sub_once(
        t,
        r"\*\*Second exception\*\*: awaiting the pre-tag review subagent.*?opens\.",
        "**Second exception**: reserved (see core §11 for the general trigger, which"
        " this window overrides).",
    )


def y3(t):
    """§11-O fallback inverted WITHOUT the 'never name' token."""
    return sub_once(
        t,
        r"name an absolute output path in the spawn prompt and poll that file",
        "do NOT name an absolute output path in the spawn prompt — there is no fallback",
    )


def y4(t):
    """Decoy §11-O bullet inserted EARLIER in the file carrying both required
    phrases; the real bullet is then gutted. Exploits find()'s first-match."""
    real = [l for l in t.split("\n") if l.startswith("- ") and "reaches main only at turn end" in l.lower()]
    if not real:
        return t, False
    real = real[0]
    decoy = (
        "- Historical note: subagent output reaches main only at turn end, and the old"
        " advice was to name an absolute output path in the spawn prompt.\n"
    )
    # insert the decoy near the top of the file, then gut the real bullet
    lines = t.split("\n")
    out = lines[:40] + [decoy.rstrip("\n")] + lines[40:]
    t2 = "\n".join(out)
    t2 = t2.replace(
        real,
        "- **Output reaches main only at turn end**. Inside a cycle you are blind to"
        " it; hold the turn open regardless and never poll a file.",
        1,
    )
    return t2, t2 != t


def y5(t):
    """Move the real §12 atomicity rule BELOW the Recent-changes restatement.
    Rule text unchanged — probes whether the exact-heading selector really is
    position-independent (should stay GREEN)."""
    lines = t.split("\n")
    idx = next((i for i, l in enumerate(lines) if "**Manual-ship atomicity (HARD, clarification)**" in l), None)
    if idx is None:
        return t, False
    rule = lines.pop(idx)
    lines.append("")
    lines.append(rule)
    return "\n".join(lines), True


def m1(t):  # core trigger removed, restored to the pre-change enumeration
    return sub_once(
        t,
        r"\*\*Yield only on\*\*:.*?\. \"Natural-feeling\"",
        V6254_TRIGGERS + ' "Natural-feeling"',
    )


def m2(t):  # §12 second exception removed entirely
    return sub_once(t, r" \*\*Second exception\*\*: awaiting the pre-tag review subagent.*?opens\.", "")


def m3(t):  # §11-O delivery bullet removed
    return sub_once(t, r"\n- \*\*Output reaches main only at turn end\*\*.*?\n", "\n")


def m4b(t):  # core trigger INVERTED, rationale sentence kept
    return sub_once(
        t,
        r", or \*\*awaiting a spawned subagent\*\* — its report enters context only at turn end \(measured 2026-09-06\), so yield naming what is awaited; completion re-invokes you, no user input needed, and a yield still unresumed when the user next types owes `tasks/<slug>-paused\.md` as a context-pressure yield does\.",
        ". Awaiting a spawned subagent is explicitly NOT a yield trigger — hold the turn open.",
    )


def m4c(t):  # core trigger list reverted verbatim; "subagent" survives to its right
    return sub_once(
        t,
        r"\*\*Yield only on\*\*:.*?as a context-pressure yield does\.",
        V6254_TRIGGERS + " A spawned subagent is a normal tool call.",
    )


def m5b(t):  # §12 exception inverted into a re-assertion of the deadlock
    return sub_once(
        t,
        r"\*\*Second exception\*\*: awaiting the pre-tag review subagent.*?opens\.",
        "The core §11 subagent-yield trigger is suspended inside the atomic ship window.",
    )


def m5c(t):  # §12 exception replaced by a bare cross-reference
    return sub_once(
        t, r"\*\*Second exception\*\*: awaiting the pre-tag review subagent.*?opens\.", "See core §11."
    )


def m6b(t):  # §11-O fallback inverted
    return sub_once(t, r"name an absolute output path", "Never name an output path")


MUTATIONS = [
    ("M1  core: §11 trigger removed (pre-change text)", CORE, m1, "RED"),
    ("M2  ext: §12 second exception removed", EXT, m2, "RED"),
    ("M3  ext: §11-O delivery bullet removed", EXT, m3, "RED"),
    ("M4b core: trigger INVERTED, rationale kept", CORE, m4b, "RED"),
    ("M4c core: trigger REVERTED to v6.25.4 verbatim", CORE, m4c, "RED"),
    ("M5b ext: §12 exception -> 'trigger is suspended'", EXT, m5b, "RED"),
    ("M5c ext: §12 exception -> bare 'See core §11.'", EXT, m5c, "RED"),
    ("M6b ext: §11-O fallback -> 'Never name an output path'", EXT, m6b, "RED"),

    ("X1  core: list reverted, bold phrase in a WITHDRAWN sentence", CORE, x1, "RED"),
    ("X2  core: list reverted, bold phrase in a NEGATING sentence", CORE, x2, "RED"),
    ("X3  core: trigger kept, 'so yield' -> 'so do NOT yield'", CORE, x3, "RED"),
    ("X4  core: slice-terminating em-dash -> comma (text still true)", CORE, x4, "RED"),
    ("X5  core: subagent trigger moved to FRONT of list (same meaning)", CORE, x5, "RED"),
    ("X6  core: decoy anchor line inserted above the real rule", CORE, x6, "RED"),
    ("Y1  ext: §12 exception inverted without the word 'suspend'", EXT, y1, "RED"),
    ("Y2  ext: §12 exception hollowed to 'reserved', window overrides", EXT, y2, "RED"),
    ("Y3  ext: §11-O fallback inverted without 'never name'", EXT, y3, "RED"),
    ("Y4  ext: decoy §11-O bullet above a gutted real one", EXT, y4, "RED"),
    ("Y5  ext: real §12 rule moved below the Recent-changes bullet", EXT, y5, "GREEN"),
]


def run_suite(root):
    p = subprocess.run(
        ["node", "--test", "tests/scripts/spec-structure.test.js"],
        cwd=root, capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    mp = re.search(r"^ℹ pass (\d+)$", out, re.M)
    mf = re.search(r"^ℹ fail (\d+)$", out, re.M)
    if not mp or not mf:
        return None, None, out[-2000:]
    return int(mp.group(1)), int(mf.group(1)), out


def fresh():
    d = Path(tempfile.mkdtemp(prefix="delta-mut-"))
    for sub in ("spec", "scripts", "tests", "commands", "hooks"):
        src = REPO / sub
        if src.is_dir():
            shutil.copytree(src, d / sub)
    shutil.copy2(REPO / "package.json", d / "package.json")
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    subprocess.run(["git", "add", "-A"], cwd=d, check=True, capture_output=True)
    return d


def main():
    base = fresh()
    try:
        p, f, out = run_suite(base)
        if p is None:
            print("BASE suite output unparsable:\n" + out)
            return 1
        print(f"[BASE  ] unmutated working tree{'':45} pass={p} fail={f}")
        if f != 0:
            print("BASE not green — aborting.")
            return 1
    finally:
        shutil.rmtree(base)

    survivors = []
    for label, rel, fn, expect in MUTATIONS:
        d = fresh()
        try:
            target = d / rel
            text = target.read_text(encoding="utf8")
            new, applied = fn(text)
            if not applied or new == text:
                print(f"[!HARN!] {label:<62} NOT-APPLIED")
                survivors.append((label, "not-applied"))
                continue
            target.write_text(new, encoding="utf8")
            p, f, out = run_suite(d)
            if p is None:
                print(f"[!CRASH] {label:<62} unparsable output")
                survivors.append((label, "crash"))
                continue
            got = "RED" if f != 0 else "GREEN"
            flag = "  " if got == expect else "  <== UNEXPECTED"
            note = ""
            if got == "GREEN" and expect == "RED":
                note = "  *** MUTATION SURVIVES ***"
                survivors.append((label, "survives"))
            elif got == "RED" and expect == "GREEN":
                note = "  (false positive: legal rewording goes red)"
            print(f"[{got:<6}] {label:<62} pass={p} fail={f} expect={expect}{flag}{note}")
        finally:
            shutil.rmtree(d)

    print()
    if survivors:
        print("SURVIVORS / harness problems:")
        for s in survivors:
            print("  -", s)
    else:
        print("no inverting mutation survived")
    return 0


if __name__ == "__main__":
    sys.exit(main())
