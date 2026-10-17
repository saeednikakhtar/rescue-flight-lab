"""Persistent local flight laboratory. Every control goes to actual ArduPlane SITL."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import queue
import re
import threading
import time
import uuid
import io
import zipfile
import hashlib
from urllib.parse import parse_qs, urlsplit
from test_rescue import Flight, NAMES, M, SITE
from qgc_link import QGCLink
from scenario_bank import BY_ID, PRIMARY, ACCEPTANCE_CASES, acceptance_flights, exercise, overrides, capture
from verify_scenario import verify
from flight_reports import build_report, list_reports, queue_report, session_metadata

HERE = Path(__file__).resolve().parent
lock = threading.RLock()
commands = queue.Queue()
stop = threading.Event()
take = threading.Event()
API_REVISION = 9
state = dict(api_revision=API_REVISION, generation=0, source='sitl', site=SITE, running=False, connected=False, phase='Ready to launch', flight=None,
             history=[], messages=[], stable=False, handover=False, deployed=False,
             busy=False, cycle=0, rsc_state='MONITOR', countdown=None, error=None,
             engine='ArduPlane 4.6.3 SITL', model='Native fixed-wing + progressive canopy drag',
             physics=dict(mass_kg=2, cd_area_m2=1.3, opening_s=1.5),
             controls=dict(roll=0, pitch=0, rudder=0, throttle=50), controller_owner=None, speedup=1,
             developer='Saeed Nik',developer_fa='سعید نیک',release='3.0',
             tests=dict(active=False,cases=ACCEPTANCE_CASES,results=[],current=None), evidence=None,
             decision={},input_source='Scenario / panel',impact=None,
             alert=dict(level='idle', title='SIMULATOR OFFLINE', detail='Launch a flight to connect to SITL.'))
qgc = QGCLink(HERE)

def significant_ground_impact(event):
    # The native plane model can bounce and keep flying after a hard strike.
    # Keep that evidence visible instead of calling a later recovery a success.
    match=re.fullmatch(r'SIM Hit ground at ([+-]?[\d.]+) m/s',event.get('text',''))
    if not match:return None
    speed=abs(float(match[1]))
    if speed<8:return None
    return dict(time_s=event['time_s'],vertical_speed_m_s=speed,
                received_at=event.get('received_at'),received_at_ms=event.get('received_at_ms'))
try:
    saved_tests=json.loads((HERE/'latest-panel-tests.json').read_text())
    if saved_tests.get('binary_sha256')==hashlib.sha256((HERE/'bin/arduplane.exe').read_bytes()).hexdigest():
        state['tests']={**saved_tests,'active':False,'current':None,'cases':ACCEPTANCE_CASES}
        finished=saved_tests.get('results',[])
        if finished:state['evidence']=finished[-1].get('session')
except (OSError,ValueError):pass

class Stopped(Exception):
    pass

class LiveFlight(Flight):
    def __init__(self, speedup, name=None, settings=None):
        self.seen_messages = 0
        self.stable_at = None
        self.last_take = 0
        self.last_update = 0
        self.graph_at = -1
        self.graph_rows = []
        self.controller_at = 0
        self.ui_rc = False
        self.script_rc = False
        self.receiver_port = 5850
        session=name or 'live-'+time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]
        qgc.start()
        qgc.begin_session(session)
        super().__init__(session, {**(settings or {}),'SIM_SPEEDUP':speedup,'HOME_RESET_ALT':-1,
                         'SERIAL1_PROTOCOL':2,'SYSID_THISMAV':2},port=5800,instance=1,qgc_port=qgc.vehicle_port,
                         gcs_system=255,gcs_component=191,rc_in_port=self.receiver_port)

    def pump(self):
        if stop.is_set(): raise Stopped()
        scripted=state['tests'].get('active') and state['tests'].get('current') in ('manual_input','rc_input','receiver_input','jitter','held_input','stale_input','renewed_dive')
        ground_manual=state.get('manual_ground',False)
        qgc.block_pilot=False if ground_manual else scripted or (state['busy'] and self.mode!=26)
        # Idle panel overrides must not overwrite QGC's virtual joystick.
        external=time.monotonic()-qgc.pilot_input_at<1.0
        self.rc_send_enabled=False if ground_manual else self.script_rc or self.ui_rc or (state['busy'] and self.mode!=26) or (self.mode!=26 and not external)
        self.hold_mode_channel=not ground_manual
        state['input_source']='Automated test' if qgc.block_pilot else 'Panel controller' if self.ui_rc else 'QGroundControl' if external else 'Scenario / receiver'
        if state.get('auto_handover') and self.stable_seen and self.mode == 26 and not self.deployed and state['rsc_state'] != 'CHUTE':
            take.set()
        if self.ui_rc and time.monotonic()-self.controller_at > 1.0:
            self.rc[0] = self.rc[1] = self.rc[3] = 1500
        if take.is_set() and self.stable_seen and self.mode == 26 and not self.deployed:
            if time.monotonic()-self.last_take > 0.2:
                self.rc = [1500,1500,1500,1500,1500,1500,1500,1500]
                self.mav.mav.set_mode_send(self.sysid, M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, 5)
                self.last_take = time.monotonic()
        super().pump()
        for e in self.messages[self.seen_messages:]:
            text = e['text']
            impact=significant_ground_impact(e)
            if impact and not state.get('impact'):
                state['impact']=impact
            match = re.search(r'RESCUE state (\d+)',text)
            if match and int(match[1]) < 6:
                state['rsc_state'] = ['MONITOR','WARNING','RECOVER','STABILIZED','CHUTE','COOLDOWN'][int(match[1])]
                if int(match[1])==2:
                    self.stable_seen=False;self.stable_at=None
                    self.ui_rc=False
                    state.update(handover=False,stable=False,countdown=None,controller_owner=None)
            if 'aircraft stabilized' in text: self.stable_at = e['time_s']
        self.seen_messages = len(self.messages)
        if self.stable_seen and self.mode in (0,5,10,12) and state['rsc_state']=='COOLDOWN' and not state['handover']:
            take.clear()
            state.update(handover=True, phase='Pilot control · '+NAMES.get(self.mode,str(self.mode)), busy=False)
        if self.mode==26 and not state['busy']:
            state['phase']='Parachute descent · controls disabled' if self.deployed else 'Automatic RESCUE · waiting for stabilization'
        elif ground_manual and not state['busy']:
            state['phase']=('On ground · ' if self.model.get('SIM_ON_GND',1)>.5 else 'Pilot control · ')+NAMES.get(self.mode,str(self.mode))+' · QGroundControl'
        if time.monotonic()-self.last_update < .08: return
        self.last_update = time.monotonic()
        if self.t-self.graph_at>=.5:
            self.graph_rows=[{k:row[k] for k in ('t','alt','true_alt','mode','chute_pwm')}
                             for row in self.rows[-1500::5]]
            self.graph_at=self.t
        remaining = max(0,qgc.handover_seconds-(self.t-self.stable_at)) if self.stable_at and self.mode == 26 and not self.deployed and state['rsc_state'] != 'CHUTE' else None
        canopy = self.model.get('SIM_CHUTE',0)
        d = dict(session_id=self.name, t=self.t, alt=self.alt, vz=self.vz, airspeed=self.airspeed, groundspeed=self.groundspeed,
                 roll=self.model.get('SIM_ROLL',self.roll), pitch=self.model.get('SIM_PITCH',self.pitch),
                 yaw=self.model.get('SIM_YAW',self.yaw), heading=self.heading,
                 lat=self.model.get('SIM_LAT',self.lat), lon=self.model.get('SIM_LON',self.lon), armed=self.armed,
                 position_valid='SIM_LAT' in self.model or self.position_valid,
                 motor_pwm=self.servo3, chute_pwm=self.servo9, canopy=canopy,
                 aoa=self.model.get('SIM_AOA'), density=self.model.get('SIM_RHO'),
                 true_alt=self.model.get('SIM_ALT'), true_vz=self.model.get('SIM_VZ'),
                 agl=self.model.get('SIM_AGL'), ground_alt=self.model.get('SIM_GND'),
                 on_ground=None if 'SIM_ON_GND' not in self.model else self.model['SIM_ON_GND']>.5,
                 system_id=self.sysid, mode_name=NAMES.get(self.mode,str(self.mode)))
        risk=int(self.model.get('RSC_RISK',0))
        state['decision']=dict(accel_down=self.model.get('RSC_AZ'),sink=self.model.get('RSC_VZ'),
                              descent_loss=self.model.get('RSC_DLOSS'),descent_seconds=self.model.get('RSC_DTIME'),
                              rotation=self.model.get('RSC_RATE'),height_gain=self.model.get('RSC_GAIN'),
                              time_to_home=self.model.get('RSC_TTC'),risk=risk,
                              causes=[label for bit,label in [(1,'accelerating descent'),(2,'high sink rate'),(4,'attitude loss'),(8,'rapid rotation'),(16,'imminent datum crossing'),(32,'sustained sink inside impact margin')] if risk&bit],
                              rc_input=self.rc_input)
        if state.get('impact'):
            impact=state['impact']
            alert=dict(level='danger',title=f"GROUND IMPACT · {impact['vertical_speed_m_s']:.1f} m/s",
                       detail=f"Impact recorded at T + {impact['time_s']:.1f}s. Later motion may be model rebound; restart for a fresh trial.")
        elif self.deployed:
            alert = dict(level='danger',title='PARACHUTE DEPLOYED · MOTOR CUT',detail='Canopy '+str(round(canopy*100))+'% open. Tracking the physical SITL descent.')
        elif remaining is not None:
            alert = dict(level='warning',title='TAKE CONTROL NOW',detail=f'{remaining:.1f}s left. Change flight mode or move a stick / throttle deliberately to take FBWA control.')
        elif state['rsc_state'] == 'CHUTE':
            alert = dict(level='danger',title='DANGER · PARACHUTE RELEASE',detail='Motor disarmed. Waiting for the configured release delay and canopy inflation.')
        elif self.mode == 26:
            alert = dict(level='danger',title='DANGER · RESCUE HAS CONTROL',detail='Automatic recovery to 200 m. Pilot inputs are locked until stabilized.')
        elif state['rsc_state'] == 'WARNING':
            alert = dict(level='danger',title='DANGER · UNSAFE DESCENT',detail='ArduPlane detected '+(', '.join(state['decision']['causes']) or 'sustained unsafe descent')+'. Automatic capture below 100 m: acceleration rule or the additional persistent impact-risk safeguard.')
        elif self.armed and self.alt<100 and self.model.get('RSC_VZ',0)>5 and not risk&33:
            alert=dict(level='warning',title='FAST DESCENT · PILOT HAS CONTROL',
                       detail='Monitoring sustained descent, acceleration and time to Home. A demonstrated pull-out with stopping clearance suppresses the additional impact safeguard.')
        elif self.armed and self.mode in (0,5) and self.alt>20 and self.airspeed<13 and self.servo3<=1050:
            alert=dict(level='warning',title='LOW AIRSPEED · THROTTLE AT IDLE',
                       detail='In MANUAL / FBWA you control throttle. Automatic TAKEOFF power does not carry over; add power and avoid excessive pitch.')
        elif self.armed and self.alt > 20 and self.airspeed < 10:
            alert = dict(level='warning',title='LOW AIRSPEED · STALL RISK',detail='Increase speed or let the autopilot recover.')
        else:
            alert = dict(level='safe',title='LIVE SITL · '+NAMES.get(self.mode,str(self.mode)),detail=state['phase'])
        with lock:
            state.update(connected=True, flight=d, stable=self.stable_seen,
                         deployed=self.deployed, countdown=remaining, alert=alert,
                         history=self.graph_rows, messages=self.messages[-120:])

    def reset_cycle(self):
        self.rescue_seen = self.stable_seen = False
        self.stable_at = None
        take.clear()
        state.update(stable=False,handover=False,countdown=None)

def prepare(f, target=240):
    state.update(busy=True, controller_owner=None, phase='Repositioning in the sky · climbing to 240 m')
    f.ui_rc = False
    f.change_mode(5)
    f.rc = [1500,1350,2000,1500,1500,1500,1500,1500]
    if f.alt < target-5: f.wait(lambda:f.alt >= target-5,100,'in-air climb')
    f.rc[1] = 1500; f.rc[2] = 1500
    f.change_mode(12)
    f.run_for(15)
    f.reset_cycle()
    state.update(busy=False, phase='Airborne · ready for another dive')

def dive(f, failure=False):
    f.ui_rc = False
    f.reset_cycle()
    state.update(busy=True,controller_owner=None,cycle=state['cycle']+1,phase='Test dive · descending toward the 100 m capture threshold')
    if failure:
        f.param('SIM_ENGINE_FAIL',2); f.param('SIM_ENGINE_MUL',0)
        state['phase']='Engine failure · unpowered dive'
    capture(f)
    f.rc[0]=f.rc[1]=f.rc[3]=1500; f.rc[2]=1500
    state['phase']='Automatic recovery · target 200 m'
    f.wait(lambda:f.stable_seen or f.deployed,110,'recovery or chute')
    if f.stable_seen and not f.deployed:
        state['phase']='Stabilized · take pilot control within 5 seconds'
        # The firmware owns recovery/handover deadlines. A lost-stability cycle
        # or a valid longer HAND_S must not kill SITL and its QGC heartbeat.
        f.wait(lambda:f.mode!=26 or f.deployed,180,'handover or parachute')
    state['busy']=False
    if f.deployed: state['phase']='Parachute descent · controls disabled'

def test_worker(ids,speedup):
    # A fresh native process and parameter storage for each case; the UDP relay
    # stays alive across cases so QGC keeps its configured connection.
    stop.set()
    deadline=time.monotonic()+20
    while state['running'] and time.monotonic()<deadline:time.sleep(.1)
    if state['running']:
        state['tests']['active']=False;state['error']='Previous flight did not stop';return
    stop.clear();take.clear()
    group='panel-tests-'+time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    tests=dict(active=True,cases=ACCEPTANCE_CASES,results=[],current=None,requested=ids,group=group,
               binary_sha256=hashlib.sha256((HERE/'bin/arduplane.exe').read_bytes()).hexdigest())
    state['tests']=tests
    for index,name in enumerate(ids):
        f=None;case=dict(scenario=name,passed=False)
        tests['current']=name
        state.update(running=True,connected=False,busy=True,error=None,flight=None,history=[],messages=[],
                     stable=False,handover=False,deployed=False,countdown=None,auto_handover=False,manual_ground=False,
                     controller_owner=None,cycle=index+1,rsc_state='MONITOR',evidence=None,
                     generation=state['generation']+1,speedup=speedup,impact=None,phase='Starting test: '+BY_ID[name]['title'])
        try:
            f=LiveFlight(speedup,group+'/'+name,overrides(name))
            session_metadata(f,'scenario',name,speedup)
            f.script_rc=name in ('rc_input','jitter','held_input')
            exercise(f,name,lambda text:state.update(phase=text))
            case['flight_assertions']=True
        except Stopped:case.update(cancelled=True,error='Stopped by operator')
        except Exception as exc:case['error']=str(exc)
        finally:
            stop_requested=stop.is_set()
            if f:
                f.pump=Flight.pump.__get__(f,LiveFlight);f.close()
                try:
                    verified=verify(f,name)
                    case.update(verified)
                    case['passed']=verified['passed'] and case.get('flight_assertions',False)
                except Exception as exc:case.update(passed=False,error='Log verification: '+str(exc))
                case['session']=f.name
                case['overrides']=overrides(name)
                (f.dir/'result.json').write_text(json.dumps(case,indent=2))
                queue_report(f.name)
                state['evidence']=f.name
            qgc.end_session()
            qgc.block_pilot=False
            tests['results'].append(case)
            state.update(running=False,connected=False,busy=False,controller_owner=None)
            (HERE/'runs'/group/'suite-result.json').write_text(json.dumps(tests,indent=2))
            if stop_requested:break
    tests.update(active=False,current=None,passed=len(tests['results'])==len(ids) and all(c['passed'] for c in tests['results']))
    state['phase']='Test suite complete · '+str(sum(c['passed'] for c in tests['results']))+'/'+str(len(ids))+' passed'
    (HERE/'runs'/group/'suite-result.json').write_text(json.dumps(tests,indent=2))
    (HERE/'latest-panel-tests.json').write_text(json.dumps(tests,indent=2))
    stop.clear();take.clear()

def worker(speedup,altitude,ground_manual=False):
    f=None
    try:
        with lock:
            state.update(running=True,connected=False,error=None,busy=True,phase='Starting ArduPlane SITL · waiting for sensors',
                         flight=None,history=[],messages=[],stable=False,handover=False,deployed=False,
                         cycle=0,rsc_state='MONITOR',countdown=None,speedup=speedup,controller_owner=None,evidence=None)
        f=LiveFlight.__new__(LiveFlight)
        f.__init__(speedup)
        session_metadata(f,'manual' if ground_manual else 'demo',speedup=speedup)
        if ground_manual:
            # Ground practice must never arm, launch or keep sending idle stick
            # values over the pilot. QGC owns commands from the first heartbeat.
            state.update(busy=False,phase='On ground · manual QGroundControl session')
        else:
            state['phase']=f'Takeoff · climbing to {altitude} m'
            f.takeoff(altitude)
            f.change_mode(12)
            state.update(busy=False,phase='Airborne · select a test or fly with the controller')
        ground_at=None
        while not stop.is_set():
            f.pump()
            if not ground_manual and f.deployed and f.model.get('SIM_ON_GND',0)>.5:
                if ground_at is None:ground_at=f.t
                state['phase']='Ground contact · parachute test complete'
                if f.t-ground_at>3:break
            try: action,payload=commands.get_nowait()
            except queue.Empty:continue
            if action=='control' and not state['busy'] and not f.deployed and f.mode in (0,5):
                f.ui_rc=True;f.controller_at=time.monotonic()
                f.rc[0]=round(1500+payload['roll']*5)
                f.rc[1]=round(1500-payload['pitch']*5)
                f.rc[2]=round(1000+payload['throttle']*10)
                f.rc[3]=round(1500-payload['rudder']*5)
                state['controls']=payload
            elif action=='center':
                f.ui_rc=False;f.rc=[1500,1500,1500,1500,1500,1500,1500,1500]
            elif action=='dive' and not f.deployed: dive(f,payload.get('failure',False))
            elif action=='reposition' and not f.deployed: prepare(f)
            elif action=='mode' and not f.deployed:
                f.ui_rc=False;f.rc=[1500,1500,1500,1500,1500,1500,1500,1500]
                f.change_mode(payload['mode']);state['phase']='Pilot control · '+NAMES[payload['mode']]
            elif action=='wind' and not f.deployed:
                f.param('SIM_WIND_SPD',payload['speed']);f.param('SIM_WIND_DIR',payload['direction'])
                state['wind']=payload
    except Stopped: state['phase']='Flight stopped'
    except Exception as e:
        with lock:state.update(error=str(e),phase='Simulation stopped · see error',alert=dict(level='danger',title='SIMULATION ERROR',detail=str(e)))
    finally:
        stop.clear();take.clear()
        if f and hasattr(f,'proc'):
            # Drain logging without changing the UI or acknowledging a stopped flight.
            f.pump=Flight.pump.__get__(f,LiveFlight)
            f.close()
            state['evidence']=f.name
            queue_report(f.name)
        qgc.end_session()
        qgc.block_pilot=False
        with lock:
            state.update(running=False,connected=False,busy=False,controller_owner=None)
            if state['error']:
                state['alert']=dict(level='danger',title='SIMULATION ERROR',detail=state['error'])
            elif not state['deployed']:
                state['phase']='Flight stopped'
                state['alert']=dict(level='idle',title='SITL STOPPED',detail='Last received telemetry is held. Launch a new flight when ready.')

class Handler(BaseHTTPRequestHandler):
    def reply(self,body,mime='application/json; charset=utf-8',code=200,filename=None):
        data=body if isinstance(body,bytes) else json.dumps(body,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
        self.send_response(code);self.send_header('Content-Type',mime)
        if filename:self.send_header('Content-Disposition','attachment; filename="'+filename+'"')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        url=urlsplit(self.path)
        if url.path in ('/','/scene.js','/monitor.css','/monitor-ui.js','/reports-ui.js'):
            filename='monitor.html' if url.path=='/' else url.path[1:]
            mime='text/html' if filename.endswith('.html') else 'text/css' if filename.endswith('.css') else 'text/javascript'
            self.reply((HERE/filename).read_bytes(),mime+'; charset=utf-8')
        elif url.path=='/reports':
            self.reply({'reports':list_reports()})
        elif url.path in ('/report','/report/export'):
            session=parse_qs(url.query).get('session',[state.get('evidence')])[0]
            active=state['running'] and session==(state.get('flight') or {}).get('session_id')
            try:
                report=build_report(session,active=active,live_messages=state.get('messages',[])[:],live_flight=state.get('flight'))
                self.reply(report,filename='RESCUE-flight-report.json' if url.path.endswith('/export') else None)
            except (ValueError,OSError) as exc:
                self.reply({'error':str(exc)},code=404)
        elif url.path=='/logs/export':
            with lock:payload={k:state.get(k) for k in ('engine','flight','decision','input_source','messages','tests','evidence')}
            self.reply(payload,filename='RESCUE-events.json')
        elif url.path=='/evidence.zip':
            session=parse_qs(url.query).get('session',[state.get('evidence')])[0]
            run=(HERE/'runs'/str(session)).resolve()
            if not session or not run.is_relative_to((HERE/'runs').resolve()) or not run.is_dir():
                self.reply({'error':'Finished-flight evidence is not available yet'},code=404);return
            stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
                for path in run.rglob('*'):
                    if path.is_file() and path.suffix.lower() in ('.bin','.json','.csv','.txt','.parm') and path.name!='eeprom.bin':
                        archive.write(path,path.relative_to(run))
            self.reply(stream.getvalue(),'application/zip',filename='RESCUE-'+run.name+'-evidence.zip')
        elif url.path=='/tests':self.reply(state['tests'])
        elif url.path=='/state':
            # Snapshot under the lock, then encode/write outside it. A slow
            # browser must never hold up the live MAVLink flight loop.
            with lock:
                snapshot=state.copy()
            snapshot['qgc']=qgc.snapshot()
            query=parse_qs(url.query)
            if query:
                rows=snapshot['history']
                end=rows[-1]['t'] if rows else 0
                sparse=[];bucket=None
                for row in rows:
                    if row['t']<end-150:continue
                    current=int(row['t']*2)
                    if current==bucket:continue
                    bucket=current
                    sparse.append({k:row[k] for k in ('t','alt','true_alt','mode','chute_pwm')})
                session=(snapshot['flight'] or {}).get('session_id')
                try:after=float(query.get('after',['-1'])[0])
                except ValueError:after=-1
                delta=query.get('session',query.get('history_session',[None]))[0]==session and math.isfinite(after) and after>=0
                snapshot['history']=[row for row in sparse if row['t']>after] if delta else sparse
                snapshot['history_delta']=delta
                snapshot['history_session']=session
            self.reply(snapshot)
        else:self.reply({'error':'Not found'},code=404)
    def do_POST(self):
        origin=self.headers.get('Origin')
        if origin and origin!='http://127.0.0.1:8765':
            self.reply({'error':'Origin rejected'},code=403);return
        shutdown_requested=False
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<=length<=2048:raise ValueError('Invalid request length')
            p=json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(p,dict):raise ValueError('Expected an object')
            with lock:
                if self.path=='/source':
                    if p.get('source')!='sitl':raise ValueError('Only SITL tests are available')
                elif self.path.startswith('/hardware/'):
                    self.reply({'error':'Controller bench has been removed'},code=404);return
                elif self.path in ('/qgc/reconnect','/qgc/open'):
                    qgc.reconnect(open_app=True)
                elif self.path=='/shutdown':
                    if state['running']:
                        raise ValueError('Stop the flight before closing the server')
                    shutdown_requested=True
                elif self.path in ('/start','/start-ground'):
                    if state['tests']['active']:raise ValueError('A test suite is running')
                    if state['running']:raise ValueError('A flight is already running')
                    speed=float(p.get('speedup',1));alt=float(p.get('altitude',240))
                    if speed not in (1,2,4) or alt != 240:raise ValueError('Invalid start settings')
                    ground_manual=self.path=='/start-ground'
                    if ground_manual and speed!=1:raise ValueError('Manual ground practice requires real-time speed')
                    stop.clear();take.clear()
                    while not commands.empty():commands.get_nowait()
                    state.update(running=True,connected=False,flight=None,history=[],messages=[],evidence=None,
                                 impact=None,
                                 generation=state['generation']+1,busy=True,stable=False,handover=False,
                                 manual_ground=ground_manual,auto_handover=False,
                                 deployed=False,countdown=None,error=None,
                                 alert=dict(level='idle',title='STARTING SITL',detail='Waiting for current-flight telemetry.'),
                                 phase='Starting ArduPlane SITL · waiting for sensors')
                    threading.Thread(target=worker,args=(speed,alt,ground_manual),daemon=True).start()
                    if ground_manual:
                        threading.Thread(target=lambda:qgc.reconnect(open_app=True),daemon=True).start()
                elif self.path=='/tests/run':
                    if state['tests']['active']:raise ValueError('A test suite is already running')
                    # Do not expose engineering fault-injection cases in the
                    # acceptance panel, even if a caller supplies an old ID.
                    ids=acceptance_flights(p.get('scenario'))
                    speed=float(p.get('speedup',4))
                    if speed not in (1,2,4):raise ValueError('Invalid speed')
                    state['tests']={**state['tests'],'active':True,'results':[],'current':None}
                    threading.Thread(target=test_worker,args=(ids,speed),daemon=True).start()
                elif self.path=='/stop':stop.set()
                elif self.path=='/handover':
                    if not state['running'] or state['countdown'] is None:raise ValueError('Handover is only available after stabilization')
                    take.set()
                else:
                    if state.get('manual_ground') and self.path in ('/control','/claim','/mode','/dive','/reposition'):
                        raise ValueError('QGroundControl owns this manual test. Use its flight controls, or finish this session before starting a guided test.')
                    if state['source']!='sitl':raise ValueError('Flight controls are available in SITL Tests only')
                    if not state['running'] or not state['connected'] or state['busy'] or state['deployed'] or (state['flight'] and state['flight']['mode_name']=='RESCUE'):
                        raise ValueError('Control is unavailable during this flight phase')
                    if self.path=='/control':
                        if not state['controller_owner'] or p.get('client_id')!=state['controller_owner']:raise ValueError('Enable this controller first')
                        values={k:float(p[k]) for k in ('roll','pitch','rudder','throttle')}
                        if any(not -100<=values[k]<=100 for k in ('roll','pitch','rudder')) or not 0<=values['throttle']<=100:
                            raise ValueError('Control values out of range')
                        commands.put(('control',values))
                    elif self.path=='/claim':
                        token=p.get('client_id')
                        if not isinstance(token,str) or not 1<=len(token)<=64:raise ValueError('Invalid controller identity')
                        state['controller_owner']=token
                        commands.put(('center',{}))
                    elif self.path=='/mode':
                        if p.get('mode') not in (0,5,12):raise ValueError('Unsupported mode')
                        commands.put(('mode',p))
                    elif self.path=='/dive':
                        if not isinstance(p.get('failure',False),bool):raise ValueError('Invalid failure option')
                        if not isinstance(p.get('auto_handover',False),bool):raise ValueError('Invalid handover setting')
                        state['auto_handover']=p.get('auto_handover',False)
                        state['busy']=True;commands.put(('dive',p))
                    elif self.path=='/reposition':state['busy']=True;commands.put(('reposition',{}))
                    elif self.path=='/wind':
                        v={k:float(p[k]) for k in ('speed','direction')}
                        if not 0<=v['speed']<=10 or not 0<=v['direction']<=360:raise ValueError('Wind settings out of range')
                        commands.put(('wind',v))
                    else:self.reply({'error':'Not found'},code=404);return
            self.reply({'ok':True})
            if shutdown_requested:
                threading.Thread(target=self.server.shutdown,daemon=True).start()
        except (ValueError,KeyError,TypeError) as e:self.reply({'error':str(e)},code=409)
    def log_message(self,*args):pass

if __name__=='__main__':
    import sys
    if '--background' in sys.argv:
        sys.stdout=open(HERE/'server.log','a',encoding='utf-8',buffering=1)
        sys.stderr=sys.stdout
    print('ArduPlane SITL Flight Lab: http://127.0.0.1:8765',flush=True)
    try:
        qgc.start()
    except OSError as exc:
        print('QGC relay startup: '+str(exc),flush=True)
    try:
        ThreadingHTTPServer(('127.0.0.1',8765),Handler).serve_forever()
    finally:
        qgc.close()
