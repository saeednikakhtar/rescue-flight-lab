"""Evaluate the original DataFlash records; do not infer PASS from a UI label."""
import hashlib,json
from test_rescue import mavutil

EVENTS=['sample','fall','clear','capture','stable','handover','no_pilot','low_alt','no_climb',
        'timeout','disabled','bad_config','pilot_input','no_progress','unstable','stability_lost','impact_risk','sensor_loss','energy_progress']

def verify(f,name):
    packets=[];modes=[];outputs=[];arms=[];tecs=[];files=[]
    for path in sorted((f.dir/'logs').glob('*.BIN')):
        files.append(dict(file=path.name,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        reader=mavutil.mavlink_connection(str(path))
        while True:
            p=reader.recv_match(type=['RSC','MODE','RCOU','ARM','TECS'])
            if p is None:break
            target={'RSC':packets,'MODE':modes,'RCOU':outputs,'ARM':arms,'TECS':tecs}[p.get_type()]
            target.append(p.to_dict())
    transitions=[p for p in packets if p['Event']]
    capture=next((p for p in transitions if p['Event']==3),None)
    stable=next((p for p in transitions if p['Event']==4),None)
    chute=next((p for p in transitions if p['State']==4),None)
    checks={'original_bin_present':bool(files)}
    if name=='warning':checks.update(warning=any(p['Event']==1 for p in transitions),no_capture=capture is None,
                                    warning_acceleration=all(p['Az']>5 and p['Vz']>.5 for p in transitions if p['Event']==1))
    elif name in ('disabled','gentle','ground','armed_ground'):checks['no_intervention']=capture is None and chute is None
    else:
        checks['capture']=capture is not None
        if name in ('manual','auto','recovery','handover','no_pilot','failed'):
            checks['capture_acceleration_above_threshold']=bool(capture and capture['Az']>5 and int(capture.get('Why',0))&1)
            trend=[]
            if capture:
                for p in reversed([p for p in packets if p['TimeUS']<=capture['TimeUS']]):
                    if p['Vz']<=.5:break
                    trend.append(p)
            checks['capture_sustained_measured_descent']=bool(capture and trend and
                (capture['TimeUS']-trend[-1]['TimeUS'])/1e6>=.9 and
                max(p['Alt'] for p in trend)-capture['Alt']>=1.9)
        if name not in ('no_progress','energy_recovery'):checks['capture_below_100']=bool(capture and capture['Alt']<100)
        if name=='steady':checks['independent_of_acceleration']=bool(capture and capture['Az']<5 and capture['Vz']>5 and int(capture.get('Why',0))&2)
        if name=='moderate':checks['predicted_crossing']=bool(capture and capture['Az']<5 and 2<capture['Vz']<5 and int(capture.get('Why',0))&16)
        if name in ('manual','auto') and capture:
            prior=[p for p in modes if p['TimeUS']<capture['TimeUS']]
            checks['specified_source_mode']=bool(prior and prior[-1].get('Mode',prior[-1].get('ModeNum'))==({'manual':0,'auto':10}[name]))
        if name not in ('failed','tumble','no_progress','energy_recovery','fast_dive'):
            checks['stabilized']=stable is not None
            if stable:
                checks['stable_envelope']=abs(stable['Alt']-200)<=5.01 and abs(stable['Vz'])<=1.01 and max(abs(stable['Roll']),abs(stable['Pitch']))<=10.01 and stable.get('Rate',999)<=15.01
                checks['existing_tecs_used']=any(capture['TimeUS']<=p['TimeUS']<=stable['TimeUS'] and abs(p.get('hin',-999)-200)<.1 for p in tecs)
                recovery=[r for r in f.rows if capture['TimeUS']/1e6<=r['t']<=stable['TimeUS']/1e6]
                checks['airspeed_above_minimum']=bool(recovery) and min(r['airspeed'] for r in recovery)>=10
                checks['model_stall_threshold_not_crossed']=bool(recovery) and all(abs(r['aoa'])<27 for r in recovery if r.get('aoa') is not None)
        if name in ('manual_input','rc_input','receiver_input'):
            checks['deliberate_input_logged']=any(p['Event']==12 for p in transitions)
            checks['handover_no_chute']=any(p['Event']==5 for p in transitions) and chute is None
        if name in ('manual','auto','recovery','handover','steady','moderate'):
            checks['handover_no_chute']=any(p['Event']==5 for p in transitions) and chute is None
        if name in ('no_pilot','jitter','held_input','stale_input'):
            checks['no_false_pilot_ack']=not any(p['Event']==12 for p in transitions)
            checks['no_pilot_chute']=bool(chute and chute['Event']==6)
            checks['five_second_deadline']=bool(chute and stable and 4.999<=(chute['TimeUS']-stable['TimeUS'])/1e6<=5.12)
        if name=='no_progress':checks['no_progress_watchdog']=bool(chute and chute['Event']==13)
        if name=='energy_recovery':
            checks['airspeed_progress_not_false_failure']=any(p['Event']==18 and p['Gn']<15 for p in transitions)
            checks['eventual_no_progress_chute']=bool(chute and chute['Event']==13)
        if name=='tumble':
            checks['not_stable_while_tumbling']=stable is None
            checks['loss_of_control_chute']=bool(chute and chute['Event'] in (7,8,14,16))
            rolls=[r['roll'] for r in f.rows if capture and r['t']<=capture['TimeUS']/1e6+2]
            rotation=sum(abs((b-a+180)%360-180) for a,b in zip(rolls,rolls[1:]))
            checks['actual_full_rotation']=rotation>=360
        if name=='stability_loss':checks['handover_cancelled']=any(p['Event']==15 for p in transitions)
        if name=='renewed_dive':
            captures=[p for p in transitions if p['Event']==3];handed=[p for p in transitions if p['Event']==5]
            checks['critical_cooldown_override']=len(captures)==2 and bool(handed) and 0<(captures[-1]['TimeUS']-handed[0]['TimeUS'])/1e6<10 and captures[-1]['Alt']<100
        if name in ('failed','tumble','no_progress','stability_loss','renewed_dive'):checks['failure_chute']=chute is not None
    if chute:
        released=[p for p in outputs if p['TimeUS']>=chute['TimeUS'] and p.get('C9',0)>=1800]
        checks['release_output']=bool(released)
        checks['motor_cut']=any(p.get('C3',9999)<=1000 for p in released)
        checks['disarmed']=any(p['TimeUS']>=chute['TimeUS'] and p.get('ArmState')==0 for p in arms)
    for p in transitions:p['reason']=EVENTS[p['Event']] if p['Event']<len(EVENTS) else str(p['Event'])
    result=dict(scenario=name,passed=all(checks.values()),checks=checks,transitions=transitions,logs=files,
                final=dict(t=f.t,mode=f.mode,armed=f.armed,alt=f.alt,motor_pwm=f.servo3,chute_pwm=f.servo9))
    (f.dir/'verified-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result
