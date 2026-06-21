---
name: forensic-debug
description: Use this skill whenever the user is dealing with a bug, error, crash, failing test, unexpected behavior, or "it works on my machine" problem — anytime something in the code does not do what it should. Trigger it for phrases like "fix this bug", "why is this failing", "this throws an error", "find the problem", "this used to work", "investigate why", a pasted stack trace, a flaky/intermittent failure, or UI symptoms like "the modal won't show", "state is wrong", "value is null/undefined". Also use it instead of telling the user to "add a console.log and tell me what you see" or "open DevTools and check the console" — this skill automates that runtime-evidence loop. Use it even when the user just shares an error message without explicitly asking for a fix. This skill enforces a disciplined, evidence-first debugging method (reproduce → locate → understand → fix → verify) instead of guessing.
---

# Forensic Debug

Your job is to find and eliminate the *root cause* of a defect — not to make the symptom disappear. The single biggest failure mode in debugging is changing code based on a guess before you've confirmed what's actually wrong. This skill exists to stop that. Work like a scientist: form a hypothesis, make an observation that could prove it wrong, and only act once the evidence is in.

Follow the phases below in order. Don't skip ahead to a fix because one "looks obvious" — the obvious fix is frequently the wrong one, and an unconfirmed fix can hide the real bug or introduce a new one.

**Narrate as you go.** Announce each phase transition in one short line before doing its work (e.g. "Phase 1 — reproducing the bug…", "Phase 4 — testing 4 hypotheses in parallel…"). One sentence per transition; don't narrate internal deliberation. Inside a phase, drop a one-line update only when you find something concrete, change direction, or hit a blocker — silence is fine when nothing new has happened. This keeps the user oriented and makes it harder to skip a phase by accident.

## Phase 1 — Reproduce reliably

You can't fix what you can't observe failing. Before touching any code:

- Pin down the **exact** trigger: the command, the inputs, the route, the user action, the environment (OS, versions, env vars, branch, commit).
- State, in writing, **expected behavior vs. actual behavior**. Vague reports ("it's broken") become tractable the moment you make this concrete.
- Get a deterministic reproduction. If the failure is intermittent, record the conditions under which it does and doesn't happen — frequency, timing, concurrency, specific data. Intermittency is itself a clue (often a race condition, ordering dependency, uninitialized state, or external service).
- If you genuinely cannot reproduce it, say so and ask the user for the missing piece (full command, a sample input, the environment). Don't fabricate a repro.

A failing test that captures the bug is the gold standard — write one *first* whenever practical. It gives you a repeatable, automatable signal instead of a manual repro, and unlike the debug logging (which is throwaway), **this test is a permanent deliverable**: once the bug is fixed it stays in the suite as a regression guard so the bug can never silently come back. Keep these two things mentally separate from the start — the test you keep, the instrumentation you delete.

## Phase 2 — Read the evidence before changing anything

Most bugs are solved by reading carefully, not by editing.

- Read the **entire** error message and stack trace, top to bottom. The real cause is often *not* the top frame — find the deepest frame in the user's own code, and read the "caused by" / chained exceptions underneath.
- Read the relevant logs around the failure timestamp, not just the line that crashed.
- Re-read the actual code involved. Don't rely on memory of what it "should" do — open the file and read what it *does*.
- Note any recent changes. If it "used to work", a regression was introduced — `git log`, `git diff`, and `git bisect` are your fastest path to the offending commit.

## Phase 3 — Localize (narrow down where it breaks)

Shrink the search space methodically. Useful techniques:

- **Trace the data flow**: follow the bad value backward from where it blew up to where it was created. The crash site is where the symptom surfaces; the bug is often upstream.
- **Bisection**: cut the problem space in half repeatedly. Disable/comment out halves of a pipeline, binary-search a data set, or use `git bisect` across commits to find exactly where behavior changed.
- **Instrument**: add targeted logging/prints at boundaries to compare *assumed* values against *actual* values (function entry args, return values, state before/after a mutation). Surprises here are where bugs hide. In compiled or interactive contexts, prefer a real debugger and breakpoints (e.g. `pdb`/`breakpoint()`, `node --inspect`, `gdb`/`lldb`, browser DevTools, the IDE debugger).
- **Check the boundaries and the "impossible"**: off-by-one, empty collections, null/None, type coercion, timezone/locale, encoding, async ordering, cache staleness, stale build artifacts. When something "can't be happening", one of your assumptions is false — verify it instead of trusting it.

### The instrumentation loop (log → run → read back → repeat)

When the bug isn't visible from reading alone, observe the program's actual runtime behavior. This is a *loop*, and the right mechanism depends on **where the logs land** — specifically, whether the running program can write to a place you can read:

- **You can run it AND its output lands on your filesystem** (most CLI tools, scripts, test suites, backends): add logging, run it, read the output file directly. No user involvement needed. Use the file approach below.
- **The runtime can't write to your filesystem** (a browser tab, a mobile app, a remote device, a sandboxed process): the program's `console.log`/stdout is trapped inside another process you can't see. Don't fall back to "open DevTools and paste the console". Use the **log-server bridge** instead — see `references/browser-runtime.md`. In short: run the bundled `scripts/log_server.js` on localhost, have the instrumented code POST each log to it, and read the file it writes. This is what removes the copy-paste step for browser/UI bugs.
- **You can't run it yourself but it does log to a file** (needs real user interaction, credentials, specific hardware, a production-only scenario): instrument, then hand off — tell the user exactly what to run and how to reproduce, and either have them paste the log file back or point you at it so you read it.

Run the loop like this:

1. **Add targeted, labeled log statements** at the boundaries that matter (function entry args, return values, the value of a variable right before it's used, both sides of a branch). Two rules make later cleanup safe and reliable, because LLMs are notoriously bad at hand-deleting logs — they leave dangling brackets, broken indentation, and corrupted syntax:
   - **Every debug statement is self-contained on its own line(s).** Never wrap, indent, or splice a log into an existing expression or block — that way deleting the whole line can never break the surrounding code. Prefix each with a unique, greppable tag like `[DBG]`, and log *values and types*, not just "got here".
   - **Wrap every injected block in uniquely-tagged region markers** — `// #region debug-<id>` … `// #endregion debug-<id>` (use the language's comment syntax; pick a short random `<id>` per session). This covers helper functions and the bridge boilerplate, and lets cleanup remove an exact, non-overlapping block. Prefer running `scripts/debug_cleanup.js` to strip everything between the markers deterministically rather than editing by hand.
2. **Send the output to a dedicated temp file**, not just stdout. Terminal scrollback gets lost, truncated, or buried in noise; a file survives the run, can be diffed across runs, and is easy to read back. Append to something like `/tmp/<project>-debug.log` (or a path the user prefers). Truncate it at the start of each run so you're reading only the latest reproduction.
3. **Run and reproduce.** If you can run it, do so and then read the file. With the log-server bridge, the logs arrive in the server's file as the user exercises the app — read that file directly, no paste needed. Otherwise, tell the user *exactly* what to do — the command to run, the action to reproduce the bug, and where the log file will be — then have them either paste its contents back or point you at the file so you read it yourself.
4. **Read the actual values against your expectations.** The discrepancy between what you *assumed* a value was and what it *actually* is at runtime is where the bug lives. This feeds directly into the hypothesis in Phase 4.
5. **Iterate**: add, move, or refine log lines and run again. Narrow until the exact faulty value and its origin are pinned down.
6. **Remove every instrumentation line once the fix is verified** (Phase 7) — not before, so you can compare before/after evidence. Run `scripts/debug_cleanup.js` to strip the `#region debug-<id>` blocks and `[DBG]` lines deterministically, then grep once more to confirm nothing remains — this is far safer than hand-deleting. If you used the bridge, also stop `log_server.js` and delete its `.debug/` output. Never leave debug logging in the final fix, and never log secrets, tokens, passwords, or personal data.

This loop is **language-agnostic** — the method never changes. Only two things vary per language, and you adapt them automatically: the logging statement itself (`print()` / `console.log()` / `println!()` / `fmt.Println()` / `echo` / `Log.d()` / a logging library) and the command used to run the program. Detect the project's language and use its idiomatic logging; the reproduce-and-read-back cycle is identical everywhere.

## Phase 4 — Form hypotheses and confirm the root cause

Don't chase one hunch at a time. Before instrumenting, write down **3–5 specific, falsifiable hypotheses**, each targeting a *different* part of the system so you're not clustering around one guess. Give each one an ID, an expected value, the actual you suspect, and the single observation that would settle it:

```
H1  userId is null when passed to calculateScore()
    expected: a number    suspected actual: null    test: log userId + typeof at entry
H2  score is a string, not a number ("85" vs 85)
    expected: number      suspected actual: string  test: log typeof score before the math
H3  the filter runs before data finishes loading
    expected: 12 rows     suspected actual: 0 rows  test: log rows.length at filter entry
```

Then instrument to test them all in one reproduction, tag each log with its hypothesis ID, and after reading the evidence mark every hypothesis **CONFIRMED** (logs prove it), **REJECTED** (logs disprove it), or **INCONCLUSIVE** (need more instrumentation). If everything comes back rejected or inconclusive, that's information — generate a fresh batch from subsystems you haven't probed yet and loop again. Don't start editing until exactly one chain is confirmed end to end.

**When two batches come up empty — fan out instead of looping.** If two consecutive batches both return all-rejected/inconclusive, you've been searching with the wrong lens. Launch 3 subagents in parallel on the same evidence, each with a different angle: an *execution-tracer* (follow the bad value back to its origin), a *pattern-matcher* (scan the relevant code for the standard bug families — race conditions, stale closures, off-by-one, type coercion, missing await, encoding/timezone, cache staleness), and an *entry-point mapper* (find every call site that reaches the broken path, looking for unexpected or duplicate invocations). Cross-reference their findings: full agreement = high confidence to act; partial disagreement points at the exact place where evidence is still missing. This is the right tool for "going in circles" — three lenses in parallel beat ten sequential guesses.

**Hard stop after the fan-out.** If the parallel investigation also fails to produce one confirmed chain, stop. Indefinite hypothesis generation is guess-and-check in disguise. Report to the user: the symptoms, every hypothesis tested with why it was ruled out, what remains unexplained, and ask for guidance — fresh context, missing access, or permission to escalate scope (architecture, infra, third-party dependency). Do not start a third round unprompted.

- Make each observation the **smallest** one that could refute the hypothesis. If refuted, discard it — don't bend the evidence to fit a theory you're attached to.
- Distinguish **symptom from cause** by asking "why" until you reach something that, if changed, prevents the whole chain. (The null-pointer crash → because the field was null → because the loader returned early → because the config key was misspelled. The typo is the root cause.)

## Phase 5 — Fix the root cause

- Make the **smallest change** that addresses the confirmed cause. Resist sprawling rewrites mid-debug.
- Fix the cause, not the symptom. Be suspicious of "fixes" that merely suppress the signal — swallowing an exception, adding a defensive `if x is None` that masks why `x` is null, retrying until it happens to pass. If you add a guard, make sure it's the *correct* behavior, not a muffler.
- Check whether the **same bug pattern** exists elsewhere in the codebase and flag or fix those too.
- Preserve existing behavior and style; match the surrounding conventions.

## Phase 6 — Verify

- Re-run the original reproduction and confirm it now passes.
- **Confirm with evidence, not just a green result.** Keep the instrumentation in place through verification and re-run the same logs after the fix — the value that was wrong (`userId: null`) should now be right (`userId: 5`). A side-by-side before/after from the same log points is far stronger proof than "the error went away".
- Run the **broader test suite** (or the relevant subset) to catch regressions — a fix that breaks three other things isn't a fix.
- Test the **edge cases** around your change, especially the boundary that caused the bug.
- For an intermittent bug, run the repro multiple times; one green pass doesn't prove a race is gone.

## Phase 7 — Clean up and report

- Remove temporary instrumentation deterministically: run `scripts/debug_cleanup.js` to strip the `#region debug-<id>` blocks and `[DBG]` lines, then grep the tree once more to confirm none survive. Don't hand-edit them out — that's where syntax gets corrupted. If you used the log-server bridge, stop `log_server.js` and delete its `.debug/` output directory.
- **Keep the regression test.** The throwaway is the logging; the test that reproduces the bug stays committed so this exact failure can't return unnoticed. Confirm it now passes.
- Report concisely, in this shape:
  - **Symptom** — what was observed.
  - **Root cause** — the actual underlying reason, in one or two sentences.
  - **Fix** — what changed and why it addresses the cause.
  - **Verification** — how you confirmed it (which repro/tests now pass, before/after evidence).
  - **Notes** — any related risks, similar spots worth checking, or follow-ups.
- **Optional — five whys for recurring or high-impact bugs.** When a bug is a repeat offender, a production incident, or security-relevant, don't stop at the code fix. Ask why it was *possible*: missing input validation (add it), no test for this case (add one), a gap the review didn't catch (update the checklist). Fix the code, but also close the hole that let it through.

## Anti-patterns to avoid

- **Shotgun debugging**: changing several things at once. You won't know what fixed it, and you may introduce new bugs. Change one variable at a time.
- **Guess-and-check edits**: editing before reproducing or before understanding. If you're trying random changes, stop and go back to Phase 1–3.
- **Fixing the symptom**: making the error message go away while the cause lives on.
- **Trusting assumptions over observations**: "this function definitely returns X" — verify it, don't assume it.
- **Skipping verification**: declaring victory without re-running the repro and the suite.

## When you're stuck

- Explain the failing code line by line out loud (rubber-duck) — articulating it often surfaces the false assumption.
- Question the assumption you're *most* sure of; that's usually where it's hiding.
- Re-read the error message a third time; check the "caused by" chain you skimmed.
- Search the exact error string — but treat external answers as hypotheses to verify, not fixes to paste.
- Reduce to a minimal reproducible example; the act of stripping it down frequently reveals the cause.

## Bundled resources

- `references/browser-runtime.md` — read this when the bug lives in a runtime you can't read directly (browser tab, mobile webview, remote device, Chrome extension). It covers the log-server bridge end to end: starting the server, the ready-to-adapt logger snippets (JS/TS, Python), the NDJSON log format, and the common reasons logs don't arrive (CORS preflight, CSP `connect-src`, HTTPS→localhost mixed content, extension isolated worlds) with their fixes.
- `scripts/log_server.js` — a tiny dependency-free Node (18+) HTTP server that accepts a session and appends posted logs to a file you can read. Run it only for the browser/remote case; CLI/backend bugs just log to a file directly.
- `scripts/debug_cleanup.js` — a dependency-free Node script that deterministically removes all instrumentation it can find (`#region debug-<id>` … `#endregion` blocks in any comment syntax, plus standalone `[DBG]` lines) across the tree. Use it instead of hand-deleting logs; supports `--dry` to preview. This is the reliable counterpart to the "self-contained line" rule above.
