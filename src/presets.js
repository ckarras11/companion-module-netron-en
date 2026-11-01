import { combineRgb } from '@companion-module/base'
import { CUE_COUNT } from './config.js'

export function getPresets(self) {
	const presets = {}
	const ids = []

	for (let i = 1; i <= CUE_COUNT; i++) {
		const id = `runCue_${i}`
		const cueName = self.cueNames?.[i - 1]
		ids.push(id)
		presets[id] = {
			type: 'simple',
			name: cueName && cueName !== `Cue ${i}` ? `${i}: ${cueName}` : `Run Cue ${i}`,
			keywords: cueName ? [cueName] : undefined,
			style: {
				text: `$(${self.label}:cue_name_${i})`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 0, 0),
			},
			steps: [
				{
					down: [{ actionId: 'runCue', options: { cueNumber: i, resendEthernet: true } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'currentCue',
					options: { cueNumber: i },
					style: {
						color: combineRgb(255, 255, 255),
						bgcolor: combineRgb(255, 0, 0),
					},
				},
			],
		}
	}

	const structure = [{ id: 'cues', name: 'Cues', definitions: ids }]

	return { structure, presets }
}
