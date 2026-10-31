import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { UpgradeScripts } from '../src/upgrades.js'
import { DEFAULT_CHECK_INTERVAL_S } from '../src/config.js'

const run = (script, config) =>
	script({ currentConfig: config ?? {} }, { config, secrets: null, actions: [], feedbacks: [] })

describe('UpgradeScripts', () => {
	it('keeps the original placeholder script so existing upgrade indexes stay valid', () => {
		assert.ok(UpgradeScripts.length >= 2)
		assert.deepEqual(run(UpgradeScripts[0], {}), { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] })
	})

	describe('polling → background check interval', () => {
		const upgrade = UpgradeScripts[1]

		it('moves polling users to the default slow interval, dropping old fast rates', () => {
			const { updatedConfig } = run(upgrade, { host: '192.0.2.10', polling: true, pollingRate: 500, verbose: true })
			assert.deepEqual(updatedConfig, { host: '192.0.2.10', verbose: true, checkInterval: DEFAULT_CHECK_INTERVAL_S })
		})

		it('turns background checks off for users who had polling disabled', () => {
			const { updatedConfig } = run(upgrade, { host: '192.0.2.10', polling: false, pollingRate: 100 })
			assert.deepEqual(updatedConfig, { host: '192.0.2.10', checkInterval: 0 })
		})

		it('does nothing when there is no config', () => {
			assert.equal(run(upgrade, null).updatedConfig, null)
		})
	})
})
