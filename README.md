# claude-forensic-debug

Forensic, evidence-first debugging skill for [Claude Code](https://docs.claude.com/claude-code).

## Skills in this repository

### [`forensic-debug`](skills/forensic-debug/) — Evidence-first root-cause investigation

A disciplined, language-agnostic debugging methodology that treats every bug as a forensic investigation: reproduce reliably, read the evidence, form falsifiable hypotheses, confirm the root cause, fix the cause (not the symptom), and verify with before/after evidence. Built to stop the single biggest failure mode in LLM-assisted debugging — changing code based on a guess before confirming what's actually wrong.

**What makes it different:**

- **Parallel falsifiable hypotheses** — generates 3–5 specific hypotheses with IDs (`H1`, `H2`, …) and tests them all in a single reproduction, instead of chasing one hunch at a time.
- **Three-level escalation, bounded by design** — batch → multi-agent fan-out → user. When two batches come up empty, launches an *execution-tracer*, a *pattern-matcher*, and an *entry-point mapper* in parallel; if those also fail, **stops** and asks the user. No infinite guess-and-check loops.
- **Reads runtime logs from places you can't normally inspect** — browser tabs, mobile webviews, Chrome extensions, sandboxed iframes, remote devices. The bundled `scripts/log_server.js` runs on localhost as a dependency-free Node 18+ HTTP sink — no Chrome MCP, no DevTools, no copy-paste from the console. The instrumented code POSTs each log as NDJSON; the skill reads the file as you reproduce the bug. Includes ready-to-adapt logger snippets (JS/TS, Python) and fixes for the four common reasons logs don't arrive (CORS preflight, CSP `connect-src`, HTTPS→localhost mixed content, extension isolated worlds) in `references/browser-runtime.md`.
- **Deterministic instrumentation cleanup** — `scripts/debug_cleanup.js` strips `#region debug-<id>` blocks and `[DBG]` lines across the tree, solving a real LLM failure mode (hand-deleted logs leave broken syntax and dangling brackets).
- **Language-agnostic** — the methodology is identical across languages; only the logging primitive and run command change. Cleanup script supports JS/TS, Python, Go, Rust, Java/Kotlin, C/C++, C#, PHP, Lua, Dart, shell, SQL, R, Julia, Elixir, and **Delphi/Pascal** (`.pas`, `.dpr`, `.dpk`, `.inc`).
- **Phase narration for UX** — announces each phase transition in one line so you see structure instead of opacity.

### Inspired by Cursor's Debug Mode

This skill was written from scratch **inspired by [Cursor's *Debug Mode*](https://cursor.com/blog/debug-mode)** — an agent loop introduced in Cursor 2.2 (December 2025) that instruments code with logging, runs it, reads the runtime evidence, and forms hypotheses from there. The goal of `forensic-debug` is to bring that same evidence-first methodology to **Claude Code** as a standalone, language-agnostic skill, with a few additions Cursor's built-in agent doesn't cover: deterministic instrumentation cleanup, a localhost log-server bridge for runtimes that can't write directly to your filesystem, parallel falsifiable hypotheses with explicit IDs, and bounded three-level escalation.

## Installation

### Option 1 — clone directly into your skills directory

```bash
git clone https://github.com/vgartner/claude-forensic-debug /tmp/claude-forensic-debug
cp -r /tmp/claude-forensic-debug/skills/forensic-debug ~/.claude/skills/
```

### Option 2 — symlink (live-edit while iterating)

```bash
git clone https://github.com/vgartner/claude-forensic-debug ~/code/claude-forensic-debug
ln -s ~/code/claude-forensic-debug/skills/forensic-debug ~/.claude/skills/forensic-debug
```

Claude Code picks up new skills under `~/.claude/skills/` automatically — restart any open session to refresh.

## Usage

The skill auto-triggers on bug/error/failure language, pasted stack traces, flaky-test reports, and UI symptoms like *"the modal won't show"* or *"value is null/undefined"* — you don't need to invoke it explicitly. To force it, type:

```
/forensic-debug
```

Claude will announce each phase as it goes (`Phase 1 — reproducing…`, `Phase 4 — testing 4 hypotheses in parallel…`), so you can follow along and intervene at any point.

## Project layout

```
.
├── LICENSE
├── README.md
├── .gitignore
└── skills/
    └── forensic-debug/
        ├── SKILL.md                 # methodology + phase rules
        ├── references/
        │   └── browser-runtime.md   # log-server bridge, CORS/CSP/extension fixes
        └── scripts/
            ├── log_server.js        # localhost HTTP log sink (Node 18+)
            └── debug_cleanup.js     # deterministic instrumentation removal
```

## Acknowledgments

Two specific features in this skill were inspired by prior work in the Claude Code skills community and incorporated after a side-by-side review:

- The **parallel multi-agent fan-out** in Phase 4 (when two hypothesis batches come up empty) was inspired by [`jezweb/claude-skills` → `deep-debug`](https://github.com/jezweb/claude-skills/tree/main/skills/deep-debug), which uses three parallel subagents with different perspectives to investigate stubborn bugs.
- The **hard-stop escalation rule** (no third round of hypotheses without user input) was inspired by [`Sungmin-Cho/claude-deep-work` → `deep-debug`](https://github.com/Sungmin-Cho/claude-deep-work/tree/main/skills/deep-debug), which bounds debugging with an iron rule against indefinite guessing.

Both upstream skills are excellent in their own contexts.

## License

MIT — see [LICENSE](LICENSE).
