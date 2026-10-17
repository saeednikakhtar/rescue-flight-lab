/* RESCUE flight lab: local WebGL visualisation, not a dynamics engine.
   All pose, AGL, motor output and canopy inflation come from SITL telemetry.
   Landscape is illustrative and locally flat; aircraft/canopy size is enlarged. */
import * as THREE from './three.module.js';
import { batchStatic } from './batch.js';
import { FlightDisplayState } from './flight-state.js';
import { CanvasFlightScene } from './canvas-fallback.js';
import { makeAircraft } from './airframe.js';
import { makeLandscape, makeAtmosphere } from './landscape.js';
import { shortestAngleDelta as angleStep } from './motion.js';
import { FrameMonitor } from './frame-monitor.js';
import { drawHeightReference } from './height-reference.js';
import { makeRunwaySurface, DISPLAY_DEPTH, cameraRig, setCameraViewport } from './runway.js';

const RAD=Math.PI/180, SCALE=12;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hash=(a,b=0)=>{let v=Math.imul(a|0,374761393)+Math.imul(b|0,668265263);v=Math.imul(v^(v>>>13),1274126177);return((v^(v>>>16))>>>0)/4294967295};
const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296};

class WebGLFlightScene {
 constructor(canvas){
  this.c=canvas;this.hud=document.getElementById('scene-hud');this.x=this.hud.getContext('2d');
  this.camera='chase';this.live=false;this.hasTelemetry=false;this.site=null;this.origin=null;this.track=[];this.orbit=0;this.propAngle=0;this.lastFrame=0;this.treeCell='';
  this.d={t:0,alt:0,true_alt:0,agl:null,roll:0,pitch:0,yaw:0,heading:0,canopy:0,motor_pwm:1000,groundspeed:0,lat:0,lon:0};this.display={...this.d};
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  const gl=this.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),adapter=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'';
  this.c.dataset.graphicsBackend=adapter||'WebGL';
  this.renderer.setPixelRatio(/swiftshader|llvmpipe|software/i.test(adapter)?.75:Math.min(devicePixelRatio||1,1.25));this.renderer.shadowMap.enabled=false;
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.72;
  this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2('#b7ccd5',.00019);
  this.view=new THREE.PerspectiveCamera(40,1,DISPLAY_DEPTH.near,DISPLAY_DEPTH.far);
  this.scene.add(new THREE.HemisphereLight('#d5e8f4','#a0a68c',.65));
  this.sun=new THREE.DirectionalLight('#fff3dc',2.7);this.scene.add(this.sun,this.sun.target);
  makeAtmosphere.call(this);
  this.makeLandscape();this.makeAircraft();this.makeCanopy();this.makeReferences();
  this.quatYaw=new THREE.Quaternion();this.quatPitch=new THREE.Quaternion();this.quatRoll=new THREE.Quaternion();this.poseTarget=new THREE.Quaternion();this.cameraTarget=new THREE.Vector3();this.lookTarget=new THREE.Vector3();this.lookPosition=new THREE.Vector3();this.cameraPrimed=false;this.posePrimed=false;this.cameraHeading=0;this.sessionId=null;
  this.state=new FlightDisplayState();this.lastPathVersion=-1;this.renderEpoch=-1;this.scratchA=new THREE.Vector3();this.scratchB=new THREE.Vector3();this.lastHUD=0;
  this.size={width:canvas.clientWidth,height:canvas.clientHeight};this.resizeObserver=new ResizeObserver(entries=>{const r=entries[0].contentRect;this.size={width:r.width,height:r.height}});this.resizeObserver.observe(canvas);
  this.axisY=new THREE.Vector3(0,1,0);this.axisZ=new THREE.Vector3(0,0,1);this.axisX=new THREE.Vector3(1,0,0);
  const perfNode=document.getElementById('render-performance');this.frameMonitor=new FrameMonitor(perfNode);
  this.draw=this.draw.bind(this);requestAnimationFrame(this.draw);
 }
 material(color,roughness=.6,metalness=0){return new THREE.MeshStandardMaterial({color,roughness,metalness})}
 mesh(geometry,material,parent=this.scene){const m=new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
 box(parent,size,pos,material){const m=this.mesh(new THREE.BoxGeometry(...size),material,parent);m.position.set(...pos);return m}
 cylinder(parent,r1,r2,len,pos,material,axis='y',segments=16){const m=this.mesh(new THREE.CylinderGeometry(r1,r2,len,segments),material,parent);if(axis==='x')m.rotation.z=-Math.PI/2;if(axis==='z')m.rotation.x=Math.PI/2;m.position.set(...pos);return m}
 makeLandscape(){makeLandscape.call(this)}
 populateTrees(east,south){
  const cx=Math.floor(east/2000),cz=Math.floor(south/2000),key=cx+','+cz;if(key===this.treeCell)return;this.treeCell=key;
  const dummy=new THREE.Object3D(),color=new THREE.Color();let crownCount=0,trunkCount=0;
  for(let i=cx*5-4;i<=cx*5+4;i++)for(let j=cz*5-4;j<=cz*5+4;j++){
   const forest=hash(i,j)>.62,count=forest?5+Math.floor(hash(i+9,j)*5):hash(i,j)>.25?2:0,centerX=i*400+hash(i,j+4)*300,centerZ=j*400+hash(j,i+8)*300;
   for(let k=0;k<count;k++){
    const px=forest?centerX+(hash(i*33+k,j)-.5)*160:i*400+hash(i*33+k,j)*370,pz=forest?centerZ+(hash(j*41+k,i)-.5)*160:j*400+hash(j*41+k,i)*370;
    if(this.airfield){const a=(this.site?.heading||0)*RAD,dx=px-this.airfield.position.x,dz=pz-this.airfield.position.z,along=-dx*Math.sin(a)+dz*Math.cos(a),across=dx*Math.cos(a)+dz*Math.sin(a);if(Math.abs(along)<(this.site?.runway_length_m||800)*.62&&Math.abs(across)<100)continue}
    const size=4+hash(i*19+k,j*3)*5;
    if(trunkCount<1000){dummy.position.set(px,3,pz);dummy.scale.setScalar(.6+size*.055);dummy.rotation.set(0,0,0);dummy.updateMatrix();this.trunks.setMatrixAt(trunkCount++,dummy.matrix)}
    for(let q=0;q<2&&crownCount<2000;q++){
     dummy.position.set(px+(q?size*.42:0),size*(q?.96:1.2),pz+(q?-size*.18:0));dummy.scale.set(size*(q?.65:.78),size*(q?.72:1.02),size*(q?.66:.75));dummy.rotation.set(hash(k,i),hash(i,j)*6,hash(j,k)*.3);dummy.updateMatrix();this.trees.setMatrixAt(crownCount,dummy.matrix);color.setHSL(.23+hash(k+i,j)*.08,.19+hash(i,k)*.17,.21+hash(j,k+i)*.13);this.trees.setColorAt(crownCount++,color);
    }
   }
  }
  this.trees.count=crownCount;this.trunks.count=trunkCount;this.trees.instanceMatrix.needsUpdate=true;this.trees.instanceColor.needsUpdate=true;this.trunks.instanceMatrix.needsUpdate=true;this.trees.computeBoundingSphere();this.trunks.computeBoundingSphere();
 }
 setSite(site){
  if(!site||!Number.isFinite(site.lat)||!Number.isFinite(site.lon))return;
  const key=[site.lat,site.lon,site.heading,site.runway_length_m,site.runway_width_m,site.surface].join(',');if(this.siteKey===key)return;
  this.siteKey=key;this.site={...site};this.origin={lat:site.lat,lon:site.lon};this.track=[];
  if(!this.hasTelemetry){this.d.lat=site.lat;this.d.lon=site.lon;this.d.yaw=site.heading||0;this.display={...this.d}}
  while(this.airfield.children.length){const child=this.airfield.children[0];this.airfield.remove(child);child.geometry?.dispose()}
  const field=this.airfield,heading=(site.heading||0)*RAD,length=site.runway_length_m||800,width=site.runway_width_m||40;
  field.rotation.y=-heading;field.position.set(Math.sin(heading)*length/2,0,-Math.cos(heading)*length/2);
  field.add(makeRunwaySurface(site,{maxAnisotropy:this.renderer.capabilities.getMaxAnisotropy()}));
  const roof=this.material('#73828a',.68,.2),wall=this.material('#c7c4af',.95);
  for(let i=0;i<3;i++){
   const hangar=new THREE.Group();hangar.position.set(width/2+85+i*48,0,-length*.23);field.add(hangar);this.box(hangar,[36,10,26],[0,5,0],wall);
   const roofShape=new THREE.Shape();roofShape.moveTo(-19,0);roofShape.lineTo(19,0);roofShape.lineTo(0,4.5);roofShape.closePath();const roofMesh=this.mesh(new THREE.ExtrudeGeometry(roofShape,{depth:28,bevelEnabled:false}),roof,hangar);roofMesh.position.set(0,10,-14);
   this.box(hangar,[27,7,.12],[0,3.6,13.08],this.material('#647676',.9));
  }
  this.treeCell='';this.populateTrees(this.position?.x||0,this.position?.z||0);batchStatic(this.airfield);this.state?.setSite(site);
 }
 makeAircraft(){
  makeAircraft.call(this);
  // Reflections belong on the aircraft. Applying the environment to every
  // ground and foliage fragment costs fill rate without a useful visual gain.
  this.aircraft.traverse(node=>{if(node.isMesh&&node.material.isMeshStandardMaterial){node.material.envMap=this.environmentMap.texture;node.material.envMapIntensity=.05;node.material.needsUpdate=true}});
  this.aircraftShadowGeometry?.dispose();this.aircraftShadowGeometry=null;
 }
 makeCanopy(){
  this.canopy=new THREE.Group();this.canopy.scale.setScalar(SCALE);this.scene.add(this.canopy);this.dome=new THREE.Group();this.canopy.add(this.dome);
  const fabric=new THREE.SphereGeometry(1,40,12,0,Math.PI*2,0,Math.PI/2).toNonIndexed(),p=fabric.attributes.position,colors=new Float32Array(p.count*3),orange=new THREE.Color('#e7a34b'),ivory=new THREE.Color('#e8e6d7');
  for(let i=0;i<p.count;i+=3){const az=Math.atan2(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2),p.getX(i)+p.getX(i+1)+p.getX(i+2));const c=((Math.floor((az+Math.PI)*10/Math.PI))%2)?ivory:orange;for(let k=0;k<3;k++)c.toArray(colors,(i+k)*3)}
  fabric.setAttribute('color',new THREE.BufferAttribute(colors,3));this.mesh(fabric,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,side:THREE.DoubleSide}),this.dome);
  const positions=new Float32Array(20*2*3);this.suspensionGeometry=new THREE.BufferGeometry();this.suspensionGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));this.suspension=new THREE.LineSegments(this.suspensionGeometry,new THREE.LineBasicMaterial({color:'#e7d7b4',transparent:true,opacity:.90}));this.suspension.frustumCulled=false;this.scene.add(this.suspension);
  const seam=[];for(let j=0;j<20;j++)for(let k=0;k<16;k++)for(const t of [k*Math.PI/32,(k+1)*Math.PI/32]){const a=j*Math.PI/10;seam.push(Math.cos(a)*Math.sin(t),Math.cos(t),Math.sin(a)*Math.sin(t))}
  this.seams=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(seam,3)),new THREE.LineBasicMaterial({color:'#a8815c',transparent:true,opacity:.55}));this.canopy.add(this.seams);
 }
 makeReferences(){
  this.ring=this.mesh(new THREE.RingGeometry(9.7,10,64),new THREE.MeshBasicMaterial({color:'#d8ede2',transparent:true,opacity:.72,side:THREE.DoubleSide}));this.ring.rotation.x=-Math.PI/2;this.ring.position.y=.10;this.ring.castShadow=false;
  this.tether=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:'#fcf6c8',dashSize:2.5,gapSize:2,transparent:true,opacity:1}));this.scene.add(this.tether);
  this.pathArray=new Float32Array(600*3);this.pathGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(this.pathArray,3).setUsage(THREE.DynamicDrawUsage));this.pathGeometry.setDrawRange(0,0);this.trail=new THREE.Line(this.pathGeometry,new THREE.LineBasicMaterial({color:'#a2ded1',transparent:true,opacity:.7,depthTest:false,depthWrite:false}));this.trail.frustumCulled=false;this.trail.renderOrder=4;this.tether.frustumCulled=false;this.scene.add(this.trail);
  const grid=new THREE.GridHelper(2800,28,'#cdd6b8','#cdd6b8');grid.material.transparent=true;grid.material.opacity=.065;grid.position.y=.025;this.grid=grid;grid.visible=false;this.scene.add(grid);
 }
 location(d){const ref=this.origin||{lat:d.lat,lon:d.lon};return new THREE.Vector3((d.lon-ref.lon)*111320*Math.cos(ref.lat*RAD),Math.max(0,Number.isFinite(d.agl)?d.agl:(d.true_alt??d.alt??0)),-(d.lat-ref.lat)*111320)}
 syncState(){
  const state=this.state;this.d=state.target;this.display=state.display;this.track=state.track;this.hasTelemetry=state.hasTelemetry;this.positionValid=state.positionValid;this.sessionId=state.sessionId;
  if(this.renderEpoch!==state.epoch){this.renderEpoch=state.epoch;this.orbit=0;this.propAngle=0;this.lastFrame=0;this.cameraPrimed=false;this.posePrimed=false;this.cameraHeading=(this.d.yaw||0)*RAD;this.pathGeometry.setDrawRange(0,0);this.lastHUD=0}
  if(this.lastPathVersion!==state.pathVersion){this.lastPathVersion=state.pathVersion;let i=0;for(const p of state.track){this.pathArray[i++]=p.x;this.pathArray[i++]=.13;this.pathArray[i++]=p.z}this.pathGeometry.attributes.position.needsUpdate=true;this.pathGeometry.setDrawRange(0,state.track.length)}
  const node=document.getElementById('path-diagnostic');if(node)node.textContent=`Flight path: ${state.track.length} points · session ${state.epoch} · ${state.positionValid?'measured position':'waiting for position'}`;
 }
 beginSession(){this.state.beginSession();this.live=false;this.syncState()}
 clear(){this.state.clear();this.live=false;this.syncState()}
 setTelemetry(d,live=true){if(!this.state.accept(d))return false;this.live=live;this.syncState();return true}
 draw(now){
  const w=this.size.width,h=this.size.height;if(!w||!h||document.hidden){requestAnimationFrame(this.draw);return}
  const cpuStart=performance.now(),dt=Math.min(.06,(now-this.lastFrame)/1000||.016);this.lastFrame=now;
  this.state.sample(dt,now);const d=this.display;
  const pos=this.location(d),height=pos.y,frac=clamp(d.canopy||0,0,1),heading=d.yaw*RAD;this.position=pos;
  if(now-(this.lastTreeCheck||0)>1500){this.lastTreeCheck=now;this.populateTrees(pos.x,pos.z)}this.ground.position.x=Math.round(pos.x/4096)*4096;this.ground.position.z=Math.round(pos.z/4096)*4096;
  // Repeated terrain texture stays locked to world coordinates when recentered.
  this.grid.position.x=Math.round(pos.x/100)*100;this.grid.position.z=Math.round(pos.z/100)*100;
  this.aircraft.position.set(pos.x,height+(this.airframeLift??.54*SCALE),pos.z);
  this.quatYaw.setFromAxisAngle(this.axisY,Math.PI/2-(this.d.yaw||0)*RAD);this.quatPitch.setFromAxisAngle(this.axisZ,(this.d.pitch||0)*RAD);this.quatRoll.setFromAxisAngle(this.axisX,(this.d.roll||0)*RAD);
  this.poseTarget.copy(this.quatYaw).multiply(this.quatPitch).multiply(this.quatRoll);
  if(this.hasTelemetry)this.aircraft.quaternion.copy(this.state.poseQuaternion);else this.aircraft.quaternion.copy(this.poseTarget);
  const throttle=clamp((d.motor_pwm-1000)/1000,0,1);if(this.live)this.propAngle+=dt*throttle*220;this.prop.rotation.x=this.propAngle;
  this.canopy.visible=this.suspension.visible=frac>.001;this.canopy.position.copy(this.aircraft.position);const radius=1.46*Math.sqrt(frac),base=1.25+1.35*frac;
  this.dome.position.y=base;this.dome.scale.set(radius,radius*.70,radius);this.seams.position.y=base;this.seams.scale.copy(this.dome.scale);
  this.aircraft.updateMatrixWorld(true);const lineArray=this.suspensionGeometry.attributes.position.array;
  if(frac>.001){for(let i=0;i<20;i++){const az=i*Math.PI/10,a=this.scratchA.set(radius*Math.cos(az),base,radius*Math.sin(az)).multiplyScalar(SCALE).add(this.aircraft.position),b=this.aircraft.localToWorld(this.scratchB.set(-.2,.12,i%2?.14:-.14));a.toArray(lineArray,i*6);b.toArray(lineArray,i*6+3)}this.suspensionGeometry.attributes.position.needsUpdate=true;}
  this.ring.visible=height>4&&this.hasTelemetry;this.tether.visible=height>4&&this.hasTelemetry;this.ring.position.x=pos.x;this.ring.position.z=pos.z;const vertices=this.tether.geometry.attributes.position;vertices.setXYZ(0,pos.x,.2,pos.z);vertices.setXYZ(1,pos.x,Math.max(.2,height),pos.z);vertices.needsUpdate=true;this.tether.computeLineDistances();
  this.cameraHeading+=angleStep(this.cameraHeading,heading)*(1-Math.exp(-dt*3.5));
  if(this.camera==='orbit'&&this.live&&!matchMedia('(prefers-reduced-motion: reduce)').matches)this.orbit+=dt*.16;
  const detail=this.camera==='detail',angle=this.cameraHeading+(detail ? .75 : this.camera==='orbit'?this.orbit:0),rig=cameraRig(height,frac,detail),distance=rig.distance;
  this.cameraTarget.set(pos.x-Math.sin(angle)*distance+Math.cos(angle)*distance*.27,height+rig.elevation,pos.z+Math.cos(angle)*distance+Math.sin(angle)*distance*.27);
  this.lookTarget.set(pos.x,height+rig.lookElevation,pos.z);
  if(!this.cameraPrimed){this.view.position.copy(this.cameraTarget);this.lookPosition.copy(this.lookTarget);this.cameraPrimed=true}else{const b=1-Math.exp(-dt*6);this.view.position.lerp(this.cameraTarget,b);this.lookPosition.lerp(this.lookTarget,b)}
  this.view.lookAt(this.lookPosition);
  this.sky.position.copy(this.view.position);
  this.sun.position.set(pos.x-420,height+650,pos.z+380);this.sun.target.position.set(pos.x,0,pos.z);
  if(this.width!==w||this.height!==h){this.width=w;this.height=h;this.renderer.setSize(w,h,false);setCameraViewport(this.view,w,h)}
  this.renderer.render(this.scene,this.view);if(now-this.lastHUD>70){this.lastHUD=now;this.drawHUD(w,h,d,pos)}this.frameMonitor?.sample(now,performance.now()-cpuStart,this.renderer.info.render);requestAnimationFrame(this.draw);
 }
 drawHUD(w,h,d,pos){
  const x=this.x,pr=Math.min(devicePixelRatio||1,1.25);if(this.hud.width!==Math.round(w*pr)||this.hud.height!==Math.round(h*pr)){this.hud.width=Math.round(w*pr);this.hud.height=Math.round(h*pr)}x.setTransform(pr,0,0,pr,0,0);x.clearRect(0,0,w,h);
  const height=Math.max(0,Number.isFinite(this.d.agl)?this.d.agl:(this.d.true_alt??this.d.alt??0)),project=p=>{const q=p.clone().project(this.view);return[q.x*w/2+w/2,-q.y*h/2+h/2,q.z]};
  const anchor=project(this.aircraft.position),foot=project(new THREE.Vector3(pos.x,0,pos.z));
  drawHeightReference(x,w,h,{anchor,foot,height,groundKnown:Number.isFinite(this.d.agl),valid:this.hasTelemetry&&this.positionValid});
  const size=w<560?94:112,mx=w-size-18,my=h-size-102,scale=.12,cx=mx+size/2,cy=my+size/2;
  x.save();x.beginPath();x.rect(mx,my,size,size);x.clip();x.fillStyle='#102c34e8';x.fillRect(mx,my,size,size);x.strokeStyle='#87b3a144';x.lineWidth=1;
  for(let i=-5;i<=5;i++){const e=(Math.floor(pos.x/100)+i)*100,n=(Math.floor(pos.z/100)+i)*100,px=cx+(e-pos.x)*scale,py=cy+(n-pos.z)*scale;x.beginPath();x.moveTo(px,my);x.lineTo(px,my+size);x.moveTo(mx,py);x.lineTo(mx+size,py);x.stroke()}
  if(this.site){const a=(this.site.heading||0)*RAD,len=this.site.runway_length_m||800;const sx=cx-pos.x*scale,sy=cy-pos.z*scale;x.strokeStyle='#e9cc6e';x.lineWidth=5;x.beginPath();x.moveTo(sx,sy);x.lineTo(sx+Math.sin(a)*len*scale,sy-Math.cos(a)*len*scale);x.stroke();x.strokeStyle='#4d9d7b';x.lineWidth=3;x.stroke()}
  x.strokeStyle='#9ae8db';x.lineWidth=1.5;x.beginPath();this.track.forEach((p,i)=>{const px=cx+(p.x-pos.x)*scale,py=cy+(p.z-pos.z)*scale;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke();x.translate(cx,cy);x.rotate(d.yaw*RAD);x.fillStyle='#fff1c7';x.beginPath();x.moveTo(0,-8);x.lineTo(5,6);x.lineTo(0,3);x.lineTo(-5,6);x.closePath();x.fill();x.restore();x.strokeStyle='#b3d0c759';x.strokeRect(mx,my,size,size);x.font='10px Segoe UI,sans-serif';x.fillStyle='#d5e7de';x.fillText('N ↑',mx+6,my+14);x.fillText('100 m',mx+6,my+size-6);x.strokeStyle='#d6e7dc';x.beginPath();x.moveTo(mx+54,my+size-9);x.lineTo(mx+66,my+size-9);x.stroke();
 }
}

const canvas=document.getElementById('scene');
try{
 globalThis.flightScene=new WebGLFlightScene(canvas);
 const label=document.getElementById('renderer-name');if(label)label.textContent='3D · WEBGL';
}catch(error){
 console.warn('WebGL flight renderer unavailable; using the basic reference view.',error);
 const replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);const hud=document.getElementById('scene-hud');if(hud)hud.style.display='none';
 globalThis.flightScene=new CanvasFlightScene(replacement);const label=document.getElementById('renderer-name');if(label)label.textContent='BASIC VIEW';const detail=document.getElementById('cam-detail');if(detail)detail.disabled=true;
}
