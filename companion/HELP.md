## Netron EN

This module will allow you to control a Netron EN lighting device.

### Configuration

- Enter the IP Address of the device.
- **Background check interval (seconds)**: how often to check the device for cues run from elsewhere (wall panel, web page). Default 10 seconds; set to 0 to disable.

The EN is easily overloaded, so the module only talks to it when needed. Buttons update instantly when a cue is run from Companion, then the device is checked twice to confirm. It never sends overlapping requests, and backs off automatically if the device stops responding.

**Available actions:**

- Run Cue
- Save Cue
- Clear Cue

**Available feedback:**

- Cue [x] is Running

**Available Variables:**

- Currently Running Cue Number (`current_cue`)
- Currently Running Cue Name (`current_cue_name`)
- Name of each cue as set on the device (`cue_name_1` … `cue_name_99`)

Cue names are read from the device when the module connects, and re-read automatically if a cue is renamed.

**Note:** the device only reports the _name_ of the running cue, not its number. If two cues share the same name, the module can't tell them apart and will treat the running cue as the lower-numbered one, so give each cue a unique name for feedback and the `current_cue` variable to be accurate.

**Available Presets:**

- Run Cue [1-99] (with feedback). The button text shows the cue's name from the device.
