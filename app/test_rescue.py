"""Real ArduPlane SITL acceptance tests; no mocked sensor/state machine inputs."""
from datetime import datetime
import argparse
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import traceback

HERE = Path(__file__).resolve().parent
WORK = HERE.parent.parent / 'work'
sys.path.insert(0, str(WORK / 'pydeps'))
sys.path.insert(0, str(HERE / 'pydeps'))
from pymavlink import mavutil

M = mavutil.mavlink
SITE = json.loads((HERE/'test-site.json').read_text(encoding='utf-8'))
HOME = (SITE['lat'], SITE['lon'], SITE['elevation_m'], SITE['heading'])
NAMES = {0:'MANUAL',1:'CIRCLE',2:'STABILIZE',3:'TRAINING',4:'ACRO',5:'FBWA',6:'FBWB',7:'CRUISE',8:'AUTOTUNE',10:'AUTO',11:'RTL',12:'LOITER',13:'TAKEOFF',14:'AVOID_ADSB',15:'GUIDED',17:'QSTABILIZE',18:'QHOVER',19:'QLOITER',20:'QLAND',21:'QRTL',22:'QAUTOTUNE',23:'QACRO',24:'THERMAL',25:'LOITER_ALT_QLAND',26:'RESCUE'}

def valid_position(lat, lon, reference):
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    # Initial EKF placeholders may drift slightly around 0,0. An actual plane
    # cannot move 25 km between consecutive telemetry packets.
    north = (lat-reference[0])*111320
    east = (lon-reference[1])*111320*math.cos(math.radians(reference[0]))
    return math.hypot(north,east) < 25000

def posix(path):
    path = Path(path).resolve()
    return '/cygdrive/' + path.drive[0].lower() + path.as_posix()[2:]

class Flight:
    def __init__(self, name, overrides=None, binary=None, port=5760, instance=0, qgc_port=None,
                 gcs_system=255, gcs_component=190, rc_in_port=None):
        self.name = name
        self.sysid = int((overrides or {}).get('SYSID_THISMAV', 1))
        self.speedup = float((overrides or {}).get('SIM_SPEEDUP',4))
        self.dir = HERE / 'runs' / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.rc = [1500, 1500, 1000, 1500, 1500, 1500, 1500, 1500]
        self.last_rc = self.last_hb = 0
        self.rc_send_enabled = True
        self.hold_mode_channel = True
        self.manual_control_value = None
        self.raw_rc_sender = None
        self.rc_input = []
        self.t = 0
        self.mode = None
        self.armed = False
        self.alt = self.vz = self.airspeed = self.roll = self.pitch = 0
        self.servo9 = self.servo3 = 0
        self.model = {}
        self.lat, self.lon = HOME[:2]
        self.position_valid = False
        self.yaw = self.groundspeed = self.heading = 0
        self.messages = []
        self.rows = []
        self.last_row = -1
        self.rescue_seen = self.deployed = self.stable_seen = False
        self.fault = False
        self.fault_released = False
        self.stdout = (self.dir / 'sitl-console.txt').open('w', encoding='utf-8')
        params = HERE / 'rescue.parm'
        runparams = self.dir / 'scenario.parm'
        runparams.write_text(params.read_text() + ''.join(f'{k} {v}\n' for k,v in (overrides or {}).items()))
        env = os.environ.copy()
        env['PATH'] = str(WORK / 'cygwin' / 'bin') + os.pathsep + env.get('PATH', '')
        exe = binary or (HERE/'bin'/'arduplane.exe' if (HERE/'bin'/'arduplane.exe').exists()
                         else WORK/'ardupilot'/'build'/'sitl'/'bin'/'arduplane.exe')
        if not Path(exe).exists():
            exe = Path(str(exe).removesuffix('.exe'))
        options = ['--base-port',str(port),'-I',str(instance)] if instance else []
        if qgc_port is not None:
            options += ['--serial1',f'udpclient:127.0.0.1:{qgc_port}']
        if rc_in_port is not None:options+=['--rc-in-port',str(rc_in_port)]
        self.proc = subprocess.Popen([str(exe), *options, '-w', '--model', 'plane-elevrev',
                                     '--home', ','.join(map(str, HOME)), '--speedup', str(self.speedup),
                                     '--defaults', posix(runparams), '--serial0', f'tcp:{port}:wait'],
                                    cwd=self.dir, env=env, stdout=self.stdout,
                                    stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        deadline = time.monotonic() + 30
        while True:
            if self.proc.poll() is not None:
                raise RuntimeError(f'SITL exited {self.proc.returncode}; see {self.dir}/sitl-console.txt')
            try:
                self.mav = mavutil.mavlink_connection(f'tcp:127.0.0.1:{port}', source_system=gcs_system, source_component=gcs_component)
                break
            except (OSError, socket.error):
                if time.monotonic() >= deadline:
                    raise TimeoutError('SITL TCP startup timeout')
                time.sleep(0.2)
        self.wait(lambda: self.mode is not None, 20, 'heartbeat')
        self.mav.mav.request_data_stream_send(self.sysid, 1, M.MAV_DATA_STREAM_ALL, 20, 1)
        self.wait(lambda: self.t > 5, 30, 'initial sensors')

    def pump(self):
        wall = time.monotonic()
        if wall - self.last_rc > 0.08 / self.speedup:
            if self.raw_rc_sender:self.raw_rc_sender()
            elif self.rc_send_enabled:self.mav.mav.rc_channels_override_send(self.sysid, 1, *self.rc)
            elif self.hold_mode_channel:
                # Keep the simulator's mode switch steady while leaving all
                # flight axes untouched for QGC MANUAL_CONTROL messages.
                self.mav.mav.rc_channels_override_send(self.sysid,1,*([65535]*7+[self.rc[7]]))
            if self.manual_control_value is not None:
                sender=getattr(self,'manual_sender',lambda z:self.mav.mav.manual_control_send(self.sysid,0,0,z,0,0))
                sender(self.manual_control_value)
            self.last_rc = wall
        if wall - self.last_hb > 0.2:
            self.mav.mav.heartbeat_send(M.MAV_TYPE_GCS, M.MAV_AUTOPILOT_INVALID, 0, 0, 0)
            self.last_hb = wall
        msg = self.mav.recv_match(blocking=True, timeout=0.04)
        if msg is None:
            if self.proc.poll() is not None:
                raise RuntimeError('SITL terminated during flight')
            return
        typ = msg.get_type()
        if hasattr(msg, 'time_boot_ms'):
            self.t = max(self.t, msg.time_boot_ms / 1000)
        if typ == 'HEARTBEAT' and msg.type != M.MAV_TYPE_GCS:
            self.mode = msg.custom_mode
            self.armed = bool(msg.base_mode & M.MAV_MODE_FLAG_SAFETY_ARMED)
            self.rescue_seen |= self.mode == 26
        elif typ == 'GLOBAL_POSITION_INT':
            self.alt, self.vz = msg.relative_alt / 1000, msg.vz / 100
            # Before EKF/GPS origin initialization ArduPlane emits 0,0.
            # Retain the known launch reference until an actual position exists.
            lat, lon = msg.lat / 1e7, msg.lon / 1e7
            if valid_position(lat,lon,(self.lat,self.lon)):
                self.lat, self.lon = lat, lon
                self.position_valid = True
        elif typ == 'VFR_HUD':
            self.airspeed = msg.airspeed
            self.groundspeed, self.heading = msg.groundspeed, msg.heading
        elif typ == 'ATTITUDE':
            self.roll, self.pitch = math.degrees(msg.roll), math.degrees(msg.pitch)
            self.yaw = math.degrees(msg.yaw)
        elif typ == 'NAMED_VALUE_FLOAT':
            self.model[msg.name.rstrip('\0')] = msg.value
        elif typ == 'RC_CHANNELS':
            self.rc_input = [getattr(msg, 'chan'+str(i)+'_raw') for i in range(1,9)]
        elif typ == 'SIMSTATE':
            self.model['SIM_ROLL'] = math.degrees(msg.roll)
            self.model['SIM_PITCH'] = math.degrees(msg.pitch)
            self.model['SIM_YAW'] = math.degrees(msg.yaw)
            lat, lon = msg.lat / 1e7, msg.lng / 1e7
            if valid_position(lat,lon,(self.model.get('SIM_LAT',HOME[0]),self.model.get('SIM_LON',HOME[1]))):
                self.model['SIM_LAT'], self.model['SIM_LON'] = lat, lon
        elif typ == 'SERVO_OUTPUT_RAW':
            self.servo9, self.servo3 = msg.servo9_raw, msg.servo3_raw
        elif typ == 'STATUSTEXT':
            text = msg.text.rstrip('\0')
            self.messages.append({'time_s': self.t, 'severity': msg.severity, 'text': text,
                                  'received_at_ms': time.time_ns() // 1_000_000,
                                  'received_at': datetime.now().astimezone().isoformat(timespec='milliseconds')})
            if 'RESCUE' in text or 'Parachute' in text or 'armed' in text or 'Arm:' in text:
                print(f'[{self.name} {self.t:.2f}s] {text}', flush=True)
            if 'controls captured' in text:
                self.rescue_seen = True
            if 'aircraft stabilized' in text:
                self.stable_seen = True
            if 'BANG!' in text:
                self.deployed = True
        if self.rescue_seen and self.fault and not self.fault_released:
            # Restore a deliberately deflected elevator after autopilot takeover.
            # The rescue logic receives real model accelerations, never injected state.
            self.mav.mav.param_set_send(self.sysid, 1, b'SERVO2_FUNCTION', 19, M.MAV_PARAM_TYPE_REAL32)
            self.fault_released = True
        if self.t - self.last_row >= 0.1:
            self.rows.append({'t': self.t, 'mode': self.mode, 'armed': self.armed,
                              'alt': self.alt, 'vz': self.vz, 'airspeed': self.airspeed,
                              'roll': self.roll, 'pitch': self.pitch,
                              'motor_pwm': self.servo3, 'chute_pwm': self.servo9,
                              'canopy': self.model.get('SIM_CHUTE',0),
                              'true_alt': self.model.get('SIM_ALT'),
                              'agl': self.model.get('SIM_AGL'),
                              'ground_alt': self.model.get('SIM_GND'),
                              'on_ground': self.model.get('SIM_ON_GND'),
                              'true_vz': self.model.get('SIM_VZ'),
                              'aoa': self.model.get('SIM_AOA'),
                              'density': self.model.get('SIM_RHO'),
                              'rc_input': self.rc_input[:],
                              'rsc': {k:v for k,v in self.model.items() if k.startswith('RSC_')}})
            self.last_row = self.t

    def wait(self, condition, seconds=30, label='condition'):
        wall_limit = time.monotonic() + max(15, seconds / self.speedup * 1.8)
        sim_start = self.t
        while not condition():
            self.pump()
            if self.t - sim_start > seconds or time.monotonic() > wall_limit:
                raise TimeoutError(f'{label}: t={self.t:.1f}, mode={self.mode}, alt={self.alt:.1f}, '
                                   f'v={self.airspeed:.1f}, roll={self.roll:.1f}, pitch={self.pitch:.1f}')

    def run_for(self, seconds):
        end = self.t + seconds
        self.wait(lambda: self.t >= end, seconds+5, 'flight duration')

    def param(self, name, value):
        self.mav.mav.param_set_send(self.sysid, 1, name.encode(), value, M.MAV_PARAM_TYPE_REAL32)
        start = time.monotonic()
        while time.monotonic() - start < 5:
            self.pump()
            msg = self.mav.messages.get('PARAM_VALUE')
            if msg and msg.param_id == name and abs(msg.param_value - value) < 0.01:
                return
        raise TimeoutError('parameter acknowledgement ' + name)

    def command(self, command, *values):
        self.mav.mav.command_long_send(self.sysid, 1, command, 0, *(list(values) + [0] * (7-len(values))))

    def change_mode(self, mode):
        self.mav.mav.set_mode_send(self.sysid, M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, mode)
        self.wait(lambda: self.mode == mode, 10, 'mode ' + NAMES.get(mode,str(mode)))

    def takeoff(self, altitude=80):
        self.param('TKOFF_ALT', altitude)
        self.change_mode(13)
        # Wait for normal EKF/GPS readiness, retaining the stock arming checks.
        self.run_for(10)
        deadline=self.t+60
        last_request=-10
        while not self.armed:
            if self.t-last_request>=2:
                self.command(M.MAV_CMD_COMPONENT_ARM_DISARM,1)
                last_request=self.t
            self.pump()
            if self.t>deadline:
                raise TimeoutError('Normal arming checks did not become ready')
        self.rc[2] = 2000
        self.wait(lambda: self.alt >= altitude - 3, 90, 'takeoff height')
        self.change_mode(5)
        self.rc[1] = 1500
        self.rc[2] = 1500
        self.run_for(3)

    def upload_auto(self):
        # Home plus a distant straight waypoint at current altitude.
        # Keep the route aligned with the configured site's takeoff heading.
        bearing=math.radians(HOME[3])
        route_lat=HOME[0]+8000*math.cos(bearing)/111320
        route_lon=HOME[1]+8000*math.sin(bearing)/(111320*math.cos(math.radians(HOME[0])))
        items = [
            (0, M.MAV_CMD_NAV_WAYPOINT, HOME[0], HOME[1], 0),
            (1, M.MAV_CMD_NAV_WAYPOINT, route_lat, route_lon, max(self.alt,60)),
            (2, M.MAV_CMD_NAV_LOITER_UNLIM, route_lat, route_lon, max(self.alt,60))]
        self.mav.mav.mission_clear_all_send(self.sysid,1)
        self.mav.mav.mission_count_send(self.sysid,1,len(items))
        deadline = time.monotonic()+10
        sent = set()
        while len(sent)<len(items):
            self.pump()
            for typ in ('MISSION_REQUEST_INT','MISSION_REQUEST'):
                msg=self.mav.messages.get(typ)
                if msg and msg.seq not in sent:
                    seq,cmd,lat,lon,alt=items[msg.seq]
                    self.mav.mav.mission_item_int_send(self.sysid,1,seq,M.MAV_FRAME_GLOBAL_RELATIVE_ALT,
                        cmd,1 if seq==1 else 0,1,0,0,0,0,int(lat*1e7),int(lon*1e7),alt)
                    sent.add(seq)
            if time.monotonic()>deadline: raise TimeoutError('mission upload')
        self.mav.mav.mission_set_current_send(self.sysid,1,1)
        self.run_for(1)
        self.change_mode(10)

    def dive(self, auto=False):
        if auto:
            self.upload_auto()
            self.run_for(2)
            self.param('SERVO2_FUNCTION', 0)
            # Let the output mapping settle before latching the actuator fault.
            # A parameter echo alone does not prove the servo output changed.
            self.run_for(1.2)
            self.command(M.MAV_CMD_DO_SET_SERVO, 2, 2000)
            self.fault = True
        else:
            self.change_mode(0)
            self.rc[1] = 2000
            self.rc[2] = 1300

    def close(self):
        try:
            # Stop producing logs after the assertions; allow the file backend to drain.
            self.mav.mav.param_set_send(self.sysid,1,b'LOG_BITMASK',0,M.MAV_PARAM_TYPE_REAL32)
            end=time.monotonic()+3
            while time.monotonic()<end:self.pump()
        except Exception: pass
        try: self.mav.close()
        except Exception: pass
        self.proc.terminate()
        try: self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired: self.proc.kill(); self.proc.wait()
        self.stdout.close()
        if hasattr(self,'receiver_socket'):self.receiver_socket.close()
        (self.dir/'telemetry.json').write_text(json.dumps(self.rows,indent=2))
        (self.dir/'messages.json').write_text(json.dumps(self.messages,indent=2))

def scenario(name, binary=None, run_group=None, port=5760, instance=0):
    overrides = {'RSC_ENABLE': 0} if name in ('disabled','stock') else {}
    folder=(str(Path(run_group)/name) if run_group else name)
    f=Flight(folder,overrides,binary,port=port,instance=instance)
    result={'scenario':name,'passed':False}
    try:
        if name=='warning':
            f.takeoff(160)
            f.dive()
            f.wait(lambda:any('RESCUE WARNING:' in x['text'] for x in f.messages),15,'warning')
            assert f.mode==0 and not f.rescue_seen, 'Warning changed flight mode'
            f.change_mode(5)
            f.rc[1]=1300; f.rc[2]=2000
            f.run_for(3)
            assert not f.rescue_seen, 'Warning alone captured controls'
        elif name in ('manual','auto','handover','no_pilot','failed'):
            f.takeoff(80)
            if name=='failed':
                f.param('SIM_ENGINE_FAIL',2)
                f.param('SIM_ENGINE_MUL',0)
            f.dive(auto=name=='auto')
            f.wait(lambda:f.rescue_seen,15,'automatic RESCUE capture')
            f.rc[1]=1500; f.rc[2]=1500
            if name=='failed':
                f.wait(lambda:f.deployed,80,'failed recovery parachute')
                assert not f.stable_seen, 'Failed aircraft incorrectly declared stable'
            else:
                f.wait(lambda:f.stable_seen,105,'stable recovery')
                assert abs(f.alt-200)<=8, 'Recovered at incorrect height'
                assert f.airspeed>=10, 'Unsafe airspeed at stabilization'
                if name in ('manual','auto','handover'):
                    f.change_mode(5)
                    f.run_for(12)
                    assert not f.deployed and f.armed, 'Handover deployed parachute/disarmed'
                    assert f.mode==5, 'Recovery chattered after handover'
                else:
                    f.wait(lambda:f.deployed,10,'unanswered handover parachute')
            if name in ('failed','no_pilot'):
                f.wait(lambda:not f.armed,5,'parachute disarm')
                f.run_for(1)
                assert f.servo9>=1800, 'Chute actuator did not activate'
                assert f.servo3<=1000, 'Motor output not stopped'
        elif name in ('disabled','stock'):
            f.takeoff(80)
            f.dive()
            f.run_for(3)
            assert f.mode==0 and f.armed and not f.rescue_seen and not f.deployed
            assert not any('RESCUE' in x['text'] for x in f.messages)
        elif name=='ground':
            f.mav.mav.set_mode_send(f.sysid,M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,26)
            f.run_for(2)
            assert f.mode!=26 and not f.armed and not f.deployed, 'Ground/disarmed entered rescue'
        else:
            raise ValueError(name)
        result.update(passed=True, end_time_s=f.t,
                      captured=f.rescue_seen, stabilized=f.stable_seen, parachute=f.deployed)
    except Exception as e:
        result.update(error=str(e),traceback=traceback.format_exc())
        print('FAIL',name,str(e),flush=True)
    finally:
        f.close()
    (f.dir/'result.json').write_text(json.dumps(result,indent=2))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--scenario',default='all')
    p.add_argument('--binary')
    p.add_argument('--run-group',help='Preserve this suite below a unique runs subfolder')
    args=p.parse_args()
    names=['ground','warning','manual','auto','handover','no_pilot','failed','disabled'] if args.scenario=='all' else args.scenario.split(',')
    results=[]
    for name in names:
        try: results.append(scenario(name,args.binary,args.run_group))
        except Exception as e:
            print('STARTUP FAIL',name,str(e),flush=True)
            results.append({'scenario':name,'passed':False,'error':str(e),'traceback':traceback.format_exc()})
    result_dir=HERE/'runs'/args.run_group if args.run_group else HERE
    result_dir.mkdir(parents=True,exist_ok=True)
    (result_dir/'test-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2),flush=True)
    sys.exit(0 if all(r['passed'] for r in results) else 1)
