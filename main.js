const http = require('node:http');
const express = require('express');
const { engine } = require('express-handlebars');
const qt = require('./models/quicktable');
const tc = require('./controllers/tables');

const cmps = ['=', '!=', '<', '<=', '>', '>=', 'prefix', 'contains', 'exists', 'missing'];
const types = ['string', 'number', 'boolean'];
const aggs = ['count', 'sum', 'avg', 'min', 'max'];

let addr = process.env.QUICKTABLE_URL ?? 'http://localhost:16000';
let port = Number(process.env.PORT ?? 3000);

function usage() {
	process.stderr.write('usage: node main.js [-a quicktable-url] [-p port]\n');
	process.exit(1);
}

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	if (i + 1 >= argv.length)
		usage();
	switch (argv[i]) {
	case '-a':
		addr = argv[++i];
		break;
	case '-p':
		port = Number(argv[++i]);
		break;
	default:
		usage();
	}
}
if (!Number.isInteger(port) || port <= 0)
	usage();

const app = express();
app.engine('handlebars', engine({
	helpers: {
		eq: (a, b) => a === b,
		u: (s) => encodeURIComponent(s),
		inc: (n) => n + 1,
		json: (v) => JSON.stringify(v, null, 2),
		concat: (...a) => a.slice(0, -1).join(''),
		// Views render before the layout, so a view can fill layout slots
		// such as the subheader through the shared root context.
		section(name, opts) {
			opts.data.root.sections ??= {};
			opts.data.root.sections[name] = opts.fn(this);
			return null;
		},
	},
}));
app.set('view engine', 'handlebars');
app.set('views', __dirname + '/views');
app.use('/static', express.static(__dirname + '/views/static'));
app.use(express.urlencoded({ extended: true }));

function cookie(req, name) {
	for (const kv of (req.headers.cookie ?? '').split(';')) {
		const i = kv.indexOf('=');
		if (i >= 0 && kv.slice(0, i).trim() === name)
			return decodeURIComponent(kv.slice(i + 1).trim());
	}
	return undefined;
}

// The token is never echoed back into a page; it only lives in an httpOnly cookie.
function connectform(res, url, err) {
	res.render('connect', { title: 'Connect', url, err });
}

app.get('/connect', (req, res) => {
	connectform(res, cookie(req, 'qt') ?? addr, req.query.err);
});

app.post('/connect', async (req, res) => {
	const url = (req.body.url ?? '').trim();
	const token = (req.body.token ?? '').trim();
	try {
		if (!/^https?:\/\/[^\s]+$/.test(url))
			throw new Error('address must start with http:// or https://');
		if (token === '')
			throw new Error('bearer token is required');
		const c = qt.client(url, token);
		await c.health();
		await c.scan();
	} catch (err) {
		return connectform(res, url, tc.fmterr(err));
	}
	const opts = { httpOnly: true, sameSite: 'lax', secure: req.secure };
	res.cookie('qt', url, opts);
	res.cookie('qtt', token, opts);
	res.redirect('/');
});

// signout forgets the token and sends the browser back to /connect.
function signout(res, err) {
	res.clearCookie('qtt');
	res.redirect('/connect' + (err !== undefined ? '?err=' + encodeURIComponent(tc.fmterr(err)) : ''));
}

app.post('/disconnect', (req, res) => {
	res.clearCookie('qt');
	signout(res);
});

// Everything past here needs a server; every page shows the table explorer.
app.use(async (req, res, next) => {
	const base = cookie(req, 'qt');
	const token = cookie(req, 'qtt');
	if (base === undefined || token === undefined)
		return res.redirect('/connect');
	req.qt = qt.client(base, token);
	Object.assign(res.locals, { base: req.qt.base, docs: qt.docs, ops: qt.ops, cmps, types, aggs, msg: req.query.msg, err: req.query.err });
	try {
		res.locals.tables = (await req.qt.scan()).names;
	} catch (err) {
		if (err.status === 401)
			return signout(res, err);
		res.locals.tables = [];
		res.locals.connerr = tc.fmterr(err);
	}
	next();
});

app.get('/', tc.home);
app.get('/editor', tc.editor);
app.post('/editor', tc.exec);
app.get('/new', tc.newtable);
app.post('/tables', tc.create);
app.get('/tables/:table', tc.table);
app.get('/tables/:table/goto', tc.goto);
app.post('/tables/:table/query', tc.query);
app.post('/tables/:table/rows', tc.insert);
app.post('/tables/:table/drop', tc.drop);
app.post('/tables/:table/batch', tc.batchinsert);
app.post('/tables/:table/delete', tc.delrows);
app.get('/tables/:table/rows/:row', tc.row);
app.post('/tables/:table/rows/:row', tc.setrow);
app.post('/tables/:table/rows/:row/delete', tc.delrow);
app.post('/tables/:table/rows/:row/incr', tc.incr);
app.post('/tables/:table/rows/:row/cond', tc.cond);
app.get('/tables/:table/rows/:row/columns/:column', tc.cell);
app.post('/tables/:table/rows/:row/columns/:column', tc.setcell);
app.post('/tables/:table/rows/:row/columns/:column/delete', tc.delcell);

// fail renders the error page; it links back to the table the failed URL was under.
function fail(req, res, status, msg) {
	const reason = http.STATUS_CODES[status] ?? 'Error';
	let table;
	const m = /^\/tables\/([^/]+)/.exec(req.path);
	if (m !== null) {
		try {
			table = decodeURIComponent(m[1]);
		} catch {
			table = undefined;
		}
	}
	res.status(status).render('error', { title: `${status} ${reason}`, icon: 'error_outline', status, reason, text: msg, table, err: undefined, msg: undefined });
}

app.use((req, res) => {
	fail(req, res, 404, `There is no page at ${req.path}`);
});

app.use((err, req, res, next) => {
	const status = err.status ?? 500;
	if (status === 401)
		return signout(res, err);
	if (status >= 500)
		process.stderr.write(`quickview: ${req.method} ${req.path}: ${err.message}\n`);
	fail(req, res, status, err.message);
});

// As PID 1 in a container, node gets no default signal handling.
for (const sig of ['SIGINT', 'SIGTERM'])
	process.on(sig, () => process.exit(0));

app.listen(port, (err) => {
	if (err !== undefined) {
		process.stderr.write(`quickview: ${err.message}\n`);
		process.exit(1);
	}
	process.stderr.write(`quickview: listening on :${port}, quicktable at ${addr}\n`);
});
