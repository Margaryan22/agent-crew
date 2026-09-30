#!/usr/bin/env bash
# Seeds the workspace with the contract's golden .crew/ folder (phase tasks, E-002 open).
set -euo pipefail
cp -R "$(dirname "$0")/fixture/.crew" .
