const pagesize = 50;
const nvalue = ['EXISTS', 'MISSING'];
const atomics = ['incr', 'append', 'prepend'];

function bad(msg) {
	const err = new Error(msg);
	err.status = 400;
	return err;
}

function fmterr(err) {
	return err.status !== undefined ? `${err.status}: ${err.message}` : err.message;
}

// back redirects to url carrying either an error or a success message.
function back(res, url, err, msg) {
	const q = err !== undefined ? 'err=' + encodeURIComponent(fmterr(err)) : 'msg=' + encodeURIComponent(msg);
	res.redirect(url + (url.includes('?') ? '&' : '?') + q);
}

function tableurl(t, tab) {
	return '/tables/' + encodeURIComponent(t) + (tab !== undefined ? '?tab=' + tab : '');
}

function rowurl(t, k) {
	return '/tables/' + encodeURIComponent(t) + '/rows/' + encodeURIComponent(k);
}

// HTML forms only carry strings, so every value comes with a type.
function parse(type, raw) {
	raw = raw ?? '';
	switch (type) {
	case 'number': {
		// Quicktable stores every number as a 64-bit float.
		const n = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(n))
			throw bad(`not a number: "${raw}"`);
		if (Number.isInteger(n) && !Number.isSafeInteger(n))
			throw bad(`integer out of range: "${raw}"`);
		return n;
	}
	case 'bool':
		if (raw === 'true')
			return true;
		if (raw === 'false')
			return false;
		throw bad(`not a boolean: "${raw}"`);
	default:
		return raw;
	}
}

function typeof_(v) {
	if (typeof v === 'boolean')
		return 'bool';
	if (typeof v === 'number')
		return 'number';
	return 'string';
}

function show(v) {
	return typeof v === 'string' ? v : JSON.stringify(v);
}

function json(raw, what) {
	if (raw === undefined || raw.trim() === '')
		return undefined;
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw bad(`${what}: ${err.message}`);
	}
}

function int(raw, what) {
	if (raw === undefined || raw === '')
		return undefined;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0)
		throw bad(`${what} must be a non-negative integer`);
	return n;
}

// cols turns form rows [{name, value, type}] into a column map.
function cols(list) {
	const m = {};
	for (const c of list ?? []) {
		if (c.name === undefined || c.name === '')
			continue;
		m[c.name] = parse(c.type, c.value);
	}
	return m;
}

// newcols is cols for inserts: an empty insert returns a key but stores no row.
function newcols(list) {
	const m = cols(list);
	if (Object.keys(m).length === 0)
		throw bad('at least one column is required');
	return m;
}

function blanks(n) {
	return Array.from({ length: n }, () => ({ type: 'string' }));
}

// grid flattens [{rowKey, columns}] into a table with the union of all columns.
function grid(t, rows) {
	const names = [];
	for (const r of rows)
		for (const c of Object.keys(r.columns ?? {}))
			if (!names.includes(c))
				names.push(c);
	names.sort();
	return {
		cols: names,
		rows: rows.map((r) => ({
			key: r.rowKey,
			href: rowurl(t, r.rowKey),
			vals: names.map((c) => {
				const v = r.columns?.[c];
				return v === undefined ? { missing: true } : { v: show(v), num: typeof v === 'number' };
			}),
		})),
	};
}

function querybody(b) {
	if (b.mode === 'json')
		return json(b.json, 'query JSON') ?? {};

	const q = {};
	for (const f of ['prefix', 'startKey', 'endKey'])
		if (b[f] !== undefined && b[f] !== '')
			q[f] = b[f];
	if (b.select !== undefined && b.select.trim() !== '')
		q.select = b.select.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
	if (b.orderDesc === 'on')
		q.orderDesc = true;
	if (b.countOnly === 'on')
		q.countOnly = true;
	const offset = int(b.offset, 'offset');
	if (offset !== undefined)
		q.offset = offset;
	const limit = int(b.limit, 'limit');
	if (limit !== undefined)
		q.limit = limit;

	const where = [];
	for (const w of b.where ?? []) {
		if (w.column === undefined || w.column === '')
			continue;
		const p = { column: w.column, op: w.op };
		if (!nvalue.includes(w.op))
			p.value = parse(w.type, w.value);
		where.push(p);
	}
	if (where.length > 0)
		q.where = where;
	return q;
}

async function home(req, res) {
	res.render('home', { title: 'Explorer' });
}

async function newtable(req, res) {
	res.render('new', { title: 'Create table', cols: blanks(1) });
}

async function create(req, res) {
	const t = req.body.table ?? '';
	try {
		if (t === '')
			throw bad('table name is required');
		const r = await req.qt.insert(t, newcols(req.body.cols));
		back(res, rowurl(t, r.rowKey), undefined, `Created table ${t} with row ${r.rowKey}`);
	} catch (err) {
		back(res, '/new', err);
	}
}

async function table(req, res) {
	const t = req.params.table;
	const tab = req.query.tab ?? 'preview';
	const v = { title: t, table: t, tab, mode: req.query.mode ?? 'builder', form: {}, where: blanks(2), cols: blanks(1) };

	if (tab === 'preview') {
		const page = int(req.query.page, 'page') ?? 0;
		const [n, r] = await Promise.all([
			req.qt.query(t, { countOnly: true }),
			req.qt.query(t, { offset: page * pagesize, limit: pagesize }),
		]);
		v.total = n.count;
		v.grid = grid(t, r.rows ?? []);
		v.page = page;
		v.from = n.count === 0 ? 0 : page * pagesize + 1;
		v.to = page * pagesize + v.grid.rows.length;
		v.prev = page > 0 ? page - 1 : undefined;
		v.next = v.to < n.count ? page + 1 : undefined;
	}
	if (tab === 'keys')
		v.keys = (await req.qt.rows(t)).rows ?? [];
	res.render('table', v);
}

async function query(req, res) {
	const t = req.params.table;
	const b = req.body;
	const mode = b.mode === 'json' ? 'json' : 'builder';
	const where = (b.where ?? []).filter((w) => w.column !== undefined && w.column !== '');
	const v = { title: t, table: t, tab: 'query', mode, form: b, where: where.concat(blanks(1)), cols: blanks(1) };

	try {
		const q = querybody(b);
		v.reqbody = q;
		if (mode === 'json')
			b.json = JSON.stringify(q, null, 2);
		const start = performance.now();
		v.result = await req.qt.query(t, q);
		v.elapsed = (performance.now() - start).toFixed(1);
		if (v.result.rows !== undefined)
			v.grid = grid(t, v.result.rows);
	} catch (err) {
		v.err = fmterr(err);
	}
	res.render('table', v);
}

async function insert(req, res) {
	const t = req.params.table;
	try {
		const r = await req.qt.insert(t, newcols(req.body.cols));
		back(res, rowurl(t, r.rowKey), undefined, `Inserted row ${r.rowKey}`);
	} catch (err) {
		back(res, tableurl(t, 'insert'), err);
	}
}

async function batch(req, res) {
	const t = req.params.table;
	const b = req.body;
	const v = { title: t, table: t, tab: 'batch', form: b, where: blanks(2), cols: blanks(1) };

	try {
		const body = { action: b.action };
		if (b.action === 'write') {
			const m = json(b.mutations, 'mutations JSON');
			if (!Array.isArray(m))
				throw bad('mutations must be a JSON array');
			body.mutations = m;
		} else {
			body.rowKeys = (b.rowKeys ?? '').split(/[\s,]+/).filter((k) => k.length > 0);
			if (body.rowKeys.length === 0)
				throw bad('at least one row key is required');
		}
		v.reqbody = body;
		v.result = await req.qt.batch(t, body);
		if (b.action !== 'get')
			return back(res, tableurl(t, 'batch'), undefined, `Batch ${b.action} applied`);
		const rows = Object.entries(v.result.rows ?? {}).map(([rowKey, columns]) => ({ rowKey, columns }));
		v.grid = grid(t, rows);
	} catch (err) {
		v.err = fmterr(err);
	}
	res.render('table', v);
}

async function drop(req, res) {
	const t = req.params.table;
	if (req.body.confirm !== t)
		return back(res, tableurl(t, 'details'), bad('confirmation does not match the table name'));
	try {
		await req.qt.drop(t);
		back(res, '/', undefined, `Dropped table ${t}`);
	} catch (err) {
		back(res, tableurl(t, 'details'), err);
	}
}

async function row(req, res) {
	const { table: t, row: k } = req.params;
	const r = await req.qt.getrow(t, k);
	const list = Object.entries(r.columns ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, v]) => ({ name, v: show(v), type: typeof_(v), href: rowurl(t, k) + '/columns/' + encodeURIComponent(name) }));
	res.render('row', { title: `${t} / ${k}`, table: t, key: k, list, cols: blanks(1), setcols: blanks(1) });
}

async function setrow(req, res) {
	const { table: t, row: k } = req.params;
	try {
		await req.qt.setrow(t, k, cols(req.body.cols));
		back(res, rowurl(t, k), undefined, 'Row updated');
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function delrow(req, res) {
	const { table: t, row: k } = req.params;
	try {
		await req.qt.delrow(t, k);
		back(res, tableurl(t), undefined, `Deleted row ${k}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function atomic(req, res) {
	const { table: t, row: k } = req.params;
	const b = req.body;
	try {
		if (!atomics.includes(b.op))
			throw bad(`unknown operation: ${b.op}`);
		if (b.column === undefined || b.column === '')
			throw bad('column is required');
		const body = { column: b.column };
		if (b.op === 'incr')
			body.delta = parse('number', b.value);
		else
			body.value = b.value ?? '';
		const r = await req.qt.atomic(t, k, b.op, body);
		back(res, rowurl(t, k), undefined, `${b.op} ${b.column} → ${show(r.value)}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function cas(req, res) {
	const { table: t, row: k } = req.params;
	const b = req.body;
	try {
		const body = { setCols: cols(b.cols) };
		if (b.column !== undefined && b.column !== '') {
			body.condition = { column: b.column, op: b.op };
			if (!nvalue.includes(b.op))
				body.condition.value = parse(b.type, b.value);
		}
		await req.qt.cas(t, k, body);
		back(res, rowurl(t, k), undefined, 'Check-and-set applied');
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function cell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	const r = await req.qt.getcell(t, k, c);
	res.render('cell', { title: `${t} / ${k} / ${c}`, table: t, key: k, column: c, v: show(r.value), type: typeof_(r.value), rowhref: rowurl(t, k) });
}

async function setcell(req, res) {
	const { table: t, row: k } = req.params;
	const c = req.params.column ?? req.body.column ?? '';
	const url = req.params.column !== undefined ? rowurl(t, k) + '/columns/' + encodeURIComponent(c) : rowurl(t, k);
	try {
		if (c === '')
			throw bad('column is required');
		await req.qt.setcell(t, k, c, parse(req.body.type, req.body.value));
		back(res, url, undefined, `Set ${c}`);
	} catch (err) {
		back(res, url, err);
	}
}

async function delcell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	try {
		await req.qt.delcell(t, k, c);
		back(res, rowurl(t, k), undefined, `Deleted column ${c}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

module.exports = {
	fmterr, home, newtable, create, table, query, insert, batch, drop,
	row, setrow, delrow, atomic, cas, cell, setcell, delcell,
};
