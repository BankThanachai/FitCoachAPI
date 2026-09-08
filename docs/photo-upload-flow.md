# Photo Upload (Presigned URL) — Mobile Integration Guide

Photos (profile photo, trainer portfolio photos) are uploaded **directly from
the mobile client to Cloudflare R2**, not through the API server. The backend
only ever hands out a short-lived signed URL and records the resulting file
key — it never receives the image bytes itself.

All endpoints below are under the base path `/api/v1` and require the same
`Authorization: Bearer <accessToken>` header as every other authenticated
endpoint in this API.

## Why two steps (presign, then confirm)

1. **Presign** — client asks the backend for a one-time upload URL. The
   backend does **not** touch the database here — it just generates a unique
   object key and signs a URL for it. The URL expires in 5 minutes.
2. **Client uploads the file directly to R2** using that URL — the bytes
   never pass through the API server.
3. **Confirm** — client tells the backend the upload finished, passing back
   the same `key`. Only now does the backend write anything to the database
   (e.g. `User.profilePhotoKey`, or a new `TrainerPortfolioPhoto` row).

This means a database record only ever exists for a file that the client
actually finished uploading — if the client abandons the upload after step 1,
nothing is left behind in the database.

```
Client                      Backend                       Cloudflare R2
  │  1. POST .../presign      │                              │
  │──────────────────────────>│                              │
  │                           │  generate key, sign URL       │
  │                           │─────────────────────────────>│
  │  { uploadUrl, key }       │<─────────────────────────────│
  │<──────────────────────────│                              │
  │                           │                              │
  │  2. PUT uploadUrl (file body, Content-Type header)        │
  │────────────────────────────────────────────────────────>│
  │  200 OK                                                   │
  │<────────────────────────────────────────────────────────│
  │                           │                              │
  │  3. POST .../confirm { key } (or { key, order })          │
  │──────────────────────────>│                              │
  │                           │  write key to DB              │
  │  photo record + url       │                              │
  │<──────────────────────────│                              │
```

## Rules the client must follow

- **Allowed `contentType`**: `image/jpeg`, `image/png`, `image/webp` only —
  any other value is rejected at the presign step with `400 Bad Request`.
- **The `Content-Type` header sent in the step-2 `PUT` request to R2 must
  exactly match the `contentType` sent in step 1.** The presigned URL is
  signed for that specific content type; a mismatch causes R2 to reject the
  upload.
- **The presigned URL expires after 5 minutes.** If the client doesn't
  complete the `PUT` in time, request a new one via presign again.
- **Portfolio photos use a 1–5 `order` slot system**, not a growing list.
  Confirming with an `order` that already has a photo replaces that photo
  (same slot, new key) rather than adding a 6th. Confirming with a new
  `order` when 5 slots are already filled returns `400 Bad Request`.
- **Only trainers can use the portfolio endpoints.** A client account calling
  them gets `400 Bad Request` ("Only trainers can have portfolio photos").

---

## Endpoints

### 1. Presign a profile photo upload

```
POST /api/v1/users/me/profile-photo/presign
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "contentType": "image/jpeg" }
```

**Response `200`**
```json
{
  "uploadUrl": "https://fitwork-upload.<account-id>.r2.cloudflarestorage.com/users/<userId>/profile/<uuid>.jpg?X-Amz-...",
  "key": "users/<userId>/profile/<uuid>.jpg"
}
```

### 2. Upload the file to R2 (client → R2 directly)

```
PUT <uploadUrl from step 1>
Content-Type: image/jpeg        <-- must match what was sent to presign

<raw image bytes as the request body>
```

**Response**: `200 OK` from R2 on success. No JSON body. Do not send this
request to the API server — `uploadUrl` already points at R2 and is fully
authenticated via its signature.

### 3. Confirm the profile photo

```
POST /api/v1/users/me/profile-photo/confirm
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "key": "users/<userId>/profile/<uuid>.jpg" }
```

**Response `200`**
```json
{
  "profilePhotoKey": "users/<userId>/profile/<uuid>.jpg",
  "profilePhotoUrl": "https://pub-<hash>.r2.dev/users/<userId>/profile/<uuid>.jpg"
}
```

`profilePhotoUrl` is a plain public URL — no auth needed to load the image
itself (e.g. directly in an `<Image>` / `AsyncImage` component).

---

### 4. Presign a portfolio photo upload (trainer only)

```
POST /api/v1/users/me/portfolio-photos/presign
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "contentType": "image/png" }
```

**Response `200`** — same shape as step 1:
```json
{
  "uploadUrl": "https://fitwork-upload.<account-id>.r2.cloudflarestorage.com/users/<trainerId>/portfolio/<uuid>.png?X-Amz-...",
  "key": "users/<trainerId>/portfolio/<uuid>.png"
}
```

### 5. Upload the file to R2

Same as step 2 above — `PUT` the file body directly to `uploadUrl`.

### 6. Confirm the portfolio photo

```
POST /api/v1/users/me/portfolio-photos/confirm
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "key": "users/<trainerId>/portfolio/<uuid>.png", "order": 1 }
```

`order` must be an integer `1`–`5` — this is the display slot, not an
auto-incrementing index. Re-confirming the same `order` replaces the photo in
that slot.

**Response `200`**
```json
{
  "id": "photo-uuid",
  "trainerId": "trainer-uuid",
  "key": "users/<trainerId>/portfolio/<uuid>.png",
  "order": 1,
  "createdAt": "2026-09-08T12:00:00.000Z",
  "url": "https://pub-<hash>.r2.dev/users/<trainerId>/portfolio/<uuid>.png"
}
```

**Error `400`** if the trainer already has 5 photos and `order` isn't one of
their existing slots:
```json
{ "message": "A trainer can have at most 5 portfolio photos", "statusCode": 400 }
```

### 7. List a trainer's portfolio photos (public, any authenticated user)

```
GET /api/v1/trainers/:trainerId/portfolio-photos
Authorization: Bearer <accessToken>
```

**Response `200`** — array sorted by `order` ascending:
```json
[
  { "id": "...", "trainerId": "...", "key": "...", "order": 1, "createdAt": "...", "url": "https://pub-.../..." },
  { "id": "...", "trainerId": "...", "key": "...", "order": 2, "createdAt": "...", "url": "https://pub-.../..." }
]
```

### 8. Delete a portfolio photo (owner only)

```
DELETE /api/v1/users/me/portfolio-photos/:id
Authorization: Bearer <accessToken>
```

`:id` is the photo's own `id` (from the confirm/list response), not the
`order`. Deleting frees up that `order` slot for a future upload.

**Response `200`**: the deleted photo record.

**Error `403`** if `:id` belongs to a different trainer:
```json
{ "message": "This portfolio photo does not belong to you", "statusCode": 403 }
```

---

## Suggested mobile client flow (pseudo-code)

```
async function uploadProfilePhoto(imageFile) {
  const { uploadUrl, key } = await api.post('/users/me/profile-photo/presign', {
    contentType: imageFile.mimeType, // e.g. "image/jpeg"
  });

  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': imageFile.mimeType },
    body: imageFile.bytes,
  });

  const { profilePhotoUrl } = await api.post('/users/me/profile-photo/confirm', { key });
  return profilePhotoUrl;
}
```

Portfolio upload follows the identical shape, just with the
`/portfolio-photos/...` endpoints and an extra `order` field on confirm.
