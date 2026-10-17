# RESCUE Flight Lab

Developer: Saeed Nik. Native Windows SITL based on **ArduPlane 4.6.3**.

RESCUE is a compiled flight mode and supervisor. It warns during qualifying descent, takes control below the configured height, uses the existing TECS energy controller to recover toward 200 m Home, and offers a five-second pilot handover window before requesting the native parachute. The local English web panel displays native telemetry and recorded decision evidence. QGroundControl can fly the simulator directly from a disarmed runway start.

## Download and run

The complete Windows package is distributed through [Releases](https://github.com/saeednikakhtar/rescue-flight-lab/releases). It includes the simulator binary/DLLs, Python runtime, Python dependencies, panel, two executable launchers and the official QGroundControl 5.1.5 installer. Download and extract the complete archive before running a launcher.

- **QGC-Manual-Ground.exe** starts a fresh disarmed runway session at 1x in QGC, without automatic takeoff or a scripted scenario.
- **RESCUE-Flight-Lab.exe** opens the local panel, QGC and an automatic 240 m demonstration.

The panel is `http://127.0.0.1:8765/`. QGC's named RESCUE SITL link listens on UDP 14551 and sends to `127.0.0.1:14560`. The relay receives native vehicle telemetry on 14555. Only one local service should run at a time. See [startup instructions](app/START_HERE_FA.md) and [QGC connections](app/QGROUND_CONTROL.md).

The PC SITL executable is not a Pixhawk flash image. No physical-controller or real-parachute qualification is claimed.

## Requirements and current behavior

The original acceleration path uses gravity-compensated downward acceleration above 5 m/s² during confirmed descent, warning below 200 m Home and automatic RESCUE below 100 m. Continuous descent requires at least one second and two metres of measured height loss, followed by a 0.2 s qualification dwell. Normal takeoff, climb and short transients are covered by separate regressions.

The current implementation deliberately adds a steady-descent safeguard below 100 m Home when confirmed sink and a short predicted time to the Home datum indicate danger. Verified braking and one bounded pull-out grace can suppress this additional path. Optional deliberate fresh stick/throttle input can acknowledge stabilized handover. **These are disclosed extensions to the brief's acceleration-only trigger and mode-change acknowledgment.** See the [current implementation and all 26 custom parameters](app/README.md) and [correction report](evidence/LOW_HEIGHT_FIX_REPORT.md).

## Evidence

The exact supplied firmware passed **22 unique native SITL cases**: 14 engineering regressions and eight flights covering the seven requested acceptance scenarios. MANUAL and AUTO capture are separate flights. The [verification record](evidence/low-height-verification.json) identifies the exact binary hash and retained timeout/repeat. [Original acceptance BIN files](evidence/bin) and [their checked transitions](evidence/acceptance.json) are included.

These flights use repeatable standard MAVLink stimuli with native aircraft dynamics. Actual desktop QGC input was checked separately. The requested complete ten-case attended QGC campaign remains incomplete. The complete download retains the original recordings and the explicit desktop-trial status. Packaging also passed a separate relocated-runtime/native-ground smoke test.

Firmware SHA-256:

`4bfa07c8b3f1febac6045f91058c5eab49b57801fd45eec16702940c54c2fe66`

## Source and reproduction

- [firmware/rescue.patch](firmware/rescue.patch): all changes against pinned base commit `3fc7011a7d3dc047cbb17d8bd98ee94577d144c6`, tag `Plane-4.6.3`.
- [firmware/modified-source](firmware/modified-source): the 30 modified firmware files, including mode integration, TECS reset integration, logging and the progressive native canopy model.
- [parameters/rescue.parm](parameters/rescue.parm): complete tested model profile. The firmware's RSC_ENABLE default is 0; the test profile sets it to 1.
- [app](app): panel, relay, report parser, launchers and editable 3D-scene sources.
- [app/developer](app/developer): repeatable native acceptance and regression harnesses.

The complete release includes a compressed archive of the full tracked firmware source and initialized SITL build modules, with exact revision metadata and original build logs. Native compilation used Cygwin x64/GCC 14.4.0. Runtime dependencies and the development compiler are separate. The existing TECS, attitude controllers and AP_Parachute remain responsible for flight control and release.

## License

ArduPilot-derived work is GPLv3 or later. Preserve [COPYING.txt](COPYING.txt), [MAVLink notices](MAVLINK_COPYING.txt) and [third-party provenance](THIRD_PARTY.txt). The local landscape/airframe is an illustrative visualization driven by native simulator telemetry, not a validated terrain or airframe model.
