import { shortestAngleDelta, validGeoPosition } from './motion.js';
import { Quaternion, Vector3 } from './three.module.js';
const RAD=Math.PI/180;
const defaults=site=>({t:0,lat:site?.lat||0,lon:site?.lon||0,alt:0,true_alt:0,agl:null,roll:0,pitch:0,yaw:site?.heading||0,heading:site?.heading||0,canopy:0,motor_pwm:1000,groundspeed:0});

// The renderer's actual pose/path owner, deliberately independent of WebGL.
// A session boundary is one transaction: pose seed, path and generation change.
export class FlightDisplayState {
 constructor(site=null){this.site=site;this.retired=new Set();this.sessionId=null;this.epoch=0;this.pathVersion=0;this.track=[];this.hasTelemetry=false;this.positionValid=false;this.lastPosition=null;this.target=defaults(site);this.display={...this.target};this.lastT=-1;this.pending=false;this.frames=[];this.poseQuaternion=new Quaternion();this.qy=new Quaternion();this.qp=new Quaternion();this.qr=new Quaternion();this.yAxis=new Vector3(0,1,0);this.zAxis=new Vector3(0,0,1);this.xAxis=new Vector3(1,0,0);this.latestArrival=0;this.rate=1;this.delay=.22}
 setSite(site){this.site=site;if(!this.hasTelemetry){this.target=defaults(site);this.display={...this.target}}}
 retire(id){if(id!==null&&id!==undefined)this.retired.add(id);while(this.retired.size>12)this.retired.delete(this.retired.values().next().value)}
 beginSession(){
  this.retire(this.sessionId);this.sessionId=null;this.pending=true;this.hasTelemetry=false;this.positionValid=false;this.lastPosition=null;this.track=[];this.frames=[];this.displayTime=0;this.pathVersion++;this.epoch++;this.target=defaults(this.site);this.display={...this.target};this.poseQuaternion.identity();
 }
 clear(){if(this.hasTelemetry||!this.pending)this.beginSession()}
 point(d){const ref=this.site||d;return{x:(d.lon-ref.lon)*111320*Math.cos(ref.lat*RAD),y:Math.max(0,Number.isFinite(d.agl)?d.agl:(d.true_alt??d.alt??0)),z:-(d.lat-ref.lat)*111320}}
 accept(input,arrival=performance.now()){
  const id=input.session_id??null,t=Number.isFinite(input.t)?input.t:0;
  if(id!==null&&this.retired.has(id))return false;
  // A late response from the old flight must not undo a launch-button clear.
  if(this.pending&&id===null&&t>=this.lastT&&this.lastT>=0)return false;
  const fresh=!this.hasTelemetry||(id!==null&&id!==this.sessionId)||t<this.lastT-.01;
  const reference=(!fresh&&this.lastPosition)||this.site;
  let valid=validGeoPosition(input,reference);
  if(valid&&fresh&&t<20&&this.site){const p=this.point(input);if(Math.hypot(p.x,p.z)>100)valid=false}
  const ref=valid?input:reference||{lat:0,lon:0};
  const d={...input,t,lat:ref.lat,lon:ref.lon};
  if(fresh){
   if(this.sessionId!==id)this.retire(this.sessionId);
   this.sessionId=id;this.track=[];this.frames=[];this.rate=1;this.displayTime=t;this.pathVersion++;this.epoch++;this.lastPosition=null;this.display={...defaults(this.site),...d};
  }
  this.pending=false;this.hasTelemetry=true;this.positionValid=valid;this.target={...defaults(this.site),...d};this.lastT=t;
  for(const [key,value]of Object.entries(this.target))if(!['lat','lon','alt','true_alt','agl','canopy','roll','pitch','yaw'].includes(key))this.display[key]=value;
  const lastFrame=this.frames.at(-1);
  if(!lastFrame||t>lastFrame.t){
   if(lastFrame&&arrival>this.latestArrival+20){const rate=(t-lastFrame.t)*1000/(arrival-this.latestArrival);if(rate>.1&&rate<10)this.rate=this.rate*.7+rate*.3}
   this.qy.setFromAxisAngle(this.yAxis,Math.PI/2-(d.yaw||0)*RAD);this.qp.setFromAxisAngle(this.zAxis,(d.pitch||0)*RAD);this.qr.setFromAxisAngle(this.xAxis,(d.roll||0)*RAD);
   const q=this.qy.clone().multiply(this.qp).multiply(this.qr);this.frames.push({...d,q});if(this.frames.length>8)this.frames.shift();this.latestArrival=arrival;
   if(fresh)this.poseQuaternion.copy(q);
  }
  if(valid){
   this.lastPosition={lat:d.lat,lon:d.lon};const p=this.point(d),last=this.track.at(-1);
   if(!last||Math.hypot(p.x-last.x,p.z-last.z)>3){this.track.push({...p,t,session:id});if(this.track.length>600)this.track.shift();this.pathVersion++}
  }
  return true;
 }
 sample(dt,now=performance.now()){
  if(!this.frames.length)return this.display;
  const last=this.frames.at(-1),candidate=last.t+(Math.max(0,now-this.latestArrival)/1000-this.delay)*this.rate,time=Math.min(last.t,Math.max(this.displayTime??candidate,candidate));this.displayTime=time;
  let a=this.frames[0],b=a;for(const frame of this.frames){if(frame.t<=time)a=frame;if(frame.t>=time){b=frame;break}b=frame}
  const u=a===b?0:Math.max(0,Math.min(1,(time-a.t)/(b.t-a.t)));
  for(const k of ['lat','lon','alt','true_alt','agl','canopy']){const av=a[k],bv=b[k];if(Number.isFinite(av)&&Number.isFinite(bv))this.display[k]=av+(bv-av)*u;else if(Number.isFinite(bv))this.display[k]=bv}
  for(const k of ['roll','pitch','yaw'])if(Number.isFinite(a[k])&&Number.isFinite(b[k]))this.display[k]=a[k]+shortestAngleDelta(a[k]*RAD,b[k]*RAD)/RAD*u;
  this.poseQuaternion.copy(a.q).slerp(b.q,u);
  return this.display;
 }
}
