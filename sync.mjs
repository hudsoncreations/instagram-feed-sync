// Sync the latest posts from an Instagram Business/Creator account into a
// static-site repo: first-party images + a committed feed.json the site can
// render as ordinary local data. Uses the official Instagram Platform API
// with a long-lived access token (see docs/SETUP.md).
//
// Zero runtime dependencies — runs on Node 20+ built-ins alone. `sharp` is
// OPTIONAL: the composite action installs it from this repo's lockfile
// (`npm ci`) to optimize images to 640px grid thumbnails; without it the
// script still works, storing Instagram's originals (~1080px) as-is.
//
// Config via env vars (action.yml maps its inputs onto these):
//   INSTAGRAM_TOKEN  (required) long-lived Instagram Platform API token
//   IG_POST_COUNT    posts to keep                (default 12)
//   IG_FEED_JSON     output JSON path             (default src/lib/data/instagram-feed.json)
//   IG_IMAGE_DIR     image output dir             (default static/images/instagram)
//   IG_IMAGE_PUBLIC  public URL prefix for images (default /images/instagram)
//   IG_API_VERSION   Graph API version            (default v23.0)

import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_VERSION = process.env.IG_API_VERSION || 'v23.0';
const POST_COUNT = Number(process.env.IG_POST_COUNT || 12);
const FEED_JSON = process.env.IG_FEED_JSON || 'src/lib/data/instagram-feed.json';
const IMAGE_DIR = process.env.IG_IMAGE_DIR || 'static/images/instagram';
const IMAGE_PUBLIC = process.env.IG_IMAGE_PUBLIC || '/images/instagram';

// Optional image optimizer — installed by the action; may be absent elsewhere.
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  // Not installed: store originals. Deliberately silent.
}

/** Map raw API media items to the posts we persist. VIDEO posts use their
 *  thumbnail; items with no usable image are dropped. `sourceUrl` (the
 *  expiring CDN URL) is for download only and must never reach feed.json. */
export function mapMediaToPosts(media, imagePublic = IMAGE_PUBLIC) {
  return media
    .map((m) => ({
      id: m.id,
      caption: m.caption || '',
      permalink: m.permalink,
      timestamp: m.timestamp,
      type: m.media_type,
      image: `${imagePublic}/${m.id}.jpg`,
      sourceUrl: m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url
    }))
    .filter((p) => Boolean(p.sourceUrl));
}

/** Compare only what affects the rendered feed: post ids (incl. order)
 *  and captions. Extra properties on either side are ignored, so persisted
 *  posts and freshly mapped posts compare cleanly. */
export function feedChanged(oldPosts, newPosts) {
  const sig = (posts) => JSON.stringify(posts.map((p) => [p.id, p.caption]));
  return sig(oldPosts) !== sig(newPosts);
}

/** Images belonging to posts that rotated out of the feed. Only .jpg files
 *  are candidates, so stray non-image files are never deleted. */
export function staleImages(files, posts) {
  const keep = new Set(posts.map((p) => `${p.id}.jpg`));
  return files.filter((f) => f.endsWith('.jpg') && !keep.has(f));
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    // Never echo the URL (it carries the token) — path + body are enough to debug.
    throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}: ${body}`);
  }
  return JSON.parse(body);
}

const fileExists = (p) => access(p).then(() => true, () => false);

async function optimize(buffer) {
  if (!sharp) return buffer;
  return sharp(buffer).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
}

export async function main() {
  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) throw new Error('INSTAGRAM_TOKEN is not set');

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
  const url =
    `https://graph.instagram.com/${API_VERSION}/me/media` +
    `?fields=${fields}&limit=${POST_COUNT}&access_token=${encodeURIComponent(token)}`;
  const { data = [] } = await fetchJson(url);
  const posts = mapMediaToPosts(data);

  let existing = { updatedAt: null, posts: [] };
  try {
    existing = JSON.parse(await readFile(FEED_JSON, 'utf8'));
  } catch {
    // First run / missing file — treat as empty feed.
  }

  // An empty API result against a populated feed is far more likely an API
  // hiccup than the account deleting every post — fail loudly, keep last good.
  if (posts.length === 0 && (existing.posts || []).length > 0) {
    throw new Error('API returned no usable posts while the existing feed is populated — refusing to wipe it');
  }

  if (!feedChanged(existing.posts || [], posts)) {
    console.log(`No changes — feed already has these ${posts.length} posts.`);
    return;
  }

  // Images first, feed.json last: if a download fails we exit non-zero with
  // the previous feed intact, and the next run self-heals.
  await mkdir(IMAGE_DIR, { recursive: true });
  for (const post of posts) {
    const file = path.join(IMAGE_DIR, `${post.id}.jpg`);
    if (await fileExists(file)) continue; // caption edits don't re-download
    const res = await fetch(post.sourceUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading image for post ${post.id}`);
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) {
      // e.g. a CAROUSEL_ALBUM whose media_url is a video — without sharp it
      // would be stored verbatim as a broken .jpg.
      throw new Error(`Unexpected content-type "${type}" downloading image for post ${post.id}`);
    }
    await writeFile(file, await optimize(Buffer.from(await res.arrayBuffer())));
  }

  const persisted = posts.map(({ sourceUrl, ...p }) => p);
  await writeFile(
    FEED_JSON,
    JSON.stringify({ updatedAt: new Date().toISOString(), posts: persisted }, null, 2) + '\n'
  );

  for (const f of staleImages(await readdir(IMAGE_DIR), persisted)) {
    await unlink(path.join(IMAGE_DIR, f));
  }
  console.log(`Synced ${persisted.length} posts (${sharp ? 'optimized' : 'original size'}).`);
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Node network errors are a bare "fetch failed" with the detail in
    // err.cause (never token-bearing — causes are network-level messages).
    const cause = err.cause?.message ? ` (${err.cause.message})` : '';
    console.error(err.message + cause);
    process.exit(1);
  });
}
