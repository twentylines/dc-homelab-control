# Contributing

Keep changes small, provider-aware and honest about what was tested. A new
integration should be optional, read-only by default, and silent when the
provider is absent. Do not add a dashboard to the support list without an
offline fixture and a failure-path test.

Before opening a pull request, run the checks in `README.md`, add or update
tests, and review the generated Discord embeds for field-length and
user-controlled-text handling. Never include real Discord, panel or webhook
credentials in fixtures.
