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

// The batch form shows only the input the chosen action reads.
function batchfields(sel) {
	for (const d of sel.form.querySelectorAll('[data-action]'))
		d.hidden = !d.dataset.action.split(' ').includes(sel.value);
}
document.addEventListener('change', (ev) => {
	if (ev.target.matches('select[data-batch]'))
		batchfields(ev.target);
});
for (const sel of document.querySelectorAll('select[data-batch]'))
	batchfields(sel);

// "+ Column" and "+ Filter" clone the last row and renumbers its field names.
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

// On narrow screens the sidebar stacks above the page, so start it collapsed.
if (matchMedia('(max-width: 900px)').matches)
	for (const d of document.querySelectorAll('aside[data-sidebar] details'))
		d.open = false;
