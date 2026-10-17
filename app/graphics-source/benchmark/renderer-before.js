/* RESCUE flight lab: local WebGL visualisation, not a dynamics engine.

   All pose, AGL, motor output and canopy inflation come from SITL telemetry.

   Landscape is illustrative and locally flat; aircraft/canopy size is enlarged. */

import * as THREE from '../three.module.js';
import { FrameMonitor } from '../frame-monitor.js';

import { Sky } from '../Sky.js';

import { CanvasFlightScene } from '../canvas-fallback.js';

import { makeAircraft } from './airframe-before.js';

import { shortestAngleDelta as angleStep, isNewSession, validGeoPosition } from '../motion.js';



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

  this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;

  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.78;

  this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2('#bacbd0',.00023);

  this.view=new THREE.PerspectiveCamera(40,1,.5,30000);

  this.scene.add(new THREE.HemisphereLight('#bcdaf5','#8b906c',2.2));

  this.sun=new THREE.DirectionalLight('#fff0d6',3.5);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-300;this.sun.shadow.camera.right=300;this.sun.shadow.camera.top=300;this.sun.shadow.camera.bottom=-300;this.sun.shadow.camera.near=10;this.sun.shadow.camera.far=1800;this.sun.shadow.bias=-.00025;this.sun.shadow.normalBias=.14;this.sun.shadow.radius=3;this.scene.add(this.sun,this.sun.target);

  const sky=new Sky();sky.scale.setScalar(20000);sky.material.uniforms.turbidity.value=1.3;sky.material.uniforms.rayleigh.value=3.0;sky.material.uniforms.mieCoefficient.value=.002;sky.material.uniforms.mieDirectionalG.value=.80;sky.material.uniforms.cloudCoverage.value=.15;sky.material.uniforms.cloudDensity.value=.22;

  sky.material.fragmentShader=sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );','gl_FragColor = vec4( texColor * 0.25, 1.0 );');

  const sunDirection=new THREE.Vector3(-.48,.72,.50).normalize();sky.material.uniforms.sunPosition.value.copy(sunDirection);this.sky=sky;this.scene.add(sky);

  this.makeLandscape();this.makeAircraft();this.makeCanopy();this.makeReferences();

  this.quatYaw=new THREE.Quaternion();this.quatPitch=new THREE.Quaternion();this.quatRoll=new THREE.Quaternion();this.poseTarget=new THREE.Quaternion();this.cameraTarget=new THREE.Vector3();this.lookTarget=new THREE.Vector3();this.lookPosition=new THREE.Vector3();this.cameraPrimed=false;this.posePrimed=false;this.cameraHeading=0;this.sessionId=null;

  this.axisY=new THREE.Vector3(0,1,0);this.axisZ=new THREE.Vector3(0,0,1);this.axisX=new THREE.Vector3(1,0,0);

  this.frameMonitor=new FrameMonitor(document.getElementById('render-performance'));
  this.draw=this.draw.bind(this);requestAnimationFrame(this.draw);

 }

 material(color,roughness=.6,metalness=0){return new THREE.MeshStandardMaterial({color,roughness,metalness})}

 mesh(geometry,material,parent=this.scene){const m=new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}

 box(parent,size,pos,material){const m=this.mesh(new THREE.BoxGeometry(...size),material,parent);m.position.set(...pos);return m}

 cylinder(parent,r1,r2,len,pos,material,axis='y',segments=16){const m=this.mesh(new THREE.CylinderGeometry(r1,r2,len,segments),material,parent);if(axis==='x')m.rotation.z=-Math.PI/2;if(axis==='z')m.rotation.x=Math.PI/2;m.position.set(...pos);return m}

 makeLandscape(){

  const rand=seeded(28051967),canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const x=canvas.getContext('2d');

  x.fillStyle='#7c8d55';x.fillRect(0,0,2048,2048);

  const colors=['#72864d','#819457','#9b9c63','#71804b','#8b9862','#aaa477','#647d49','#92a16c'];

  for(let row=0;row<14;row++)for(let col=0;col<14;col++){

   const px=col*150,py=row*150,offset=(rand()-.5)*30;x.fillStyle=colors[Math.floor(rand()*colors.length)];x.beginPath();x.moveTo(px+5,py+7);x.lineTo(px+145+offset,py+2);x.lineTo(px+146,py+145);x.lineTo(px-6,py+148);x.closePath();x.fill();

   x.strokeStyle='#4c653a24';x.lineWidth=1;for(let k=0;k<14;k++){x.beginPath();x.moveTo(px+k*11,py+8);x.lineTo(px+k*11+offset,py+142);x.stroke()}

  }

  for(let i=0;i<100000;i++){const v=rand();x.fillStyle=v>.5?'#e2dbac12':'#263e2514';x.fillRect(rand()*2048,rand()*2048,.5+rand()*2,.5+rand()*3)}

  for(let i=0;i<4;i++){

   const y=220+i*490;x.beginPath();x.moveTo(-20,y);x.bezierCurveTo(550,y+70,960,y-110,2100,y+120);x.strokeStyle='#aeb08a';x.lineWidth=5;x.stroke();x.strokeStyle='#d2cbb0';x.lineWidth=2.3;x.stroke();

   const a=160+i*550;x.beginPath();x.moveTo(a,-20);x.bezierCurveTo(a+140,700,a-110,1300,a+120,2100);x.strokeStyle='#aeb08a';x.lineWidth=5;x.stroke();x.strokeStyle='#cfc8a9';x.lineWidth=2.2;x.stroke();

  }

  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(20000/4096,20000/4096);texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());

  const mat=this.material('#ffffff',1);mat.map=texture;this.ground=this.mesh(new THREE.PlaneGeometry(20000,20000),mat);this.ground.rotation.x=-Math.PI/2;this.ground.castShadow=false;

  this.airfield=new THREE.Group();this.scene.add(this.airfield);

  // Rounded, varied crowns provide scale without claiming a real tree survey.

  const crown=new THREE.IcosahedronGeometry(1,2),verts=crown.attributes.position;

  for(let i=0;i<verts.count;i++){const v=new THREE.Vector3().fromBufferAttribute(verts,i);v.multiplyScalar(.9+hash(i,4)*.23);verts.setXYZ(i,v.x,v.y,v.z)}crown.computeVertexNormals();

  this.trees=new THREE.InstancedMesh(crown,this.material('#527348',.95),2000);this.trees.castShadow=true;this.trees.receiveShadow=true;this.trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(this.trees);

  this.trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.45,.65,6,7),this.material('#71604b',.95),1000);this.trunks.castShadow=true;this.trunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(this.trunks);this.populateTrees(0,0);

 }

 populateTrees(east,south){

  const cx=Math.floor(east/400),cz=Math.floor(south/400),key=cx+','+cz;if(key===this.treeCell)return;this.treeCell=key;

  const dummy=new THREE.Object3D(),color=new THREE.Color();let crownCount=0,trunkCount=0;

  for(let i=cx-5;i<=cx+5;i++)for(let j=cz-5;j<=cz+5;j++){

   const forest=hash(i,j)>.62,count=forest?12+Math.floor(hash(i+9,j)*9):hash(i,j)>.25?2:0,centerX=i*400+hash(i,j+4)*300,centerZ=j*400+hash(j,i+8)*300;

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

  const grass=this.material('#82935e',1),dark=this.material('#575b57',.98),white=this.material('#ece5c8',.9);

  const grassStrip=this.box(field,[width+22,.035,length+50],[0,.015,0],grass);grassStrip.castShadow=false;

  const paved=/asphalt|concrete|paved/i.test(site.surface||'');

  if(paved){this.box(field,[width,.04,length],[0,.045,0],dark).castShadow=false;for(let z=-length/2+30;z<length/2-20;z+=55)this.box(field,[.9,.02,23],[0,.075,z],white).castShadow=false}

  for(let z=-length/2+20;z<length/2;z+=65)for(const side of [-1,1]){this.box(field,[1.0,.20,3],[side*(width/2+.8),.16,z],white).castShadow=false}

  for(const side of [-1,1])for(let k=-2;k<=2;k++)this.box(field,[1.2,.03,18],[k*3,.09,side*(length/2-18)],white).castShadow=false;

  const roof=this.material('#73828a',.68,.2),wall=this.material('#c7c4af',.95);

  for(let i=0;i<3;i++){

   const hangar=new THREE.Group();hangar.position.set(width/2+85+i*48,0,-length*.23);field.add(hangar);this.box(hangar,[36,10,26],[0,5,0],wall);

   const roofShape=new THREE.Shape();roofShape.moveTo(-19,0);roofShape.lineTo(19,0);roofShape.lineTo(0,4.5);roofShape.closePath();const roofMesh=this.mesh(new THREE.ExtrudeGeometry(roofShape,{depth:28,bevelEnabled:false}),roof,hangar);roofMesh.position.set(0,10,-14);

   this.box(hangar,[27,7,.12],[0,3.6,13.08],this.material('#647676',.9));

  }

  this.treeCell='';this.populateTrees(this.position?.x||0,this.position?.z||0);

 }

 makeAircraft(){makeAircraft.call(this)}

 makeCanopy(){

  this.canopy=new THREE.Group();this.canopy.scale.setScalar(SCALE);this.scene.add(this.canopy);this.dome=new THREE.Group();this.canopy.add(this.dome);

  for(let i=0;i<20;i++){

   const panel=this.mesh(new THREE.SphereGeometry(1,5,14,i*Math.PI/10,Math.PI/10,0,Math.PI/2),new THREE.MeshStandardMaterial({color:i%2?'#eee4c7':'#e77d39',roughness:.92,side:THREE.DoubleSide}),this.dome);panel.castShadow=true;

  }

  const positions=new Float32Array(20*2*3);this.suspensionGeometry=new THREE.BufferGeometry();this.suspensionGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));this.suspension=new THREE.LineSegments(this.suspensionGeometry,new THREE.LineBasicMaterial({color:'#e7d7b4',transparent:true,opacity:.90}));this.scene.add(this.suspension);

  this.seams=new THREE.Group();this.canopy.add(this.seams);

  for(let j=0;j<20;j++){const points=[];for(let k=0;k<=16;k++){const a=j*Math.PI/10,t=k*Math.PI/32;points.push(new THREE.Vector3(Math.cos(a)*Math.sin(t),Math.cos(t),Math.sin(a)*Math.sin(t)))}const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#a8815c',transparent:true,opacity:.65}));this.seams.add(l)}

 }

 makeReferences(){

  this.ring=this.mesh(new THREE.RingGeometry(9.7,10,64),new THREE.MeshBasicMaterial({color:'#d8ede2',transparent:true,opacity:.72,side:THREE.DoubleSide}));this.ring.rotation.x=-Math.PI/2;this.ring.position.y=.10;this.ring.castShadow=false;

  this.tether=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:'#e8cc85',dashSize:2.5,gapSize:2,transparent:true,opacity:.9}));this.scene.add(this.tether);

  this.trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#a2ded1',transparent:true,opacity:.7}));this.scene.add(this.trail);

  const grid=new THREE.GridHelper(2800,28,'#cdd6b8','#cdd6b8');grid.material.transparent=true;grid.material.opacity=.065;grid.position.y=.025;this.grid=grid;this.scene.add(grid);

 }

 location(d){const ref=this.origin||{lat:d.lat,lon:d.lon};return new THREE.Vector3((d.lon-ref.lon)*111320*Math.cos(ref.lat*RAD),Math.max(0,Number.isFinite(d.agl)?d.agl:(d.true_alt??d.alt??0)),-(d.lat-ref.lat)*111320)}

 reset(d){

  this.display={...d};this.track=[];this.orbit=0;this.propAngle=0;this.lastFrame=0;this.cameraPrimed=false;this.posePrimed=false;this.cameraHeading=(d.yaw||0)*RAD;this.sessionId=d.session_id??null;

  this.trail.geometry.dispose();this.trail.geometry=new THREE.BufferGeometry();

 }

 clear(){

  if(!this.hasTelemetry)return;

  const d={t:0,alt:0,true_alt:0,agl:null,roll:0,pitch:0,yaw:this.site?.heading||0,heading:this.site?.heading||0,canopy:0,motor_pwm:1000,groundspeed:0,lat:this.origin?.lat||0,lon:this.origin?.lon||0};

  this.reset(d);this.d=d;this.live=false;this.hasTelemetry=false;this.positionValid=false;this.lastValidPosition=null;

 }

 setTelemetry(d,live=true){

  const newSession=!this.hasTelemetry||isNewSession(this.sessionId,this.d.t,d),reference=(!newSession&&this.lastValidPosition)||this.origin,valid=validGeoPosition(d,reference);

  if(!this.origin&&valid)this.origin={lat:d.lat,lon:d.lon};

  if(!valid){const ref=reference||{lat:0,lon:0};d={...d,lat:ref.lat,lon:ref.lon}}

  this.positionValid=valid;

  if(newSession){this.lastValidPosition=null;this.reset(d)}

  if(valid)this.lastValidPosition={lat:d.lat,lon:d.lon};

  this.d={...d};this.live=live;this.hasTelemetry=true;

  const p=this.location(d),last=this.track.at(-1);if(valid&&(!last||p.distanceTo(last)>3)){this.track.push(p);if(this.track.length>700)this.track.shift();this.trail.geometry.dispose();this.trail.geometry=new THREE.BufferGeometry().setFromPoints(this.track.map(p=>new THREE.Vector3(p.x,.13,p.z)))}

 }

 draw(now){

  const rect=this.c.getBoundingClientRect(),w=rect.width,h=rect.height;if(!w||!h){requestAnimationFrame(this.draw);return}

  const cpuStart=performance.now();const dt=Math.min(.06,(now-this.lastFrame)/1000||.016),blend=1-Math.exp(-dt*12);this.lastFrame=now;

  for(const k of ['lat','lon','alt','true_alt','agl','canopy'])if(Number.isFinite(this.d[k]))this.display[k]=Number.isFinite(this.display[k])?this.display[k]+(this.d[k]-this.display[k])*blend:this.d[k];

  for(const k of ['roll','pitch','yaw'])if(Number.isFinite(this.d[k]))this.display[k]+=angleStep(this.display[k]*RAD,this.d[k]*RAD)/RAD*blend;

  const d={...this.d};for(const k of ['lat','lon','alt','true_alt','agl','canopy','roll','pitch','yaw'])if(Number.isFinite(this.d[k]))d[k]=this.display[k];

  const pos=this.location(d),height=pos.y,frac=clamp(d.canopy||0,0,1),heading=d.yaw*RAD;this.position=pos;

  this.populateTrees(pos.x,pos.z);this.ground.position.x=Math.round(pos.x/4096)*4096;this.ground.position.z=Math.round(pos.z/4096)*4096;

  // Repeated terrain texture stays locked to world coordinates when recentered.

  this.grid.position.x=Math.round(pos.x/100)*100;this.grid.position.z=Math.round(pos.z/100)*100;

  this.aircraft.position.set(pos.x,height+.54*SCALE,pos.z);

  this.quatYaw.setFromAxisAngle(this.axisY,Math.PI/2-(this.d.yaw||0)*RAD);this.quatPitch.setFromAxisAngle(this.axisZ,(this.d.pitch||0)*RAD);this.quatRoll.setFromAxisAngle(this.axisX,(this.d.roll||0)*RAD);

  this.poseTarget.copy(this.quatYaw).multiply(this.quatPitch).multiply(this.quatRoll);

  if(!this.posePrimed){this.aircraft.quaternion.copy(this.poseTarget);this.posePrimed=true}else this.aircraft.quaternion.slerp(this.poseTarget,blend);

  const throttle=clamp((d.motor_pwm-1000)/1000,0,1);if(this.live)this.propAngle+=dt*throttle*220;this.prop.rotation.x=this.propAngle;

  this.canopy.visible=this.suspension.visible=frac>.001;this.canopy.position.copy(this.aircraft.position);const radius=1.46*Math.sqrt(frac),base=1.25+1.35*frac;

  this.dome.position.y=base;this.dome.scale.set(radius,radius*.70,radius);this.seams.position.y=base;this.seams.scale.copy(this.dome.scale);

  this.aircraft.updateMatrixWorld(true);const lineArray=this.suspensionGeometry.attributes.position.array;

  for(let i=0;i<20;i++){const az=i*Math.PI/10,a=new THREE.Vector3(radius*Math.cos(az),base,radius*Math.sin(az)).multiplyScalar(SCALE).add(this.aircraft.position),b=this.aircraft.localToWorld(new THREE.Vector3(-.2,.12,i%2?.14:-.14));a.toArray(lineArray,i*6);b.toArray(lineArray,i*6+3)}this.suspensionGeometry.attributes.position.needsUpdate=true;this.suspensionGeometry.computeBoundingSphere();

  this.ring.position.x=pos.x;this.ring.position.z=pos.z;const vertices=this.tether.geometry.attributes.position;vertices.setXYZ(0,pos.x,.2,pos.z);vertices.setXYZ(1,pos.x,Math.max(.2,height),pos.z);vertices.needsUpdate=true;this.tether.computeLineDistances();this.tether.geometry.computeBoundingSphere();

  this.cameraHeading+=angleStep(this.cameraHeading,heading)*(1-Math.exp(-dt*3.5));

  if(this.camera==='orbit'&&this.live)this.orbit+=dt*.16;

  const detail=this.camera==='detail',angle=this.cameraHeading+(detail ? .75 : this.camera==='orbit'?this.orbit:0),distance=detail?111+frac*72:Math.max(120,height*.65)+frac*105;

  this.cameraTarget.set(pos.x-Math.sin(angle)*distance+Math.cos(angle)*distance*.27,height+(detail?36+frac*18:48+height*.20),pos.z+Math.cos(angle)*distance+Math.sin(angle)*distance*.27);

  this.lookTarget.set(pos.x,detail?height+11+frac*14:height+7+frac*16,pos.z);

  if(!this.cameraPrimed){this.view.position.copy(this.cameraTarget);this.lookPosition.copy(this.lookTarget);this.cameraPrimed=true}else{const b=1-Math.exp(-dt*6);this.view.position.lerp(this.cameraTarget,b);this.lookPosition.lerp(this.lookTarget,b)}

  this.view.lookAt(this.lookPosition);

  this.sky.position.copy(this.view.position);

  this.sun.position.set(pos.x-420,height+650,pos.z+380);this.sun.target.position.set(pos.x,0,pos.z);

  if(this.width!==w||this.height!==h){this.width=w;this.height=h;this.renderer.setSize(w,h,false);this.view.aspect=w/h;this.view.updateProjectionMatrix()}

  this.renderer.render(this.scene,this.view);this.drawHUD(w,h,d,pos);this.frameMonitor.sample(now,performance.now()-cpuStart,this.renderer.info.render);requestAnimationFrame(this.draw);

 }

 drawHUD(w,h,d,pos){

  const x=this.x,pr=Math.min(devicePixelRatio||1,2);if(this.hud.width!==Math.round(w*pr)||this.hud.height!==Math.round(h*pr)){this.hud.width=Math.round(w*pr);this.hud.height=Math.round(h*pr)}x.setTransform(pr,0,0,pr,0,0);x.clearRect(0,0,w,h);

  const height=Math.max(0,Number.isFinite(this.d.agl)?this.d.agl:(this.d.true_alt??this.d.alt??0)),project=p=>{const q=p.clone().project(this.view);return[q.x*w/2+w/2,-q.y*h/2+h/2,q.z]};

  const middle=project(new THREE.Vector3(pos.x,pos.y*.5,pos.z)),foot=project(new THREE.Vector3(pos.x,0,pos.z));

  if(height>18&&middle[1]>80&&middle[1]<h-55){x.font='600 12px Consolas,monospace';const text=height.toFixed(1)+' m',tw=x.measureText(text).width;x.fillStyle='#112d37e6';x.fillRect(middle[0]+9,middle[1]-13,tw+16,23);x.fillStyle='#ffe4a5';x.fillText(text,middle[0]+17,middle[1]+3)}

  if(foot[1]>85&&foot[1]<h-50){x.fillStyle='#173a31e6';x.fillRect(foot[0]-49,foot[1]+13,98,18);x.font='10px Consolas,monospace';x.textAlign='center';x.fillStyle='#e2f0dc';x.fillText(Number.isFinite(d.agl)?'LOCAL GROUND':'LOCAL REFERENCE',foot[0],foot[1]+26)}

  const size=w<560?94:112,mx=w-size-18,my=h-size-43,scale=.12,cx=mx+size/2,cy=my+size/2;

  x.save();x.beginPath();x.rect(mx,my,size,size);x.clip();x.fillStyle='#102c34e8';x.fillRect(mx,my,size,size);x.strokeStyle='#87b3a144';x.lineWidth=1;

  for(let i=-5;i<=5;i++){const e=(Math.floor(pos.x/100)+i)*100,n=(Math.floor(pos.z/100)+i)*100,px=cx+(e-pos.x)*scale,py=cy+(n-pos.z)*scale;x.beginPath();x.moveTo(px,my);x.lineTo(px,my+size);x.moveTo(mx,py);x.lineTo(mx+size,py);x.stroke()}

  x.strokeStyle='#9ae8db';x.lineWidth=1.5;x.beginPath();this.track.forEach((p,i)=>{const px=cx+(p.x-pos.x)*scale,py=cy+(p.z-pos.z)*scale;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke();x.translate(cx,cy);x.rotate(d.yaw*RAD);x.fillStyle='#fff1c7';x.beginPath();x.moveTo(0,-8);x.lineTo(5,6);x.lineTo(0,3);x.lineTo(-5,6);x.closePath();x.fill();x.restore();x.strokeStyle='#b3d0c759';x.strokeRect(mx,my,size,size);x.font='10px Consolas,monospace';x.fillStyle='#d5e7de';x.fillText('N ↑',mx+6,my+14);x.fillText('100 m',mx+6,my+size-6);x.strokeStyle='#d6e7dc';x.beginPath();x.moveTo(mx+54,my+size-9);x.lineTo(mx+66,my+size-9);x.stroke();

 }

}



const canvas=document.getElementById('scene');

try{

 globalThis.flightScene=new WebGLFlightScene(canvas);

 document.getElementById('renderer-name').textContent='3D · WEBGL';

}catch(error){

 console.warn('WebGL flight renderer unavailable; using the basic reference view.',error);

 const replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);document.getElementById('scene-hud').style.display='none';

 globalThis.flightScene=new CanvasFlightScene(replacement);document.getElementById('renderer-name').textContent='BASIC VIEW';document.getElementById('cam-detail').disabled=true;

}

