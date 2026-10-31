import NetronENInstance from '../../src/main.js'
import { TIMINGS } from '../../src/timings.js'

/** Production timings, so tests can restore them */
export const PRODUCTION_TIMINGS = { ...TIMINGS }

/**
 * Shrink all timings so tests run fast. Ratios are kept roughly the same as
 * production so the scheduling behaviour is equivalent.
 */
export function useFastTimings(overrides = {}) {
	Object.assign(TIMINGS, {
		requestTimeoutMs: 300,
		confirmChecks: 2,
		confirmDelayMs: 50,
		minRetryMs: 50,
		maxRetryMs: 400,
		cueListRefreshMs: 500,
		checkIntervalUnitMs: 50, // "checkInterval: 10" in config → 500ms
		...overrides,
	})
}

export function restoreTimings() {
	Object.assign(TIMINGS, PRODUCTION_TIMINGS)
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until `fn()` is truthy, or fail after `timeoutMs` */
export async function waitFor(fn, { timeoutMs = 3000, intervalMs = 10, message = 'condition' } = {}) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await fn()) return
		await wait(intervalMs)
	}
	throw new Error(`Timed out waiting for ${message}`)
}

/**
 * Create a module instance wired to a fake Companion host that records
 * everything the module tells Companion.
 */
export function createInstance() {
	const host = {
		label: 'netron',
		variables: {},
		variableDefinitions: null,
		actions: null,
		feedbacks: null,
		presets: null,
		presetStructure: null,
		/** @type {string[]} */
		statuses: [],
		/** @type {{ level: string, message: string }[]} */
		logs: [],
		/** currentCue value each time feedbacks were re-checked */
		feedbackChecks: [],
		get status() {
			return this.statuses.at(-1)
		},
		logsAt(level) {
			return this.logs.filter((l) => l.level === level).map((l) => l.message)
		},
	}

	const context = {
		_isInstanceContext: true,
		id: 'test',
		label: host.label,
		upgradeScripts: [],
		updateStatus: (status) => {
			if (host.statuses.at(-1) !== status) host.statuses.push(status)
		},
		setActionDefinitions: (actions) => (host.actions = actions),
		setFeedbackDefinitions: (feedbacks) => (host.feedbacks = feedbacks),
		setVariableDefinitions: (defs) => (host.variableDefinitions = defs),
		setVariableValues: (values) => Object.assign(host.variables, values),
		setPresetDefinitions: (structure, presets) => {
			host.presetStructure = structure
			host.presets = presets
		},
		checkFeedbacks: () => host.feedbackChecks.push(instance.currentCue),
	}
	// Any other host call the module makes is a harmless no-op
	const proxy = new Proxy(context, { get: (target, key) => (key in target ? target[key] : () => {}) })

	const instance = new NetronENInstance(proxy)
	instance.log = (level, message) => host.logs.push({ level, message })

	/** Invoke an action the way Companion would */
	const runAction = (actionId, options = {}) => host.actions[actionId].callback({ actionId, options })

	return { instance, host, runAction }
}
