const pagesize = 50;
const nvalue = ['EXISTS', 'MISSING'];
const atomics = ['incr', 'append', 'prepend'];

function bad(msg, status) {
	const err = new Error(msg);
	err.status = status ?? 400;
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

// entries lists form rows; the body parser turns long arrays into objects.
function entries(list) {
	return Object.values(list ?? {});
}

// names splits a comma separated list of column names.
function names(raw) {
	return (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

// cols turns form rows [{name, value, type}] into a column map.
function cols(list) {
	const m = {};
	for (const c of entries(list)) {
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

// filled drops empty filter rows, keeping at least one row for the form.
function filled(where) {
	const list = entries(where).filter((w) => w.column !== undefined && w.column !== '');
	return list.length > 0 ? list : blanks(1);
}

function pred(column, op, type, value) {
	const p = { column, op };
	if (!nvalue.includes(op))
		p.value = parse(type, value);
	return p;
}

// filterbody builds the fields shared by query and delete-by-query.
// Filters with the same group are ANDed; more than one group becomes an OR.
function filterbody(b) {
	const q = {};
	for (const f of ['prefix', 'startKey', 'endKey'])
		if (b[f] !== undefined && b[f] !== '')
			q[f] = b[f];
	if (b.orderDesc === 'on')
		q.orderDesc = true;
	const offset = int(b.offset, 'offset');
	if (offset !== undefined)
		q.offset = offset;
	const limit = int(b.limit, 'limit');
	if (limit !== undefined)
		q.limit = limit;

	const groups = new Map();
	for (const w of entries(b.where)) {
		if (w.column === undefined || w.column === '')
			continue;
		const g = (w.group ?? '').trim() === '' ? '1' : w.group.trim();
		if (!groups.has(g))
			groups.set(g, []);
		groups.get(g).push(pred(w.column, w.op, w.type, w.value));
	}
	const list = [...groups.values()];
	if (list.length === 1)
		q.where = list[0];
	if (list.length > 1)
		q.or = list;
	return q;
}

function querybody(b) {
	if (b.mode === 'json')
		return json(b.json, 'query JSON') ?? {};

	const q = filterbody(b);
	const sel = names(b.select);
	if (sel.length > 0)
		q.select = sel;
	if (b.countOnly === 'on')
		q.countOnly = true;
	if (b.aggregate !== undefined && b.aggregate.trim() !== '')
		q.aggregate = b.aggregate.trim();
	return q;
}

// colnames suggests column names; a failure only loses the suggestions.
async function colnames(req, t) {
	try {
		return (await req.qt.columns(t)).columns ?? [];
	} catch {
		return [];
	}
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
	const v = { title: t, table: t, tab, mode: req.query.mode ?? 'builder', form: {}, where: blanks(1), cols: blanks(1) };

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
	if (['details', 'query', 'delete', 'insert'].includes(tab))
		v.colnames = await colnames(req, t);
	res.render('table', v);
}

async function query(req, res) {
	const t = req.params.table;
	const b = req.body;
	const mode = b.mode === 'json' ? 'json' : 'builder';
	const v = { title: t, table: t, tab: 'query', mode, form: b, where: filled(b.where), cols: blanks(1), colnames: await colnames(req, t) };

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

// qdelete previews or deletes the rows matching the filters.
async function qdelete(req, res) {
	const t = req.params.table;
	const b = req.body;
	const v = { title: t, table: t, tab: 'delete', form: b, where: filled(b.where), cols: blanks(1), colnames: await colnames(req, t) };

	try {
		const q = filterbody(b);
		// The server deletes every row for an empty body.
		const scoped = Object.keys(q).some((k) => k !== 'orderDesc');
		if (b.do === 'preview') {
			v.reqbody = q;
			v.result = await req.qt.query(t, q);
			v.grid = grid(t, v.result.rows ?? []);
			v.preview = true;
			return res.render('table', v);
		}
		if (!scoped && b.all !== 'on')
			throw bad('no filters given; tick "Delete every row" to empty the table');
		const r = await req.qt.qdelete(t, q);
		back(res, tableurl(t, 'delete'), undefined, `Deleted ${r.deleted} rows`);
	} catch (err) {
		v.err = fmterr(err);
		res.render('table', v);
	}
}

// goto opens a row by key, checking that it exists first.
async function goto(req, res) {
	const t = req.params.table;
	const k = (req.query.key ?? '').trim().toLowerCase();
	try {
		if (!/^[0-9a-f]{8}$/.test(k))
			throw bad('a row key is 8 hexadecimal characters');
		if (!await req.qt.hasrow(t, k))
			throw bad(`no row ${k} in ${t}`, 404);
		res.redirect(rowurl(t, k));
	} catch (err) {
		back(res, tableurl(t, req.query.tab), err);
	}
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
	const v = { title: t, table: t, tab: 'batch', form: b, where: blanks(1), cols: blanks(1) };

	try {
		const body = { action: b.action };
		if (b.action === 'write') {
			const m = json(b.mutations, 'mutations JSON');
			if (!Array.isArray(m))
				throw bad('mutations must be a JSON array');
			body.mutations = m;
		} else if (b.action === 'insert') {
			const r = json(b.rows, 'rows JSON');
			if (!Array.isArray(r) || r.length === 0)
				throw bad('rows must be a non-empty JSON array');
			// As with single inserts, an empty row would get a key but store nothing.
			for (const x of r)
				if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length === 0)
					throw bad('every row must be a JSON object with at least one column');
			body.rows = r;
		} else {
			body.rowKeys = (b.rowKeys ?? '').split(/[\s,]+/).filter((k) => k.length > 0);
			if (body.rowKeys.length === 0)
				throw bad('at least one row key is required');
		}
		v.reqbody = body;
		v.result = await req.qt.batch(t, body);
		if (b.action === 'insert') {
			v.inserted = (v.result.rowKeys ?? []).map((k) => ({ key: k, href: rowurl(t, k) }));
			return res.render('table', v);
		}
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
	const only = names(req.query.cols);
	const r = await req.qt.getrow(t, k, only);
	const list = Object.entries(r.columns ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, v]) => ({ name, v: show(v), type: typeof_(v), href: rowurl(t, k) + '/columns/' + encodeURIComponent(name) }));
	res.render('row', {
		title: `${t} / ${k}`, table: t, key: k, list, cols: blanks(1), setcols: blanks(1),
		only: only.length > 0 ? only.join(', ') : undefined,
	});
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
		if (b.column !== undefined && b.column !== '')
			body.condition = pred(b.column, b.op, b.type, b.value);
		await req.qt.cas(t, k, body);
		back(res, rowurl(t, k), undefined, 'Check-and-set applied');
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function cad(req, res) {
	const { table: t, row: k } = req.params;
	const b = req.body;
	try {
		const body = {};
		if (b.column !== undefined && b.column !== '')
			body.condition = pred(b.column, b.op, b.type, b.value);
		const del = names(b.delCols);
		if (del.length > 0)
			body.delCols = del;
		await req.qt.cad(t, k, body);
		if (del.length === 0)
			return back(res, tableurl(t), undefined, `Check-and-delete removed row ${k}`);
		back(res, rowurl(t, k), undefined, `Check-and-delete removed ${del.join(', ')}`);
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
	fmterr, home, newtable, create, table, goto, query, qdelete, insert, batch, drop,
	row, setrow, delrow, atomic, cas, cad, cell, setcell, delcell,
};
