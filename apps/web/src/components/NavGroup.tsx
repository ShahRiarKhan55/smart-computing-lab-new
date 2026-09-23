import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { NavGroupDef } from "./navConfig";
import { NotificationBadge } from "./NotificationBadge";
import { useNotifications } from "../notifications/NotificationsContext";
import { useT } from "../i18n/LocaleContext";

interface NavGroupProps {
  group: NavGroupDef;
  open: boolean;
  /** The current page lives in this group: the trigger looks active even while it is closed. */
  active: boolean;
  /** Open the panel towards the left edge of its trigger instead of the right (the last group). */
  alignEnd?: boolean;
  className?: string;
  onOpenChange: (open: boolean) => void;
  /** Extra items after the links, as `<li>`s (the account group's "Log out" action). */
  children?: ReactNode;
}

const linkClassName = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : undefined);

/**
 * One header dropdown, built as a WAI-ARIA "disclosure navigation" group: a real button
 * (`aria-expanded`, `aria-controls`) that shows or hides a list of ordinary links. It is not
 * `role="menu"`: these are links, and screen readers keep browsing them as links.
 *
 * Opens on click / Enter / Space (never on hover alone, so touch and keyboard work), Arrow keys
 * move through the links, Escape closes and returns focus to the button, and a click or Tab
 * outside closes it. At hamburger widths the same markup is an in-menu accordion (CSS only).
 */
export function NavGroup({ group, open, active, alignEnd, className, onOpenChange, children }: NavGroupProps) {
  // Only the account group ever has a "/notifications" item, so this is a no-op for every other
  // group; a guest's count is always 0 (NotificationsProvider resets it on logout).
  const { unreadCount } = useNotifications();
  const t = useT();
  const label = t(group.labelKey);
  const rootRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const focusFirstOnOpen = useRef(false);
  const panelId = `nav-panel-${group.id}`;

  const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a, button") ?? []);

  // A click anywhere outside the group closes it (focus-out covers the keyboard). It must be the
  // click, not the earlier pointer press: at hamburger widths closing one section shifts the ones
  // below it, and doing that between press and release would send the tap to the wrong element.
  useEffect(() => {
    if (!open) return;
    const since = performance.now();
    const onClick = (e: MouseEvent) => {
      // A click that opened this group from outside (the hamburger expanding the current section)
      // is still bubbling towards document when this listener is added: it must not close it again.
      if (e.timeStamp < since || rootRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open, onOpenChange]);

  // ArrowDown on a closed trigger opens the panel and lands on its first link once it is rendered.
  useEffect(() => {
    if (open && focusFirstOnOpen.current) {
      focusFirstOnOpen.current = false;
      focusables()[0]?.focus();
    }
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Escape" && open) {
      e.stopPropagation(); // the first Escape closes this dropdown only, not the whole mobile menu
      onOpenChange(false);
      triggerRef.current?.focus();
      return;
    }
    const items = focusables();
    const onTrigger = e.target === triggerRef.current;
    if (onTrigger && e.key === "ArrowDown") {
      e.preventDefault();
      if (open) items[0]?.focus();
      else {
        focusFirstOnOpen.current = true;
        onOpenChange(true);
      }
      return;
    }
    if (!open || onTrigger) return;
    const i = items.indexOf(e.target as HTMLElement);
    if (e.key === "ArrowDown") items[Math.min(i + 1, items.length - 1)]?.focus();
    else if (e.key === "ArrowUp") (i <= 0 ? triggerRef.current : items[i - 1])?.focus();
    else if (e.key === "Home") items[0]?.focus();
    else if (e.key === "End") items[items.length - 1]?.focus();
    else return;
    e.preventDefault();
  }

  // Tabbing out of the group closes it. A null relatedTarget (a mouse press in Safari, which does
  // not focus buttons) is ignored: closing then would swallow the click on a link in the panel.
  function onBlur(e: FocusEvent<HTMLLIElement>) {
    if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) onOpenChange(false);
  }

  return (
    <li
      ref={rootRef}
      className={`nav__group${alignEnd ? " nav__group--end" : ""}${className ? ` ${className}` : ""}`}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`nav__trigger${active ? " active" : ""}${open ? " open" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        {label}
        <svg className="nav__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul ref={panelRef} id={panelId} className="nav__panel" aria-label={t("nav.groupMenu", { group: label })} hidden={!open}>
        {group.items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={linkClassName}>
              {t(item.labelKey)}
              {item.to === "/notifications" && <NotificationBadge count={unreadCount} />}
            </NavLink>
          </li>
        ))}
        {children}
      </ul>
    </li>
  );
}
