// The eye button toggles a password field between hidden and shown.
document.addEventListener('click', (ev) => {
	const btn = ev.target.closest('button[data-reveal]');
	if (btn === null)
		return;
	const f = document.getElementById(btn.dataset.reveal);
	const shown = f.type === 'password';
	f.type = shown ? 'text' : 'password';
	btn.setAttribute('aria-pressed', String(shown));
	btn.setAttribute('aria-label', shown ? 'Hide token' : 'Show token');
	btn.firstElementChild.textContent = shown ? 'visibility_off' : 'visibility';
	f.focus();
});

// "+ Column" and "+ Condition" clone the last row and renumber its field names.
document.addEventListener('click', (ev) => {
	const btn = ev.target.closest('button[data-add]');
	if (btn === null)
		return;
	const list = btn.previousElementSibling;
	const last = list.lastElementChild;
	const row = last.cloneNode(true);
	const n = list.children.length;
	for (const f of row.querySelectorAll('input, select')) {
		f.name = f.name.replace(/\[\d+\]/, `[${n}]`);
		if (f.tagName === 'SELECT')
			f.selectedIndex = 0;
		else
			f.value = '';
	}
	list.appendChild(row);
	row.querySelector('input').focus();
});

// Destructive forms ask first.
document.addEventListener('submit', (ev) => {
	const msg = ev.target.dataset.confirm;
	if (msg !== undefined && !confirm(msg))
		ev.preventDefault();
});

// The explorer search hides tables whose name does not match.
document.addEventListener('input', (ev) => {
	if (!ev.target.matches('input[data-filter]'))
		return;
	const q = ev.target.value.trim().toLowerCase();
	for (const li of document.getElementById(ev.target.dataset.filter).children)
		li.hidden = q !== '' && !li.textContent.toLowerCase().includes(q);
});

// The editor keeps line numbers beside the text, runs on Ctrl+Enter,
// pretty prints on Format, and swaps in a template when the operation
// changes while the text is still the untouched template.
const ed = document.querySelector('form[data-editor]');
if (ed !== null) {
	const text = ed.querySelector('textarea');
	const gutter = ed.querySelector('.cc-sql-gutter');
	const lines = () => {
		const n = text.value.split('\n').length;
		gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
		text.rows = Math.max(n, 6);
	};
	lines();
	text.addEventListener('input', lines);
	text.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
			ev.preventDefault();
			ed.requestSubmit();
		}
		if (ev.key === 'Tab' && !ev.shiftKey) {
			ev.preventDefault();
			text.setRangeText('  ', text.selectionStart, text.selectionEnd, 'end');
			lines();
		}
	});
	ed.querySelector('[data-format]').addEventListener('click', () => {
		try {
			text.value = JSON.stringify(JSON.parse(text.value), null, 2);
			text.removeAttribute('aria-invalid');
			lines();
		} catch (err) {
			text.setAttribute('aria-invalid', 'true');
			CloudConsole.toast(err.message);
		}
	});
	ed.querySelector('select[data-op]').addEventListener('change', (ev) => {
		if (ed.dataset.fresh === undefined || text.value !== text.defaultValue)
			return;
		const q = new URLSearchParams({ op: ev.target.value });
		if (ed.dataset.table !== undefined)
			q.set('table', ed.dataset.table);
		location.href = '/editor?' + q;
	});
}
