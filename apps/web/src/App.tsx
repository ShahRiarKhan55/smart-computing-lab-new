import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { canAccessAdmin, canManageUsers, canReviewPublicationImports, isAdmin } from "@scl/shared";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import { LoadingState } from "./components/LoadingState";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { NotificationsProvider } from "./notifications/NotificationsContext";
import { useT } from "./i18n/LocaleContext";
import { HomePage } from "./pages/HomePage";
import { ResearchPage } from "./pages/ResearchPage";
import { TeamPage } from "./pages/TeamPage";
import { MemberPage } from "./pages/MemberPage";
import { PublicationsPage } from "./pages/PublicationsPage";
import { NewsPage } from "./pages/NewsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { GroupsPage } from "./pages/GroupsPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { EventsPage } from "./pages/EventsPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { ContactPage } from "./pages/ContactPage";
import { LoginPage } from "./pages/LoginPage";
import { InvitePage } from "./pages/InvitePage";
import { ProfilePage } from "./pages/ProfilePage";
import { SchedulePage } from "./pages/SchedulePage";
import { SearchPage } from "./pages/SearchPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ResearchAreaDetailPage } from "./pages/ResearchAreaDetailPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// Phase 26 §8 — route-level code splitting. Everything above stays a static import: Home and the
// pages one click from it (research/team/projects/groups/news/publications lists, events, contact,
// login) must stay fast and available with no extra network round trip, and none of them is large
// on its own. Everything below is `React.lazy`: whole feature areas that are large, only reached
// by a signed-in/authorized subset of visitors, or both — the actual candidates the Phase 25
// bundle-size finding (a single ~872 KB chunk) was about. See docs/architecture/phase26-… for the
// measured before/after.
//
// SearchPage is DELIBERATELY excluded from this list despite being named in the brief's example
// list: measured at only 8.00 KB / 2.90 KB gzip (one of the smallest candidates), and the full
// browser-regression sweep caught a real, reproducible problem from splitting it — its own
// network-throttled "shows an in-flight loading state" check (`browser-regression.cjs` line
// ~785) uses CDP `Network.emulateNetworkConditions` to hold the connection slow specifically so it
// can observe the brief in-flight moment; with SearchPage lazy, the ADDED chunk-fetch hop before
// the component even mounts consumed enough of that throttled window that the check's fixed
// timeout was reached before `.search-region` ever existed, which then threw (`.offsetHeight` on
// `null`) instead of failing cleanly — and because that throw happened before the step's own
// code could reset the network throttle back to normal, it cascaded into dozens of unrelated
// failures for the rest of that sweep run (search for every other role, then navigation). Not a
// theoretical concern — reproduced once, root-caused, fixed by keeping this one page eager, then
// verified clean on a full re-run (see docs/architecture/phase26-…).
//
// ProjectDetailPage is excluded for the same reason, found by the same sweep: the "loading" step
// (browser-regression.cjs, the `spaGo` helper) throttles network latency to 1200ms and does an
// in-app (client-side) navigation straight to a project detail page, asserting its own
// "Loading project…" text appears within 2500ms. With this page lazy, the added chunk-fetch hop
// ate enough of that window that the assertion missed on first navigation (a real, reproduced
// failure, isolated and confirmed independent of the SearchPage issue above — see
// docs/architecture/phase26-…). Unlike SearchPage this did not cascade (a soft assertion miss, not
// a thrown error), but the same standard applies: a demonstrated real timing regression, not kept
// on a theoretical "should be fine in production" argument.
//
// ResearchAreaDetailPage, KnowledgePage and ResourcesPage were found by the same full sweep and
// excluded for the same reason (each isolated and reproduced independently — see
// docs/architecture/phase26-…):
//   - ResearchAreaDetailPage: a check presses Enter on a focused area-card link, confirms the URL
//     changed, then immediately (no wait) asserts exactly one <h1> and one <main> remain. Right
//     after the URL changes but before the lazy chunk resolves, neither this page's own <h1> nor
//     the generic Suspense fallback (which renders no <h1> at all) satisfies that count.
//   - KnowledgePage / ResourcesPage: each has its own network-throttled "shows a labelled loading
//     skeleton" check (the same technique as the SearchPage one above, throttled to 1500ms),
//     asserting its OWN specific skeleton text ("Loading documents…" / "Loading resources…") — not
//     satisfied by the generic Suspense fallback's "Loading…" text during the added chunk-fetch hop.
const PublicationDetailPage = lazy(() => import("./pages/PublicationDetailPage").then((m) => ({ default: m.PublicationDetailPage })));
const PublicationImportsPage = lazy(() => import("./pages/PublicationImportsPage").then((m) => ({ default: m.PublicationImportsPage })));
const CopyrightPage = lazy(() => import("./pages/CopyrightPage").then((m) => ({ default: m.CopyrightPage })));
const AlumniPage = lazy(() => import("./pages/AlumniPage").then((m) => ({ default: m.AlumniPage })));
const WorkspacePage = lazy(() => import("./pages/WorkspacePage").then((m) => ({ default: m.WorkspacePage })));
const KnowledgeDetailPage = lazy(() => import("./pages/KnowledgeDetailPage").then((m) => ({ default: m.KnowledgeDetailPage })));
const ResourceDetailPage = lazy(() => import("./pages/ResourceDetailPage").then((m) => ({ default: m.ResourceDetailPage })));
const GalleryPage = lazy(() => import("./pages/GalleryPage").then((m) => ({ default: m.GalleryPage })));
const ForumIndexPage = lazy(() => import("./pages/community/ForumIndexPage").then((m) => ({ default: m.ForumIndexPage })));
const ForumCategoryPage = lazy(() => import("./pages/community/ForumCategoryPage").then((m) => ({ default: m.ForumCategoryPage })));
const ForumTopicPage = lazy(() => import("./pages/community/ForumTopicPage").then((m) => ({ default: m.ForumTopicPage })));
const MessagesPage = lazy(() => import("./pages/MessagesPage").then((m) => ({ default: m.MessagesPage })));
const ConversationPage = lazy(() => import("./pages/ConversationPage").then((m) => ({ default: m.ConversationPage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const AdminOverviewPage = lazy(() => import("./pages/admin/AdminOverviewPage").then((m) => ({ default: m.AdminOverviewPage })));
const AdminPeoplePage = lazy(() => import("./pages/admin/AdminPeoplePage").then((m) => ({ default: m.AdminPeoplePage })));
const AdminContentPage = lazy(() => import("./pages/admin/AdminContentPage").then((m) => ({ default: m.AdminContentPage })));
const AdminEventsPage = lazy(() => import("./pages/admin/AdminEventsPage").then((m) => ({ default: m.AdminEventsPage })));
const AdminCommunityPage = lazy(() => import("./pages/admin/AdminCommunityPage").then((m) => ({ default: m.AdminCommunityPage })));
const AdminFilesPage = lazy(() => import("./pages/admin/AdminFilesPage").then((m) => ({ default: m.AdminFilesPage })));
const AdminTranslationsPage = lazy(() => import("./pages/admin/AdminTranslationsPage").then((m) => ({ default: m.AdminTranslationsPage })));
const AdminAuditPage = lazy(() => import("./pages/admin/AdminAuditPage").then((m) => ({ default: m.AdminAuditPage })));
const DocsIndexPage = lazy(() => import("./pages/docs/DocsIndexPage").then((m) => ({ default: m.DocsIndexPage })));
const DocPage = lazy(() => import("./pages/docs/DocPage").then((m) => ({ default: m.DocPage })));

function RouteFallback() {
  const t = useT();
  // Same accessible skeleton every data-loading state in this app already uses (role="status",
  // aria-live="polite", sr-only label) — a route boundary loading is announced the same way a
  // within-page one is, not a special case invented for this phase.
  return <LoadingState label={t("common.loading")} variant="text" />;
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <NotificationsProvider>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Nav />
      {/* One <main> landmark for every page; keyed by path so each page eases in fresh. */}
      <main id="main" tabIndex={-1} key={pathname} className="page-enter">
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/research/:id" element={<ResearchAreaDetailPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:id" element={<GroupDetailPage />} />
        <Route path="/community/forum" element={<ForumIndexPage />} />
        <Route path="/community/forum/category/:slug" element={<ForumCategoryPage />} />
        <Route path="/community/forum/topic/:id" element={<ForumTopicPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/:id" element={<KnowledgeDetailPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/resources/:id" element={<ResourceDetailPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/team/:id" element={<MemberPage />} />
        <Route path="/copyright" element={<CopyrightPage />} />
        <Route path="/alumni" element={<AlumniPage />} />
        <Route path="/publications" element={<PublicationsPage />} />
        <Route
          path="/publications/review"
          element={
            <ProtectedRoute allow={canReviewPublicationImports}>
              <PublicationImportsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/publications/:id" element={<PublicationDetailPage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route
          path="/schedule"
          element={
            <ProtectedRoute>
              <SchedulePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspace"
          element={
            <ProtectedRoute>
              <WorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <MessagesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/messages/:id"
          element={
            <ProtectedRoute>
              <ConversationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <NotificationsPage />
            </ProtectedRoute>
          }
        />
        {/* Phase 17: the admin area is for managers and admins; only /admin/people (accounts) stays admin-only. The API re-checks every request. */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allow={canAccessAdmin}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminOverviewPage />} />
          <Route
            path="people"
            element={
              <ProtectedRoute allow={canManageUsers}>
                <AdminPeoplePage />
              </ProtectedRoute>
            }
          />
          <Route path="content" element={<AdminContentPage />} />
          <Route path="events" element={<AdminEventsPage />} />
          <Route path="community" element={<AdminCommunityPage />} />
          <Route path="files" element={<AdminFilesPage />} />
          <Route path="translations" element={<AdminTranslationsPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
        </Route>
        {/* Documentation (researcher onboarding phase). Access control mirrors each guide's own
            audience: quick-start/visitor/onboarding are public (onboarding in particular MUST stay
            public — its reader has no account yet), researcher requires any signed-in account,
            admin/maintenance require manager/admin as ProtectedRoute's `allow` already does for
            /admin itself. This is UX gating only, same as every other ProtectedRoute use below —
            these pages contain no secrets, so there is nothing for an API-level check to protect
            beyond what the rest of the bundle already doesn't. */}
        <Route path="/docs" element={<DocsIndexPage />} />
        <Route path="/docs/quick-start" element={<DocPage slug="quick-start" />} />
        <Route path="/docs/visitor" element={<DocPage slug="public-visitor-guide" />} />
        <Route path="/docs/onboarding" element={<DocPage slug="researcher-onboarding" />} />
        <Route
          path="/docs/researcher"
          element={
            <ProtectedRoute>
              <DocPage slug="researcher-guide" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/docs/admin"
          element={
            <ProtectedRoute allow={canAccessAdmin}>
              <DocPage slug="admin-guide" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/docs/maintenance"
          element={
            <ProtectedRoute allow={isAdmin}>
              <DocPage slug="site-maintainer-guide" />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      </main>
      <Footer />
    </NotificationsProvider>
  );
}
