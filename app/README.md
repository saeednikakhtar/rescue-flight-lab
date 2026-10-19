# RESCUE Flight Lab 3.0.1

Developer: Saeed Nik. Base: ArduPlane 4.6.3 native Windows SITL.

## Start the supplied Windows package

Extract the entire ZIP into a writable folder, such as Documents/RESCUE. Keep all files together; do not run an executable from inside the ZIP.

- **QGC-Manual-Ground.exe**: fresh disarmed aircraft on the runway at 1x. Fly it yourself in QGroundControl; no automatic takeoff or scenario is started. Reopening this launcher resets the current simulation.
- **RESCUE-Flight-Lab.exe**: local web panel, QGroundControl and the automatic 240 m demonstration. Use the panel's Manual test workspace to switch to a new ground session.
- If QGroundControl is not installed, first run **installers/QGroundControl-5.1.5-AMD64.exe**. Python, native SITL and runtime DLLs are already included. Codex and a Python installation are not required to run the package.

Close QGroundControl before the first launch so the named RESCUE SITL link and virtual joystick profile can be configured. The launcher backs up existing QGC settings once. A running QGC is reused. Close an older RESCUE background service before using a different extracted release: only one service can use the local ports at a time. The new package does not install or flash firmware on a physical controller.

Open http://127.0.0.1:8765/ to inspect an active manual flight and its reports. The panel is optional for flying in QGC. See START_HERE.md for English startup instructions and RELEASE_CONTENTS.md for the evidence index.

## 1. Context and objective

RESCUE is compiled into the flight firmware as mode 26. The local service provides simulation lifecycle, logging and MAVLink transport; the panel is optional for manual QGroundControl operation.

## 2. General behavior

The version 3 panel is at `http://127.0.0.1:8765/`. Select **Manual test**, then **Start manual test**. A fresh native SITL vehicle starts disarmed on the Alferevo runway at real-time speed, and QGroundControl opens/connects. Arm, take off and fly in QGC. The panel does not send idle stick overrides or automated dive commands in this mode. Select **Finish & report** when the trial is over.

**Guided test** retains the automatic 240 m launch and rescue exercises. **Acceptance tests** contains only the seven requested scenarios; source-mode capture is checked in separate MANUAL and AUTO flights.

**Flight reports** keeps completed manual, guided and acceptance recordings. Select an event to inspect its native time, Home-relative height, down acceleration, sink and logged position on synchronized charts and the flight path. **Focus event** zooms the charts; **Full flight** restores the complete interval. The chart cursor also works with the arrow keys. Reports include the reason for capture, stability, handover and parachute decisions, plus clearly identified analysis observations when fast descent did not meet the entry condition. **Review flight** can inspect a read-only snapshot while SITL continues running.

Reports are saved as `runs/<session>/report.json` beside the original `logs/*.BIN`, telemetry and messages. Export the report or download **BIN & evidence** from the report toolbar. Manual recordings are labelled **Recorded**, rather than acceptance passes. A recorded hard ground impact takes precedence over a subsequent recovery. Charts may be thinned while preserving event neighborhoods and global extrema; the original BIN remains available.

Start QGC-Manual-Ground.exe for a new disarmed vehicle on the ground at 1x. This launcher does not arm, take off, open the panel or run a scenario. It sends no idle stick overrides. Reopening it resets the current simulation. Use QGroundControl for pilot commands. The separate RESCUE-Flight-Lab.exe retains the automatic 240 m demonstration workflow.

TAKEOFF controls power automatically. When switching to MANUAL or FBWA, the virtual joystick's throttle position immediately owns power; TAKEOFF power is not retained. Set an appropriate throttle before that transition. FBWA stabilizes attitude, while MANUAL directly commands the control surfaces and does not hold wings level when the stick is released.

The saved RESCUE SITL link listens on UDP 14551 and sends to 127.0.0.1:14560. The local relay receives the native vehicle on UDP 14555. The official QGroundControl installer is included under installers/; install it once if needed. After a full background-service restart, if QGC retains Comms Lost, click Disconnect and then the Disconnected bar to connect the new vehicle. Ordinary simulation resets keep the relay running.

Below 200 m relative to Home, sustained qualifying falling produces a WARNING message about once per second without changing the flight mode. Below 100 m, continued qualifying falling automatically captures RESCUE, provided the aircraft is armed, flying and has a usable parachute. On stabilization at the recovery target, the pilot has five simulation seconds to change mode. No response requests the native parachute, motor cut and disarm.

## 3. Parameters

Only the 26 parameters added by this implementation are documented here. The .parm file also contains existing simulator/model settings needed to reproduce the flights. Firmware RSC_ENABLE defaults to 0; the test profile sets it to 1.

| Parameter | Test value | Unit | Function |
|---|---:|---|---|
| RSC_ENABLE | 1 | 0/1 | Enable the supervisor. Firmware default is 0; the test profile sets 1. |
| RSC_ALT_WARN | 200 | m Home | Warning height and TECS recovery target. One shared value avoids contradictory warning and target settings. |
| RSC_ALT_TRIG | 100 | m Home | Automatic capture threshold while qualifying descent continues. Armed and in-flight checks also apply. |
| RSC_ACC_Z | 5 | m/s^2 | Gravity-compensated downward acceleration for the brief’s entry path. The additional low-height impact path can act with lower acceleration; see section 4.2. |
| RSC_HAND_S | 5 | s | Pilot response window beginning at confirmed stable recovery. |
| RSC_DWELL_S | 0.2 | s | Persistence of the qualified acceleration condition. A separate fixed gate requires continuous measured descent for at least 1 s and 2 m height loss. |
| RSC_ALT_HYST | 10 | m | Height hysteresis used when clearing a warning. Limits chatter around the warning boundary. |
| RSC_SINK | 5 | m/s | Minimum sink for the additional low-height impact path. Sink alone is insufficient: confirmed descent, short crossing time and entry dwell are required. |
| RSC_UN_ANG | 60 | deg | Severe-attitude diagnostic and recovery failure threshold. Does not bypass the required acceleration at entry. |
| RSC_UN_RATE | 90 | deg/s | Rotation diagnostic and recovery failure threshold. Does not independently trigger capture. |
| RSC_TTC_S | 6 | s | Additional entry margin below ALT_TRIG during confirmed sink above RSC_SINK, unless actual braking predicts stopping above 5 m Home. This is an explicit extension to the acceleration rule. |
| RSC_STAB_S | 2 | s | Continuous time for which every stable-flight criterion must hold. |
| RSC_ALT_TOL | 5 | m | Allowed height error about the recovery target. Defines the stable height band. |
| RSC_VZ_TOL | 1 | m/s | Maximum absolute vertical speed accepted as level flight. |
| RSC_ANG_MAX | 10 | deg | Maximum absolute roll and pitch accepted as stable. |
| RSC_ST_RATE | 15 | deg/s | Maximum body rotation accepted as stable. Rejects transient zero-angle crossings. |
| RSC_RECOV_S | 90 | s | Overall deadline to achieve stable recovery, measured from capture. |
| RSC_FAIL_S | 3 | s | Persistent excessive sink or severe instability allowed after the initial recovery grace period. |
| RSC_MIN_ALT | 30 | m Home | Parachute threshold during recovery. Below this height the additional TTC entry guard also accepts sink above 2 m/s. |
| RSC_PROG_S | 10 | s | Progress window below the target region. Evaluates actual height and specific-energy-height change. |
| RSC_PROG_M | 3 | m | Minimum height gain OR equivalent total-energy-height gain in a progress window. Airspeed recovery can count. |
| RSC_IMPACT_S | 2 | s | Urgent predicted Home-datum crossing threshold during descent above 2 m/s. |
| RSC_REARM_S | 10 | s | Minimum cooldown after handover. A clear-risk interval is also required; imminent danger can override cooldown. |
| RSC_STK_EN | 1 | 0/1 | Optional deliberate-stick/throttle acknowledgment. Set 0 for mode-change-only handover. |
| RSC_STK_US | 120 | us | Required raw mapped-channel change from the stabilization baseline. Rejects small noise and unchanged held input. |
| RSC_STK_S | 0.3 | s | Continuous deliberate-input duration with valid fresh input before handover to FBWA. |

The additional settings make persistence, stable flight, recovery failure and pilot input acknowledgment explicit. They are supervisor settings; they do not replace TECS or the existing attitude controllers. Attitude or rotation alone never captures control. RSC_SINK and RSC_TTC_S jointly define the added low-height safeguard; no new parameters were introduced for this correction.

## 4. Detailed phase requirements

### 4.1 MONITOR to WARNING

The 50 Hz supervisor uses gravity-compensated earth-frame NED acceleration, filtered at 5 Hz. Positive Az and Vz in the RSC log mean DOWN. Normal upward acceleration has the opposite sign. Confirmed descent requires Vz greater than 0.5 m/s continuously for at least 1 s and at least 2 m measured altitude loss. After this gate, Az must exceed RSC_ACC_Z continuously for RSC_DWELL_S. The default threshold remains 5 m/s^2. A transient shorter than one second cannot meet the descent gate.

### 4.2 WARNING to RESCUE

The original acceleration branch is retained. A separate safeguard now captures a dangerous steady descent below 100 m Home: descent must exceed 0.5 m/s continuously for at least 1 s and lose 2 m, current sink must exceed RSC_SINK (5 m/s), or exceed 2 m/s below RSC_MIN_ALT (30 m), and Home height / sink must be below RSC_TTC_S (6 s). The condition must persist for RSC_DWELL_S (0.2 s). It is logged as risk bit 32 and a dedicated predicted-impact message. This is a deliberate extension to the brief’s acceleration-only gate, added after a real QGC flight reached 30 m Home at 7.67 m/s with Az near zero.

The safeguard yields to verified braking only when both filtered gravity-compensated acceleration and a 1 Hz filtered derivative of EKF down speed indicate upward deceleration above 1 m/s², and h − Vz²/(2 × braking) exceeds 5 m Home. A once-per-descent grace of at most 0.5 s can allow an incipient pull-out to establish this margin: either measured upward pitch rate exceeds 5 deg/s with Az below -0.5 m/s² and filtered sink acceleration below -0.25 m/s², or fresh MANUAL/FBWA input requests at least 20% nose-up with measured pitch rate above 0.5 deg/s and Az below 0.5 m/s². Height must exceed MIN_ALT and TTC must exceed IMPACT_S. It cannot be extended by held sticks or repeated pulses and does not suppress the acceleration rule. Braking clearance and grace are logged as bits 64 and 128. The short-term constant-deceleration estimate is a heuristic, not an aircraft performance guarantee. It never prevents the original acceleration rule. Normal shallow descent, climb, short transients and rotation alone do not satisfy the additional gate. All trend gates reset when descent ends or navigation sampling is interrupted. Capture remains mode-independent, including TAKEOFF. Warning clears after 0.5 s without either qualifying path.

### 4.3 RESCUE recovery

Existing TECS manages the 200 m Home height target and airspeed. Existing roll/pitch/yaw controllers level the wings. During the main climb the full available throttle floor respects existing output/power/slew limits; it is released near the target so TECS can settle. No separate recovery pitch/throttle law is added. Full throttle alone is neither proof of climb nor proof of failure: height or equivalent energy-height gain counts as progress.

On emergency entry only, the existing TECS reset seeds its pitch-demand slew state inside the configured pitch bounds. This avoids spending several seconds slewing an internal demand from a near-vertical measured dive toward a boundary that Plane already clips. Normal mode engagement keeps the original TECS reset behavior; energy control, anti-stall logic and acceleration limiting remain active.

### 4.4 STABILIZED handover

For 2 continuous seconds: altitude 200 +/- 5 m, absolute vertical speed at most 1 m/s, absolute roll/pitch at most 10 degrees, body rate at most 15 deg/s and airspeed at least the existing minimum. Then send the stabilized signal and start RSC_HAND_S. An explicit mode change is accepted. Optional fresh stick/throttle acknowledgment selects FBWA; unchanged held input, noise and stale data do not count. RSC_STK_EN=0 retains mode-change-only acknowledgment.

### 4.5 Parachute

No pilot response within 5 s requests AP_Parachute, cuts the motor and disarms. In the tested profile the release output activates after 500 ms; modeled canopy inflation takes 1.5 s. After release start a fresh simulation to repack the modeled chute.

## 5. Edge cases and safety

The takeoff false capture was traced to a roughly 0.32 m temporary height loss at 84.96 m, with Az 6.66 m/s^2 and Vz 1.92 m/s, during normal level-off toward the 80 m target. The former 0.2 s criterion was too short. The corrected entry requires the measured descent trend and the specified acceleration threshold; the takeoff target was not increased to hide the bug.

Once RESCUE already owns the controls, existing bounded recovery watchdogs remain: continued sink, severe instability, insufficient height/energy progress, low altitude, urgent predicted Home crossing, navigation data loss and overall recovery timeout. These are failure checks after capture, not independent entry conditions. The additional impact gate can override cooldown, preventing a fresh low-height dive during the handover interval from being ignored. RSC_ENABLE=0 disables this supervisor.

The acceleration-only limitation is now addressed by the explicit low-height safeguard in section 4.2. Height uses Home, not measured terrain; rising terrain, delayed estimates, very late dive onset and airframe limits can still prevent recovery. The six-second margin is tested in the native model and is not flight-certified. An intentional fast descent into this envelope also triggers: stick intent cannot prove sufficient ground clearance. A native ground-strike report at 8 m/s or more is held as a failed-trial banner; this display threshold is not a firmware entry parameter or a structural-damage calculation. The simple native model can rebound and fly after impact, so subsequent stabilization cannot validate that trial as a successful rescue.

RSC records contain the decision values, state and event. MODE, TECS, RCOU and ARM provide the independent mode, controller, release and disarm evidence. Named telemetry RSC_DLOSS and RSC_DTIME expose the measured descent loss and duration.

## 6. Deliverables

- rescue.patch and source/: changes based on Plane-4.6.3.
- rescue.parm: complete tested simulator profile.
- bin/arduplane.exe: native SITL firmware; not a Pixhawk flash image.
- runs/: original BIN logs, telemetry and verified results.
- README.md: custom parameters and implementation decisions.

## 7. SITL scenarios

The panel exposes only the seven requested acceptance scenarios: warning without mode change; capture from MANUAL and AUTO; TECS recovery and stabilization; FBWA handover; no-response parachute; failed-recovery parachute; and disabled behavior. MANUAL and AUTO are separate flights, giving eight acceptance flights.

The test stimulus produces an actual accelerating dive so that the specified threshold is met at capture. The engine-failure scenario removes propulsion after qualifying capture to exercise failed recovery. Sensor values, flight mode state and detector state are not injected.

Engineering regressions separately cover 40/80/100/240 m TAKEOFF level-off, ordinary mode changes and banking, controlled descent, constant-speed subthreshold descent and a short pushover. They are not extra acceptance choices in the panel. See low-height-verification.json and LOW_HEIGHT_FIX_REPORT.md for the current firmware hash and 22 unique native cases: 14 regressions and eight flights covering the seven requested acceptance scenarios. Original BIN evidence includes the approach-timeout attempt and its successful repeat. The actual QGC desktop trial is separately recorded as incomplete; a ten-case manual-click campaign is not claimed. The English specification response is in docs/RESCUE_Response_EN_3.0.1.docx.

Windows UI inspection used the installed QGroundControl. Its hold-to-confirm controls cannot be held by the available desktop automation API; native flight tests use standard MAVLink commands. These results are not presented as a completed manual-click QGC acceptance run.

ArduPlane, TECS and AP_Parachute remain upstream ArduPilot components. Retain the supplied GPL and dependency licenses. Physical flight-controller and parachute qualification are separate from these SITL results.

## English delivery

All project-facing documents, the response, presentation, panel labels and launcher metadata in this delivery are in English. The native flight executable, exact parameter profile and original BIN evidence are unchanged. Launcher company metadata, author display and the airfield display name have been localized without changing flight logic.
