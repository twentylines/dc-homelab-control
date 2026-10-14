# 0.5.0 verification

## Automated behavior checks

PASS: 37 Python bot/runtime tests, 57 agent tests and 11 maintenance tests.
PASS: Ruff code checks and Python import/compilation checks.
PASS: Release identity and Runtipi metadata validation.
PASS: Runtime dependency audit reported no known vulnerabilities.
PASS: Redacted source secret scan; exclusions match only exact public dummy IDs
and the example application-ID placeholder.

The publication workflow additionally requires the Linux tests, Compose
validation and image build/import checks before it exposes the OTA release.

## UI delivery review

The design review uses the owner's existing compact-summary and quiet-refresh
direction (see `DESIGN.md`). Discord supplies font, theme, focus and touch layout.

- Hard gate PASS for generated payloads: native embed and component limits are
  checked with empty, single-item, 38-container and 100-container fixtures.
  No fabricated measurements, decorative assets or unsupported navigation are
  introduced. Empty, waiting, error and expired-panel responses exist.
- Purpose gate PASS: one native embed accent indicates actual state, usage bars
  compare real counters, and the refresh glyph appears only during requests.
- Liveliness PASS within Discord's native layout: ENERGY 1 / RHYTHM 2 / MOTION 1;
  a health headline leads the overview, lists use paginated detail fields,
  and deeper pages expose their parent plus Home.
- Quality locks PASS for source and fixtures: action labels name their effect,
  optional providers are omitted when absent, tests recheck permissions before
  mutation, and footers contain a command hint plus a timestamp.

## Interaction evidence

These are callback and HTTP-fixture checks, not a claim of clicks in a live
Discord client.

| Control | Exercised behavior |
| --- | --- |
| Home, section menu and Refresh | All 17 slash commands register; reader pages produce native payloads |
| Container, task and Minecraft selectors | Open real selected fixture details with resource values |
| Pagination | Lists stay within Discord's 25-choice and five-row limits |
| Parent and Home controls | Dispatch real page callbacks; navigation cancels the old live loop |
| Live task refresh | Last complete fields remain visible while the footer refreshes |
| Start, stop and restart | Owner-bound, expiring, single-use confirmation; permissions rechecked |
| Minecraft console | Panel route verified; unsafe commands and multi-line input rejected |
| Access settings | Environment grants and saved deny-lists migrate; owner cannot be removed |
| Update bot | Notes and adaptive archive size appear before the confirmed release request |
| Rollback | Exact GitHub selection and retained-local requests preserve their distinct source |
| Automatic updates | Off queues nothing; daily queues once; Beta requires confirmation |
| Restart and recovery | Private handoff is saved before queueing; job and runtime version verified |
| Completion notice | Scheduled completion appears once on the next successful slash response |
| Weekly report | Compact health summary includes update status and posts once per window |
| Docker health | Local endpoint returns 503 while disconnected, 200 when ready |
| Legacy OTA probe | Exact old probe passes/fails with endpoint state; arbitrary code is rejected |

The reference server is not changed by these checks. Real gateway reconnect,
mobile rendering, keyboard use inside Discord and production credentials still
need an operator test after installation. The existing Ubuntu/Runtipi/Crafty/
Jellyfin reference setup is described in the README without claiming a v0.5
production test.
