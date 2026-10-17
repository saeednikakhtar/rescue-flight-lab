/* Locally flat visual reference terrain, not a real terrain or obstacle database.
   Position, attitude, height and canopy come only from SITL telemetry.
   Ground distances are metres. Aircraft geometry is enlarged 12x for visibility. */
import { FlightDisplayState } from './flight-state.js';
import { drawHeightReference } from './height-reference.js';
import { cameraDistance } from './runway.js';
export class CanvasFlightScene {
 constructor(canvas){
  this.c=canvas;this.x=canvas.getContext('2d');this.site=null;this.origin=null;this.state=new FlightDisplayState();this.camera='chase';this.live=false;this.hasTelemetry=false;
  this.d={alt:0,true_alt:0,roll:0,pitch:0,yaw:0,heading:0,canopy:0,motor_pwm:1000,t:0,groundspeed:0,lat:0,lon:0};
  this.display={...this.d};this.track=[];this.lastFrame=0;this.orbit=0;this.draw=this.draw.bind(this);requestAnimationFrame(this.draw);
 }
 setSite(site){if(!site||!Number.isFinite(site.lat)||!Number.isFinite(site.lon))return;this.site={...site};this.origin={lat:site.lat,lon:site.lon};this.state.setSite(site);this.syncState()}
 location(d){const ref=this.origin||(this.origin={lat:d.lat,lon:d.lon});return[(d.lon-ref.lon)*111320*Math.cos(ref.lat*Math.PI/180),(d.lat-ref.lat)*111320,Math.max(0,Number.isFinite(d.agl)?d.agl:(d.true_alt??d.alt??0))]}
 syncState(){this.d=this.state.target;this.display=this.state.display;this.hasTelemetry=this.state.hasTelemetry;this.positionValid=this.state.positionValid;this.track=this.state.track.map(p=>[p.x,-p.z,p.y])}
 beginSession(){this.state.beginSession();this.orbit=0;this.live=false;this.syncState()}
 clear(){this.state.clear();this.orbit=0;this.live=false;this.syncState()}
 setTelemetry(d,live=true){if(!this.state.accept(d))return false;this.live=live;this.syncState();return true}
 draw(now){
  const c=this.c,x=this.x,r=c.getBoundingClientRect(),pr=Math.min(devicePixelRatio||1,2),w=r.width,h=r.height;
  if(!w||!h){requestAnimationFrame(this.draw);return}
  if(c.width!==Math.round(w*pr)||c.height!==Math.round(h*pr)){c.width=Math.round(w*pr);c.height=Math.round(h*pr)}
  x.setTransform(pr,0,0,pr,0,0);x.clearRect(0,0,w,h);
  const dt=Math.min(.06,(now-this.lastFrame)/1000||.016),blend=1-Math.exp(-dt*13);this.lastFrame=now;
  this.state.sample(dt,now);const d=this.display;
  const pos=this.location(d),height=pos[2],reportedHeight=Math.max(0,Number.isFinite(this.d.agl)?this.d.agl:(this.d.true_alt??this.d.alt??0)),rad=Math.PI/180;
  if(this.camera==='orbit')this.orbit+=dt*.16;
  const frac=Math.max(0,Math.min(1,d.canopy||0)),detail=this.camera==='detail',heading=d.yaw*rad,angle=heading+(detail?.75:this.camera==='orbit'?this.orbit:0),distance=cameraDistance(height,frac,detail),rise=detail?36+frac*18:48+height*.20;
  const eye=[pos[0]-Math.sin(angle)*distance+Math.cos(angle)*distance*.27,pos[1]-Math.cos(angle)*distance-Math.sin(angle)*distance*.27,height+rise],target=[pos[0],pos[1],height+(detail?11+frac*14:7+frac*16)];
  const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((v,n,i)=>v+n*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n)};
  const f=norm(sub(target,eye)),right=norm(cross(f,[0,0,1])),up=cross(right,f),focal=h*1.38,origin=[w*.5,h*.5-45],polys=[],ground=[];
  const project=p=>{const v=sub(p,eye),z=dot(v,f);return z>.6?[origin[0]+dot(v,right)*focal/z,origin[1]-dot(v,up)*focal/z,z]:null};
  const polygon=(ps,col,stroke=null,layer=polys)=>{
   let out=[];for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],za=dot(sub(a,eye),f),zb=dot(sub(b,eye),f);if(za>=.7)out.push(a);if((za>=.7)!==(zb>=.7)){const t=(.7-za)/(zb-za);out.push(a.map((n,j)=>n+(b[j]-n)*t))}}
   if(out.length<3)return;const q=out.map(project);if(q.some(p=>!p))return;
   if(q.every(p=>p[0]<-w)||q.every(p=>p[0]>w*2)||q.every(p=>p[1]<-h)||q.every(p=>p[1]>h*2))return;
   layer.push({q,col,stroke,depth:q.reduce((a,p)=>a+p[2],0)/q.length});
  };
  const line=(a,b,color,width=1,dash=[])=>{
   const za=dot(sub(a,eye),f),zb=dot(sub(b,eye),f);if(za<.7&&zb<.7)return;
   if(za<.7){const t=(.7-za)/(zb-za);a=a.map((v,i)=>v+(b[i]-v)*t)}
   if(zb<.7){const t=(.7-zb)/(za-zb);b=b.map((v,i)=>v+(a[i]-v)*t)}
   const p=project(a),q=project(b);if(!p||!q)return;x.strokeStyle=color;x.lineWidth=width;x.setLineDash(dash);x.beginPath();x.moveTo(p[0],p[1]);x.lineTo(q[0],q[1]);x.stroke();x.setLineDash([]);
  };
  const rect=(e,n,a,b,z,col)=>polygon([[e,n,z],[e+a,n,z],[e+a,n+b,z],[e,n+b,z]],col,null,ground);
  const box=(e,n,a,b,z)=>{
   polygon([[e,n,0],[e+a,n,0],[e+a,n,z],[e,n,z]],'#b7b09a','#6b7367');
   polygon([[e+a,n,0],[e+a,n+b,0],[e+a,n+b,z],[e+a,n,z]],'#838b81','#5c7269');
   polygon([[e,n+b,0],[e,n,0],[e,n,z],[e,n+b,z]],'#9caa98');
   polygon([[e,n,z],[e+a,n,z],[e+a,n+b,z],[e,n+b,z]],'#54677b','#a3b1b7');
  };
  const tree=(e,n,size)=>{
   const crown=Array.from({length:7},(_,j)=>[e+Math.cos(j*Math.PI*2/6)*size,n+Math.sin(j*Math.PI*2/6)*size,size*.40]);
   for(let j=0;j<6;j++)polygon([crown[j],crown[j+1],[e,n,size*2.8]],j%2?'#305f48':'#3e7655');
  };
  const sky=x.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#183b61');sky.addColorStop(.53,'#86b7cf');sky.addColorStop(1,'#c4d3cc');x.fillStyle=sky;x.fillRect(0,0,w,h);
  // A world-level horizon and stable, metre-based landscape.
  rect(pos[0]-9000,pos[1]-9000,18000,18000,-.15,'#6d8d70');
  const tile=120,baseE=Math.floor(pos[0]/tile),baseN=Math.floor(pos[1]/tile),palette=['#688866','#799671','#82996e','#99a079','#607f64','#879b73','#a7a27b'];
  for(let i=baseE-14;i<=baseE+14;i++)for(let j=baseN-14;j<=baseN+14;j++){
   const hash=Math.abs((i*73856093)^(j*19349663)),range=Math.hypot(i*tile-pos[0],j*tile-pos[1]);rect(i*tile+1,j*tile+1,tile-2,tile-2,0,palette[hash%palette.length]);
   if(hash%6===0)for(let k=1;k<6;k++)rect(i*tile+k*20,j*tile+3,1,tile-6,.01,'#416d4f38');
   if(i%5===0)rect(i*tile-3,j*tile,6,tile,.015,'#b6b29a');
   if(j%5===0)rect(i*tile,j*tile-3,tile,6,.016,'#b6b29a');
   if(hash%23===0&&range<1100){box(i*tile+35,j*tile+24,22,14,8);box(i*tile+65,j*tile+26,12,10,5)}
   if(hash%4===0&&range<850){tree(i*tile+8,j*tile+9,4);tree(i*tile+19,j*tile+11,3.6)}
  }
  // The fixed launch strip is aligned to the simulator's configured home heading.
  const sh=(this.site?.heading||0)*rad,strip=(a,b,z=.025)=>{a=(a+410)*(this.site?.runway_length_m||800)/960;return[Math.sin(sh)*a+Math.cos(sh)*b,Math.cos(sh)*a-Math.sin(sh)*b,z]};
  polygon([strip(-430,-20),strip(570,-20),strip(570,20),strip(-430,20)],'#4c7155',null,ground);
  polygon([strip(-410,-12),strip(550,-12),strip(550,12),strip(-410,12)],(this.site?.surface==='grass'?'#476c50':'#43515a'),null,ground);
  for(let k=-390;k<540;k+=40)polygon([strip(k,-.8,.04),strip(k+17,-.8,.04),strip(k+17,.8,.04),strip(k,.8,.04)],'#e6ddbd',null,ground);
  for(const s of [-1,1])polygon([strip(-410,s*11,.04),strip(550,s*11,.04),strip(550,s*10.6,.04),strip(-410,s*10.6,.04)],'#e7c86c',null,ground);
  polygon([strip(-190,12),strip(-190,65),strip(-165,65),strip(-165,12)],'#66747b',null,ground);box(58,-205,38,25,12);box(105,-170,20,17,8);
  for(const p of ground){x.beginPath();p.q.forEach((v,i)=>i?x.lineTo(v[0],v[1]):x.moveTo(v[0],v[1]));x.closePath();x.fillStyle=p.col;x.fill()}
  for(let i=-12;i<=12;i++){
   const e=(Math.floor(pos[0]/100)+i)*100,n=(Math.floor(pos[1]/100)+i)*100;
   line([e,pos[1]-1400,.05],[e,pos[1]+1400,.05],'#dbead21c',.7);line([pos[0]-1400,n,.05],[pos[0]+1400,n,.05],'#dbead21c',.7);
  }
  for(let i=1;i<this.track.length;i++){const a=this.track[i-1],b=this.track[i];line([a[0],a[1],.12],[b[0],b[1],.12],'#8cf5e8b0',2)}
  const foot=[pos[0],pos[1],.16];
  for(let j=0;j<32;j++){const a=j*Math.PI/16,b=(j+1)*Math.PI/16;line([pos[0]+Math.cos(a)*10,pos[1]+Math.sin(a)*10,.16],[pos[0]+Math.cos(b)*10,pos[1]+Math.sin(b)*10,.16],'#edfff0c0',1.2)}
  line([pos[0]-16,pos[1],.17],[pos[0]+16,pos[1],.17],'#ddf6e7aa');line([pos[0],pos[1]-16,.17],[pos[0],pos[1]+16,.17],'#ddf6e7aa');
  line(foot,pos,'#f9d58a',1.5,[5,5]);
  const rr=-d.roll*rad,pp=d.pitch*rad,scale=12,pose=p=>{
   let[a,b,z]=p;[b,z]=[b*Math.cos(rr)-z*Math.sin(rr),b*Math.sin(rr)+z*Math.cos(rr)];[a,z]=[a*Math.cos(pp)-z*Math.sin(pp),a*Math.sin(pp)+z*Math.cos(pp)];
   return[pos[0]+scale*(a*Math.sin(heading)+b*Math.cos(heading)),pos[1]+scale*(a*Math.cos(heading)-b*Math.sin(heading)),pos[2]+scale*z+7.56]
  };
 const craft=(ps,col,stroke='#12202a')=>polygon(ps.map(pose),col,stroke);
 // Same fuller-pod Orion-inspired unarmed UAV silhouette as the WebGL view, drawn without a model download.
 for(const side of [-1,1]){
  craft([[.35,side*.13,.115],[.19,side*2.60,.115],[-.19,side*2.60,.115],[-.45,side*.13,.115]],'#24313b');
  craft([[-1.04,side*.065,.10],[-1.34,side*.67,.59],[-1.63,side*.67,.59],[-1.59,side*.065,.10]],'#26343f');
 }
 const sections=[[1.66,.012,.025,.055],[1.58,.105,.14,.095],[1.36,.18,.225,.12],[1.02,.215,.245,.12],[.55,.195,.20,.095],[0,.16,.16,.06],[-.65,.13,.125,.07],[-1.22,.075,.095,.09],[-1.62,.035,.04,.10]];
 const rings=sections.map(([a,r,h,c])=>Array.from({length:10},(_,i)=>[a,Math.cos(i*Math.PI/5)*r,c+Math.sin(i*Math.PI/5)*h]));
 for(let i=0;i<rings.length-1;i++)for(let j=0;j<10;j++)craft([rings[i][j],rings[i+1][j],rings[i+1][(j+1)%10],rings[i][(j+1)%10]],j<5?'#34424c':'#19232c');
 for(const side of [-1,1]){line(pose([-.35,side*.09,-.025]),pose([-.41,side*.36,-.54]),'#7a8990',1.6);craft([[-.50,side*.36,-.54],[-.41,side*.36,-.625],[-.32,side*.36,-.54],[-.41,side*.36,-.455]],'#101820')}
 line(pose([1.13,0,-.07]),pose([1.08,0,-.54]),'#7a8990',1.4);craft([[1.002,0,-.54],[1.08,0,-.618],[1.158,0,-.54],[1.08,0,-.462]],'#101820');
 const rpm=Math.max(0,(d.motor_pwm-1000)/1000),pa=(this.live?now:0)*.02*rpm;
 for(let i=0;i<2;i++){const a=pa+i*Math.PI,by=Math.cos(a)*.39,bz=Math.sin(a)*.39;craft([[-1.70,0,.10],[-1.70,by,bz+.10],[-1.70,by-.032,bz+.13],[-1.70,-.032,.13]],'#4b5b65')}
 // A progressive canopy mesh using the inflation reported by the physical model.
 if(frac>0){const radius=1.46*Math.sqrt(frac),cz=1.25+1.35*frac,cp=(az,el)=>[pos[0]+scale*(-.15+radius*Math.cos(el)*Math.cos(az)),pos[1]+scale*radius*Math.cos(el)*Math.sin(az),pos[2]+scale*(cz+radius*.70*Math.sin(el))];for(let j=0;j<16;j++){let a=j*Math.PI/8,b=(j+1)*Math.PI/8;for(let i=0;i<6;i++){let e=i*Math.PI/12,k=(i+1)*Math.PI/12;polygon([cp(a,e),cp(b,e),cp(b,k),cp(a,k)],j%2?'#f3e5c7':'#f58b44','#8c5739')}}
 for(let j=0;j<16;j++){let a=j*Math.PI/8,p=project(cp(a,0)),q=project(pose([-.25,j%2?.14:-.14,.1]));if(p&&q)polys.push({q:[p,q],col:null,stroke:'#e7d6ad',depth:(p[2]+q[2])/2})}}

  polys.sort((a,b)=>b.depth-a.depth);for(const p of polys){x.beginPath();p.q.forEach((v,i)=>i?x.lineTo(v[0],v[1]):x.moveTo(v[0],v[1]));if(p.col){x.closePath();x.fillStyle=p.col;x.fill()}if(p.stroke){x.strokeStyle=p.stroke;x.lineWidth=.8;x.stroke()}}
  drawHeightReference(x,w,h,{anchor:project([pos[0],pos[1],height+7.56]),foot:project(foot),height:reportedHeight,groundKnown:Number.isFinite(this.d.agl),valid:this.hasTelemetry&&this.positionValid});
  this.drawMap(x,w,h,pos,heading);
  requestAnimationFrame(this.draw);
 }
 drawMap(x,w,h,pos,heading){
  const size=w<560?94:112,left=w-size-18,top=h-size-102,scale=.12,center=[left+size/2,top+size/2],map=p=>[center[0]+(p[0]-pos[0])*scale,center[1]-(p[1]-pos[1])*scale];
  x.save();x.beginPath();x.rect(left,top,size,size);x.clip();x.fillStyle='#0c2930e8';x.fillRect(left,top,size,size);x.strokeStyle='#75a08b44';x.lineWidth=1;
  for(let i=-5;i<=5;i++){const e=(Math.floor(pos[0]/100)+i)*100,n=(Math.floor(pos[1]/100)+i)*100;x.beginPath();x.moveTo(map([e,pos[1]])[0],top);x.lineTo(map([e,pos[1]])[0],top+size);x.moveTo(left,map([pos[0],n])[1]);x.lineTo(left+size,map([pos[0],n])[1]);x.stroke()}
  x.strokeStyle='#83eee1';x.lineWidth=1.5;x.beginPath();this.track.forEach((p,i)=>{const q=map(p);i?x.lineTo(...q):x.moveTo(...q)});x.stroke();
  x.translate(...center);x.rotate(heading);x.fillStyle='#fff2c4';x.beginPath();x.moveTo(0,-8);x.lineTo(5,6);x.lineTo(0,3);x.lineTo(-5,6);x.closePath();x.fill();x.restore();
  x.strokeStyle='#a5c7c259';x.strokeRect(left,top,size,size);x.font='10px Consolas,monospace';x.textAlign='left';x.fillStyle='#d0e9e5';x.fillText('N ↑',left+6,top+14);x.fillText('100 m',left+6,top+size-6);x.strokeStyle='#dae9d7';x.beginPath();x.moveTo(left+53,top+size-9);x.lineTo(left+53+100*scale,top+size-9);x.stroke();
 }
}

