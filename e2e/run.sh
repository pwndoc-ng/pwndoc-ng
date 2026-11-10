#!/usr/bin/env bash
# End-to-end tests of pwndoc-ng in a real browser (Playwright), in an isolated Docker stack.
#
#   e2e/run.sh [options] [playwright arguments]
#
# Options:
#   --known-bugs   also run the tests of the known bugs (marked "fixme" by default): they fail until the bug is fixed
#   --keep         keep the stack running at the end (debug: docker compose -p claude-e2e -f e2e/docker-compose.e2e.yml ...)
#   --no-build     reuse the images built by a previous run
#   --rmi          also remove the images built for the tests (claude-e2e-*) at the end
# Environment:
#   E2E_PROJECT      compose project name (default claude-e2e): stacks with different names can run at the same time
#   E2E_REPORTS_DIR  report directory, relative to e2e/ (default reports)
# Playwright arguments, e.g.: tests/04-audit.spec.js -g "rich edition" --repeat-each 3
#
# Steps: build of the images from the sources, empty stack started (project claude-e2e: no published port, no fixed
# container name, own network and volumes), Playwright run in its container on the network of the project, report in
# e2e/reports (html/index.html, junit.xml, results.json, traces and videos of the failed tests), then
# `docker compose -p claude-e2e down -v` (containers, network and volumes removed).
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="${E2E_PROJECT:-claude-e2e}"
case "$PROJECT" in claude-e2e*) ;; *) echo "E2E_PROJECT must start with claude-e2e" >&2; exit 2 ;; esac
export E2E_REPORTS_DIR="./${E2E_REPORTS_DIR:-reports}"
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.e2e.yml --profile test)
IMAGES=(claude-e2e-mongodb claude-e2e-backend claude-e2e-frontend claude-e2e-playwright)

KEEP=0
BUILD=1
RMI=0
export E2E_RUN_KNOWN_BUGS=
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --known-bugs) export E2E_RUN_KNOWN_BUGS=1 ;;
    --keep) KEEP=1 ;;
    --no-build) BUILD=0 ;;
    --rmi) RMI=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

# Files written in e2e/reports with the identity of the user running the script
export E2E_UID="$(id -u)" E2E_GID="$(id -g)"

cleanup() {
  if [ "$KEEP" = 1 ]; then
    echo "Stack kept: E2E_REPORTS_DIR=$E2E_REPORTS_DIR ${COMPOSE[*]} down -v"
    return
  fi
  echo "== Removal of the stack (containers, network, volumes)"
  "${COMPOSE[@]}" down -v --remove-orphans
  if [ "$RMI" = 1 ]; then
    echo "== Removal of the images"
    docker image rm "${IMAGES[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

START=$(date +%s)
rm -rf "$E2E_REPORTS_DIR"
mkdir -p "$E2E_REPORTS_DIR"

echo "== Stack of a previous run removed (empty database)"
"${COMPOSE[@]}" down -v --remove-orphans

if [ "$BUILD" = 1 ]; then
  echo "== Build of the images"
  "${COMPOSE[@]}" build
fi

echo "== Start of the stack"
"${COMPOSE[@]}" up -d --wait --wait-timeout 600 mongodb backend languagetool frontend

echo "== Playwright tests"
set +e
"${COMPOSE[@]}" run --rm -T playwright npx playwright test ${ARGS[@]+"${ARGS[@]}"}
STATUS=$?
set -e

echo "== Report: e2e/${E2E_REPORTS_DIR#./}/html/index.html"
echo "== Duration: $(( $(date +%s) - START )) s"
exit "$STATUS"
