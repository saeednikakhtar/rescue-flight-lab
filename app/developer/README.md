# Developer files

The supplied executables already run the native simulation; a compiler is not required for operation.

## Firmware source

Extract ardupilot-sitl-source.tar.gz into a separate working folder. It already contains the modifications in rescue.patch and the initialized submodules used by the native build; do not apply the patch again to this archive. source-index.json records the pinned revisions. The firmware was built in Cygwin x64 with GCC 14.4.0 and Python 3. Configure/build from a Cygwin shell in the extracted ardupilot folder:

    ./waf configure --board sitl --no-submodule-update
    ./waf plane

The Cygwin development compiler and its build prerequisites are separate from the bundled runtime DLLs. The original configure/build logs are included for reference; their development-machine paths are historical. Uninitialized hardware-only modules in source-index.json are not needed for this native SITL build. For a fresh Git checkout instead, use Plane-4.6.3 / commit 3fc7011a7d3dc047cbb17d8bd98ee94577d144c6, initialize the required modules and apply the root rescue.patch once. A hardware firmware build requires its own board target and dependency setup; the supplied PC executable cannot be flashed.

## Repeatable native tests

Run these from the root application folder. They use the included native binary and Python runtime, write fresh groups beneath runs/ and do not require the web panel or QGC:

    runtime\python.exe developer\test_rescue_v2.py warning,manual,auto,recovery,handover,no_pilot,failed,disabled
    runtime\python.exe developer\test_low_height_envelope.py

The first command runs only the eight flights covering the seven required scenarios. The second is the engineering regression suite. Both use native aircraft dynamics with standard MAVLink control stimuli. Their ports differ from the interactive 5800/QGC session. Complete 22-case results already supplied in low-height-verification.json were obtained before packaging; package-smoke-verification.json independently checks the relocated runtime and a disarmed native ground session.

watch_manual_checkpoint.py is an optional QGC trial observer. By default it only observes; --hold is an explicit flight command selecting LOITER at an above/below endpoint, only in MANUAL/FBWA/GUIDED. It must be run from this extracted service's own package, and must not be used against a different running release. The pending attended QGC campaign is separate from the native engineering suite.

## Panel and launcher

Python and UI sources are in the application root. graphics-source/build-graphics.ps1 rebuilds scene.js with the included pinned esbuild.exe; no npm install is needed. Rebuild both launcher filenames from launcher.cs with the Windows .NET Framework C# compiler and references System.Web.Extensions.dll/System.Windows.Forms.dll. Behavior is selected by QGC-Manual-Ground.exe's filename or --ground.

Both launchers support --verify-package. It checks the local required files and the firmware hash, writes launcher-check.json, and does not start a service, open QGC or modify a flight. Full payload hashes are in SHA256SUMS.json. License and provenance notices are retained in the application root and dependency folders.
