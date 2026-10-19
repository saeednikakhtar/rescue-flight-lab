# Build and source

Base: ArduPlane tag Plane-4.6.3, commit 3fc7011a7d3dc047cbb17d8bd98ee94577d144c6.

rescue.patch is the exact binary-safe Git patch for the 30 modified source files. The native PC firmware was compiled in Cygwin x64 using GCC 14.4.0. It is not a Pixhawk flash image.

The complete source, including current modifications and initialized SITL build submodules, is in ../03_SITL/developer/ardupilot-sitl-source.tar.gz. Its source-index.json records the revisions. Do not apply the patch twice to that already-modified archive. For a fresh checkout of the pinned base, apply rescue.patch once and initialize the required modules: waf, mavlink, gtest and the listed DroneCAN modules. Configure/build in a Cygwin shell:

    ./waf configure --board sitl --no-submodule-update
    ./waf plane

The native executable and required runtime DLLs are already supplied under ../03_SITL/bin. A compiler is only needed for rebuilding. The build manifest records the binary and patch SHA-256 values. Existing TECS and AP_Parachute remain the flight-control/release components. The update adds the new mode, supervisor, parameters, logging, GCS mode metadata and the progressive native canopy model.

The original acceleration gate remains; the additional steady-descent guard and optional deliberate stick acknowledgment are disclosed in ../05_README/README.md and the Word response.
