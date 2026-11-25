const express = require('express');
const { engine } = require('express-handlebars');
const qt = require('./models/quicktable');
const tc = require('./controllers/tables');

const ops = ['=', '!=', '>', '>=', '<', '<=', 'CONTAINS', 'PREFIX', 'EXISTS', 'MISSING'];
const types = ['string', 'int', 'float', 'bool'];

let addr = process.env.QUICKTABLE_URL ?? 'http://localhost:8080';
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
		json: (v) => JSON.stringify(v, null, 2),
		concat: (...a) => a.slice(0, -1).join(''),
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

app.get('/connect', (req, res) => {
	res.render('connect', { title: 'Connect', url: cookie(req, 'qt') ?? addr, err: req.query.err });
});

app.post('/connect', async (req, res) => {
	const url = (req.body.url ?? '').trim();
	try {
		if (!/^https?:\/\/[^\s]+$/.test(url))
			throw new Error('address must start with http:// or https://');
		await qt.client(url).tables();
	} catch (err) {
		return res.render('connect', { title: 'Connect', url, err: tc.fmterr(err) });
	}
	res.cookie('qt', url, { httpOnly: true, sameSite: 'lax' });
	res.redirect('/');
});

app.post('/disconnect', (req, res) => {
	res.clearCookie('qt');
	res.redirect('/connect');
});

// Everything past here needs a server; every page shows the table explorer.
app.use(async (req, res, next) => {
	const base = cookie(req, 'qt');
	if (base === undefined)
		return res.redirect('/connect');
	req.qt = qt.client(base);
	Object.assign(res.locals, { base: req.qt.base, ops, types, msg: req.query.msg, err: req.query.err });
	try {
		res.locals.tables = (await req.qt.tables()).tables ?? [];
	} catch (err) {
		res.locals.tables = [];
		res.locals.connerr = tc.fmterr(err);
	}
	next();
});

app.get('/', tc.home);
app.get('/new', tc.newtable);
app.post('/tables', tc.create);
app.get('/tables/:table', tc.table);
app.post('/tables/:table/query', tc.query);
app.post('/tables/:table/rows', tc.insert);
app.post('/tables/:table/batch', tc.batch);
app.post('/tables/:table/drop', tc.drop);
app.get('/tables/:table/rows/:row', tc.row);
app.post('/tables/:table/rows/:row', tc.setrow);
app.post('/tables/:table/rows/:row/delete', tc.delrow);
app.post('/tables/:table/rows/:row/atomic', tc.atomic);
app.post('/tables/:table/rows/:row/cas', tc.cas);
app.post('/tables/:table/rows/:row/columns', tc.setcell);
app.get('/tables/:table/rows/:row/columns/:column', tc.cell);
app.post('/tables/:table/rows/:row/columns/:column', tc.setcell);
app.post('/tables/:table/rows/:row/columns/:column/delete', tc.delcell);

app.use((err, req, res, next) => {
	res.status(err.status ?? 500).render('error', { title: 'Error', table: req.params.table, err: undefined, failure: tc.fmterr(err) });
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
