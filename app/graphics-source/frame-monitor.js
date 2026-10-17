// Real requestAnimationFrame intervals; this measures display cadence, not SITL Hz.
export class FrameMonitor {
 constructor(element){this.element=element;this.started=0;this.last=0;this.published=0;this.intervals=[];this.cpu=[];this.result=null;this.active=true;const reset=()=>{this.started=0;this.last=0;this.published=0;this.intervals=[];this.cpu=[];this.result=null;this.active=!document.hidden&&document.hasFocus();if(this.element)this.element.textContent=this.active?'Measuring active display…':'Paused in background';const badge=document.getElementById('display-smoothness');if(badge)badge.textContent=this.active?'Measuring…':'Paused'};document.addEventListener('visibilitychange',reset);window.addEventListener('focus',reset);window.addEventListener('blur',reset);reset()}
 sample(now,cpu,info){
  if(!this.started)this.started=now;
  if(document.hidden||!document.hasFocus()){this.last=0;return}
  if(this.last&&now-this.started>3000){this.intervals.push(now-this.last);this.cpu.push(cpu);if(this.intervals.length>600){this.intervals.shift();this.cpu.shift()}}
  this.last=now;
  if(now-this.published<2000||this.intervals.length<20)return;
  this.published=now;const ordered=[...this.intervals].sort((a,b)=>a-b),sum=this.intervals.reduce((a,b)=>a+b,0);
  this.result={fps:1000*this.intervals.length/sum,p95_ms:ordered[Math.floor((ordered.length-1)*.95)],cpu_ms:this.cpu.reduce((a,b)=>a+b,0)/this.cpu.length,draw_calls:info.calls,triangles:info.triangles,samples:this.intervals.length};
  const canvas=document.getElementById('scene');if(canvas){canvas.dataset.renderFps=this.result.fps.toFixed(1);canvas.dataset.renderP95=this.result.p95_ms.toFixed(1);canvas.dataset.drawCalls=String(info.calls);canvas.dataset.triangles=String(info.triangles)}
  if(this.element)this.element.textContent=`Display ${this.result.fps.toFixed(1)} fps · p95 ${this.result.p95_ms.toFixed(1)} ms · ${info.calls} draws · ${(info.triangles/1000).toFixed(0)}k triangles · CPU ${this.result.cpu_ms.toFixed(1)} ms · ${this.result.samples} active frames`;
  const badge=document.getElementById('display-smoothness');if(badge)badge.textContent=this.result.fps.toFixed(0)+' fps';
 }
}
