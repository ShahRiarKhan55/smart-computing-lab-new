# News, events, knowledge, resources and gallery

Permissions: [role-permissions.md](../technical/role-permissions.md). Visibility defaults come from `apps/server/prisma/schema.prisma`.

| Content | Public page | Create | Edit / delete | Visibility (who sets it) | Default |
|---|---|---|---|---|---|
| News | `/news` | any signed-in account | edit: any signed-in account; delete: manager, administrator | manager, administrator | `PUBLIC` |
| Events | `/events`, `/events/:id` | any signed-in account | creator or manager | manager, administrator | `LAB_ONLY` |
| Knowledge documents | `/knowledge` | any signed-in account | author or manager | manager, administrator | `LAB_ONLY` |
| Lab resources | `/resources` | any signed-in account | owner or manager | manager, administrator | `LAB_ONLY` |
| Gallery | `/gallery` | any signed-in account | owner or manager | manager, administrator (the file's visibility is the single source of truth) | `LAB_ONLY` |
| Forum | `/community/forum` | topics, comments and reactions: any signed-in account | text: author only; delete: author or manager; moderation: manager | per **category**, manager | `LAB_ONLY` |

Content made by a member that defaults to `LAB_ONLY` stays visible only to signed-in accounts until a manager or administrator makes it public. News, publications and research areas are the exception: they are public from the start unless a manager says otherwise.

## News

- Items can be linked to a project and to team members as authors (the author list is edited with `PUT /api/news/:id/authors`).
- Deleting news is a manager or administrator action.

## Events

- An event has a date, time, location and kind, and may be linked to a project (a manager action). If the creator's account is deleted, only managers can change the event.
- Managers see all events under **Admin Dashboard → Events**.

## Gallery and media

- Gallery images are grouped by category: **Lab life**, **Event**, **Research**, **Other**.
- One gallery entry can hold several images (up to 10 per upload batch). JPEG, PNG, WebP and GIF, up to 5 MB each; metadata is stripped on upload. See [file-storage.md](../technical/file-storage.md).
- Managers see uploaded files and gallery items under **Admin Dashboard → Files & Gallery**.
- Profile photos are uploaded from **Account → My Profile**.

## Forum

Public categories can be read by anyone. A category is created, edited and deleted by a manager or administrator; moderation (pin, lock, hide, move) is a manager action. Private messages and notifications are visible only to the people they involve; no administrator surface can read them.

## Needs verification

- Event "kind" values and the exact add-button labels are defined in the translation dictionary; check `packages/shared/src/i18n/en.ts` before quoting them.
