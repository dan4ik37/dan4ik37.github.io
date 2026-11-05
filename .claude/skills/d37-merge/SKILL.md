---
name: d37-merge
description: Accept and merge an agent's worktree branch into main of the dan4ik37 site — rerun tests, resolve the GAMES_VER conflict without dropping per-game scripts, run merge-check.py and the module map, push (= deploy), and check the files on prod. Use whenever a site branch is merged or a merge conflict touches js/features/games.js.
---

# Merge a site branch (coordinator only; agents never push or merge to main)

Read first: CLAUDE.md "Agents → Acceptance" and "Pitfalls" (GAMES_VER). Heavy steps take the lock (E:\d37-core\spec\HEAVY_LOCK.md).

1. Review: `git -C <worktree> log --oneline main..HEAD` and `git diff main...<branch> --stat`; read the agent's report (Done / Not
   done / Tests with numbers). No numbers → not accepted.
2. Rerun the branch's own tests in its worktree: `node scripts/ci-run.cjs --only <names>` (light), plus the e2e it changed
   (skill d37-chrome-e2e, under the lock).
3. Merge: `git -C E:\site\dan4ik37.github.io merge --no-ff <branch>`.
4. GAMES_VER conflict in js/features/games.js — resolve ONLY the version line: new value = above BOTH sides (e.g. main 159, branch
   160 → 161) with a short comment naming both. Keep BOTH sides of every other line in the hunk: each game row's `scripts: [...]`
   must contain the union of both sides' files (22.10 a "take ours" resolution dropped trees.js from 4 games).
5. Checks after the merge (all must pass):
   - `python -X utf8 scripts/merge-check.py` → "done, problems: 0"
   - docs/MODULES.md is GENERATED: on a merge conflict in it never resolve by hand — take either side
     (`git checkout --theirs docs/MODULES.md`), finish the merge, then regenerate. After every merge:
     `node scripts/module-map.cjs` → if `git status --short docs/MODULES.md` shows a change, commit it at once:
     `git add docs/MODULES.md` + `git commit -m "docs/MODULES.md: regenerate after merging <branch>"`; then
     `node scripts/module-map.cjs --check` → "актуален" (nothing may stay staged before the push).
   - `node scripts/syntax-test.cjs`; `node scripts/xss-test.cjs` when js/ or api/ text output changed
   - full `node scripts/ci-run.cjs` once at the end, under the lock (the run gets its own token; while it runs every other heavy
     job, yours included, is busy):
     `node E:\d37-core\scripts\heavy-lock.mjs run --session site --job "site full CI" --min 15 -- node scripts/ci-run.cjs`
   - open each changed game once in Chrome (headless e2e or the built-in browser; never click export / download buttons).
6. `git status --short` shows nothing staged or modified that belongs to the merge; `git log origin/main..main --oneline` lists the
   merge and the map commit. `git push` (main = deploy to Vercel). Then check prod: `curl -s https://dan4ik37.vercel.app/<changed
   file> | head -c 300` (or fetch with `cache: 'reload'`) shows the new content; GAMES_VER on prod == the merged value;
   `curl -s -o /dev/null -w "%{http_code}" https://dan4ik37.vercel.app/.claude/skills/d37-merge/SKILL.md` → 404 (.vercelignore).
7. Board: docs/TASKS.md row (✅ only at SAME_SCENARIO_CHECKED + on prod), docs/progress.md one line per take/skip decision; shared
   engine rows go to E:\d37-core\spec\BOARD.md. Short Russian report to the owner: result first, one command per code block.
8. Clean up: `git worktree remove .claude/worktrees/<name>` and `git branch -d <branch>` once merged.

Never `git add -A` (the root holds an unrelated Electron project and untracked Codex notices); stage paths explicitly.
