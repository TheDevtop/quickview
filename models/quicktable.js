// Client for the Quicktable REST API (docs/rest.md).

const e = encodeURIComponent;
let base = 'http://localhost:8080';

function setbase(url) {
	base = url.replace(/\/+$/, '');
}

function getbase() {
	return base;
}

async function call(method, path, body) {
	const opts = { method, headers: {} };
	if (body !== undefined) {
		opts.headers['Content-Type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}

	let res;
	try {
		res = await fetch(base + '/api/tables' + path, opts);
	} catch (err) {
		const x = new Error(`cannot reach ${base}: ${err.cause?.code ?? err.message}`);
		x.status = 502;
		throw x;
	}

	const text = await res.text();
	let data = {};
	if (text.length > 0) {
		try {
			data = JSON.parse(text);
		} catch {
			data = { error: text };
		}
	}
	if (!res.ok) {
		const x = new Error(data.error ?? res.statusText);
		x.status = res.status;
		throw x;
	}
	return data;
}

function tp(t) {
	return '/' + e(t);
}

function rp(t, k) {
	return tp(t) + '/rows/' + e(k);
}

module.exports = {
	setbase,
	getbase,
	tables: () => call('GET', ''),
	drop: (t) => call('DELETE', tp(t)),
	getcell: (t, k, c) => call('GET', rp(t, k) + '/columns/' + e(c)),
	setcell: (t, k, c, value) => call('PUT', rp(t, k) + '/columns/' + e(c), { value }),
	delcell: (t, k, c) => call('DELETE', rp(t, k) + '/columns/' + e(c)),
	rows: (t) => call('GET', tp(t) + '/rows'),
	getrow: (t, k) => call('GET', rp(t, k)),
	setrow: (t, k, cols) => call('PUT', rp(t, k), cols),
	insert: (t, cols) => call('POST', tp(t) + '/rows', cols),
	delrow: (t, k) => call('DELETE', rp(t, k)),
	query: (t, q) => call('POST', tp(t) + '/query', q),
	batch: (t, b) => call('POST', tp(t) + '/batch', b),
	atomic: (t, k, op, body) => call('POST', rp(t, k) + '/' + op, body),
	cas: (t, k, body) => call('POST', rp(t, k) + '/cas', body),
};
