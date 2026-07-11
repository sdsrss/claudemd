# bash-readonly-skip.test.sh — per-case env binds to `echo`, not the hook

Found by the v0.37.1 pre-tag review (2026-07-11), pre-existing, not release-blocking.

`BASH_READONLY_FAST_PATH=1 echo "$EVENT" | bash "$HOOK"` (lines ~72/78/85/91/108/115)
binds the assignment to `echo`; the hook never receives the flag. Cases 25-28
currently pass only because the flag defaults to ON since v0.20.0 and the chosen
commands are silent either way.

Fix shape: move the assignment across the pipe — `echo "$EVENT" | BASH_READONLY_FAST_PATH=1 bash "$HOOK"`
(or `env VAR=1 bash "$HOOK"`), then verify the OFF-path case actually flips behavior
(a readonly command should bypass the fast-path and hit full scan when =0).
