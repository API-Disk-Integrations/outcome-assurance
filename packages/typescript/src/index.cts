/**
 * Outcome Assurance API client.
 *
 * Zero dependencies — uses the platform `fetch`, so it runs in Node 18+, Deno,
 * Bun and Cloudflare Workers without a bundler argument.
 *
 * NOT the browser: these endpoints need an API key and deliberately do not
 * support CORS. A key in front-end JavaScript is a published key.
 *
 * ```ts
 * const client = new OutcomeAssurance()                   // reads OUTCOME_ASSURANCE_API_KEY
 * const client = new OutcomeAssurance({ apiKey: 'sp_live_…', baseUrl: 'https://…' })
 * ```
 *
 * The service origin is assigned by the host at deploy time, so it is read from
 * `OUTCOME_ASSURANCE_BASE_URL` when set. Pass `baseUrl` explicitly otherwise —
 * this client will not guess a hostname, because a wrong one fails at the worst
 * possible moment.
 *
 * Start free-key verification, then claim the token delivered by email:
 * ```
 * curl -X POST "$OUTCOME_ASSURANCE_BASE_URL/v1/keys" \
 *   -H 'content-type: application/json' -d '{"email":"you@example.com","source":{"source":"sdk","medium":"typescript"}}'
 * ```
 *
 * Money in a world-state is an INTEGER number of minor units carrying its own
 * currency: `{ "amountMinor": 118800, "currency": "USD" }`. Currency is compared
 * before any amount.
 */

/** The deployed service. Override with OUTCOME_ASSURANCE_BASE_URL or `baseUrl`. */
const PRODUCTION_ORIGIN = 'https://outcomeassurance-api.com'

const envBaseUrl = (): string => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.['OUTCOME_ASSURANCE_BASE_URL'] ?? PRODUCTION_ORIGIN
}

/** The production origin, or `OUTCOME_ASSURANCE_BASE_URL` when set. */
export const DEFAULT_BASE_URL: string = envBaseUrl()

// --- domain types ----------------------------------------------------------

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** Recognised only as an object with EXACTLY these two keys. */
export interface Money {
  amountMinor: number
  currency: string
}

/**
 * `changed`, `unchanged`, `increased` and `decreased` compare both states; the
 * rest read one — the before-state for a precondition, the after-state for a
 * postcondition. A comparative op used as a precondition is unevaluable.
 */
export type AssertionOp =
  | 'equals' | 'not_equals' | 'changed' | 'unchanged' | 'increased' | 'decreased'
  | 'within_range' | 'matches' | 'exists' | 'absent' | 'count_equals'

export interface Assertion {
  /** Used to pair assertions across runs during regression comparison. */
  id?: string
  op: AssertionOp
  /** Dotted path. Array elements are numeric segments: `orders.1188.lines.0.sku`. */
  path: string
  description?: string
  /** `equals` / `not_equals`: the required value. `count_equals`: the required length. */
  value?: JsonValue
  /** `increased` / `decreased`: the EXACT required movement. Omit to require only the direction. */
  by?: number
  min?: number
  max?: number
  pattern?: string
  /** Required when a numeric comparison targets money. The API will not guess. */
  currency?: string
}

export type AssertionPhase = 'precondition' | 'postcondition'
export type AssertionOutcome = 'satisfied' | 'failed' | 'unevaluable'

/** Branch on these, not on `detail`. `unevaluable` codes are never a pass. */
export type AssertionCode =
  | 'satisfied'
  | 'not_equal' | 'unexpectedly_equal' | 'unchanged' | 'changed'
  | 'not_increased' | 'not_decreased' | 'delta_mismatch' | 'out_of_range'
  | 'pattern_not_matched' | 'path_absent' | 'path_present' | 'count_mismatch'
  | 'no_after_state' | 'needs_before_and_after' | 'path_missing'
  | 'currency_mismatch' | 'currency_undeclared' | 'type_mismatch'
  | 'not_numeric' | 'not_an_array' | 'not_a_string'
  | 'fractional_minor_units' | 'subject_too_long'

export interface AssertionResult {
  index: number
  id?: string
  phase: AssertionPhase
  op: AssertionOp
  path: string
  description?: string
  outcome: AssertionOutcome
  code: AssertionCode
  detail: string
  /** Always populated, so a failure is diagnosable without a re-run. */
  expected: JsonValue | null
  actual: JsonValue | null
}

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type ChangeKind = 'added' | 'removed' | 'modified'

export type SideEffectCode =
  | 'monetary_change' | 'destructive_field' | 'state_removed'
  | 'access_change' | 'value_modified' | 'value_added' | 'forbidden_change'

export interface SideEffect {
  path: string
  change: ChangeKind
  before: JsonValue | null
  after: JsonValue | null
  severity: Severity
  code: SideEffectCode
  detail: string
  source: 'state_diff' | 'policy'
}

export type EffectKind =
  | 'payment' | 'refund' | 'transfer' | 'delete' | 'email' | 'notification'
  | 'external_write' | 'create' | 'update' | 'external_read' | 'other'

export interface ObservedEffect {
  kind: EffectKind
  target: string
  description?: string
  /** Integer minor units. Requires `currency`. */
  amountMinor?: number
  currency?: string
}

/** `target` may be a glob: `*` is one segment, `**` any number. */
export interface DeclaredEffect {
  kind: EffectKind
  target: string
}

export interface EffectFinding {
  index: number
  kind: EffectKind
  target: string
  description?: string
  accounted: boolean
  severity: Severity
  code: 'declared' | 'undeclared_effect' | 'forbidden_effect'
  detail: string
  amountMinor?: number
  currency?: string
}

export type PolicyKind = 'forbid_change' | 'forbid_effect' | 'max_delta'

/** Postconditions say what MUST become true. Policies say what must NOT happen. */
export interface Policy {
  id?: string
  kind: PolicyKind
  path?: string
  effect?: EffectKind
  target?: string
  maxDeltaMinor?: number
  currency?: string
}

export interface PolicyViolation {
  index: number
  id?: string
  kind: PolicyKind
  code: 'forbidden_change' | 'forbidden_effect' | 'delta_exceeded' | 'currency_mismatch' | 'currency_changed'
  severity: Severity
  detail: string
  path?: string
  observed: JsonValue | null
  limit: JsonValue | null
}

export interface AgentRun {
  runId: string
  agent?: string
  outcome: { id: string; description?: string }
  /** REQUIRED. Without it nothing can be diffed and side-effect detection cannot run. */
  before: JsonObject
  /** Absent yields an `unverifiable` verdict. It is never assumed unchanged. */
  after?: JsonObject
  preconditions?: Assertion[]
  postconditions?: Assertion[]
  expectedChanges?: string[]
  ignorePaths?: string[]
  declaredEffects?: DeclaredEffect[]
  observedEffects?: ObservedEffect[]
  policies?: Policy[]
  /** A prior run of the SAME outcome. Compared, and not billed separately. */
  baseline?: AgentRun
  evaluatedAt?: string
  metadata?: Record<string, string>
}

/** `certified` is true only for `achieved`. */
export type Verdict =
  | 'achieved' | 'achieved_with_side_effects' | 'partially_achieved'
  | 'not_achieved' | 'unverifiable'

export type VerdictReason =
  | 'all_postconditions_satisfied' | 'unaccounted_side_effects' | 'policy_violated'
  | 'some_postconditions_failed' | 'all_postconditions_failed'
  | 'no_postconditions_declared' | 'no_after_state'
  | 'precondition_failed' | 'postconditions_unevaluable'

export interface AssertionSummary {
  total: number
  satisfied: number
  failed: number
  unevaluable: number
  results: AssertionResult[]
}

export interface SideEffectSummary {
  /** False when no after-state was supplied — nothing could be diffed. */
  evaluated: boolean
  changes: number
  accounted: number
  ignored: number
  unaccounted: number
  maxSeverity: Severity | null
  bySeverity: Record<Severity, number>
  /** Sorted worst-first, then by path. */
  findings: SideEffect[]
}

export interface EffectSummary {
  total: number
  accounted: number
  unaccounted: number
  maxSeverity: Severity | null
  findings: EffectFinding[]
}

export interface PolicySummary {
  evaluated: number
  compliant: boolean
  violations: PolicyViolation[]
}

export type RegressionStatus = 'unchanged' | 'improved' | 'regressed' | 'inconclusive'

export interface RegressionChange {
  kind:
    | 'verdict_changed' | 'assertion_regressed' | 'assertion_recovered'
    | 'assertion_added' | 'assertion_removed'
    | 'side_effect_introduced' | 'side_effect_resolved'
    | 'policy_violation_introduced' | 'policy_violation_resolved'
  detail: string
  path?: string
  from?: string
  to?: string
  severity?: Severity
}

export interface RegressionReport {
  status: RegressionStatus
  baselineRunId: string
  baselineVerdict: Verdict
  candidateVerdict: Verdict
  code: string
  detail: string
  changes: RegressionChange[]
}

export interface AssuranceReport {
  runId: string
  outcomeId: string
  agent?: string
  verdict: Verdict
  verdictReason: VerdictReason
  detail: string
  /** True only for `achieved`. The one field to branch on for "did it work". */
  certified: boolean
  preconditions: AssertionSummary
  postconditions: AssertionSummary
  sideEffects: SideEffectSummary
  effects: EffectSummary
  policy: PolicySummary
  regression?: RegressionReport
  evaluatedAt: string
  warnings: string[]
}

export interface AssureResponse {
  count: number
  certified: number
  verdicts: Record<Verdict, number>
  runs: AssuranceReport[]
  requestId: string
}

export type ApiErrorCode =
  | 'invalid_api_key' | 'missing_api_key' | 'quota_exceeded' | 'rate_limited'
  | 'invalid_request' | 'not_found' | 'method_not_allowed' | 'payload_too_large'
  | 'conflict' | 'internal_error'

/**
 * Thrown for any non-2xx response.
 *
 * NOT thrown when a verdict comes back `not_achieved` or `unverifiable` — those
 * are successful answers to a legitimate question, and the second one is the
 * whole point. On a 400, `details.path` names the exact field that failed.
 */
export class ApiError extends Error {
  // Declared as fields rather than constructor parameter properties: those are
  // unsupported by strip-only TypeScript runtimes (Node --experimental-strip-types),
  // and an SDK should run without a build step.
  readonly status: number
  readonly code: ApiErrorCode | 'unknown'
  // `| undefined` is explicit because exactOptionalPropertyTypes rejects
  // assigning an optional constructor argument to a bare optional field.
  readonly requestId?: string | undefined
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode | 'unknown', message: string, requestId?: string, details?: unknown) {
    super(`[${status} ${code}] ${message}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

export interface ClientOptions {
  apiKey?: string
  /** Required unless OUTCOME_ASSURANCE_BASE_URL is set. */
  baseUrl?: string
  /** Milliseconds. Default 30000. */
  timeoutMs?: number
  fetch?: typeof fetch
}

/** Optional acquisition metadata. Invalid values are ignored by the service. */
export interface KeySource {
  source?: string
  medium?: string
  campaign?: string
  content?: string
}

export class OutcomeAssurance {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: ClientOptions = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    if (!baseUrl) {
      throw new Error(
        'No base URL. Pass { baseUrl } or set OUTCOME_ASSURANCE_BASE_URL to the service origin. ' +
          'This client does not guess a hostname.',
      )
    }
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    const key = options.apiKey ?? env?.['OUTCOME_ASSURANCE_API_KEY']
    if (!key) {
      throw new Error(
        'No API key. Pass { apiKey } or set OUTCOME_ASSURANCE_API_KEY. ' +
          `Request a free key verification email: POST ${baseUrl}/v1/keys`,
      )
    }
    this.apiKey = key
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  private async request(method: string, path: string, body?: unknown, auth = true): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        signal: controller.signal,
        headers: {
          ...(auth ? { authorization: `Bearer ${this.apiKey}` } : {}),
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      const text = await res.text()
      const json = text ? JSON.parse(text) : {}
      if (!res.ok) {
        const e = json?.error ?? {}
        throw new ApiError(res.status, e.code ?? 'unknown', e.message ?? text.slice(0, 200), e.requestId, e.details)
      }
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  /** Liveness and deployed version. Does not require a key. */
  async health(): Promise<{ ok: boolean; product: string; version: string }> {
    return this.request('GET', '/health', undefined, false)
  }

  /**
   * Assure one run, or up to 100. Billed one assured run per entry.
   *
   * A `baseline` attached to a run is assured by the same engine and compared,
   * and is not billed separately.
   */
  async assure(run: AgentRun | AgentRun[]): Promise<AssureResponse> {
    return this.request('POST', '/v1/runs', Array.isArray(run) ? { runs: run } : { run })
  }

  /** The real engine with no key: one run, at most 20 assertions and 200 state values. */
  async demoAssure(run: AgentRun): Promise<{ run: AssuranceReport; requestId: string }> {
    return this.request('POST', '/v1/demo/assure', { run }, false)
  }

  /** Every operator, verdict, reason code, severity and policy kind, with meanings. */
  async assertionTypes(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/assertion-types', undefined, false)
  }

  /** Request a free sandbox key; this emails a claim token. Claiming returns the key once. */
  static async createKey(
    email: string,
    opts: { baseUrl?: string; name?: string; source?: KeySource } = {},
  ): Promise<Record<string, unknown>> {
    const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
    if (!baseUrl) throw new Error('No base URL. Pass { baseUrl } or set OUTCOME_ASSURANCE_BASE_URL.')
    const res = await fetch(baseUrl.replace(/\/$/, '') + '/v1/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        ...(opts.name ? { name: opts.name } : {}),
        source: opts.source ?? { source: 'sdk', medium: 'typescript' },
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'unknown', json?.error?.message ?? 'failed', json?.error?.requestId)
    return json
  }
}

export default OutcomeAssurance

// ---8<--- BEGIN GENERATED BY tools/gen-sdk.mjs — DO NOT EDIT BELOW ---8<---
// Everything between these markers is written from openapi.json. Change the
// service, regenerate the contract, then re-run `npm run gen:sdk`.

/** The contract this SDK was generated from. */
export const API_TITLE = "Outcome Assurance API"
export const API_VERSION = "1.0.0"
/** The origin the published contract names. `DEFAULT_BASE_URL` resolves to this unless overridden. */
export const API_BASE_URL = "https://outcomeassurance-api.com"

/**
 * Every `error.code` the contract publishes.
 *
 * The runtime companion to the `ApiErrorCode` union: a union is erased at
 * compile time, so a caller wanting to test an unknown string against the
 * documented set had nothing to test it with.
 */
export const ERROR_CODES = ["invalid_api_key", "missing_api_key", "quota_exceeded", "rate_limited", "invalid_request", "not_found", "method_not_allowed", "payload_too_large", "conflict", "internal_error"] as const

/** One published operation, exactly as the contract describes it. */
export interface OperationDescriptor {
  readonly operationId: string
  readonly method: string
  readonly path: string
  readonly summary: string
  /** True when the operation requires an API key. False does NOT mean public — see `authKind`. */
  readonly auth: boolean
  /**
   * The credential the operation actually takes.
   *
   * `api_key` — the bearer token this client sends.
   * `session` — the dashboard session cookie, plus `x-csrf-token` on writes.
   *             An API key is REFUSED: these endpoints change what you are
   *             billed and read your payment history, and a key that lives
   *             in CI must not reach them. Call them from the signed-in
   *             dashboard, not from this SDK.
   * `signature` — machine-to-machine; not callable by API consumers.
   * `public` — no credential at all.
   */
  readonly authKind: 'api_key' | 'session' | 'signature' | 'public'
  readonly pathParams: readonly string[]
  readonly queryParams: readonly string[]
  readonly requiredBodyFields: readonly string[]
  readonly successStatus: number | null
  /** Property names of the documented 2xx body. A field absent here is a field the service does not promise. */
  readonly responseFields: readonly string[]
}

/**
 * The published surface, generated. Ships with the client so an integration
 * can assert against the contract instead of against a changelog.
 */
export const OPERATIONS: readonly OperationDescriptor[] = [
  {
    operationId: "get/",
    method: "GET",
    path: "/",
    summary: "Service index — endpoints, auth and error format",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "postApiBillingWebhook",
    method: "POST",
    path: "/api/billing/webhook",
    summary: "Square billing events, forwarded by the shared hub",
    auth: false,
    authKind: "signature",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "getHealth",
    method: "GET",
    path: "/health",
    summary: "Liveness and deployed version",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "getV1AssertionTypes",
    method: "GET",
    path: "/v1/assertion-types",
    summary: "Every assertion operator, verdict and reason code the engine emits",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["assertionOps", "verdicts", "verdictReasons", "assertionOutcomes", "failureCodes", "unevaluableCodes", "sideEffectSeverity", "sideEffectCodes", "effectKinds", "policyKinds", "regressionStatuses", "limits"],
  },
  {
    operationId: "postV1Checkout",
    method: "POST",
    path: "/v1/checkout",
    summary: "Start a hosted Square checkout for a paid tier",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["tier"],
    successStatus: 200,
    responseFields: ["checkoutUrl", "tier", "sku", "requestId"],
  },
  {
    operationId: "postV1DemoAssure",
    method: "POST",
    path: "/v1/demo/assure",
    summary: "Public demo — assure one agent run without a key",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["run"],
    successStatus: 200,
    responseFields: ["run", "requestId"],
  },
  {
    operationId: "getV1Invoices",
    method: "GET",
    path: "/v1/invoices",
    summary: "Every invoice issued against this account, newest first (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "count", "note", "invoices", "requestId"],
  },
  {
    operationId: "getV1Keys",
    method: "GET",
    path: "/v1/keys",
    summary: "List your API keys for this API",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "accountId", "keys", "requestId"],
  },
  {
    operationId: "postV1Keys",
    method: "POST",
    path: "/v1/keys",
    summary: "Request a free sandbox API key (sends a verification email)",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["email"],
    successStatus: 202,
    responseFields: ["status", "email", "expiresAt", "next", "message", "requestId"],
  },
  {
    operationId: "postV1KeysIdRevoke",
    method: "POST",
    path: "/v1/keys/{id}/revoke",
    summary: "Revoke one of your API keys",
    auth: true,
    authKind: "api_key",
    pathParams: ["id"],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["id", "status", "message", "requestId"],
  },
  {
    operationId: "postV1KeysIdRotate",
    method: "POST",
    path: "/v1/keys/{id}/rotate",
    summary: "Replace one of your API keys with a new secret",
    auth: true,
    authKind: "api_key",
    pathParams: ["id"],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 201,
    responseFields: ["apiKey", "keyId", "replaced", "product", "quotaPerPeriod", "plan", "warning", "requestId"],
  },
  {
    operationId: "postV1KeysClaim",
    method: "POST",
    path: "/v1/keys/claim",
    summary: "Exchange an emailed claim token for the API key",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["token"],
    successStatus: 201,
    responseFields: ["apiKey", "keyId", "product", "quotaPerPeriod", "plan", "warning", "usage", "requestId"],
  },
  {
    operationId: "getV1Payments",
    method: "GET",
    path: "/v1/payments",
    summary: "Every payment attempted against this account and how it went (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "count", "note", "payments", "requestId"],
  },
  {
    operationId: "postV1Runs",
    method: "POST",
    path: "/v1/runs",
    summary: "Assure agent runs — did they achieve the requested outcome?",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["count", "certified", "verdicts", "runs", "requestId"],
  },
  {
    operationId: "getV1Subscription",
    method: "GET",
    path: "/v1/subscription",
    summary: "Your current plan, billing window and available changes (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "subscribed", "status", "plan", "pendingPlan", "planChangesGoThrough", "baseFeeOwner", "cancellation", "tiers", "requestId"],
  },
  {
    operationId: "postV1SubscriptionCancel",
    method: "POST",
    path: "/v1/subscription/cancel",
    summary: "Cancel this plan and end metered access (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["canceled", "canceledAt", "entitlement", "money", "finalInvoice", "requestId"],
  },
  {
    operationId: "postV1SubscriptionPlan",
    method: "POST",
    path: "/v1/subscription/plan",
    summary: "Upgrade or downgrade to another plan (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["planId"],
    successStatus: 200,
    responseFields: ["changed", "direction", "from", "to", "entitlement", "billing", "requestId"],
  },
  {
    operationId: "getV1Usage",
    method: "GET",
    path: "/v1/usage",
    summary: "Your consumption and remaining allowance for this period",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "tier", "status", "unit", "period", "included", "used", "ceiling", "remaining", "overageSoFarMinor", "spendCapMinor", "requestId"],
  },
]
// ---8<--- END GENERATED BY tools/gen-sdk.mjs ---8<---
