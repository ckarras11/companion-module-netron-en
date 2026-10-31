import { CUE_COUNT } from './config.js'

/**
 * Cue picker shared by actions and feedbacks.
 * Choice ids are the cue numbers (1–99), matching what existing buttons store,
 * and labels include the device's cue names once they've been loaded.
 */
export function cueNumberOption(self) {
	const choices = []
	for (let i = 1; i <= CUE_COUNT; i++) {
		const name = self.cueNames?.[i - 1]
		choices.push({ id: i, label: name && name !== `Cue ${i}` ? `${i}: ${name}` : `Cue ${i}` })
	}

	return {
		type: 'dropdown',
		label: 'Cue',
		id: 'cueNumber',
		default: 1,
		choices,
		minChoicesForSearch: 0,
	}
}

/**
 * Options can be expressions, so the value may be anything.
 * Returns a valid cue number (integer 1–99), or null.
 */
export function parseCueNumber(value) {
	const n = typeof value === 'string' ? Number(value.trim()) : value
	return Number.isInteger(n) && n >= 1 && n <= CUE_COUNT ? n : null
}
