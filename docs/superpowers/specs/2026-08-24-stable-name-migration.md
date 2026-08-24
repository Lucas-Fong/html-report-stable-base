# HTML Report Stable Name Migration

## Goal

Make `html-report-stable-base` the sole public directory, skill, and plugin identifier, then update all local skills and workflows that reference the former `html-report` identifier.

## Scope

- Set the repository-root skill frontmatter name to `html-report-stable-base`.
- Set `.codex-plugin/plugin.json` name to `html-report-stable-base`; preserve repository URLs, display name, capabilities, and bundled skill layout.
- Rename the plugin-facing wrapper from `skills/html-report/` to `skills/html-report-stable-base/`, update its frontmatter, and keep it enabled.
- Update human-facing workflow references in the report plugin, GEO HTML PPT skill, and PPT visual pipeline so the canonical dependency/trigger name is `html-report-stable-base`.
- Update assertions and add migration tests that reject the former identifier in active skill metadata and explicit skill-trigger references.

## Non-goals

- Do not rename the GitHub repository, file-format prefixes such as `html-report-qa-*`, CSS/data identifiers such as `html-pptx-data`, or report-editor functionality.
- Do not retain an `html-report` compatibility wrapper or alias.
- Do not publish, push, or alter unrelated local skills as part of this implementation.

## Migration Rules

The display name may remain “HTML Report” because it is a user-facing label, but the machine identifier must be `html-report-stable-base`. Text that describes the generic report modality may retain “HTML report”; only references that mean the specific skill, plugin, folder, invocation, or dependency must use the canonical identifier.

The active plugin wrapper must live at `skills/html-report-stable-base/SKILL.md` and point to the root contract with the same relative path. Existing disabled wrapper files are removed through the rename rather than retained as aliases.

## Verification

Validate root and wrapper skill metadata, validate the plugin manifest, run target-repository tests, run the affected GEO HTML PPT tests and sample render/QA, then scan active metadata and workflow documentation for legacy identifiers.
