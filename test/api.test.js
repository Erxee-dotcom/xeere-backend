'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the test database BEFORE loading the app.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeere-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.CORS_ORIGIN = '*';

const app = require('../src/app');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- helpers ---------------------------------------------------------------

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function register(email, displayName) {
  const r = await req('POST', '/api/auth/register', {
    body: { email, password: 'password123', displayName },
  });
  assert.equal(r.status, 201, `register ${email}: ${JSON.stringify(r.body)}`);
  return r.body;
}

// ---- tests -----------------------------------------------------------------

test('health check', async () => {
  const r = await req('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('auth: register, login, me, and profile update', async () => {
  const { token, user } = await register('alice@test.com', 'Alice');

  // me
  const me = await req('GET', '/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'alice@test.com');

  // duplicate registration
  const dup = await req('POST', '/api/auth/register', {
    body: { email: 'alice@test.com', password: 'password123' },
  });
  assert.equal(dup.status, 409);

  // bad login
  const bad = await req('POST', '/api/auth/login', {
    body: { email: 'alice@test.com', password: 'wrong' },
  });
  assert.equal(bad.status, 401);

  // good login
  const login = await req('POST', '/api/auth/login', {
    body: { email: 'alice@test.com', password: 'password123' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, user.id);

  // update profile
  const upd = await req('PUT', '/api/auth/me', {
    token,
    body: { bio: 'Hello world', displayName: 'Alice Updated' },
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.user.bio, 'Hello world');
  assert.equal(upd.body.user.displayName, 'Alice Updated');
});

test('auth: protected routes reject missing/invalid tokens', async () => {
  const missing = await req('GET', '/api/auth/me');
  assert.equal(missing.status, 401);

  const invalid = await req('GET', '/api/auth/me', { token: 'not-a-jwt' });
  assert.equal(invalid.status, 401);
});

test('posts: create, feed, like, comment', async () => {
  const { token } = await register('poster@test.com', 'Poster');

  const created = await req('POST', '/api/posts', {
    token,
    body: { content: 'Hello world from a test' },
  });
  assert.equal(created.status, 201);
  const postId = created.body.post.id;

  // feed
  const feed = await req('GET', '/api/posts');
  assert.equal(feed.status, 200);
  assert.ok(feed.body.posts.some((p) => p.id === postId));

  // like
  const like = await req('POST', `/api/posts/${postId}/like`, { token });
  assert.equal(like.status, 200);
  assert.equal(like.body.liked, true);
  assert.equal(like.body.likeCount, 1);

  // unlike (toggle)
  const unlike = await req('POST', `/api/posts/${postId}/like`, { token });
  assert.equal(unlike.body.liked, false);
  assert.equal(unlike.body.likeCount, 0);

  // comment
  const comment = await req('POST', `/api/posts/${postId}/comments`, {
    token,
    body: { text: 'Nice!' },
  });
  assert.equal(comment.status, 201);

  const comments = await req('GET', `/api/posts/${postId}/comments`);
  assert.equal(comments.body.comments.length, 1);

  // delete own post
  const del = await req('DELETE', `/api/posts/${postId}`, { token });
  assert.equal(del.status, 200);
});

test('friends: request, accept, and list', async () => {
  const a = await register('friend-a@test.com', 'Friend A');
  const b = await register('friend-b@test.com', 'Friend B');

  const r = await req('POST', '/api/friends/request', {
    token: a.token,
    body: { userId: b.user.id },
  });
  assert.equal(r.status, 201);
  const friendshipId = r.body.friendship.id;

  // b sees the incoming request
  const incoming = await req('GET', '/api/friends/requests', { token: b.token });
  assert.equal(incoming.body.requests.length, 1);
  assert.equal(incoming.body.requests[0].from.id, a.user.id);

  // b accepts
  const accept = await req('POST', '/api/friends/respond', {
    token: b.token,
    body: { friendshipId, action: 'accept' },
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.friendship.status, 'accepted');

  // a's friend list now contains b
  const friends = await req('GET', '/api/friends', { token: a.token });
  assert.ok(friends.body.friends.some((f) => f.id === b.user.id));
});

test('messages: send and list conversations', async () => {
  const a = await register('msg-a@test.com', 'Msg A');
  const b = await register('msg-b@test.com', 'Msg B');

  const send = await req('POST', `/api/messages/${b.user.id}`, {
    token: a.token,
    body: { text: 'Hello there' },
  });
  assert.equal(send.status, 201);

  const thread = await req('GET', `/api/messages/${b.user.id}`, { token: a.token });
  assert.equal(thread.body.messages.length, 1);

  const convos = await req('GET', '/api/messages/conversations', { token: b.token });
  assert.equal(convos.body.conversations.length, 1);
  assert.equal(convos.body.conversations[0].unread, 1);
});

test('marketplace: gigs, escrow orders, earnings', async () => {
  const seller = await register('seller@test.com', 'Seller');
  const buyer = await register('buyer@test.com', 'Buyer');

  const gig = await req('POST', '/api/gigs', {
    token: seller.token,
    body: { title: 'Test service', description: 'Desc', price: 100, category: 'writing' },
  });
  assert.equal(gig.status, 201);
  const gigId = gig.body.gig.id;

  const order = await req('POST', `/api/gigs/${gigId}/order`, { token: buyer.token });
  assert.equal(order.status, 201);
  assert.equal(order.body.order.status, 'escrow');
  const orderId = order.body.order.id;

  // seller starts + delivers
  const started = await req('POST', `/api/gigs/orders/${orderId}/status`, {
    token: seller.token,
    body: { status: 'in_progress' },
  });
  assert.equal(started.body.order.status, 'in_progress');

  await req('POST', `/api/gigs/orders/${orderId}/status`, {
    token: seller.token,
    body: { status: 'delivered' },
  });

  // buyer completes → earnings become available
  const completed = await req('POST', `/api/gigs/orders/${orderId}/status`, {
    token: buyer.token,
    body: { status: 'completed' },
  });
  assert.equal(completed.body.order.status, 'completed');

  const earnings = await req('GET', '/api/gigs/earnings', { token: seller.token });
  assert.equal(earnings.body.earnings.gross, 100);
  assert.equal(earnings.body.earnings.platformFee, 10); // 10%
  assert.equal(earnings.body.earnings.available, 90);
});

test('reviews: create auto-analyzes authenticity', async () => {
  const { token } = await register('reviewer@test.com', 'Reviewer');

  const r = await req('POST', '/api/reviews', {
    token,
    body: {
      subject: 'Widget',
      platform: 'marketplace',
      rating: 5,
      reviewText: 'BEST EVER!!! AMAZING!!! BUY NOW!!! WOW!!!',
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.review.authenticity, 'likely fake');
  assert.ok(r.body.review.aiScore < 45);

  const list = await req('GET', '/api/reviews');
  assert.ok(list.body.reviews.some((x) => x.id === r.body.review.id));
});

test('ai: analyze-review endpoint', async () => {
  const genuine = await req('POST', '/api/ai/analyze-review', {
    body: {
      text: 'Packaging was dented but the device works. Battery lasted 6 hours, less than claimed. Setup took 20 minutes.',
      rating: 3,
    },
  });
  assert.equal(genuine.status, 200);
  assert.ok(genuine.body.score > 45);
  assert.equal(typeof genuine.body.authenticity, 'string');
  assert.ok(Array.isArray(genuine.body.flags));

  const empty = await req('POST', '/api/ai/analyze-review', { body: { text: '' } });
  assert.equal(empty.status, 400);
});

test('auth: firebase endpoint requires an idToken', async () => {
  const r = await req('POST', '/api/auth/firebase', { body: {} });
  assert.equal(r.status, 400);
});

test('auth: firebase endpoint returns 503 when not configured', async () => {
  // FIREBASE_PROJECT_ID is intentionally unset for this test environment.
  const r = await req('POST', '/api/auth/firebase', { body: { idToken: 'fake-token' } });
  assert.equal(r.status, 503);
});

test('unknown routes return 404', async () => {
  const r = await req('GET', '/api/does-not-exist');
  assert.equal(r.status, 404);
});
