/*!
 * Cloud Console UI v2.0.0 (cloud-console.js)
 * Minimal vanilla JS enhancements for semantic HTML components.
 */
(function (global) {
  'use strict';

  const CloudConsole = {
    /**
     * Display a non-blocking GCP-style snackbar toast at bottom-right.
     * @param {string} message
     * @param {number} [duration=2600]
     */
    toast(message, duration = 2600) {
      let stack = document.querySelector('.cc-toast-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'cc-toast-stack';
        stack.setAttribute('aria-live', 'polite');
        document.body.appendChild(stack);
      }
      const item = document.createElement('div');
      item.className = 'cc-toast';
      item.textContent = message;
      stack.appendChild(item);
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
     * Initialize ARIA tablists ([data-cc-tabs]), sortable tables ([data-cc-sortable]),
     * select-all checkboxes ([data-cc-select-all]), and global keyboard shortcuts.
     */
    init() {
      // 1. Semantic ARIA Tabs ([data-cc-tabs])
      document.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-cc-tabs] [role="tab"]');
        if (tab) {
          const list = tab.closest('[role="tablist"]');
          list.querySelectorAll('[role="tab"]').forEach((t) => {
            const active = t === tab;
            t.setAttribute('aria-selected', String(active));
            const panelId = t.getAttribute('aria-controls');
            const panel = panelId && document.getElementById(panelId);
            if (panel) panel.hidden = !active;
          });
        }

        // 2. Theme Toggle Button
        if (e.target.closest('[data-cc-theme-toggle]')) {
          CloudConsole.toggleTheme();
        }

        // 3. Auto-close open <details role="list"> dropdowns on outside click or item click
        document.querySelectorAll('details[role="list"][open]').forEach((menu) => {
          if (!menu.contains(e.target) || e.target.closest('ul button, ul a')) {
            menu.removeAttribute('open');
          }
        });

        // 4. Sortable Table Headers (th[data-sort])
        const th = e.target.closest('table[data-cc-sortable] th[data-sort]');
        if (th) {
          const table = th.closest('table');
          const tbody = table.tBodies[0];
          if (!tbody) return;
          const colIdx = Array.from(th.parentElement.children).indexOf(th);
          const type = th.getAttribute('data-sort');
          const asc = th.getAttribute('aria-sort') !== 'ascending';

          th.parentElement.querySelectorAll('th[data-sort]').forEach((h) => h.removeAttribute('aria-sort'));
          th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');

          const rows = Array.from(tbody.rows);
          rows.sort((a, b) => {
            const valA = a.cells[colIdx]?.textContent.trim() || '';
            const valB = b.cells[colIdx]?.textContent.trim() || '';
            if (type === 'number') {
              return asc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
            }
            return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
          });
          rows.forEach((r) => tbody.appendChild(r));
        }
      });

      // 5. Table Select-All & Row Highlight Checkboxes
      document.addEventListener('change', (e) => {
        if (e.target.matches('[data-cc-select-all]')) {
          const table = e.target.closest('table');
          const checked = e.target.checked;
          table.querySelectorAll('tbody input[type="checkbox"]').forEach((cb) => {
            cb.checked = checked;
            cb.closest('tr')?.setAttribute('aria-selected', String(checked));
          });
        } else if (e.target.matches('tbody input[type="checkbox"]')) {
          const tr = e.target.closest('tr');
          if (tr) tr.setAttribute('aria-selected', String(e.target.checked));
        }
      });

      // 6. Global `/` Search Shortcut & `Escape` Menu Dismissal
      document.addEventListener('keydown', (e) => {
        if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
          const search = document.querySelector('header[data-topbar] input[type="search"]');
          if (search) {
            e.preventDefault();
            search.focus();
          }
        } else if (e.key === 'Escape') {
          document.querySelectorAll('details[role="list"][open]').forEach((m) => m.removeAttribute('open'));
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
