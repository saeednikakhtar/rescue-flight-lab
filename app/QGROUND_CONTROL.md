# QGroundControl integration — release 3.0.1

QGroundControl 5.1.5 is supplied as its original official Windows installer in installers/. Its SHA-256 is 5c3435932446461f5bee5b6d2fe9ef977ca9b471eeb894e26e6b9209f09d0374. Source release: https://github.com/mavlink/qgroundcontrol/releases/tag/v5.1.5 . Installation is required once on a new PC; it is already installed on the development PC.

## Manual operation

Run QGC-Manual-Ground.exe after extracting every file. This starts native SITL disarmed on the Alferevo runway at 1x, opens QGC and connects its named RESCUE SITL link. There is no automatic arm, takeoff, panel window or scenario. Reopening this launcher resets the simulation. The optional web panel is http://127.0.0.1:8765/ . Finish & report closes a trial and makes its recording available in Flight reports.

RESCUE-Flight-Lab.exe is the separate automatic 240 m demonstration plus web-panel launcher. Both executables use the included runtime/python.exe and bin/arduplane.exe. They do not require Codex. QGC is located in the standard per-user or Program Files installation directories. launch-qgc.ps1 is an optional wrapper: its default is manual ground; -StartFlight selects the automatic demonstration. launch.ps1 runs only the foreground web service for debugging.

Close QGC before first launch to configure its connection. Existing settings are backed up once to QGroundControl.ini.rescue-v2.backup in the user's roaming QGroundControl folder. The named link is preserved alongside other user-defined links. Direct Pixhawk and generic UDP autoconnect are disabled for this PC SITL workflow. No physical-controller firmware or parameters are changed.

QGC listens on UDP 14551 and sends commands to 127.0.0.1:14560. The persistent relay receives original vehicle MAVLink bytes on UDP 14555 and routes GCS replies to the current simulator process. The web service controls/observes its native PC vehicle over local TCP 5800. Vehicle system ID is 2. These ports bind only to loopback. Only one copy of the service should run at a time; close the old service before changing extracted releases.

## Joystick and takeover

The tested 5.1.5 profile uses virtualJoystick=true, virtualJoystickAutoCenterThrottle=false and virtualJoystickLeftHandedMode=false: left throttle/yaw with non-centering throttle, right attitude pad with recentering. The panel sends no idle RC overrides in manual ground sessions. TAKEOFF supplies its own power; MANUAL and FBWA immediately use the pilot throttle position. Prepare that throttle before switching modes. MANUAL does not stabilize attitude.

Once RESCUE declares stable recovery, an explicit mode change acknowledges the pilot. With RSC_STK_EN=1, fresh mapped stick/throttle changes of at least 120 us for 0.3 s also acknowledge and select FBWA. An unchanged held input is not a new response. Without response within five simulated seconds, the native parachute is requested, the motor is cut and the vehicle disarms. Ground-level Not Ready / Chute is released is the chute rearm guard; start a fresh simulation to repack it.

## Reconnect

Use Reconnect in the panel while a native flight is running. A stopped simulator has no vehicle heartbeat; start a new flight first. If QGC retains Comms Lost after a full service restart, use Disconnect, then reconnect the saved RESCUE SITL link. Closing QGC and reopening the launcher also reloads the saved link; the manual launcher creates a new flight. Ordinary flight resets reuse the relay endpoint. Neither a disarm message nor a deployed parachute alone means transport has failed.

## Custom mode and verification

The experimental pinned 4.6.3 firmware uses mode 26 for RESCUE and publishes AVAILABLE_MODES/AVAILABLE_MODES_MONITOR with the actual name and NOT_USER_SELECTABLE property. A stock QGC static table can otherwise call mode 26 AUTOLAND. RESCUE is entered by its supervisor, not by a menu shortcut. Installing an ordinary upstream vehicle firmware would replace these modifications.

Current firmware evidence is low-height-verification.json and LOW_HEIGHT_FIX_REPORT.md: 22 unique native cases, including eight flights covering seven acceptance scenarios. Actual desktop QGC input is documented separately in low-height-review/qgc-desktop-trial.json. That trial was not a passed complete rescue flight; the requested ten-case attended QGC campaign remains incomplete. A separate checkpoint --hold runner was verified to select LOITER at a bounded endpoint. These statements do not equate repeatable MAVLink test stimuli with mouse-flown QGC testing.
