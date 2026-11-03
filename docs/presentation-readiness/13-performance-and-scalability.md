# 13. Performance and scalability

Nothing here was load-tested. Statements are about architecture; numbers marked **measured** come from files in this audit.

## Frontend
- Production build (built in this audit session): 52 JavaScript chunks. Largest: `index` 432 KB raw, **about 113 KB gzipped**; a 333 KB chunk holds both language dictionaries; the Help renderer chunk is about 100 KB. **Measured**, `apps/web/dist/assets`.
- Route-level lazy loading (`React.lazy`) for most pages. No image optimisation pipeline (images are served as uploaded, no resizing or responsive variants, no WebP conversion). `loading="lazy"` use on images was not audited (**Unknown**).
- Caching: static assets are fingerprinted by Vite; API responses are `no-store` except public files (1 hour).

## API and database
- Every request that uses a guard performs a session read and a user read (two queries) before the handler. Public reads use `optionalAuth` with the same cost when a cookie is present.
- Pagination exists for search (50 max), forum (50 and 100), gallery (60), resources (50), admin lists (100). **Not paginated:** team, publications, news, research areas, projects, groups (F-13).
- Search is `LIKE '%term%'` through Prisma `contains` (`lib/search.ts` header comment), which cannot use an index, but results are capped.
- Relations are indexed (68 `@@index`); query plans were not analysed (**Unknown**). N+1 patterns were not systematically searched.
- Writes use short transactions with a write lock for duplicate checks; SQLite/libSQL has a single writer, and contention is mapped to a 503 with retry text.
- Connection limits for Turso and function concurrency limits on Vercel: **Unknown** (plan dependent).

## Bottlenecks to expect first
1. Per-instance in-memory rate limiting stops being effective as instances multiply (F-03).
2. Unpaginated public lists as content grows.
3. Database round trips per request over the network to Turso.
4. Upload size limit and memory buffering (files are buffered in memory up to 15 MB).
5. Single-writer contention if many people write at once.

## Can it support N users? (assessment, not a promise)
| Users | Assessment |
|---|---|
| 10 | Comfortably, by any reading of the architecture |
| 100 | Likely comfortable for mostly read traffic and a handful of concurrent writers; the lab's content volume is small (tens of publications, a handful of team members) |
| 1,000 | Plausible for read traffic given static hosting and a serverless API, but unproven: needs a load test and a check of Vercel and Turso plan limits; unpaginated lists and the limiter become relevant |
| 10,000 | Not supported without changes: shared rate limiting and caching, pagination everywhere, query analysis, a plan with the needed limits, monitoring, and probably a different write path for heavy features (messaging, forum) |

What requires load testing: concurrent logins (bcrypt cost), upload bursts, search, database latency under concurrency, cold-start impact.

## Safe scalability roadmap
1. Measure first: add monitoring and run a small load test against a **non-production** copy.
2. Quick wins: paginate remaining lists; cache public read endpoints (short `s-maxage` with `Vary: Cookie` carefully, or ETags); cache the user lookup within a request.
3. Replace in-memory limiters with a shared store.
4. Image variants (resizing) and lazy-loading audit.
5. Full-text search (SQLite FTS or an external service) if search grows.
6. If write load grows: evaluate a server-based Postgres with pooling; Prisma keeps most application code unchanged (provider change and migrations rebuilt).
