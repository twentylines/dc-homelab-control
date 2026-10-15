# 0.5.1 verification

Pre-publication checks. Production installation remains user-initiated.

## Automated checks

- PASS: 39 bot/runtime tests, 57 agent tests and 11 maintenance tests.
- PASS: Ruff formatting and lint checks, release identity and Runtipi metadata.
- PASS: release-workflow syntax and whitespace checks.
- PASS: redacted source scan found no secrets; dependency audit found no known vulnerabilities.
- PASS: the v0.4.1 worker extracts the current Python release layout; legacy Docker health probes still pass and fail according to actual endpoint readiness.

## UI delivery gate

The Anti Slop core and UI skills were applied during the change, using the
owner's compact-summary direction and explicit request for Home buttons.

- Hard gate PASS for the changed payloads: ten unique native buttons fit two
  five-button rows, all destinations exist, and guests cannot reach settings
  or execute mutations. No data, assets, theme or motion changes were introduced.
- Purpose gate PASS: section buttons provide one-click navigation; selectors
  remain appropriate for long lists. No decorative styling was added.
- Liveliness PASS within the existing native layout: ENERGY 1 / RHYTHM 2 /
  MOTION 1, with the health summary as the focal point and secondary navigation
  below it. The design rationale is recorded in `DESIGN.md`.
- Quality locks PASS for source and callback fixtures: optional media and
  disabled Minecraft sections are omitted, administrator settings remain
  restricted, and each button dispatches its actual destination.

## Callback evidence

The following Home buttons were invoked against the real controller using local
API fixtures: Refresh, Status, Services, Minecraft, Storage, Media, Tasks, Network,
Updates and Settings. Each returned a panel without an error response. No
mutation endpoint was called. Owner and guest payloads were also checked with
media absent and Minecraft disabled.

These are automated callback checks, not live Discord clicks. Discord owns
mobile layout, keyboard behaviour, touch targets and light/dark rendering;
those have not been manually verified inside Discord for this patch. The Linux
image build and public OTA download must be verified during publication before
the release is described as available.
