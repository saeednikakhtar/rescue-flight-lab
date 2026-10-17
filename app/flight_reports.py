"""Native flight-log review. Report generation never sends vehicle commands."""
from bisect import bisect_left
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import threading
import time

from test_rescue import mavutil, NAMES, SITE
from scenario_bank import BY_ID, PRIMARY

HERE = Path(__file__).resolve().parent
RUNS = HERE / 'runs'
SCHEMA = 3
EVENTS = ['Sample', 'Unsafe descent', 'Risk cleared', 'RESCUE activated',
          'Stable flight', 'Pilot took control', 'No pilot response', 'Low altitude',
          'Continued descent', 'Recovery timeout', 'RESCUE disabled', 'Configuration fault',
          'Pilot input accepted', 'Insufficient recovery progress', 'Persistent instability',
          'Stability lost', 'Imminent Home crossing', 'Navigation unavailable', 'Airspeed recovery']
RISKS = [(1, 'accelerating descent'), (2, 'high sink rate'), (4, 'attitude loss'),
         (8, 'rapid rotation'), (16, 'predicted low-height crossing'),
         (32, 'sustained sink inside the impact margin'), (64, 'verified braking clearance'),
         (128, 'bounded pull-out response grace')]
_guard = threading.RLock()
_list_cache = (0, [])
_report_locks = {}


def run_path(session):
    if not isinstance(session, str) or not session or len(session) > 180:
        raise ValueError('Select a recorded flight')
    if any(part in ('', '.', '..') for part in session.replace('\\', '/').split('/')):
        raise ValueError('Invalid flight identifier')
    path = (RUNS / session).resolve()
    if not path.is_relative_to(RUNS.resolve()) or not path.is_dir():
        raise ValueError('Recorded flight not found')
    return path


def read_json(path, fallback=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return fallback


def atomic_json(path, value):
    temp = path.with_name(path.name + '.tmp-' + threading.current_thread().name.replace('/', '-'))
    temp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    temp.replace(path)


def session_metadata(f, kind, scenario=None, speedup=1):
    value = dict(kind=kind, scenario=scenario, speedup=speedup,
                 started_at=datetime.now(timezone.utc).isoformat(),
                 binary_sha256=hashlib.sha256((HERE/'bin/arduplane.exe').read_bytes()).hexdigest())
    atomic_json(f.dir/'session-meta.json', value)


def title_for(session, metadata=None, result=None):
    m, r = metadata or {}, result or {}
    if m.get('kind') == 'manual':
        return 'Manual test · QGroundControl'
    scenario = m.get('scenario') or r.get('scenario') or Path(session).name
    if scenario in BY_ID:
        return BY_ID[scenario]['title']
    if m.get('kind') == 'demo':
        return 'Guided flight · rescue practice'
    return 'Recorded flight' if session.startswith('live-') else scenario.replace('_', ' ').replace('-', ' ')


def list_reports(limit=80):
    global _list_cache
    with _guard:
        if time.monotonic() - _list_cache[0] < 3:
            return _list_cache[1][:limit]
    paths = sorted(RUNS.rglob('telemetry.json'), key=lambda p:p.stat().st_mtime, reverse=True)
    items = []
    for path in paths:
        session = path.parent.relative_to(RUNS).as_posix()
        metadata = read_json(path.parent/'session-meta.json', {})
        if not metadata and not session.startswith('live-') and Path(session).name not in PRIMARY:
            continue
        if len(items)>=limit:
            break
        summary = read_json(path.parent/'report-summary.json')
        if summary and summary.get('schema') == SCHEMA:
            items.append(summary)
            continue
        result = read_json(path.parent/'result.json', {})
        items.append(dict(session=session, title=title_for(session, metadata, result),
                          recorded_at=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                          kind=metadata.get('kind', 'recorded'),
                          status='stopped' if result.get('cancelled') else 'passed' if result.get('passed') else 'failed' if result else 'recorded',
                          ready=False))
    with _guard:
        _list_cache = (time.monotonic(), items)
    return items


def finite(value, default=None):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else default


def explain(event, params, source_mode):
    h, az, sink = event['h'], event['az'], event['sink']
    acc, trigger = params.get('RSC_ACC_Z', 5), params.get('RSC_ALT_TRIG', 100)
    code = event['code']
    if code == 3:
        if event.get('activation')=='requested':
            return (f"RESCUE was entered from {source_mode} through a requested mode change "
                    f"(recorded reason {event.get('mode_reason')}). The automatic height/acceleration gates were not the cause of this entry.")
        if event.get('activation')=='recorded':
            return 'RESCUE entry is recorded, but its mode-transition reason is unavailable. Automatic trigger qualification cannot be established from this record alone.'
        if h < trigger and event['risk'] & 1 and az > acc:
            return (f"Captured from {source_mode}: Home height {h:.1f} m < {trigger:g} m, "
                    f"down acceleration {az:.1f} m/s² > {acc:g} m/s², sink {sink:.1f} m/s. "
                    'The firmware confirmed the descent and completed its entry dwell.')
        if h < trigger and event['risk'] & 32:
            return (f"Captured from {source_mode}: sustained sink {sink:.1f} m/s at {h:.1f} m Home, "
                    f"inside the configured {params.get('RSC_TTC_S',6):g} s impact margin. "
                    'The additional low-height safeguard completed its dwell without verified braking clearance. '
                    'This is the steady-descent extension, separate from the brief’s acceleration rule.')
        return ('Automatic capture is recorded in this log without the current accelerating-descent flag. '
                'Review the recorded firmware/configuration; this may be an earlier detector revision.')
    if code == 1:
        return f"Warning at {h:.1f} m Home: down acceleration {az:.1f} m/s², sink {sink:.1f} m/s. Warning alone does not transfer control."
    if code == 2:
        return 'The qualifying warning condition cleared. This does not by itself prove safe height or a completed recovery.'
    if code == 4:
        return 'The firmware confirmed the recovery target and stable flight envelope. The pilot response window started.'
    if code in (5, 12):
        return 'The firmware accepted the pilot mode change or deliberate input and handed control back.'
    if code == 6:
        return f"No pilot response within {params.get('RSC_HAND_S', 5):g} s after stabilization. Parachute release requested."
    reasons = {7:'Recovery reached the configured low-height guard.', 8:'Excessive descent persisted during recovery.',
               9:'The recovery time limit expired.', 10:'RESCUE was disabled.', 11:'The recovery configuration was rejected.',
               13:'Neither height nor equivalent energy improved enough in the progress window.',
               14:'Instability persisted during recovery.', 15:'Stability was lost; the handover window was cancelled.',
               16:'The recovery guard predicted imminent crossing of the Home datum. This is not a terrain-clearance guarantee.',
               17:'Navigation samples were unavailable.', 18:'A real airspeed increase counted as energy recovery progress.'}
    return reasons.get(code, 'Native firmware event recorded.')


def build_report(session, active=False, live_messages=None, live_flight=None, force=False):
    folder = run_path(session)
    with _guard:
        report_lock = _report_locks.setdefault(session, threading.Lock())
    with report_lock:
        paths = sorted((folder/'logs').glob('*.BIN'), key=lambda p:p.stat().st_mtime)
        if not paths:
            raise ValueError('The native flight log is not available yet')
        log = paths[-1]
        stat = log.stat()
        fingerprint = dict(name=log.name, bytes=stat.st_size, modified_ns=stat.st_mtime_ns)
        existing = read_json(folder/'report.json') if not active else None
        if not force and existing and existing.get('schema') == SCHEMA and existing.get('fingerprint') == fingerprint:
            return existing
        metadata = read_json(folder/'session-meta.json', {})
        result = read_json(folder/'result.json', {})
        messages = read_json(folder/'messages.json', live_messages or [])
        # Bound an active read to the original byte length; the writer can keep
        # flying while the independent parser ignores an incomplete final frame.
        with log.open('rb') as source:
            data = source.read(stat.st_size)
        reader = None
        # pymavlink's connection opens a path, so provide a private snapshot for
        # active logs. Finished files can be parsed directly.
        snapshot = None
        if active:
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.BIN', delete=False, dir=folder) as temp:
                temp.write(data)
                snapshot = Path(temp.name)
        parse_path = snapshot or log
        points, events, modes, impacts, params, positions = [], [], [], [], {}, []
        current_mode, prior_mode, position = 0, 0, None
        try:
            reader = mavutil.mavlink_connection(str(parse_path))
            while True:
                msg = reader.recv_match(type=['RSC', 'MODE', 'POS', 'PARM', 'MSG'])
                if msg is None:
                    break
                typ = msg.get_type()
                if typ == 'PARM':
                    if msg.Name.startswith('RSC_'):
                        params[msg.Name] = finite(msg.Value)
                elif typ == 'MODE':
                    prior_mode, current_mode = current_mode, int(msg.Mode)
                    modes.append(dict(t=msg.TimeUS/1e6, mode=current_mode, name=NAMES.get(current_mode, str(current_mode)),
                                      reason=int(msg.Rsn) if hasattr(msg,'Rsn') else None))
                elif typ == 'POS':
                    lat, lon = finite(msg.Lat), finite(msg.Lng)
                    if lat is not None and lon is not None and abs(lat)>1 and -90<=lat<=90 and -180<=lon<=180:
                        position = (lat, lon)
                        positions.append((msg.TimeUS/1e6,lat,lon))
                elif typ == 'MSG':
                    text = msg.Message
                    if 'SIM Hit ground at ' in text:
                        try:
                            speed = abs(float(text.split('SIM Hit ground at ')[1].split(' ')[0]))
                            if speed >= 8:
                                impacts.append(dict(t=msg.TimeUS/1e6, speed=speed, text=text))
                        except (ValueError, IndexError):
                            pass
                else:
                    p = dict(t=msg.TimeUS/1e6, h=finite(msg.Alt, 0), az=finite(msg.Az, 0),
                             sink=finite(msg.Vz, 0), roll=finite(msg.Roll, 0), pitch=finite(msg.Pitch, 0),
                             airspeed=finite(msg.Spd, 0), throttle=finite(msg.Thr, 0),
                             state=int(msg.State), risk=int(msg.Why),
                             lat=position[0] if position else None, lon=position[1] if position else None)
                    points.append(p)
                    if msg.Event:
                        code = int(msg.Event)
                        source_mode = NAMES.get(prior_mode if current_mode==26 else current_mode, str(current_mode))
                        event = {**p, 'code':code, 'title':EVENTS[code] if code<len(EVENTS) else 'Firmware event',
                                 'origin':'firmware', 'source_mode':source_mode,
                                 'severity':'danger' if code in (3,6,7,8,9,11,13,14,16,17) else 'warning' if code in (1,15) else 'info'}
                        event['explanation'] = explain(event, params, source_mode)
                        match = min((m for m in messages if f'event {code}' in m.get('text','')), key=lambda m:abs(m.get('time_s',0)-p['t']), default=None)
                        event['received_at'] = match.get('received_at') if match and abs(match.get('time_s',0)-p['t'])<1 else None
                        events.append(event)
        finally:
            if reader is not None and hasattr(reader, 'close'):
                reader.close()
            if snapshot:
                snapshot.unlink(missing_ok=True)
        # RESCUE::_enter can log its event just before Plane writes MODE. Match
        # the completed mode history instead of guessing from parse order.
        for event in events:
            if event['code']!=3:
                continue
            matches=[(i,m) for i,m in enumerate(modes) if m['mode']==26 and abs(m['t']-event['t'])<.15]
            if matches:
                index,change=min(matches,key=lambda pair:abs(pair[1]['t']-event['t']))
                event['mode_reason']=change['reason']
                event['activation']='automatic' if change['reason']==56 else 'requested' if change['reason'] is not None else 'recorded'
                if index:
                    event['source_mode']=modes[index-1]['name']
            else:
                event['activation']='recorded'
            event['explanation']=explain(event,params,event['source_mode'])
        native_points = len(points)
        for message in messages:
            text=message.get('text','')
            if 'SIM Hit ground at ' in text:
                try:
                    speed=abs(float(text.split('SIM Hit ground at ')[1].split(' ')[0]))
                    t=message['time_s']
                    if speed>=8 and not any(abs(e['t']-t)<1 for e in impacts):
                        impacts.append(dict(t=t,speed=speed,text=text,received_at=message.get('received_at')))
                except (ValueError,KeyError,IndexError):
                    pass
        if not points:
            telemetry = read_json(folder/'telemetry.json', [])
            if not telemetry and live_flight:
                telemetry=[live_flight]
            position_times=[p[0] for p in positions]
            for row in telemetry:
                if not isinstance(row,dict) or not isinstance(row.get('t'),(int,float)):
                    continue
                index=max(0,bisect_left(position_times,row['t'])-1)
                location=positions[index] if positions else None
                points.append(dict(t=row['t'],h=finite(row.get('alt'),0),az=None,
                                   sink=finite(row.get('vz'),0),roll=finite(row.get('roll'),0),
                                   pitch=finite(row.get('pitch'),0),airspeed=finite(row.get('airspeed'),0),
                                   throttle=max(0,min(100,(finite(row.get('motor_pwm'),1000)-1000)/10)),
                                   state=0,risk=0,lat=location[1] if location else row.get('lat'),
                                   lon=location[2] if location else row.get('lon')))
            if not points:
                raise ValueError('No flight measurements have been recorded yet. Allow SITL to initialize, then retry.')
        for impact in impacts:
            p = min(points, key=lambda p:abs(p['t']-impact['t']))
            events.append({**p, **impact, 'code':100, 'title':'Ground impact', 'origin':'native simulator',
                           'severity':'danger', 'explanation':f"Native model reported a ground strike at {impact['speed']:.1f} m/s. Later model rebound does not count as successful recovery."})
        observations = []
        blocked = [p for p in points if p['h']<params.get('RSC_ALT_TRIG',100) and p['sink']>5 and p['state'] in (0,1,5)]
        if blocked:
            peak = max(blocked, key=lambda p:p['sink'])
            threshold = params.get('RSC_ACC_Z',5)
            reason = ('RESCUE was disabled in the recorded configuration.' if params.get('RSC_ENABLE')==0 else
                      'Acceleration was not logged; the entry gates cannot be reconstructed from these telemetry samples.' if peak['az'] is None else
                      f"Down acceleration {peak['az']:.1f} m/s² did not exceed the {threshold:g} m/s² acceleration threshold. "
                      + ('The firmware recorded verified braking clearance.' if peak['risk']&64 else
                         'No completed low-height impact capture is recorded at this sample. Inspect risk flags, descent confirmation, entry dwell, cooldown and the recorded firmware revision.')
                      if peak['az']<=threshold else 'The logged sample had not completed all entry gates; descent confirmation, dwell and cooldown must also qualify.')
            observations.append({**peak, 'code':101, 'title':'Fast descent without capture', 'origin':'log analysis',
                                 'severity':'warning', 'explanation':reason})
        captures = [e for e in events if e['code']==3]
        stable = [e for e in events if e['code']==4]
        status = ('live' if active else 'impact' if impacts else 'stopped' if result.get('cancelled') else
                  'passed' if result.get('passed') else 'failed' if result else 'recorded')
        # Preserve event neighborhoods and global extrema when thinning charts.
        selected = {0, len(points)-1}
        stride = max(1, math.ceil(len(points)/2600))
        selected.update(range(0,len(points),stride))
        timestamps = [p['t'] for p in points]
        for event in events+observations:
            index = bisect_left(timestamps,event['t'])
            selected.update(range(max(0,index-6),min(len(points),index+7)))
        for key in ('h','az','sink','airspeed','throttle'):
            valid=[i for i,p in enumerate(points) if p[key] is not None]
            if valid:
                selected.add(min(valid,key=lambda i:points[i][key]))
                selected.add(max(valid,key=lambda i:points[i][key]))
        display_points = [points[i] for i in sorted(selected)]
        report = dict(schema=SCHEMA, session=session, title=title_for(session,metadata,result),
                      kind=metadata.get('kind','recorded'), status=status, complete=not active,
                      recorded_at=metadata.get('started_at') or datetime.fromtimestamp(stat.st_mtime,timezone.utc).isoformat(),
                      generated_at=datetime.now(timezone.utc).isoformat(), site=SITE, parameters=params,
                      fingerprint=fingerprint, log=dict(file='logs/'+log.name, bytes=len(data),sha256=hashlib.sha256(data).hexdigest()),
                      metadata=metadata, result=result or None,
                      summary=dict(duration_s=points[-1]['t']-points[0]['t'], start_s=points[0]['t'],end_s=points[-1]['t'],
                                   max_height=max(p['h'] for p in points),min_height=min(p['h'] for p in points),
                                   max_sink=max(p['sink'] for p in points), max_acceleration=max((p['az'] for p in points if p['az'] is not None),default=None),
                                   captures=len(captures),first_capture=captures[0] if captures else None,
                                   stabilized=len(stable),impacts=len(impacts)),
                      points=display_points, events=sorted(events,key=lambda e:e['t']), observations=observations,modes=modes,
                      sampling=dict(native_points=native_points,chart_points=len(display_points),events_preserved=True),
                      notes=['Charts use native firmware measurements; heights are relative to Home.',
                             'Positive sink and acceleration point down. Negative down acceleration can brake a continuing descent.',
                             'The path is reconstructed from logged positions; the landscape is illustrative.',
                             'Manual recordings are not acceptance-test passes. A recorded impact overrides a later recovery.',
                             'Charts may be thinned; the original BIN preserves the full record.'])
        if not native_points:
            report['notes'].insert(0,'No RESCUE samples were recorded. Charts use recorded telemetry; acceleration is unavailable. A disarmed ground session or disabled supervisor can produce this record.')
        if not active:
            summary = {k:report[k] for k in ('schema','session','title','recorded_at','kind','status')}
            summary.update(ready=True,summary=report['summary'])
            atomic_json(folder/'report.json',report)
            atomic_json(folder/'report-summary.json',summary)
            global _list_cache
            with _guard:
                _list_cache=(0,[])
        return report


def queue_report(session):
    def create():
        try:
            build_report(session, force=True)
        except Exception as exc:
            print('Report generation:',session,str(exc),flush=True)
    threading.Thread(target=create, name='flight-report', daemon=True).start()
