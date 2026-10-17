"""Export actual SIM poses and recorded canopy/AGL for the display regression.
Run from the package root using its Python environment with pymavlink.
No flight process, controls or injected sensor values are used.
"""
import bisect
import hashlib
import json
import pathlib
import sys
sys.path.insert(0, 'pydeps')
from pymavlink import mavutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
names = [('live-20261015-023438', 'first-dive-no-pilot'), ('live-20261015-024345', 'graphics-restart-reference')]
result = {'site': json.loads((ROOT / 'test-site.json').read_text(encoding='utf-8')), 'sessions': []}
for name, saved_folder in names:
    folder = ROOT / 'runs' / saved_folder
    log = folder / 'logs' / '00000001.BIN'
    rows = json.loads((folder / 'telemetry.json').read_text(encoding='utf-8'))
    times = [r['t'] for r in rows]
    reader = mavutil.mavlink_connection(str(log))
    poses, previous, interpolation, last_interpolation = [], -2, [], -2
    while True:
        message = reader.recv_match(type='SIM', blocking=False)
        if message is None:
            break
        t = message.TimeUS / 1e6
        take_pose = t - previous >= 1
        take_interpolation = saved_folder == 'graphics-restart-reference' and 60 <= t <= 66 and t - last_interpolation >= .18
        if not take_pose and not take_interpolation:
            continue
        index = min(bisect.bisect_left(times, t), len(rows) - 1)
        row = dict(rows[index])
        row.update(t=t, lat=message.Lat, lon=message.Lng, roll=message.Roll,
                   pitch=message.Pitch, yaw=message.Yaw, heading=message.Yaw,
                   session_id=name)
        if take_pose:
            previous=t
            poses.append(row)
        if take_interpolation:
            last_interpolation=t
            interpolation.append(row)
    result['sessions'].append({'id': name, 'source': str(log.relative_to(ROOT)),
                              'sha256': hashlib.sha256(log.read_bytes()).hexdigest(),
                              'samples': poses, 'interpolation_samples': interpolation})
out = ROOT / 'graphics-source' / 'fixtures' / 'recorded-sessions.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
print('Exported actual poses:', [len(s['samples']) for s in result['sessions']])
