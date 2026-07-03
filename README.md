# instagram-feed-sync

GitHub Action that keeps a static site's Instagram feed fresh — **first-party, free, no widget vendor**.

On a schedule, it pulls the latest posts from an Instagram Business/Creator account via the **official Instagram Platform API**, optimizes the images, and commits them into your repo alongside a `feed.json`. Your site renders the feed as ordinary local data:

- **No third-party requests from visitors' browsers** — no widget scripts, no cookies, nothing to consent-gate (GDPR/PECR-friendly), and Meta never sees your visitors.
- **No view caps, no branding, no vendor pricing risk** — the things hosted feed widgets charge for.
- **No runtime infrastructure** — if your site deploys on push (Netlify, Vercel, Forge, Pages…), the sync commit *is* the deploy trigger.

```
Instagram ──(official API, cron)──▶ sync action ──▶ images + feed.json committed
                                                        │ (only when posts changed)
                                                        ▼
                                             your existing deploy-on-push
```

A companion **refresh action** keeps the 60-day API token alive indefinitely.

## Quickstart

**Once per agency/account:** create a (free) Meta developer app — see [docs/SETUP.md](docs/SETUP.md). One app serves unlimited sites.

**Per site** (SETUP.md has the click-by-click):

1. The Instagram account must be **Business or Creator** (free switch).
2. Add it as an **Instagram Tester** on the Meta app; the account owner accepts the invite. (Tester accounts work in Development mode — no Meta App Review, ever.)
3. Generate the long-lived token → repo secret `INSTAGRAM_TOKEN`.
4. Create a fine-grained PAT (that repo only, **Secrets: read/write**) → repo secret `SECRETS_ADMIN_PAT`.
5. Copy the two workflows from [`templates/`](templates/) into `.github/workflows/`, adjusting the path inputs to your framework.
6. Render `feed.json` in your site (see the contract below). Done — the feed updates within ~6 h of every post.

### Path defaults & framework examples

| Input | Default (SvelteKit) | Astro example |
|---|---|---|
| `feed-json` | `src/lib/data/instagram-feed.json` | `src/data/instagram-feed.json` |
| `image-dir` | `static/images/instagram` | `public/images/instagram` |
| `image-public-path` | `/images/instagram` | `/images/instagram` |

## Sync action

```yaml
- uses: hudsoncreations/instagram-feed-sync@v1
  with:
    token: ${{ secrets.INSTAGRAM_TOKEN }}
```

| Input | Required | Default | Notes |
|---|---|---|---|
| `token` | yes | — | Long-lived Instagram Platform API token (pass a secret) |
| `feed-json` | no | `src/lib/data/instagram-feed.json` | Where the JSON is written |
| `image-dir` | no | `static/images/instagram` | Where images are written |
| `image-public-path` | no | `/images/instagram` | URL prefix recorded in the JSON |
| `post-count` | no | `12` | Latest N posts kept |
| `api-version` | no | `v23.0` | Instagram Graph API version |

The action only *writes files* — committing/pushing stays in your workflow (see the template), so you control deploy behaviour.

## Refresh action

```yaml
- uses: hudsoncreations/instagram-feed-sync/refresh@v1
  with:
    token: ${{ secrets.INSTAGRAM_TOKEN }}
    github-pat: ${{ secrets.SECRETS_ADMIN_PAT }}
```

Run it **weekly** (template included): tokens live 60 days and each refresh resets the clock, so weekly gives ~8 attempts per lifetime. Optional inputs: `secret-name` (default `INSTAGRAM_TOKEN`), `repository` (default: the calling repo).

## The feed.json contract

```json
{
  "updatedAt": "2026-07-03T13:03:08.961Z",
  "posts": [
    {
      "id": "18068983280382792",
      "caption": "Kiwi nails just entered the chat…",
      "permalink": "https://www.instagram.com/p/…/",
      "timestamp": "2026-07-01T10:00:00+0000",
      "type": "IMAGE",
      "image": "/images/instagram/18068983280382792.jpg"
    }
  ]
}
```

- `image` is a site-relative path; images are optimized to 640 px JPEG grid thumbnails (~100 KB each). Old images are deleted as posts rotate out, so the repo doesn't grow unboundedly.
- `type` is `IMAGE`, `VIDEO` (image = the video's thumbnail) or `CAROUSEL_ALBUM` (image = the first slide). Posts with no usable image are dropped.
- `caption` makes good alt text — truncate to ~140 chars (mind the emoji: slice by code points, not UTF-16 units).

## Safety properties

Designed so **a failed sync can never break the site** — it just keeps serving the last synced feed while GitHub emails you:

- Empty API response against a populated feed → **refuses to wipe** and fails loudly.
- Non-image downloads (e.g. a carousel whose first slide is a video) → rejected, never stored as a broken `.jpg`.
- Images are written before `feed.json`, so a partial failure leaves the previous feed intact and the next run self-heals.
- Commits happen only when the post set actually changed.
- The token never appears in logs (errors carry the URL path only; the refresh action masks the new token before use).
- `sharp` (the optimizer) is pinned in **this** repo's lockfile — consumer repos carry zero dependencies.

## Maintenance (per consuming site)

- **Routine: nothing.** Sync and refresh are automated; failures email the workflow author.
- **Yearly (~5 min):** renew the fine-grained PAT (GitHub emails you first).
- **If a client changes their Instagram password / revokes the app:** regenerate the token in the Meta dashboard and update the secret (~5 min). The site keeps serving the last feed meanwhile.

Meta retires Graph API versions roughly every two years — that bump happens *here* (the `api-version` default), gets released, and consumers pick it up via `@v1` with no changes on their side.

## Versioning

Pin the major tag: `@v1`. It only ever moves to backwards-compatible releases (the `feed.json` contract and input names are the interface). Breaking changes would ship as `@v2` with a migration note.

## Licence

[MIT](LICENSE) © Hudson Creations
