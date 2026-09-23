/**
 * app.js
 *
 * Shared across every page. Handles:
 *  - checking login state and updating the nav bar
 *  - small fetch helpers for talking to the PHP API
 *  - the mobile hamburger menu toggle
 *
 * Include this on every page AFTER the nav markup, with:
 *   <script src="/js/app.js" data-base="."></script>
 * (data-base = relative path back to the site root, e.g. ".." from /pages/)
 */

(function () {
  const scriptTag = document.currentScript;
  const BASE = (scriptTag && scriptTag.getAttribute('data-base')) || '.';

  window.SCL = window.SCL || {};

  // -----------------------------------------------------------
  // Fetch helpers
  // -----------------------------------------------------------
  window.SCL.api = async function (path, options = {}) {
    const res = await fetch(`${BASE}/api/${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  };

  window.SCL.base = BASE;

  // -----------------------------------------------------------
  // Auth state — fetched once per page load, cached on window.SCL.user
  // -----------------------------------------------------------
  async function loadSession() {
    try {
      const data = await window.SCL.api('auth.php?action=me');
      window.SCL.user = data.user; // null if logged out
    } catch (e) {
      window.SCL.user = null;
    }
    updateNav();
    document.dispatchEvent(new CustomEvent('scl:session-ready', { detail: window.SCL.user }));
  }

  function updateNav() {
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;

    // Remove any previously-injected auth items so we don't duplicate
    // on re-render.
    navLinks.querySelectorAll('[data-auth-item]').forEach((el) => el.remove());

    const user = window.SCL.user;

    if (user) {
      const scheduleLi = document.createElement("li");
      scheduleLi.setAttribute("data-auth-item", "");
      scheduleLi.innerHTML = `<a href="${BASE}/schedule.html">Schedule</a>`;
      navLinks.appendChild(scheduleLi);

      const profileLi = document.createElement('li');
      profileLi.setAttribute('data-auth-item', '');
      profileLi.innerHTML = `<a href="${BASE}/profile.html">My Profile</a>`;
      navLinks.appendChild(profileLi);

      if (user.role === 'ADMIN') {
        const adminLi = document.createElement('li');
        adminLi.setAttribute('data-auth-item', '');
        adminLi.innerHTML = `<a href="${BASE}/admin.html">Admin <span class="nav__pill">A</span></a>`;
        navLinks.appendChild(adminLi);
      }

      const logoutLi = document.createElement('li');
      logoutLi.setAttribute('data-auth-item', '');
      const logoutBtn = document.createElement('button');
      logoutBtn.textContent = 'Log out';
      logoutBtn.addEventListener('click', async () => {
        await window.SCL.api('auth.php?action=logout', { method: 'POST' });
        window.location.href = `${BASE}/index.html`;
      });
      logoutLi.appendChild(logoutBtn);
      navLinks.appendChild(logoutLi);
    } else {
      const loginLi = document.createElement('li');
      loginLi.setAttribute('data-auth-item', '');
      loginLi.innerHTML = `<a href="${BASE}/login.html">Log in</a>`;
      navLinks.appendChild(loginLi);
    }
  }

  // -----------------------------------------------------------
  // Mobile hamburger
  // -----------------------------------------------------------
  function initHamburger() {
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    if (hamburger && navLinks) {
      hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
    }
  }

  // -----------------------------------------------------------
  // Tiny HTML-escaping helper for safely inserting user/db content
  // -----------------------------------------------------------
  window.SCL.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  document.addEventListener('DOMContentLoaded', () => {
    initHamburger();
    loadSession();
  });
})();
