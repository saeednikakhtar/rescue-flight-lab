"""Verify actual DataFlash phase/trigger evidence and generate the acceptance report."""
import csv
import hashlib
import json
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'pydeps'))
sys.path.insert(0,str(HERE.parent.parent/'work/pydeps'))
from pymavlink import mavutil

STATES=['MONITOR','WARNING','RECOVER','STABILIZED','CHUTE','COOLDOWN']
EVENTS=['SAMPLE','FALL','CLEAR','CAPTURE','STABLE','HANDOVER','NO_PILOT',
        'LOW_ALT','NO_CLIMB','TIMEOUT','DISABLED','BAD_CONFIG','PILOT_INPUT','NO_PROGRESS','UNSTABLE','STABILITY_LOST','IMPACT_RISK','SENSOR_LOSS']

def analyze(run):
    result=json.loads((run/'result.json').read_text())
    logs=sorted((run/'logs').glob('*.BIN'))
    if not logs: raise RuntimeError('Missing actual DataFlash log: '+run.name)
    phases=[];samples=[];outputs=[];modes=[];arm=[]
    for path in logs:
        reader=mavutil.mavlink_connection(str(path))
        while True:
            m=reader.recv_match(type=['RSC','RCOU','MODE','ARM'])
            if m is None:break
            typ=m.get_type()
            if typ=='RSC':
                d=m.to_dict();d['log']=path.name
                samples.append(d)
                if m.Event!=0:phases.append(d)
            elif typ=='RCOU':outputs.append(m.to_dict())
            elif typ=='MODE':modes.append(m.to_dict())
            elif typ=='ARM':arm.append(m.to_dict())
    checks={}
    name=run.name
    if name=='disabled':
        checks['no_rescue_records']=len(samples)==0
        checks['no_rescue_mode']=not any(m.get('Mode')==26 or m.get('ModeNum')==26 for m in modes)
    if name in ('manual','auto','handover','no_pilot','failed'):
        capture=next((p for p in phases if p['Event']==3),None)
        checks['capture_logged']=capture is not None
        if capture:
            checks['capture_height_below_100']=capture['Alt']<100
            checks['capture_valid_hazard']=capture.get('Why',0)>0 or capture['Az']>5
            checks['capture_during_descent']=capture['Vz']>0.5
            decision=next((p for p in phases if p['Event']==1 and p['TimeUS']==capture['TimeUS']),None)
            if decision:
                checks['capture_matches_same_tick_warning_input']=abs(decision['Az']-capture['Az'])<1e-6
        stable=next((p for p in phases if p['Event']==4),None)
        if name!='failed':
            checks['stabilization_logged']=stable is not None
            if stable:
                checks['stable_altitude']=abs(stable['Alt']-200)<=5.01
                checks['stable_vertical_speed']=abs(stable['Vz'])<=1.01
                checks['stable_attitude']=max(abs(stable['Roll']),abs(stable['Pitch']))<=10.01
                telemetry=json.loads((run/'telemetry.json').read_text())
                recover=[r for r in telemetry if capture and capture['TimeUS']/1e6+2<=r['t']<=stable['TimeUS']/1e6]
                checks['airspeed_above_min_after_initial_recovery']=bool(recover) and min(r['airspeed'] for r in recover)>=9.5
        chute=next((p for p in phases if p['State']==4),None)
        if name=='no_pilot':
            checks['no_pilot_chute_logged']=chute is not None and chute['Event']==6
            if stable and chute:
                dt=(chute['TimeUS']-stable['TimeUS'])/1e6
                # Firmware deadline is in milliseconds; DataFlash records use
                # microseconds. Permit only the known sub-millisecond rounding.
                checks['five_second_handover_deadline']=4.999<=dt<=5.1
                result['handover_to_chute_s']=dt
        if name=='failed':
            checks['failure_chute_logged']=chute is not None and chute['Event'] in (7,8,9,13,14,16,17)
        if name in ('failed','no_pilot') and chute:
            release=[o for o in outputs if o.get('C9',0)>=1800 and o.get('TimeUS',0)>=chute['TimeUS']]
            checks['actual_chute_output_logged']=bool(release)
            checks['actual_motor_cut_logged']=bool(release) and any(o.get('C3',3000)<=1000 for o in release)
        if name in ('manual','auto','handover'):
            checks['handover_logged']=any(p['Event']==5 for p in phases)
            checks['no_parachute_after_handover']=chute is None
            checks['one_capture_only']=sum(p['Event']==3 for p in phases)==1
    if name=='warning':
        warnings=[p for p in phases if p['State']==1]
        checks['warning_logged']=bool(warnings)
        checks['warning_above_capture_height']=bool(warnings) and all(p['Alt']>=100 for p in warnings)
        checks['warning_did_not_capture']=not any(p['Event']==3 for p in phases)
    result['log_checks']=checks
    result['passed']=result['passed'] and all(checks.values())
    result['logs']=[{'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in logs]
    result['phases']=phases
    (run/'verified-result.json').write_text(json.dumps(result,indent=2))
    if phases:
        with (run/'phases.csv').open('w',newline='') as out:
            writer=csv.DictWriter(out,fieldnames=list(phases[0]))
            writer.writeheader();writer.writerows(phases)
    return result

if __name__=='__main__':
    results=[]
    for name in ['ground','warning','manual','auto','handover','no_pilot','failed','disabled']:
        results.append(analyze(HERE/'runs'/name))
    (HERE/'verified-results.json').write_text(json.dumps(results,indent=2))
    lines=['# Actual SITL acceptance results','',
           'Base: ArduPlane 4.6.3, commit 3fc7011a7d3dc047cbb17d8bd98ee94577d144c6.',
           'Model: native plane-elevrev. Test speed: 4x. Fresh storage per scenario.',
           'Site: Alferyevo Airfield (XUOA), 56.0953903 N, 35.883429 E; heading 314.496 degrees, approximate launch elevation 161.107 m. See test-site.json for provenance.',
           'Results are verified against actual DataFlash .BIN files, not just test-runner messages.','',
           '| Scenario | Flight assertions and log checks | Evidence |','|---|---|---|']
    for r in results:
        evidence=', '.join(x['file'] for x in r['logs'])
        lines.append(f"| {r['scenario']} | {'PASS' if r['passed'] else 'FAIL'} | runs/{r['scenario']}/logs/{evidence} |")
    for r in results:
        lines+=['',f"## {r['scenario']}",'']
        for k,v in r['log_checks'].items():lines.append(f"* {'PASS' if v else 'FAIL'}: {k}")
        if r.get('error'):lines.append('Flight error: '+r['error'])
        if r['phases']:
            lines+=['','| Time (s) | State | Event | Alt (m) | Down acceleration (m/s^2) | Down velocity (m/s) |',
                    '|---:|---|---|---:|---:|---:|']
            for p in r['phases']:
                lines.append(f"| {p['TimeUS']/1e6:.3f} | {STATES[p['State']]} | {EVENTS[p['Event']]} | {p['Alt']:.2f} | {p['Az']:.2f} | {p['Vz']:.2f} |")
    lines+=['','## Interpretation limits','',
            'Passing this suite demonstrates the listed behaviors in the simplified native SITL model. It is not aircraft hardware qualification. The disabled test checks no intervention for the exercised flight; it does not establish universal regression freedom for every upstream scenario. See README for the physical-model and acceleration-trigger limitations.']
    (HERE/'TEST_REPORT.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps([{'scenario':r['scenario'],'passed':r['passed'],'checks':r['log_checks']} for r in results],indent=2))
    sys.exit(0 if all(r['passed'] for r in results) else 1)
