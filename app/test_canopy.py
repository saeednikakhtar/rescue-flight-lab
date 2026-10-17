"""Checks canopy inflation and terminal descent using real patched SITL telemetry."""
from test_rescue import Flight
import json, math, statistics
from pathlib import Path
f=Flight('canopy-physics')
result={'passed':False}
try:
    f.takeoff(80);f.dive()
    f.wait(lambda:f.rescue_seen,20,'capture')
    f.rc[1]=1500;f.rc[2]=1500
    f.wait(lambda:f.stable_seen,110,'stabilized')
    f.wait(lambda:f.deployed,10,'canopy release')
    release=f.t
    f.run_for(20)
    rows=[r for r in f.rows if r['t']>=release and r['true_vz'] is not None]
    infl=[r['canopy'] for r in rows]
    assert all(b+1e-4>=a for a,b in zip(infl,infl[1:])), 'Inflation regressed'
    full=next(r for r in rows if r['canopy']>=.99)
    assert 1.1<=full['t']-release<=2.2, 'Incorrect opening duration'
    settled=[r for r in rows if r['t']>release+12]
    vz=statistics.median(r['true_vz'] for r in settled)
    density=statistics.median(r['density'] for r in settled)
    theoretical=math.sqrt(2*2*9.80665/(density*1.3))
    assert 4<=vz<=6.5, 'Canopy did not limit vertical descent'
    assert abs(vz-theoretical)<1.0, 'Descent inconsistent with configured CdA'
    assert all(r['motor_pwm']<=1000 for r in settled), 'Motor running under canopy'
    result.update(passed=True,release_s=release,full_inflation_after_s=full['t']-release,
                  measured_terminal_descent_m_s=vz,quadratic_drag_reference_m_s=theoretical,
                  opening_progressive=True,motor_cut=True,density_kg_m3=density,
                  source='Actual NAMED_VALUE_FLOAT telemetry emitted by the SITL physics model')
finally:
    f.close()
    (Path(__file__).parent/'canopy-physics-result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2),flush=True)
