import http from 'node:http'

const DEFAULT_TIMEOUT_MS = 3000

/**
 * Parse the user's "Host/IP Address" config value.
 * Accepts `192.0.2.10`, `192.0.2.10:8080`, or a URL pasted from the browser
 * (`http://192.0.2.10/index.html`). Returns null if it isn't a usable host.
 *
 * @param {unknown} input
 * @returns {{ hostname: string, port: number } | null}
 */
export function parseHost(input) {
	if (typeof input !== 'string') return null
	const value = input
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // scheme
		.replace(/[/?#].*$/, '') // path, query, fragment
	if (!value || /\s/.test(value)) return null

	let url
	try {
		url = new URL(`http://${value}`)
	} catch {
		return null
	}
	if (url.username || url.password) return null

	const hostname = url.hostname.replace(/^\[|\]$/g, '')
	if (!hostname) return null
	return { hostname, port: url.port ? Number(url.port) : 80 }
}

/**
 * Minimal HTTP client for the Netron EN web API.
 *
 * The EN's embedded web server is easily overwhelmed, so this client is
 * deliberately conservative:
 *  - a dedicated agent with maxSockets: 1, so at most one request is ever in
 *    progress; others queue here in Companion rather than at the device.
 *    (Node reuses the connection while requests are queued, and closes it as
 *    soon as the queue is empty, so no idle connection is left open.)
 *  - a hard deadline on every request, counted from when it gets a connection,
 *    so a hung or trickling response can't hold the device or stall the queue
 */
export class NetronClient {
	#hostname
	#port
	#agent
	#timeoutMs
	#inFlight = new Set()
	#destroyed = false

	/**
	 * @param {string} host IP/hostname, optionally with :port (see parseHost)
	 * @param {{ timeoutMs?: number }} [options]
	 */
	constructor(host, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
		const target = parseHost(host)
		if (!target) throw new Error(`Invalid host: "${host}"`)
		this.#hostname = target.hostname
		this.#port = target.port
		this.#timeoutMs = timeoutMs
		this.#agent = new http.Agent({ keepAlive: false, maxSockets: 1 })
	}

	/** Abort any in-flight request and release all sockets */
	destroy() {
		this.#destroyed = true
		for (const req of this.#inFlight) req.destroy(new Error('Client destroyed'))
		this.#inFlight.clear()
		this.#agent.destroy()
	}

	/** GET /CuesStatus.json → { CueRunningName: string } */
	async getCuesStatus() {
		return parseJson(await this.#request('GET', '/CuesStatus.json'))
	}

	/**
	 * GET /Cues.json → array of cue names, where index 0 is cue 1.
	 * The device returns [{ name, fadeTime, holdTime, linkCue, dmxdata }, ...]
	 */
	async getCueNames() {
		const list = parseJson(await this.#request('GET', '/Cues.json'))
		if (!Array.isArray(list)) throw new Error('Unexpected Cues.json response')
		return list.map((cue) => (typeof cue?.name === 'string' ? cue.name : ''))
	}

	/** POST /run_cues */
	async runCue(cueNumber, resendEthernet) {
		await this.#request('POST', '/run_cues', {
			CueResendEth: resendEthernet ? 1 : 0,
			RunCue: cueNumber,
			EndFlag: 1,
		})
	}

	/** POST /run_cues with cue 0 */
	async clearCue() {
		await this.runCue(0, true)
	}

	/** POST /save_cues */
	async saveCue(cueNumber) {
		await this.#request('POST', '/save_cues', {
			CueNum: cueNumber,
			EndFlag: 1,
		})
	}

	#request(method, path, form) {
		const payload = form ? new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])).toString() : null

		return new Promise((resolve, reject) => {
			if (this.#destroyed) return reject(new Error('Client destroyed'))

			const req = http.request(
				{
					host: this.#hostname,
					port: this.#port,
					method,
					path,
					agent: this.#agent,
					headers: payload
						? {
								'Content-Type': 'application/x-www-form-urlencoded',
								'Content-Length': Buffer.byteLength(payload),
							}
						: {},
				},
				(res) => {
					const chunks = []
					res.on('data', (c) => chunks.push(c))
					res.on('end', () => {
						const body = Buffer.concat(chunks).toString('utf8')
						if (res.statusCode && res.statusCode >= 400) {
							reject(new Error(`HTTP ${res.statusCode} from ${method} ${path}`))
						} else {
							resolve(body)
						}
					})
					res.on('error', reject)
				},
			)

			// Hard deadline for the whole request, started once it has a connection
			// (time spent queued behind another request doesn't count).
			let deadline
			req.once('socket', () => {
				deadline = setTimeout(() => req.destroy(new Error(`Timed out after ${this.#timeoutMs}ms`)), this.#timeoutMs)
			})
			req.on('error', reject)
			this.#inFlight.add(req)
			req.on('close', () => {
				clearTimeout(deadline)
				this.#inFlight.delete(req)
			})

			if (payload) req.write(payload)
			req.end()
		})
	}
}

/** The device pads responses with trailing whitespace/NULs; strip before parsing */
function parseJson(body) {
	// eslint-disable-next-line no-control-regex
	return JSON.parse(body.replace(/[\s\u0000]+$/, ''))
}
