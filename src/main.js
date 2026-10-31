import { InstanceBase, InstanceStatus } from '@companion-module/base'

import { getConfigFields, CUE_COUNT, DEFAULT_CHECK_INTERVAL_S } from './config.js'
import { NetronClient, parseHost } from './device.js'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import { getVariables } from './variables.js'
import { getPresets } from './presets.js'
import { UpgradeScripts } from './upgrades.js'
import { TIMINGS } from './timings.js'

export { UpgradeScripts }

export default class NetronENInstance extends InstanceBase {
	config = {}

	currentCue = 0
	currentCueName = ''
	/** Cue names from Cues.json; index 0 is cue 1. null until first loaded. */
	cueNames = null

	/** @type {NetronClient | null} */
	#client = null
	#cueNamesFetchedAt = 0
	#checkTimer = null
	#checkInFlight = false
	#generation = 0
	#consecutiveFailures = 0
	#confirmChecksRemaining = 0
	/** Incremented when a command starts, so in-flight check results from before it are ignored */
	#commandSeq = 0

	async init(config) {
		await this.configUpdated(config)
	}

	async configUpdated(config) {
		// Tear everything down first so a config change can never leave a
		// second check loop or client running alongside the new one.
		this.#stop()

		this.config = config
		const validHost = parseHost(config.host) !== null
		this.#client = validHost ? new NetronClient(config.host, { timeoutMs: TIMINGS.requestTimeoutMs }) : null
		this.currentCue = 0
		this.currentCueName = ''
		this.cueNames = null
		this.#cueNamesFetchedAt = 0
		this.#consecutiveFailures = 0
		this.#confirmChecksRemaining = 0

		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		this.setVariableDefinitions(getVariables())
		this.#updatePresets()
		this.#publishState()

		if (!validHost) {
			this.log('warn', `Invalid Host/IP Address "${config.host ?? ''}"`)
			this.updateStatus(InstanceStatus.BadConfig, 'Enter the IP address of the EN')
			return
		}

		// One check on startup to get the current cue, cue names and connection status
		this.updateStatus(InstanceStatus.Connecting)
		this.#scheduleCheck(0)
	}

	async destroy() {
		this.#stop()
		this.log('debug', 'destroy')
	}

	getConfigFields() {
		return getConfigFields()
	}

	// ---- Commands (called from actions) ----

	async runCue(cueNumber, resendEthernet) {
		this.log('info', `Running cue ${cueNumber}`)
		await this.#optimistic(cueNumber, this.cueNames?.[cueNumber - 1] ?? `Cue ${cueNumber}`, () =>
			this.#command('Run Cue', (client) => client.runCue(cueNumber, resendEthernet)),
		)
	}

	async saveCue(cueNumber) {
		this.log('info', `Saving cue ${cueNumber}`)
		await this.#command('Save Cue', (client) => client.saveCue(cueNumber))
	}

	async clearCue() {
		this.log('info', 'Clearing cue')
		await this.#optimistic(0, '', () => this.#command('Clear Cue', (client) => client.clearCue()))
	}

	/** Update buttons immediately, and roll back if the command fails */
	async #optimistic(cue, name, send) {
		if (!this.#client) return send() // not configured: nothing to update
		const previous = { cue: this.currentCue, name: this.currentCueName }
		this.#setCurrentCue(cue, name)
		const ok = await send()
		if (!ok && this.currentCue === cue && this.currentCueName === name) {
			this.#setCurrentCue(previous.cue, previous.name)
		}
	}

	/** Send a command, then briefly check the device to confirm the result */
	async #command(label, fn) {
		const client = this.#client
		if (!client) {
			this.log('warn', `Cannot send ${label}: no valid Host/IP Address configured`)
			return false
		}
		this.#commandSeq++
		try {
			await fn(client)
			if (client !== this.#client) return false
			this.updateStatus(InstanceStatus.Ok)
			return true
		} catch (e) {
			if (client !== this.#client) return false
			this.log('error', `Error sending ${label} command: ${e.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, e.message)
			return false
		} finally {
			if (client === this.#client) {
				this.#confirmChecksRemaining = TIMINGS.confirmChecks
				// If a check is already running, it will schedule the confirm when it finishes
				if (!this.#checkInFlight) this.#scheduleCheck(TIMINGS.confirmDelayMs)
			}
		}
	}

	// ---- Status checks ----

	/**
	 * There is only ever one check timer and at most one check in flight, so
	 * requests can never stack up. The next check is scheduled when the
	 * previous one finishes:
	 *  - device unreachable  → retry with exponential backoff until it's back
	 *  - just sent a command → quick confirm checks
	 *  - otherwise           → slow background check, or nothing if disabled
	 */
	#scheduleNextCheck() {
		if (this.#consecutiveFailures > 0) {
			this.#scheduleCheck(Math.min(TIMINGS.maxRetryMs, TIMINGS.minRetryMs * 2 ** (this.#consecutiveFailures - 1)))
		} else if (this.#confirmChecksRemaining > 0) {
			this.#scheduleCheck(TIMINGS.confirmDelayMs)
		} else {
			const intervalS = Number(this.config.checkInterval ?? DEFAULT_CHECK_INTERVAL_S)
			if (intervalS > 0) this.#scheduleCheck(intervalS * TIMINGS.checkIntervalUnitMs)
		}
	}

	#scheduleCheck(delayMs) {
		if (this.#checkTimer) clearTimeout(this.#checkTimer)
		const generation = this.#generation
		this.#checkTimer = setTimeout(async () => {
			this.#checkTimer = null
			if (generation !== this.#generation) return

			this.#checkInFlight = true
			try {
				await this.#checkOnce()
			} finally {
				// A config change mid-check starts a new loop; don't clobber its flag
				if (generation === this.#generation) this.#checkInFlight = false
			}

			if (generation !== this.#generation) return
			// A command may have scheduled a confirm check while we were busy
			if (!this.#checkTimer) this.#scheduleNextCheck()
		}, delayMs)
	}

	#stop() {
		this.#generation++
		this.#checkInFlight = false
		if (this.#checkTimer) {
			clearTimeout(this.#checkTimer)
			this.#checkTimer = null
		}
		if (this.#client) {
			this.#client.destroy()
			this.#client = null
		}
	}

	async #checkOnce() {
		const client = this.#client
		if (!client) return
		const commandSeq = this.#commandSeq

		try {
			const data = await client.getCuesStatus()
			if (client !== this.#client) return

			if (this.#consecutiveFailures > 0) {
				this.log('info', 'Connection to device restored')
				// Cues may have been edited while we were disconnected: force a reload
				this.#cueNamesFetchedAt = 0
			}
			this.#consecutiveFailures = 0
			this.updateStatus(InstanceStatus.Ok)

			// A command was sent while this check was in flight, so this result shows the
			// state from *before* the command. Ignore it; a confirm check follows.
			if (commandSeq !== this.#commandSeq) return
			if (this.#confirmChecksRemaining > 0) this.#confirmChecksRemaining--

			const name = typeof data?.CueRunningName === 'string' ? data.CueRunningName : ''

			// Load the cue list the first time, after a reconnect, or when the running
			// cue's name isn't in it (a cue was renamed). Rate-limited, as it's ~10KB.
			const unknownName = name !== '' && !this.cueNames?.includes(name)
			const due = Date.now() - this.#cueNamesFetchedAt > TIMINGS.cueListRefreshMs
			if ((this.cueNames === null || unknownName) && due) {
				await this.#loadCueNames(client)
				if (client !== this.#client || commandSeq !== this.#commandSeq) return
			}

			this.#setCurrentCue(this.#resolveCueNumber(name), name)
		} catch (e) {
			if (client !== this.#client) return

			this.#consecutiveFailures++
			// Only log the first failure of a streak to avoid flooding the log
			if (this.#consecutiveFailures === 1) {
				this.log('error', `Error checking device status: ${e.message}. Will keep retrying.`)
			} else if (this.config.verbose) {
				this.log('debug', `Status check failed (${this.#consecutiveFailures} in a row): ${e.message}`)
			}
			this.updateStatus(InstanceStatus.ConnectionFailure, e.message)
		}
	}

	async #loadCueNames(client) {
		this.#cueNamesFetchedAt = Date.now()
		let names
		try {
			names = await client.getCueNames()
		} catch (e) {
			this.log('warn', `Could not load cue list: ${e.message}`)
			return
		}
		if (client !== this.#client) return
		if (this.config.verbose) this.log('debug', `Loaded ${names.length} cue names`)

		const changed = JSON.stringify(names) !== JSON.stringify(this.cueNames)
		this.cueNames = names
		if (changed) {
			// Cue names appear in variables, preset labels and the action/feedback cue pickers
			this.#publishCueNames()
			this.setActionDefinitions(getActions(this))
			this.setFeedbackDefinitions(getFeedbacks(this))
			this.#updatePresets()
		}
	}

	/**
	 * CuesStatus.json only reports the running cue's *name*, and cues can be
	 * renamed on the device, so map name → number using the cue list.
	 */
	#resolveCueNumber(name) {
		if (!name) return 0

		const index = this.cueNames?.indexOf(name) ?? -1
		if (index !== -1) return index + 1

		// Fallback for default-named cues if the cue list is unavailable
		const match = /^Cue\s+(\d+)$/.exec(name)
		return match ? parseInt(match[1], 10) : 0
	}

	// ---- Publishing state to Companion ----

	#setCurrentCue(cue, name) {
		if (cue === this.currentCue && name === this.currentCueName) return
		this.currentCue = cue
		this.currentCueName = name
		this.#publishState()
	}

	#publishState() {
		this.setVariableValues({
			current_cue: this.currentCue,
			current_cue_name: this.currentCueName,
		})
		this.checkFeedbacks('currentCue')
	}

	#publishCueNames() {
		const values = {}
		for (let i = 1; i <= CUE_COUNT; i++) {
			values[`cue_name_${i}`] = this.cueNames?.[i - 1] ?? ''
		}
		this.setVariableValues(values)
	}

	#updatePresets() {
		const { structure, presets } = getPresets(this)
		this.setPresetDefinitions(structure, presets)
	}
}
