import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { FakeEN } from './helpers/fake-en.js'
import { createInstance, useFastTimings, restoreTimings, wait, waitFor } from './helpers/harness.js'

// With fast timings, one "second" of checkInterval is 50ms and confirm checks are 50ms apart.
const CUE_NAMES = { 61: 'Scene A', 80: 'Scene B', 83: 'Scene C', 99: 'Final Scene' }

describe('NetronENInstance', () => {
	/** @type {FakeEN} */ let en
	/** @type {ReturnType<typeof createInstance>} */ let t

	beforeEach(async () => {
		useFastTimings()
		en = await new FakeEN(CUE_NAMES).start()
		t = createInstance()
	})
	afterEach(async () => {
		await t.instance.destroy()
		await en.stop()
		restoreTimings()
	})

	const init = (config = {}) => t.instance.init({ host: en.host, checkInterval: 10, verbose: false, ...config })
	const connected = () => waitFor(() => t.host.status === 'ok' && t.instance.cueNames, { message: 'connection' })

	describe('startup', () => {
		it('checks status once and loads the cue list once', async () => {
			await init({ checkInterval: 0 })
			await connected()
			assert.equal(en.count('GET', '/CuesStatus.json'), 1)
			assert.equal(en.count('GET', '/Cues.json'), 1)
			assert.equal(t.host.status, 'ok')
		})

		it('loads cue names even when no cue is running', async () => {
			en.running = ''
			await init({ checkInterval: 0 })
			await connected()
			assert.equal(t.host.variables.cue_name_61, 'Scene A')
			assert.equal(t.instance.currentCue, 0)
		})

		it('reports a connection failure when the device is unreachable', async () => {
			en.mode = 'down'
			await init()
			await waitFor(() => t.host.status === 'connection_failure', { message: 'failure status' })
		})
	})

	describe('host configuration', () => {
		for (const host of ['', 'bad host', undefined]) {
			it(`shows "bad config" instead of crashing for host ${JSON.stringify(host)}`, async () => {
				await t.instance.init({ host, checkInterval: 1 })
				assert.equal(t.host.status, 'bad_config')
				assert.ok(t.host.actions && t.host.presets, 'definitions are still registered')

				// Pressing buttons is harmless: no crash, no requests, a warning in the log
				await t.runAction('runCue', { cueNumber: 5, resendEthernet: true })
				await t.runAction('clearCue')
				await wait(200)
				assert.equal(en.totalConnections, 0)
				assert.equal(t.instance.currentCue, 0)
				assert.ok(t.host.logsAt('warn').some((m) => m.includes('no valid Host/IP Address')))
			})
		}

		it('works with a URL pasted from the browser', async () => {
			await init({ host: `http://${en.host}/index.html`, checkInterval: 0 })
			await connected()
		})

		it('recovers when a bad host is corrected', async () => {
			await t.instance.init({ host: '', checkInterval: 0 })
			assert.equal(t.host.status, 'bad_config')
			await t.instance.configUpdated({ host: en.host, checkInterval: 0 })
			await connected()
		})
	})

	describe('cue names', () => {
		it('maps the running cue name to its number', async () => {
			await init({ checkInterval: 1 })
			await connected()
			for (const [cue, name] of [
				[1, 'Cue 1'],
				[61, 'Scene A'],
				[83, 'Scene C'],
				[99, 'Final Scene'],
			]) {
				en.running = name
				await waitFor(() => t.instance.currentCue === cue, { message: `cue ${cue} (${name})` })
				assert.equal(t.host.variables.current_cue, cue)
				assert.equal(t.host.variables.current_cue_name, name)
			}
		})

		it('publishes a variable for every cue name', async () => {
			await init()
			await connected()
			assert.equal(t.host.variables.cue_name_1, 'Cue 1')
			assert.equal(t.host.variables.cue_name_61, 'Scene A')
			assert.equal(t.host.variables.cue_name_99, 'Final Scene')
			assert.ok(t.host.variableDefinitions.cue_name_99)
		})

		it('shows cue names in presets and in the action/feedback cue pickers', async () => {
			await init()
			await connected()
			assert.equal(t.host.presets.runCue_61.name, '61: Scene A')
			assert.equal(t.host.presets.runCue_5.name, 'Run Cue 5')
			assert.equal(t.host.presets.runCue_61.style.text, '$(netron:cue_name_61)')
			assert.equal(t.host.actions.runCue.options[0].choices[60].label, '61: Scene A')
			assert.equal(t.host.feedbacks.currentCue.options[0].choices[60].label, '61: Scene A')
		})

		it('reloads the cue list when a cue is renamed on the device', async () => {
			await init({ checkInterval: 1 })
			await connected()
			en.names[4] = 'Renamed Cue'
			en.running = 'Renamed Cue'
			await waitFor(() => t.instance.currentCue === 5, { timeoutMs: 2000, message: 'renamed cue to resolve' })
			assert.equal(t.host.variables.cue_name_5, 'Renamed Cue')
			assert.equal(en.count('GET', '/Cues.json'), 2)
		})

		it('maps a duplicated cue name to the lower-numbered cue (documented limitation)', async () => {
			en.names[9] = 'Same Name'
			en.names[19] = 'Same Name'
			en.running = 'Same Name'
			await init({ checkInterval: 0 })
			await connected()
			assert.equal(t.instance.currentCue, 10)
		})

		it('rate-limits cue list reloads when the running name is unknown', async () => {
			await init({ checkInterval: 1 }) // check every 50ms; reloads limited to every 500ms
			await connected()
			en.running = 'Not In The List'
			await wait(700)
			assert.ok(en.count('GET', '/Cues.json') <= 3, `got ${en.count('GET', '/Cues.json')} cue list loads`)
			assert.equal(t.instance.currentCue, 0)
		})
	})

	describe('actions', () => {
		it('updates buttons instantly, before the device replies', async () => {
			await init({ checkInterval: 0 })
			await connected()
			en.latencyMs = 200
			const press = t.runAction('runCue', { cueNumber: 61, resendEthernet: true })
			await wait(20)
			assert.equal(t.instance.currentCue, 61)
			assert.equal(t.host.variables.current_cue_name, 'Scene A')
			await press
		})

		it('sends one command, then two confirm checks, then goes quiet', async () => {
			await init({ checkInterval: 0 })
			await connected()
			en.resetStats()
			await t.runAction('runCue', { cueNumber: 61, resendEthernet: true })
			await wait(400)
			assert.deepEqual(
				en.requests.map((r) => `${r.method} ${r.url}`),
				['POST /run_cues', 'GET /CuesStatus.json', 'GET /CuesStatus.json'],
			)
		})

		it('rolls the button back if the command fails', async () => {
			await init({ checkInterval: 0 })
			await connected()
			en.mode = 'down'
			t.host.feedbackChecks.length = 0
			await t.runAction('runCue', { cueNumber: 9, resendEthernet: true })
			assert.deepEqual(t.host.feedbackChecks, [9, 1])
			assert.equal(t.instance.currentCue, 1)
			assert.ok(t.host.logsAt('error').some((m) => m.includes('Run Cue')))
		})

		it('clears the current cue', async () => {
			await init({ checkInterval: 0 })
			await connected()
			await t.runAction('clearCue')
			assert.equal(t.instance.currentCue, 0)
			assert.ok(en.requests.some((r) => r.body === 'CueResendEth=1&RunCue=0&EndFlag=1'))
		})

		it('saves a cue without changing the current cue', async () => {
			await init({ checkInterval: 0 })
			await connected()
			await t.runAction('saveCue', { cueNumber: 12 })
			assert.ok(en.requests.some((r) => r.url === '/save_cues' && r.body === 'CueNum=12&EndFlag=1'))
			assert.equal(t.instance.currentCue, 1)
		})

		it('accepts cue numbers from expressions as strings', async () => {
			await init({ checkInterval: 0 })
			await connected()
			await t.runAction('runCue', { cueNumber: '12', resendEthernet: true })
			assert.ok(en.requests.some((r) => r.body === 'CueResendEth=1&RunCue=12&EndFlag=1'))
		})

		it('never sends invalid cue numbers to the device', async () => {
			await init({ checkInterval: 0 })
			await connected()
			en.resetStats()
			for (const cueNumber of ['abc', 0, 150, 3.5, '', undefined]) {
				await t.runAction('runCue', { cueNumber, resendEthernet: true })
				await t.runAction('saveCue', { cueNumber })
			}
			await wait(100)
			assert.equal(en.requests.length, 0)
			assert.equal(t.host.logsAt('warn').length, 12)
		})
	})

	describe('feedback', () => {
		it('matches the current cue, including string values from expressions', async () => {
			await init({ checkInterval: 0 })
			await connected()
			await t.runAction('runCue', { cueNumber: 61, resendEthernet: true })
			const check = (cueNumber) => t.host.feedbacks.currentCue.callback({ options: { cueNumber } })
			assert.equal(check(61), true)
			assert.equal(check('61'), true)
			assert.equal(check(5), false)
			assert.equal(check('abc'), false)
		})

		it('is only re-checked when the cue actually changes', async () => {
			await init({ checkInterval: 1 })
			await connected()
			t.host.feedbackChecks.length = 0
			await wait(400) // ~8 background checks, cue unchanged
			assert.equal(t.host.feedbackChecks.length, 0)
		})
	})

	describe('background checks', () => {
		it('picks up cues run from elsewhere (wall panel)', async () => {
			await init({ checkInterval: 4 }) // every 200ms
			await connected()
			en.running = 'Scene C'
			await waitFor(() => t.instance.currentCue === 83, { timeoutMs: 1000, message: 'wall panel change' })
		})

		it('checks at the configured interval', async () => {
			await init({ checkInterval: 4 }) // every 200ms
			await connected()
			en.resetStats()
			await wait(1100)
			const checks = en.count('GET', '/CuesStatus.json')
			assert.ok(checks >= 4 && checks <= 6, `expected ~5 checks, got ${checks}`)
		})

		it('sends nothing at all while idle when disabled (interval 0)', async () => {
			await init({ checkInterval: 0 })
			await connected()
			en.resetStats()
			await wait(600)
			assert.equal(en.requests.length, 0)
		})
	})

	describe('protecting the device', () => {
		it('never has more than one request in progress, through config spam, presses and slow replies', async () => {
			en.latencyMs = 40
			await init({ checkInterval: 1 })
			for (let i = 0; i < 5; i++) {
				await wait(15)
				await t.instance.configUpdated({ host: en.host, checkInterval: 1 })
			}
			await Promise.all([
				t.runAction('runCue', { cueNumber: 7, resendEthernet: true }),
				t.runAction('saveCue', { cueNumber: 4 }),
				t.runAction('runCue', { cueNumber: 61, resendEthernet: true }),
				t.runAction('clearCue'),
			])
			await wait(500)
			assert.equal(en.maxConcurrentRequests, 1)
		})

		it('does not stack up check loops when the config is saved repeatedly', async () => {
			await init({ checkInterval: 4 })
			for (let i = 0; i < 10; i++) await t.instance.configUpdated({ host: en.host, checkInterval: 4 })
			await connected()
			en.resetStats()
			await wait(1100)
			const checks = en.count('GET', '/CuesStatus.json')
			assert.ok(checks <= 6, `expected one loop (~5 checks), got ${checks}`)
		})

		it('ignores a stale check result when a button is pressed mid-check (no flicker)', async () => {
			en.latencyMs = 100
			await init({ checkInterval: 1 })
			await connected()
			await waitFor(() => en.activeRequests > 0, { message: 'a check to be in flight' })
			t.host.feedbackChecks.length = 0
			await t.runAction('runCue', { cueNumber: 5, resendEthernet: true })
			await wait(500)
			assert.ok(!t.host.feedbackChecks.includes(1), `flickered back to 1: ${t.host.feedbackChecks.join(' → ')}`)
			assert.equal(t.instance.currentCue, 5)
		})

		it('times out hung requests instead of holding a connection open', async () => {
			await init({ checkInterval: 0 })
			await connected()
			en.mode = 'hang'
			await t.runAction('runCue', { cueNumber: 2, resendEthernet: true })
			assert.equal(t.instance.currentCue, 1) // rolled back after the timeout
			await waitFor(() => en.openConnections === 0, { message: 'hung connection to be closed' })
		})

		it('backs off while the device is down, then recovers by itself', async () => {
			await init({ checkInterval: 0 })
			await connected()
			en.mode = 'down'
			en.resetStats()
			await t.runAction('runCue', { cueNumber: 3, resendEthernet: true })
			await waitFor(() => t.host.status === 'connection_failure', { message: 'failure' })

			// Retries back off 50 → 100 → 200 → 400ms (cap). A fixed 50ms poller would
			// make ~30 attempts in 1.5s; backoff should make well under half that.
			en.resetStats()
			await wait(1500)
			assert.ok(en.totalConnections >= 3 && en.totalConnections <= 8, `got ${en.totalConnections} attempts`)
			const errors = t.host.logsAt('error').filter((m) => m.includes('checking device status'))
			assert.equal(errors.length, 1, 'only the first failure of an outage should be logged')

			en.mode = 'up'
			en.running = 'Scene C'
			await waitFor(() => t.host.status === 'ok' && t.instance.currentCue === 83, {
				timeoutMs: 2000,
				message: 'recovery',
			})
			assert.ok(t.host.logsAt('info').includes('Connection to device restored'))
		})

		it('leaves no connections open while idle', async () => {
			await init({ checkInterval: 0 })
			await connected()
			await t.runAction('runCue', { cueNumber: 61, resendEthernet: true })
			await wait(300) // command + confirm checks are done
			assert.equal(en.openConnections, 0)
		})

		it('makes no requests after destroy', async () => {
			await init({ checkInterval: 1 })
			await connected()
			await t.instance.destroy()
			en.resetStats()
			await wait(300)
			assert.equal(en.requests.length, 0)
		})
	})
})
