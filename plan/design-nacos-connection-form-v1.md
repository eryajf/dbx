---
goal: Clarify and harden the Nacos and r-nacos connection form
version: 1.0
date_created: 2026-07-22
last_updated: 2026-07-22
owner: DBX maintainers
status: 'Planned'
tags: [design, feature, nacos, rnacos, compatibility, desktop]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan restructures the DBX Nacos connection form so users can distinguish Nacos 2.x, Nacos 3.x, and r-nacos without first understanding their API families, ports, or UI routes. It also completes the r-nacos configuration-history compatibility work already present in the `issue_4061` working tree.

The current form uses one field named `OpenAPI / Admin API URL` for endpoints with different meanings:

| Deployment | User-facing entry | DBX primary endpoint | Default path semantics |
|---|---|---|---|
| Nacos 2.x | Console and server usually share port `8848` | Server/OpenAPI and legacy console APIs | `/nacos` |
| Nacos 3.x | New console defaults to port `8080`; server API remains on `8848` | Console/Admin API for management operations, with API fallbacks | Console path is empty by default; server API commonly uses `/nacos` |
| r-nacos | Compatible API defaults to `8848`; independent console defaults to `10848` | Compatible API for normal operations; independent console only for configuration history | Compatible API uses `/nacos`; console UI uses `/rnacos` |

The existing hard-coded `http://127.0.0.1:8085` is not an official Nacos default and does not match the repository's current Nacos 3 compose environment, which maps a configurable host port to container port `8080`. New connections must therefore use type-specific placeholders instead of a persisted generic default.

Current implementation baseline in the working tree:

- r-nacos compatible OpenAPI connection and `/nacos` path correction are implemented.
- r-nacos history fallback through the independent console API is implemented.
- r-nacos CAPTCHA login, password encryption, token caching, and token-expiry recovery are implemented.
- The independent r-nacos console endpoint follows the configured SSH/proxy transport chain.
- Configuration-history capability reporting and frontend disabling are partially implemented.
- Two review findings remain open: terminal `/rnacos` URL normalization and history capability/authentication consistency.

Target form hierarchy:

```text
Service implementation
[ Nacos ] [ r-nacos ]

Nacos version (Nacos only)
[ Auto detect ] [ 2.x ] [ 3.x ]

Primary address (label and placeholder depend on the selected profile)
[ full URL accepted and normalized ]

Default namespace (optional)
[ public ]

Authentication
[ None ] [ Username / Password ]

r-nacos configuration history (r-nacos only)
[ ] Enable configuration history
    Console address
    [ full URL accepted, including a terminal /rnacos ]
    Console authentication
    [ Use primary credentials ] [ Separate credentials ]

Advanced
    Custom API Context Path
```

## 1. Requirements & Constraints

- **REQ-001**: The form must explicitly distinguish `Nacos` from `r-nacos` before displaying endpoint-specific fields.
- **REQ-002**: When the implementation is `Nacos`, the form must provide version modes `auto`, `v2`, and `v3`.
- **REQ-003**: The primary address label, placeholder, help text, and normalization rules must change with the selected implementation/version profile.
- **REQ-004**: The primary address input must accept a full browser or API URL and normalize known UI suffixes instead of requiring users to split the origin and Context Path manually.
- **REQ-005**: Nacos 2.x input `http://host:8848/nacos/` must normalize to `serverAddr=http://host:8848` and `contextPath=/nacos`.
- **REQ-006**: Nacos 3.x input must accept a console origin such as `http://host:8080`; known UI suffixes `/next`, `/next/`, `/index.html`, and `/next/index.html` must not become API context paths.
- **REQ-007**: r-nacos primary input must represent the compatible API, with a default example of `http://host:8848/nacos`; it must never silently use the independent console as the primary API.
- **REQ-008**: r-nacos console input must accept both `http://host:10848` and the documented browser URL `http://host:10848/rnacos/` without producing `/rnacos/rnacos/api/...`.
- **REQ-009**: The visible `Context Path` field must move to the Advanced tab; standard profiles must derive it automatically while preserving explicit custom reverse-proxy paths.
- **REQ-010**: The generic top-level connection-string field with a PostgreSQL placeholder must be hidden for Nacos connections.
- **REQ-011**: The r-nacos console section must be hidden unless the selected implementation is `r-nacos` and configuration history is enabled.
- **REQ-012**: r-nacos console authentication must support `inherit primary credentials` and `separate username/password`; `None` primary authentication must not prevent users from supplying console credentials.
- **REQ-013**: Capability reporting must mark r-nacos configuration history unavailable when the console URL or usable console credentials are absent.
- **REQ-014**: Inline validation must identify likely endpoint swaps and offer deterministic corrections before a network request is made.
- **REQ-015**: The test result must display the detected implementation/version, normalized endpoint, effective context path, and configuration-history availability.
- **REQ-016**: Existing saved Nacos connections without the new discriminator fields must continue to load and connect without migration failure.
- **REQ-017**: Existing connections must not be rewritten merely by opening the edit dialog; canonicalized values may be persisted only after an explicit Save or successful auto-correction accepted by the user.
- **REQ-018**: Nacos-specific labels must replace generic database wording where the semantic object is a namespace, including `Select visible namespaces` instead of `Select visible databases`.
- **REQ-019**: New Nacos connections must not prefill `8085`; profile-specific examples must be placeholders and must not assume host port mappings.
- **REQ-020**: URL normalization must preserve schemes, IPv6 hosts, credentials-free reverse-proxy prefixes, and explicit non-default ports.
- **SEC-001**: Console passwords and CAPTCHA tokens must never be included in error messages, test-result summaries, frontend logs, or serialized connection-info responses.
- **SEC-002**: A separate r-nacos console password must use the same encrypted-at-rest and masking behavior as the existing connection password.
- **CON-001**: Preserve the current persisted `serverAddr`, `contextPath`, `rnacosConsoleAddr`, and `auth` fields for backward compatibility.
- **CON-002**: Do not infer Docker host-port mappings such as `3048 -> 10848` or `3848 -> 8848`; only normalize paths and official container-side defaults when the mapping is explicit.
- **CON-003**: Do not treat every port `10848` deployment as r-nacos during Save; port-only detection is allowed only as a tested fallback after the original endpoint fails.
- **CON-004**: Nacos 3 deployments may expose console and server APIs through custom gateways, so version selection must not impose fixed ports.
- **GUD-001**: Prefer one complete URL input per logical endpoint; derive implementation details such as Context Path automatically.
- **GUD-002**: Use dynamic labels and concrete examples instead of one paragraph that describes all products and versions simultaneously.
- **GUD-003**: Validation messages must explain what the entered endpoint appears to be and provide a one-click corrective action where possible.
- **PAT-001**: Keep normalization logic in pure TypeScript helpers with table-driven unit tests, then repeat security-critical validation in Rust before issuing requests.
- **PAT-002**: Keep provider/version metadata optional in persisted external config so old clients and old saved records remain readable.

### Canonical field semantics

| Profile | Primary field label | Primary placeholder | Derived Context Path | Optional secondary endpoint |
|---|---|---|---|---|
| Nacos / auto | Nacos management address | `http://127.0.0.1:8848/nacos` | Detected during Test | None |
| Nacos / v2 | Service address (API and console shared) | `http://127.0.0.1:8848/nacos` | `/nacos` | None |
| Nacos / v3 | Admin API / console address | `http://127.0.0.1:8080` | Empty unless custom | None |
| r-nacos | Nacos-compatible API address | `http://127.0.0.1:8848/nacos` | `/nacos` | Configuration-history console, e.g. `http://127.0.0.1:10848/rnacos` |

### Proposed persisted external-config additions

```ts
type NacosImplementation = "nacos" | "rnacos";
type NacosVersionMode = "auto" | "v2" | "v3";

interface NacosAdminConfig {
  implementation?: NacosImplementation;
  versionMode?: NacosVersionMode;
  serverAddr: string;
  contextPath?: string;
  rnacosConsoleAddr?: string;
  auth?: NacosAuthConfig;
  rnacosConsoleAuth?:
    | { kind: "inherit" }
    | { kind: "usernamePassword"; username: string; password: string };
}
```

Compatibility defaults when fields are absent:

- `implementation`: treat as `nacos` for display until detection provides stronger evidence; do not persist the inferred value automatically.
- `versionMode`: treat as `auto`.
- `rnacosConsoleAuth`: treat as `inherit` when primary authentication is username/password; otherwise treat as unavailable.

### Required inline validation rules

| Input condition | Severity | Required result |
|---|---|---|
| r-nacos primary address ends in `/rnacos` or uses a known console port | Error before Save; warning before corrective Test fallback | Explain that this is a console URL and offer to move it to the history-console field |
| r-nacos console address ends in `/nacos` and primary address is empty | Error | Explain that this appears to be the compatible API and offer to move it to the primary field |
| r-nacos console address ends in `/rnacos` | Valid | Canonicalize without duplicating the API prefix |
| Nacos 3 address ends in `/next` or `/index.html` | Valid with informational normalization | Strip the UI route and display the normalized management origin |
| Nacos 2 address contains `/nacos` | Valid | Split the known context path from the origin |
| r-nacos history is enabled without console credentials | Blocking validation | Request separate credentials or primary credential inheritance |
| Generic URL contains embedded username/password | Blocking validation | Reject and instruct the user to use authentication fields |

## 2. Implementation Steps

### Implementation Phase 0 — Preserve the current compatibility baseline

- **GOAL-001**: Keep the already implemented r-nacos compatibility behavior working while the form and configuration model are restructured.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Preserve the existing r-nacos configuration-history fallback, CAPTCHA login, AES password encoding, session invalidation, and retry behavior in `crates/dbx-core/src/nacos/http.rs`. | ✅ | 2026-07-21 |
| TASK-002 | Preserve independent-console transport rewriting and cleanup in `crates/dbx-core/src/connection.rs` and `crates/dbx-core/src/nacos/config.rs`. | ✅ | 2026-07-21 |
| TASK-003 | Preserve the existing desktop, Web, and Tauri command paths for CAPTCHA retrieval and console login. | ✅ | 2026-07-21 |

### Implementation Phase 1 — Define profile and URL normalization contracts

- **GOAL-002**: Introduce deterministic provider/version and endpoint-normalization helpers without changing the visible form.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Extend `apps/desktop/src/types/nacos.ts` with `NacosImplementation`, `NacosVersionMode`, and `NacosRNacosConsoleAuth` types. Keep all new persisted fields optional. |  |  |
| TASK-005 | Replace `resolveRNacosOpenApiFallback` in `apps/desktop/src/lib/nacos/nacosAdmin.ts` with pure helpers that return `{ serverAddr, contextPath, detectedImplementation, detectedVersion, warnings }`. Preserve the existing exported function as a compatibility wrapper until all callers migrate. |  |  |
| TASK-006 | Implement primary URL normalization for Nacos 2.x, Nacos 3.x, and r-nacos. Strip only known UI suffixes; preserve unknown reverse-proxy prefixes as explicit context paths. |  |  |
| TASK-007 | Implement r-nacos console URL joining so both a root URL and a terminal `/rnacos` URL resolve to exactly one `/rnacos/api/console/v2/...` prefix. Update `NacosOpenApiAdmin::rnacos_console_endpoint` in `crates/dbx-core/src/nacos/http.rs`. |  |  |
| TASK-008 | Add table-driven frontend tests in `apps/desktop/src/lib/__tests__/nacos/nacosAdmin.spec.ts` for IPv4, IPv6, HTTPS, custom ports, reverse-proxy prefixes, `/nacos`, `/rnacos`, `/next`, and invalid URLs. |  |  |
| TASK-009 | Add Rust tests in `crates/dbx-core/src/nacos/config.rs` and `crates/dbx-core/src/nacos/http.rs` for console roots, terminal `/rnacos`, proxy prefixes ending in `/rnacos`, and exactly-once API prefix joining. |  |  |

### Implementation Phase 2 — Restructure the connection form

- **GOAL-003**: Make the connection target and address semantics self-explanatory before users enter credentials or test the connection.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | In `apps/desktop/src/components/connection/ConnectionDialog.vue`, add refs for implementation, version mode, history enablement, console-auth mode, and separate console credentials. Initialize them in `resetNacosFields`. |  |  |
| TASK-011 | Hide the generic connection-string row for `db_type === "nacos"`; remove the PostgreSQL placeholder from the Nacos workflow. |  |  |
| TASK-012 | Add `Nacos` and `r-nacos` implementation controls. Add `Auto detect`, `2.x`, and `3.x` controls only when `Nacos` is selected. |  |  |
| TASK-013 | Replace the static primary label and help paragraph with computed profile-specific label, placeholder, concise hint, and accepted-example text. Remove `NACOS_DEFAULT_CONSOLE_URL` and the `8085` prefill. |  |  |
| TASK-014 | Move Context Path to the Advanced tab. Show the effective derived path next to the primary address and provide an explicit `Customize Context Path` control. |  |  |
| TASK-015 | Render the r-nacos configuration-history section only for r-nacos. Gate console address and console-auth fields behind an `Enable configuration history` switch. |  |  |
| TASK-016 | Add `Use primary credentials` and `Separate credentials` console-auth modes. Disable inheritance with an explanatory message when primary authentication is `None`. |  |  |
| TASK-017 | Add an endpoint preview below each address, for example `Requests will use http://host:8848/nacos/...`, without displaying credentials or tokens. |  |  |
| TASK-018 | Add corrective actions for swapped r-nacos endpoints. Moving a value must be explicit and reversible within the unsaved form state. |  |  |
| TASK-019 | Change Nacos-specific wording from `database` to `namespace` for the visibility selector and related labels while preserving the underlying generic visibility storage. |  |  |

### Implementation Phase 3 — Persist configuration and enforce capabilities

- **GOAL-004**: Carry the new explicit semantics through TypeScript, Rust, desktop, and Web code without breaking existing saved connections.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | Update `buildNacosAdminConfig` and `resetNacosFields` in `ConnectionDialog.vue` to serialize and restore the optional implementation, version mode, and console-auth configuration. |  |  |
| TASK-021 | Extend `NacosAdminConfig` and related auth types in `crates/dbx-core/src/nacos/config.rs`; validate separate console credentials and fall back to inherited primary credentials only when explicitly configured. |  |  |
| TASK-022 | Update `NacosOpenApiAdmin::rnacos_console_token` to use the effective console-auth configuration instead of requiring primary `UsernamePassword` authentication. |  |  |
| TASK-023 | Update `NacosOpenApiAdmin::test_connection` so confirmed r-nacos reports history support only when a console endpoint and effective console credentials are available. Return a machine-readable reason code for unavailable history. |  |  |
| TASK-024 | Extend frontend `NacosCapabilities` with an optional history-unavailable reason and map it to targeted messages such as `console URL missing` or `console credentials missing`. |  |  |
| TASK-025 | Keep old configs readable: missing implementation/version fields use auto behavior; missing console-auth fields retain the current credential-inheritance behavior. Add serde-default tests. |  |  |
| TASK-026 | Verify `nacos_admin_config_for_connection` applies SSH/proxy transport independently to the normalized primary endpoint and normalized console endpoint after the data-model change. |  |  |

### Implementation Phase 4 — Detection feedback, translations, and regression coverage

- **GOAL-005**: Complete the user feedback loop and verify all supported deployment profiles.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | Extend the successful Nacos test result to show detected implementation, detected version when available, effective primary endpoint, Context Path, and history capability. |  |  |
| TASK-028 | Add or update all Nacos form and validation translations in `en.ts`, `zh-CN.ts`, `zh-TW.ts`, `ja.ts`, `es.ts`, `it.ts`, and `pt-BR.ts`. Do not retain the generic `8085` claim in any locale. |  |  |
| TASK-029 | Add component-level tests for profile switching, legacy-config loading, URL movement, history toggle behavior, and separate console-auth validation. |  |  |
| TASK-030 | Run the automated checks declared in Section 6 and record results in the PR description. |  |  |
| TASK-031 | Manually verify the deployment matrix in `deploy/database/nacos/2.5`, `deploy/database/nacos/3.2`, and the r-nacos v0.8.5 compose configuration before marking this plan Completed. |  |  |

## 3. Alternatives

- **ALT-001**: Keep one generic address field and only rewrite the help text. Rejected because the field would still mean a shared server address for Nacos 2.x, a management/console address for Nacos 3.x, and a compatible API address for r-nacos.
- **ALT-002**: Detect every deployment exclusively from its port. Rejected because Docker, SSH, reverse proxies, and load balancers routinely remap ports.
- **ALT-003**: Expose separate OpenAPI and Admin API fields for every Nacos connection. Rejected because it increases form complexity for Nacos 2.x and most users do not need to understand the distinction; profile-specific single-endpoint inputs are clearer.
- **ALT-004**: Continue sharing primary Nacos credentials with the r-nacos console unconditionally. Rejected because r-nacos defaults can leave OpenAPI unauthenticated while the independent console still requires login.
- **ALT-005**: Persist only a single full URL and remove `contextPath` from storage. Rejected for this iteration because it creates a larger migration and compatibility surface; the UI can accept a full URL while retaining the existing internal representation.

## 4. Dependencies

- **DEP-001**: Existing Nacos connection form and submission pipeline in `apps/desktop/src/components/connection/ConnectionDialog.vue`.
- **DEP-002**: Existing Nacos frontend helpers and tests in `apps/desktop/src/lib/nacos/nacosAdmin.ts` and `apps/desktop/src/lib/__tests__/nacos/nacosAdmin.spec.ts`.
- **DEP-003**: Existing Rust Nacos adapter, configuration model, and registry in `crates/dbx-core/src/nacos/`.
- **DEP-004**: Existing connection transport-layer management in `crates/dbx-core/src/connection.rs`.
- **DEP-005**: Existing desktop and Web backend command forwarding in `src-tauri/src/commands/nacos_cmd.rs`, `crates/dbx-web/src/routes/nacos.rs`, and `apps/desktop/src/lib/backend/`.
- **DEP-006**: r-nacos v0.8.5 source checked into the ignored local reference directory `tmp/r-nacos` for protocol verification.

## 5. Files

- **FILE-001**: `apps/desktop/src/components/connection/ConnectionDialog.vue` — profile selection, dynamic form sections, normalization feedback, validation, serialization, and Nacos-specific wording.
- **FILE-002**: `apps/desktop/src/lib/nacos/nacosAdmin.ts` — pure URL/profile normalization and endpoint classification helpers.
- **FILE-003**: `apps/desktop/src/lib/__tests__/nacos/nacosAdmin.spec.ts` — table-driven normalization and regression tests.
- **FILE-004**: `apps/desktop/src/types/nacos.ts` — implementation, version, console-auth, capability-reason, and config types.
- **FILE-005**: `apps/desktop/src/i18n/locales/*.ts` — dynamic labels, hints, warnings, corrective actions, capability reasons, and test-result summaries.
- **FILE-006**: `crates/dbx-core/src/nacos/config.rs` — persisted optional profile fields, effective console authentication, validation, and canonical endpoint handling.
- **FILE-007**: `crates/dbx-core/src/nacos/http.rs` — r-nacos console URL joining, effective console credentials, capability reasons, and protocol tests.
- **FILE-008**: `crates/dbx-core/src/nacos/types.rs` — capability reason and connection-info response fields.
- **FILE-009**: `crates/dbx-core/src/connection.rs` — verification that both normalized endpoints continue to use independent transport chains and cleanup.
- **FILE-010**: `apps/desktop/src/components/nacos/NacosAdminConsole.vue` — history availability messages derived from structured capability reasons.
- **FILE-011**: `plan/design-nacos-connection-form-v1.md` — this implementation plan and completion record.

## 6. Testing

- **TEST-001**: Run `pnpm exec vitest run apps/desktop/src/lib/__tests__/nacos/nacosAdmin.spec.ts` and require all normalization cases to pass.
- **TEST-002**: Run component tests covering implementation/version switching, field visibility, separate console credentials, and legacy config loading.
- **TEST-003**: Run `pnpm typecheck` and require exit code `0`.
- **TEST-004**: Run `pnpm lint` and require no new warnings in modified files.
- **TEST-005**: Run `cargo test -p dbx-core nacos` and require all Nacos adapter, config, capability, CAPTCHA, history, and transport tests to pass.
- **TEST-006**: Run `cargo fmt --all -- --check` and `git diff --check` and require exit code `0` for both.
- **TEST-007**: Manually create a Nacos 2.x connection using both `http://host:8848` plus derived `/nacos` and the pasted full URL `http://host:8848/nacos/`; verify identical effective endpoints.
- **TEST-008**: Manually create a Nacos 3.x connection using the official console default `http://host:8080`, the repository compose host mapping, and a pasted `/next/` browser URL; verify normalization and management operations.
- **TEST-009**: Manually create an r-nacos connection with `http://host:8848/nacos` as primary and both `http://host:10848` and `http://host:10848/rnacos/` as console inputs; verify history list, detail, compare, and rollback.
- **TEST-010**: Verify the r-nacos default-auth split: primary OpenAPI authentication `None`, separate console username/password, CAPTCHA login, token expiry, and automatic retry.
- **TEST-011**: Verify old saved connections that contain only `serverAddr`, `contextPath`, and `auth` load without mutation and connect successfully.
- **TEST-012**: Verify SSH, HTTP proxy, SOCKS proxy, and supported chained transports route the primary endpoint and r-nacos console endpoint independently and clean up both chains after disconnect.
- **TEST-013**: Verify error and preview text never includes primary passwords, console passwords, access tokens, CAPTCHA tokens, or URL userinfo.

## 7. Risks & Assumptions

- **RISK-001**: Automatic path stripping can break custom reverse proxies if arbitrary suffixes are removed. Mitigation: strip only documented UI suffixes and retain unknown prefixes as explicit custom paths.
- **RISK-002**: Persisting inferred implementation/version values can alter existing connections unexpectedly. Mitigation: inference is display-only until explicit Save or accepted correction.
- **RISK-003**: Separate console credentials increase the sensitive configuration surface. Mitigation: reuse existing password encryption, masking, and redaction mechanisms and add targeted leakage tests.
- **RISK-004**: Nacos 3 console and server may be deployed independently or behind one gateway. Mitigation: never require fixed ports and retain an Advanced custom Context Path.
- **RISK-005**: Component state can retain stale fields when switching profiles. Mitigation: define deterministic reset rules and test every profile transition in both directions.
- **ASSUMPTION-001**: Users know whether they installed Nacos or r-nacos, even if they do not know the exact Nacos major version.
- **ASSUMPTION-002**: The existing `external_config` JSON can safely accept optional fields without a database schema migration.
- **ASSUMPTION-003**: Nacos 2.x continues to support the legacy `/nacos/v1` management and OpenAPI endpoints used by the current adapter.
- **ASSUMPTION-004**: r-nacos v0.8.5 remains the compatibility baseline for console CAPTCHA and configuration-history behavior in this issue.

## 8. Related Specifications / Further Reading

- [GitHub issue #4061](https://github.com/t8y2/dbx/issues/4061)
- [Nacos Console Manual](https://nacos.io/docs/latest/manual/admin/console/)
- [Nacos Console API](https://nacos.io/docs/latest/manual/admin/console-api/)
- [Nacos OpenAPI Guide](https://nacos.io/docs/open-api/)
- [Nacos Docker deployment examples](https://github.com/nacos-group/nacos-docker)
- [r-nacos repository](https://github.com/nacos-group/r-nacos)
- Local protocol reference: `tmp/r-nacos/README.md`, `tmp/r-nacos/src/console/api.rs`, and `tmp/r-nacos/src/console/login_api.rs`
