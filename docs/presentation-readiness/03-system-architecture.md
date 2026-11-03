# 03. System architecture

All diagrams were drawn from the code, with file references. Where a box is a platform (Vercel, Turso) its internals are not verified here.

## Request lifecycle in words
1. The browser requests the site. Vercel serves the prebuilt single-page app (`apps/web/dist`) for any non-API path (`vercel.json` rewrites).
2. React renders and `AuthContext` calls `GET /api/auth/me` to learn who the visitor is. Pages call `apiFetch` (`apps/web/src/lib/api.ts`), a thin `fetch` wrapper that adds the JSON content type and an `X-Locale` header.
3. Requests to `/api/*` reach one Vercel serverless function (`api/index.ts`) that wraps the Express app (`apps/server/src/app.ts`).
4. Express applies, in order: trusted-proxy setting (`app.ts:24`), Helmet headers (`:25`), JSON body parser capped at 100 kb (`:15`, `:26`), the session middleware (`:27`).
5. The router (`routes/index.ts`) picks the route file. Each route is guarded by `optionalAuth`, `requireAuth`, `requireCan(policy)` or an owner/lead guard (`middleware/auth.ts`). Guards reload the user from the database on every request (`auth.ts:11-24`).
6. Input is validated with Zod schemas shared with the web app (`parseOrThrow`).
7. Handlers use Prisma for data, often inside transactions, and write audit rows.
8. Errors go to one handler (`app.ts:52-82`): known validation/HTTP errors with their message, body-parser and multer errors as 4xx, known database errors mapped, everything else a generic 500 (and the error is logged).
9. The JSON response returns (`Cache-Control: no-store` by default, `app.ts:42-47`) and React renders it.

## Diagram 1: overall system architecture
```mermaid
flowchart LR
  B["Browser (React SPA)"] -->|"HTTPS"| V["Vercel edge"]
  V -->|"/* (not /api)"| S["Static SPA build (apps/web/dist)"]
  V -->|"/api/*, /robots.txt, /sitemap.xml"| F["Serverless function api/index.ts"]
  F --> E["Express app (apps/server/src/app.ts)"]
  E --> M["Middleware: Helmet, JSON 100kb, session, guards, Zod"]
  M --> R["Route modules (one file per resource)"]
  R --> P["Prisma client + libSQL adapter"]
  P -->|"libsql over HTTPS"| T[("Turso database")]
  R --> BL[("Vercel Blob (private) - uploaded files")]
  E -. optional .-> G["Google OAuth endpoints"]
  B -. iframe .-> GC["Google Calendar"]
  B -. fonts .-> GF["Google Fonts"]
  subgraph Local development
    L1["Vite :5173"] -->|"/api proxy"| L2["Express :4001"] --> L3[("SQLite dev.db + disk storage")]
  end
```

## Diagram 2: typical API request lifecycle
```mermaid
sequenceDiagram
  participant U as Browser
  participant X as Express
  participant S as Session store (Prisma, table Session)
  participant D as Database
  U->>X: PUT /api/publications/:id (cookie scl.sid, JSON)
  X->>X: Helmet headers, JSON parse (100kb)
  X->>S: load session by cookie id
  S-->>X: session.userId or none
  X->>D: user by id (role re-read every request)
  alt no user
    X-->>U: 401 Unauthorized
  else policy fails
    X-->>U: 403 Forbidden
  else allowed
    X->>X: Zod validation (shared schema)
    X->>D: transaction: duplicate guard lock, update, audit row
    D-->>X: result
    X-->>U: 200 JSON (Cache-Control no-store)
  end
```

## Diagram 3: login and session lifecycle
```mermaid
sequenceDiagram
  participant U as Browser
  participant A as POST /api/auth/login
  participant RL as In-memory rate limiter
  participant DB as Database
  U->>A: email, password
  A->>RL: limited for (ip, email)? (10 failures / 15 min)
  alt limited
    A-->>U: 429
  else
    A->>DB: find user by lower-cased email
    A->>A: bcrypt.compare against real hash or dummy hash
    alt wrong
      A->>RL: record failure
      A-->>U: 401 "Incorrect email or password."
    else ok
      A->>RL: clear counter
      A->>A: session.regenerate() (new id)
      A->>DB: store session (userId, 7-day sliding expiry)
      A-->>U: 200 + Set-Cookie scl.sid (HttpOnly, SameSite=Lax, Secure in production)
    end
  end
  U->>A: POST /api/auth/logout
  A->>DB: delete session row; clear cookie
```

## Diagram 4: Google OAuth (optional; only for accounts already linked)
```mermaid
sequenceDiagram
  participant U as Browser
  participant S as /api/auth/google/start
  participant G as Google
  participant C as /api/auth/google/callback
  participant DB as Database
  U->>S: GET start (rate limited per IP)
  S->>DB: save state + nonce + PKCE verifier in the session row (short-lived)
  S-->>U: 302 to Google (state, nonce, code_challenge)
  U->>G: sign in
  G-->>U: 302 to callback ?code&state
  U->>C: GET callback
  C->>DB: consume the stored transaction atomically (single use)
  C->>C: state compared with timingSafeEqual
  C->>G: exchange code with PKCE verifier
  C->>C: verify ID token (audience, nonce) via google-auth-library
  C->>DB: find OAuthIdentity by (provider, subject)
  alt not linked
    C-->>U: 302 to login with "not linked" (no user is ever created)
  else linked
    C->>C: session.regenerate(); set userId
    C-->>U: 302 to the signed-in page
  end
```
Linking is a separate flow started by an already signed-in user after re-entering their password (`POST /api/auth/google/link/start`, same-origin check, `googleAuth.routes.ts:220-260`).

## Diagram 5: role-based authorization
```mermaid
flowchart TD
  Req["Request"] --> Sess{"Session user exists?"}
  Sess -- no --> Pub{"Route is public?"}
  Pub -- yes --> Filt["Return only PUBLIC records and published profiles"]
  Pub -- no --> R401["401 Unauthorized"]
  Sess -- yes --> Role["Role read from the database on this request"]
  Role --> Pol{"requireCan(policy) / owner / lead check passes?"}
  Pol -- no --> R403["403 Forbidden (or 404 when existence must not leak)"]
  Pol -- yes --> Vis["Visibility filter: LAB_ONLY needs a session; unpublished profiles need ADMIN"]
  Vis --> OK["Handler runs"]
```
Policy source: `packages/shared/src/permissions.ts`; guards: `apps/server/src/middleware/auth.ts:36-151`.

## Diagram 6: file upload lifecycle
```mermaid
flowchart TD
  U["Member selects a file"] --> P["POST /api/files, /api/gallery, /api/profile/photo (multipart)"]
  P --> G["requireCan(canUploadFile)"]
  G --> M["multer: memory storage, 1 file, size cap"]
  M --> V["validateUpload: sniff magic bytes (JPEG, PNG, WebP, GIF, PDF), size limit by type, sanitise file name"]
  V --> S{"Profile photo?"}
  S -- yes --> X["sanitizeImage: strip metadata, keep orientation"]
  S -- no --> K["(no sanitising)"]
  X --> W["saveFile: random UUID key; Vercel Blob (private) or local disk"]
  K --> W
  W --> DB["StoredFile row (owner, mime, size, visibility) + audit row in one transaction"]
  DB -- failure --> RM["remove blob again"]
  DB --> R["Client uses /api/files/:id"]
  R --> Q["GET /api/files/:id: visibility check, nosniff, inline for images, attachment for PDFs"]
```
Evidence: `routes/files.routes.ts:35-128`, `lib/fileService.ts:30-85`, `lib/storage.ts:111-127`, `routes/profile.routes.ts:128`.

## Diagram 7: database interaction
```mermaid
flowchart LR
  H["Route handler"] --> PC["Prisma client (lib/prisma.ts)"]
  PC -->|"TURSO_DATABASE_URL set"| AD["libSQL adapter"] --> TU[("Turso")]
  PC -->|"unset (local, tests)"| LF[("SQLite file via DATABASE_URL")]
  H --> TX["prisma.$transaction (write lock first for duplicate checks)"]
  TX --> AL["recordAudit (same transaction)"]
  H -. "lock contention" .-> E503["503 + retry message (dbErrors.ts)"]
```

## Environment-specific configuration
`assertProductionConfig()` (`lib/config.ts:43`, called from `api/index.ts`) refuses to start production without the Turso pair, `SESSION_SECRET` and `TRUST_PROXY`. Local development uses `DATABASE_URL`, local disk storage and a development session secret with a warning (`lib/session.ts:13-21`). Variable names and purposes: [../technical/deployment.md](../technical/deployment.md).

## Deployment architecture
See [10-deployment-and-devops.md](10-deployment-and-devops.md). Preview and production isolation of data is **UNKNOWN** (Vercel dashboard).
