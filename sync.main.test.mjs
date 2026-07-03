// End-to-end tests for main(). Kept in a separate file because node --test
// runs each file in its own process, letting us set env vars BEFORE importing
// the module (it reads IG_FEED_JSON / IG_IMAGE_DIR at import time).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'ig-sync-'));
const FEED_JSON = path.join(dir, 'feed.json');
const IMAGE_DIR = path.join(dir, 'images');

process.env.INSTAGRAM_TOKEN = 'test-token';
process.env.IG_FEED_JSON = FEED_JSON;
process.env.IG_IMAGE_DIR = IMAGE_DIR;

const { main } = await import('./sync.mjs');

const fileExists = (p) => readFile(p).then(() => true, () => false);

/** Reset temp feed/images so each test starts from a known state. */
async function reset() {
  await rm(FEED_JSON, { force: true });
  await rm(IMAGE_DIR, { recursive: true, force: true });
}

// The happy-path image response must survive the script's optional sharp
// pipeline: use a real 1x1 JPEG when sharp is installed (it is, as a
// devDependency), else a 3-byte stub is fine — mirroring the script's own
// optional-import pattern.
let jpegBuf = Buffer.from([0xff, 0xd8, 0xff]);
try {
  const s = (await import('sharp')).default;
  jpegBuf = await s({
    create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } }
  })
    .jpeg()
    .toBuffer();
} catch {}

const mediaItem = {
  id: '123',
  caption: 'Fresh set ✨',
  media_type: 'IMAGE',
  media_url: 'https://scontent.cdninstagram.com/123.jpg',
  permalink: 'https://www.instagram.com/p/CCC/',
  timestamp: '2026-07-01T10:00:00+0000'
};

test('refuses to wipe a populated feed when the API returns no usable posts', async () => {
  await reset();
  const populated = JSON.stringify({
    updatedAt: '2026-07-01T00:00:00.000Z',
    posts: [
      { id: '111', caption: 'a', permalink: 'x', timestamp: 't', type: 'IMAGE', image: '/i/111.jpg' },
      { id: '222', caption: 'b', permalink: 'y', timestamp: 't', type: 'IMAGE', image: '/i/222.jpg' }
    ]
  });
  await writeFile(FEED_JSON, populated);

  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });

  await assert.rejects(main(), /refusing to wipe/);
  assert.equal(await readFile(FEED_JSON, 'utf8'), populated); // last good feed intact
});

test('rejects a non-image download and leaves feed.json unwritten', async () => {
  await reset();
  globalThis.fetch = async (url) => {
    if (String(url).includes('/me/media')) {
      return new Response(JSON.stringify({ data: [mediaItem] }), { status: 200 });
    }
    return new Response('x', { status: 200, headers: { 'content-type': 'video/mp4' } });
  };

  await assert.rejects(main(), /Unexpected content-type/);
  assert.equal(await fileExists(FEED_JSON), false); // previous state preserved
});

test('happy path: writes feed.json (without sourceUrl) and the image file', async () => {
  await reset();
  globalThis.fetch = async (url) => {
    if (String(url).includes('/me/media')) {
      return new Response(JSON.stringify({ data: [mediaItem] }), { status: 200 });
    }
    return new Response(jpegBuf, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    });
  };

  await main();

  const feed = JSON.parse(await readFile(FEED_JSON, 'utf8'));
  assert.equal(feed.posts.length, 1);
  assert.equal(feed.posts[0].id, '123');
  assert.equal('sourceUrl' in feed.posts[0], false); // expiring CDN URL never persisted
  assert.equal(await fileExists(path.join(IMAGE_DIR, '123.jpg')), true);
});
