"""Relocation check: bundled runtime, launchers, static/API pages and native ground."""
from pathlib import Path
import ast, hashlib, json, os, subprocess, sys, threading, time, urllib.request
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import test_rescue
from test_rescue import Flight, M
import pymavlink, serial, lxml.etree, fastcrc

def inside(p):return Path(p).resolve().is_relative_to(ROOT)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
result=dict(passed=False,package_root=str(ROOT),checked_at=time.strftime('%Y-%m-%dT%H:%M:%S'),checks={},
            scope='Relocated package smoke test, separate ports and native ground process. Does not control the active web/QGC session.')
try:
    result['python_executable']=sys.executable
    result['python_prefix']=sys.prefix
    assert inside(sys.executable) and inside(sys.prefix)
    result['checks']['bundled_python']=True
    for module in [pymavlink,serial,lxml.etree,fastcrc]:assert inside(module.__file__),module.__file__
    result['checks']['bundled_dependencies']=True
    for p in list(ROOT.glob('*.py'))+list((ROOT/'developer').glob('*.py')):
        ast.parse(p.read_text(encoding='utf-8'),filename=str(p))
    result['checks']['python_sources_parse']=True
    launcher_checks={}
    for name in ['RESCUE-Flight-Lab.exe','QGC-Manual-Ground.exe']:
        run=subprocess.run([str(ROOT/name),'--verify-package'],cwd=ROOT,timeout=20)
        assert run.returncode==0,(name,run.returncode)
        check=json.loads((ROOT/'launcher-check.json').read_text(encoding='utf-8'))
        assert check['passed'] and Path(check['package_root']).resolve()==ROOT
        launcher_checks[name]=check
    result['launcher_checks']=launcher_checks
    result['checks']['both_executable_preflights']=True

    # Importing the handler is safe: its service/relay starts only in __main__.
    import monitor
    from http.server import ThreadingHTTPServer
    server=ThreadingHTTPServer(('127.0.0.1',0),monitor.Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url='http://127.0.0.1:'+str(server.server_port)
    try:
        pages={}
        for path in ['/','/monitor.css','/monitor-ui.js','/reports-ui.js','/scene.js','/state']:
            with urllib.request.urlopen(url+path,timeout=10) as response:
                data=response.read();assert data,path
                pages[path]=dict(status=response.status,bytes=len(data))
                if path=='/state':
                    state=json.loads(data)
                    assert state['api_revision']==9 and not state['running']
                    assert len(state['tests']['cases'])==7
        result['http_checks']=pages
        result['checks']['isolated_panel_http_and_api']=True
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)

    # Deliberately make the development-tree fallback nonexistent. Only the
    # executable's adjacent DLLs and bundled Python dependencies can be used.
    test_rescue.WORK=ROOT/'_unavailable_build_tree'
    session='package-ground-'+time.strftime('%Y%m%d-%H%M%S')
    flight=None
    try:
        flight=Flight(session,{'SIM_SPEEDUP':4,'HOME_RESET_ALT':-1,'SERIAL1_PROTOCOL':0,
                      'SYSID_THISMAV':239},port=17660,instance=180)
        flight.rc_send_enabled=False;flight.hold_mode_channel=False
        flight.run_for(10)
        assert not flight.armed and flight.mode==0 and not flight.deployed
        assert not flight.rescue_seen and flight.servo3<=1000
        flight.mav.mav.set_mode_send(flight.sysid,M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,26)
        flight.run_for(3)
        assert flight.mode!=26 and not flight.armed and not flight.deployed
        result['native_final']=dict(t=flight.t,mode=flight.mode,armed=flight.armed,
            motor_pwm=flight.servo3,chute_pwm=flight.servo9,altitude_home_m=flight.alt)
        result['checks']['native_disarmed_ground_and_capture_guard']=True
    finally:
        if flight:flight.close()
    logs=list((ROOT/'runs'/session/'logs').glob('*.BIN'))
    assert logs and all(p.stat().st_size>0 for p in logs)
    result['native_session']=session
    result['native_logs']=[dict(path=p.relative_to(ROOT).as_posix(),bytes=p.stat().st_size,sha256=sha(p)) for p in logs]
    result['firmware_sha256']=sha(ROOT/'bin/arduplane.exe')
    assert result['firmware_sha256']==json.loads((ROOT/'low-height-verification.json').read_text())['binary_sha256']
    result['checks']['original_bin_and_verified_firmware']=True
    result['passed']=True
except Exception as exc:
    import traceback
    result.update(error=str(exc),traceback=traceback.format_exc())
finally:
    (ROOT/'package-smoke-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2),flush=True)
sys.exit(0 if result['passed'] else 1)
