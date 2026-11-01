import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { cueNumberOption, parseCueNumber } from '../src/options.js'

describe('parseCueNumber', () => {
	it('accepts whole numbers 1–99, as numbers or strings', () => {
		assert.equal(parseCueNumber(1), 1)
		assert.equal(parseCueNumber(99), 99)
		assert.equal(parseCueNumber('61'), 61)
		assert.equal(parseCueNumber(' 7 '), 7)
	})

	it('rejects anything that should never be sent to the device', () => {
		for (const bad of [0, 100, -1, 3.5, 'abc', '', ' ', null, undefined, NaN, Infinity, {}, [], true]) {
			assert.equal(parseCueNumber(bad), null, `expected ${JSON.stringify(bad)} to be rejected`)
		}
	})
})

describe('cueNumberOption', () => {
	it('lists all 99 cues with numeric ids matching what buttons store', () => {
		const option = cueNumberOption({ cueNames: null })
		assert.equal(option.id, 'cueNumber')
		assert.equal(option.type, 'dropdown')
		assert.equal(option.choices.length, 99)
		assert.deepEqual(option.choices[0], { id: 1, label: 'Cue 1' })
		assert.deepEqual(option.choices[98], { id: 99, label: 'Cue 99' })
	})

	it('shows device cue names, but not redundant default names', () => {
		const cueNames = Array.from({ length: 99 }, (_, i) => `Cue ${i + 1}`)
		cueNames[60] = 'Scene A'
		const { choices } = cueNumberOption({ cueNames })
		assert.equal(choices[60].label, '61: Scene A')
		assert.equal(choices[4].label, 'Cue 5')
	})
})
