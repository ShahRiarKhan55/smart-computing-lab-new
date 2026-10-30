# Research areas, projects and groups

Permissions come from `packages/shared/src/permissions.ts`; defaults from `apps/server/prisma/schema.prisma` and the routes. See [role-permissions.md](../technical/role-permissions.md).

| | Research areas | Projects | Groups |
|---|---|---|---|
| Public pages | `/research`, `/research/:id` | `/projects`, `/projects/:id` | `/groups`, `/groups/:id` |
| Create | any signed-in account | **lab manager, administrator** | **lab manager, administrator** |
| Edit | any signed-in account | manager, administrator, or a member who is `LEAD` of that project | manager, administrator, or a `LEAD` of that group |
| Delete | manager, administrator | manager, administrator | manager, administrator |
| Visibility, slug, sort order, group assignment | manager, administrator (visibility) | manager, administrator only (even for a lead) | manager, administrator only (even for a lead) |
| Default visibility when created | `PUBLIC` | `LAB_ONLY` | `LAB_ONLY` |

## Relationships

Research areas, projects, groups and researchers are connected (see [database.md](../technical/database.md)):

- A project belongs to at most one group, can be linked to several research areas and publications, and has members with the role `LEAD` or `MEMBER`.
- A project's status is shown as planned, active, completed or archived.
- A researcher's own research areas are edited on their profile (the profile's owner or a manager). Setting the whole list of researchers on an area is a manager action.
- Project and group membership can be managed by a manager or by a `LEAD` of that project or group. The **My Workspace** page (`/workspace`) shows each signed-in person their own projects, groups and areas.

## Workflows

- **Create a project (manager or administrator):** open **Research → Projects** and use the add control; the project starts `LAB_ONLY`. Set visibility to public when it is ready.
- **Change who is on a project:** a lead or manager edits the project's members.
- **Make a record public:** a manager or administrator sets visibility (single record, or in bulk under **Admin Dashboard → Research content**).

## Needs verification

- The exact labels of the add buttons on the Projects and Groups pages are provided by the translation dictionary; look them up in `packages/shared/src/i18n/en.ts` (`projects.*`, `groups.*`) before quoting them in training material.
