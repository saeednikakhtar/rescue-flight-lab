/* Single-depth grass runway: markings are texture pixels, never coplanar decals.
   Colors/markings are illustrative; map length/heading come from the selected site. */
import * as THREE from './three.module.js';
export function makeRunwaySurface(site,{createCanvas=()=>document.createElement('canvas'),maxAnisotropy=4}={}){
 const width=site.runway_width_m||40,length=site.runway_length_m||800,verge=9,endVerge=17,tw=256,th=2048;
 const canvas=createCanvas();canvas.width=tw;canvas.height=th;const x=canvas.getContext('2d');
 const px=m=>m/(width+verge*2)*tw,py=m=>m/(length+endVerge*2)*th,left=px(verge),top=py(endVerge),rw=px(width),rh=py(length),paved=/asphalt|concrete|paved/i.test(site.surface||'');
 x.fillStyle='#708365';x.fillRect(0,0,tw,th);x.fillStyle=paved?'#575f5d':'#42664d';x.fillRect(left,top,rw,rh);
 // Broad low-contrast mowing bands and sparse grain avoid high-frequency crawl.
 if(!paved)for(let i=0;i<16;i++){x.fillStyle=i%2?'#42664c':'#527a58';x.fillRect(left,top+rh*i/16,rw,rh/16+.5)}
 let seed=1027;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296};
 for(let i=0;i<22000;i++){x.fillStyle=rand()>.45?'#bac69a12':'#213f2912';x.fillRect(rand()*tw,rand()*th,1+rand()*2,2+rand()*5)}
 // All these cues share exactly the same surface depth and mip chain.
 x.fillStyle='#d9b564';const edge=px(1.4);x.fillRect(left,top,edge,rh);x.fillRect(left+rw-edge,top,edge,rh);
 x.font='bold 80px Arial';x.textAlign='center';x.fillStyle='#ece7cc';const heading=Math.round((site.heading||0)/10)%36||36;x.save();x.translate(tw/2,top+py(47));x.scale(.7,1);x.fillText(String(heading).padStart(2,'0'),0,0);x.restore();x.save();x.translate(tw/2,top+rh-py(47));x.rotate(Math.PI);x.scale(.7,1);x.fillText(String((heading+17)%36+1).padStart(2,'0'),0,0);x.restore();x.fillStyle='#f2efda';const cw=px(1.3);for(let m=38;m<length-28;m+=48)x.fillRect(tw/2-cw/2,top+py(m),cw,py(20));
 for(const end of [0,1]){const y=top+(end?rh-py(5):py(3));x.fillRect(left,y,rw,py(2.2));for(let k=-3;k<=3;k++)x.fillRect(tw/2+px(k*4)-px(.85),top+(end?rh-py(26):py(10)),px(1.7),py(16))}
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;texture.anisotropy=Math.min(8,maxAnisotropy);
 const material=new THREE.MeshStandardMaterial({map:texture,color:'#ffffff',roughness:1,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width+verge*2,length+endVerge*2),material);mesh.name='mapped-grass-strip';mesh.rotation.x=-Math.PI/2;mesh.position.y=.12;mesh.castShadow=false;mesh.receiveShadow=false;mesh.userData={singleSurface:true,markingsBaked:true,visualOnly:true};return mesh;
}
export const DISPLAY_DEPTH={near:2,far:18000};
export function cameraDistance(height,canopy,detail=false){return detail?126+canopy*83:Math.max(168,height*.82)+canopy*120}
export function cameraRig(height,canopy,detail=false){return {distance:cameraDistance(height,canopy,detail),elevation:detail?26+canopy*18:27+height*.08,lookElevation:detail?11+canopy*14:7+canopy*16}}

// Compose into the unobstructed area above the fixed bottom telemetry strip.
export function setCameraViewport(camera,width,height,bottomInset=90){camera.aspect=width/height;camera.setViewOffset(width,height,0,bottomInset/2,width,height)}
