import { DEFAULT_CHECK_INTERVAL_S } from './config.js'

export const UpgradeScripts = [
	function () {
		// This is a placeholder that now cannot be used/removed
		return {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},

	/**
	 * v2: replace constant polling (`polling` + `pollingRate` in ms) with an
	 * on-demand model and a slow background check (`checkInterval` in seconds).
	 * Old fast polling rates are intentionally not carried over, as they were
	 * what overloaded the device.
	 */
	function (_context, props) {
		const config = props.config
		if (!config) return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }

		const { polling, pollingRate: _pollingRate, ...rest } = config
		return {
			updatedConfig: {
				...rest,
				checkInterval: polling === false ? 0 : DEFAULT_CHECK_INTERVAL_S,
			},
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
]
