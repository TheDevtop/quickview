// Client for the Quicktable REST API (docs/rest.md).

const e = encodeURIComponent;

async function call(base, method, path, body) {
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

// client binds the API to one server, since each browser picks its own.
function client(base) {
	base = base.replace(/\/+$/, '');
	const c = (method, path, body) => call(base, method, path, body);
	return {
		base,
		tables: () => c('GET', ''),
		drop: (t) => c('DELETE', tp(t)),
		getcell: (t, k, col) => c('GET', rp(t, k) + '/columns/' + e(col)),
		setcell: (t, k, col, value) => c('PUT', rp(t, k) + '/columns/' + e(col), { value }),
		delcell: (t, k, col) => c('DELETE', rp(t, k) + '/columns/' + e(col)),
		rows: (t) => c('GET', tp(t) + '/rows'),
		getrow: (t, k) => c('GET', rp(t, k)),
		setrow: (t, k, cols) => c('PUT', rp(t, k), cols),
		insert: (t, cols) => c('POST', tp(t) + '/rows', cols),
		delrow: (t, k) => c('DELETE', rp(t, k)),
		query: (t, q) => c('POST', tp(t) + '/query', q),
		batch: (t, b) => c('POST', tp(t) + '/batch', b),
		atomic: (t, k, op, body) => c('POST', rp(t, k) + '/' + op, body),
		cas: (t, k, body) => c('POST', rp(t, k) + '/cas', body),
	};
}

module.exports = { client };
