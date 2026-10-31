import { CUE_COUNT } from './config.js'

export function getVariables() {
	const variables = {
		current_cue: { name: 'Current Cue Number' },
		current_cue_name: { name: 'Current Cue Name' },
	}
	for (let i = 1; i <= CUE_COUNT; i++) {
		variables[`cue_name_${i}`] = { name: `Cue ${i} Name` }
	}
	return variables
}
