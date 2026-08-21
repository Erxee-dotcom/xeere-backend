# XeeRe (ERYX0) Backend

REST API for the **XeeRe / ERYX0** social & review-intelligence platform. This
repo previously contained only the Firebase-based frontend (`index.html`);
this adds a self-contained backend that mirrors the app's domain model behind a
clean JSON API.

## Stack

- **Node.js ≥ 22.5** (uses the built-in `node:sqlite` module — no native deps)
- **Express 4** — HTTP framework
- **SQLite** — zero-config embedded database (file at `data/xeere.db`)
- **JWT** (`jsonwebtoken`) + **bcryptjs** — authentication

## Getting started

```bash
npm install
cp .env.example .env   # optional — sensible defaults are built in
npm run seed           # create demo users + sample data
npm start              # http://localhost:4000
# or, for auto-reload during development:
npm run dev

# run the test suite (uses an isolated temp database)
npm test
```

### Demo accounts (after `npm run seed`)

| Email             | Password      |
| ----------------- | ------------- |
| `demo@xeere.app`  | `password123` |
| `jane@xeere.app`  | `password123` |

## Configuration (`.env`)

| Variable          | Default                  | Description                          |
| ----------------- | ------------------------ | ------------------------------------ |
| `PORT`            | `4000`                   | HTTP port                            |
| `HOST`            | `0.0.0.0`                | Bind address                         |
| `JWT_SECRET`      | dev default              | **Set this in production!**          |
| `JWT_EXPIRES_IN`  | `7d`                     | Token lifetime                       |
| `DB_PATH`         | `./data/xeere.db`        | SQLite file location                 |
| `CORS_ORIGIN`     | `*`                      | Comma-separated origins or `*`       |

## Authentication

Every protected endpoint expects a header:

```
Authorization: Bearer <token>
```

Tokens are returned by `POST /api/auth/register` and `POST /api/auth/login`.

## API reference

### Auth

| Method | Endpoint                    | Auth | Description                          |
| ------ | --------------------------- | ---- | ------------------------------------ |
| POST   | `/api/auth/register`        | —    | Create account (`email`, `password`, `displayName`, `username`) |
| POST   | `/api/auth/login`           | —    | Log in (`email`, `password`)         |
| GET    | `/api/auth/me`              | ✅   | Current user                         |
| PUT    | `/api/auth/me`              | ✅   | Update profile (`displayName`, `username`, `bio`, `photoUrl`) |
| POST   | `/api/auth/change-password` | ✅   | Change password                      |

### Users

| Method | Endpoint               | Auth | Description                        |
| ------ | ---------------------- | ---- | ---------------------------------- |
| GET    | `/api/users/search?q=` | ✅   | Search by name / username / email  |
| GET    | `/api/users/:id`       | —    | Public profile                     |
| GET    | `/api/users/:id/posts` | —    | A user's posts (paginated)         |

### Posts, likes & comments

| Method | Endpoint                          | Auth | Description                    |
| ------ | --------------------------------- | ---- | ------------------------------ |
| GET    | `/api/posts`                      | opt  | Feed (newest first, `limit`, `before`, `authorId`) |
| GET    | `/api/posts/:id`                  | opt  | Single post                    |
| POST   | `/api/posts`                      | ✅   | Create post                    |
| PUT    | `/api/posts/:id`                  | ✅   | Edit own post                  |
| DELETE | `/api/posts/:id`                  | ✅   | Delete own post                |
| POST   | `/api/posts/:id/like`             | ✅   | Toggle like                    |
| GET    | `/api/posts/:id/comments`         | —    | List comments                  |
| POST   | `/api/posts/:id/comments`         | ✅   | Add comment                    |
| DELETE | `/api/posts/:id/comments/:cid`    | ✅   | Delete own comment             |

### Friends

| Method | Endpoint                | Auth | Description                      |
| ------ | ----------------------- | ---- | -------------------------------- |
| GET    | `/api/friends`          | ✅   | List accepted friends            |
| GET    | `/api/friends/requests` | ✅   | Incoming pending requests        |
| GET    | `/api/friends/suggestions` | ✅ | "People you may know"          |
| POST   | `/api/friends/request`  | ✅   | Send a friend request (`userId`) |
| POST   | `/api/friends/respond`  | ✅   | Accept/decline (`friendshipId`, `action`) |
| DELETE | `/api/friends/:userId`  | ✅   | Unfriend / cancel request        |

### Notifications

| Method | Endpoint                       | Auth | Description          |
| ------ | ------------------------------ | ---- | -------------------- |
| GET    | `/api/notifications`           | ✅   | List notifications   |
| GET    | `/api/notifications/unread-count` | ✅ | Unread count       |
| POST   | `/api/notifications/:id/read`  | ✅   | Mark one read        |
| POST   | `/api/notifications/read-all`  | ✅   | Mark all read        |

### Messages (DMs)

| Method | Endpoint                     | Auth | Description                 |
| ------ | ---------------------------- | ---- | --------------------------- |
| GET    | `/api/messages/conversations`| ✅   | Conversations + last msg    |
| GET    | `/api/messages/:userId`      | ✅   | Thread with a user          |
| POST   | `/api/messages/:userId`      | ✅   | Send a message              |
| POST   | `/api/messages/:userId/read` | ✅   | Mark thread read            |

### Marketplace, escrow & earnings

| Method | Endpoint                        | Auth | Description                       |
| ------ | ------------------------------- | ---- | --------------------------------- |
| GET    | `/api/gigs`                     | —    | Browse listings (`category`, `limit`) |
| GET    | `/api/gigs/:id`                 | —    | Single listing                    |
| POST   | `/api/gigs`                     | ✅   | Create listing                    |
| PUT    | `/api/gigs/:id`                 | ✅   | Update own listing                |
| DELETE | `/api/gigs/:id`                 | ✅   | Delete own listing                |
| POST   | `/api/gigs/:id/order`           | ✅   | Place order (funds → escrow)      |
| GET    | `/api/gigs/orders/mine`         | ✅   | My orders (buyer or seller)       |
| POST   | `/api/gigs/orders/:id/status`   | ✅   | Advance escrow lifecycle          |
| GET    | `/api/gigs/earnings`            | ✅   | Seller earnings summary           |
| POST   | `/api/gigs/earnings/payout`     | ✅   | Request payout                    |

Escrow lifecycle: `escrow → in_progress → delivered → completed` (sellers drive
progress, buyers complete/dispute). A 10% platform fee applies to completed orders.

### Reviews & AI

| Method | Endpoint                      | Auth | Description                     |
| ------ | ----------------------------- | ---- | ------------------------------- |
| GET    | `/api/reviews`                | —    | List reviews (`authorId`, `subject`) |
| GET    | `/api/reviews/:id`            | —    | Single review                   |
| POST   | `/api/reviews`                | ✅   | Create review (auto-analyzed)   |
| DELETE | `/api/reviews/:id`            | ✅   | Delete own review               |
| POST   | `/api/ai/analyze-review`      | —    | Review authenticity analyzer    |
| GET    | `/api/ai/status`              | —    | AI service status               |

#### Review authenticity analyzer

`POST /api/ai/analyze-review` accepts `{ text, rating? }` and returns a 0–100
authenticity score, a verdict (`genuine` / `likely genuine` / `suspicious` /
`likely fake`), a list of human-readable flags, and the raw signals used
(word count, exclamation/caps density, generic-phrase matches, repetition, etc.).

The implementation (`src/services/reviewAnalyzer.js`) is a deterministic,
dependency-free heuristic — swap it for a real LLM call in production without
changing the API contract.

## Project layout

```
```
src/
  server.js                  # entrypoint + graceful shutdown
  app.js                     # Express app + route mounting
  config.js                  # env config
  db.js                      # SQLite connection + schema
  seed.js                    # demo data
  middleware/                # auth, error handling
  services/reviewAnalyzer.js # AI review authenticity engine
  routes/                    # one file per resource
  utils/                     # jwt, helpers
test/
  api.test.js                # end-to-end API tests (node:test, isolated DB)
```

## Notes

- The database file (`data/xeere.db`) is git-ignored and created automatically
  on first run.
- Google / Firebase auth from the existing frontend isn't wired in yet; the
  current API uses email + password. Firebase ID-token verification can be added
  via `firebase-admin` without changing the client contract.
- Set `JWT_SECRET` to a long random value and `CORS_ORIGIN` to your frontend
  origin before deploying.
