"""Read-only loopback graphics benchmark. No flight commands or mutable APIs."""
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
if (HERE/'recorded-state.json').exists():
    state=json.loads((HERE/'recorded-state.json').read_text(encoding='utf-8'))
else:
    with urlopen('http://127.0.0.1:8765/state', timeout=10) as response:
        state=json.load(response)
if not state.get('flight'):
    raise RuntimeError('An actual flight snapshot is required')
state.update(running=False, connected=False, busy=True,
             phase='Recorded actual SITL frame',
             alert={'level':'safe','title':'RECORDED SITL FRAME · DISPLAY BENCHMARK',
                    'detail':'Read-only comparison. Flight controls are disabled.'})
state['history_delta']=False
snapshot=json.dumps(state,separators=(',',':')).encode()
(HERE/'recorded-state.json').write_bytes(snapshot)
page=(ROOT/'monitor.html').read_text(encoding='utf-8')
page=page.replace('SOFTWARE IN THE LOOP · No hardware connection · live telemetry, not a replay','READ-ONLY BENCHMARK · recorded actual SITL frame').replace('if(!s.running&&d&&d.on_ground===true)','if(false)')
page=page.replace('</head>','<style>.control-deck,.sourcebar,#take{display:none!important}</style></head>')
before=(HERE/'before.bundle.js').read_bytes()
after=(ROOT/'scene.js').read_bytes()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path=urlsplit(self.path).path
        if path in ['/before','/after']:
            label='Before' if path=='/before' else 'After'
            data=page.replace('src="/scene.js"',f'src="{path}.js"').replace('RESCUE Flight Lab — Flight workstation',f'RESCUE Display Benchmark - {label}').encode()
            kind='text/html; charset=utf-8'
        elif path=='/state': data,kind=snapshot,'application/json'
        elif path=='/before.js': data,kind=before,'text/javascript'
        elif path=='/after.js': data,kind=after,'text/javascript'
        else: self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_POST(self): self.send_error(405,'Read-only benchmark')
    def log_message(self,*args): pass

print('Read-only benchmark on 127.0.0.1:8890; actual snapshot:',state['flight'].get('session_id'),flush=True)
ThreadingHTTPServer(('127.0.0.1',8890),Handler).serve_forever()
