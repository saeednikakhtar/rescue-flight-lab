# Start RESCUE Flight Lab

Developer: Saeed Nik. English delivery, 19 October 2026. Native ArduPlane 4.6.3 SITL, software 3.0.1.

1. Extract the entire ZIP to a writable folder. Keep every runtime dependency beside the launchers.
2. On a new Windows x64 PC, install QGroundControl once using installers/QGroundControl-5.1.5-AMD64.exe. Python and simulator DLLs are bundled.
3. Close QGC before the first launch so the launcher can prepare the named RESCUE SITL link. Existing settings are backed up once.
4. Run QGC-Manual-Ground.exe for a fresh disarmed runway session at 1x. Arm, take off and fly directly in QGC. No automatic takeoff or scripted dive is started. Reopening this launcher resets the simulation.
5. Run RESCUE-Flight-Lab.exe for the local web panel, QGC and the automatic 240 m demonstration.
6. Open http://127.0.0.1:8765/ to inspect a running manual flight. Select Finish & report to end a trial and inspect its recording.

## Connect or reconnect

QGC's named RESCUE SITL link listens on UDP 14551 and sends to 127.0.0.1:14560. The relay receives the native vehicle on 14555. Only one background service may use the local ports at a time; close the older service before changing extracted releases.

A stopped simulator has no vehicle heartbeat: start a new flight first. Use Reconnect in the panel for a running flight. After a full service restart, if QGC retains Comms Lost, select Disconnect and reconnect the saved RESCUE SITL link. Disarm or parachute deployment alone is not a transport failure.

## Manual controls and rescue

The launcher enables QGC's virtual joystick with a non-centering left throttle/yaw pad and a recentering right attitude pad. TAKEOFF controls its own power. Before switching to MANUAL or FBWA, set a suitable pilot throttle: those modes immediately use its position. MANUAL does not level the wings automatically.

After confirmed stable recovery, change to a valid mode within five simulated seconds. Optional deliberate fresh stick/throttle acknowledgment selects FBWA; RSC_STK_EN=0 retains mode-change-only behavior. Without a valid response, the native parachute is requested, the motor is cut and the vehicle disarms. Start a fresh simulation to repack the modeled canopy.

## Inspect evidence

The panel offers only the seven requested acceptance scenarios. MANUAL and AUTO capture use separate flights. Flight reports show native event time, Home height, acceleration, sink, reason bits and location. Export the original BIN and report for review. Manual recordings remain Recorded until the evidence has been checked.

README.md explains all 26 custom parameters and the disclosed steady-descent and stick-acknowledgment extensions. The English response is in docs/RESCUE_Response_EN_3.0.1.docx. The parent delivery contains the English web presentation.

The supplied executable is a PC SITL build. It is not a Pixhawk flash image. Home-relative decision height is not measured terrain clearance.
