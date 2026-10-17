import assert from 'node:assert/strict';
import fs from 'node:fs';
import { drawHeightReference } from './height-reference.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/recorded-sessions.json',import.meta.url),'utf8'));
const sample=fixture.sessions[0].samples.find(d=>Number.isFinite(d.agl)&&d.agl>50);
assert(sample,'An actual recorded AGL sample is required');
let text=[],boxes=[];
const context=new Proxy({fillText:t=>text.push(t),measureText:t=>({width:t.length*14}),roundRect:(...p)=>boxes.push(p)},{get:(o,k)=>k in o?o[k]:()=>{}});
for(const [w,h,anchor]of [[543,510,[280,255]],[420,510,[410,35]],[300,420,[-15,470]],[500,375,[250,187]]] ){
 text=[];boxes=[];
 drawHeightReference(context,w,h,{anchor,foot:[w/2,h+20],height:sample.agl,groundKnown:true,valid:true});
 assert(text.includes(sample.agl.toFixed(1)),'Label must use reported AGL rather than home altitude');
 assert(text.includes('Height above ground'));
 for(const [a,b,c,d]of boxes)assert(a>=0&&b>=0&&a+c<=w&&b+d<=h-90,'Height labels must stay above the metric overlay');
}
text=[];boxes=[];drawHeightReference(context,420,420,{anchor:[200,250],foot:[200,400],height:0,groundKnown:true,valid:true});assert(text.includes('Ground reference'));for(const [a,b,c,d]of boxes)assert(b+d<=330,'Ground-end label must reserve the bottom metric strip');
text=[];drawHeightReference(context,420,510,{anchor:[200,255],height:sample.true_alt,groundKnown:false,valid:true});assert(text.includes('Height above launch'));
text=[];drawHeightReference(context,420,510,{anchor:[200,255],height:0,groundKnown:true,valid:false});assert.equal(text.length,0,'No measured-height label before valid telemetry');
console.log(JSON.stringify({passed:true,actual_recorded_agl:sample.agl,viewport_checks:4,ground_and_launch_datum_labels:true,invalid_telemetry_hidden:true,bottom_metric_reserve_px:90},null,2));
