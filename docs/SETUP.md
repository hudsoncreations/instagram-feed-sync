# Meta app & token setup

The one-time dashboard work behind the feed. Steps 1–2 happen **once per agency/account**; steps 3–6 repeat **per site/client**.

**Prerequisites:** a Meta developer account (developers.facebook.com → log in with a Facebook account you durably control → accept the developer terms), and the client's Instagram account switched to **Business or Creator** (free, in Instagram's settings).

## 1. Create the app (once)

1. Go to https://developers.facebook.com/apps/creation/
2. **App details:** a client-agnostic name (e.g. `Acme Feeds`) + contact email → Next.
3. **Use cases:** pick **"Manage messaging & content on Instagram"** (filter: Content management). Despite the publish/messaging-flavoured description, this is the Instagram Platform API use case carrying the read-your-own-media scope (`instagram_business_basic`). *Not* "Embed … content in other websites" — that's the oEmbed API (per-post HTML embeds, App Review required, can't list latest posts).
4. **Business:** skip connecting a Business Portfolio if offered — not needed for the tester model.
5. Continue through **Requirements** → **Overview** → create the app.

The app stays in **Development mode** forever — with tester accounts (below) that's fully supported and means **no Meta App Review, no business verification**. Dismiss any prompts to start those.

## 2. Find the Instagram API setup page (once)

App dashboard → **Instagram** in the sidebar (add the product if it isn't there) → **API setup with Instagram business login**.

## 3. Add the client's account as a tester (per client)

1. On that setup page (or App roles → Roles → Add people → **Instagram Tester**), add the client's Instagram handle.
2. **Client accepts the invite** — easiest on the web, logged in as their account: https://www.instagram.com/accounts/manage_access/ → **Tester invites** → Accept. (In-app: Settings → Website permissions → Apps and websites.)

## 4. Generate the long-lived token (per client)

1. Back on **API setup with Instagram business login**, the accepted account shows a **Generate token** button.
2. Click it — the client (or you on a screen-share) logs into that Instagram account in the popup and approves. Scope: `instagram_business_basic` (read-only profile + media).
3. Copy the token. It's valid **60 days**; the refresh workflow extends it indefinitely from then on.
4. Optional sanity check: paste it into https://developers.facebook.com/tools/debug/accesstoken/

## 5. Store the token as a repo secret (per client)

From the site's repo (or GitHub → repo → Settings → Secrets and variables → Actions):

```bash
gh secret set INSTAGRAM_TOKEN   # paste the token when prompted
```

## 6. Create the secrets-admin PAT (per repo; renew yearly)

The refresh workflow writes the new token back into the repo's secrets, which the default workflow credentials can't do:

1. GitHub → your account Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
2. Name it after the site (e.g. `acme-instagram-secrets`); expiry 1 year (GitHub emails you before it lapses); Repository access: **Only select repositories** → that repo; Permissions: **Secrets → Read and write**.
3. `gh secret set SECRETS_ADMIN_PAT`

## Handy facts / recovery

- **Token dead?** (client changed password, revoked the app, or refresh missed the 60-day window — expired tokens can't be refreshed): repeat step 4 + `gh secret set INSTAGRAM_TOKEN`. The live site keeps serving the last synced feed meanwhile; nothing visitor-facing breaks.
- **Refresh endpoint** (what the refresh action calls): `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` — returns a fresh 60-day token; the token must be >24 h old.
- **Media endpoint** (what the sync action calls): `GET https://graph.instagram.com/{version}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit={n}`
- **Rate limits:** 200 calls/hour per account — a 6-hourly sync uses 4/day.
- **Next client:** steps 3–6 against the same app.
