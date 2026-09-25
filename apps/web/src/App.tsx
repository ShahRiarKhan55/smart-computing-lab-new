import { Route, Routes, useLocation } from "react-router-dom";
import { canAccessAdmin, canManageUsers } from "@scl/shared";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { NotificationsProvider } from "./notifications/NotificationsContext";
import { HomePage } from "./pages/HomePage";
import { ResearchPage } from "./pages/ResearchPage";
import { ResearchAreaDetailPage } from "./pages/ResearchAreaDetailPage";
import { TeamPage } from "./pages/TeamPage";
import { MemberPage } from "./pages/MemberPage";
import { PublicationsPage } from "./pages/PublicationsPage";
import { NewsPage } from "./pages/NewsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { GroupsPage } from "./pages/GroupsPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { ForumIndexPage } from "./pages/community/ForumIndexPage";
import { ForumCategoryPage } from "./pages/community/ForumCategoryPage";
import { ForumTopicPage } from "./pages/community/ForumTopicPage";
import { GalleryPage } from "./pages/GalleryPage";
import { EventsPage } from "./pages/EventsPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { SearchPage } from "./pages/SearchPage";
import { ContactPage } from "./pages/ContactPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SchedulePage } from "./pages/SchedulePage";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminOverviewPage } from "./pages/admin/AdminOverviewPage";
import { AdminPeoplePage } from "./pages/admin/AdminPeoplePage";
import { AdminContentPage } from "./pages/admin/AdminContentPage";
import { AdminEventsPage } from "./pages/admin/AdminEventsPage";
import { AdminCommunityPage } from "./pages/admin/AdminCommunityPage";
import { AdminFilesPage } from "./pages/admin/AdminFilesPage";
import { AdminTranslationsPage } from "./pages/admin/AdminTranslationsPage";
import { AdminAuditPage } from "./pages/admin/AdminAuditPage";
import { MessagesPage } from "./pages/MessagesPage";
import { ConversationPage } from "./pages/ConversationPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

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
        <Route path="/team" element={<TeamPage />} />
        <Route path="/team/:id" element={<MemberPage />} />
        <Route path="/publications" element={<PublicationsPage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/schedule"
          element={
            <ProtectedRoute>
              <SchedulePage />
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
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </main>
      <Footer />
    </NotificationsProvider>
  );
}
