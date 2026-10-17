"""Native flight regressions for steady descent and ordinary pilot manoeuvres.

These are repeatable MAVLink pilot-input tests, not desktop mouse tests.
No sensor, position or RESCUE-state injection is used.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib, json, sys, time, traceback
base = Path(__file__).resolve().parents[1]
app = base
sys.path.insert(0, str(app))
from test_rescue import Flight, mavutil
binary = app/'bin/arduplane.exe'
group = 'low-height-envelope-'+time.strftime('%Y%m%d-%H%M%S')
folder = app/'runs'/group
folder.mkdir()
names = sys.argv[1].split(',') if len(sys.argv)>1 else [
    'takeoff40','takeoff80','level80','brief_push','controlled_descent',
    'fbwa_steady','manual_steady','pilot_pullout','climb_clear',
    'banked_descent','disabled','engine_failure','pullout_near_margin','aborted_pullout']

def hold_pitch(f, target, throttle, until, timeout=90):
    start=f.t; previous=f.model.get('SIM_PITCH',f.pitch); rate=0
    while not until():
        assert f.t-start<timeout, 'Pitch-hold stimulus timed out'
        pitch=f.model.get('SIM_PITCH',f.pitch)
        rate=.6*rate+.4*(pitch-previous)/.1
        f.rc[1]=round(max(1100,min(1950,1500+6*(pitch-target)+1.4*rate)))
        f.rc[2]=throttle
        previous=pitch; f.run_for(.1)

def run(i,name):
    f=None; result=dict(case=name,passed=False,input_method='MAVLink RC override; native aircraft and supervisor')
    try:
        options={'SIM_SPEEDUP':4,'HOME_RESET_ALT':-1}
        if name=='disabled':options['RSC_ENABLE']=0
        f=Flight(group+'/'+name,options,binary=binary,port=15000+i*100,instance=130+i)
        f.takeoff(40 if name=='takeoff40' else 80 if name in ('takeoff80','level80','brief_push','climb_clear','controlled_descent') else 200)
        start=f.t
        if name in ('takeoff40','takeoff80','level80'):
            f.change_mode(12);f.run_for(25)
            f.change_mode(5);f.rc[2]=1590;f.run_for(10)
        elif name=='brief_push':
            f.change_mode(0);f.rc[1]=2000;f.rc[2]=1590;f.run_for(.35)
            f.change_mode(5);f.rc[1]=1400;f.run_for(3)
            f.rc[1]=1500;f.run_for(5)
        elif name=='controlled_descent':
            f.change_mode(5);f.rc[1]=1660;f.rc[2]=1590
            f.wait(lambda:f.alt<55,60,'normal descent to 55m')
            f.rc[1]=1400;f.run_for(3)
        elif name in ('fbwa_steady','engine_failure'):
            f.change_mode(5);f.rc[1]=2000;f.rc[2]=1590
            f.wait(lambda:f.mode==26,100,'steady FBWA descent capture')
        elif name=='manual_steady':
            f.change_mode(0)
            hold_pitch(f,-35,1590,lambda:f.mode==26)
        elif name=='aborted_pullout':
            f.change_mode(5);f.rc[1]=2000;f.rc[2]=1590
            f.wait(lambda:f.alt<48,80,'approach impact margin')
            f.rc[1]=1250;f.rc[2]=1650;f.run_for(.35)
            f.rc[1]=2000
            f.wait(lambda:f.mode==26,20,'abandoned pullout must not veto capture')
        elif name in ('pilot_pullout','climb_clear','pullout_near_margin'):
            if name=='climb_clear':
                f.change_mode(5);f.rc[1]=1700;f.rc[2]=1590
                f.wait(lambda:f.alt<63,35,'controlled descent')
            else:
                f.change_mode(5);f.rc[1]=2000;f.rc[2]=1590
                f.wait(lambda:f.alt<(48 if name=='pullout_near_margin' else 65),80,'approach short-time envelope')
            f.rc[1]=1250 if name=='pullout_near_margin' else 1350;f.rc[2]=1650
            f.run_for(6)
            if name=='climb_clear':f.rc[1]=1450;f.run_for(5)
        elif name=='banked_descent':
            f.change_mode(5);f.rc[0]=1720;f.rc[1]=1800;f.rc[2]=1590
            f.wait(lambda:f.mode==26,100,'banked sustained descent capture')
        elif name=='disabled':
            f.change_mode(5);f.rc[1]=2000;f.rc[2]=1590
            f.wait(lambda:f.alt<30,110,'disabled dive')
            f.rc[1]=1250;f.rc[2]=1700;f.run_for(4)
        positive=name in ('fbwa_steady','manual_steady','banked_descent','engine_failure','aborted_pullout')
        if positive:
            assert f.mode==26 and f.rescue_seen,'No automatic RESCUE'
            if name=='engine_failure':
                f.param('SIM_ENGINE_FAIL',2);f.param('SIM_ENGINE_MUL',0)
                f.wait(lambda:f.deployed,100,'failed-recovery release')
            else:
                f.wait(lambda:f.stable_seen or f.deployed,90,'TECS recovery or late-envelope parachute')
                if name!='banked_descent':assert f.stable_seen and not f.deployed,'Expected flyable recovery'
                if f.stable_seen:
                    f.change_mode(5);f.rc=[1500,1450,1590,1500,*f.rc[4:]]
                    f.run_for(3)
            assert not any('SIM Hit ground' in m['text'] and abs(float(m['text'].split()[-2]))>=8 for m in f.messages),'Hard impact'
        else:
            assert not f.rescue_seen and not f.deployed,'Unexpected intervention in ordinary flight'
        result.update(flight_assertions=True,segment_start=start,segment_end=f.t)
    except Exception as e:
        result.update(error=str(e),traceback=traceback.format_exc())
    finally:
        if f:f.close()
    if f:
        rows=[];events=[];modes=[];logs=[]
        for path in (f.dir/'logs').glob('*.BIN'):
            logs.append(dict(file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
            reader=mavutil.mavlink_connection(str(path))
            while (m:=reader.recv_match(type=['RSC','MODE'])) is not None:
                if m.get_type()=='MODE':modes.append(m.to_dict())
                else:
                    rows.append(m.to_dict())
                    if m.Event:events.append(m.to_dict())
            reader.close()
        capture=next((r for r in events if r['Event']==3),None)
        positive=name in ('fbwa_steady','manual_steady','banked_descent','engine_failure','aborted_pullout')
        checks=dict(original_bin=bool(logs),flight_assertions=result.get('flight_assertions',False))
        if positive:
            checks.update(native_capture=bool(capture),below100=bool(capture and capture['Alt']<100),
                          automatic_reason=any(m['Mode']==26 and m['Rsn']==56 for m in modes))
            if name in ('fbwa_steady','manual_steady','engine_failure'):
                checks.update(steady_guard=bool(capture and capture['Why']&32),
                              subthreshold_accel=bool(capture and capture['Az']<5),
                              early_enough=bool(capture and capture['Alt']>30))
            checks['failed_chute' if name=='engine_failure' else 'recovery_action']=any(r['State']==4 if name=='engine_failure' else (r['Event']==4 or (name=='banked_descent' and r['State']==4)) for r in events)
        else:
            checks['no_capture']=capture is None
            if name in ('pilot_pullout','pullout_near_margin'):
                checks['verified_braking_logged']=any(r['Why']&64 for r in rows)
        result.update(checks=checks,passed=all(checks.values()),capture=capture,events=events,logs=logs,
                      min_height=min((r['Alt'] for r in rows),default=None))
        (f.dir/'envelope-result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({k:result.get(k) for k in ('case','passed','error','checks','capture')}),flush=True)
    return result

summary=dict(group=group,binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),passed=False,cases=[])
with ThreadPoolExecutor(max_workers=3) as pool:
    for future in as_completed([pool.submit(run,i,n) for i,n in enumerate(names)]):
        summary['cases'].append(future.result())
        (folder/'summary.json').write_text(json.dumps(summary,indent=2))
summary['passed']=all(r['passed'] for r in summary['cases'])
(folder/'summary.json').write_text(json.dumps(summary,indent=2))
(base/'work/latest-envelope-suite.txt').write_text(str(folder))
print(json.dumps(dict(group=group,passed=summary['passed'],count=len(summary['cases']))),flush=True)
sys.exit(0 if summary['passed'] else 1)
