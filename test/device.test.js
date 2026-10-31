import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { NetronClient, parseHost } from '../src/device.js'
import { FakeEN } from './helpers/fake-en.js'

describe('NetronClient', () => {
	/** @type {FakeEN} */ let en
	/** @type {NetronClient} */ let client

	beforeEach(async () => {
		en = await new FakeEN({ 61: 'Scene A' }).start()
		client = new NetronClient(en.host, { timeoutMs: 300 })
	})
	afterEach(async () => {
		client.destroy()
		await en.stop()
	})

	it('reads the running cue name, ignoring the device padding', async () => {
		en.running = 'Scene A'
		assert.deepEqual(await client.getCuesStatus(), { CueRunningName: 'Scene A' })
	})

	it('reads cue names from /Cues.json (capital C), not the stale /cues.json', async () => {
		const names = await client.getCueNames()
		assert.equal(names.length, 99)
		assert.equal(names[0], 'Cue 1')
		assert.equal(names[60], 'Scene A')
		assert.equal(en.count('GET', '/Cues.json'), 1)
		assert.equal(en.count('GET', '/cues.json'), 0)
	})

	it('sends commands with the exact form bodies the device expects', async () => {
		await client.runCue(61, true)
		await client.runCue(5, false)
		await client.saveCue(12)
		await client.clearCue()
		assert.deepEqual(
			en.requests.map((r) => `${r.method} ${r.url} ${r.body}`),
			[
				'POST /run_cues CueResendEth=1&RunCue=61&EndFlag=1',
				'POST /run_cues CueResendEth=0&RunCue=5&EndFlag=1',
				'POST /save_cues CueNum=12&EndFlag=1',
				'POST /run_cues CueResendEth=1&RunCue=0&EndFlag=1',
			],
		)
	})

	it('never has more than one request in progress, even when called concurrently', async () => {
		en.latencyMs = 50
		await Promise.all([
			client.getCuesStatus(),
			client.getCuesStatus(),
			client.runCue(1, true),
			client.getCueNames(),
			client.saveCue(2),
		])
		assert.equal(en.requests.length, 5)
		assert.equal(en.maxConcurrentRequests, 1)
		await new Promise((r) => setTimeout(r, 50))
		assert.equal(en.openConnections, 0, 'no idle connections should be left open')
	})

	it('times out a request the device never answers, and frees the connection', async () => {
		en.mode = 'hang'
		const started = Date.now()
		await assert.rejects(client.getCuesStatus(), /Timed out after 300ms/)
		assert.ok(Date.now() - started < 1000)

		// The hung connection was closed, and the next request isn't stuck behind it
		await new Promise((r) => setTimeout(r, 50))
		assert.equal(en.openConnections, 0)
		en.mode = 'up'
		assert.deepEqual(await client.getCuesStatus(), { CueRunningName: 'Cue 1' })
	})

	it('enforces a hard deadline even if the device keeps trickling data', async () => {
		en.mode = 'trickle'
		const started = Date.now()
		await assert.rejects(client.getCuesStatus(), /Timed out after 300ms/)
		const elapsed = Date.now() - started
		assert.ok(elapsed < 600, `took ${elapsed}ms`)
	})

	it('does not count time spent queued behind another request towards the deadline', async () => {
		en.latencyMs = 200 // each request takes 200ms; two in a row exceed the 300ms deadline
		await Promise.all([client.getCuesStatus(), client.getCuesStatus()])
	})

	it('rejects when the device is unreachable', async () => {
		en.mode = 'down'
		await assert.rejects(client.getCuesStatus())
	})

	it('rejects on HTTP error responses', async () => {
		en.mode = 'error'
		await assert.rejects(client.getCuesStatus(), /HTTP 500 from GET \/CuesStatus.json/)
	})

	it('destroy() aborts in-flight requests and refuses new ones', async () => {
		en.mode = 'hang'
		const pending = client.getCuesStatus()
		await new Promise((r) => setTimeout(r, 20))
		client.destroy()
		await assert.rejects(pending, /Client destroyed/)
		await assert.rejects(client.getCuesStatus(), /Client destroyed/)
	})

	it('accepts a host with a port', async () => {
		assert.match(en.host, /:\d+$/)
		await client.getCuesStatus() // would fail if the port were ignored
	})
})

describe('parseHost', () => {
	it('accepts an IP, a hostname, or either with a port', () => {
		assert.deepEqual(parseHost('192.0.2.10'), { hostname: '192.0.2.10', port: 80 })
		assert.deepEqual(parseHost(' 192.0.2.10 '), { hostname: '192.0.2.10', port: 80 })
		assert.deepEqual(parseHost('192.0.2.10:8080'), { hostname: '192.0.2.10', port: 8080 })
		assert.deepEqual(parseHost('netron.local'), { hostname: 'netron.local', port: 80 })
	})

	it('accepts a URL pasted from the browser', () => {
		assert.deepEqual(parseHost('http://192.0.2.10'), { hostname: '192.0.2.10', port: 80 })
		assert.deepEqual(parseHost('http://192.0.2.10/index.html'), { hostname: '192.0.2.10', port: 80 })
		assert.deepEqual(parseHost('HTTP://192.0.2.10:81/'), { hostname: '192.0.2.10', port: 81 })
	})

	it('rejects values that are not a usable host', () => {
		for (const bad of ['', '   ', 'bad host', 'http://', '192.0.2.10:99999', undefined, null, 42]) {
			assert.equal(parseHost(bad), null, `expected ${JSON.stringify(bad)} to be rejected`)
		}
	})

	it('makes the client refuse to construct with an invalid host', () => {
		assert.throws(() => new NetronClient(''), /Invalid host/)
		assert.throws(() => new NetronClient(undefined), /Invalid host/)
	})
})
