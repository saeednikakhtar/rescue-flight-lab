/* Deterministic visual landscape; it is not a surveyed terrain or sensor source. */
import * as THREE from './three.module.js';
import {Sky} from './Sky.js';
const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296};
export function makeAtmosphere(){
 this.scene.fog=new THREE.FogExp2('#b8ccd3',.000115);
 this.sky=new Sky();this.sky.scale.setScalar(15000);const u=this.sky.material.uniforms;
 u.turbidity.value=3.2;u.rayleigh.value=1.7;u.mieCoefficient.value=.005;u.mieDirectionalG.value=.79;u.cloudScale.value=.00042;u.cloudCoverage.value=.37;u.cloudDensity.value=.55;u.sunPosition.value.set(-.5,.66,.42).normalize();this.scene.add(this.sky);
 const generator=new THREE.PMREMGenerator(this.renderer),envScene=new THREE.Scene(),envSky=this.sky.clone();envScene.add(envSky);this.environmentMap=generator.fromScene(envScene,0,.1,30000);generator.dispose();
 // Atmospheric scattering is static. Bake it once rather than evaluating
 // cloud noise over the entire viewport on every flight-display frame.
 this.scene.background=this.environmentMap.texture;this.scene.backgroundIntensity=.12;this.sky.visible=false;

}
export function makeLandscape(){
 const rand=seeded(28051967),canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const x=canvas.getContext('2d');x.fillStyle='#879974';x.fillRect(0,0,2048,2048);
 const n=9,step=2048/n,corners=[];for(let row=0;row<=n;row++){corners[row]=[];for(let col=0;col<=n;col++)corners[row][col]=[col*step+(col&&col<n?(rand()-.5)*90:0),row*step+(row&&row<n?(rand()-.5)*90:0)]}
 const colors=['#8e9e6d','#a4aa7d','#7b9468','#a4ab85','#7e976f','#b1ad83','#6b8865','#8ca276','#b0b28c'];
 for(let row=0;row<n;row++)for(let col=0;col<n;col++){
  const p=[corners[row][col],corners[row][col+1],corners[row+1][col+1],corners[row+1][col]];x.save();x.beginPath();p.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.closePath();x.fillStyle=colors[Math.floor(rand()*colors.length)];x.fill();x.clip();x.translate(p[0][0],p[0][1]);x.rotate((rand()-.5)*.5);x.strokeStyle=rand()>.5?'#d4d6ae19':'#384e3214';x.lineWidth=1;for(let k=-10;k<55;k++){x.beginPath();x.moveTo(k*6,-130);x.lineTo(k*6,step*1.8);x.stroke()}x.restore();x.strokeStyle='#647c513b';x.lineWidth=3;x.beginPath();p.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.closePath();x.stroke();
 }
 for(let i=0;i<60000;i++){x.fillStyle=rand()>.5?'#dee2b413':'#344b3013';x.fillRect(rand()*2048,rand()*2048,.8+rand()*2,1+rand()*3)}
 for(let i=0;i<3;i++){const y=260+i*650;x.beginPath();x.moveTo(-50,y);x.bezierCurveTo(600,y+120,1200,y-80,2100,y+150);x.strokeStyle='#67785b';x.lineWidth=8;x.stroke();x.strokeStyle='#c4b899';x.lineWidth=4;x.stroke();x.strokeStyle='#e2d2ac';x.lineWidth=1;x.stroke()}
 // Small copse footprints help the ground read as continuous countryside.
 for(let i=0;i<28;i++){const px=rand()*2048,py=rand()*2048;x.fillStyle='#4f704f';x.beginPath();x.ellipse(px,py,20+rand()*95,13+rand()*50,rand()*Math.PI,0,Math.PI*2);x.fill()}
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(20000/4096,20000/4096);texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());texture.minFilter=THREE.LinearMipmapLinearFilter;
 const mat=this.material('#ffffff',1);mat.map=texture;this.ground=this.mesh(new THREE.PlaneGeometry(20000,20000),mat);this.ground.rotation.x=-Math.PI/2;this.ground.castShadow=false;this.airfield=new THREE.Group();this.scene.add(this.airfield);
 const crown=new THREE.IcosahedronGeometry(1,1),verts=crown.attributes.position;for(let i=0;i<verts.count;i++){const v=new THREE.Vector3().fromBufferAttribute(verts,i),j=.93+.09*Math.sin(i*12.787);v.multiplyScalar(j);verts.setXYZ(i,v.x,v.y,v.z)}crown.computeVertexNormals();
 this.trees=new THREE.InstancedMesh(crown,this.material('#527348',.95),2000);this.trees.castShadow=false;this.trees.receiveShadow=false;this.trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(this.trees);
 this.trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.45,.65,6,7),this.material('#71604b',1),1000);this.trunks.castShadow=false;this.trunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(this.trunks);this.populateTrees(0,0);
}
