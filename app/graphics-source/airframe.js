/* Orion-inspired civilian test visual. Arbitrary geometry does not drive SITL physics. */
import * as THREE from './three.module.js';
import {batchStatic} from './batch.js';
function wingGeometry(side){
 const v=[],ix=[],slices=14,steps=24;
 for(let top=0;top<2;top++)for(let j=0;j<=slices;j++){
  const t=j/slices,span=.13+t*2.62,chord=.78-.43*t,leading=.36-.20*t;
  for(let i=0;i<=steps;i++){const q=(1-Math.cos(i/steps*Math.PI))*.5,thickness=5*.12*chord*(.2969*Math.sqrt(q)-.126*q-.3516*q*q+.2843*q*q*q-.1036*q*q*q*q);v.push(leading-q*chord,.145+.065*t+(top?1:-1)*thickness,side*span)}
 }
 const block=(slices+1)*(steps+1);for(let top=0;top<2;top++)for(let j=0;j<slices;j++)for(let i=0;i<steps;i++){const a=top*block+j*(steps+1)+i,b=a+1,c=a+steps+1,d=c+1;if((top===0)===(side===1))ix.push(a,c,b,b,c,d);else ix.push(a,b,c,b,d,c)}
 for(let i=0;i<steps;i++){const a=slices*(steps+1)+i,b=a+1;ix.push(a,b,a+block,b,b+block,a+block)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();return g;
}
export function makeAircraft(){
 const skin=this.material('#465c68',.42,.21),wingSkin=this.material('#71848c',.52,.15),panel=this.material('#344c58',.56,.15),metal=this.material('#9aa6ab',.32,.7),rubber=this.material('#172129',.94,.02),glass=this.material('#142e40',.16,.48);
 this.aircraft=new THREE.Group();this.aircraft.scale.setScalar(12);this.scene.add(this.aircraft);this.airframeLift=7.56;
 const sections=[[1.68,.005,.009,.055],[1.60,.10,.14,.087],[1.38,.18,.225,.11],[1.06,.215,.245,.115],[.56,.198,.20,.095],[0,.16,.16,.06],[-.67,.13,.125,.07],[-1.23,.075,.095,.09],[-1.61,.035,.04,.10]],v=[],ix=[],sides=40;
 for(const [a,w,h,c]of sections)for(let j=0;j<sides;j++){const angle=j*Math.PI*2/sides;v.push(a,c+Math.sin(angle)*h,Math.cos(angle)*w)}
 for(let i=0;i<sections.length-1;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides;ix.push(a,b,a+sides,b,b+sides,a+sides)}
 const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(v,3));body.setIndex(ix);body.computeVertexNormals();this.mesh(body,skin,this.aircraft);
 const fairing=this.mesh(new THREE.SphereGeometry(1,24,12),skin,this.aircraft);fairing.scale.set(.46,.115,.35);fairing.position.set(-.04,.10,0);
 const hatch=this.mesh(new THREE.SphereGeometry(1,24,12),panel,this.aircraft);hatch.scale.set(.22,.012,.105);hatch.position.set(.42,.288,0);
 const cap=this.mesh(new THREE.SphereGeometry(1,24,16),panel,this.aircraft);cap.scale.set(.10,.11,.11);cap.position.set(1.54,.09,0);
 const lens=this.mesh(new THREE.SphereGeometry(.072,20,12),glass,this.aircraft);lens.scale.set(.42,1,1);lens.position.set(1.56,-.035,0);
 for(const side of [-1,1]){
  this.mesh(wingGeometry(side),wingSkin,this.aircraft);
  const seam=[];for(let i=0;i<=16;i++){const t=.38+i/16*.58,chord=.78-.43*t;seam.push(new THREE.Vector3(.36-.20*t-chord*.76,.151+.065*t,side*(.13+t*2.62)))}
  this.aircraft.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(seam),new THREE.LineBasicMaterial({color:'#304c59',transparent:true,opacity:.65})));
  const tip=this.mesh(new THREE.SphereGeometry(1,12,8),panel,this.aircraft);tip.scale.set(.16,.027,.025);tip.position.set(-.02,.207,side*2.75);
  const light=this.mesh(new THREE.SphereGeometry(.016,8,6),new THREE.MeshBasicMaterial({color:side<0?'#b34f45':'#83b8a3'}),this.aircraft);light.position.set(.04,.215,side*2.74);
  const tailGroup=new THREE.Group();tailGroup.position.set(-1.19,.10,side*.065);tailGroup.rotation.x=-side*.68;tailGroup.scale.z=side;this.aircraft.add(tailGroup);
  const shape=new THREE.Shape();shape.moveTo(.15,0);shape.lineTo(-.15,.78);shape.lineTo(-.44,.78);shape.lineTo(-.40,0);shape.closePath();const tail=this.mesh(new THREE.ExtrudeGeometry(shape,{depth:.026,bevelEnabled:true,bevelSize:.012,bevelThickness:.008,bevelSegments:2}),wingSkin,tailGroup);tail.rotation.x=Math.PI/2;this.box(tailGroup,[.012,.009,.53],[-.34,.015,.44],panel);
  // Main struts and hubs stay fixed; no gear-deployment state is implied.
  const from=new THREE.Vector3(-.35,-.025,side*.09),to=new THREE.Vector3(-.41,-.54,side*.36),delta=to.clone().sub(from),strut=this.mesh(new THREE.CylinderGeometry(.013,.016,delta.length(),10),metal,this.aircraft);strut.position.copy(from.add(to).multiplyScalar(.5));strut.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());this.cylinder(this.aircraft,.085,.085,.061,[-.41,-.54,side*.36],rubber,'z',20);this.cylinder(this.aircraft,.034,.034,.064,[-.41,-.54,side*.36],metal,'z',14);
  for(let i=0;i<6;i++)this.box(this.aircraft,[.045,.008,.008],[-.76-i*.055,.205,side*.065],rubber);
 }
 this.cylinder(this.aircraft,.012,.014,.47,[1.10,-.30,0],metal,'y',10);this.cylinder(this.aircraft,.078,.078,.052,[1.10,-.54,0],rubber,'z',20);this.cylinder(this.aircraft,.028,.028,.056,[1.10,-.54,0],metal,'z',14);
 this.cylinder(this.aircraft,.012,.012,.16,[.85,.39,0],panel,'y',8);this.cylinder(this.aircraft,.009,.009,.19,[-.65,.32,0],panel,'y',8);
 this.prop=new THREE.Group();this.prop.position.set(-1.68,.10,0);this.aircraft.add(this.prop);this.cylinder(this.prop,.058,.018,.19,[0,0,0],metal,'x',20);
 for(let i=0;i<3;i++){const blade=new THREE.Group();blade.rotation.x=i*Math.PI*2/3;this.prop.add(blade);const b=this.box(blade,[.022,.34,.049],[-.025,.21,0],rubber);b.rotation.x=-.16}
 const propShadow=batchStatic(this.prop);propShadow?.dispose();this.aircraftShadowGeometry=batchStatic(this.aircraft,this.prop);
}
