# Outcome Assurance API

Verify whether agents achieved requested business outcomes via pre/postconditions, policy checks, side-effect detection and regression tests.

- [Product and pricing](https://outcomeassurance-api.com/?utm_source=github&utm_medium=developer&utm_campaign=outcome-assurance-github&utm_content=readme#pricing)
- [Developer documentation](https://outcomeassurance-api.com/docs?utm_source=github&utm_medium=developer&utm_campaign=outcome-assurance-github&utm_content=readme)
- [Create a free account](https://outcomeassurance-api.com/signup?utm_source=github&utm_medium=developer&utm_campaign=outcome-assurance-github&utm_content=readme)
- [OpenAPI contract](https://outcomeassurance-api.com/openapi.json)
- [Postman collection](./postman_collection.json)

## Quickstart

### 1. Request a free-key verification email

```bash
curl -X POST https://outcomeassurance-api.com/v1/keys \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","source":{"source":"github","medium":"developer","campaign":"outcome-assurance-github","content":"readme"}}'
```

The service returns `202 Accepted` and sends a one-time claim link. Follow the
email, or exchange its token with `POST /v1/keys/claim`. The API key is shown
once after verification; store it securely. No card is required for the free
sandbox. Current free allowance: **500 assured runs/month**.

### 2. Make the first product call

```bash
curl -X POST https://outcomeassurance-api.com/v1/runs \
  -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"run":{
        "runId":"run_7f3a91","agent":"refund-bot@2.3.1",
        "outcome":{"id":"refund_order_1188"},
        "before":{"orders":{"1188":{"status":"paid","refundId":null}},
                  "customers":{"c_44":{"tier":"pro"}}},
        "after":{"orders":{"1188":{"status":"refunded","refundId":"re_9021"}},
                 "customers":{"c_44":{"tier":"free"}}},
        "postconditions":[
          {"op":"equals","path":"orders.1188.status","value":"refunded"},
          {"op":"exists","path":"orders.1188.refundId"}],
        "policies":[{"kind":"forbid_change","path":"customers.**.tier"}]}}'
```

## SDKs

The repository includes dependency-light client files that point to the current
contract and canonical product domain:

- [Python SDK](./sdk/python/outcome_assurance.py) — reads `OUTCOME_ASSURANCE_API_KEY`
- [TypeScript SDK](./sdk/typescript/index.ts)

Copy the file you need into your project. The OpenAPI document remains the
authoritative operation and schema contract.

## Authentication and errors

API operations use `Authorization: Bearer <API_KEY>` (or `x-api-key` where
documented). Dashboard-session operations and signed service webhooks are not
callable with a customer API key. Public demo and health operations require no
credential. Errors use a stable `error.code` plus a request ID for support.

## Distribution attribution

The key request above identifies this README with the stable tuple
`github / developer / outcome-assurance-github / readme`. The Postman collection and both
SDKs carry their own source metadata. Attribution is used to compare qualified
activation and retained use; it is not evidence that this channel already
performs.

## License

[MIT](./LICENSE)
