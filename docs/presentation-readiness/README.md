# Smart Computing Lab website: presentation-readiness audit

A read-only technical, architecture, security and presentation audit, written so you can explain the whole system and answer hard questions honestly.

- **Audited code:** commit `855272c12d92fd5661f8799738b26955856f5146` (branch `feat/research-link-brand-icons`). `origin/master` is `2123ea3`, a merge of that same commit, so the audited tree equals production's source tree. Date of audit: 2026-11-03.
- **Nothing was changed** except adding these Markdown files (untracked, not committed). See [22-audit-evidence-and-methodology.md](22-audit-evidence-and-methodology.md).

## What this audit is not
**This audit does not certify the website as secure, and it must not be presented as a certification.** It is a source-code and configuration review with a few read-only checks, not a penetration test, a formal compliance assessment or a legal review. Passing tests and sound controls show that tested paths behave as designed; they do not prove the absence of vulnerabilities. Findings are listed with severities and verification labels in [07](07-security-audit.md), and areas that could not be inspected are listed in [22](22-audit-evidence-and-methodology.md).

**Two statements in the repository's own technical documentation were found to be inaccurate** (the API does not send a Content-Security-Policy header; only profile photos, not all uploads, have image metadata removed). They are disclosed in [22](22-audit-evidence-and-methodology.md#documentation-versus-implementation-discrepancies) and were not edited here.

## Evidence labels used everywhere

| Label | Meaning |
|---|---|
| **VERIFIED** | Confirmed directly in source code, configuration, a live read-only check, or a test run in this audit |
| **PARTIALLY VERIFIED** | Some implementation evidence, full behavior not confirmed |
| **DOCUMENTED ONLY** | Stated in documentation or a platform's public behavior, not independently verified here |
| **NOT IMPLEMENTED** | No implementation found |
| **UNKNOWN** | Insufficient evidence (usually dashboard or platform configuration outside the repository) |

Where documentation and code disagree, the code is trusted and the discrepancy is listed in [22](22-audit-evidence-and-methodology.md#documentation-versus-implementation-discrepancies).

## Read this first (the five things that matter most)

1. **It is a real application, not a static site:** React single-page app, Express API, relational database (Prisma over SQLite locally, Turso in production), sessions, four permission levels, file uploads, bilingual UI. ([01](01-project-overview.md), [03](03-system-architecture.md))
2. **Authorization is enforced on the server**, in one policy file shared with the UI, and 141 routes were classified. ([06](06-authentication-and-authorization.md), [../technical/api-reference.md](../technical/api-reference.md))
3. **The most important weaknesses to be ready to discuss** ([07](07-security-audit.md), [17](17-limitations-and-roadmap.md)): other sessions are not revoked when a password changes; login rate limiting is per-process and in-memory; the single-page-app pages carry no `X-Frame-Options`/CSP response header; gallery uploads are not metadata-stripped; no MFA, no password reset, no monitoring, no automated backups in the repository; `master` is not branch-protected; 14 dependency advisories reported by `npm audit`.
4. **One thing to check today:** `apps/server/prisma/seed.ts` contains a fixed default administrator credential. If the seed was ever run against production, rotate that account. ([07](07-security-audit.md), finding F-01)
5. **Capacity claims need a load test.** The architecture suggests it is comfortable for a lab-sized audience; nothing in the repository measures more. ([13](13-performance-and-scalability.md))

## Contents

| # | File | What it covers |
|---|---|---|
| 01 | [project-overview](01-project-overview.md) | What the site is, users, full feature inventory |
| 02 | [technology-stack](02-technology-stack.md) | Every technology actually present, why, pros and cons |
| 03 | [system-architecture](03-system-architecture.md) | Request lifecycle and seven Mermaid diagrams |
| 04 | [frontend](04-frontend.md) | Components, routing, state, forms, responsiveness |
| 05 | [backend-and-api](05-backend-and-api.md) | Route groups, validation, errors, per-area security |
| 06 | [authentication-and-authorization](06-authentication-and-authorization.md) | Login, sessions, Google, roles, permission matrix, edge cases |
| 07 | [security-audit](07-security-audit.md) | OWASP-oriented review and numbered findings |
| 08 | [database-architecture](08-database-architecture.md) | Schema, ERD, constraints, migrations, recovery |
| 09 | [file-storage](09-file-storage.md) | Upload, storage, access, deletion |
| 10 | [deployment-and-devops](10-deployment-and-devops.md) | Vercel, CI, release path, failure cases |
| 11 | [testing-and-quality](11-testing-and-quality.md) | What each test proves and does not |
| 12 | [failure-scenarios](12-failure-scenarios.md) | 22 "what if" scenarios |
| 13 | [performance-and-scalability](13-performance-and-scalability.md) | Bundle, queries, 10 to 10,000 users |
| 14 | [privacy-and-compliance](14-privacy-and-compliance.md) | Personal data, retention, deletion, open questions |
| 15 | [accessibility-and-i18n](15-accessibility-and-i18n.md) | Keyboard, screen reader, contrast, translation |
| 16 | [technical-decisions](16-technical-decisions.md) | Why each technology, honest rationale |
| 17 | [limitations-and-roadmap](17-limitations-and-roadmap.md) | Honest limitations and a realistic roadmap |
| 18 | [presentation-qa](18-presentation-qa.md) | 100+ questions with answers |
| 19 | [live-demo-guide](19-live-demo-guide.md) | A 12 to 15 minute demo plan |
| 20 | [executive-summary](20-executive-summary.md) | 60-second, 2-minute, 5-minute talks; 20 hard questions |
| 21 | [quick-reference](21-quick-reference.md) | One-page cheat sheet |
| 22 | [audit-evidence-and-methodology](22-audit-evidence-and-methodology.md) | Commands, tests, limits, discrepancies |

Companion reference (already in the repository): [role-permission matrix](../technical/role-permissions.md) and [API reference](../technical/api-reference.md), generated from the code.
