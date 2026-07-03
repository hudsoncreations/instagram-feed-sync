import test from 'node:test';
import assert from 'node:assert/strict';
import { mapMediaToPosts, feedChanged, staleImages } from './sync.mjs';

const IMG = '/images/instagram';

test('mapMediaToPosts maps an IMAGE post, sourcing from media_url', () => {
  const posts = mapMediaToPosts(
    [
      {
        id: '111',
        caption: 'Fresh set ✨',
        media_type: 'IMAGE',
        media_url: 'https://scontent.cdninstagram.com/a.jpg',
        permalink: 'https://www.instagram.com/p/AAA/',
        timestamp: '2026-07-01T10:00:00+0000'
      }
    ],
    IMG
  );
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], {
    id: '111',
    caption: 'Fresh set ✨',
    permalink: 'https://www.instagram.com/p/AAA/',
    timestamp: '2026-07-01T10:00:00+0000',
    type: 'IMAGE',
    image: `${IMG}/111.jpg`,
    sourceUrl: 'https://scontent.cdninstagram.com/a.jpg'
  });
});

test('mapMediaToPosts uses thumbnail_url for VIDEO posts', () => {
  const [post] = mapMediaToPosts(
    [
      {
        id: '222',
        media_type: 'VIDEO',
        media_url: 'https://scontent.cdninstagram.com/v.mp4',
        thumbnail_url: 'https://scontent.cdninstagram.com/v-thumb.jpg',
        permalink: 'https://www.instagram.com/p/BBB/',
        timestamp: '2026-07-01T11:00:00+0000'
      }
    ],
    IMG
  );
  assert.equal(post.sourceUrl, 'https://scontent.cdninstagram.com/v-thumb.jpg');
  assert.equal(post.caption, ''); // missing caption defaults to empty string
});

test('mapMediaToPosts drops items with no usable image URL', () => {
  const posts = mapMediaToPosts(
    [
      { id: '333', media_type: 'VIDEO', permalink: 'x', timestamp: 't' }, // no thumbnail
      {
        id: '444',
        media_type: 'CAROUSEL_ALBUM',
        media_url: 'https://scontent.cdninstagram.com/c.jpg',
        permalink: 'x',
        timestamp: 't'
      }
    ],
    IMG
  );
  assert.deepEqual(posts.map((p) => p.id), ['444']);
});

test('feedChanged is false when ids and captions match', () => {
  const a = [{ id: '1', caption: 'x' }, { id: '2', caption: 'y' }];
  const b = [
    { id: '1', caption: 'x', sourceUrl: 'ignored' },
    { id: '2', caption: 'y', image: '/ignored.jpg' }
  ];
  assert.equal(feedChanged(a, b), false);
});

test('feedChanged is true for a new post, an edited caption, or reordering', () => {
  const base = [{ id: '1', caption: 'x' }, { id: '2', caption: 'y' }];
  assert.equal(feedChanged(base, [{ id: '0', caption: 'new' }, ...base.slice(0, 1)]), true);
  assert.equal(feedChanged(base, [{ id: '1', caption: 'EDITED' }, { id: '2', caption: 'y' }]), true);
  assert.equal(feedChanged(base, [base[1], base[0]]), true);
});

test('staleImages lists only .jpg files no longer in the feed', () => {
  const files = ['111.jpg', '999.jpg', '.gitkeep', 'notes.txt'];
  const posts = [{ id: '111' }];
  assert.deepEqual(staleImages(files, posts), ['999.jpg']);
});
