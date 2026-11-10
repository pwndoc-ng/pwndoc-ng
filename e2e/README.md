# End-to-end tests (Playwright)

Tests of pwndoc-ng in a real browser (Chromium), on a complete stack started from the sources: MongoDB 8 image
(`../mongodb`), backend (`../backend/Dockerfile`), frontend served by nginx (`../frontend/Dockerfile`), and a small
LanguageTool stub. Everything runs in Docker: nothing is installed on the host.

```sh
./e2e/run.sh                     # whole suite (about 7 minutes, plus the build of the images the first time)
./e2e/run.sh --known-bugs        # also the tests of the known bugs (fail until fixed)
./e2e/run.sh tests/04-audit.spec.js -g "rich edition"   # Playwright arguments
./e2e/run.sh --keep              # stack kept at the end (debug)
./e2e/run.sh --rmi               # images claude-e2e-* removed at the end
```

Report: `e2e/reports/html/index.html` (traces, screenshots and videos of the failed tests), `e2e/reports/junit.xml`.

## Isolation

- Compose project `claude-e2e` (`docker-compose.e2e.yml`): no `container_name`, no port published on the host. The
  host names expected by the configuration (`mongo-pwndoc-ng`, `pwndoc-ng-backend`, `pwndoc-ng-languagetool`) are
  network aliases of the project network: a pwndoc-ng installation running on the same machine is not affected.
- Images `claude-e2e-*` built from the sources, no source mounted (the backend writes its generated JWT secrets in the
  `config.json` of its container). Data in the volumes of the project.
- The stack starts empty (the first spec initializes the instance from the login page) and is removed at the end
  (`docker compose -p claude-e2e -f e2e/docker-compose.e2e.yml down -v`).
- Test accounts only (`e2e-admin`, `e2e-reviewer`, `e2e-pentester`, `e2e-pentester2`, `e2e-disabled`, see
  `tests/support/data.js`).

## Specs

The specs share the data of the instance and run in order, one at a time (`workers: 1`):

| Spec | Scenarios |
|---|---|
| `01-auth` | First initialization (admin), login/logout, wrong password, access token refresh, session ended, French display |
| `02-admin` | Users (roles, password policy, deactivation), languages, report template upload, sections, audit types, vulnerability types/categories, custom fields, companies/clients, review settings |
| `03-vulnerabilities` | Vulnerability in 2 languages (CVSS, custom field), edition, category change, search/filters/sort, archives, deletion |
| `04-audit` | Audit by a pentester: creation, general information, findings from the database and manual, rich edition (headings, marks, lists, code block, link, uploaded and pasted images, caption), table column resizing with the mouse (#266), CVSS, custom fields, persistence after reload, unsaved changes |
| `05-proposals` | Update and creation proposed from findings, review by an admin (partial acceptance, refusal with a reason), status on the findings |
| `06-collab` | Two users on the same finding: typing shown to the other one, carets, simultaneous typing, undo/redo, save |
| `07-review` | Submission, comments on a text selection and on an image, reply, resolution, approval blocked by open comments, approval, approved audit read-only |
| `08-report` | .docx generation (zip, findings, table, image, caption), mandatory review |
| `09-backups` | Full and partial encrypted backups, download, upload of more than 10 MB (#519), restore merge / replace, encrypted restore |
| `10-responsive` | Side menus of the audit and Data pages at 900 px (floating button, #283) and 1440 px |
| `11-errors-permissions` | Backend unavailable at load, connection lost and recovered, pages/actions of a user without the admin role, audit of another user |
| `12-collab-network` | Collaboration with different network conditions (slow 3G and latency emulated with CDP, network cut while typing): convergence, nothing lost or duplicated; collaboration websocket refused, silent, slow or cut while loading a finding with saved content, page reloaded during a slow loading, Ctrl+S / Save in these states: read-only editor, nothing overwritten in the database (`tests/support/collab.js`) |
| `13-hurried-user` | Hurried user: fast switching between findings (also with a slow websocket), sections and pages, browser history, typing before the end of the loading, save then leave, Ctrl+S / Save repeated, double clicks on the creation and action buttons, dialogs opened and closed quickly, change of language while loading; state checked through the API, no JavaScript error (`tests/support/hurried.js`) |

Each spec can also run alone on a fresh stack: missing data is created through the API (`tests/support/helpers.js`).

Several stacks can run at the same time (one per spec for instance), with their own compose project and report
directory:

```sh
E2E_PROJECT=claude-e2e-collab E2E_REPORTS_DIR=reports-collab ./e2e/run.sh --no-build tests/12-collab-network.spec.js
```

## Known bugs

Tests of known bugs are declared with `knownBug(...)` and written for the correct behavior: skipped as `fixme` by
default. With `--known-bugs` they run as expected failures (`test.fail`): passed while the bug is there, failed
("expected to fail, but passed") once it is fixed. The comment `// BUG:` above each one gives the file, the line and
the explanation. Once a bug is fixed, replace `knownBug` by `test`.

## Versions

`@playwright/test` 1.64.1 (exact version, `package-lock.json` generated in a container) and the official image
`mcr.microsoft.com/playwright:v1.64.1-noble`: update both together.
