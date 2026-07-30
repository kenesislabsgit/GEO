# Deployment

## Vercel

1. Import the repo into Vercel.
2. Set all variables from `.env.example`.
3. Deploy.
4. Point Dodo webhook to `https://<domain>/api/billing/webhook`.
5. Point Inngest sync to `https://<domain>/api/inngest`.
6. Apply Supabase migrations before first production traffic.

## Required production secrets

- Supabase URL + anon + service role
- OpenAI key (minimum for free scans)
- Upstash Redis
- Turnstile site + secret
- Dodo API + webhook keys + product IDs
- Resend
- Inngest event + signing keys
- `ADMIN_EMAILS`
- `NEXT_PUBLIC_APP_URL`

## Post-deploy checks

```bash
pnpm build
pnpm test
curl -I https://<domain>/
```

Run one free scan on a public domain and confirm:

- progress updates
- report score
- clickable citations
- methodology note visible
- premium teasers do not leak locked payloads

## Dodo test mode

Keep `DODO_PAYMENTS_ENVIRONMENT=test_mode` until live products are verified. Use hosted checkout and signed webhooks; never trust client plan fields.
