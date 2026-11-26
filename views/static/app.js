// "+ Column" clones the last column/value row and renumbers its field names.
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
