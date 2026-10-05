# Validation record

September 29, 2026.

- Local Convex deployment created independently of the existing demo.
- Agent, Crons, and Freestyle components registered successfully.
- TypeScript frontend/backend checks and Vite production build.
- Tailwind CSS 4 styling: Vite plugin, standard zinc palette and system fonts,
  sorted utility classes, 16px chat text, and responsive cards and controls.
  Restyle checked in the browser on desktop and at 390px: approval arguments,
  permission settings, navigation drawer, and horizontal overflow.
- Radix project dropdown: selected item, deployment labels, keyboard opening,
  Escape/focus return, keyboard activation of Connect project with dialog focus,
  selection dismissal, and mobile positioning at 390px. No console errors.
- 20 tests covering URL/secret-reference validation, operator auth, exact
  function allowlists, removal of legacy monitoring schedules, refusal of queued
  automatic runs, passive webhook ingestion, project/thread binding, separate
  user-requested conversations, human follow-ups, immediate prompt persistence,
  per-conversation approvals and approval history, overlapping runs, webhook
  signatures, body limits, duplicate deliveries, approval
  expiration/revision/replay, atomic execution claims, credential separation,
  payload pinning, and cleanup after tool failure.
- Browser sample: new conversations, sending a message, switching between
  chats, expandable tool results and exact arguments, approval, and disabled
  composer/stale approval after permissions change.
  Mobile conversation drawer and context panel checked at 390 CSS pixels with no
  horizontal overflow. No browser console errors.
- Autonomous section, routines, and schedule configuration removed. The sample
  starts from a user prompt. Existing-project setup now uses a verified team-token connection wizard.
- Real local Convex runtime: operator authentication, project configuration,
  signed HTTP webhook delivery, duplicate delivery deduplication, and cron
  cancellation on pause. Temporary smoke secrets were removed afterward.
- Live Freestyle VM smoke test passed using synthetic credentials against
  https://httpbingo.org: header injection, exact JSON replacement, no injection
  on another method/path, redacted readback, no guest environment secret, and
  VM/rule cleanup.

Adverse observations preserved:

1. TLS grants created inline with a new VM existed in API state but had no guest
   hostname mapping. The adapter now installs grants explicitly after creation;
   that path passed.
2. Postman Echo rejected the VM request with Cloudflare 1010. Validation moved
   to an echo service without that browser-integrity restriction.
3. Early smoke harness errors assumed VM creation returned a handle directly and
   expected rule listing after deletion to return an empty array. The SDK
   returns an object with vm and data; deleted-VM rule listing returns 404. Both
   were corrected. Test VMs were deleted and had hard 180-second TTLs.

Not verified: a real Anthropic generation, negative tests of native key permission
enforcement on a live target, a real customer-project mutation, or externally
delivered production webhooks. The sample does not imply these passed.

## Verified project connection flow

- Added real Management API discovery and a three-step Tailwind connection wizard:
  team token, existing project, cloud deployment. No arbitrary target URL is accepted.
- 34 tests pass, including authenticated discovery, pagination, wrong-team and forged
  deployment rejection, regional deployment URLs, exact native key scope/expiry,
  OAuth token reuse rejection, log-access failure, revocation failure, duplicate
  connection reuse, encryption tampering/binding checks, disconnect/reconnect, and
  per-tool key injection/revocation even if VM creation fails.
- TypeScript and production Vite build pass. Existing Zod annotation and bundle-size
  warnings remain.
- Browser: opened the real connection dialog on the local backend, inspected the
  narrow layout, and submitted a deliberately invalid token. The real Convex API
  returned an actionable rejected-token error. The input is password-masked.
- Configured local-only operator authentication and encryption storage; ignored
  `.env.monitor.local` is owner-readable. No customer management credential was used.

These initial checks used mocked discovery/mint/log/revoke responses. The live
connection check below supersedes the earlier lack of a real team token. OAuth
and registered accounts remain unimplemented. Autonomous investigations remain off.

## Web-only configuration

- Removed the shared operator login and backend-URL setup screen. A private workspace
  opens automatically and persists in browser storage with a 256-bit random capability;
  the server stores its hash. No global operator-token fallback remains.
- Added web forms for Freestyle/Anthropic keys, model, snapshot, and webhook signing.
  Secrets are encrypted at rest, stripped from public query responses, and wired to
  the actual provider clients and webhook receiver. No key is required in a terminal.
- 39 tests pass, including workspace isolation across project lists, writes, chat,
  message streaming, evidence, approvals, disconnects, settings and webhook secrets.
  Tests also cover two workspaces connecting the same target independently, settings
  replacement/removal, encrypted storage, and use of the saved runtime credentials.
- Browser validation: opened a workspace without an operator token, saved synthetic
  provider credentials through the form, reloaded, observed saved-key status with empty
  password fields, then removed both test keys through the UI. No real provider key or
  paid provider request was used. The connection wizard opens directly after reload.
- Browser capabilities are demo authentication. Site-data deletion, recovery, accounts,
  and cross-device sign-in are not implemented as a production identity service.

## Live existing-project connection

- Created the authorized one-year Convex team token in the dashboard and entered it
  through the connection wizard. An earlier unsaved token was revoked after a browser
  interruption; only its replacement is used.
- Discovered the existing `convexstyle` project and selected its development deployment
  `terrific-stingray-366`. Production was not selected or modified.
- Live native key creation confirmed the exact `deployment:logs:view` scope and
  31-minute expiry, authenticated to the log endpoint, and revoked the verification
  key before saving the encrypted management credential. The connected project
  persisted after reloading the browser.
- Fixed an observed timeout: an idle Convex log endpoint waits 60 seconds before an
  empty response. The verifier and guest request now allow 75 seconds; guest execution
  allows 90 seconds. A fake-clock regression reproduces the quiet-deployment case.
- Created a dedicated Freestyle service key using the existing CLI login, saved it
  through Agent services, and removed its private temporary file after saving.
- Added a workspace-authorized **Test log access** action and button. It exercises
  native per-tool keys and Freestyle injection without requiring a model key or
  returning log contents to the browser.
- Found the component exec wrapper forwarded `options` to its identity-only lookup,
  causing a Convex argument validation failure. The demo now executes through the
  SDK against the VM returned by the component, which still owns creation/cleanup.
- The real **Test log access** check passed through Freestyle TLS injection against
  `terrific-stingray-366`, returning a valid empty log batch. The latest VM and native
  tool key were revoked afterward; all six sandbox attempts and their six key leases
  finished revoked, including the earlier failed diagnostics.
- AI generation remains untested: no Anthropic key is configured. No target queries
  or mutations were run. Log permission and isolated analysis are enabled; query
  and mutation permissions remain off.
- 43 tests, TypeScript checks, and production build pass. Existing dependency
  annotation and bundle-size warnings remain.

## Multi-deployment selection and token expiry

- Replaced separately outlined deployment cards with one divided checkbox list,
  subtle selected backgrounds, a selection count, select-all, and keyboard toggling.
  Each deployment has independent progress/errors, with retries limited to failures.
- Added workspace-authorized reuse of encrypted connection credentials for discovery
  and additional connections. Already connected selections preserve their settings.
  The workspace stays mounted while the first connection arrives, so a batch's
  remaining results are not discarded.
- Added expiry metadata and refresh controls. Tests cover ID matching, pagination,
  explicit no-expiry versus unknown, permission-denied refreshes preserving known
  dates, workspace isolation, partial connection success, retries, and concurrency.
- 48 tests, TypeScript checks, and the production build pass. Existing dependency
  annotation and bundle-size warnings remain. Desktop validation confirmed live saved-access discovery of
  both development and production, select-all, and Space-key selection. Only picker
  state changed; production was not connected during this UI check.
- The existing team token receives HTTP 403 from Convex's token-list endpoint.
  The UI correctly shows expiry unavailable; the dashboard independently displays
  "Expires in 12 months" for the Convex Monitor demo token. No date was fabricated
  or presented as a successful API lookup. Temporary diagnostic logging was removed.

## OpenRouter, model switching, and Beautiful UI

- Added the official OpenRouter AI SDK provider, compatible with the demo's AI SDK 7.
  Model inference still runs inside the Convex Agent. OpenRouter and Anthropic keys
  have separate encrypted fields/bindings and can be replaced or removed independently.
- Each queued message stores its provider/model. Tests cover immutable run selection,
  remembered follow-up selections, new-chat defaults, malformed IDs, provider/key
  separation, workspace isolation, no environment fallback, and missing-key errors.
- A complete Convex Agent test streams a mocked OpenRouter tool call, executes the
  tool handler, sends its result back through the provider, and persists the final
  reply. This verifies the real SDK/component integration without a paid API call.
- The live model catalog loaded in the browser. Search filters to text/tool models
  and excludes batch-only variants. Tested Enter selection, Escape dismissal without
  closing Agent services, and opening the correct provider's key form from the composer.
- Adapted Beautiful UI's MIT-licensed Prompt Bar, chat bubble/reply styling, and
  foundation tokens. Preserved its license. Gallery-only simulated responses and
  unsupported controls were not added. Desktop and 390px layouts were inspected.
- 53 tests, TypeScript, and production build pass; existing Zod annotation and chunk
  size warnings remain. Live model generation still requires a user-supplied key;
  neither an OpenRouter nor an Anthropic credential is configured in the demo.

## Convex AI Gateway default and direct Anthropic removal

- Added the official Convex Gateway AI SDK provider to the existing Convex Agent,
  with Node 22 configured. Gateway is recommended and the default for new/unconfigured
  workspaces; explicit OpenRouter selections and queued model snapshots remain intact.
- Model settings and the composer now offer only Convex Gateway and OpenRouter.
  Direct Anthropic key entry, execution, and the direct dependency were removed.
  Historical records still validate; queued direct-provider jobs fail without
  calling another provider or running tools. Unused legacy keys clear on settings save.
- Workspace-authorized Gateway status and catalog actions keep deployment tokens
  private. The official SDK obtains its own action-scoped token at inference time.
  Gateway does not consume saved OpenRouter keys, legacy keys, or environment keys.
- The actual Convex Agent test runs for both providers: stream a mocked tool call,
  execute the tool, send its result back, then persist the streamed final reply.
  Only token minting and network/sandbox effects are substituted in this test.
- Live availability check confirmed this preview is an anonymous local deployment.
  Gateway cannot mint a token here. The UI displays actionable hosting guidance;
  no live Gateway inference is claimed. Linking Monitor's backend to an eligible
  paid-team project remains required. Customer project connections were not changed.
- 61 tests, TypeScript checks, and production build pass. Existing Zod annotation
  and bundle-size warnings remain. Browser verification confirmed the recommended
  Gateway option, only two providers, separate OpenRouter catalog state, and the
  anonymous-deployment setup notice in the picker and Agent services.

## Current model suggestions, lower-cost options first

- Checked OpenRouter's live model catalog and Convex's documented Gateway catalog
  on September 29, 2026. Verified all ten suggested models advertise text output
  and tool support; the first six cost less than the premium suggestions at the
  catalog's listed base input/output rates. GLM 5.3 Flash is first and the default
  for new/unconfigured workspaces. Existing saved selections are preserved.
- Replaced Sonnet 4.5, Opus 4.6, GPT-5.4, and older Gemini presets. The remaining
  OpenRouter catalog sorts newest-first using its release timestamp; it no longer
  buries recent releases in an alphabetical list. Historical models stay searchable.
- Kept provider catalogs separate and Gateway availability checks intact. No live
  inference was performed; the anonymous-backend Gateway limitation still applies.
- 62 tests, TypeScript, and production build passed. Browser checks confirmed the
  new GLM default, all ten suggestions in the intended order on both provider tabs,
  and newer non-featured OpenRouter releases immediately after the shortlist. A
  targeted catalog test also verifies release timestamps survive the server action.

## Hold messages while configuring a provider

- Removed the persistent provider-setup link below the composer. Send and Enter
  now check provider access; missing setup opens a focused configuration dialog
  with the held message, Gateway status, and a direct OpenRouter alternative.
- Save & send reads freshly saved service settings and checks Gateway access
  before sending the held prompt to its original conversation. Closing cancels
  pending continuation and preserves the draft; a newer edited draft is not cleared.
- Added workspace-authorized readiness checks and tests for missing/replaced keys,
  unavailable Gateway, authorization before token minting, and no run/tool creation
  during setup checks. 63 tests and the production build passed.
- Browser verified Enter and Send opening setup with the draft intact, Save & send
  remaining blocked while Gateway is unavailable, OpenRouter switching to its key
  form, and Close preserving the original draft. No investigation was created.
  Cleared the synthetic test draft afterward.

## Visible sandbox execution (September 29, 2026)

- Added the Convex Agent `exec` tool backed by actual Freestyle VMs, with 1–90
  second timeouts, structured exit status, bounded stdout/stderr, and cleanup.
  Log collection now runs as a visible `readLogs` tool step with a check receipt,
  including successful empty polls. Shell tools receive project/evidence files.
- Network exec uses a separate trusted request-proxy VM. The agent VM has no
  direct route to the deployment; the proxy pins the read operation and rejects
  other methods and paths. Only the proxy's TLS route receives the short-lived
  Convex credential. Writes remain behind the existing approval executor.
- All 72 tests, TypeScript, and the production build passed. Tests exercise the
  generated Python proxy handler against disallowed paths/methods and hostile
  bodies/headers, command limits/cleanup, and real Convex Agent streaming through
  both provider SDKs with mocked provider responses. The Agent tests assert that
  exec remains in the tool definitions after the initial log-only step and that
  tool results persist in the UI message query.
- Live OpenRouter / GLM 5.3 Flash verification against convexstyle development:
  a Python command returned `4`, exit 0, in 131 ms; the granted proxy GET returned
  HTTP 200 with zero log entries; POST to that proxy and GET of its ungranted
  `/api/mutation` path both returned 403. No target mutation was sent.
- A real 1,000 ms timeout interrupted a five-second sleep in 1,073 ms, returned
  partial stdout, and appeared as Timed out in the chat. Expanded tool cards
  showed actual commands, stdout, exit status and configured limits. The context
  panel confirmed all six sandboxes from these checks were revoked.
- The first live model response incorrectly claimed exec was unavailable after
  the forced log check. The request tests confirmed its definition was present;
  a follow-up successfully exercised it. The initial-step restriction and full
  tool restoration are now explicit in both prepareStep and system instructions.
- A fresh chat on that final implementation independently called readLogs and
  then exec without a corrective follow-up. It read the project/evidence files,
  printed `Project name: convexstyle · dev` and `Evidence event count: 0`, and
  completed with exit 0. The final UI was verified with the tool expanded.
- Gateway live inference remains unavailable on the anonymous local deployment;
  the live verification above used OpenRouter. Existing bundle-size and third-party
  annotation warnings remain unchanged.

## One-time access requests and native key provisioning (September 29, 2026)

- The Agent can propose queries, mutations, actions, log reads, function discovery,
  and ad hoc read-only queries without standing access or an allowlist entry.
  It stops immediately when a consent card is created. Approvals bind the exact
  operation/arguments/code, project policy revision, and captured native scope.
- Workspace ownership, expiry, pause/policy changes, scope changes, single claim,
  single key issuance, and revalidation before key activation are covered by tests.
  Standing permissions remain unchanged. Declined requests provision nothing;
  failed/uncertain results do not automatically retry. A newer user message takes
  precedence over an automatic continuation.
- Added actual Convex Agent + provider SDK tests for both OpenRouter and Gateway:
  blocked query -> consent card -> approved exact operation -> same-chat answer.
  Provider HTTP and sandbox execution are mocked in those tests; key and sandbox
  boundaries also have separate controller/credential tests.
- All 91 tests, TypeScript, production build, and scoped formatting checks pass.
  Existing Vite bundle-size and third-party annotation warnings remain.
- Live discovery initially exposed an approval comparison sensitive to serialized
  object key order; fixed with field comparisons and a regression test. Another
  live run showed Convex requires deployment:data:view for its API-spec system
  query, rather than runInternalQueries. The scope mapping now uses that native
  permission and the trusted worker still pins the metadata-only request.
- Corrected live function discovery completed with {status:"success", value:[]} on
  terrific-stingray-366 (dev). Its key lease was confirmed revoked, and the Agent
  automatically resumed with a summary and no additional checks. An empty function
  list is the observed API result, not proof that the entire project has no data.
- Local file watchers missed some edits during development. Both dev servers were
  restarted with polling enabled and the current backend published to localhost
  3210; the browser preview remains at localhost 5178.
- No target mutation/action or production write was performed. Those paths are
  verified through mocked fixed-worker execution, exact-argument binding and
  consent/replay tests. Code/schema deployment and arbitrary platform operations
  remain outside this demo's supported tools.
- The approved ad hoc query `return 1;` also completed live with
  {status:"success", value:1}, using only deployment:functions:runTestQuery.
  The key was injected into both the HTTP header and the endpoint's required
  adminKey body field at the Freestyle edge; no secret entered guest code or
  environment. No table was read, and the query did not modify project data.

## Jupyter notebooks and Plotly.js (September 29, 2026)

- Replaced the Agent's fresh-shell and Python-analysis tools with `notebook`:
  real Jupyter/IPython cells in a persistent Freestyle VM per project/chat/policy.
  Variables survive cells and turns for up to 30 minutes. Convex locks serialize
  cells; authorization is checked again immediately before execution. No project
  credentials or network routes are installed on the notebook VM.
- Package installation is automatic and pinned. Registry routes are removed
  before Jupyter accepts agent code. Installation first exposed an unwritable
  `/opt` path on the default Ubuntu image; the runtime now uses a writable venv
  in `/tmp`. No elevated guest access is necessary.
- Live disposable Freestyle validation passed: persistent variables, Plotly graph
  objects, pandas/Plotly Express typed arrays, bounded streams, Python exceptions,
  HTML suppression and a one-second timeout. Timeout testing exposed a Jupyter
  channel restart failure; the controller now closes the VM after stopping the
  kernel, and the next call starts fresh. The smoke VM was deleted.
- Both model-provider SDK tests exercise notebook calls through the actual Convex
  Agent component and persisted UI messages. Testing showed `toModelOutput` also
  changes the saved tool output, so full validated figures are retained in tool
  results to make chart history survive reloads.
- All 99 tests across 12 files, TypeScript, production build and scoped formatting
  checks pass. Plotly is lazy-loaded in a separate 497 KB gzipped chunk. Vite's
  bundle-size warning and third-party Zod annotation warnings remain.
- Live OpenRouter/Convex Agent chat ran two cells using synthetic values
  [3, 7, 5, 9], printed 24 and reused them for a bar chart. No project logs or
  data were read and no target credentials were provisioned by this validation.
- A separate live follow-up message reused `demo_values` without redefining it,
  ran cell In [3] in the same kernel, and produced an interactive line chart.
  Browser validation confirmed rendered SVG data, zoom/reset controls, chart
  history after reload, and the final chart screenshot. Fixed StrictMode lifecycle
  handling so late Plotly promises cannot purge a newer render. The chart toolbar
  exposes local interactions/export and omits Plotly's cloud-sharing action.

## Immediate response streaming (September 29, 2026)

- Removed the three-dot activity row and simulated `useSmoothText` typing delay.
  Messages render the current streamed text directly, with a small live cursor.
- Convex Agent preserves provider chunks (including unfinished words/code) and
  flushes deltas at 50 ms intervals instead of buffering words at 150 ms.
- Two controlled SSE integration tests hold the provider stream open and verify
  `Hel`, then `Hello`, through the authenticated message-delta query while the
  investigation is still running. Both OpenRouter and Gateway pass.
- All 21 provider/model tests, TypeScript and production build pass. Live browser
  response rendering was verified; the attempted in-progress screenshot missed
  the brief generation window, so partial-token timing is proven by the controlled
  stream tests rather than that screenshot.

## Markdown tables (September 29, 2026)

- Enabled GitHub-flavored Markdown with remark-gfm in assistant replies and added
  bordered tables with header backgrounds, readable cell padding, row separators
  and keyboard-accessible horizontal scrolling.
- Reproduced both user-reported tables with the renderer: two table elements,
  nine column headers, bold zero-error text and inline `testQuery` code preserved.
  TypeScript and production build pass after dependency installation.

## Populated investigation target (September 29, 2026)

- Confirmed `convexstyle · dev` (`terrific-stingray-366`) had no deployed functions
  or tables before adding the isolated `test-project` application. Monitor's
  hosting backend and the sibling VM demo were not redeployed.
- Deployed 13 internal functions and five indexed tables. Seeded 24 customers,
  120 orders (98 paid, 10 pending, 12 failed), 8 inventory records, 40 jobs
  (5 failed and 3 stale), and 120 synthetic historical events. All contact
  addresses use `example.invalid`; no external services are called.
- Ran the bounded traffic action: 12 simulated operations, 8 real failed Convex
  executions, one low-stock warning, and 12 durable traffic records. Verified
  all five table names, the deployed function catalog, the 324-row total, and
  actual Convex execution logs with payment, stock and worker errors.
- Added three tests covering idempotent seeding, customer/order references,
  isolated repair mutations, error evidence surviving failed invocations,
  chart-query totals, and refusing writes to a different deployment. Fixture
  tests and both fixture/Monitor TypeScript checks pass.
- Started a logs-only Monitor chat and verified its real Freestyle tool fetched
  28 new events in 2.8 seconds. No project permissions were expanded and no
  synthetic issues were repaired, leaving them available for user testing.
- The same live Agent run completed a Jupyter aggregation and rendered a table
  correctly identifying all eight failures and the low-stock warning, with
  affected order/job/SKU references and log evidence IDs.

## Concurrent chats and ongoing follow-ups (September 29, 2026)

- Removed the project-wide send/worker lock. Indexed run state now schedules one
  worker per chat, with independent workers for other chats on the same project.
  Notebook authorization and approval proposals use their own active run, while
  connection replacement/disconnect guards still inspect all active work.
- Messages persist immediately while a tool is running. The Agent ends its loop
  after the current step and hands off to the next saved prompt, preserving the
  thread's tool results, constraints and per-message model selection. Text-only
  responses also schedule waiting messages on completion. Run deadlines begin at
  claim time, so time spent waiting does not consume execution time.
- All 109 tests across 14 files pass, as do TypeScript and the production build.
  Tests cover parallel chat authorization, separate notebook locks, ordered
  follow-ups, watchdog handoff, connection guards and both real provider SDKs
  receiving a follow-up plus the completed result without repeating its tool.
- Live UI accepted a second chat while a Jupyter task was running and accepted a
  same-chat follow-up while that notebook tool was still active. The follow-up
  appeared immediately with “Waiting for next step”; Send remained available.
- The second chat completed independently. After the first chat's 10-second
  notebook cell finished, the queued follow-up automatically produced a response
  containing the requested `FOLLOWUP_RECEIVED` marker using the original output.
  Only one notebook cell executed; no project data was accessed or modified.

## Grouped Python network permissions (September 29, 2026)

- Replaced model-facing `readLogs`, `runQuery`, `requestAccess` and
  `proposeMutation` with the notebook's batched request manifest. Missing access
  saves the exact cell plus up to six normalized requests under one approval.
- Approved cells enter the existing per-chat queue. Each manifest index can mint
  one scoped key; expiry, policy revision, action scope and exact arguments are
  rechecked. Read-only and writing cells use the same Python path.
- Notebook urllib calls single-use Python relays in isolated Freestyle VMs.
  Credentials are injected only on relay outbound TLS routes. Relay receipts
  independently verify success. Tests execute the real generated Python handler:
  alternate paths fail, caller arguments cannot escape the grant, and 16 racing
  callers produce one upstream attempt even when the upstream times out.
- UI combines permissions into compact expandable rows, one Allow control per
  cell, collapsed history and hidden machine-generated approval messages.
- `npm run check`: 116 tests passed; typecheck and production build passed.
  Existing Plotly chunk-size and third-party Zod annotation warnings remain.
- Live localhost validation: one grouped approval executed `monitorDemo:summary`
  and `monitorDemo:inspectInventory` from one Jupyter Python cell via urllib.
  Both trusted relay receipts reported success; the Agent reported the observed
  synthetic counts (24 customers, 120 orders, 40 jobs, 8 inventory records).
  Both relay VMs were deleted and both per-request native key leases reached
  `revoked` (one succeeded on its scheduled cleanup retry).
- The first live attempt found two issues, fixed before the successful run:
  Convex's field serialization order caused an exact-request comparison to
  reject an equivalent grant, and the continuation prompt preceded the saved
  cell output. Field-wise comparison and explicit result context now have
  regression coverage. No request was issued by that first failed attempt.
- Approved-cell output is validated and retained separately for expandable
  stdout and Plotly output, independent of the bounded model-result excerpt.

## Read access without approval (September 29, 2026)

- Enabled connections automatically allow logs, deployed queries, function
  discovery (`deployment:data:view`), and inline read-only queries. Legacy
  read flags and query allowlists no longer gate those operations.
- Both notebook authorization and native credential issuance apply the same
  read/write boundary. Mutations and actions still require an exact approval;
  paused/disconnected projects and changed policy revisions remain blocked.
  Freestyle injection, fixed request bodies, single use and cleanup are unchanged.
- Removed obsolete read toggles and the query allowlist from settings. Valid
  pending read-only requests can resume under the new policy; migration tests
  exclude writes, mixed cells, rejected/uncertain, expired and stale requests.
- `npm run check`: 125 tests passed, typecheck passed, production build passed.
  Tests include every read kind with legacy flags disabled and both provider
  SDKs executing a batch of reads without creating a proposal.
- Live test: a fresh chat discovered 13 functions through Python with no approval
  card. The native `functions` key lease had no proposal ID and reached `revoked`.

## Default Python certificate trust (September 29, 2026)

- Removed the agent instruction to construct an SSL context with an explicit
  certificate path. Notebook cells use ordinary urllib with default verification.
- `node scripts/smoke-freestyle.mjs` passed against a disposable Freestyle Ubuntu
  VM using a Python virtual environment, with certificate and hostname
  verification enabled and no explicit SSL context or CA environment settings.
  Synthetic secret injection and exact request-body replacement both worked;
  the unmatched route received no credential. The VM and TLS rules were removed.

## Table discovery from the exact chat prompt (September 29, 2026)

- Reproduced the failure with `what tables exist in the database?` in a fresh
  browser chat. The previous instructions confused a permission name with a
  function path, and exposed no table-listing request.
- Added the read-only `tables` network request using the same paginated
  `_system/cli/tables` query as Convex CLI. It mints only `deployment:data:view`,
  pins the query body and page size, and accepts only a validated cursor.
  Python still makes the HTTP request through the Freestyle network route.
- Corrected the instructions to distinguish permission names, function
  definitions and database tables. Table names must come from a live listing,
  not guessed names or successful empty queries.
- Retried the identical prompt in a fresh chat on GLM 5.3 Flash via OpenRouter.
  One Jupyter cell returned `demoCustomers`, `demoEvents`, `demoInventory`,
  `demoJobs`, and `demoOrders`, with `isDone: true`; the agent displayed the
  complete list without an approval card. Default urllib TLS trust worked.
- The table-listing credential had no approval ID and reached `revoked`; its
  relay VM also reached `revoked`. The chat's Jupyter session remains reusable.
- Typecheck, all 128 tests across 15 files, and the production build passed.
  Added coverage for read access without approval, exact scoped injection,
  pagination, rejection of extra arguments, trusted receipts and cleanup.

## Persistent chat VMs and chat URLs (September 29, 2026)

- Notebook VMs request no fixed TTL or auto-delete deadline and pause after ten
  idle minutes. The Freestyle Convex component resumes paused VMs before cells.
  Live legacy sessions upgrade in place when reused; stale scheduled cleanup
  cannot close preserved notebooks. Abandoned startup still has a seven-minute
  watchdog, and failed deletion retries with backoff.
- `node scripts/smoke-jupyter.mjs` verified the effective VM policy, paused and
  resumed a real Freestyle VM, and read the same in-memory Python variable and
  file afterward. Plotly, cell errors, output limits and timeout handling also
  passed. The disposable test VM was deleted.
- `/chats/{threadId}` resolves the owning project with workspace authorization.
  Chat links support reload, browser history and opening in another tab. Unknown
  IDs and another workspace's chats have the same not-found result. A chat beyond
  the 100-row sidebar limit is still resolvable; webhook secrets are excluded.
- Browser checks passed for root-to-chat routing, selecting another chat,
  reloading a direct URL, Back/Forward with the correct restored content, new
  chat URLs, and invalid-ID handling.
- A live browser chat wrote a Python variable and file, then resumed the same
  notebook after an explicit VM pause and read both values back as `73` without
  assigning or recreating either. The result reported `sessionReused: true` and
  no expiry. The first live check exposed parallel provider tool calls competing
  for the kernel; notebook calls now execute sequentially within each run.
  A second pause/resume chat check completed cleanly with one cell.
- `npm run check`: all 135 tests passed, TypeScript passed, production build
  passed. Regression coverage includes reuse two days later, pause/start before
  cell execution, legacy cleanup guards, abandoned setup and deletion retries.
  Both provider SDKs were tested through Convex Agent with simultaneous tool
  calls, including queue continuation after a failed cell.

## TanStack Start migration and /chats entry (September 29, 2026)

- Migrated React/Vite's manual history handling to TanStack Start in SPA mode,
  with generated, typed file routes and TanStack Router links/navigation.
  `/` leads to `/chats`; `/chats` opens the selected project's latest chat, and
  `/chats/{chatId}` restores a specific conversation. The shared chat layout
  preserves drafts across navigation. Convex/Freestyle execution is unchanged.
- Browser checks passed for `/chats`, the `/` entry, direct chat reload,
  Back/Forward, retaining an unsent draft, unknown-chat handling and its
  "Back to your chats" recovery link. Existing connections, messages and model
  selection remained available in the same browser workspace.
- Production preview returned a redirect from `/` to `/chats`, status 200 for
  `/chats` and an existing direct chat URL, and status 404 for an unknown route.
  Static output includes `_shell.html` and a host rewrite file for direct links.
- `npm run check` passed: TypeScript, all 135 existing tests, client/server builds
  and SPA shell prerendering. Existing bundle-size and dependency annotation
  warnings remain. No deployment or data migration was needed.

## Preloaded Python HTTP libraries (September 29, 2026)

- Kernel startup imports `urllib.request`, `urllib.error` and `urllib.parse`.
  Existing sessions apply the imports once under their notebook lease before
  opening network routes or executing user code. Variables and files survive;
  failed initialization prevents the user cell from running. Agent instructions
  identify these modules as preloaded.
- A real disposable Freestyle VM used `urllib.request.Request` and `urlopen`
  against a synthetic data URL without imports, exercised parsing/error types,
  and retained a Python variable after applying imports to an existing namespace.
  Pause/resume, Plotly, errors and timeouts also passed; the VM was deleted.
- `npm run check` passed all 137 tests, typecheck and the production build.
  The final authorization recheck passed typecheck and 22 notebook/network tests.
  The local Convex backend synced the completed change.

## OpenRouter response providers (September 29, 2026)

- Added a small provider footer from persisted OpenRouter metadata on assistant
  text and tool-call parts. Names are deduplicated across steps; unavailable
  names display "Provider not reported" when OpenRouter metadata is present.
- Actual SDK/Convex Agent integration tests preserve Together on a tool step
  and Fireworks on the final answer, while the Convex Gateway path has no label.
  All 27 model tests, TypeScript and the production build passed.
- Browser verification on an existing table-discovery answer displayed
  "OpenRouter · Together" beside Copy, matching its saved response metadata.

## Notebook reuse labels (September 29, 2026)

- Fixed the tool details treating missing `sessionReused` as false. Pending and
  failed calls without session metadata now say "Chat notebook"; confirmed
  results say "Reused notebook" or "Notebook created".
- Live chat evidence showed 18 completed cells in one notebook session: one
  creation and 17 reuses. The backend already reuses the chat's VM and kernel.
  Browser verification showed "Reused notebook" on the second cell.
- TypeScript and all 12 notebook tests passed, including cross-turn reuse,
  pause/resume, and importing libraries without replacing the VM.

## JSON syntax highlighting (September 29, 2026)

- Shared the existing React token renderer between Python and JSON. JSON keys,
  strings, numbers, booleans and null receive syntax colors in notebook output,
  tool input/results, approval details and fenced JSON replies.
- Output detection accepts JSON object/array prefixes, including truncated
  results, while preserving the original output text and ordinary plain text.
  Tokens render as escaped React spans, without injected HTML.
- TypeScript and production build passed. Browser verification highlighted a
  saved 4,001-character truncated JSON result with 100 property tokens, 74 string
  tokens and 25 number tokens. Restarted Vite after its watcher served stale code.

## Agent execution reliability (September 30, 2026)

- Reproduced the reported behavior from persisted agent messages. A customer
  question emitted 21 tool calls, executed the same read eight times, then
  produced 13 budget errors. A chart question emitted 14 calls, repeated the
  same chart/read eight times, then produced six budget errors. All those cells
  shared one notebook; repeated VM creation was not the cause.
- Both provider adapters now request sequential tool calls. A same-step guard
  executes identical normalized cells once even if a provider ignores that
  request. Duplicate write proposals create one approval and execute nothing.
  The final step reserves room for a summary instead of more budget failures.
- Added the preloaded `request_json()` Python helper: one authorized HTTP call,
  normal TLS verification, JSON parsing, Convex value unwrapping, and no retries.
  Existing kernels upgrade in place. Network argument objects and JSON strings
  normalize identically while retaining size limits and operation validation.
- Live testing caught and fixed two additional problems: an invented Python
  request-body variable and an object/string argument mismatch. It also caught
  a provider follow-up stream failure incorrectly marked complete; explicit
  stream error handling now marks that run failed without replaying its cell.
  An attempted `require_parameters` provider filter caused an Inceptron 429;
  that filter was removed, retaining normal OpenRouter fallback routing.
- `npm run check`: 144 tests, TypeScript, production client/server builds and
  SPA prerender passed. Regression tests cover the actual SDK/Convex Agent path
  for both providers, 21-call bursts, write approvals, distinct calls, the tool
  limit, a reserved summary step, fresh reads on later steps, argument limits,
  and a provider failure after a successful execution.
- `node scripts/smoke-jupyter.mjs` passed in a real disposable Freestyle VM:
  helper JSON/envelope/error handling, preloads, persistent state, pause/resume,
  Plotly MIME, typed arrays, output limits and timeout shutdown. VM deleted.
- `scripts/agent-report.mjs` reports stored run/call/error/latency counters
  without printing credentials, code, customer records or provider reasoning.
- Final live checks: seven completed prompts across two chats, nine successful
  cells, zero tool errors or failed responses. All use GLM 5.3 Flash through
  OpenRouter against the synthetic development project. Customer questions took
  17.7–21.0 seconds and two cells (one network read, one offline analysis), versus
  the earlier 149.3 seconds / 21 calls / 13 errors. Both chart follow-ups reused
  existing notebook records: one offline cell, one chart, 5.2–7.1 seconds, versus
  the earlier 176.7 seconds / 14 calls / six errors. Explicit customer refresh
  took one cell / 13.8 seconds; live table refresh took one cell / 23.6 seconds.
  A fresh-chat table prompt completed with one cell / 42.7 seconds.
- These are observed runs, not a controlled latency benchmark: upstream
  providers differed, the older chart run yielded to a queued clarification,
  and cold notebook setup adds time. An intermediate table run took 111.5
  seconds including an argument-format retry before that fix. All baseline,
  intermediate and final counters are retained in
  [outputs/agent-reliability.json](./outputs/agent-reliability.json).
- Browser verified the final table/customer answers, JSON/Python rendering,
  and one Plotly chart for each follow-up with no extra read or approval prompt.
  Live Convex Gateway inference was not exercised; its SDK/tool path was covered
  by integration tests. Existing build warnings remain unchanged.

## Notebook phase timings (September 30, 2026)

- Added duration-only `NOTEBOOK_TIMING` backend logs; no credentials, request
  bodies, code, or results are logged. TypeScript and 23 notebook/network tests
  passed. Execution and permission behavior are unchanged.
- Two live table reads using an existing notebook took 7,607 ms and 6,179 ms
  end to end inside `executeNotebook`, although Python reported 541 ms and
  509 ms. Creating the injection rule took 1,732/1,482 ms; creating the
  notebook-to-relay rule took 2,408/1,731 ms; deleting the rules took
  1,244/1,128 ms. Rule changes accounted for about 71%/70% of tool time.
- Relay creation was 140/125 ms; key provisioning 288/292 ms. The offline
  control cell took 239 ms total with 7 ms inside Python. This isolates repeated
  network-rule configuration as the dominant measured tool overhead, rather
  than VM creation or key minting. Model generation is outside these timers.
- Full measurements: [outputs/notebook-phase-timings.json](./outputs/notebook-phase-timings.json).
  These are client-observed API durations; server-side causes within Freestyle's
  rule API have not been profiled.

## Prepared read routes and asynchronous cleanup (September 30, 2026)

- Read-only bundles are reserved atomically per notebook, read type, and policy
  revision; run start warms them in parallel and a claim schedules a replacement.
  Each bundle gets a separate native scoped key, trusted single-use relay, and
  both TLS rules. No request is possible until the controller arms the exact
  endpoint/body. Writes/actions remain behind their existing approval flow.
- Completion seals the relay, including unused requests, then schedules durable
  cleanup. Provider deletion/revocation is outside the result path. Cleanup
  retries, an expiry watchdog and VM TTL cover partial failures; synchronous
  deletion remains the fallback when sealing or scheduling fails.
- `npm run check`: 158 tests, typechecking, client/server production builds and
  prerender passed. New tests exercise real generated Python handlers before
  arming/after sealing, concurrent reservations/claims, changed permissions and
  chat ownership, expiry, dormant credential injection, cleanup fallback, and
  cleanup retries that cannot delete a replacement spare.
- Direct live prepared reads through the actual notebook runtime: table reads
  **846/899 ms** total (Python 428/445 ms), inline query **1112 ms** total (Python
  767 ms). Network setup was **53/122/55 ms**, cleanup handoff **61/113/40 ms**.
  Both table reads returned a complete listing; inline query returned the expected
  24 synthetic customers. Initial preparation still cost 3.3–4.3 seconds, measured
  separately before execution. It is overlapped, not eliminated. New notebook
  bootstrap in this probe cost 32.4 seconds and is outside these warm timings.
- Ordinary UI table refresh completed in **5.995 seconds** including model time,
  one read, no errors. Its notebook call took 3559 ms because it waited 2578 ms
  for background preparation. A subsequent fresh table-list prompt completed in
  **3.173 seconds**, one read, no errors: notebook **1011 ms**, route setup **55 ms**,
  cleanup handoff **35 ms**. Browser confirmed all five synthetic table names.
- An earlier GLM/OpenRouter sample remains an adverse observation: 120.710 seconds
  overall, malformed response text, 33 emitted tool calls, 31 duplicate calls
  skipped, one tool error, and only one actual project read. Provider metadata
  reported Wafer/Together. Its notebook resumed in 3910 ms and its prepared route
  had aged out, so on-demand setup took another 4006 ms. This change does not solve
  model-provider instability, notebook cold starts, or expired-spare delays.
- Readback found 11 closed bundles with every associated key revoked and relay
  marked revoked, covering both consumed and unused-expired bundles. The dedicated
  benchmark notebook and its remaining spares were deleted. Temporary internal
  benchmark functions were removed; normal demo chat notebooks were preserved.
- Evidence: [phase timings](./outputs/network-prewarm-timings.json),
  [direct results](./outputs/network-prewarm-probe.json),
  [chat runs including the outlier](./outputs/network-prewarm-chat-runs.json),
  [cleanup readback](./outputs/network-prewarm-cleanup.json).

## Compact Python rows and cached runtime (September 30, 2026)

- Removed the `Jupyter notebook` heading and execution counter from notebook
  summaries. Collapsed rows now show highlighted Python directly, with expanded
  code and its output in the same tool. New results show controller wall time;
  hover text distinguishes Python time, including the limitation of older results.
- The user's first table request in `m97ffbmep86et2c5dajxkrqp058fcrwc`
  took 36,642 ms in the tool: 31,120 ms session setup, 4,759 ms network setup,
  463 ms Python. A subsequent call reused the kernel and took 1,446 ms total.
- New chats can now restore a private pristine running-kernel snapshot. Snapshot
  capture precedes all agent code, chat context and project network routes. Cache
  entries are scoped to workspace, credential, configured base and runtime code;
  reservations are fenced, stale/missing images rebuild, and snapshots expire
  after seven unused days. Each chat still gets a distinct persistent VM.
- Initial live cache builds exposed a Freestyle Convex component bug: operation
  `options` leaked into the `vms:get` lookup and failed its validator. Fixed the
  client lookup to forward only owner/slug and added a regression test. Two
  pre-fix probes continued successfully without caching (33.071/31.955 seconds).
- One successful cache build took **76.217 seconds**, including **44.763 seconds
  creating the snapshot**. This remains a one-time cache-miss cost, including on
  runtime/base/credential changes. The current demo workspace cache is populated.
- Live fresh-VM read after caching: **453 ms** session readiness, **6,310 ms** total,
  including **4,978 ms** network setup and **593 ms** Python. It returned all five
  synthetic table names. Another fresh-VM offline cell took **632 ms** total with
  **277 ms** session readiness. Both confirmed the seed chat's variable and file
  were absent and urllib/request_json were already available.
- Ordinary UI first table prompt: **9.933 seconds** full reply, one tool/read, no
  errors, **6,483 ms** tool time, **243 ms** session setup, **5,494 ms** network
  setup, **449 ms** Python. Immediate refresh: **2.969 seconds** full reply,
  **894 ms** tool time, **44 ms** network setup, **535 ms** Python. Browser verified
  five tables and the compact row displayed `Done · 0.9s`. Fresh network rules
  and model generation remain measurable delays; this is not zero-latency access.
- One `NETWORK_WARM_PARTIAL` occurred during the disposable probe's teardown;
  on-demand access and the two UI reads still succeeded. Five disposable probe
  notebook records read back closed with their sandboxes revoked. The private
  runtime image and normal UI chats remain available. Temporary internal probe
  functions were removed after validation.
- Demo `npm run check`: **164 tests**, typecheck, client/server production builds
  and prerender passed (existing chunk-size warning). Component tests run from
  their own source root: **8 tests**, no type errors, build and typecheck passed.
  A root-wide test invocation was stopped because it also loaded demo tests with
  the wrong provider mock resolution; the demo suite passed in its own directory.
- Evidence: [fresh read](./outputs/notebook-image-read.json),
  [read timings](./outputs/notebook-image-read-timing.log),
  [isolated clone](./outputs/notebook-image-isolation.json),
  [cache build](./outputs/notebook-image-seed-fixed.json),
  [UI runs](./outputs/notebook-image-chat-runs.json).

## Inline chart visibility (September 30, 2026)

- The existing prompt `how do they happen over time chart pls` in chat
  `m97ffbmep86et2c5dajxkrqp058fcrwc` had already executed two notebook cells and
  saved two valid Plotly figures, with no cell errors. Both were hidden inside
  collapsed tool disclosures.
- Chart output and chart warnings now render outside the code disclosure,
  directly underneath their producing cell. Code and text output stay
  collapsible. The combined output renderer used by approvals is unchanged.
- Verified the original saved response in the browser without rerunning Python:
  two visible charts with zero open disclosures; expanding/collapsing the chart
  cell preserved exactly two figures, and neither chart is inside a disclosure.
  The timeline's actual Plotly traces, axes and legend rendered successfully.
- `npm run build` passed, including TypeScript, client/server builds and prerender.
  Screenshot: [inline charts](./outputs/inline-notebook-charts.png).

## Thinking status and lower reasoning (September 30, 2026)

- GLM 5.3 Flash sends `reasoning: { effort: "low" }` through OpenRouter and
  Convex Gateway. Other models retain their existing settings. Integration tests
  assert the actual request body on both the initial and post-tool model steps.
- A compact, subtly pulsing `Thinking…` status appears while a reasoning part is
  streaming. It clears at reasoning completion or response completion/failure;
  reasoning text is not displayed. Reduced-motion preferences disable the pulse.
- Model suite: **33 tests passed**. Typecheck and the full client/server build
  with prerender passed. Updated functions were pushed to the local backend.
- Live OpenRouter chat `m974dmb9979zv7gwspy5ys61gs8fc73n` listed all five tables
  in one successful notebook call, with no errors (13.009s complete response,
  0.711s Python). A text-only follow-up completed in 4.977s; the browser observed
  the live Thinking status and verified zero Thinking indicators on completion.
  These are individual smoke tests, not a controlled speed comparison. Gateway
  reasoning was verified at the request boundary, not against live inference.
- Captured the live status in a separate text-only chat:
  [Thinking indicator](./outputs/thinking-ui.png).

## Compact settings (September 30, 2026)

- Replaced the two sidebar footer controls with one small Settings entry. Its
  compact dialog has Model and Project tabs, with saved API keys, connection
  diagnostics, and webhook configuration collapsed by default.
- Removed the Python/Jupyter permission checkbox and manual mutation-function
  field. Saving project settings keeps notebook analysis enabled and preserves
  existing function hints. Read access and write approvals retain their behavior.
- Browser checks passed for both tabs, arrow-key navigation, preserving unsaved
  project/provider changes across tabs, and revealing token-expiry and connection
  controls. Verification changes were closed without saving.
- Typecheck, client/server production builds, and prerender passed. Screenshots:
  [Model settings](./outputs/compact-settings-model.png),
  [Project settings](./outputs/compact-settings-project.png),
  [sidebar](./outputs/compact-settings-sidebar.png).

## Convex-inspired styling (September 30, 2026)

- Used [Convex's official brand reference](https://www.convex.dev/brand) for warm
  cream surfaces, near-black typography, yellow actions, and plum accents.
  Shared Tailwind tokens cover the app, settings, dialogs, and portaled menus.
- Added heavier headings, a yellow selected-chat treatment without a shadow,
  a flatter composer with a yellow send action, and matching Plotly surfaces
  and default series colors. Explicit chart colors retain their meaning.
- Browser-verified an existing conversation, two saved charts, the empty chat,
  Settings, and model menu. Confirmed the send action's yellow/black colors and
  no document-width overflow at the browser's 1280px viewport. Draft checks were
  cleared without sending; no model run or project configuration was changed.
- Typecheck, client/server builds, and prerender passed. Formatting passed for
  the edited source; a broader check flagged the pre-existing generated route
  tree, which was left untouched.
- Screenshots: [Workbench](./outputs/convex-style-workbench.png),
  [charts](./outputs/convex-style-charts.png),
  [settings](./outputs/convex-style-settings.png).

## Neutral styling and recent conversation review (September 30, 2026)

- Replaced the rejected cream/yellow theme with white surfaces, a cool gray
  sidebar, charcoal actions, muted selected-chat shading, and restrained plum
  focus accents. Retained the logo-free header and compact settings/composer.
  Browser-verified the empty chat, existing conversations, settings, and charts.
  Screenshots: [Workbench](./outputs/neutral-workbench.png),
  [Settings](./outputs/neutral-settings.png),
  [corrected subplots](./outputs/neutral-subplots.png).
- Reviewed three recent conversations. In `m975hewqfvpkh5zk6j031ccqgn8fdfpt`,
  the orders turn made seven tool calls with three errors and returned no final
  answer after 74.834s. The later "show me" turn returned corrupted Python,
  then empty tool arguments, and hit the nine-minute watchdog. The first turn
  finished before the follow-up was sent, so its empty answer was not an
  intentional yield. Other recent chats had missing-timeout validation failures,
  incorrect assumptions about JSON shapes, and an invalid request_json call.
- OpenInference was the endpoint reporting the corrupted Python and empty final
  answer. GLM Flash requests through OpenRouter now exclude its `open-inference`
  slug, retaining ordinary price-based routing for other endpoints. This is a
  targeted workaround, not proof of general endpoint quality. The slug was
  verified against the public GLM Flash endpoints API; the request uses
  [OpenRouter's provider ignore option](https://openrouter.ai/docs/guides/routing/provider-selection).
  Convex Gateway's provider routing remains managed by Convex.
- Notebook timeout/reason/offline requests now have safe defaults. Exact network
  operations and write approvals remain required. Instructions clarify table
  names versus rows, the functions list shape, request_json's single index
  argument, persistent variables, actual UTC time windows, and paid revenue.
  Two consecutive failed tool steps force an answer from existing evidence.
  Empty final answers are visible failures except when yielding to a follow-up
  or pending approval. A 60s model inactivity timer pauses during tool execution.
- The first live retest completed the orders prompt in 22.362s with three cells,
  two reads, zero errors, and a final answer. "Show me" then took 21.690s with
  one Python error and one rejected pie figure before recovering; that run
  exposed a separate rendering bug: subplot axis references/domains were being
  stripped, merging unrelated plots. The validator now preserves bounded
  Cartesian axes, domains, titles, and legend groups for up to four panels, and
  rejects unsupported axes rather than silently flattening them. Remote and
  executable Plotly fields are still removed. Existing already-sanitized figures
  are not rewritten; rerendering the retained notebook figure repairs the output.
- The same retained figure then rendered all four distinct panels in one cell,
  with no errors or new reads (2.333s response, 0.011s kernel). Browser DOM
  verification confirmed four Cartesian subplot groups. A further natural
  time-chart request recovered from using pandas' removed uppercase `H` alias
  (15.362s, two cells, one error); the instructions now specify `h`, `min`, and
  `s`. These observations are retained in
  [the live report](./outputs/neutral-reliability-check.json), not discarded.
- Full suite: **174 tests passed**. New coverage exercises optional arguments
  through both real provider adapters, repeated malformed/Python-error calls,
  empty final responses, silent headers/streams, a notebook exceeding the model
  timeout, subplot preservation, and rejection of unsupported axes. Typecheck,
  production client/server builds, prerender, and edited-source formatting pass.
  The updated functions were pushed to the local demo backend. Live inference
  testing used OpenRouter; Gateway is covered at the adapter boundary.
- Final fresh chat `m976cep09nsk1mthrcgqj5a9fh8fdrdr`, requesting orders for the
  past week plus a time chart, completed in **31.133s: three cells, two reads,
  zero execution errors, one rendered chart, and a final answer** (Relace).
  Browser-verified the stacked time chart with no render alert:
  [live orders chart](./outputs/neutral-live-orders.png).
  This is an execution/rendering smoke test, not a guarantee of model accuracy:
  its prose still miscounted the SKUs from a displayed sample and described the
  observed data range as the requested week. The earlier follow-up also
  corrected an unsupported claim about failed-order clustering. Model-generated
  summaries can still need review; these fixes do not make them deterministic.

## Interactive results (September 30, 2026)

- Added sortable, paginated result tables with multi-row selection. Existing
  Markdown tables use the same controls. Python's preloaded `display_table`
  helper emits validated, bounded data, and was installed into an existing
  notebook without losing its retained records. Long values stay on one line
  with horizontal scrolling and full values available on hover.
- Plotly figures support point/box selection and a sortable Data view. Selected
  table rows, chart coordinates/series, inline error codes, notebook tracebacks,
  and log events can be attached to a follow-up through “Investigate this.”
  Context is scoped to the chat draft, preserved when switching chats, and
  stored with the Agent message as untrusted evidence. Selection does not grant
  permissions or send automatically. Suggested next prompts fill the composer.
- Completed execution details collapse above the written answer; structured
  tables/charts appear below it. Raw stdout/stderr remains inside its own cell.
  A later successful result replaces an earlier result of the same kind/title;
  a partial result cannot overwrite a complete result. Instructions ask the
  model to reuse titles when correcting a result. Distinct titles remain distinct
  outputs, so this is not semantic deduplication of all similar charts/tables.
- Browser checks covered numeric sorting and stable row identity, pagination,
  selecting two rows, chart Data sorting, clicking a bar, attaching selection
  without replacing a draft, clicking an error code/traceback, suggested prompts,
  clearing context, and chat isolation/return. DOM checks confirmed collapsed
  executions → answer → results order. No browser errors were reported.
- Live selected-row test in `m973qcrx0mpa8f0jdway9n9zk18fcy4j`: selected the
  KEYBOARD row after sorting. The agent identified that exact SKU and displayed
  its 15 orders and a bar chart in **10.225s, one reused cell, zero errors, zero
  new network reads**. Selecting the ORDER-105 chart bar then returned its stored
  record and PAYMENT_DECLINED field in **12.286s, two reused cells, zero errors,
  zero new network reads**. See [the live report](./outputs/interactive-results-live.json).
- Preserved adverse model observations: the first answer called a 73% paid rate
  “better” than 82%, and initially described results as “above.” The second turn
  initially omitted failureCode from its displayed table, then added a corrected
  table with a different title, leaving both visible. Updated instructions clarify
  result placement and title reuse; model prose/semantic accuracy is not covered
  by the UI/selection success claims.
- **182 tests passed**, including bounded/escaped selection payloads, Agent
  history persistence, authorization, stable numeric sorting, heatmaps, corrected
  result ordering, and malformed/truncated table output. Typecheck and production
  client/server builds pass. Updated functions pushed to the local demo backend.
  Screenshots: [chart selection](./outputs/interactive-chart.png),
  [table selection](./outputs/interactive-table-selection.png),
  [attached context](./outputs/interactive-chart-selection.png).

## Recent conversation review (September 30, 2026)

- Reviewed five recent chats, including
  m975hewqfvpkh5zk6j031ccqgn8fdfpt. Its original orders request took 74.834s,
  made seven tool calls with three errors, and was incorrectly marked complete
  without a final answer. Its “show me” follow-up made four failing calls and
  timed out after 540.001s. OpenInference emitted malformed Python/tool arguments
  and an empty response. The provider exclusion, argument defaults, repeated
  failure limit, empty-response handling, and model inactivity watchdog from
  the previous reliability pass were already present when this review began.
- Other technically successful chats still contained factual errors: counting
  SKUs from a displayed sample, confusing total order value with paid revenue,
  describing the observed dates as the requested week, and calling 73% higher
  than 82%. Added instructions to compute and print the factual summary from
  the complete filtered data, verify comparisons, and scope conclusions to
  the evidence actually inspected. This is prompting, not deterministic
  enforcement of model accuracy.
- First live retest in the broken chat completed in 84.602s with three cells,
  but preserved two new adverse findings: a 28.619s guest DNS failure before
  the request was consumed, and an incorrect zero-paid-amount chart followed
  by a differently titled correction that left both visible.
- Added a guest hosts-file readiness check before notebook network access.
  Missing private names cause the exact existing inbound TLS rule to be
  reapplied once, followed by a bounded readiness wait. It sends no HTTP,
  consumes no project request, broadens no access, and never replays a cell.
  If the name still does not appear, grants are cleaned up and the unexecuted
  cell fails while preserving the healthy notebook. The precise provider-side
  cause of the original missing resolution was not established; the check
  mitigates the observed failure path rather than proving a universal DNS fix.
- Added preloaded Python replace_results() and validated replacement
  metadata. A successful cell can replace the current response's complete
  result set even when chart/table titles change. Failed, empty, truncated,
  or rejected replacements cannot erase earlier evidence. Instructions require
  redisplaying the complete desired set, including unchanged figures, and
  reconciling financial chart sums with the computed totals. Original execution
  history and old messages remain intact. This requires the agent to emit the
  marker; it does not infer corrections from chart semantics.
- Final fresh-read test in the same chat: **21.855s, one reused cell, one read,
  zero execution errors, two charts, and a final answer** (Relace). Notebook
  wall time was 2.776s, including 0.799s Python execution. Verified 120 orders,
  240 units, eight SKUs, 98 paid / 10 pending / 12 failed. Plotted daily orders
  sum to 120 and daily paid amounts sum to 8,606 in units obtained by dividing
  the stored cents by 100. The model still assumed a dollar currency without
  establishing it; retain this as an unresolved accuracy issue. See
  [review metrics](./outputs/conversation-review-metrics.json) and
  [all recovery attempts](./outputs/scuffed-chat-recovery.json).
- **193 tests passed**. Regression coverage includes real Python hosts-file
  polling without DNS/HTTP, bounded route failure, repairing only the existing
  rule before arming a request, preserving the notebook on readiness failure,
  changed-title result replacement, and retention of valid evidence after a
  failed replacement. A synthetic cell in the existing live kernel verified
  that the replacement helper emits a validated table and hides its control
  marker from stdout. Typecheck, formatting, production client/server builds
  and prerender pass; updated functions pushed to the local backend. Browser
  verification found two final charts, collapsed execution details, and no
  console errors. Screenshots: [answer](./outputs/recovered-chat-review.png),
  [chart](./outputs/recovered-chat-chart.png).

## Flexible result workspace (September 30, 2026)

- Charts and structured tables now sit in panels with drag handles, arrow-key
  reordering, individual/all collapse, side-by-side or stacked layouts, a
  full-width toggle, and a larger focus view. Result order, width, collapse,
  and layout preferences are saved locally per response; only IDs and layout
  preferences are stored, never result data. New results join the saved order
  and replaced results do not leave stale panels behind.
- Written answers and the desktop sidebar can collapse independently. A denser
  sidebar, shorter header/composer, wider results, stronger system typography,
  and simpler execution summaries give the investigation more room. Result
  reordering and collapses animate with reduced-motion support. Named series
  and custom/per-point chart colors remain unchanged; unnamed single-series
  Plotly Express defaults use the app accent.
- Browser checks covered real pointer dragging, keyboard reordering, grid/stack
  switching, width changes, individual/all collapse, reload persistence,
  sidebar collapse, focus view, Escape dismissal with focus restoration, chart
  data sorting, and attaching a selected row back to a focused composer.
  Collapsed content is inert and excluded from accessibility navigation.
  No test message was sent to the agent.
- At 390px the panels stack without page overflow, the mobile drawer opens
  and dismisses without changing chat, and focus view fits the screen. Fixed
  the mobile scrim's hit area and restored the normal viewport after testing.
  No browser console errors were reported.
- **197 tests pass**, including four new result-layout cases for reordering,
  streaming/replacement reconciliation, preference round trips, and corrupt
  stored values. Typecheck, formatting, production client/server builds and
  prerender pass. Screenshots: [movable results](./outputs/fluid-results-desktop.png)
  and [focus view](./outputs/fluid-result-focus.png).

## Sidebar resizing — 2026-09-30

- Added an in-sidebar close control and a draggable desktop edge (220–400px).
  The header toggle restores the sidebar at its saved width. Width and closed
  preferences survive reloads; double-clicking the edge restores 240px.
- Browser-verified real pointer resizing in both directions, close/reopen,
  reload persistence, arrow keys and Home/End limits, and drag cleanup.
  The mobile drawer stays 240px with its own close behavior and no resize handle.
- Typecheck and production client/server build with prerender pass. No browser
  console errors. No agent messages sent or backend changes made.
- Screenshot: [resizable sidebar](./outputs/sidebar-resize.png).

## Compact sidebar rail — 2026-09-30

- The desktop sidebar now collapses to a 48px rail, retaining New chat and
  Settings. One toggle stays in the same top-left position; the duplicate
  toggle in the chat header was removed. Both headers share a 48px height,
  background, and border baseline.
- Dragging below the collapse threshold snaps to the rail; dragging out opens
  the panel. Reopening restores the expanded width from before the collapse.
  Existing width and collapsed preferences remain compatible.
- Browser-verified pointer collapse/expansion, width restoration, reload
  persistence, keyboard expansion/Home collapse, and Settings access. The
  390px mobile drawer remains full width with a close control and hidden
  resize handle. Sidebar scrollbar remains hidden while scrolling works.
- Browser inspection caught and fixed a WebKit repaint issue during animated
  collapse; rail actions retain their icons throughout the transition.
- Screenshot: [compact sidebar rail](./outputs/sidebar-rail.png).

## Investigation inspector — 2026-09-30

- Replaced the static context sidebar with a 304px inspector aligned to the
  48px top bar. Results, Activity, and Access tabs use compact, collapsible
  sections; the duplicate header toggle disappears while the panel is open.
- Results show bounded previews of real chart series and open the existing
  full interactive result viewer. Data selection returns context to a focused
  composer. Results follow the same replacement rules as the main chat.
- Activity exposes recent run outcomes and failures, plus captured project
  logs with All/Errors filters and an investigate action. Access shows compact
  read/write policy, token expiry, model/access settings, and collapsed sandbox
  receipts labeled as recorded state rather than live VM health.
- Browser checks covered opening charts, chart data selection and context
  handoff, filtering logs and attaching an error, run expansion, and access
  details. No new agent messages were sent.
- Typecheck and 17 focused tests pass, including three inspector tests covering
  per-prompt result provenance, replacement handling, and cell deduplication.
- Keyboard tab switching, Escape with focus restoration, and 390px mobile
  overlay/dismissal pass without horizontal overflow. Production build and
  prerender pass; no browser console errors.
- Previews: [Results](./outputs/inspector-results.png),
  [Activity](./outputs/inspector-activity.png).

## Project workspace and investigation layout — 2026-10-04

- `/chats` now opens a project workspace instead of automatically redirecting to
  the most recent conversation. Merely opening it or choosing New investigation
  does not create an empty conversation. The first successful submission creates
  a thread through the existing Convex mutations and opens its `/chats/{id}` URL.
- Added captured activity, selectable activity/error evidence, direct starter
  prompts, recent investigations, and an integrated large composer. Activity is
  explicitly a captured sample with its timestamp, not live project health.
  Existing investigations present requests as document headings rather than
  right-aligned chat bubbles. Model configuration and held-message delivery use
  the existing pipeline.
- Five focused test files pass (22 tests), including lazy thread creation, retries
  without extra empty threads, capture interval aggregation, and existing result
  selection/layout behavior. Typecheck, production client/server build, and
  prerender pass. Existing dependency annotation and bundle-size warnings remain.
- Browser verified with the real local workspace: overview route, existing chat
  navigation, New investigation, draft preservation across those routes, activity
  and error attachment, and the new conversation typography. Desktop and 390px
  layouts have no horizontal overflow; no browser console errors were recorded.
  No live inference prompts were sent as part of this styling change.
- Restored the stopped local Convex dev backend on port 3210. Screenshot:
  `outputs/project-workspace.png`.

## Lean landing and suggested prompts — 2026-10-04

- Removed the landing's section numbering, helper subtitles, deployment URL,
  activity summary, error cards, and duplicate recent-chat list. The main surface
  keeps the project title, composer, and three direct-send suggestions. Existing
  history and detailed activity remain available through the sidebar/Inspector.
- Suggestions use the most recent user chat for the chart topic and attach up to
  three timestamped captured errors to the error suggestion. Suggested text is
  the submitted prompt; evidence uses the existing bounded result-selection
  channel. Other suggestions do not inherit an unrelated selected result, and
  an unrelated typed draft is preserved.
- Three focused files / 16 tests pass, covering empty history, recent-chat topic
  selection, bounded and dated error evidence, first-send retries, and existing
  result context handling. Typecheck/build/prerender and formatting checks pass.
  Desktop and 390px browser checks pass without horizontal overflow. No live
  inference prompts were sent. Screenshot: `outputs/project-workspace-lean.png`.

## Generated landing suggestions — 2026-10-04

- Replaced heuristic/canned landing prompts with a separate Convex Agent using
  the composer's selected model and provider. Context includes bounded, redacted
  completed answers, recent chat titles, findings, and timestamped log evidence.
  The Agent has no project tools, searches no other threads, and saves no messages.
- Suggestions carry validated source references into new investigations. Unknown
  references and duplicate prompts are rejected; JSON-escaped evidence is bounded
  to the existing message-selection limit. Suggestions support OpenRouter and
  Convex Gateway through the existing model adapter and encrypted credentials.
- Added per-project/model cache, source fingerprint invalidation, 30-minute reuse,
  atomic request deduplication, fenced completion, failure backoff, and a watchdog.
  Manual refresh preserves the last good set and asks for new angles. There is no
  canned fallback; the composer remains usable during loading or failure.
- 38 focused tests pass across six files, including authorization isolation,
  caching, expiry, concurrency fencing, evidence validation, and actual Convex
  Agent/provider integration with a mocked model response. The integration test
  caught the Agent adapter's required user/thread scope; a dedicated project user
  scope now supports generation without creating chat history. Typecheck,
  production builds/prerender, and formatting checks pass.
- Live OpenRouter/GLM 5.3 Flash generation succeeded in the local web app. Generated
  prompts referred to the observed 44.9% revenue drop, failed order SKUs, and dated
  payment errors. Reload retained the exact set; refresh produced another set.
  The sidebar retained 43 chats. No suggestion was submitted as an investigation,
  and no project tools or permission changes were triggered by these checks.
- Browser console remained clear; suggestion rows wrap without horizontal overflow
  at 312px and 390px widths. Screenshot: `outputs/ai-suggestions.png`.

## Conversation options — 2026-10-04

- Right-click, Option/Alt-click, or Shift+F10 on a sidebar chat opens a compact
  menu with Rename, Copy link, and Open in new tab. Ordinary clicks still navigate.
  Escape closes the menu and returns focus to its chat; renaming uses a small
  popover with a focused, selected name and inline save errors.
- Renaming checks workspace and project ownership, validates the title, and
  updates both the conversation and Convex Agent thread. Renames preserve the
  chat's position and custom names survive the first prompt, including legacy
  project threads without a conversation row.
- 20 focused workspace/backend tests pass; typecheck and production build pass.
  Browser verification covered all three menu gestures, copy/readback, new-tab
  navigation, normal navigation, Escape/focus, and rename persistence on reload.
  The test title and sidebar preference were restored. No browser console errors.
  Screenshot: `outputs/conversation-options.png`.

## Delete conversation — 2026-10-04

- Added Delete to the conversation menu with a small confirmation popover.
  Cancel receives initial focus; errors stay inline. Deleting the currently
  selected chat navigates to `/chats` after success.
- The authorized mutation deletes Agent messages/streams, runs, findings, and
  pending proposals, and invalidates suggestion caches. A content-free tombstone
  prevents stale clients and legacy default-thread fallback from reviving it.
  Notebook sessions and network bundles close immediately, with external resource
  cleanup scheduled through the existing retrying cleanup jobs. Other chats,
  connected projects, and shared project logs are preserved.
- Deletion is blocked while the chat has queued/running work or an executing
  approved operation. Public reads tolerate deletion while a view is subscribed;
  writes and stale approval requests cannot revive deleted chats.
- 34 focused tests across four files and the production build passed, including
  authorization, actual Agent message deletion, legacy history, idempotency,
  pending approvals, active-work guards, and notebook cleanup scheduling.
  Browser checks covered the menu, confirmation, cancel focus, cancellation,
  and rename regression; all 43 existing chats were preserved, and no browser
  console errors were recorded. Screenshot: `outputs/chat-delete-menu.png`.

## Homepage artifact grid — 2026-10-04

- Added a collapsible gallery directly below the three homepage suggestions.
  It shows real Plotly previews and table excerpts in a responsive card grid,
  with titles, dates, and partial-result labels. It does not appear on chat URLs.
- Cards open the existing interactive result viewer with sortable/paged tables,
  chart point selection, "Investigate this" context attachment, and an Open chat
  link to the originating conversation. No prompt is sent by opening a result.
- The authorized Convex query reads recent saved Agent outputs from up to 12
  non-deleted chats, with bounded message reads and a maximum of 12 artifacts.
  It returns validated chart/table content only, reusing the chat's correction
  rules; it excludes notebook code/stdout and caps the total response size.
- 25 focused tests passed, including real Agent message extraction, corrected
  results, table output, partial status, project/workspace isolation, deletion,
  ordering, and gallery limits. Typecheck and production build/prerender passed.
- Browser checks covered actual chart/table previews, collapse/reopen, table
  sorting/pagination, selection attached to the homepage composer without sending,
  source-chat navigation, gallery absence on chat URLs, and Escape/focus return.
  Fixed an asynchronous Plotly resize rejection exposed by hiding/unmounting
  charts; repeated lifecycle checks then produced no console errors.
  Screenshot: `outputs/homepage-artifact-grid.png`.

## Artifact discussions, pins, and layout — 2026-10-04

- Homepage artifacts now open with an adjacent chat pane. Questions go through
  the existing Convex Agent thread with bounded, structured artifact evidence;
  selected rows/points can be investigated without closing the viewer. Reused
  the normal message renderer for streaming, Python execution details, charts,
  copy actions, provider labels, and permission requests. Model selection and
  missing-provider setup work within the viewer's native dialog layer.
- Pin/unpin works from cards and the viewer. Convex stores validated artifact
  snapshots so pins survive the recent-message/chat cutoff. Ownership is checked
  before pin reads/writes, the collection is bounded, and chat deletion removes
  its pins. Pinned artifacts remain first in the grid.
- Cards support pointer dragging and keyboard arrow reordering within pinned or
  unpinned groups, plus hiding and individual restoration from Hidden. Order and
  visibility persist per project in this browser; pins persist in Convex.
- 31 focused tests passed across artifact layout, backend artifacts, result
  context, Inspector, and chat deletion. Typecheck and production build/prerender
  passed; only existing vendor annotations and large-chunk warnings remained.
- Live browser verification sent one question about the chart's highest day:
  the Agent returned the correct four-way tie at 24 orders, using the attached
  chart without tools. The discussion survived closing/reopening. Checked pin
  persistence, hide/reload/restore, actual pointer drag, keyboard ordering,
  selected table row context, nested model-menu Escape, and dialog focus return.
  At 390px the chart resizes to fit above chat; the viewport was reset afterward.
  Test pins/hidden cards were restored. During development, stale Vite modules
  required a restart; after final reload no new browser errors were recorded.
  Screenshot: `outputs/artifact-chat.png`.

## Editing artifacts in place — 2026-10-04

- Artifact chat now uses an authorized artifact-specific ask mutation that binds
  the run to the exact displayed version. The existing Agent's notebook tool can
  explicitly publish one successful chart/table back to the main pane. Questions
  and supporting outputs do not automatically replace the main artifact.
- Added persistent Convex artifact documents and immutable versions. The gallery
  and pins keep their original identity and render the selected version. The
  compact V1/V2 version menu and Undo control restore saved versions without
  deleting later edits. Chat deletion also removes the document and versions.
- Python's current_artifact() returns the selected validated figure/table from
  per-cell context, including after Undo. Existing kernels receive the helper in
  place via preload version 5, preserving their variables. Normal notebook calls
  retain their prior input/context shape. Approved notebook continuations retain
  artifact context and record their artifact-update receipt.
- Failed, truncated, invalid, ambiguous, and warning-bearing outputs preserve the
  current artifact. A late result cannot override an explicit version selection
  or a different run's edit; it remains available as a saved version. Stale sends
  preserve the draft and ask the user to review the current version. Version
  history is bounded at 50 versions per artifact.
- Full suite passed: 236 tests in 26 files. Typecheck, local Convex code generation
  and upload, and production build/prerender passed. Existing bundle-size and
  vendor-annotation build warnings remain.
- Live Agent/Freestyle tests changed the daily chart to a line with markers in
  one cell, preserving [22, 24, 24, 24, 24, 2], then grouped it into Monday-start
  weeks with 70 and 50 orders (120 total). The main pane updated immediately,
  without a duplicate chart in the chat pane. Verified Undo to V2, selecting V1,
  restoring V3, gallery title updates, and V3 after closing/reloading/reopening.
  No browser console errors were recorded. The edited demo chart remains on V3;
  the original is retained in history. Screenshot:
  `outputs/artifact-editing-versions.png`.

## Responsive data selection — 2026-10-04

- Narrow artifact viewers use full-height Artifact/Chat views instead of squeezing
  both panes into fixed rows. Investigate this switches to chat, preserves the
  exact selected context, and focuses the draft. Desktop retains the split view.
- Result tables use container-responsive row cards below 480px, wrapping complete
  field values. Sort, multi-selection, clear, and pagination remain outside the
  scrolling rows. Desktop retains column sorting and sticky row selectors.
- Plotly observes its actual host size and fills the remaining pane, reserving
  room for selected-point actions. Removed the contradictory minimum chart height.
  Empty Plotly Express series names get readable fallback labels.
- Kept screen-reader row labels positioned within each card; otherwise their
  absolute positioning inflated the native dialog's scroll area and focusing a
  lower checkbox pushed its header offscreen. The dialog itself cannot scroll.
- Browser checks passed at 390x844, 320x480, 320x400, 858x866, and 1280x800:
  sorting, paging, five-row selection limit, clearing, chart points, and attached
  context in chat. At 320x400 the dialog's client and scroll dimensions both equal
  320x400 and the send button remains inside the viewport. No console errors in
  the final browser run. These are viewport checks, not a physical-device test.
- 26 focused result/artifact tests passed; typecheck and production build/prerender
  passed. Existing vendor and bundle-size warnings remain. Vite required a restart
  to stop serving stale transformed modules during the final containment check.
  Screenshot: `outputs/mobile-data-selection.png`.

## Data browser and approved document edits — 2026-10-04

- Added a compact Data entry in the top bar: browse connected-project tables,
  load documents in pages of ten, attach a record or table sample to chat, and
  edit one document's JSON fields. Review shows only changed fields with exact
  before/after values; system fields are locked. The narrow layout stacks the
  diff and keeps approval controls outside the scrollable content.
- Reads and approved writes run Python in managed Freestyle VMs with TLS edge
  credential injection. An immutable, expiring proposal is required for edits;
  a `deployment:data:write` key and exact one-document body are provisioned only
  after approval. The existing notebook tool can request the same documentPatch
  operation, without adding a model tool or standing write access.
- A separate read checks changed fields before a write. Missing or changed
  records stop execution, duplicate execution claims do nothing, and failures
  are not retried automatically. This check is not an atomic compare-and-swap:
  business invariants still require a deployed transactional mutation.
- Uses Convex's internal dashboard `_system/frontend/patchDocumentsFields`
  operation, always with a single-element ids array. This is coupled to the
  dashboard API rather than a stable public CRUD contract. Special encoded
  Convex values require a deployed mutation; ordinary JSON field edits are
  supported. The editor bounds changes to 32 fields / 16 KB.
- Full suite: 250 tests in 28 files passed. Typecheck, local Convex codegen and
  upload, and production build/prerender passed. Existing bundle-size and
  vendor warnings remain.
- Live reads loaded the five demo tables and ten demoOrders records. Verified
  a failed-to-pending status review, cancelled both test approvals, and checked
  record context attachment without sending a message. No existing target
  records were changed: actual write execution is covered with mocked provider
  integration tests, not a live cloud write. Desktop and 320x400 CSS viewport
  review checks passed; all approval buttons fit inside the viewport, no
  horizontal dialog overflow, and no console errors were recorded.
  Screenshots: `outputs/data-browser-edit-review.png` and
  `outputs/data-browser-mobile.png`.

## Compact chart selection control — 2026-10-04

- Replaced the full-width selection strip and dark button with one compact,
  softly tinted control. Date, value, and metric have separate emphasis;
  unnamed single-series charts use their y-axis title instead of Series 1.
  Named and multiple-series selections retain their series identity.
- The selected context and Investigate this action share one click target;
  dismiss remains a separate button. The same control styles table selections.
- Typecheck and production build passed. Browser verified the 09-29 / 24 Orders
  selection, attaching it to the artifact chat without sending, and clearing it.
  At a 320x400 CSS viewport the bar has no horizontal overflow and stays inside
  the viewport. No console errors. Screenshot: `outputs/chart-selection-bar.png`.

## Left sidebar indicators and Settings — 2026-10-04

- Removed the right Inspector, its toggle and layout state. Artifacts stay in the
  gallery and chat. The left sidebar has compact connection and activity controls
  that open the corresponding Settings tab, including when the sidebar is collapsed.
  Connection indicators account for paused access and known token expiry; activity
  prioritizes pending approvals and running chats, then captured log errors or
  failed runs. Chat rows retain running indicators and show failures.
- Settings → Project retains connection, expiry, access, and webhook controls.
  Settings → Activity contains collapsible approvals, runs, captured project logs,
  and sandbox receipts. Log filters, expandable run details, ID copying and
  attaching evidence to chat remain available. Approval errors display in Settings.
- Typecheck and production build passed; 14 existing inspector/result tests
  passed. Browser checks verified both direct settings shortcuts, keyboard tab
  navigation, log filtering, sandbox receipts, and exact log-context handoff to a
  focused composer without sending. At 320x400 CSS pixels, the mobile sidebar
  opens Settings on Activity and the dialog has no horizontal overflow. Screenshot:
  `outputs/sidebar-indicators.png`. No backend changes or approval decisions.

## Chart styling — 2026-10-04

- Applied a shared rendering theme to full charts and artifact previews: muted
  default colors, narrower rounded bars, dotted gridlines, lighter axes, cleaner
  tooltips and Chart/Data controls. Simple nonnegative integer bar charts get
  direct value labels; previews, dense data, custom labels, unit formatting,
  secondary axes and multiple series keep their existing labeling behavior.
- Styling clones the saved figure and retains coordinates, explicit colors,
  scales, axis ranges, domains, subplot bindings, line shapes, histogram settings,
  heatmap scales and custom bar gaps. Uses Plotly's supported
  [bar corner radius](https://plotly.com/javascript/reference/layout/#layout-barcornerradius).
- Typecheck, production build and 16 focused chart/result tests passed. Browser
  checked the six values [22, 24, 24, 24, 24, 2], point selection/dismiss, the data
  view, and a stacked chart with its three series and legend. Labels and dialog
  fit at 256x320 CSS pixels. No console errors. Screenshot:
  `outputs/refined-charts.png`. No saved chart data or versions were changed.

## Navigation data preloading — 2026-10-04

- TanStack already preloaded route code on intent; added bounded live Convex
  subscriptions for sidebar/source-chat links, artifact cards, project options,
  and Workspace/New investigation navigation. Loads metadata, view details, the
  first 30 messages, artifact history, or the project landing queries as needed.
  Agent streaming begins normally when the view opens.
- Hover/focus waits 80 ms and pointer-down starts immediately. Flybys cancel,
  repeat intent deduplicates, three destinations are retained for 30 seconds,
  and tab hiding/provider teardown clears speculative subscriptions. Offline or
  data-saving browsers skip them. Only existing authorized read queries run.
- All 261 tests (30 files), typecheck, and production build passed. Six new tests
  cover cancellation, bounded retention, cleanup/failures, query scope, and the
  actual Convex client cache with a deterministic WebSocket transport. The real
  installed Agent hook renders prefetched messages on its first render; attaching
  the visible subscription adds no duplicate network query, and live updates
  continue after preload expiry. Existing dependency/chunk build warnings remain.
- Browser verified keyboard-focus intent without navigation, opening an artifact
  with its discussion, source-chat and sidebar-chat navigation, and returning to
  the workspace gallery. No console warnings/errors. Browser automation has no
  hover API, so pointer hover is wired through the shared tested intent scheduler;
  the browser exercise uses keyboard focus. No precise latency claim is made.

## Simplified homepage artifacts — 2026-10-04

- Removed the Artifacts collapse header, section divider, individual hide buttons,
  and hidden-artifact management. The grid sits directly below suggestions with
  compact spacing; pins, reordering, opening discussions, and hover preloads remain.
- Old saved hidden IDs are ignored and removed when the layout is next saved, so
  previously hidden cards return without losing their saved order.
- Production build and 10 artifact-layout/navigation tests passed. Browser check
  showed 12 cards, zero hide/collapse controls, and no section border. Screenshot:
  `outputs/artifacts-without-header.png`.

## Dismissible suggestions — 2026-10-04

- Each homepage suggestion has a separate dismiss button, revealed on hover or
  keyboard focus and always visible on touch devices. Dismissal does not send the
  suggestion, regenerate prompts, or affect the other rows. The section disappears
  when its last suggestion is dismissed.
- Dismissed text is remembered in this browser tab's session storage, scoped to
  the project and model; navigating or reloading keeps it dismissed. Storage is
  bounded to 100 entries, and new suggestion text can appear normally.
- Typecheck, production build, and seven suggestion tests passed. Browser verified
  mouse and keyboard dismissal, reload persistence, unchanged /chats route, focus
  moving to the next suggestion or composer, and no console errors. Tests ran in
  a separate tab so the user's suggestions and existing draft stayed intact.
  Screenshot: `outputs/dismissible-suggestions.png`.

## Direct data explorer reads — 2026-10-04

- Replaced the explorer's one-shot sandbox reads with direct, bounded HTTP calls
  from the Convex backend to `_system/cli/tables` and `_system/cli/tableData`, the
  same native queries used by the installed Convex CLI. Rows no longer use
  generated inline query code. Both operations mint only `deployment:data:view`
  authority; no Freestyle configuration, VM, or TLS-injection rule is required.
  Agent notebooks and approved write execution retain their existing paths.
- Workspace authorization and project access checks run before reads. Endpoints
  are restricted to verified Convex deployment origins; redirects are rejected,
  HTTP requests time out after 15 seconds, and responses are bounded to 256 KiB.
  Keys stay server-side, immediate cleanup is durably scheduled, and scheduling
  failure falls back to synchronous cleanup. The existing lease watchdog remains.
- Added a 15-second, twelve-page in-memory cache scoped to workspace, project,
  connection, and permission revision. Hover/focus waits 120 ms; pointer-down
  starts immediately; duplicate reads share an in-flight request. At most two
  speculative reads run at once, and hidden/offline/data-saving tabs skip them.
  Refresh bypasses caching; edits invalidate every page of the affected table.
- Live browser measurements against the connected synthetic deployment:
  original table listing 2946 ms, first ten documents 3130 ms. Instrumentation
  found TLS-rule installation took 1377–1597 ms before the fixed Python request.
  With direct reads, the first listing took 818 ms and first documents 482 ms;
  three fresh document refreshes took 604, 484, and 599 ms. A later uncached
  orders/customers pair took 498/479 ms, cached return to orders took 275 ms,
  next ten rows took 694 ms, and cached dialog reopening took 283 ms. These are
  local development browser samples including automation/render overhead, not
  production percentiles. The remaining backend time is largely key creation
  (221–379 ms observed) plus the native query (91–305 ms observed).
- Verified orders 120 through 101 across two distinct pages, customer switching,
  a third page, refresh, and reopening. No console warnings/errors. Background
  focus preloading was skipped as intended for a hidden test tab; cache
  deduplication/intent reuse is covered with deterministic unit tests. All eleven
  fresh-read leases checked from this browser exercise were revoked. No target
  records were edited and no proposals were approved during this validation.
- Local Convex codegen/upload, typecheck, production build, and all 274 tests in
  32 files passed. Thirteen new tests cover direct reads, least-privilege request
  shape, invalid targets/inputs, error redaction, bounded responses, cleanup
  fallback, legacy backend keys, cache races, invalidation, retry and retention.
  Existing third-party annotation and bundle-size build warnings remain.

## Thinking status alignment and motion options — 2026-10-04

- The thinking status and pre-response cursor now share the message text's
  centered 680px maximum width. Removed the whole-label opacity pulse while
  animation alternatives are being evaluated. Wide chart/result layout remains.
- Verified actual MessageView and StreamingCursor components in a separate
  browser fixture without sending a prompt. At a 1280px viewport, the user
  prompt, thinking label, waiting cursor, and response text all begin at x=300
  with a 680px width; the wider result area begins at x=148 with a 984px width.
  Thinking has no animation and the fixture has no horizontal overflow.
- Typecheck and production build passed. Existing vendor/chunk warnings remain.
  A separate inline preview compares a quiet arc, text sweep, moving dash, and
  plain elapsed-time label. All four variants switch correctly with no console
  errors; animation respects reduced motion. Preview choices do not change
  application settings or issue any model requests.

## Streaming layout stability — 2026-10-04

- Removed the generated cursor after Markdown blocks: it participated in inline
  layout and could create an extra line at the right edge. The initial waiting
  cursor remains. The Answer control now appears with the first text, after
  tool details, instead of being inserted above an already rendered response
  at completion. Thinking is hidden once visible response text exists.
- Main chat and artifact discussions share a scroll-follow hook. Following
  adjusts before paint and observes content/viewport resize for delayed chart
  rendering. Scrolling upward stops following immediately; returning to the
  bottom resumes it. Browser anchoring stays enabled while reading history.
  Completed message Markdown is memoized to avoid reparsing it for each token.
- A deterministic browser fixture exercised the actual MessageView and hook:
  a 24-update token stream stayed at a zero-pixel bottom gap; scrolling to
  history and appending text left scrollTop at zero; returning to the bottom
  then growing a delayed result to 240px retained a zero-pixel gap. Finishing
  the response left its first text at y=753 and scrollTop=0, unchanged. Switching
  chat restored bottom following. No console warnings/errors.
- Typecheck, production build and all 274 existing tests passed. No live model
  request was issued for this check. Markdown can still reflow as incomplete
  syntax becomes a complete table, list or code block; this does not claim
  that all content growth or every provider-specific streaming pattern is gone.
- Updated the inline indicator comparison to show options 1, 2 and 4 together,
  with all three visible in the browser check.

## Centered inline results and permissions — 2026-10-04

- Single result cards and stacked results use the centered 680px message
  column. Multiple side-by-side cards retain the wider result area. Permission
  groups, including past permissions, and failed-response notices also align
  with the message column.
- Verified two single charts at x=410 with a 680px width, matching their text;
  two multi-result grids retained the 984px layout at x=258. Past permissions
  matched the text at x=410 and 680px wide. No page horizontal overflow or
  browser console warnings/errors in these checks.
- Typecheck and production build passed; existing vendor/chunk warnings remain.

## Combined thinking indicator — 2026-10-04

- Added a quiet spinner before Thinking, a subtle text sweep, and elapsed time
  after the label. The row keeps the centered 680px message width. Timer digits
  use tabular spacing and reserved width; timing is local to the visible thinking
  phase and uses a monotonic clock. Reduced motion disables both animations.
- A browser fixture using the actual MessageView verified left alignment with
  the prompt, both 2.4s animations, a ticking timer, removal when the response
  appears, and reset to 0s for a new thinking phase. No console errors/warnings
  or horizontal overflow. No model requests were needed; temporary files and
  the preview server were removed after verification.
- Typecheck and production build passed; existing vendor/chunk warnings remain.

## Readable access history — 2026-10-04

- Replaced the boxed Past permissions list with a compact Access history
  disclosure and completed/declined/unconfirmed counts. Rows show the operation
  and a result summary; opening a row reveals its reason and query code. Raw
  arguments, credential scopes and responses remain under Technical details.
  Active approval controls and their authorization checks are unchanged.
- Verified the existing function-discovery conversation: Read-only query shows
  Returned 1, and Function discovery shows No functions returned. Expanding the
  row shows return 1; without a JSON envelope; the original scope and response
  are available in Technical details. The history stays 680px wide with no
  horizontal overflow and no console warnings/errors. No permissions approved.
- All 13 targeted history/permission tests passed, including declined/uncertain
  writes, malformed results, zero/false values and notebook outcomes. Typecheck
  and production build passed; existing vendor/chunk warnings remain.

## Data viewer infinite scrolling — 2026-10-04

- Removed the loaded-row count and Load more control. An intersection observer
  rooted in the document scroll area fetches the next page 600px before the
  bottom, appending rows without replacing the list. A small spinner appears
  only while a page is in flight. Concurrent automatic requests are blocked;
  stale results from another table are ignored. Failed paging pauses automatic
  loading and Retry read resumes that page while retaining existing rows.
  Repeated/cycling cursors stop with an error rather than requesting forever.
- Live browser verification loaded 20 orders while still at scrollTop=0, then
  30 unique orders after scrolling toward the loaded end. Switching to customers
  reset the position and automatically loaded 20 rows, followed by the final four
  on scrolling. All 24 were unique; the final page had no loading indicator,
  loaded count or pagination button. No console warnings/errors. Read-only checks
  only; no documents changed. Restarted the dev server after it served a stale
  component, then verified the current implementation.
- Typecheck, production build and all 13 targeted direct-read/cache tests passed.
  Existing vendor/chunk warnings remain.

## Document fields and highlighted JSON — 2026-10-04

- Documents now open in a read-only field/value view. An optional JSON tab
  syntax-highlights the complete document, including system metadata. Edit fields
  opens typed controls for strings, numbers, booleans, null, arrays and objects;
  fields can be added or removed, with undo for existing-field removal. Cancel
  restores the original document. The JSON tab previews a valid draft read-only.
  Special Convex values remain read-only rather than being coerced to JSON types.
- The existing immutable proposal, approval and conflict-checking path remains.
  Review is disabled for no changes or invalid values; before/after values also
  use JSON highlighting. Blank numbers are rejected rather than saved as zero.
- Browser checks verified 45 syntax token spans in the full JSON, switching
  views, numeric validation, changed-field counts, removal/undo, adding a boolean
  field via the type menu, the highlighted draft, and Cancel restoring quantity
  from 4 to 3 and removing the new field. No proposals or data writes were issued.
- All 18 typed-draft and existing document/approval/execution tests passed.
  Typecheck and production build passed; existing vendor/chunk warnings remain.

## Standalone data explorer removed — 2026-10-04

- Removed the top-bar Data button and the entire explorer dialog, field editor,
  frontend page cache, hover preloading and their dedicated tests. Removed the
  explorer's README feature description. Chat results, JSON highlighting and
  the Agent's document-patch approval/execution support remain available.
- Confirmed no explorer references remain under src. Live browser verification
  found zero Data buttons and zero Project data dialogs, with the conversation
  and composer rendering normally and no console warnings/errors.
- Typecheck, production build and all 274 remaining tests in 32 files passed.
  Existing vendor/chunk warnings remain.

## Code cleanup passes — 2026-10-04

- Separated Convex connection/query/mutation wiring in `src/App.tsx` from the
  workspace layout and per-chat UI state in `src/Workspace.tsx`. App is now 325
  lines instead of 983; component lifetimes and draft ownership are preserved.
- Removed unreachable sample-mode branches, sample fixtures, the unused
  configuration modal, and the retired right-panel result collector. Simplified
  the single chat section and made live workspace/settings inputs required.
- Removed the unused standalone explorer API modules and direct-read helper.
  Renamed the remaining shared edit validation to `convex/lib/documentPatch.ts`;
  notebook requests and historical approvals retain validation, exact document
  targeting, conflict checks, and single-execution behavior.
- Retained document approval/execution regression coverage through the agent's
  existing `approvals.propose` path. Removed seven explorer-read tests and two
  tests for the retired result collector. No stored project data or approvals
  were changed by the cleanup.
- Enabled TypeScript's unused-local/parameter checks, removed unused imports and
  a test fixture, replaced UI `any` casts with narrowed unknown values, and
  removed duplicate typechecking from `npm run check` (build already checks it).
- Updated the README's app name, homepage behavior, suggestion dismissal, and
  code organization; regenerated Convex API bindings with `convex codegen`.
- Validation: `npm run check` passed all **265 tests across 31 files**, strict
  TypeScript, and the production build. Prettier passed on changed code/configs.
  Existing vendor annotation/SSR import and large-chunk warnings remain.
- Browser smoke checks passed: homepage and direct reload, chat navigation,
  independent unsent drafts surviving navigation, Project/Activity settings,
  and opening a chart artifact with its chat controls. No browser console
  warnings or errors. Test drafts were cleared without sending messages or
  executing project operations.

## Artifact URLs and automatic chart updates — 2026-10-04

- Added `/artifacts/{artifactId}` routes under a shared workspace layout. Gallery
  cards and expanded inline charts/tables use the same large result with its
  chat sidebar. Opening an artifact materializes its saved original without
  starting a model run. Edited output aliases resolve to the original URL.
- Links enforce workspace/project/chat ownership. Invalid IDs and deleted chats
  are unavailable. Older inline results can be located using their verified
  persisted Agent message even after leaving the recent-message window.
- Traced the reported paid-orders failure to a successful notebook returning one
  chart with `updateArtifact: false`. Removed that model-controlled flag: complete
  single-result artifact cells now save a version and update the main pane.
  Existing failure/truncation/ambiguity validation and late-edit protection remain.
- Added regression coverage for stable URL identity, no investigation on opening,
  workspace/deletion isolation, old inline results, edited output aliases, and
  a real Agent tool loop carrying the obsolete false flag.
- Live retry in the affected chat with “show only paid orders” completed in one
  notebook call, updated the main chart to 11 paid KEYBOARD orders (80,300¢), and
  saved version 2. Original data and version 1 remain unchanged.
- Browser verified direct navigation, reload, Back/Forward, opening from gallery
  and inline conversation results, and closing back to the originating chat with
  its unsent draft preserved. No browser warnings/errors. Screenshot:
  `outputs/artifact-route-paid-orders.jpg`.
- `npm run check` passed **268 tests across 31 files**, strict TypeScript, client/
  server production builds, and prerender. Existing vendor/chunk warnings remain.
  Updated Convex functions were synced to the local demo backend.

## Missing-page design and artifact diagnosis — 2026-10-04

- Replaced the generic centered chat error with a responsive 404 illustration,
  app typography/plum accent, resource-aware explanation, and a workspace link.
  Unknown routes identify a missing page rather than a missing chat.
- Browser checked missing chat, missing artifact, and unmatched routes; the
  recovery link returned to the workspace. Verified 390px mobile layout and
  desktop rendering without console warnings/errors. Screenshots:
  `outputs/not-found-desktop.jpg` and `outputs/not-found-mobile.jpg`.
- The reported artifact `m57dhqthqr160bjyxqd0z4719h8fq082` opened normally in a
  fresh tab with version 3, weekly bars of 70 and 50 orders, and its chat sidebar.
  Its latest saved runs were complete. The original browser tab did not respond
  to inspection or reload; the cause is unresolved. Kept a fresh working copy
  open and asked which user interaction was failing. No artifact data changed.
- Strict TypeScript, production client/server builds, prerender, and formatting
  passed. Existing vendor annotation/import and large-chunk warnings remain.
