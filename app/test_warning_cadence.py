"""Measure real GCS warning cadence during a sustained native-physics dive.

The upper warning threshold is raised to 500 m and ACC_Z lowered to 1 only
for this timing probe, sustaining the condition long enough for multiple
messages. Main acceptance tests retain 200 m / 5 m/s². No sensor/state injection.
"""
from pathlib import Path
import hashlib
import json
import sys

root=Path(__file__).resolve().parent
sys.path.insert(0,str(root))
from test_rescue import Flight
from analyze_warning_cadence import analyze

def run_cadence(run_group=None):
    # This feedback-controlled timing probe runs in real time. At 4x the
    # wall-clock RC interval becomes 320 ms of simulated time and can interrupt
    # the falling condition; it is unsuitable evidence of continuous cadence.
    f=Flight(str(Path(run_group)/'warning-cadence-sustained') if run_group else 'warning-cadence-sustained',{'SIM_SPEEDUP':1,'RSC_ALT_WARN':500,'RSC_ACC_Z':1})
    result={'passed':False,'probe_overrides':{'SIM_SPEEDUP':1,'RSC_ALT_WARN':500,'RSC_ACC_Z':1},
            'note':'Special timing probe extends the falling-condition window; main acceptance tests retain default 200 m / 5 m/s².'}
    try:
        f.takeoff(350)
        f.run_for(4)
        f.change_mode(0)
        start=f.t
        old_pitch=f.model.get('SIM_PITCH',f.pitch)
        old_t=f.t
        last_attitude=f.mav.messages.get('SIMSTATE')
        filtered_rate=0
        controller_samples=[]
        while f.t-start<25 and f.alt>130 and not f.rescue_seen:
            f.pump()
            attitude=f.mav.messages.get('SIMSTATE')
            # Other MAVLink messages advance time_boot_ms without updating
            # attitude. Differentiating their repeated pitch sample produced
            # alternating zero/huge rates and actuator reversals in the probe.
            # Update only on a genuinely new native SIMSTATE observation.
            if attitude is not None and attitude is not last_attitude and f.t-old_t>=.02:
                pitch=f.model.get('SIM_PITCH',f.pitch)
                rate=(pitch-old_pitch)/(f.t-old_t)
                filtered_rate=.6*filtered_rate+.4*rate
                # Pilot elevator commands hold a steep dive in MANUAL; recovery
                # remains the firmware's existing TECS controller if it captures.
                f.rc[1]=round(max(1100,min(1950,1500+6*(pitch+70)+1.4*filtered_rate)))
                controller_samples.append(dict(t=f.t,pitch=pitch,rate=filtered_rate,elevator_pwm=f.rc[1]))
                old_pitch,old_t=pitch,f.t
            last_attitude=attitude
            f.rc[2]=1100
            warnings=[e for e in f.messages if e['text'].startswith('RESCUE WARNING:')]
            if len(warnings)>=3:break
        f.rc[1]=1500;f.rc[2]=1800
        if not f.rescue_seen:f.change_mode(5)
        f.run_for(1)
        warnings=[e for e in f.messages if e['text'].startswith('RESCUE WARNING:')]
        intervals=[b['time_s']-a['time_s'] for a,b in zip(warnings,warnings[1:])]
        result.update(warnings=warnings,intervals_s=intervals,mode_during_warning='MANUAL',
                      controller_samples=controller_samples,
                      captured=f.rescue_seen,minimum_observed_altitude_m=min(r['alt'] for r in f.rows if r['t']>=start))
    finally:
        f.close()
        result['logs']=[{'file':p.relative_to(root).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in (f.dir/'logs').glob('*.BIN')]
        result=analyze(result)
        (f.dir/'verified-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result,indent=2),flush=True)
    return result

if __name__=='__main__':
    result=run_cadence()
    (root/'warning-cadence-test.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    assert result['passed'],'Inspect the retained native timing-probe log.'
