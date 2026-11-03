# 14. Privacy, data governance and compliance

**This document is not legal advice and makes no claim of GDPR, Japanese APPI, university-policy or any other legal compliance.** Those need an assessment by the university's data-protection or legal staff.

## Personal data stored (VERIFIED from the schema)
| Data | Table | Why | Who can see it |
|---|---|---|---|
| Email, password hash, role | `User` | sign-in | administrators see emails in People & Accounts; hashes are never returned |
| Name, initials, role/title, department, bio, photo, research links (Google Scholar, ResearchGate, ORCID) | `TeamMember` | public profile | public if the profile is published (all non-alumni profiles are published by default); alumni only after an administrator publishes |
| Employment/education history | `HistoryEntry` | profile | with the profile |
| Authorship links | `PublicationAuthor`, `NewsAuthor` | attribution | public with the record |
| Private messages and notifications | `Message`, `Conversation`, `Notification` | member messaging | participants only; no admin surface reads them |
| Forum posts, comments, reactions | `Forum*` | discussion | per category visibility |
| Uploaded files and photos | `StoredFile` + Blob | content | per file visibility |
| Session data (user id, short OAuth transaction state) | `Session` | login | server only |
| Google identity (subject id) | `OAuthIdentity` | optional Google sign-in | server only; email and name from Google are not stored (only the subject) |
| Audit log (actor id and **email snapshot**, action, entity, limited details) | `AuditLog` | accountability | managers see most rows; account events and emails and alumni rows are admin-only |
| Invitation (email, role, token hash, inviter) | `AccountInvitation` | onboarding | admin |

## Alumni consent
Alumni profiles are created unpublished and shown only after an administrator explicitly publishes them; the confirmation text asks the administrator to publish only if the person agreed. The system does not record who consented, when, or in what form (no consent record), only the published flag (VERIFIED, `alumni.*` strings, `memberVisibility.ts`).

## Third parties (VERIFIED from code and CSP)
Vercel (hosting, logs, edge), Turso (database), Vercel Blob (files), GitHub (source), Google Fonts (visitors' browsers request fonts from Google; IP addresses reach Google), Google Calendar (embedded on `/schedule`), Google OAuth (only when a member uses it). There are no analytics, advertising or tracking scripts in the repository (`script-src 'self'`).

## Retention, deletion, export
- **Retention policy:** none implemented. Content, messages, audit rows and sessions are kept until deleted or expired.
- **Deletion:** an administrator deletes an account; the profile is unlinked and kept; authored content stays with a null owner; reactions, notifications, memberships and Google links are removed; messages remain with a null sender; audit rows keep the email snapshot (F-19). Deleting a profile removes it and its history. There is no documented "right to erasure" procedure, and backups would still contain the data (**Unknown** retention).
- **Export:** NOT IMPLEMENTED. Users cannot download their data.
- **Privacy documentation:** NOT FOUND (no privacy notice page, no cookie notice). The only cookie is the first-party session cookie `scl.sid` (and `localStorage` for language).

## Open questions for the university
Legal basis and notice for staff and student profiles; consent for photos and alumni; retention periods; where Vercel, Turso and Blob store data (regions are not visible in the repository); cross-border transfer; breach-notification process; whether Google Fonts and Calendar are acceptable; student data handling for MSc/BSc members; rules for downloaded database copies (they contain real emails and messages).

## Appropriate improvements for a university lab
Add a privacy notice and contact; record alumni consent (date, evidence); define retention (messages, audit emails, sessions); an erasure and export procedure; self-host fonts; minimise audit email snapshots; restrict who can see members' emails; encrypt and expire backups; minimise stored profile data to what is needed.
