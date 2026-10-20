# Start RESCUE Flight Lab

Developer: Saeed Nik. Windows delivery 3.0.2, 20 October 2026.
Flight firmware: the verified RESCUE 3.0.1 build of ArduPlane 4.6.3.

## Automatic preparation

Download RESCUE-Setup.exe from the v3.0.2 GitHub release and run it.
It downloads the complete delivery, checks its SHA-256, extracts it to a writable
per-user folder and opens the application. Internet is needed for this first download.
Python, its dependencies and the simulator DLLs are included; a separate Python installation is not needed.
The small executables inside GitHub's source ZIP use the same automatic preparation.

## Full offline delivery

Extract the ENTIRE RESCUE-Delivery-English-3.0.2-20261020.zip first.
Keep the 03_SITL folder and its runtime, pydeps and bin folders in place.
Do not run a launcher inside a compressed-folder preview or copy an EXE alone.

- QGC-Manual-Ground.exe (or Start-Manual.cmd) starts a fresh disarmed aircraft on the runway at 1x. Take off and fly manually in QGC. Reopening it resets the simulated flight.
- RESCUE-Flight-Lab.exe (or Start-Panel.cmd) opens the web panel, QGC and the automatic 240 m demonstration.
- Open-Presentation.cmd opens the English presentation offline.

The same launchers also exist inside 03_SITL. Both locations work.
On a new PC, first install QGroundControl using
03_SITL/installers/QGroundControl-5.1.5-AMD64.exe, then close QGC before the first launch.
The launcher backs up the existing QGC settings and prepares the RESCUE SITL connection.
If QGC is already installed, it is reused.

## Connecting

Panel: http://127.0.0.1:8765/. QGC listens on UDP 14551 and sends to
127.0.0.1:14560. Native vehicle telemetry arrives at the relay on 14555.
A stopped simulator has no heartbeat. Start a flight before reconnecting.
Use Reconnect in the panel, or disconnect and reconnect the saved RESCUE SITL link in QGC.
Restarting the simulator after a parachute landing repacks the modeled canopy.

When opening a different extracted delivery, an older disarmed session is stopped
and its service replaced. A flying armed session is protected: finish it in the panel first.
Recordings remain in the runs folder of the package that created them.

## Controls and reports

The left virtual joystick holds throttle/yaw; the right attitude pad recenters.
TAKEOFF controls its own power. Set an appropriate throttle before changing to
MANUAL or FBWA. MANUAL does not automatically level the aircraft.
Finish & report records native telemetry, decisions, charts and the original BIN.
Only the seven requested acceptance scenarios are listed in the panel.

The PC simulator executable is not a Pixhawk flash image. Decision height is
relative to Home; it is not a measured terrain clearance.
