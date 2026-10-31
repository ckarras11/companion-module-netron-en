import { combineRgb } from '@companion-module/base'
import { cueNumberOption, parseCueNumber } from './options.js'

export function getFeedbacks(self) {
	return {
		currentCue: {
			type: 'boolean',
			name: 'Change colors if X is the current cue',
			description: 'Sets the background according to the current cue',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(255, 0, 0),
			},
			options: [cueNumberOption(self)],
			callback: (feedback) => self.currentCue === parseCueNumber(feedback.options.cueNumber),
		},
	}
}
