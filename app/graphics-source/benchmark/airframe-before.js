/* Generic lift+cruise VTOL appearance. The flight engine remains native Plane.
   Four lift propellers are deliberately stationary: there is no rotor telemetry. */
import * as THREE from '../three.module.js';

export function makeAircraft(){
 const shell=this.material('#e3e8e8',.27,.18),carbon=this.material('#202e38',.34,.28),accent=this.material('#edb54d',.35,.16),metal=this.material('#899ca8',.28,.7),seam=this.material('#667e8b',.55,.15),rubber=this.material('#17212a',.93);
 const glass=new THREE.MeshPhysicalMaterial({color:'#163b50',roughness:.13,metalness:.40,clearcoat:1});
 this.aircraft=new THREE.Group();this.aircraft.scale.setScalar(12);this.scene.add(this.aircraft);
 const profile=[[-1.70,.015],[-1.40,.08],[-.85,.155],[-.25,.25],[.42,.27],[1.00,.22],[1.40,.13],[1.62,.04],[1.66,.005]].map(([x,r])=>new THREE.Vector2(r,x));
 const body=this.mesh(new THREE.LatheGeometry(profile,48),shell,this.aircraft);body.rotation.z=-Math.PI/2;body.scale.z=.88;
 const belly=this.mesh(new THREE.SphereGeometry(1,32,18),carbon,this.aircraft);belly.position.set(.15,-.10,0);belly.scale.set(1.17,.16,.226);
 const canopy=this.mesh(new THREE.SphereGeometry(1,32,18),glass,this.aircraft);canopy.position.set(.48,.19,0);canopy.scale.set(.70,.13,.205);
 this.box(this.aircraft,[.018,.08,.38],[.12,.285,0],seam);
 const sensor=this.mesh(new THREE.SphereGeometry(.115,20,12),carbon,this.aircraft);sensor.position.set(1.05,-.18,0);
 const lens=this.mesh(new THREE.SphereGeometry(.062,16,12),glass,this.aircraft);lens.position.set(1.13,-.20,0);lens.scale.x=.35;

 const airfoil=(span,root,tip,sweep=.20)=>{
  const p=[],ix=[],n=24,row=n+1;
  for(let side=0;side<2;side++)for(let station=0;station<4;station++)for(let k=0;k<=n;k++){
   const u=k/n,s=station/3,c=root+(tip-root)*s,t=5*.10*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u*u*u-.1015*u*u*u*u)*c;
   p.push((.28-u)*c-s*sweep,.018*Math.sin(u*Math.PI)*c+(side?-1:1)*t,span*s);
  }
  const half=row*4;
  for(let side=0;side<2;side++)for(let j=0;j<3;j++)for(let k=0;k<n;k++){const a=side*half+j*row+k,b=a+row;if(!side)ix.push(a,a+1,b,a+1,b+1,b);else ix.push(a,b,a+1,a+1,b,b+1)}
  for(let j=0;j<3;j++)for(const k of [0,n]){const a=j*row+k,b=a+row;ix.push(a,a+half,b,b,a+half,b+half)}
  for(let k=0;k<n;k++){const a=3*row+k;ix.push(a,a+1,a+half,a+1,a+1+half,a+half)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;
 };
 const propeller=(parent,axis,radius)=>{
  const p=new THREE.Group();parent.add(p);
  this.cylinder(p,.065,.075,.075,[0,0,0],metal,axis,20);
  for(let k=0;k<2;k++){
   const blade=this.mesh(new THREE.SphereGeometry(1,16,8),carbon,p);
   if(axis==='y'){blade.position.set(k?radius*.48:-radius*.48,.04,0);blade.scale.set(radius*.55,.012,.045);blade.rotation.y=.12}
   else{blade.position.set(0,k?radius*.48:-radius*.48,0);blade.scale.set(.015,radius*.55,.055);blade.rotation.x=.12}
  }
  return p;
 };
 for(const sign of [-1,1]){
  const wing=new THREE.Group();wing.position.set(-.02,.13,0);wing.scale.z=sign;this.aircraft.add(wing);
  this.mesh(airfoil(2.65,.74,.32,.30),shell,wing);
  this.box(wing,[.26,.012,.26],[-.37,.012,2.44],accent);
  this.box(wing,[.018,.012,1.15],[-.49,.009,1.76],seam);
  const winglet=this.box(wing,[.19,.20,.025],[-.34,.13,2.62],carbon);winglet.rotation.x=-.25;
  const nav=this.mesh(new THREE.SphereGeometry(.023,10,8),this.material(sign<0?'#cd4944':'#4ea08d',.4),wing);nav.position.set(-.33,.08,2.65);
  // Two slender longitudinal booms carry the four distinct lift units.
  this.cylinder(this.aircraft,.043,.043,2.30,[-.05,.05,sign*1.12],carbon,'x',16);
  for(const fore of [-1,1]){
   const hub=new THREE.Group();hub.position.set(fore*.95,.10,sign*1.12);this.aircraft.add(hub);
   this.cylinder(hub,.10,.085,.14,[0,.06,0],carbon,'y',24);
   this.cylinder(hub,.064,.076,.045,[0,.16,0],accent,'y',24);
   propeller(hub,'y',.66).position.y=.19;
  }
  // Canted tail surfaces give a modern UAV silhouette without a manned cockpit.
  const tail=new THREE.Group();tail.position.set(-1.31,.08,0);tail.scale.z=sign;tail.rotation.x=-.48;this.aircraft.add(tail);
  this.mesh(airfoil(.78,.37,.22,.13),shell,tail);this.box(tail,[.16,.014,.20],[-.23,.006,.66],accent);
  this.cylinder(this.aircraft,.023,.023,.35,[-.45,-.35,sign*.27],metal,'y',12);
  this.cylinder(this.aircraft,.085,.085,.065,[-.45,-.51,sign*.29],rubber,'z',20);
 }
 this.cylinder(this.aircraft,.018,.018,.29,[.95,-.32,0],metal,'y',10);this.cylinder(this.aircraft,.065,.065,.055,[.95,-.47,0],rubber,'z',20);
 // Forward-flight pusher animation uses the existing motor output only.
 this.prop=new THREE.Group();this.prop.position.set(-1.75,.025,0);this.aircraft.add(this.prop);
 this.cylinder(this.prop,.075,.024,.22,[-.045,0,0],metal,'x',24);propeller(this.prop,'x',.43);
 const labelCanvas=document.createElement('canvas');labelCanvas.width=512;labelCanvas.height=128;const x=labelCanvas.getContext('2d');x.font='700 63px Arial';x.textAlign='center';x.fillStyle='#314b5c';x.fillText('RESCUE 02',256,88);
 const texture=new THREE.CanvasTexture(labelCanvas);texture.colorSpace=THREE.SRGBColorSpace;const labelMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide});
 for(const s of [-1,1]){const label=new THREE.Mesh(new THREE.PlaneGeometry(.70,.175),labelMaterial);label.position.set(-.25,.035,s*.236);label.rotation.y=s<0?Math.PI:0;this.aircraft.add(label)}
}
