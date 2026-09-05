"""
Outcome Assurance API client.

Zero dependencies beyond the standard library — no requests, no httpx — so it
drops into any environment without a dependency negotiation.

    from outcome_assurance import OutcomeAssurance

    client = OutcomeAssurance()             # reads OUTCOME_ASSURANCE_API_KEY
    client = OutcomeAssurance("sp_live_…")  # or pass it explicitly

The service origin is assigned by the host at deploy time, so it is read from
``OUTCOME_ASSURANCE_BASE_URL`` when set. Pass ``base_url`` explicitly otherwise —
this client will not guess a hostname, because a wrong one fails at the worst
possible moment.

Start free-key verification, then claim the token delivered by email:

    curl -X POST "$OUTCOME_ASSURANCE_BASE_URL/v1/keys" \
      -H 'content-type: application/json' -d '{"email":"you@example.com","source":{"source":"sdk","medium":"python"}}'

Money in a world-state is an INTEGER number of minor units carrying its own
currency: ``{"amountMinor": 118800, "currency": "USD"}``. Currency is compared
before any amount, because 1000 JPY and 1000 USD are not the same number in
different clothes.
"""

from __future__ import annotations

import json as _json
import os
import urllib.error
import urllib.request

__all__ = [
    "OutcomeAssurance",
    "ApiError",
    "ASSERTION_OPS",
    "VERDICTS",
    "VERDICT_REASONS",
    "FAILURE_CODES",
    "UNEVALUABLE_CODES",
    "SEVERITIES",
    "EFFECT_KINDS",
    "POLICY_KINDS",
    "REGRESSION_STATUSES", "API_TITLE", "API_VERSION", "API_BASE_URL", "ERROR_CODES", "OPERATIONS"]

#: Set OUTCOME_ASSURANCE_BASE_URL, or pass base_url. Empty means "not configured".
DEFAULT_BASE_URL = os.environ.get("OUTCOME_ASSURANCE_BASE_URL", "https://outcomeassurance-api.com")

#: The four comparative operators read BOTH states; the rest read one.
ASSERTION_OPS = (
    "equals",
    "not_equals",
    "changed",        # comparative
    "unchanged",      # comparative
    "increased",      # comparative
    "decreased",      # comparative
    "within_range",
    "matches",
    "exists",
    "absent",
    "count_equals",
)

#: Only "achieved" sets report["certified"].
VERDICTS = (
    "achieved",
    "achieved_with_side_effects",
    "partially_achieved",
    "not_achieved",
    "unverifiable",   # nothing was certified, and nothing is claimed
)

VERDICT_REASONS = (
    "all_postconditions_satisfied",
    "unaccounted_side_effects",
    "policy_violated",
    "some_postconditions_failed",
    "all_postconditions_failed",
    "no_postconditions_declared",
    "no_after_state",
    "precondition_failed",
    "postconditions_unevaluable",
)

#: The assertion was decided, and the answer was no.
FAILURE_CODES = (
    "not_equal",
    "unexpectedly_equal",
    "unchanged",
    "changed",
    "not_increased",
    "not_decreased",
    "delta_mismatch",
    "out_of_range",
    "pattern_not_matched",
    "path_absent",
    "path_present",
    "count_mismatch",
)

#: The assertion could not be decided. Never counted as a pass.
UNEVALUABLE_CODES = (
    "no_after_state",
    "needs_before_and_after",
    "path_missing",
    "currency_mismatch",
    "currency_undeclared",
    "type_mismatch",
    "not_numeric",
    "not_an_array",
    "not_a_string",
    "fractional_minor_units",
    "subject_too_long",
)

SEVERITIES = ("low", "medium", "high", "critical")

EFFECT_KINDS = (
    "payment", "refund", "transfer", "delete", "email", "notification",
    "external_write", "create", "update", "external_read", "other",
)

POLICY_KINDS = ("forbid_change", "forbid_effect", "max_delta")

REGRESSION_STATUSES = ("unchanged", "improved", "regressed", "inconclusive")


class ApiError(Exception):
    """
    Raised for any non-2xx response.

    NOT raised when a verdict comes back ``not_achieved`` or ``unverifiable`` —
    those are successful answers to a legitimate question, and the second one is
    the whole point of the product. On a 400, ``details["path"]`` names the exact
    field that failed validation.
    """

    def __init__(self, status: int, code: str, message: str, request_id: str | None = None, details=None):
        super().__init__(f"[{status} {code}] {message}")
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        self.details = details


class OutcomeAssurance:
    def __init__(self, api_key: str | None = None, *, base_url: str = DEFAULT_BASE_URL, timeout: float = 30.0):
        if not base_url:
            raise ValueError(
                "No base URL. Pass base_url=... or set OUTCOME_ASSURANCE_BASE_URL to the "
                "service origin. This client does not guess a hostname."
            )
        key = api_key or os.environ.get("OUTCOME_ASSURANCE_API_KEY")
        if not key:
            raise ValueError(
                "No API key. Pass one to OutcomeAssurance(...) or set "
                "OUTCOME_ASSURANCE_API_KEY. Request a free key verification email: POST "
                '{}/v1/keys with {{"email": "you@example.com"}}'.format(base_url.rstrip("/"))
            )
        self.api_key = key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # -- transport ---------------------------------------------------------
    def _request(self, method: str, path: str, *, body=None, auth: bool = True) -> dict:
        data = _json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        if auth:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return _json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                err = _json.loads(raw).get("error", {})
            except Exception:
                err = {}
            raise ApiError(
                e.code, err.get("code", "unknown"), err.get("message", raw[:200]),
                err.get("requestId"), err.get("details"),
            ) from None

    # -- API ---------------------------------------------------------------
    def health(self) -> dict:
        """Liveness and deployed version. Does not require a key."""
        return self._request("GET", "/health", auth=False)

    def assure(self, run_or_runs) -> dict:
        """
        Assure one agent run, or a list of up to 100.

        Billed one assured run per entry. A ``baseline`` attached to a run is
        assured by the same engine and compared, and is not billed separately —
        pricing the comparison would only teach you to skip it.

        Returns per run: the verdict, every assertion result with its own reason
        code plus ``expected`` and ``actual``, every leaf-level change no
        postcondition accounted for, the observed effects that were never
        declared, and the policy violations.
        """
        body = {"runs": run_or_runs} if isinstance(run_or_runs, list) else {"run": run_or_runs}
        return self._request("POST", "/v1/runs", body=body)

    def demo_assure(self, run: dict) -> dict:
        """The real engine with no key: one run, at most 20 assertions and 200 state values."""
        return self._request("POST", "/v1/demo/assure", body={"run": run}, auth=False)

    def assertion_types(self) -> dict:
        """Every operator, verdict, reason code, severity and policy kind, with meanings."""
        return self._request("GET", "/v1/assertion-types", auth=False)

    @staticmethod
    def create_key(
        email: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        name: str | None = None,
        source: dict[str, str] | None = None,
    ) -> dict:
        """Request a free sandbox key; this emails a claim token. Claiming returns the key once."""
        if not base_url:
            raise ValueError("No base URL. Pass base_url=... or set OUTCOME_ASSURANCE_BASE_URL.")
        payload: dict = {
            "email": email,
            "source": source if source is not None else {"source": "sdk", "medium": "python"},
        }
        if name:
            payload["name"] = name
        req = urllib.request.Request(
            base_url.rstrip("/") + "/v1/keys", data=_json.dumps(payload).encode(), method="POST"
        )
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as res:
            return _json.loads(res.read().decode())

# ---8<--- BEGIN GENERATED BY tools/gen-sdk.mjs — DO NOT EDIT BELOW ---8<---
# Everything between these markers is written from openapi.json. Change the
# service, regenerate the contract, then re-run `npm run gen:sdk`.

#: The contract this SDK was generated from.
API_TITLE = "Outcome Assurance API"
API_VERSION = "1.0.0"
#: The origin the published contract names.
API_BASE_URL = "https://outcomeassurance-api.com"

#: Every ``error.code`` the contract publishes. Branch on these, never on the message.
ERROR_CODES = ("invalid_api_key", "missing_api_key", "quota_exceeded", "rate_limited", "invalid_request", "not_found", "method_not_allowed", "payload_too_large", "conflict", "internal_error")

#: The published surface, generated. Ships with the client so an integration
#: can assert against the contract instead of against a changelog.
OPERATIONS = (
    {
        "operation_id": "get/",
        "method": "GET",
        "path": "/",
        "summary": "Service index — endpoints, auth and error format",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "postApiBillingWebhook",
        "method": "POST",
        "path": "/api/billing/webhook",
        "summary": "Square billing events, forwarded by the shared hub",
        "auth": False,
        "auth_kind": "signature",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "getHealth",
        "method": "GET",
        "path": "/health",
        "summary": "Liveness and deployed version",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "getV1AssertionTypes",
        "method": "GET",
        "path": "/v1/assertion-types",
        "summary": "Every assertion operator, verdict and reason code the engine emits",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("assertionOps", "verdicts", "verdictReasons", "assertionOutcomes", "failureCodes", "unevaluableCodes", "sideEffectSeverity", "sideEffectCodes", "effectKinds", "policyKinds", "regressionStatuses", "limits"),
    },
    {
        "operation_id": "postV1Checkout",
        "method": "POST",
        "path": "/v1/checkout",
        "summary": "Start a hosted Square checkout for a paid tier",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("tier",),
        "success_status": 200,
        "response_fields": ("checkoutUrl", "tier", "sku", "requestId"),
    },
    {
        "operation_id": "postV1DemoAssure",
        "method": "POST",
        "path": "/v1/demo/assure",
        "summary": "Public demo — assure one agent run without a key",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("run",),
        "success_status": 200,
        "response_fields": ("run", "requestId"),
    },
    {
        "operation_id": "getV1Invoices",
        "method": "GET",
        "path": "/v1/invoices",
        "summary": "Every invoice issued against this account, newest first (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "count", "note", "invoices", "requestId"),
    },
    {
        "operation_id": "getV1Keys",
        "method": "GET",
        "path": "/v1/keys",
        "summary": "List your API keys for this API",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "accountId", "keys", "requestId"),
    },
    {
        "operation_id": "postV1Keys",
        "method": "POST",
        "path": "/v1/keys",
        "summary": "Request a free sandbox API key (sends a verification email)",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("email",),
        "success_status": 202,
        "response_fields": ("status", "email", "expiresAt", "next", "message", "requestId"),
    },
    {
        "operation_id": "postV1KeysIdRevoke",
        "method": "POST",
        "path": "/v1/keys/{id}/revoke",
        "summary": "Revoke one of your API keys",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": ("id",),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("id", "status", "message", "requestId"),
    },
    {
        "operation_id": "postV1KeysIdRotate",
        "method": "POST",
        "path": "/v1/keys/{id}/rotate",
        "summary": "Replace one of your API keys with a new secret",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": ("id",),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 201,
        "response_fields": ("apiKey", "keyId", "replaced", "product", "quotaPerPeriod", "plan", "warning", "requestId"),
    },
    {
        "operation_id": "postV1KeysClaim",
        "method": "POST",
        "path": "/v1/keys/claim",
        "summary": "Exchange an emailed claim token for the API key",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("token",),
        "success_status": 201,
        "response_fields": ("apiKey", "keyId", "product", "quotaPerPeriod", "plan", "warning", "usage", "requestId"),
    },
    {
        "operation_id": "getV1Payments",
        "method": "GET",
        "path": "/v1/payments",
        "summary": "Every payment attempted against this account and how it went (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "count", "note", "payments", "requestId"),
    },
    {
        "operation_id": "postV1Runs",
        "method": "POST",
        "path": "/v1/runs",
        "summary": "Assure agent runs — did they achieve the requested outcome?",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("count", "certified", "verdicts", "runs", "requestId"),
    },
    {
        "operation_id": "getV1Subscription",
        "method": "GET",
        "path": "/v1/subscription",
        "summary": "Your current plan, billing window and available changes (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "subscribed", "status", "plan", "pendingPlan", "planChangesGoThrough", "baseFeeOwner", "cancellation", "tiers", "requestId"),
    },
    {
        "operation_id": "postV1SubscriptionCancel",
        "method": "POST",
        "path": "/v1/subscription/cancel",
        "summary": "Cancel this plan and end metered access (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("canceled", "canceledAt", "entitlement", "money", "finalInvoice", "requestId"),
    },
    {
        "operation_id": "postV1SubscriptionPlan",
        "method": "POST",
        "path": "/v1/subscription/plan",
        "summary": "Upgrade or downgrade to another plan (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("planId",),
        "success_status": 200,
        "response_fields": ("changed", "direction", "from", "to", "entitlement", "billing", "requestId"),
    },
    {
        "operation_id": "getV1Usage",
        "method": "GET",
        "path": "/v1/usage",
        "summary": "Your consumption and remaining allowance for this period",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "tier", "status", "unit", "period", "included", "used", "ceiling", "remaining", "overageSoFarMinor", "spendCapMinor", "requestId"),
    },
)
# ---8<--- END GENERATED BY tools/gen-sdk.mjs ---8<---
