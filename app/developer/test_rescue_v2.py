from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
import sys,json,time,traceback,hashlib,socket
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from test_rescue import Flight
from scenario_bank import CASES,PRIMARY,exercise,overrides
from verify_scenario import verify
from qgc_link import QGCLink,wire
group='rescue-v2-'+time.strftime('%Y%m%d-%H%M%S')
binary=root/'bin/arduplane.exe'
names=sys.argv[1].split(',') if len(sys.argv)>1 else ['warning','manual','auto','recovery','handover','no_pilot','failed','disabled']
folder=root/'runs'/group;folder.mkdir(parents=True)

def run(index,name):
    f=None;relay=None;sock=None
    result=dict(scenario=name,passed=False,overrides=overrides(name))
    try:
        options={'SIM_SPEEDUP':4,**overrides(name)}
        kwargs={}
        if name=='receiver_input':kwargs['rc_in_port']=9000+index*100+50
        if name=='manual_input':
            sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);sock.bind(('127.0.0.1',0))
            relay=QGCLink(root,vehicle_port=0,local_port=0,qgc_port=sock.getsockname()[1]);relay.start();relay.begin_session(group+'-'+name)
            options.update(SYSID_THISMAV=2,SERIAL1_PROTOCOL=2);kwargs['qgc_port']=relay.vehicle_port
        f=Flight(group+'/'+name,options,binary=binary,port=9000+index*100,instance=60+index,**kwargs)
        if name=='receiver_input':f.receiver_port=kwargs['rc_in_port']
        if relay:
            encoder=wire.MAVLink(None,srcSystem=255,srcComponent=190)
            f.manual_sender=lambda z:sock.sendto(wire.MAVLink_manual_control_message(2,0,0,z,0,0).pack(encoder),('127.0.0.1',relay.local_port))
        exercise(f,name,lambda s:print(name,s,flush=True))
        result['flight_assertions']=True
    except Exception as e:result.update(error=str(e),traceback=traceback.format_exc())
    finally:
        if f:f.close()
        if relay:result['qgc_transport']=relay.snapshot();relay.close();sock.close()
    if f:
        try:result.update(verify(f,name));result['passed']=result['passed'] and result.get('flight_assertions',False)
        except Exception as e:result.update(passed=False,verification_error=str(e),traceback=traceback.format_exc())
        (f.dir/'result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(dict(case=name,passed=result['passed'],error=result.get('error'),checks=result.get('checks'))),flush=True)
    return result

summary=dict(group=group,passed=False,binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),cases=[])
with ThreadPoolExecutor(max_workers=3) as pool:
    futures=[pool.submit(run,i,n) for i,n in enumerate(names)]
    for future in as_completed(futures):
        summary['cases'].append(future.result())
        (folder/'summary.json').write_text(json.dumps(summary,indent=2))
summary['passed']=all(r['passed'] for r in summary['cases'])
(folder/'summary.json').write_text(json.dumps(summary,indent=2))
(root/'v2-test-results.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(dict(group=group,passed=summary['passed'],cases=len(summary['cases']))),flush=True)
sys.exit(0 if summary['passed'] else 1)
