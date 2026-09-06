# Outcome Assurance API

Verify whether an agent achieved its intended outcome while surfacing forbidden state changes and undeclared external effects.

- [Product and pricing](https://outcomeassurance-api.com/?utm_source=github&utm_medium=developer&utm_campaign=outcome-assurance-github&utm_content=readme#pricing)
- [Developer documentation](https://outcomeassurance-api.com/docs?utm_source=github&utm_medium=developer&utm_campaign=outcome-assurance-github&utm_content=readme)
- [Create a free account](https://outcomeassurance-api.com/signup?utm_source=github&utm_medium=developer&utm_campaign=outcome-assurance-github&utm_content=readme)
- [OpenAPI contract](https://outcomeassurance-api.com/openapi.json)
- [Postman collection](./postman_collection.json)

## Quickstart: assure one synthetic refund-agent run without an account

The public demo runs the real production engine, stores nothing, meters nothing,
and requires no API key. The data below is synthetic.

```bash
cat > request.json <<'JSON'
{
  "run": {
    "runId": "run_7f3a91",
    "agent": "refund-bot@2.3.1",
    "outcome": {
      "id": "refund_order_1188",
      "description": "Refund order 1188 in full to the original payment method"
    },
    "before": {
      "orders": {
        "1188": {
          "status": "paid",
          "total": {
            "amountMinor": 118800,
            "currency": "USD"
          },
          "refundId": null
        }
      },
      "customers": {
        "c_44": {
          "email": "customer@example.com",
          "tier": "pro"
        }
      },
      "ledger": {
        "payouts": {
          "amountMinor": 4820000,
          "currency": "USD"
        }
      }
    },
    "after": {
      "orders": {
        "1188": {
          "status": "refunded",
          "total": {
            "amountMinor": 118800,
            "currency": "USD"
          },
          "refundId": "re_9021"
        }
      },
      "customers": {
        "c_44": {
          "email": "customer@example.com",
          "tier": "free"
        }
      },
      "ledger": {
        "payouts": {
          "amountMinor": 4701200,
          "currency": "USD"
        }
      }
    },
    "preconditions": [
      {
        "op": "equals",
        "path": "orders.1188.status",
        "value": "paid"
      }
    ],
    "postconditions": [
      {
        "op": "equals",
        "path": "orders.1188.status",
        "value": "refunded"
      },
      {
        "op": "exists",
        "path": "orders.1188.refundId"
      }
    ],
    "expectedChanges": [
      "ledger.payouts"
    ],
    "declaredEffects": [
      {
        "kind": "refund",
        "target": "psp.example"
      }
    ],
    "observedEffects": [
      {
        "kind": "refund",
        "target": "psp.example",
        "amountMinor": 118800,
        "currency": "USD"
      },
      {
        "kind": "email",
        "target": "customer@example.com",
        "description": "Refund confirmation"
      }
    ],
    "policies": [
      {
        "id": "no-tier-edits",
        "kind": "forbid_change",
        "path": "customers.**.tier"
      }
    ]
  }
}
JSON

curl -sS -X POST https://outcomeassurance-api.com/v1/demo/assure \
  -H 'content-type: application/json' \
  --data-binary @request.json
```

Selected fields from the deterministic 200 response (evaluated at
`2026-09-06T20:30:00.000Z` for this example):

```json
{
  "run": {
    "runId": "run_7f3a91",
    "outcomeId": "refund_order_1188",
    "verdict": "achieved_with_side_effects",
    "verdictReason": "policy_violated",
    "detail": "Every postcondition held, but the run broke an explicit policy. The outcome was achieved and a prohibition was not respected.",
    "certified": false,
    "postconditions": {
      "total": 2,
      "satisfied": 2,
      "failed": 0,
      "unevaluable": 0,
      "results": [
        {
          "index": 0,
          "phase": "postcondition",
          "op": "equals",
          "path": "orders.1188.status",
          "outcome": "satisfied",
          "code": "satisfied",
          "detail": "\"orders.1188.status\" equals the expected value.",
          "expected": "refunded",
          "actual": "refunded"
        },
        {
          "index": 1,
          "phase": "postcondition",
          "op": "exists",
          "path": "orders.1188.refundId",
          "outcome": "satisfied",
          "code": "satisfied",
          "detail": "\"orders.1188.refundId\" is present in the after-state.",
          "expected": true,
          "actual": "re_9021"
        }
      ]
    },
    "sideEffects": {
      "evaluated": true,
      "changes": 4,
      "accounted": 3,
      "ignored": 0,
      "unaccounted": 1,
      "maxSeverity": "critical",
      "bySeverity": {
        "low": 0,
        "medium": 0,
        "high": 0,
        "critical": 1
      },
      "findings": [
        {
          "path": "customers.c_44.tier",
          "change": "modified",
          "before": "pro",
          "after": "free",
          "severity": "critical",
          "code": "forbidden_change",
          "detail": "\"customers.c_44.tier\" changed and a policy forbids it. A declaration does not override a prohibition.",
          "source": "policy"
        }
      ]
    },
    "effects": {
      "total": 2,
      "accounted": 1,
      "unaccounted": 1,
      "maxSeverity": "high",
      "findings": [
        {
          "index": 0,
          "kind": "refund",
          "target": "psp.example",
          "amountMinor": 118800,
          "currency": "USD",
          "accounted": true,
          "severity": "low",
          "code": "declared",
          "detail": "Declared: a \"refund\" against \"psp.example\" was part of the requested outcome."
        },
        {
          "index": 1,
          "kind": "email",
          "target": "customer@example.com",
          "description": "Refund confirmation",
          "accounted": false,
          "severity": "high",
          "code": "undeclared_effect",
          "detail": "The run performed an \"email\" against \"customer@example.com\" that the outcome never declared."
        }
      ]
    },
    "policy": {
      "evaluated": 1,
      "compliant": false,
      "violations": [
        {
          "index": 0,
          "id": "no-tier-edits",
          "kind": "forbid_change",
          "severity": "critical",
          "code": "forbidden_change",
          "detail": "\"customers.c_44.tier\" was modified and a policy forbids any change under \"customers.**.tier\".",
          "path": "customers.c_44.tier",
          "observed": "free",
          "limit": "pro"
        }
      ]
    },
    "warnings": []
  },
  "requestId": "req_example"
}
```

The first useful result is `achieved_with_side_effects`: the refund postconditions passed, but the agent downgraded the customer tier and sent an undeclared email. That prevents a false-success signal.

### Input contract

Supply before/after state, explicit assertions, declared effects, observed effects, and policies. Use synthetic data in the demo; do not paste production secrets or customer records into examples.

## Create and use a free API key

```bash
curl -sS -X POST https://outcomeassurance-api.com/v1/keys \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","name":"github-quickstart","source":{"source":"github","medium":"developer","campaign":"outcome-assurance-github","content":"readme"}}'

curl -sS -X POST https://outcomeassurance-api.com/v1/keys/claim \
  -H 'content-type: application/json' \
  -d '{"token":"PASTE_ONE_TIME_TOKEN_FROM_EMAIL"}'

export API_KEY='PASTE_API_KEY_FROM_CLAIM_RESPONSE'

curl -sS -X POST https://outcomeassurance-api.com/v1/runs \
  -H "Authorization: Bearer $API_KEY" \
  -H 'content-type: application/json' \
  --data-binary @request.json
```

The key-request response is `202` and sends a one-time claim token by email. The
claim response is the only place the raw API key is returned; store it securely
and never commit it. The authenticated endpoint accepts the same request shape
as the demo, with the documented production batch limits and metering.

## What to do next

Gate the workflow on `verdict` and inspect stable policy/effect codes before allowing the run to count as successful.

The stable code catalogue for this product is `GET /v1/assertion-types`. Branch on
machine-readable codes, not human-readable detail text.

## Authentication and troubleshooting

- `401`: the authenticated endpoint did not receive a valid active key. Set
  `API_KEY` to the value returned once by `/v1/keys/claim`; do not send a claim
  token as a bearer credential.
- `400 invalid_request`: read `error.details.path` when present and correct the
  named field. This service does **not** emit `422`; a client-side schema tool may
  show `422` before a request reaches the API.
- `429 quota_exceeded` or `429 rate_limited`: inspect `error.code`, honor
  `Retry-After` when present, and retry with bounded exponential backoff. A quota
  exhaustion requires a later quota window or plan change, not a tight retry loop.

Every API error has `{"error":{"code","message","requestId"}}`. Share the
request ID with support, never the API key, claim token, or customer payload.

## SDKs and authoritative contract

- Python: `./sdk/python/outcome_assurance.py`
- TypeScript: `./sdk/typescript/index.ts`

The live OpenAPI document is authoritative for operations and schemas. This
overlay is a customer-runnable example aligned to that contract; it does not
replace the OpenAPI document or claim that an unresolved external contract is
authoritative.

## Distribution attribution

The key request above uses `outcome-assurance-github` as the stable GitHub campaign. The
Postman collection uses `postman / collection / outcome-assurance-postman /
public-collection`. These are attribution inputs, not claims of customers or
revenue.

## License

[MIT](./LICENSE)
