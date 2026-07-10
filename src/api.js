const { InstanceStatus } = require('@companion-module/base')

const Client  = require('node-rest-client').Client;

module.exports = {
	startPolling() {
		if (this.config.polling) {
			this.INTERVAL = setInterval(this.getCurrentCue.bind(this), this.config.pollingRate);
			this.updateStatus(InstanceStatus.Connecting);
		}
		else {
			this.updateStatus(InstanceStatus.Ok); //mark it ok because we really don't know if it's ok or not until an action is sent
		}
	},

	stopPolling() {
		if (this.INTERVAL !== undefined) {
			clearInterval(this.INTERVAL);
			delete this.INTERVAL;
		}
	},

	getCurrentCue() {
		let self = this;

		let args = {
			//headers: { "Content-Type": "application/x-www-form-urlencoded" }
		};
		
		let client = new Client();
	
		client.get('http://' + this.config.host + '/CuesStatus.json', function (data, response) {	
			if (data && data.CueRunningName) {
				self.CURRENT_CUE_NAME = data.CueRunningName;
				if (data.CueRunningName.indexOf('Cue ') > -1) {
					self.CURRENT_CUE = parseInt(data.CueRunningName.replace('Cue ',''));
				}
				else {
					self.CURRENT_CUE = 0;
				}
				self.checkVariables();
				self.checkFeedbacks();
				self.updateStatus(InstanceStatus.Ok);
			}
		}.bind(self)).on('error', function(error) {
			self.updateStatus(InstanceStatus.Error);
			self.log('error', 'Error Getting Current Cue: ' + error.toString());
			if  (self.INTERVAL !== undefined) {
				self.log('debug', 'Stopping Polling...');
				self.stopPolling();
			}
		}.bind(self));
	},

	sendRunCueCommand(cmd) {
		this.log('info', 'Running Cue ' + cmd.RunCue);
		
		let args = {
			data: cmd,
			headers: { "Content-Type": "application/x-www-form-urlencoded" }
		};
	
		let client = new Client();
	
		client.post('http://' + this.config.host + '/run_cues', args, function (data, response) {
			//do something with response
		}.bind(this)).on('error', function(error) {
			this.log('error', 'Error Sending Run Cue Command ' + error.toString());
		}.bind(this));
	},

  sendSaveCueCommand(cmd) {
		this.log('info', 'Saving Cue ' + cmd.CueNum);

		let args = {
			data: cmd,
			headers: { "Content-Type": "application/x-www-form-urlencoded" }
		};
	
		let client = new Client();
	
		client.post('http://' + this.config.host + '/save_cues', args, function (data, response) {
			//do something with response
		}.bind(this)).on('error', function(error) {
			this.log('error', 'Error Sending Save Cue Command ' + error.toString());
		}.bind(this));
	},
	
	sendClearCueCommand() {
		let cmd = {
			CueResendEth: 1,
			RunCue: 0,
			EndFlag: 1
		};

		let args = {
			data: cmd,
			headers: { "Content-Type": "application/x-www-form-urlencoded" }
		};
	
		let client = new Client();
	
		client.post('http://' + this.config.host + '/run_cues', args, function (data, response) {
			//do something with response
		}.bind(this)).on('error', function(error) {
			this.log('error', 'Error Sending Clear Cue Command ' + error.toString());
		}.bind(this));
	}
}