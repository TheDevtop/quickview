const qt = require('../models/quicktable');

const pagesize = 50;
const tabs = [
	{ id: 'preview', label: 'Preview' },
	{ id: 'details', label: 'Details' },
	{ id: 'keys', label: 'Row keys' },
	{ id: 'query', label: 'Query' },
	{ id: 'insert', label: 'Insert row' },
	{ id: 'delete', label: 'Delete row' },
];

function bad(msg) {
	return qt.httperr(400, msg);
}

function fmterr(err) {
	return err.status !== undefined ? `${err.status}: ${err.message}` : err.message;
}

// done and back redirect to url, showing a success message or an error there.
function done(res, url, msg) {
	res.redirect(url + (url.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg));
}

function back(res, url, err) {
	res.redirect(url + (url.includes('?') ? '&' : '?') + 'err=' + encodeURIComponent(fmterr(err)));
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

function jsonparse(text, what) {
	try {
		return JSON.parse(text);
	} catch (err) {
		throw bad(`${what} JSON: ${err.message}`);
	}
}

function isobj(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function typename(v) {
	return qt.types.includes(typeof v) ? typeof v : 'string';
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

// blank is the empty form row that column and filter lists start with.
function blank() {
	return [{ type: 'string' }];
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

// writes is sets for forms that must write something.
function writes(t, k, list) {
	const ops = sets(t, k, list);
	if (ops.length === 0)
		throw bad('at least one column is required');
	return ops;
}

// rowops turns a JSON object of rows {key: {column: value}} into set operations.
function rowops(t, rows) {
	const ops = [];
	for (const [k, cols] of Object.entries(rows)) {
		if (k.trim() === '')
			throw bad('row keys must not be empty');
		if (!isobj(cols) || Object.keys(cols).length === 0)
			throw bad(`row ${k}: columns must be a non-empty JSON object`);
		for (const [c, v] of Object.entries(cols)) {
			if (!qt.types.includes(typeof v))
				throw bad(`row ${k}, column ${c}: value must be a string, number or boolean`);
			ops.push({ op: 'set', table: t, row: k, column: c, value: v });
		}
	}
	if (ops.length === 0)
		throw bad('at least one row is required');
	return ops;
}

// delkeys reads the rows to delete: one key, or a JSON array of keys.
function delkeys(b) {
	if (b.keys === undefined)
		return [need(b.key, 'row key')];
	const keys = jsonparse(b.keys, 'keys');
	if (!Array.isArray(keys) || keys.length === 0)
		throw bad('keys must be a non-empty JSON array');
	if (keys.some((k) => typeof k !== 'string' || k.trim() === ''))
		throw bad('every key must be a non-empty string');
	return keys;
}

function pred(column, cmp, type, value) {
	const p = { column, cmp };
	if (!qt.unary.includes(cmp))
		p.value = parse(type, value);
	return p;
}

async function exists(c, t, k) {
	try {
		await c.get({ table: t, row: k });
		return true;
	} catch (err) {
		if (err.status !== 404)
			throw err;
		return false;
	}
}

async function colnames(c, t) {
	return (await c.scan({ table: t, columns: true })).names.sort();
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

// item is one named value of a two column listing.
function item(name, v, href) {
	return { name, href, v: show(v), type: v === null ? 'null' : typename(v) };
}

// cells lists the cells of a row by column name.
function cells(t, k, row) {
	return Object.entries(row)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([c, v]) => item(c, v, cellurl(t, k, c)));
}

function kv(head, list) {
	return { kv: { head, list }, count: list.length };
}

// namelist links each listed name: tables to their page, row keys to their row.
function namelist(t, columns, list) {
	let head = 'table';
	let href = (n) => tableurl(n);
	if (t !== '') {
		head = columns ? 'column' : 'row key';
		href = columns ? undefined : (n) => rowurl(t, n);
	}
	return { names: { head, list: list.map((n) => ({ n, href: href?.(n) })) }, count: list.length };
}

// view turns any API response into something the results panel can draw.
function view(op, body, out) {
	const t = typeof body.table === 'string' ? body.table : '';
	if (out.names !== undefined)
		return namelist(t, body.columns === true, out.names);
	if (out.rows !== undefined)
		return { grid: grid(t, out.rows), count: out.rows.length };
	if (out.table !== undefined) {
		const rows = Object.entries(out.table).map(([key, row]) => ({ key, row }));
		return { grid: grid(t, rows), count: rows.length };
	}
	if (out.row !== undefined)
		return kv('column', cells(t, body.row, out.row));
	if (out.column !== undefined)
		return kv('row key', Object.entries(out.column).map(([k, v]) => item(k, v, cellurl(t, k, body.column))));
	if (out.values !== undefined)
		return kv('cell', out.values.map((v, i) => {
			const c = body.cells[i];
			return item(`${c.table} / ${c.row} / ${c.column}`, v, v === null ? undefined : cellurl(c.table, c.row, c.column));
		}));
	if (out.value !== undefined)
		return { value: { v: show(out.value), type: typename(out.value), label: op === 'incr' ? 'new value' : body.agg } };
	return { status: op === 'batch' ? `Batch applied (${body.ops?.length ?? 0} ops)` : 'ok' };
}

// run sends one request and times it for the execution details tab.
async function run(req, op, body) {
	const start = performance.now();
	const out = await req.qt[op](body);
	const ms = (performance.now() - start).toFixed(1);
	return { op, req: body, out, ms, ...view(op, body, out) };
}

// template fills an empty editor with a request for the chosen operation.
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

function editor(req, res) {
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
		const body = text.trim() === '' ? {} : jsonparse(text, 'request');
		if (!isobj(body))
			throw bad('request must be a JSON object');
		res.render('editor', editorview(op, text, await run(req, op, body)));
	} catch (err) {
		res.render('editor', editorview(qt.ops.includes(op) ? op : 'query', text, undefined, fmterr(err)));
	}
}

function home(req, res) {
	res.render('home', { title: 'Explorer', icon: 'home' });
}

function newtable(req, res) {
	res.render('new', { title: 'Create table', icon: 'add_box', cols: blank() });
}

async function create(req, res) {
	try {
		const t = need(req.body.table, 'table name');
		const k = need(req.body.key, 'row key');
		await req.qt.batch({ ops: writes(t, k, req.body.cols) });
		done(res, rowurl(t, k), `Created table ${t} with row ${k}`);
	} catch (err) {
		back(res, '/new', err);
	}
}

// preview pages by row key: from is the first key of the page.
// One extra row tells whether there is a next page and where it starts;
// a reverse scan up to from finds where the previous page starts.
async function preview(c, t, from, v) {
	const q = { table: t, limit: pagesize + 1 };
	if (from !== undefined)
		q.from = from;
	const [n, r, p] = await Promise.all([
		c.query({ table: t, agg: 'count' }),
		c.query(q),
		from === undefined ? undefined : c.query({ table: t, to: from, reverse: true, limit: pagesize }),
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
async function details(c, t, v) {
	const [n, a, z] = await Promise.all([
		c.query({ table: t, agg: 'count' }),
		c.query({ table: t, limit: 1 }),
		c.query({ table: t, limit: 1, reverse: true }),
	]);
	v.count = n.value;
	v.firstkey = a.rows[0]?.key;
	v.lastkey = z.rows[0]?.key;
}

function tableview(t, tab, form) {
	return { title: t, table: t, href: tableurl(t), tab, tabs, form: form ?? {}, where: blank(), cols: blank() };
}

async function table(req, res) {
	const t = req.params.table;
	const v = tableview(t, req.query.tab ?? 'preview');
	switch (v.tab) {
	case 'details':
		await details(req.qt, t, v);
		break;
	case 'preview':
		await preview(req.qt, t, req.query.from, v);
		break;
	case 'keys':
		v.keys = (await req.qt.scan({ table: t })).names;
		break;
	case 'query':
	case 'insert':
		v.colnames = await colnames(req.qt, t);
		break;
	}
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
	return list.length > 0 ? list : blank();
}

async function query(req, res) {
	const t = req.params.table;
	const b = req.body;
	const v = tableview(t, 'query', b);
	v.where = filled(b.where);
	try {
		v.colnames = await colnames(req.qt, t);
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
		if (!(await exists(req.qt, t, k)))
			throw qt.httperr(404, `no row "${req.query.key}" in ${t}`);
		res.redirect(rowurl(t, k));
	} catch (err) {
		back(res, tableurl(t, req.query.tab), err);
	}
}

async function insert(req, res) {
	const t = req.params.table;
	try {
		const k = need(req.body.key, 'row key');
		await req.qt.batch({ ops: writes(t, k, req.body.cols) });
		done(res, rowurl(t, k), `Wrote row ${k}`);
	} catch (err) {
		back(res, tableurl(t, 'insert'), err);
	}
}

async function drop(req, res) {
	const t = req.params.table;
	try {
		if (req.body.confirm !== t)
			throw bad('confirmation does not match the table name');
		await req.qt.batch({ ops: [{ op: 'delete', table: t }] });
		done(res, '/', `Dropped table ${t}`);
	} catch (err) {
		back(res, tableurl(t, 'details'), err);
	}
}

async function batchinsert(req, res) {
	const t = req.params.table;
	try {
		const rows = jsonparse(req.body.rows ?? '', 'rows');
		if (!isobj(rows))
			throw bad('rows must be a JSON object of row key to columns');
		await req.qt.batch({ ops: rowops(t, rows) });
		done(res, tableurl(t, 'insert'), `Wrote ${Object.keys(rows).length} rows`);
	} catch (err) {
		back(res, tableurl(t, 'insert'), err);
	}
}

async function delrows(req, res) {
	const t = req.params.table;
	try {
		const keys = delkeys(req.body);
		await req.qt.batch({ ops: keys.map((k) => ({ op: 'delete', table: t, row: k })) });
		done(res, tableurl(t, 'delete'), keys.length === 1 ? `Deleted row ${keys[0]}` : `Deleted ${keys.length} rows`);
	} catch (err) {
		back(res, tableurl(t, 'delete'), err);
	}
}

async function row(req, res) {
	const { table: t, row: k } = req.params;
	const r = await req.qt.get({ table: t, row: k });
	res.render('row', { title: `${t} / ${k}`, table: t, key: k, href: rowurl(t, k), list: cells(t, k, r.row), cols: blank(), setcols: blank() });
}

async function setrow(req, res) {
	const { table: t, row: k } = req.params;
	try {
		const ops = writes(t, k, req.body.cols);
		await req.qt.batch({ ops });
		done(res, rowurl(t, k), `Set ${ops.map((o) => o.column).join(', ')}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function delrow(req, res) {
	const { table: t, row: k } = req.params;
	try {
		await req.qt.batch({ ops: [{ op: 'delete', table: t, row: k }] });
		done(res, tableurl(t, 'preview'), `Deleted row ${k}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

async function incr(req, res) {
	const { table: t, row: k } = req.params;
	let url = rowurl(t, k);
	try {
		const c = need(req.body.column, 'column');
		if (req.body.back === 'cell')
			url = cellurl(t, k, c);
		const r = await req.qt.incr({ table: t, row: k, column: c, delta: parse('number', req.body.delta) });
		done(res, url, `${c} → ${show(r.value)}`);
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
			return done(res, tableurl(t, 'preview'), `Deleted row ${k}`);
		done(res, rowurl(t, k), `Applied ${ops.length} operations`);
	} catch (err) {
		if (err.status === 409)
			err.message = 'condition failed; nothing was written';
		back(res, rowurl(t, k), err);
	}
}

async function cell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	const r = await req.qt.get({ table: t, row: k, column: c });
	res.render('cell', { title: `${t} / ${k} / ${c}`, table: t, key: k, column: c, v: show(r.value), type: typename(r.value), rowhref: rowurl(t, k), href: cellurl(t, k, c) });
}

async function setcell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	try {
		await req.qt.batch({ ops: [{ op: 'set', table: t, row: k, column: c, value: parse(req.body.type, req.body.value) }] });
		done(res, cellurl(t, k, c), `Set ${c}`);
	} catch (err) {
		back(res, cellurl(t, k, c), err);
	}
}

async function delcell(req, res) {
	const { table: t, row: k, column: c } = req.params;
	try {
		await req.qt.batch({ ops: [{ op: 'delete', table: t, row: k, column: c }] });
		// Deleting the last cell deletes the row, leaving no row page to return to.
		if (!(await exists(req.qt, t, k)))
			return done(res, tableurl(t, 'preview'), `Deleted column ${c}, the last of row ${k}`);
		done(res, rowurl(t, k), `Deleted column ${c}`);
	} catch (err) {
		back(res, rowurl(t, k), err);
	}
}

module.exports = {
	fmterr, back, editor, exec, home, newtable, create, table, query, goto, insert, batchinsert, delrows, drop,
	row, setrow, delrow, incr, cond, cell, setcell, delcell,
};
