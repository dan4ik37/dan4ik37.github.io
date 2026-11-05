---
name: d37-agent-prompt
description: Write a compact English prompt for a site or shared-engine agent (or a message to the Backrooms session) in the one shared D37 template — owner words, files owned / not touched, read-first line ranges, done-criteria with numbers on the owner's hardware profile, heavy jobs, budget, skills, report format. Use before spawning any agent for the dan4ik37 site or E:\d37-core.
---

# Agent prompt (site coordinator)

The template is shared with the Backrooms session: `E:\d37-core\spec\contracts\TEMPLATE.md` (read it; fill every field, "none"
where nothing applies). If the work is a shared-engine contract, the contract file `E:\d37-core\spec\contracts\C-NNN-*.md` IS the
prompt: point the agent at it plus the lines below. Board: docs/TASKS.md (site), E:\d37-core\spec\BOARD.md (shared).

Before writing: `get_usage` (weekly %: < 60 % up to 4 agents for both sessions together, 60–80 % 2, > 80 % in-flight only); tasks
touching the same files run one after another.

## Site defaults to put into every site agent prompt
- Task T-NNN (and C-NNN), the owner's exact words with date; which docs/areas/*.md file(s) to read (one or two, never all).
- Worktree: `git -C E:\site\dan4ik37.github.io worktree add .claude/worktrees/<name> -b <branch> main`; commit per sub-step with
  the harness attribution trailer; stage paths explicitly; never push, never merge to main (skill d37-merge is the coordinator's).
- Files it owns / must not touch (always: D:\UnityProjects\Backrooms* read-only; the secret folders and files listed in CLAUDE.md
  "Security and machine rules").
- SQL only into the area's existing SQL file (skill d37-sql-verify); no keys anywhere (the repo is PUBLIC).
- Any game / engine file change → bump GAMES_VER in js/features/games.js; foreign text only via esc() / jsAttr() / textContent.
- Simulation logic goes to the core first (E:\d37-core\spec\PLAN.md «Core first»): a JS prototype sits behind a flag and names
  its core port on the board.
- Numbers on the phone profile (CPU ×4 "mid", skill d37-chrome-e2e) before / after; 0 per-frame garbage; 20× open/close leaks;
  10–15 min run without errors; fallback path; flags with one-line rollback; mobile + dark/light themes.
- Heavy jobs under E:\claude-tmp\HEAVY.lock (skill d37-heavy-lock in E:\d37-core\.claude\skills). Temp: E:\claude-tmp\<task>\.
- Downloads only with the owner's permission (permissive licenses, exact versions, listed in the report).
- Report (≤ 15 lines, English): Done / Not done / Gaps / Tests (numbers, where measured) / Owner actions (SQL + REST checks) /
  Branch / Rung.
