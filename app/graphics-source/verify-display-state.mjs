import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FlightDisplayState } from './flight-state.js';
import { CanvasFlightScene } from './canvas-fallback.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/recorded-sessions.json',import.meta.url),'utf8'));
for(const session of fixture.sessions){const bin=fs.readFileSync(new URL('../'+session.source,import.meta.url));assert.equal(crypto.createHash('sha256').update(bin).digest('hex'),session.sha256,'Recorded source BIN must match the packaged fixture')}
const [a,b]=fixture.sessions,state=new FlightDisplayState(fixture.site);
for(const pose of a.samples){assert(state.accept(pose,pose.t*1000));for(let i=0;i<60;i++)state.sample(1/60,pose.t*1000+i*1000/60)}
assert(state.track.length>20);assert(state.display.canopy>.99,'Recorded first flight ends with an open canopy');
const end={...state.display},oldEpoch=state.epoch;
state.beginSession();assert.equal(state.track.length,0);assert.equal(state.frames.length,0);assert.equal(state.display.canopy,0);assert(state.epoch>oldEpoch);
assert.equal(state.accept(a.samples.at(-1)),false,'Late old-session response must not restore the old trail or canopy');
assert.equal(state.track.length,0);
for(const pose of b.samples){
 assert(state.accept(pose,pose.t*1000));for(let i=0;i<60;i++)state.sample(1/60,pose.t*1000+i*1000/60);
 assert(state.track.every(point=>point.session===b.id),'No old-to-new connecting segment is allowed');
}
assert(state.track.length>20);assert.equal(state.display.canopy,0);
let maxSegment=0;for(let i=1;i<state.track.length;i++)maxSegment=Math.max(maxSegment,Math.hypot(state.track[i].x-state.track[i-1].x,state.track[i].z-state.track[i-1].z));
assert(maxSegment<150,'Path segments must match the recorded one-second aircraft motion');
const epoch=state.epoch,count=state.track.length,last=b.samples.at(-1);
state.accept({...last,t:last.t+.1,mode:5,mode_name:'FBWA'});state.sample(1/60);
assert.equal(state.epoch,epoch,'A mode switch must not reset the same flight');assert.equal(state.track.length,count);
state.accept({...last,t:last.t+.2,mode:12,mode_name:'LOITER',phase:'Reposition'});
assert.equal(state.epoch,epoch,'A reposition phase must preserve the same session');
state.clear();assert.equal(state.track.length,0);assert.equal(state.display.canopy,0);assert.equal(state.hasTelemetry,false);
const timed=new FlightDisplayState(fixture.site),poses=b.interpolation_samples,first=poses[0].t,arrivals=poses.map((p,i)=>(p.t-first)*1000+(i?[0,9,-7,4][i%4]:0));
let next=0,previous=null,previousQ=null,moving=0,intermediate=0,maxStep=0,maxAngle=0,lastDisplayTime=-Infinity;
for(let now=0;now<=6000;now+=1000/60){
 while(next<poses.length&&arrivals[next]<=now){timed.accept(poses[next],arrivals[next]);next++}
 if(!timed.hasTelemetry)continue;
 timed.sample(1/60,now);const point=timed.point(timed.display);
 assert(timed.displayTime>=lastDisplayTime,'Buffered playback must not reverse when jittered packets arrive');lastDisplayTime=timed.displayTime;
 assert(Math.abs(timed.poseQuaternion.length()-1)<1e-8);
 if(now>1000&&previous){const step=Math.hypot(point.x-previous.x,point.y-previous.y,point.z-previous.z);maxStep=Math.max(maxStep,step);if(step>.02)moving++;maxAngle=Math.max(maxAngle,timed.poseQuaternion.angleTo(previousQ));if(!poses.some(p=>Math.hypot(p.lat-timed.display.lat,p.lon-timed.display.lon)<1e-10))intermediate++}
 previous=point;previousQ=timed.poseQuaternion.clone();
}
assert(moving>240,'Five-hertz recorded poses should produce motion on most 60-Hz display frames');assert(intermediate>200,'Display must interpolate between actual packets');assert(maxStep<1.5);assert(maxAngle<.03);
timed.beginSession();assert.equal(timed.frames.length,0);assert.equal(timed.track.length,0);assert.equal(timed.accept(poses.at(-1),7000),false);
globalThis.requestAnimationFrame=()=>0;globalThis.devicePixelRatio=1;let drawingCalls=0;
const context=new Proxy({measureText:text=>({width:text.length*6}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{drawingCalls++}});
const fallback=new CanvasFlightScene({width:810,height:546,getContext:()=>context,getBoundingClientRect:()=>({width:810,height:546})});
fallback.setSite(fixture.site);fallback.setTelemetry(a.samples.at(-1),false);fallback.draw(performance.now());fallback.beginSession();assert.equal(fallback.track.length,0);assert.equal(fallback.setTelemetry(a.samples.at(-1)),false);assert(fallback.setTelemetry(b.samples[0]));fallback.draw(performance.now());assert(drawingCalls>10);
const summary={passed:true,source_log_sha256:fixture.sessions.map(s=>s.sha256),actual_pose_samples:fixture.sessions.map(s=>s.samples.length),first_flight_end:{lat:end.lat,lon:end.lon,canopy:end.canopy},max_recorded_segment_m:maxSegment,late_old_session_rejected:true,atomic_pose_path_canopy_reset:true,mode_and_reposition_continuous:true,canvas_fallback_draw_and_reset:true,controlled_interpolation:{actual_poses:poses.length,input_interval_ms:200,display_interval_ms:1000/60,moving_frames:moving,intermediate_frames:intermediate,max_step_m:maxStep,max_quaternion_step_rad:maxAngle,buffer_cleared:true}};
console.log(JSON.stringify(summary,null,2));
