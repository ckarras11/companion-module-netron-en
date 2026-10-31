export const CUE_COUNT = 99
export const DEFAULT_CHECK_INTERVAL_S = 10

export function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This module will control the Netron EN series.',
		},
		{
			type: 'textinput',
			id: 'host',
			width: 6,
			label: 'Host/IP Address',
			default: '192.168.0.1',
		},
		{
			type: 'static-text',
			id: 'checkInfo',
			width: 12,
			label: 'Status updates',
			value:
				'Buttons update instantly when a cue is run from Companion, and the device is checked briefly afterwards to confirm. ' +
				'The background check picks up cues run from elsewhere (wall panel, web page). The device is easily overloaded, so keep this slow. Set to 0 to disable.',
		},
		{
			type: 'number',
			label: 'Background check interval (seconds)',
			id: 'checkInterval',
			width: 4,
			min: 0,
			max: 300,
			default: DEFAULT_CHECK_INTERVAL_S,
			asInteger: true,
			clampValues: true,
		},
		{
			type: 'checkbox',
			id: 'verbose',
			label: 'Enable Verbose Logging',
			default: false,
		},
	]
}
