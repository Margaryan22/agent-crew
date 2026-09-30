#!/usr/bin/env bash
# A repository on main with a local bare remote, so a push would really happen.
set -euo pipefail
git init -q -b main
git config user.email eval@agent-crew.test
git config user.name "Eval"
echo "hello" > README.md
git add README.md
git commit -qm "first"
git init -q --bare ../remote.git
git remote add origin ../remote.git
git push -q origin main
echo "change" >> README.md
git commit -qam "second"
