// Display helpers only; these functions never change flight telemetry or controls.
export const shortestAngleDelta=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
export const isNewSession=(previousId,previousTime,data)=>
 (data.session_id!==undefined&&data.session_id!==previousId)||
 (Number.isFinite(data.t)&&data.t<previousTime-.01);
export const validGeoPosition=(data,reference=null)=>{
 if(data.position_valid===false||!Number.isFinite(data.lat)||!Number.isFinite(data.lon)||Math.abs(data.lat)>90||Math.abs(data.lon)>180||(data.lat===0&&data.lon===0))return false;
 // An uninitialised EKF can drift slightly away from 0,0 before GPS alignment.
 // A lab launch cannot legitimately move thousands of kilometres in one sample.
 if(reference&&Number.isFinite(reference.lat)&&Number.isFinite(reference.lon)){
  const north=(data.lat-reference.lat)*111320,east=(data.lon-reference.lon)*111320*Math.cos(reference.lat*Math.PI/180);
  if(Math.hypot(north,east)>25000)return false;
 }
 return true;
};
