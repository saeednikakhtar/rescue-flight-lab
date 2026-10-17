"""Observe QGC trials; --hold explicitly requests LOITER at a bounded endpoint."""
from pathlib import Path
import json,sys,time,urllib.request
app=Path(__file__).resolve().parents[1]
kind=sys.argv[1];value=float(sys.argv[2]) if len(sys.argv)>2 else 0
end=time.monotonic()+150;session=None;start_t=None
while True:
    s=json.load(urllib.request.urlopen('http://127.0.0.1:8765/state?after=999999',timeout=4));f=s['flight']
    assert s['manual_ground'] and f['system_id']==2
    if session is None:session=f['session_id']
    if start_t is None:start_t=f['t']
    assert session==f['session_id'],'Flight changed during checkpoint'
    with (app/'runs'/session/'held-axis-observations.jsonl').open('a') as out:
        out.write(json.dumps(dict(wall_time=time.time(),flight=f,decision=s['decision'],rsc_state=s['rsc_state'],
                                  countdown=s['countdown'],handover=s['handover'],deployed=s['deployed']))+'\n')
    matched={'below':f['alt']<=value,'above':f['alt']>=value,
             'capture':f['mode_name']=='RESCUE','stable':s['countdown'] is not None,
             'handover':s['handover'] and f['mode_name']=='FBWA','chute':s['deployed'],
             'duration':f['t']-start_t>=value}[kind]
    if matched:
        if '--hold' in sys.argv:
            assert kind in ('below','above') and f['mode_name'] in ('MANUAL','FBWA','GUIDED'), 'Do not interrupt RESCUE'
            import socket
            sys.path.insert(0,str(app/'pydeps'))
            from pymavlink.dialects.v20 import ardupilotmega as wire
            encoder=wire.MAVLink(None,srcSystem=255,srcComponent=192)
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sock:
                sock.sendto(encoder.set_mode_encode(2,wire.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,12).pack(encoder),('127.0.0.1',14560))
            hold_deadline=time.monotonic()+5
            while True:
                held=json.load(urllib.request.urlopen('http://127.0.0.1:8765/state?after=999999'))
                assert held['flight']['session_id']==session
                if held['flight']['mode_name']=='LOITER':break
                assert time.monotonic()<hold_deadline,'Checkpoint hold was not acknowledged'
                time.sleep(.1)
            with (app/'runs'/session/'checkpoint-holds.jsonl').open('a') as out:
                out.write(json.dumps(dict(endpoint=f,hold=held['flight'],wall_time=time.time()))+'\n')
        print(json.dumps(dict(checkpoint=kind,flight=f,decision=s['decision'],countdown=s['countdown'],
                              rsc_state=s['rsc_state'],handover=s['handover'],deployed=s['deployed'])),flush=True)
        break
    if time.monotonic()>end:raise TimeoutError(kind)
    time.sleep(.12)
