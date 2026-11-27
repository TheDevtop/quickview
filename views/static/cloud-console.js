/*!
 * Cloud Console UI v2.0.0 (cloud-console.js)
 * Minimal vanilla JS enhancements for semantic HTML components.
 */
(function (global) {
  'use strict';

  // Item to move focus to for Home/End/prev/next keys, or null for any other key.
  // cur may be outside items (e.g. a menu's <summary>): next is then the first item.
  function step(items, cur, key, prev, next) {
    if (items.length === 0) return null;
    const i = items.indexOf(cur);
    if (key === 'Home') return items[0];
    if (key === 'End') return items[items.length - 1];
    if (key === prev) return items[(i <= 0 ? items.length : i) - 1];
    if (key === next) return items[(i + 1) % items.length];
    return null;
  }

  // Copy a range slider's value into every <output for="..."> naming it.
  function showRange(input) {
    if (input.id === '') return;
    document.querySelectorAll('output[for~="' + CSS.escape(input.id) + '"]').forEach((o) => {
      o.value = input.value;
    });
  }

  function sort(th) {
    const tbody = th.closest('table').tBodies[0];
    if (!tbody) return;
    const col = th.cellIndex;
    const num = th.getAttribute('data-sort') === 'number';
    const asc = th.getAttribute('aria-sort') !== 'ascending';
    th.parentElement.querySelectorAll('th[data-sort]').forEach((h) => h.removeAttribute('aria-sort'));
    th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
    const text = (r) => r.cells[col]?.textContent.trim() || '';
    tbody.append(...Array.from(tbody.rows).sort((a, b) => {
      const x = text(a), y = text(b);
      return (asc ? 1 : -1) * (num ? Number(x) - Number(y) : x.localeCompare(y));
    }));
  }

  const CloudConsole = {
    /**
     * Display a non-blocking GCP-style snackbar toast at bottom-right.
     * @param {string} message
     * @param {number} [duration=2600]
     */
    toast(message, duration = 2600) {
      let stack = document.querySelector('.cc-toast-stack');
      if (!stack) {
        stack = document.body.appendChild(document.createElement('div'));
        stack.className = 'cc-toast-stack';
        stack.setAttribute('aria-live', 'polite');
      }
      const item = stack.appendChild(document.createElement('div'));
      item.className = 'cc-toast';
      item.textContent = message;
      setTimeout(() => {
        item.style.opacity = '0';
        item.style.transition = 'opacity 150ms ease';
        setTimeout(() => item.remove(), 160);
      }, duration);
    },

    /**
     * Toggle between [data-theme="light"] and [data-theme="dark"].
     */
    toggleTheme() {
      const root = document.documentElement;
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      CloudConsole.toast('Switched to ' + next + ' console theme');
    },

    /**
     * Select a [role="tab"], show its aria-controls panel and hide its siblings' panels.
     * Only the selected tab is in the Tab order; arrow keys move between the others.
     * @param {Element} tab
     */
    selectTab(tab) {
      const panel = (t) => document.getElementById(t.getAttribute('aria-controls') || '');
      // Hide every panel before showing the chosen one: several tabs may share a panel.
      tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]').forEach((t) => {
        t.setAttribute('aria-selected', String(t === tab));
        t.tabIndex = t === tab ? 0 : -1;
        if (panel(t)) panel(t).hidden = true;
      });
      if (panel(tab)) panel(tab).hidden = false;
    },

    /**
     * Set a table's [data-cc-select-all] checkbox to checked, unchecked or
     * indeterminate from its row checkboxes. Call after adding or removing rows.
     * @param {HTMLTableElement} table
     */
    syncSelectAll(table) {
      const all = table.querySelector('[data-cc-select-all]');
      if (!all) return;
      const total = table.querySelectorAll('tbody input[type="checkbox"]').length;
      const n = table.querySelectorAll('tbody input[type="checkbox"]:checked').length;
      all.checked = total > 0 && n === total;
      all.indeterminate = n > 0 && n < total;
    },

    /**
     * Initialize ARIA tablists ([data-cc-tabs]), sortable tables ([data-cc-sortable]),
     * select-all checkboxes ([data-cc-select-all]), dropdown menu keyboard navigation,
     * range <output> values, and global keyboard shortcuts.
     */
    init() {
      document.querySelectorAll('[data-cc-tabs] [role="tab"]').forEach((t) => {
        t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
      });
      document.querySelectorAll('input[type="range"]').forEach(showRange);

      document.addEventListener('click', (e) => {
        const t = e.target;
        const tab = t.closest('[data-cc-tabs] [role="tab"]');
        if (tab) CloudConsole.selectTab(tab);
        if (t.closest('[data-cc-theme-toggle]')) CloudConsole.toggleTheme();

        // Close dropdowns on outside or item click, and a [popover] (e.g. nav[data-drawer]) once a link in it is followed
        document.querySelectorAll('details[role="list"][open]').forEach((menu) => {
          if (!menu.contains(t) || t.closest('ul button, ul a')) menu.removeAttribute('open');
        });
        const popover = t.closest('[popover]');
        if (popover && t.closest('a[href]') && popover.matches(':popover-open')) popover.hidePopover();

        const th = t.closest('table[data-cc-sortable] th[data-sort]');
        if (th) sort(th);
      });

      // Row checkboxes highlight their row; the header goes indeterminate on partial selection
      document.addEventListener('change', (e) => {
        const cb = e.target;
        const table = cb.closest('table');
        if (cb.matches('[data-cc-select-all]')) {
          table.querySelectorAll('tbody input[type="checkbox"]').forEach((c) => {
            c.checked = cb.checked;
            c.closest('tr')?.setAttribute('aria-selected', String(cb.checked));
          });
        } else if (cb.matches('tbody input[type="checkbox"]')) {
          cb.closest('tr')?.setAttribute('aria-selected', String(cb.checked));
          if (table) CloudConsole.syncSelectAll(table);
        }
      });

      document.addEventListener('input', (e) => {
        if (e.target.matches('input[type="range"]')) showRange(e.target);
      });
      document.addEventListener('reset', (e) => {
        // reset fires before the form restores its values
        setTimeout(() => e.target.querySelectorAll('input[type="range"]').forEach(showRange));
      });

      // Tab & menu arrows, `/` focuses the topbar search, `Escape` closes menus
      document.addEventListener('keydown', (e) => {
        const tab = e.target.closest('[data-cc-tabs] [role="tab"]');
        if (tab) {
          const tabs = Array.from(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]:not(:disabled)'));
          const next = step(tabs, tab, e.key, 'ArrowLeft', 'ArrowRight');
          if (next) {
            e.preventDefault();
            next.focus();
            CloudConsole.selectTab(next);
            return;
          }
        }

        const menu = e.target.closest('details[role="list"]');
        if (menu && e.key !== 'Escape') {
          const items = Array.from(menu.querySelectorAll(':scope > ul :is(button, a):not(:disabled)'));
          const next = step(items, e.target, e.key, 'ArrowUp', 'ArrowDown');
          // On a closed menu only the arrows act, so Home/End still scroll the page.
          if (next && (menu.open || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            menu.open = true;
            next.focus();
            return;
          }
        }

        if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
          const search = document.querySelector('header[data-topbar] input[type="search"]');
          if (search) {
            e.preventDefault();
            search.focus();
          }
        } else if (e.key === 'Escape') {
          document.querySelectorAll('details[role="list"][open]').forEach((m) => m.removeAttribute('open'));
          menu?.querySelector(':scope > summary')?.focus();
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CloudConsole.init());
  } else {
    CloudConsole.init();
  }

  global.CloudConsole = CloudConsole;
})(window);
