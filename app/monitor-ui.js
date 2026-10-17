
const $=id=>document.getElementById(id),clientId=crypto.randomUUID();let latest=null,history=[],pilotEnabled=false,ctl={roll:0,pitch:0,rudder:0,throttle:50},keys=new Set(),pointer=false,pendingControl=false,apiRevision=1,historySession=null,lastHistoryT=-1,lastGraphPaint=0,connectionLost=false;
let qgcPending=false,launchMode='manual';
async function reconnectQGC(){if(qgcPending)return;qgcPending=true;$('qgc-reconnect').disabled=true;$('qgc-status').textContent='QGroundControl: reconnecting';await action('/qgc/reconnect');qgcPending=false}
$('qgc-reconnect').onclick=reconnectQGC;$('qgc-open').onclick=()=>action('/qgc/open');
function showQGC(qgc){const q=qgc||{},status=q.state||'waiting';$('qgc-status').textContent='QGroundControl: '+({connected:'connected',idle:'ready · simulation stopped',waiting:'waiting for heartbeat',reconnecting:'reconnecting',error:'link error'}[status]||status);$('qgc-status').title=q.error||('Last heartbeat: '+(Number.isFinite(q.last_heartbeat_age_s)?q.last_heartbeat_age_s.toFixed(1)+' s ago':'not received'));$('qgc-dot').className='dot '+status;$('qgc-reconnect').disabled=qgcPending||status==='reconnecting'}
async function action(path,p={},quiet=false){try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const j=await r.json();if(!r.ok||j.error)throw Error(j.error||'Command rejected');$('error').textContent='';return j}catch(e){if(!quiet)$('error').textContent=e.message;return null}}

function resetFlightInstruments(){history=[];historySession=null;lastHistoryT=-1;displaySession=null;displayTime=-1;for(const id of ['alt','alt-adj','airspeed','vz','motor','canopy','roll','pitch'])$(id).textContent='—';$('scene-time').textContent='T + 0.0 s';$('motor-pwm').textContent='PWM — µs';$('chute-pwm').textContent='release — µs';$('alt-est').textContent='Home — m';$('height-trend').textContent='Waiting for telemetry';$('scene-phase').textContent='Waiting for SITL';$('flight-mode').textContent='NO FLIGHT';horizon(null);plot()}
function renderLaunch(s){
 const manual=s.running?!!s.manual_ground:launchMode==='manual';
 for(const [id,kind] of [['launch-manual','manual'],['launch-guided','guided']]){const active=manual?(kind==='manual'):(kind==='guided');$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));$(id).disabled=s.running||s.tests?.active}
 $('start').textContent=s.running?'Session running':manual?'▷ Start manual test':'▷ Launch to 240 m';
 $('launch-description').textContent=manual?'Start disarmed on the runway. Take off and fly from QGroundControl.':'Automatic takeoff to 240 m. Run a rescue exercise or choose a scenario.';
 $('speedup').disabled=s.running||manual;if(manual)$('speedup').value='1';
 for(const id of ['dive','failure','retest'])$(id).hidden=manual;
 $('pilot-panel').hidden=manual;$('manual-help').hidden=!manual;$('manual-help').querySelector('strong').textContent=s.running?'QGroundControl has the controls':'A fresh start on the runway';
}
for(const [id,kind] of [['launch-manual','manual'],['launch-guided','guided']])$(id).onclick=()=>{launchMode=kind;renderLaunch(latest||{running:false})};
$('start').onclick=async()=>{flightScene.beginSession?.();resetFlightInstruments();return action(launchMode==='manual'?'/start-ground':'/start',{altitude:240,speedup:launchMode==='manual'?1:Number($('speedup').value)})};
$('stop').onclick=()=>{ReportDesk.finish();return action('/stop')};$('take').onclick=()=>action('/handover');$('dive').onclick=()=>action('/dive',{auto_handover:$('auto-take').checked});$('failure').onclick=()=>action('/dive',{failure:true,auto_handover:false});$('retest').onclick=()=>action('/reposition');for(const [id,mode] of [['mode-fbwa',5],['mode-loiter',12],['mode-manual',0]])$(id).onclick=async()=>{center();if(mode!==12)await action('/claim',{client_id:clientId});action('/mode',{mode})};
function cameraView(camera){flightScene.camera=camera;for(const id of ['chase','orbit','detail']){$('cam-'+id).classList.toggle('active',id===camera);$('cam-'+id).setAttribute('aria-pressed',String(id===camera))}}$('cam-chase').onclick=()=>cameraView('chase');$('cam-orbit').onclick=()=>cameraView('orbit');$('cam-detail').onclick=()=>cameraView('detail');
function controls(){for(const [k,id] of [['roll','roll-control'],['pitch','pitch-control'],['rudder','yaw-control']])$(id).textContent=Math.round(ctl[k])+'%';$('knob').style.transform=`translate(${ctl.roll*($('stick').clientWidth*.0036)}px,${-ctl.pitch*($('stick').clientWidth*.0036)}px)`;$('throttle-value').textContent=ctl.throttle+'%'}
function center(){keys.clear();ctl.roll=ctl.pitch=ctl.rudder=0;pointer=false;controls()}
$('enable-controller').onclick=async()=>{await action('/claim',{client_id:clientId});action('/mode',{mode:5})};$('neutral').onclick=center;$('throttle').oninput=()=>{ctl.throttle=Number($('throttle').value);controls()};
function stickMove(e){if(!pointer||!pilotEnabled)return;const r=$('stick').getBoundingClientRect();let a=(e.clientX-r.left-r.width/2)/(r.width*.36),b=-(e.clientY-r.top-r.height/2)/(r.height*.36),n=Math.max(1,Math.hypot(a,b));ctl.roll=Math.round(a/n*100);ctl.pitch=Math.round(b/n*100);controls()}
$('stick').onpointerdown=e=>{if(!pilotEnabled)return;pointer=true;$('stick').setPointerCapture(e.pointerId);stickMove(e)};$('stick').onpointermove=stickMove;$('stick').onpointerup=$('stick').onpointercancel=()=>center();
const flightKeys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','q','e','w','s'];window.onkeydown=e=>{if($('flight-workspace').hidden||!pilotEnabled||['INPUT','SELECT'].includes(e.target.tagName)||!flightKeys.includes(e.key))return;e.preventDefault();keys.add(e.key);ctl.pitch=(keys.has('ArrowUp')?55:0)-(keys.has('ArrowDown')?55:0);ctl.roll=(keys.has('ArrowRight')?55:0)-(keys.has('ArrowLeft')?55:0);ctl.rudder=(keys.has('e')?55:0)-(keys.has('q')?55:0);if(e.key==='w')ctl.throttle=Math.min(100,ctl.throttle+3);if(e.key==='s')ctl.throttle=Math.max(0,ctl.throttle-3);$('throttle').value=ctl.throttle;controls()};window.onkeyup=e=>{keys.delete(e.key);if(!pointer){ctl.pitch=(keys.has('ArrowUp')?55:0)-(keys.has('ArrowDown')?55:0);ctl.roll=(keys.has('ArrowRight')?55:0)-(keys.has('ArrowLeft')?55:0);ctl.rudder=(keys.has('e')?55:0)-(keys.has('q')?55:0);controls()}};window.addEventListener('blur',center);document.addEventListener('visibilitychange',()=>{if(document.hidden)center()});
setInterval(async()=>{if($('flight-workspace').hidden||!pilotEnabled||document.hidden||pendingControl)return;pendingControl=true;await action('/control',{...ctl,client_id:clientId},true);pendingControl=false},140);
function surface(id){const c=$(id),d=Math.min(devicePixelRatio||1,2),w=c.clientWidth,h=c.clientHeight;if(c.width!==Math.round(w*d)||c.height!==Math.round(h*d)){c.width=Math.round(w*d);c.height=Math.round(h*d)}const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);x.clearRect(0,0,w,h);x.textAlign='left';return[x,w,h]}
function horizon(data){
 const missing=!data,d=data||{roll:0,pitch:0,heading:0},[x,w,h]=surface('horizon');if(w<40||h<40)return;const rad=Math.PI/180,cx=w/2,cy=30+(h-34)/2,r=Math.min(w*.405,(h-43)/2);
 x.fillStyle='#192e3d';x.fillRect(0,0,w,h);
 // Heading ribbon wraps continuously at north.
 x.save();x.beginPath();x.rect(7,4,w-14,24);x.clip();x.font='9px Segoe UI';x.textAlign='center';
 const hdg=((d.heading%360)+360)%360;
 for(let delta=-80;delta<=80;delta++){const deg=Math.round(hdg)+delta;if(deg%10)continue;const px=cx+(deg-hdg)*2.3;if(px<4||px>w-4)continue;const label=((deg%360)+360)%360;x.strokeStyle='#8babbc';x.beginPath();x.moveTo(px,19);x.lineTo(px,23);x.stroke();if(label%30===0){x.fillStyle='#b8ced8';x.fillText(({0:'N',90:'E',180:'S',270:'W'})[label]||String(label).padStart(3,'0'),px,14)}}x.restore();
 x.fillStyle='#e8f4f7';x.fillRect(cx-24,3,48,18);x.fillStyle='#192e3d';x.textAlign='center';x.font='600 12px Bahnschrift';x.fillText(missing?'—':Math.round(hdg).toString().padStart(3,'0')+'°',cx,16);
 x.strokeStyle='#6f8c9d';x.lineWidth=1;x.beginPath();x.arc(cx,cy,r+5,0,Math.PI*2);x.stroke();
 x.save();x.beginPath();x.arc(cx,cy,r,0,Math.PI*2);x.clip();x.translate(cx,cy);x.rotate(-d.roll*rad);const y=d.pitch*r/35;
 const sky=x.createLinearGradient(0,-r*3,0,y);sky.addColorStop(0,'#225e86');sky.addColorStop(1,'#559cba');const earth=x.createLinearGradient(0,y,0,r*3);earth.addColorStop(0,'#9b7852');earth.addColorStop(1,'#4c4238');
 x.fillStyle=sky;x.fillRect(-r*8,-r*8,r*16,r*8+y);x.fillStyle=earth;x.fillRect(-r*8,y,r*16,r*16);x.strokeStyle='#f3f9fc';x.lineWidth=1.3;x.beginPath();x.moveTo(-r*4,y);x.lineTo(r*4,y);x.stroke();x.font='8px Segoe UI';x.fillStyle='#f1f6f8';
 for(let p=-80;p<=80;p+=5){if(!p)continue;const py=y-p*r/35,long=p%10===0,len=long?23:12;if(Math.abs(py)>r*2)continue;x.setLineDash(p<0?[3,3]:[]);x.lineWidth=long?1:.7;x.beginPath();x.moveTo(-len,py);x.lineTo(len,py);x.stroke();x.setLineDash([]);if(long){x.textAlign='right';x.fillText(Math.abs(p),-len-5,py+3);x.textAlign='left';x.fillText(Math.abs(p),len+5,py+3)}}x.restore();
 x.save();x.translate(cx,cy);x.strokeStyle='#edf6f8';x.fillStyle='#edf6f8';for(const a of [-60,-45,-30,-20,-10,0,10,20,30,45,60]){const ar=a*rad,len=a%30===0?8:4;x.beginPath();x.moveTo(Math.sin(ar)*(r-2),-Math.cos(ar)*(r-2));x.lineTo(Math.sin(ar)*(r-2-len),-Math.cos(ar)*(r-2-len));x.stroke()}x.save();x.rotate(-d.roll*rad);x.beginPath();x.moveTo(0,-r+12);x.lineTo(-4,-r+19);x.lineTo(4,-r+19);x.fill();x.restore();
 x.strokeStyle='#ffdd81';x.lineWidth=2.5;x.lineJoin='round';x.beginPath();x.moveTo(-r*.58,0);x.lineTo(-r*.23,0);x.lineTo(-r*.12,6);x.lineTo(0,0);x.lineTo(r*.12,6);x.lineTo(r*.23,0);x.lineTo(r*.58,0);x.stroke();x.restore();
 if(missing){x.fillStyle='#193647b8';x.beginPath();x.arc(cx,cy,r,0,Math.PI*2);x.fill();x.fillStyle='#d4e4ec';x.font='10px Segoe UI';x.textAlign='center';x.fillText('Waiting for SITL',cx,cy+3)}
}
function plot(){const[x,w,h]=surface('height');if(w<40||h<35)return;x.fillStyle='#192e3d';x.fillRect(0,0,w,h);const d=latest?.flight;if(!d){x.fillStyle='#aac2d0';x.font='10px Segoe UI';x.fillText('Waiting for height telemetry',11,h/2);return}
 const value=d.alt,max=Math.max(270,...history.map(v=>v.alt)),min=Math.min(-20,d.ground_alt??0,...history.map(v=>v.alt))-5,t=10,b=18,tapeX=49,py=a=>h-b-(h-t-b)*(a-min)/(max-min);
 x.fillStyle='#234759';x.fillRect(tapeX-8,t,16,h-t-b);x.fillStyle='#71bcc4';x.fillRect(tapeX-5,Math.min(py(value),py(0)),10,Math.abs(py(0)-py(value)));
 x.font='9px Segoe UI';x.lineWidth=1;for(const a of (h<120?[0,100,200]:[0,50,100,150,200,250])){const y=py(a);x.fillStyle=a===100?'#ffacb4':a===200?'#f2cd8d':'#a4bfcd';x.textAlign='right';x.fillText(a,28,y+3);x.strokeStyle=a===100?'#dc8490':a===200?'#d7b678':'#45677a';x.setLineDash(a===100||a===200?[3,3]:[]);x.beginPath();x.moveTo(35,y);x.lineTo(w-10,y);x.stroke()}x.setLineDash([]);
 if(Number.isFinite(d.ground_alt)){const y=py(d.ground_alt);x.strokeStyle='#aec9a4';x.setLineDash([2,4]);x.beginPath();x.moveTo(35,y);x.lineTo(w-10,y);x.stroke();x.setLineDash([])}
 x.fillStyle='#edf7fa';x.beginPath();x.moveTo(tapeX+13,py(value));x.lineTo(tapeX+19,py(value)-4);x.lineTo(tapeX+19,py(value)+4);x.fill();
 if(history.length>1){const end=history.at(-1).t,start=Math.max(0,end-150),l=77,r=w-11,px=a=>l+(r-l)*(a-start)/Math.max(10,end-start);x.lineWidth=1.6;for(let i=1;i<history.length;i++){const a=history[i-1],v=history[i];x.strokeStyle=v.chute_pwm>=1800?'#f3c07d':v.mode===26?'#ff9aa3':'#78c9cd';x.beginPath();x.moveTo(px(a.t),py(a.alt));x.lineTo(px(v.t),py(v.alt));x.stroke()}x.fillStyle='#91afc0';x.font='8px Segoe UI';x.textAlign='left';x.fillText('−'+Math.round(end-start)+'s',l,h-3);x.textAlign='right';x.fillText('Now',r,h-3)}
}
let lastEvents='',displaySession=null,displayTime=-1;async function update(){try{const path=apiRevision>=2?'/state?history_session='+encodeURIComponent(historySession??'')+'&after='+lastHistoryT:'/state';const r=await fetch(path);if(!r.ok)throw Error('Disconnected');const s=await r.json();if(connectionLost){$('error').textContent='';connectionLost=false}latest=s;showQGC(s.qgc);renderTests(s);renderDecision(s);renderLaunch(s);ReportDesk.onState(s);if(s.api_revision>=2)apiRevision=s.api_revision;
if(s.site){flightScene.setSite?.(s.site);$('site-label').textContent=s.site.name;}
const d=s.flight;if(d&&flightScene.setTelemetry(d,s.running&&s.connected)===false){setTimeout(update,180);return}const free=s.running&&s.connected&&!s.busy&&!s.deployed&&!s.manual_ground&&(!d||d.mode_name!=='RESCUE');$('start').disabled=s.running||s.tests?.active;$('stop').disabled=!s.running;$('speedup').disabled=s.running||launchMode==='manual';if(s.running)$('speedup').value=String(s.speedup);for(const id of ['dive','failure','retest','mode-fbwa','mode-loiter','mode-manual','enable-controller'])$(id).disabled=!free;$('take').disabled=!s.running||s.countdown===null||s.handover||s.deployed;$('take').hidden=!s.running||s.countdown===null||s.handover||s.deployed;const enabled=free&&d&&s.controller_owner===clientId&&['FBWA','MANUAL'].includes(d.mode_name);if(pilotEnabled&&!enabled)center();pilotEnabled=enabled;$('controller').classList.toggle('disabled',!enabled);$('throttle').disabled=$('neutral').disabled=!enabled;$('control-status').textContent=enabled?'INPUT ACTIVE':'LOCKED';$('locked').textContent=s.busy?'Autopilot / scenario has control.':enabled?'Live RC input → ArduPlane SITL.':'Enable this controller to send pilot inputs.';$('phase').textContent=s.phase;$('scene-phase').textContent=s.phase;$('cycle').textContent='Cycle '+s.cycle;$('link').textContent=s.running?(s.connected?'Live SITL':'Starting SITL'):(d?'Flight stopped':'Ready to launch');$('live-dot').classList.toggle('live',s.connected&&s.running);$('alert').className='alert '+s.alert.level;$('alert-title').textContent=s.alert.title;$('alert-detail').textContent=s.alert.detail;$('alert-icon').textContent=s.alert.level==='danger'||s.alert.level==='warning'?'⚠':'◈';$('countdown').textContent=s.countdown!==null?s.countdown.toFixed(1)+'s':'';if(s.error)$('error').textContent=s.error;
if(d){if((d.session_id!==undefined&&d.session_id!==displaySession)||d.t<displayTime){history=[];lastEvents=''}displaySession=d.session_id??displaySession;displayTime=d.t;$('vehicle-id').textContent='SITL VEHICLE #'+(d.system_id??'—');const session=s.history_session??d.session_id??'legacy';const incoming=Array.isArray(s.history)?s.history:[];if(historySession!==session||s.history_delta!==true)history=[];const byTime=new Map(history.map(row=>[row.t,row]));for(const row of incoming)byTime.set(row.t,{t:row.t,alt:row.alt,true_alt:row.true_alt,mode:row.mode,chute_pwm:row.chute_pwm});history=[...byTime.values()].sort((a,b)=>a.t-b.t).filter(row=>row.t>=d.t-150).slice(-600);historySession=session;lastHistoryT=history.at(-1)?.t??-1;$('alt-kind').textContent=Number.isFinite(d.agl)?'Ground clearance':'Height / launch';$('alt').textContent=(Number.isFinite(d.agl)?Math.max(0,d.agl):(d.true_alt??d.alt)).toFixed(1);$('alt-adj').textContent=(Number.isFinite(d.agl)?Math.max(0,d.agl):d.alt).toFixed(1);$('height-datum').textContent=Number.isFinite(d.agl)?'Above ground':'Above Home (FC)';$('height-reference').textContent='Home (FC) '+d.alt.toFixed(1)+' m · ground '+(Number.isFinite(d.ground_alt)?d.ground_alt.toFixed(1):'—')+' m';$('height-trend').textContent=d.on_ground?'Ground contact':s.deployed?'Parachute descent':s.stable&&d.mode_name==='RESCUE'?'Recovery stable':s.rsc_state==='RECOVER'?'Recovering to 200 m':(-(d.true_vz??d.vz)>0.3?'Climbing':-(d.true_vz??d.vz)<-.3?'Descending':'Level flight');$('alt-est').textContent='Home (FC) '+d.alt.toFixed(1)+' m';$('airspeed').textContent=d.airspeed.toFixed(1);$('airspeed').classList.toggle('warn',d.airspeed<10&&d.alt>20);$('vz').textContent=(-(d.true_vz??d.vz)).toFixed(1);$('motor').textContent=Math.round(Math.max(0,Math.min(100,(d.motor_pwm-1000)/10)))+'%';$('motor-pwm').textContent='PWM '+d.motor_pwm+' µs';$('canopy').textContent=Math.round(d.canopy*100)+'%';$('chute-pwm').textContent='release '+d.chute_pwm+' µs';$('flight-mode').textContent=d.mode_name+' · '+(d.armed?'ARMED':'DISARMED');$('scene-time').textContent='T + '+d.t.toFixed(1)+' s · '+s.speedup+'× SPEED';$('roll').textContent=d.roll.toFixed(1)+'°';$('pitch').textContent=d.pitch.toFixed(1)+'°';for(const [id,mode] of [['mode-fbwa','FBWA'],['mode-loiter','LOITER'],['mode-manual','MANUAL']])$(id).classList.toggle('active',d.mode_name===mode);horizon(d);if(performance.now()-lastGraphPaint>300){lastGraphPaint=performance.now();plot()}}
if(!s.running&&!s.error){$('alert').className='alert';$('alert-title').textContent=d?'Flight stopped':'Ready to launch';$('alert-detail').textContent=d?'Last telemetry is held. Launch a new flight for a clean track; reconnect QGC only if its link is lost.':'Choose Manual test for QGroundControl, or Guided test for an automatic 240 m launch.';$('alert-icon').textContent=d?'■':'✈';$('countdown').textContent='';if(d)$('scene-phase').textContent='Flight stopped · telemetry held'}
if(!s.running&&s.deployed&&d&&d.on_ground===true&&!s.impact){$('alert').className='alert safe';$('alert-title').textContent='GROUND CONTACT · TEST COMPLETE';$('alert-detail').textContent='Flight stopped. Last received SITL telemetry is held on screen.';$('alert-icon').textContent='✓';$('scene-phase').textContent='Ground contact · test complete'}
if(s.impact){$('alert').className='alert danger';$('alert-title').textContent='GROUND IMPACT · '+s.impact.vertical_speed_m_s.toFixed(1)+' m/s';$('alert-detail').textContent='Recorded at T + '+s.impact.time_s.toFixed(1)+'s. Later model rebound does not count as a successful recovery. Start a new flight.';$('alert-icon').textContent='⚠';$('scene-phase').textContent='Ground impact recorded · fresh trial required'}
if(!d){flightScene.clear?.();resetFlightInstruments()}
$('event-clock').textContent='Local time · '+(Intl.DateTimeFormat().resolvedOptions().timeZone||'system');const ev=JSON.stringify(s.messages.slice(-120))+ $('event-filter').value;if(ev!==lastEvents){lastEvents=ev;$('events').replaceChildren(...s.messages.filter(e=>e.text.toLowerCase().includes($('event-filter').value.toLowerCase())).slice(-60).reverse().map(e=>{const li=document.createElement('li'),t=document.createElement('time');const stamp=Number.isFinite(e.received_at_ms)?new Date(e.received_at_ms):null;t.textContent=stamp?stamp.toLocaleTimeString('en-GB',{hour12:false}):'—';if(stamp)t.dateTime=stamp.toISOString();t.title=(e.received_at||'Clock unavailable')+' / simulation T + '+e.time_s.toFixed(1)+' s';li.title=e.text;li.append(t,document.createTextNode(eventDescription(e.text)));if(e.severity<=4)li.className='critical';return li}))}
if(!$('events').children.length){const empty=document.createElement('li');empty.textContent=$('event-filter').value?'No events match this filter.':'Controller events will appear here when the test starts.';$('events').append(empty)}
}catch(e){connectionLost=true;if(apiRevision>=2)apiRevision=1;$('link').textContent='Server unavailable';$('qgc-status').textContent='QGroundControl: status unavailable';$('live-dot').classList.remove('live');pilotEnabled=false;$('error').textContent='Local flight service is unavailable. Open RESCUE Flight Lab again to reconnect; current telemetry is held.'}setTimeout(update,180)}controls();horizon(null);renderLaunch({running:false});update();

new ResizeObserver(()=>{horizon(latest?.flight||null);plot()}).observe(document.querySelector('.readouts'));

function closePilotControls(){center();$('pilot-panel').open=false}
$('pilot-close').onclick=closePilotControls;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('pilot-panel').open){e.preventDefault();closePilotControls()}});
document.addEventListener('pointerdown',e=>{if($('pilot-panel').open&&!$('pilot-panel').contains(e.target))closePilotControls()});
$('pilot-panel').addEventListener('toggle',()=>{if(!$('pilot-panel').open)center()});

const eventNames=['Sample','Unsafe descent','Risk cleared','Controls captured','Stable flight confirmed','Control handed to pilot','No pilot response','Low altitude','Continued descent','Recovery timeout','RESCUE disabled','Configuration fault','Pilot stick / throttle accepted','Insufficient height gain','Persistent rotation / attitude loss','Stability lost; handover cancelled','Imminent ground-datum crossing','Navigation sample unavailable','Airspeed recovery counts as progress'];
function eventDescription(text){const m=text.match(/^RESCUE state (\d+) event (\d+)$/);return m?eventNames[+m[2]]+' ['+['Monitor','Warning','Recovery','Stable','Parachute','Cooldown'][+m[1]]+']':text}
let catalogLoaded=false,lastSuite='';
function scenarioDescription(){const selected=latest?.tests?.cases?.find(c=>c.id===$('scenario-select').value);$('scenario-expect').textContent=selected?.expect||''}
// A scenario can contain more than one flight; scenario 2 covers both entry modes.
function scenarioForFlight(t,id){return t.cases?.find(c=>c.flights?.includes(id)||c.id===id)}
function renderTests(s){
 const t=s.tests||{};
 if(!catalogLoaded&&t.cases){
  $('scenario-select').replaceChildren(...t.cases.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent='Scenario '+c.number+': '+c.title;return o}));
  catalogLoaded=true;scenarioDescription();
 }
 $('run-selected').disabled=$('run-all').disabled=!!t.active;
 $('test-stop').disabled=!t.active;$('start').disabled=s.running||t.active;
 const results=(t.results||[]).filter(r=>scenarioForFlight(t,r.scenario));
 const requested=t.requested||results.map(r=>r.scenario);
 const scenarios=(t.cases||[]).filter(c=>c.flights.every(id=>requested.includes(id)));
 const passed=scenarios.filter(c=>c.flights.every(id=>results.some(r=>r.scenario===id&&r.passed))).length;
 $('suite-badge').textContent=t.active?'Running':scenarios.length?passed+'/'+scenarios.length+' selected passed':'7 scenarios';
 const current=scenarioForFlight(t,t.current);
 $('suite-status').textContent=t.active?
  ('Running '+(current?'scenario '+current.number+': '+current.title:'flight preparation')+'…'):
  results.length?(t.passed?passed+' '+(passed===1?'scenario':'scenarios')+' passed in '+results.length+' '+(results.length===1?'flight':'flights')+'.':'Completed with failed or stopped flights. Open evidence for details.'):
  'Seven scenarios. Scenario 2 uses separate MANUAL and AUTO flights.';
 const signature=JSON.stringify(results);
 if(signature!==lastSuite){
  lastSuite=signature;
  $('suite-results').replaceChildren(...results.map(r=>{
   const c=scenarioForFlight(t,r.scenario),row=document.createElement('div');
   row.className='suite-row '+(r.passed?'passed':'failed');
   const title=document.createElement('strong');title.textContent='Scenario '+c.number+': '+(r.scenario==='manual'?'Capture from MANUAL':r.scenario==='auto'?'Capture from AUTO':c.title);
   const verdict=document.createElement('span');verdict.textContent=r.passed?'Pass':r.cancelled?'Stopped':'Fail';row.append(title,verdict);
   const detail=document.createElement('small');detail.textContent=r.error||Object.entries(r.checks||{}).filter(([k,v])=>!v).map(([k])=>k).join(', ')||'BIN checks passed';row.append(detail);
   if(r.session){const review=document.createElement('button');review.className='report-action';review.textContent='Review charts';review.onclick=()=>ReportDesk.open(r.session);row.append(review);const a=document.createElement('a');a.href='/evidence.zip?session='+encodeURIComponent(r.session);a.textContent='BIN & evidence';a.download='';row.append(a)}
   return row;
  }));
 }
 $('evidence-download').hidden=!s.evidence;
 if(s.evidence)$('evidence-download').href='/evidence.zip?session='+encodeURIComponent(s.evidence);
}
function renderDecision(s){
 const d=s.decision||{},value=(v,unit)=>Number.isFinite(v)?v.toFixed(1)+unit:'—';
 $('decision-summary').textContent='Sink '+value(d.sink,' m/s')+' / Accel '+value(d.accel_down,' m/s²');
 $('decision-summary').title='Positive down. Descent '+value(d.descent_seconds,' s')+' / measured loss '+value(d.descent_loss,' m')+'. Home crossing '+value(d.time_to_home,' s')+'. Entry: acceleration rule OR persistent low-height impact risk; continuous 0.2 s dwell.';
 $('input-source').textContent='Input: '+(s.manual_ground?'QGroundControl':s.input_source||'waiting');
 const gates=[['gate-height',s.flight?.alt<100],['gate-accel',!!(d.risk&33)],['gate-descent',d.descent_seconds>=1&&d.descent_loss>=2]];
 for(const [id,met] of gates)$(id).classList.toggle('met',!!met&&s.flight?.armed);
 $('gate-state').textContent=!s.running?'Standby':s.rsc_state==='RECOVER'?'Active':s.rsc_state==='WARNING'?'Warning':s.flight?.armed?'Monitoring':'Disarmed';
}

async function runScenario(id){flightScene.beginSession?.();resetFlightInstruments();await action('/tests/run',{scenario:id,speedup:Number($('speedup').value)})}
$('scenario-select').onchange=scenarioDescription;$('run-selected').onclick=()=>runScenario($('scenario-select').value);$('run-all').onclick=()=>runScenario('all7');$('test-stop').onclick=()=>action('/stop');$('test-close').onclick=()=>{$('test-panel').open=false};
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('test-panel').open=false});
document.addEventListener('pointerdown',e=>{if($('test-panel').open&&!$('test-panel').contains(e.target))$('test-panel').open=false});

// Native dialog focus and Escape handling keep About usable with a keyboard.
$('about-open').onclick=()=>$('about-dialog').showModal();
$('about-close').onclick=()=>$('about-dialog').close();
$('about-dialog').addEventListener('click',e=>{if(e.target===$('about-dialog'))$('about-dialog').close()});
