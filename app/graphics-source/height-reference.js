/* Screen-space height reference shared by both display backends. No sensor or
   dynamics data are generated here; reportedHeight is actual model telemetry. */
export function drawHeightReference(x,w,h,{anchor,foot,height,groundKnown,valid,bottomInset=90}){
 if(!valid||!anchor||!Number.isFinite(height))return;
 const bw=w<350?108:124,bh=59,lx=Math.max(12,Math.min(w-bw-12,anchor[0]+(anchor[0]<w*.57?38:-bw-38))),ly=Math.max(90,Math.min(h-bottomInset-bh-18,anchor[1]-83));
 x.save();x.setLineDash([]);x.textAlign='left';x.strokeStyle='#f9ffff';x.lineWidth=3;x.beginPath();x.moveTo(anchor[0],anchor[1]-7);x.lineTo(lx+bw/2,ly+bh);x.stroke();x.strokeStyle='#176878';x.lineWidth=1.2;x.stroke();
 x.fillStyle='#ffffff';x.strokeStyle='#126c7a';x.lineWidth=1.5;x.beginPath();x.roundRect(lx,ly,bw,bh,5);x.fill();x.stroke();x.fillStyle='#0e7483';x.fillRect(lx,ly+8,3,bh-16);
 x.font='600 10px Segoe UI,sans-serif';x.fillStyle='#496c7d';x.fillText(groundKnown?'Height above ground':'Height above launch',lx+11,ly+16);
 x.font='600 26px Bahnschrift,Segoe UI,sans-serif';x.fillStyle='#123748';const value=Math.max(0,height).toFixed(1);x.fillText(value,lx+10,ly+45);const tw=x.measureText(value).width;x.font='600 11px Segoe UI,sans-serif';x.fillStyle='#0e7483';x.fillText('m',lx+14+tw,ly+44);
 if(foot&&foot[1]>100&&foot[1]<h-12){const fx=Math.max(54,Math.min(w-54,foot[0])),fy=Math.max(100,Math.min(h-bottomInset-26,foot[1]+11));x.font='600 9px Segoe UI,sans-serif';x.textAlign='center';x.fillStyle='#ffffff';x.beginPath();x.roundRect(fx-48,fy,96,20,3);x.fill();x.fillStyle='#235766';x.fillText(groundKnown?'Ground reference':'Launch reference',fx,fy+14)}x.restore();
}
