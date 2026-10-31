import { cueNumberOption, parseCueNumber } from './options.js'

export function getActions(self) {
	const cueFrom = (event) => {
		const cue = parseCueNumber(event.options.cueNumber)
		if (cue === null) {
			self.log('warn', `Ignoring ${event.actionId}: invalid cue number "${event.options.cueNumber}"`)
		}
		return cue
	}

	return {
		runCue: {
			name: 'Run Cue',
			options: [
				cueNumberOption(self),
				{
					type: 'checkbox',
					label: 'Resend Ethernet',
					id: 'resendEthernet',
					default: true,
				},
			],
			callback: async (event) => {
				const cue = cueFrom(event)
				if (cue !== null) await self.runCue(cue, !!event.options.resendEthernet)
			},
		},
		saveCue: {
			name: 'Save Cue',
			options: [cueNumberOption(self)],
			callback: async (event) => {
				const cue = cueFrom(event)
				if (cue !== null) await self.saveCue(cue)
			},
		},
		clearCue: {
			name: 'Clear Cue',
			options: [],
			callback: async () => {
				await self.clearCue()
			},
		},
	}
}
