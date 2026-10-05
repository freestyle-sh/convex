# Convex × Freestyle API review

Reviewed September 29, 2026 against first-party documentation, Management API
OpenAPI, installed SDK sources, and live Freestyle probes.

## Agent component and UI

[Convex Agent](https://docs.convex.dev/agents/overview) supplies persistent
threads, messages, tool calling, streaming, and workflow integration. Convex Monitor
uses @convex-dev/agent 0.7.3 and its React useUIMessages hook.

There is an official
[agent playground](https://docs.convex.dev/agents/playground) and
[chat UI example](https://github.com/get-convex/agent/blob/main/example/ui/chat/ChatStreaming.tsx).
The playground is intended for development/debugging and exposes broader thread
inspection. It is not a ready-made production operations console. Convex Monitor uses a
custom project/evidence/access UI around the official message hooks, without
exposing the playground API.

Convex also has
[tool approval primitives](https://docs.convex.dev/agents/tool-approval). Here
the approval is a persisted, immutable operation record because expiration,
policy revisions, distinct write credentials, and single execution claims are
part of the security boundary.

## APIs

| Surface                                                                              | Authentication / scope                                               | Useful operations                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Management API](https://docs.convex.dev/management-api/overview), api.convex.dev/v1 | Bearer team, personal, or OAuth token                                | List projects/deployments, provision, create keys, domains, roles |
| [Deployment API](https://docs.convex.dev/deployment-api/overview)                    | Deployment credentials; admin requests use Authorization: Convex KEY | Functions, data, configuration, integrations                      |
| [Public function HTTP API](https://docs.convex.dev/http-api)                         | Function-specific auth or deployment admin auth                      | /api/query, /api/mutation, /api/action                            |
| CLI log polling                                                                      | Deployment auth                                                      | /api/stream_function_logs?cursor=…                                |
| [HTTP actions](https://docs.convex.dev/functions/http-actions)                       | Application-defined                                                  | Incoming signed webhooks on .convex.site                          |

The log-poll endpoint is verified in Convex 1.46.0 CLI sources. It returns
entries and newCursor. Do not label it a stable, documented Management API. CLI
event timestamps are seconds; log-stream webhook timestamps are milliseconds.
Webhook console levels use log_level; function failures use status=failure and
error_message.

## Permissions are actually available

[Deploy keys](https://docs.convex.dev/cli/deploy-key-types) can carry selected
actions. The live [Management OpenAPI](https://api.convex.dev/v1/openapi.json)
defines:

```http
POST /v1/deployments/{deployment_name}/create_deploy_key
Authorization: Bearer <trusted control-plane token>
```

```json
{
  "name": "convex-monitor-log-reader",
  "allowedActions": ["deployment:logs:view"],
  "expiresAt": 1900000000000
}
```

The timestamp illustrates the shape; choose an appropriate short expiry at least
30 minutes in the future. Set allowedActions explicitly. Do not mint a default
broad key and describe it as read-only.

[Role actions](https://docs.convex.dev/team-management/role-actions) distinguish
log, metric, audit-log, environment, data, deployment, and internal function
permissions. Native internal-query/internal-mutation permissions are categories;
they are not an arbitrary function-name-and-argument capability system. Convex Monitor
adds exact function allowlists and edge body binding for that finer scope.

[Custom roles](https://docs.convex.dev/team-management/custom-roles) are a
Business/Enterprise beta. Statements can select project/deployment IDs and
deployment types. Prefer immutable IDs over renameable slugs. Within a role,
deny overrides allow; across roles, an allow can win. Project Admin grants
additional authority independently. A restrictive role alone is not proof of
least privilege when other roles exist.

Team/OAuth token authority follows the authorizing member. Existing deploy keys
retain their own issued permissions despite later creator-role changes;
delete/revoke or expire those keys explicitly.

[OAuth applications](https://docs.convex.dev/platform-apis/oauth-applications)
offer project- or team-scoped authorization-code flows with S256 PKCE. Project
scope is preferable for customer connections. OAuth tokens still inherit the
authorizer's authority; project scope alone is not logs-only access. For a later
multi-tenant version, keep OAuth tokens exclusively in the trusted controller
and mint separate scoped deployment credentials for sandbox jobs.

## Proactivity

The requested [Crons component](https://www.convex.dev/components/crons)
supports dynamic intervals and cron expressions. Its
[source](https://github.com/get-convex/crons) provides transactional
register/get/list/delete operations; Convex's built-in crons are static. Convex Monitor
previously used dynamic per-project intervals. Autonomous runs are now disabled;
the component remains only for cleaning up old schedules. Native retention and
run watchdogs remain active.

[Log streams](https://docs.convex.dev/production/integrations/log-streams)
support custom webhook URLs and HMAC-SHA256 signatures. They require Pro and can
drop or duplicate events. Bound request size and deduplicate both exact
deliveries and individual events.

For a larger version, add deployment-change events, source-code context,
metrics/latency baselines, durable workflows for long investigations, and
notifications only on new or materially changed findings. The current demo
surfaces findings in its UI; it sends no emails or chat messages.

## Freestyle credential injection

[Outbound TLS](https://www.freestyle.sh/docs/vms/network/tls-outbound#reach-a-domain-with-a-secret-injected)
allows a trusted controller to install a rule naming one VM, a hostname, and
injected headers. Values are sealed and redacted on readback. For the broader VM
model, start with the
[Freestyle docs skill/onboarding](https://www.freestyle.sh/docs/onboard.md).

The installed Freestyle 0.2.16 SDK also supports exact HTTP method/path matching
and JSON Patch transforms. A root replacement pins the entire query/mutation
body. These are verified by the live smoke test; matching selects transforms
rather than denying every nonmatching request.

Install grants **after VM creation**. During validation, inline TLS rule
creation returned a rule but left the guest without its hostname mapping.
Explicit rule creation against the new VM ID installed the mapping and passed
the injection and body-binding test. No broad-egress firewall fallback or
disabled TLS verification was needed.

Freestyle can update a rule to swap its secret, but a previously compromised VM
would inherit the new capability. This demo instead swaps workers:
credential-free analysis, log reader, query runner, and approved writer are
distinct disposable VMs. Agent-authored code never inherits a privileged
execution environment.
