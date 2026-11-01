import http from 'node:http'

/**
 * A fake Netron EN-12 web server, modelled on the real device:
 *  - GET  /CuesStatus.json → { "CueRunningName": "<name>" }
 *  - GET  /Cues.json       → [{ name, fadeTime, holdTime, linkCue, dmxdata }, ...] (99 cues, index 0 = cue 1)
 *  - GET  /cues.json       → a *stale* cue list (the real device has this too; URLs are case-sensitive)
 *  - POST /run_cues        → CueResendEth=1&RunCue=<n>&EndFlag=1 (RunCue=0 clears)
 *  - POST /save_cues       → CueNum=<n>&EndFlag=1
 * Responses are padded with trailing whitespace and NULs, like the real device.
 *
 * Knobs for tests: `latencyMs`, `mode` ('up' | 'down' | 'hang' | 'error' | 'trickle'), `running`, `names`.
 * Observability: `requests` (log), `maxConcurrentRequests`, `openConnections`, `totalConnections`.
 *
 * Note on connections vs requests: without HTTP keep-alive, when the client closes one
 * connection and immediately opens the next, the server can briefly see both (the old
 * one's close and the new one's open cross on the wire). That overlap is harmless, so the
 * "one at a time" guarantee is measured on requests in progress, not on open sockets.
 */
export class FakeEN {
	/** @type {string[]} */
	names = Array.from({ length: 99 }, (_, i) => `Cue ${i + 1}`)
	running = 'Cue 1'
	latencyMs = 0
	/**
	 * 'up' responds normally, 'down' drops connections, 'hang' never replies, 'error' replies HTTP 500,
	 * 'trickle' sends a byte every 100ms and never finishes (defeats inactivity-only timeouts)
	 */
	mode = 'up'
	/** Delay before a run_cues command takes effect on CueRunningName */
	cueChangeDelayMs = 0

	/** @type {{ method: string, url: string, body: string, at: number }[]} */
	requests = []
	/** Requests currently being handled (received but not yet replied to or abandoned) */
	activeRequests = 0
	maxConcurrentRequests = 0
	/** TCP connections currently open */
	openConnections = 0
	/** Total TCP connections opened, including ones dropped in 'down' mode */
	totalConnections = 0

	#server
	#sockets = new Set()
	#startedAt = Date.now()

	constructor(names = {}) {
		for (const [cue, name] of Object.entries(names)) this.names[Number(cue) - 1] = name
	}

	async start() {
		this.#server = http.createServer((req, res) => this.#handle(req, res))
		this.#server.on('connection', (socket) => {
			this.#sockets.add(socket)
			this.totalConnections++
			this.openConnections++
			socket.on('close', () => {
				this.#sockets.delete(socket)
				this.openConnections--
			})
		})
		await new Promise((resolve) => this.#server.listen(0, '127.0.0.1', resolve))
		return this
	}

	async stop() {
		for (const socket of this.#sockets) socket.destroy()
		await new Promise((resolve) => this.#server.close(resolve))
	}

	get host() {
		return `127.0.0.1:${this.#server.address().port}`
	}

	/** Requests matching a method/url, e.g. count('GET', '/CuesStatus.json') */
	count(method, url) {
		return this.requests.filter((r) => r.method === method && (url === undefined || r.url === url)).length
	}

	resetStats() {
		this.requests = []
		this.totalConnections = 0
		this.maxConcurrentRequests = this.activeRequests
		this.#startedAt = Date.now()
	}

	#handle(req, res) {
		if (this.mode === 'down') {
			req.socket.destroy()
			return
		}

		this.activeRequests++
		this.maxConcurrentRequests = Math.max(this.maxConcurrentRequests, this.activeRequests)
		let finished = false
		const finish = () => {
			if (!finished) {
				finished = true
				this.activeRequests--
			}
		}
		res.on('finish', finish)
		res.on('close', finish)

		let body = ''
		req.on('data', (chunk) => (body += chunk))
		req.on('end', () => {
			this.requests.push({ method: req.method, url: req.url, body, at: Date.now() - this.#startedAt })
			if (this.mode === 'hang') return
			if (this.mode === 'trickle') {
				res.writeHead(200, { 'Content-Type': 'text/html' })
				const drip = setInterval(() => (res.destroyed ? clearInterval(drip) : res.write(' ')), 100)
				res.on('close', () => clearInterval(drip))
				return
			}

			if (req.method === 'POST' && req.url === '/run_cues') {
				const cue = Number(new URLSearchParams(body).get('RunCue'))
				const apply = () => (this.running = cue === 0 ? '' : this.names[cue - 1])
				if (this.cueChangeDelayMs > 0) setTimeout(apply, this.cueChangeDelayMs)
				else apply()
			}

			setTimeout(() => {
				if (res.destroyed) return
				const reply = this.mode === 'error' ? { status: 500, body: 'Internal Error' } : this.#route(req.method, req.url)
				res.statusCode = reply.status
				res.setHeader('Content-Type', 'text/html')
				res.end(reply.body)
			}, this.latencyMs)
		})
	}

	#route(method, url) {
		const pad = (json) => JSON.stringify(json) + ' '.repeat(64) + '\0\0'
		if (method === 'GET' && url === '/CuesStatus.json') {
			return { status: 200, body: pad({ CueRunningName: this.running }) }
		}
		if (method === 'GET' && url === '/Cues.json') {
			return {
				status: 200,
				body: pad(this.names.map((name, i) => ({ name, fadeTime: 2, holdTime: 1, linkCue: 0, dmxdata: i }))),
			}
		}
		if (method === 'GET' && url === '/cues.json') {
			const stale = this.names.map((_, i) => ({
				name: `Stale ${i + 1}`,
				fadeTime: 0,
				holdTime: 1,
				linkCue: 0,
				dmxdata: 255,
			}))
			return { status: 200, body: pad(stale) }
		}
		if (method === 'POST' && (url === '/run_cues' || url === '/save_cues')) {
			return { status: 200, body: 'OK' }
		}
		return { status: 404, body: 'Not Found' }
	}
}
