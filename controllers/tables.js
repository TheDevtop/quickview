const qt = require('../models/quicktable');

const pagesize = 50;
const nvalue = ['exists', 'missing'];

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

function cellurl(t, k, c) {
	return rowurl(t, k) + '/columns/' + encodeURIComponent(c);
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
	case 'boolean':
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
		return 'boolean';
	if (typeof v === 'number')
		return 'number';
	return 'string';
}

function show(v) {
	return typeof v === 'string' ? v : JSON.stringify(v);
}

function int(raw, what) {
	if (raw === undefined || raw === '')
		return undefined;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0)
		throw bad(`${what} must be a non-negative integer`);
	return n;
}

function need(raw, what) {
	const s = (raw ?? '').trim();
	if (s === '')
		throw bad(`${what} is required`);
	return s;
}

// entries lists form rows; the body parser turns long arrays into objects.
function entries(list) {
	return Object.values(list ?? {});
}

// names splits a comma separated list of column names.
function names(raw) {
	return (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function blanks(n) {
	return Array.from({ length: n }, () => ({ type: 'string' }));
}

// sets turns form rows [{name, value, type}] into batch set operations.
function sets(t, k, list) {
	const ops = [];
	for (const c of entries(list)) {
		if (c.name === undefined || c.name.trim() === '')
			continue;
		ops.push({ op: 'set', table: t, row: k, column: c.name.trim(), value: parse(c.type, c.value) });
	}
	return ops;
}

function pred(column, cmp, type, value) {
	const p = { column, cmp };
	if (!nvalue.includes(cmp))
		p.value = parse(type, value);
	return p;
}

// grid flattens [{key, row}] into a table with the union of all columns.
function grid(t, rows) {
	const cols = [];
	for (const r of rows)
		for (const c of Object.keys(r.row ?? {}))
			if (!cols.includes(c))
				cols.push(c);
	cols.sort();
	return {
		cols,
		rows: rows.map((r) => ({
			key: r.key,
			href: rowurl(t, r.key),
			vals: cols.map((c) => {
				const v = r.row?.[c];
				return v === undefined ? { missing: true } : { v: show(v), num: typeof v === 'number' };
			}),
		})),
	};
}

// kv is a two column result: one value per name.
function kv(head, list) {
	return { head, list: list.map(([name, v, href]) => ({ name, href, v: show(v), type: v === null ? 'null' : typeof_(v) })) };
}

// view turns any API response into something the results panel can draw.
function view(op, body, out) {
	const t = typeof body.table === 'string' ? body.table : '';
	if (out.names !== undefined) {
		let href;
		if (t === '')
			href = (n) => tableurl(n);
		else if (body.columns !== true)
			href = (n) => rowurl(t, n);
		const head = t === '' ? 'table' : body.columns === true ? 'column' : 'row key';
		return { names: { head, list: out.names.map((n) => ({ n, href: href?.(n) })) }, count: out.names.length };
	}
	if (out.rows !== undefined)
		return { grid: grid(t, out.rows), count: out.rows.length };
	if (out.table !== undefined) {
		const rows = Object.entries(out.table).map(([key, row]) => ({ key, row }));
		return { grid: grid(t, rows), count: rows.length };
	}
	if (out.row !== undefined) {
		const list = Object.entries(out.row).sort(([a], [b]) => a.localeCompare(b))
			.map(([c, v]) => [c, v, cellurl(t, body.row, c)]);
		return { kv: kv('column', list), count: list.length };
	}
	if (out.column !== undefined) {
		const list = Object.entries(out.column).map(([k, v]) => [k, v, cellurl(t, k, body.column)]);
		return { kv: kv('row key', list), count: list.length };
	}
	if (out.values !== undefined) {
		const list = out.values.map((v, i) => {
			const c = body.cells[i];
			return [`${c.table} / ${c.row} / ${c.column}`, v, v === null ? undefined : cellurl(c.table, c.row, c.column)];
		});
		return { kv: kv('cell', list), count: list.length };
	}
	if (out.value !== undefined)
		return { value: { v: show(out.value), type: typeof_(out.value), label: op === 'incr' ? 'new value' : body.agg } };
	return { status: op === 'batch' ? `Batch applied (${body.ops?.length ?? 0} ops)` : 'ok' };
}

// run sends one request and times it for the execution details tab.
async function run(req, op, body) {
	const start = performance.now();
	const out = await req.qt[op](body);
	const ms = (performance.now() - start).toFixed(1);
	return { op, req: body, out, ms, ...view(op, body, out) };
}

// templates fill an empty editor with a request for the chosen operation.
function template(op, t) {
	t = t ?? 'users';
	switch (op) {
	case 'scan':
		return { table: t };
	case 'get':
		return { table: t, row: 'ann' };
	case 'values':
		return { cells: [{ table: t, row: 'ann', column: 'age' }, { table: t, row: 'bob', column: 'age' }] };
	case 'batch':
		return { ops: [
			{ op: 'if', table: t, row: 'ann', column: 'age', cmp: 'exists' },
			{ op: 'set', table: t, row: 'ann', column: 'age', value: 32 },
		] };
	case 'incr':
		return { table: t, row: 'ann', column: 'visits', delta: 1 };
	default:
		return { table: t, where: [{ column: 'age', cmp: '>=', value: 18 }], limit: 100 };
	}
}

function editorview(op, text, r, err) {
	return { title: 'Query', icon: 'search', op, text, lines: text.split('\n').length, r, err };
}

async function editor(req, res) {
	const op = qt.ops.includes(req.query.op) ? req.query.op : 'query';
	const text = JSON.stringify(template(op, req.query.table), null, 2);
	res.render('editor', { ...editorview(op, text), fresh: true, qtable: req.query.table });
}

async function exec(req, res) {
	const op = req.body.op;
	const text = req.body.json ?? '';
	try {
		if (!qt.ops.includes(op))
			throw bad(`unknown operation: ${op}`);
		let body;
		try {
			body = text.trim() === '' ? {} : JSON.parse(text);
		} catch (err) {
			throw bad(`request JSON: ${err.message}`);
		}
		if (body === null || typeof body !== 'object' || Array.isArray(body))
			throw bad('request must be a JSON object');
		res.render('editor', editorview(op, text, await run(req, op, body)));
	} catch (err) {
		res.render('editor', editorview(qt.ops.includes(op) ? op : 'query', text, undefined, fmterr(err)));
	}
}

async function home(req, res) {
	res.render('home', { title: 'Explorer', icon: 'home' });
}

async function newtable(req, res) {
	res.render('new', { title: 'Create table', icon: 'add_box', cols: blanks(1) });
}

async function create(req, res) {
	try {
		const t = need(req.body.table, 'table name');
		const k = need(req.body.key, 'row key');
		const ops = sets(t, k, req.body.cols);
		if (ops.length === 0)
			throw bad('at least one column is required');
		await req.qt.batch({ ops });
		back(res, rowurl(t, k), undefined, `Created table ${t} with row ${k}`);
	} catch (err) {
		back(res, '/new', err);
	}
}

// preview pages by row key: from is the first key of the page.
// One extra row tells whether there is a next page and where it starts;
// a reverse scan up to from finds where the previous page starts.
async function preview(req, t, v) {
	const from = req.query.from;
	const q = { table: t, limit: pagesize + 1 };
	if (from !== undefined)
		q.from = from;
	const [n, r, p] = await Promise.all([
		req.qt.query({ table: t, agg: 'count' }),
		req.qt.query(q),
		from === undefined ? undefined : req.qt.query({ table: t, to: from, reverse: true, limit: pagesize }),
	]);
	const rows = r.rows.slice(0, pagesize);
	v.total = n.value;
	v.grid = grid(t, rows);
	v.first = rows[0]?.key;
	v.last = rows.at(-1)?.key;
	if (r.rows.length > pagesize)
		v.next = r.rows[pagesize].key;
	if (p !== undefined) {
		v.hasprev = true;
		v.prev = p.rows.length === pagesize ? p.rows.at(-1).key : undefined;
	}
}

// details reads the row count and the key range.
async function details(req, t, v) {
	const [n, a, z] = await Promise.all([
		req.qt.query({ table: t, agg: 'count' }),
		req.qt.query({ table: t, limit: 1 }),
		req.qt.query({ table: t, limit: 1, reverse: true }),
	]);
	v.count = n.value;
	v.firstkey = a.rows[0]?.key;
	v.lastkey = z.rows[0]?.key;
}

function tableview(t, tab, form) {
	return { title: t, table: t, tab, form: form ?? {}, where: blanks(1), cols: blanks(1) };
}

async function table(req, res) {
	const t = req.params.table;
	const v = tableview(t, req.query.tab ?? 'preview');

	switch (v.tab) {
	case 'details':
		await details(req, t, v);
		break;
	case 'preview':
		await preview(req, t, v);
		break;
	case 'keys':
		v.keys = (await req.qt.scan({ table: t })).names;
		break;
	}
	if (['query', 'insert'].includes(v.tab))
		v.colnames = (await req.qt.scan({ table: t, columns: true })).names.sort();
	res.render('table', v);
}

// querybody builds a query request from the builder form.
function querybody(t, b) {
	const q = { table: t };
	for (const f of ['prefix', 'from', 'to'])
		if (b[f] !== undefined && b[f] !== '')
			q[f] = b[f];
	const where = [];
	for (const w of entries(b.where))
		if (w.column !== undefined && w.column.trim() !== '')
			where.push(pred(w.column.trim(), w.cmp, w.type, w.value));
	if (where.length > 0)
		q.where = where;
	const sel = names(b.select);
	if (sel.length > 0)
		q.select = sel;
	const limit = int(b.limit, 'limit');
	if (limit !== undefined)
		q.limit = limit;
	if (b.reverse === 'on')
		q.reverse = true;
	if (b.agg !== undefined && b.agg !== '') {
		q.agg = b.agg;
		if (b.agg !== 'count')
			q.column = need(b.column, 'aggregate column');
	}
	return q;
}

// filled drops empty filter rows, keeping at least one row for the form.
function filled(where) {
	const list = entries(where).filter((w) => w.column !== undefined && w.column !== '');
	return list.length > 0 ? list : blanks(1);
}

async function query(req, res) {
	const t = req.params.table;
	const b = req.body;
	const v = tableview(t, 'query', b);
	v.where = filled(b.where);

	try {
		v.colnames = (await req.qt.scan({ table: t, columns: true })).names.sort();
		const q = querybody(t, b);
		if (b.do === 'editor')
			return res.render('editor', editorview('query', JSON.stringify(q, null, 2)));
		v.r = await run(req, 'query', q);
	} catch (err) {
		v.err = fmterr(err);
	}
	res.render('table', v);
}

// goto opens a row by key, checking that it exists first.
async function goto(req, res) {
	const t = req.params.table;
	try {
		const k = need(req.query.key, 'row key');
		await req.qt.get({ table: t, row: k });
		res.redirect(rowurl(t, k));
	} catch (err) {
		back(res, tableurl(t, req.query.tab), err.status === 404 ? bad(`no row "${req.query.key}" in ${t}`, 404) : err);
	}
}

async function insert(req, res) {
	const t = req.params.table;
	try {
		const k = need(req.body.key, 'row key');
		const ops = sets(t, k, req.body.cols);
		if (ops.length === 0)
			throw bad('at least one column is required');
		await req.qt.batch({ ops });
		back(res, rowurl(t, k), undefined, `Wrote row ${k}`);
	} catch (err) {
		back(res, tableurl(t, 'insert'), err);
	}
}

async function drop(req, res) {
	const t = req.params.table;
	if (req.body.confirm !== t)
		return back(res, tableurl(t, 'details'), bad('confirmation does not match the table name'));
	try {
		await req.qt.batch({ ops: [{ op: 'delete', table: t }] });
		back(res, '/', undefined, `Dropped table ${t}`);
	} catch (err) {
		back(res, tableurl(t, 'details'), err);
	}
}

// batchinsert writes a JSON object of rows {key: {column: value}} in one batch.
async function batchinsert(req, res) {
	const t = req.params.table;
	try {
		let rows;
		try {
			rows = JSON.parse(req.body.rows ?? '');
		} catch (err) {
			throw bad(`rows JSON: ${err.message}`);
		}
		if (rows === null || typeof rows !== 'object' || Array.isArray(rows))
			throw bad('rows must be a JSON object of row key to columns');
		const ops = [];
		for (const [k, cols] of Object.entries(rows)) {
			if (k.trim() === '')
				throw bad('row keys must not be empty');
			if (cols === null || typeof cols !== 'object' || Array.isArray(cols) || Object.keys(cols).length === 0)
				throw bad(`row ${k}: columns must be a non-empty JSON object`);
			for (const [c, v] of Object.entries(cols)) {
				if (!['string', 'number', 'boolean'].includes(typeof v))
					throw bad(`row ${k}, column ${c}: value must be a string, number or boolean`);
				ops.push({ op: 'set', table: t, row: k, column: c, value: v });
			}
		}
		if (ops.length === 0)
			throw bad('at least one row is required');
		await req.qt.batch({ ops });
		back(res, tableurl(t, 'insert'), undefined, `Wrote ${Object.keys(rows).length} rows`);
	} catch (err) {
		back(res, tableurl(t, 'insert'), err);
	}
}

// delrows deletes the rows named by keys, separated by whitespace or commas, in one batch.
async function delrows(req, res) {
	const t = req.params.table;
	try {
		const keys = (req.body.keys ?? '').split(/[\s,]+/).filter((k) => k.length > 0);
		if (keys.length === 0)
			throw bad('at least one row key is required');
		await req.qt.batch({ ops: keys.map((k) => ({ op: 'delete', table: t, row: k })) });
		back(res, tableurl(t, 'delete'), undefined, keys.length === 1 ? `Deleted row ${keys[0]}` : `Deleted ${keys.length} rows`);
	} catch (err) {
		back(res, tableurl(t, 'delete'), err);
	}
}

async function row(req, res) {
	const { table: t, row: k } = req.params;
	const r = await req.qt.get({ table: t, row: k });
	const list = Object.entries(r.row)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, v]) => ({ name, v: show(v), type: typeof_(v), href: cellurl(t, k, name) }));
	res.render('row', { title: `${t} / ${k}`, table: t, key: k, list, cols: blanks(1), setcols: blanks(1) });
}

async function setrow(req, res) {
	const { table: t, row: k } = req.params;
	try {
		const ops = sets(t, k, req.body.cols);
		if (ops.length === 0)
			throw bad('at least one column is required');
		await req.qt.batch({ ops });
		back(res, rowurl(t, k), undefined, `Set ${ops.map((o) => o.column).join(', ')}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function delrow(req, res) {
	const { table: t, row: k } = req.params;
	try {
		await req.qt.batch({ ops: [{ op: 'delete', table: t, row: k }] });
		back(res, tableurl(t, 'preview'), undefined, `Deleted row ${k}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function incr(req, res) {
	const { table: t, row: k } = req.params;
	const url = req.body.back === 'cell' ? cellurl(t, k, req.body.column) : rowurl(t, k);
	try {
		const c = need(req.body.column, 'column');
		const r = await req.qt.incr({ table: t, row: k, column: c, delta: parse('number', req.body.delta) });
		back(res, url, undefined, `${c} → ${show(r.value)}`);
	} catch (err) {
		back(res, url, err);
	}
}

// cond applies writes to the row only if a condition holds, in one batch.
async function cond(req, res) {
	const { table: t, row: k } = req.params;
	const b = req.body;
	try {
		const ops = [];
		if (b.column !== undefined && b.column.trim() !== '')
			ops.push({ op: 'if', table: t, row: k, ...pred(b.column.trim(), b.cmp, b.type, b.value) });
		ops.push(...sets(t, k, b.cols));
		if (b.delrow === 'on')
			ops.push({ op: 'delete', table: t, row: k });
		else
			for (const c of names(b.delcols))
				ops.push({ op: 'delete', table: t, row: k, column: c });
		if (ops.every((o) => o.op === 'if'))
			throw bad('nothing to write: give columns to set or delete');
		await req.qt.batch({ ops });
		if (b.delrow === 'on')
			return back(res, tableurl(t, 'preview'), undefined, `Deleted row ${k}`);
		back(res, rowurl(t, k), undefined, `Applied ${ops.length} operations`);
	} catch (err) {
		if (err.status === 409)
			err.message = 'condition failed; nothing was written';
		back(res, rowurl(t, k), err);
	}
}

async function cell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	const r = await req.qt.get({ table: t, row: k, column: c });
	res.render('cell', { title: `${t} / ${k} / ${c}`, table: t, key: k, column: c, v: show(r.value), type: typeof_(r.value), rowhref: rowurl(t, k), href: cellurl(t, k, c) });
}

async function setcell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	try {
		await req.qt.batch({ ops: [{ op: 'set', table: t, row: k, column: c, value: parse(req.body.type, req.body.value) }] });
		back(res, cellurl(t, k, c), undefined, `Set ${c}`);
	} catch (err) {
		back(res, cellurl(t, k, c), err);
	}
}

async function delcell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	try {
		await req.qt.batch({ ops: [{ op: 'delete', table: t, row: k, column: c }] });
	} catch (err) {
		return back(res, rowurl(t, k), err);
	}
	// Deleting the last cell deletes the row, leaving no row page to return to.
	try {
		await req.qt.get({ table: t, row: k });
		back(res, rowurl(t, k), undefined, `Deleted column ${c}`);
	} catch (err) {
		if (err.status !== 404)
			return back(res, rowurl(t, k), err);
		back(res, tableurl(t, 'preview'), undefined, `Deleted column ${c}, the last of row ${k}`);
	}
}

module.exports = {
	fmterr, editor, exec, home, newtable, create, table, query, goto, insert, batchinsert, delrows, drop,
	row, setrow, delrow, incr, cond, cell, setcell, delcell,
};
