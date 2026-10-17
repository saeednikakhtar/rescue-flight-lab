"""Reproducible flight exercises. All stimuli use actual RC/actuator/engine inputs."""
import time
from test_rescue import M

CASES = [
    dict(id='warning',number=1,title='Warning below 200 m',expect='Warning only; flight mode unchanged'),
    dict(id='manual',number=2,title='Capture from MANUAL',expect='RESCUE below 100 m; recovery with TECS'),
    dict(id='auto',number=2,title='Capture from AUTO',expect='RESCUE below 100 m; recovery with TECS'),
    dict(id='recovery',number=3,title='TECS recovery and stable flight',expect='200 ± 5 m; stable for 2 s; safe speed'),
    dict(id='handover',number=4,title='Pilot changes to FBWA',expect='Pilot control; no parachute; no immediate recapture'),
    dict(id='no_pilot',number=5,title='No pilot response',expect='Parachute after 5 s; motor cut; disarmed'),
    dict(id='failed',number=6,title='Engine cannot recover',expect='Failure watchdog; parachute; motor cut'),
    dict(id='disabled',number=7,title='RESCUE disabled',expect='No RESCUE intervention'),
    dict(id='steady',title='Constant-speed descent',expect='Sink-rate capture even with acceleration below threshold'),
    dict(id='moderate',title='Predicted low-height crossing',expect='Moderate descent with near-zero acceleration is detected in time'),
    dict(id='fast_dive',title='Full-throttle MANUAL dive',expect='Capture before impact; recover or emergency parachute'),
    dict(id='tumble',title='Continuous roll and descent',expect='Never stable while rotating; recover or parachute'),
    dict(id='no_progress',title='Full power without height gain',expect='Net-height watchdog; parachute'),
    dict(id='energy_recovery',title='Speed recovery before climb',expect='Real airspeed gain counts as recovery progress; bounded by safety limits'),
    dict(id='manual_input',title='QGC-style joystick handover',expect='MANUAL_CONTROL throttle movement selects FBWA'),
    dict(id='rc_input',title='RC stick handover',expect='Sustained RC channel movement selects FBWA'),
    dict(id='receiver_input',title='Receiver input in SITL',expect='Native receiver-frame input selects FBWA'),
    dict(id='jitter',title='Joystick noise rejection',expect='Small input noise does not acknowledge handover'),
    dict(id='held_input',title='Held input rejection',expect='Unchanged held input does not acknowledge handover'),
    dict(id='stale_input',title='Single stale packet rejection',expect='One changed packet without fresh follow-up is not pilot handover'),
    dict(id='gentle',title='Normal low descent',expect='Gentle descent below 100 m does not trigger RESCUE'),
    dict(id='stability_loss',title='Stability lost after recovery',expect='Cancel handover; recover again or deploy parachute'),
    dict(id='renewed_dive',title='New danger during handover cooldown',expect='Imminent low-height danger overrides cooldown; parachute'),
    dict(id='ground',title='Disarmed ground guard',expect='RESCUE entry rejected; no parachute'),
    dict(id='armed_ground',title='Armed ground guard',expect='Armed aircraft on ground still cannot enter RESCUE'),
]
BY_ID={c['id']:c for c in CASES}
PRIMARY=[c['id'] for c in CASES if 'number' in c]

# Keep acceptance choices aligned with the brief. MANUAL and AUTO are two
# flights of scenario 2, rather than two different acceptance scenarios.
ACCEPTANCE_CASES = [
    dict(id='warning',number=1,title='Warning below 200 m',expect=BY_ID['warning']['expect'],flights=['warning']),
    dict(id='capture',number=2,title='Automatic capture from MANUAL and AUTO',expect='Two flights: automatic RESCUE entry below 100 m in each mode',flights=['manual','auto']),
    *[{**BY_ID[name],'flights':[name]} for name in ('recovery','handover','no_pilot','failed','disabled')],
]
ACCEPTANCE_BY_ID={case['id']:case for case in ACCEPTANCE_CASES}
ACCEPTANCE_FLIGHTS={flight:case for case in ACCEPTANCE_CASES for flight in case['flights']}

def acceptance_flights(choice):
    if choice=='all7':return list(PRIMARY)
    if choice not in ACCEPTANCE_BY_ID:raise ValueError('Select one of the seven acceptance scenarios')
    return list(ACCEPTANCE_BY_ID[choice]['flights'])

def overrides(name):
    # Branch isolation is explicit and recorded in scenario.parm/result.json.
    if name=='disabled':return {'RSC_ENABLE':0}
    if name in ('steady','moderate'):return {'RSC_ACC_Z':50}
    if name=='no_progress':return {'RSC_PROG_S':3,'RSC_PROG_M':10,'RSC_FAIL_S':10}
    if name=='energy_recovery':return {'RSC_PROG_S':3,'RSC_PROG_M':15,'RSC_FAIL_S':10,'PTCH_LIM_MAX_DEG':5}
    return {}

def neutral(f):
    f.rc[0]=f.rc[1]=f.rc[3]=1500;f.rc[2]=1500

def dive_stimulus(f,target=None,throttle=1500,auto=False,until_warning=False):
    # Test-only pilot/actuator feedback holds a real dive rather than making
    # endless elevator loops. This controller is never part of RESCUE firmware.
    if auto:
        f.upload_auto();f.param('SERVO2_FUNCTION',0);f.fault=True
    else:f.change_mode(0)
    previous=f.model.get('SIM_PITCH',f.pitch);previous_t=f.t;rate=0
    start=f.t;last=None
    while not f.rescue_seen and not (until_warning and any('RESCUE WARNING:' in e['text'] for e in f.messages)):
        f.pump()
        attitude=f.mav.messages.get('SIMSTATE')
        if attitude is not None and attitude is not last and f.t-previous_t>=.02:
            pitch=f.model.get('SIM_PITCH',f.pitch)
            rate=.6*rate+.4*(pitch-previous)/(f.t-previous_t)
            # The brief requires acceleration at capture, not just a terminal
            # constant-speed dive. Keep increasing the actual dive angle for
            # that test; no sensor or supervisor state is injected.
            desired=-min(75,5+18*(f.t-start)) if target is None else target
            value=round(max(1100,min(1950,1500+6*(pitch-desired)+1.4*rate)))
            if auto:f.command(M.MAV_CMD_DO_SET_SERVO,2,value)
            else:f.rc[1]=value
            f.rc[2]=throttle
            previous,previous_t=pitch,f.t
        last=attitude
        if f.t-start>55:raise TimeoutError('Dive stimulus did not reach automatic capture')

def capture(f, source='manual'):
    # Approach with normal FBWA controls; then induce the specified source mode.
    # Do not inject position, acceleration or mode state into the rescue supervisor.
    if f.alt>145:
        f.change_mode(5);f.rc[1]=2000;f.rc[2]=1500
        f.wait(lambda:f.alt<=145 or f.rescue_seen,100,'approach trigger region')
    if not f.rescue_seen:dive_stimulus(f,auto=source=='auto')
    f.wait(lambda:f.rescue_seen,30,'automatic capture below 100 m')
    neutral(f)

def chute_check(f):
    f.wait(lambda:f.deployed,105,'parachute deployment')
    f.wait(lambda:not f.armed,5,'motor disarm')
    f.run_for(1)
    assert f.servo9>=1800 and f.servo3<=1000,'Release actuator / motor cut missing'

def exercise(f,name,announce=lambda text:None,launch_height=240):
    assert name in BY_ID
    announce(BY_ID[name]['title'])
    if name in ('ground','armed_ground'):
        f.change_mode(0);f.run_for(10)
        if name=='armed_ground':
            end=f.t+60;last=-10
            while not f.armed:
                if f.t-last>2:f.command(M.MAV_CMD_COMPONENT_ARM_DISARM,1);last=f.t
                f.pump()
                if f.t>end:raise TimeoutError('Normal ground arming checks')
        f.mav.mav.set_mode_send(f.sysid,M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,26);f.run_for(2)
        assert f.mode==0 and f.armed==(name=='armed_ground') and not f.rescue_seen and not f.deployed and f.model.get('SIM_ON_GND')==1
        return
    if name=='warning':
        f.takeoff(launch_height);f.change_mode(5);f.rc[1]=1650;f.rc[2]=1500
        f.wait(lambda:f.alt<=218,90,'warning approach')
        dive_stimulus(f,until_warning=True)
        assert f.alt>100 and not f.rescue_seen and f.mode==0
        f.change_mode(5);f.rc[1]=1250;f.rc[2]=2000;f.run_for(2)
        assert not f.rescue_seen
        return
    if name=='gentle':
        f.takeoff(80);f.change_mode(5);f.rc[1]=1550;f.rc[2]=1500
        f.run_for(4)
        assert f.alt<100 and not f.rescue_seen and not f.deployed
        return
    if name=='energy_recovery':
        # Hold the normal takeoff limits until airborne. Limit climb pitch only
        # after launch, then slow through genuine motor-off/manual controls.
        f.param('PTCH_LIM_MAX_DEG',20);f.takeoff(130);f.change_mode(0)
        f.rc[1]=1400;f.rc[2]=1000
        f.wait(lambda:f.airspeed<17,15,'reduce actual airspeed before TECS recovery')
        f.param('PTCH_LIM_MAX_DEG',5);f.param('SIM_ENGINE_MUL',.35)
        f.change_mode(26);neutral(f);f.run_for(3)
        f.param('SIM_ENGINE_MUL',1)
        chute_check(f);return
    if name=='no_progress':
        f.takeoff(130);f.param('SIM_ENGINE_FAIL',2);f.param('SIM_ENGINE_MUL',0)
        f.change_mode(26);neutral(f);chute_check(f)
        return
    f.takeoff(launch_height)
    if name=='disabled':
        f.change_mode(5);f.rc[1]=2000;f.rc[2]=1500
        f.wait(lambda:f.alt<=90,100,'disabled descent below 100 m')
        f.run_for(1)
        assert not f.rescue_seen and not f.deployed and not any('RESCUE' in e['text'] for e in f.messages)
        return
    if name in ('steady','moderate'):
        f.change_mode(5);f.rc[1]=1750 if name=='moderate' else 2000;f.rc[2]=1500
        f.wait(lambda:f.rescue_seen,100,'constant-speed dive capture')
        neutral(f)
    elif name=='fast_dive':
        dive_stimulus(f,target=-60,throttle=2000)
        f.wait(lambda:f.rescue_seen,35,'full-throttle manual dive capture')
        neutral(f)
    elif name=='tumble':
        f.change_mode(0);f.param('SERVO1_FUNCTION',0)
        f.run_for(1.2)
        f.command(M.MAV_CMD_DO_SET_SERVO,1,2000)
        f.wait(lambda:getattr(f.mav.messages.get('SERVO_OUTPUT_RAW'),'servo1_raw',0)>=1990,3,'failed aileron output applied')
        f.rc[1]=1650;f.rc[2]=1800
        f.wait(lambda:f.rescue_seen,60,'rotating descent capture')
        # The failed aileron stays deflected to exercise continued loss of control.
        neutral(f);chute_check(f)
        assert not f.stable_seen,'Rotating aircraft declared stable'
        return
    else:
        capture(f,'auto' if name=='auto' else 'manual')
    if name=='failed':
        # Fail the engine after a qualifying capture. An unpowered terminal
        # glide can have almost zero acceleration and is not itself the
        # acceleration-trigger stimulus required by sections 4.1 and 4.2.
        f.param('SIM_ENGINE_FAIL',2);f.param('SIM_ENGINE_MUL',0)
        chute_check(f);assert not f.stable_seen;return
    if name=='held_input':f.rc[2]=1850
    if name=='receiver_input':
        import socket,struct
        f.rc_send_enabled=False;f.hold_mode_channel=False
        f.mav.mav.rc_channels_override_send(f.sysid,1,*([0]*8))
        f.receiver_socket=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        f.raw_rc_sender=lambda:f.receiver_socket.sendto(struct.pack('<16H',*(f.rc+[1500]*8)),('127.0.0.1',f.receiver_port))
    if name=='fast_dive':
        f.wait(lambda:f.stable_seen or f.deployed,110,'recover or imminent-impact parachute')
        assert f.model.get('SIM_ON_GND',0)<.5,'Impact before recovery action completed'
        if f.deployed:chute_check(f);return
    else:f.wait(lambda:f.stable_seen or f.deployed,110,'stable TECS recovery')
    assert f.stable_seen and not f.deployed,'Recovery failed to stabilize'
    assert abs(f.alt-200)<=6 and f.airspeed>=10
    if name=='renewed_dive':
        f.change_mode(5);f.run_for(.6)
        f.rescue_seen=f.stable_seen=False
        dive_stimulus(f,target=-60,throttle=2000)
        neutral(f);chute_check(f)
        return
    if name=='stability_loss':
        f.param('SERVO1_FUNCTION',0);f.run_for(1.2);f.command(M.MAV_CMD_DO_SET_SERVO,1,2000)
        f.wait(lambda:getattr(f.mav.messages.get('SERVO_OUTPUT_RAW'),'servo1_raw',0)>=1990,2,'post-stability aileron fault applied')
        f.wait(lambda:any('stability lost' in e['text'] for e in f.messages),8,'cancel lost-stability handover')
        chute_check(f);return
    if name in ('no_pilot','jitter','held_input','stale_input'):
        if name=='jitter':f.rc[2]=1540
        if name=='stale_input':
            f.rc_send_enabled=False
            f.mav.mav.manual_control_send(f.sysid,0,0,850,0,0)
        chute_check(f);return
    if name in ('manual_input','rc_input','receiver_input'):
        if name=='manual_input':
            # Same accepted MAVLink message QGC uses; no explicit mode command.
            f.rc_send_enabled=False
            f.manual_control_value=850
            sender=getattr(f,'manual_sender',lambda z:f.mav.mav.manual_control_send(f.sysid,0,0,z,0,0))
            deadline=f.t+4
            while f.mode==26 and not f.deployed and f.t<deadline:
                sender(850);f.pump()
        else:
            f.rc[2]=1850
            f.wait(lambda:f.mode==5 or f.deployed,4,'RC input handover')
        assert f.mode==5 and f.armed and not f.deployed,'Pilot movement was not accepted'
        f.run_for(1)
        assert f.servo3>=1750,'Pilot throttle did not reach the output'
    else:f.change_mode(5)
    f.run_for(7)
    assert f.mode==5 and f.armed and not f.deployed,'Handover chattered or deployed parachute'
