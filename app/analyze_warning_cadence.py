"""Check warning timing inside each actual WARNING episode, using DataFlash."""
from pathlib import Path
import json
import sys

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'pydeps'))
from pymavlink import mavutil

def analyze(result):
    records=[];episode=0;active=False;mode=None
    for item in result['logs']:
        reader=mavutil.mavlink_connection(str(HERE/item['file']))
        while True:
            m=reader.recv_match(type=['RSC','MSG','MODE'])
            if m is None:break
            kind=m.get_type()
            if kind=='MODE':mode=getattr(m,'ModeNum',getattr(m,'Mode',None))
            elif kind=='RSC' and m.Event:
                if m.State==1:episode+=1;active=True
                else:active=False
            elif kind=='MSG' and m.Message.startswith('RESCUE WARNING:'):
                records.append({'time_us':m.TimeUS,'episode':episode,'warning_state':active,'mode':mode,'message':m.Message})
    intervals=[(b['time_us']-a['time_us'])/1e6 for a,b in zip(records,records[1:]) if a['episode']==b['episode']]
    episode_counts={}
    for record in records:
        episode_counts[record['episode']]=episode_counts.get(record['episode'],0)+1
    checks={'repeated_warning_in_same_episode':bool(intervals),
            'at_least_three_warnings_in_one_episode':bool(episode_counts) and max(episode_counts.values())>=3,
            'one_hz_while_condition_persists':bool(intervals) and all(.999<=dt<=1.10 for dt in intervals),
            'warning_state_active':bool(records) and all(r['warning_state'] for r in records),
            'mode_remained_manual':bool(records) and all(r['mode']==0 for r in records),
            'severity_warning':all(w['severity']==4 for w in result['warnings']),
            'no_automatic_capture_in_probe':not result['captured']}
    result.update(dataflash_warnings=records,same_episode_intervals_s=intervals,
                  checks=checks,passed=all(checks.values()))
    return result

if __name__=='__main__':
    path=HERE/'warning-cadence-test.json'
    result=analyze(json.loads(path.read_text(encoding='utf-8')))
    path.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ('passed','same_episode_intervals_s','checks','dataflash_warnings')},indent=2))
    sys.exit(0 if result['passed'] else 1)
