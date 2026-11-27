// Client for the Quicktable REST API (docs/rest.md).

// This link to the Quicktable docs need to be kept up-to-date
const docs = `https://github.com/TheDevtop/quicktable/blob/v1.0.0/docs/rest.md`;
const ops = ['scan', 'get', 'values', 'query', 'batch', 'incr'];

async function call(base, token, method, path, body) {
	const opts = { method, headers: {} };
	if (token !== undefined)
		opts.headers.Authorization = 'Bearer ' + token;
	if (body !== undefined) {
		opts.headers['Content-Type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}

	let res;
	try {
		res = await fetch(base + path, opts);
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

// client binds the API to one server and token, since each browser picks its own.
// Every operation is a POST of one JSON object to /api/<op>.
function client(base, token) {
	base = base.replace(/\/+$/, '');
	const c = { base, health: () => call(base, undefined, 'GET', '/health') };
	for (const op of ops)
		c[op] = (body) => call(base, token, 'POST', '/api/' + op, body ?? {});
	return c;
}

module.exports = { docs, ops, client };
