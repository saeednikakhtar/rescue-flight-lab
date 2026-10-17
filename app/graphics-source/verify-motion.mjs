import assert from 'node:assert/strict';
import { shortestAngleDelta, isNewSession, validGeoPosition } from './motion.js';
import { Quaternion, Vector3 } from './three.module.js';
const rad=Math.PI/180;

// Camera headings may accumulate far beyond one revolution during long LOITER.
for(const direction of [-1,1]){
 let camera=359*rad;
 for(let i=0;i<360*24;i++){
  const expected=(359+direction*(i+1))*rad,wrapped=((expected/rad%360)+360)%360*rad;
  const step=shortestAngleDelta(camera,wrapped);
  assert(Math.abs(step-direction*rad)<1e-10,'Heading reversed or jumped after repeated wraps');
  camera+=step;
 }
}
// Quaternion interpolation crosses 359 -> 0 with a one-degree arc.
const axis=new Vector3(0,1,0),a=new Quaternion().setFromAxisAngle(axis,359*rad),b=new Quaternion().setFromAxisAngle(axis,0);
const half=a.clone().slerp(b,.5);
assert(Math.abs(a.angleTo(half)-.5*rad)<1e-10);
assert(Math.abs(half.angleTo(b)-.5*rad)<1e-10);
assert(isNewSession('flight-a',220,{session_id:'flight-b',t:240}),'New session with increasing time must reset');
assert(isNewSession('flight-a',220,{session_id:'flight-a',t:2}),'Rewound time must reset');
assert(!isNewSession('flight-a',220,{session_id:'flight-a',t:221}),'Same-aircraft reposition must preserve motion');
assert(!validGeoPosition({lat:0,lon:0}),'Uninitialised GPS must not create a trail across the world');
assert(!validGeoPosition({lat:NaN,lon:35.8}));assert(!validGeoPosition({lat:156,lon:35.8}));
assert(!validGeoPosition({lat:56.09,lon:35.88,position_valid:false}));
assert(validGeoPosition({lat:56.0953903,lon:35.883429}));assert(validGeoPosition({lat:0,lon:35.8}));
const site={lat:56.0953903,lon:35.883429};
assert(!validGeoPosition({lat:.0001467,lon:-.0002737},site),'EKF drift around 0,0 must not appear at the remote launch site');
assert(validGeoPosition({lat:56.1002,lon:35.8761},site));
console.log('PASS: 24 full turns in each direction, quaternion wrap, session/rewind continuity, and invalid initial position guards.');
