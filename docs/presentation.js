'use strict';
// The presentation reads sealed flight records. Nothing here connects to MAVLink.
const DATA=window.RESCUE_DATA,PARAMETERS=window.RESCUE_PARAMETERS,slides=[...document.querySelectorAll('.slide')];
let lang='fa',index=0,phase=2,detectCase='steady',handoverCase='no_pilot',scenario='manual';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)],tr=(fa,ru)=>lang==='fa'?fa:ru;
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val=(e,name)=>e?.[name]??e?.[{TimeUS:'time_us',Alt:'alt',Az:'az',Vz:'sink',Event:'code',Why:'risk'}[name]];
const event=(name,code)=>DATA.flights[name]?.events?.find(e=>Number(val(e,'Event'))===code);
const seconds=e=>(val(e,'TimeUS')??(e?.t||0)*1e6)/1e6;
const fmt=(v,n=2)=>Number.isFinite(Number(v))?Number(v).toFixed(n):'—';
const label=(fa,ru)=>'<span>'+safe(tr(fa,ru))+'</span>';

function chart(selector,flight,field,{title='',unit='',reference=[],start=null,end=null,height=265,color='#147b84',showEvents=true}={}){
 const target=$(selector);if(!target)return;
 let trace=flight.trace.filter(d=>(start===null||d.t>=start)&&(end===null||d.t<=end)&&Number.isFinite(d[field]));
 if(!trace.length){target.textContent=tr('داده‌ای ثبت نشده است.','Нет записанных данных.');return;}
 const W=800,H=height,L=65,R=20,T=23,B=42,x0=trace[0].t,x1=trace.at(-1).t;
 let lo=Math.min(...trace.map(d=>d[field]),...reference.map(x=>x.value)),hi=Math.max(...trace.map(d=>d[field]),...reference.map(x=>x.value));
 if(field==='alt'){lo=Math.min(0,lo);hi=Math.max(220,hi);}if(field==='airspeed')lo=0;
 let span=Math.max(hi-lo,1);lo-=span*.08;hi+=span*.1;
 const X=t=>L+(t-x0)/Math.max(1,x1-x0)*(W-L-R),Y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${safe(title+' '+unit)}"><title>${safe(title+' '+unit)}</title><rect width="${W}" height="${H}" fill="#fff"/>`;
 for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,y=Y(v);svg+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#dbe4e8"/><text x="${L-10}" y="${y+5}" text-anchor="end" fill="#4c6472" font-size="14">${fmt(v,Math.abs(v)<10?1:0)}</text>`;}
 for(let i=0;i<=5;i++){const t=x0+(x1-x0)*i/5,x=X(t);svg+=`<text x="${x}" y="${H-13}" text-anchor="middle" fill="#4c6472" font-size="14">${fmt(t,0)}</text>`;}
 for(const r of reference){const y=Y(r.value);svg+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="${r.color||'#b13140'}" stroke-dasharray="7 5" stroke-width="1.5"/><text x="${W-R-4}" y="${y-5}" text-anchor="end" fill="${r.color||'#b13140'}" font-size="12">${r.value} ${safe(unit)}</text>`;}
 svg+='<path d="'+trace.map((d,i)=>(i?'L':'M')+X(d.t).toFixed(2)+','+Y(d[field]).toFixed(2)).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="3" stroke-linejoin="round"/>';
 if(showEvents){const used=new Set();for(const e of flight.events||[]){const code=val(e,'Event');if(![1,3,4,6,8].includes(code)||used.has(code))continue;used.add(code);const t=seconds(e);if(t<x0||t>x1)continue;const x=X(t),c={1:'#925800',3:'#b13140',4:'#08776e',6:'#5b4180',8:'#5b4180'}[code];svg+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${H-B}" stroke="${c}" stroke-width="1.3" stroke-dasharray="3 4"/>`;}}
 svg+=`<text x="${L}" y="16" fill="#4c6472" font-size="13">${safe(title)} (${safe(unit)})</text><text x="${W-R}" y="16" text-anchor="end" fill="#4c6472" font-size="12">t / s</text></svg>`;
 target.innerHTML=svg;
}

function renderPhases(){
 const content={
  0:{code:'MONITOR',fa:'پایش بدون مداخله',ru:'Проверка без вмешательства',text:['ناظر در مد جاری باقی می‌ماند. مسلح‌بودن و در حال پرواز بودن، شرط ورود خودکار هستند.','Наблюдение не меняет текущий режим. Автоматический захват разрешён только armed и в полёте.'],img:'hero-flight.jpg',a:['مرز هشدار','Порог предупреждения','200 m'],b:['مرز گرفتن کنترل','Порог захвата','100 m']},
  1:{code:'WARNING',fa:'هشدار با شدت WARNING',ru:'Предупреждение уровня WARNING',text:['سقوط تأییدشده زیر ۲۰۰ متر، پیام تقریباً یک‌هرتزی ایجاد می‌کند. هشدار به‌تنهایی مد پرواز را عوض نمی‌کند.','Подтверждённое падение ниже 200 м вызывает сообщение примерно с частотой 1 Гц. Само предупреждение не меняет режим.'],img:'warning-flight.jpg',a:['پیام به GCS','Сообщение GCS','~1 Hz'],b:['تغییر مد','Смена режима',tr('ندارد','Нет')]},
  2:{code:'RESCUE',fa:'گرفتن کنترل و بازیابی',ru:'Захват и вывод',text:['با ادامه شرط اصلی زیر ۱۰۰ متر Home، مد ۲۶ از مد جاری کنترل را می‌گیرد. TECS ارتفاع و سرعت را برای بازیابی مدیریت می‌کند.','При продолжении основного условия ниже 100 м относительно Home режим 26 перехватывает управление. TECS управляет высотой и скоростью вывода.'],img:'capture-flight.jpg',a:['هدف ارتفاع','Целевая высота','200 m'],b:['رول هدف','Заданный крен','0°']},
  3:{code:'STABILIZED',fa:'پایداری پیوسته تأیید شد',ru:'Устойчивый горизонт подтверждён',text:['تمام معیارهای ارتفاع، سرعت عمودی، وضعیت، نرخ و سرعت هوایی باید دو ثانیه برقرار بمانند. سپس پیام تثبیت و مهلت خلبان آغاز می‌شود.','Все критерии высоты, вертикальной скорости, углов, угловой и воздушной скорости должны выполняться 2 с. Затем подаётся сигнал и запускается окно передачи.'],img:'stable-flight.jpg',a:['دوام پایداری','Выдержка устойчивости','2 s'],b:['پنجره خلبان','Окно оператора','5 s']},
  4:{code:'PARACHUTE',fa:'چتر با قطع موتور و disarm',ru:'Парашют, остановка двигателя и disarm',text:['بدون پاسخ خلبان، AP_Parachute درخواست می‌شود. خروجی رهاساز، قطع موتور و disarm از لاگ بومی کنترل شده‌اند.','При отсутствии реакции вызывается AP_Parachute. Выход выпуска, остановка двигателя и disarm проверены по штатному логу.'],img:'canopy-flight.jpg',a:['تأخیر رهاساز','Задержка выпуска','0.5 s'],b:['بازشدن مدل','Раскрытие модели','1.5 s']}
 }[phase];
 $('#phase-code').textContent=content.code;$('#phase-title').textContent=tr(content.fa,content.ru);$('#phase-description').textContent=tr(...content.text);
 $('#phase-picture').src='assets/'+content.img;$('#phase-picture').alt=tr(content.fa,content.ru);
 $('#phase-readouts').innerHTML=[content.a,content.b].map(v=>'<div><dt>'+safe(tr(v[0],v[1]))+'</dt><dd dir="ltr">'+safe(v[2])+'</dd></div>').join('');
 all('[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.phase)===phase)));
}
function renderParameters(){
 const row=p=>'<tr><td><code dir="ltr">'+safe(p.name)+'</code></td><td dir="ltr">'+safe(p.value)+'</td><td>'+safe(p[lang])+'</td></tr>';
 $('#required-parameters').innerHTML=PARAMETERS.filter(p=>p.required).map(row).join('');
 const query=$('#parameter-search').value.trim().toLowerCase();
 $('#extra-parameters').innerHTML=PARAMETERS.filter(p=>!p.required&&(!query||(p.name+' '+p.fa+' '+p.ru).toLowerCase().includes(query))).map(row).join('');
}
function renderDetection(){
 const f=DATA.flights[detectCase];
 chart('#detect-height',f,'alt',{title:tr('ارتفاع Home ثبت‌شده','Высота Home по записи'),unit:'m',reference:[{value:100}],start:detectCase==='steady'?54:null});
 chart('#detect-accel',f,'az',{title:tr('شتاب نزولی ناظر','Ускорение вниз по данным надзора'),unit:'m/s²',reference:[{value:5}],height:185,start:detectCase==='steady'?54:null,color:'#315e8d'});
 const cap=f.capture||event('steady',3);
 $('#detect-result').textContent=detectCase==='normal'?tr('تیک‌آف و گذارهای عادیِ این آزمون ورود کاذب نداشتند.','Взлёт и обычные переходы в этом испытании не вызвали ложного захвата.'):
 tr('ورود تکمیلی در ۴۵٫۴۱ متر Home با شتاب حدود ۰٫۰۰۵ و نزول ۷٫۹۰ متر بر ثانیه ثبت شد.','Дополнительный захват зарегистрирован на 45,41 м Home при ускорении около 0,005 м/с² и снижении 7,90 м/с.');
 all('[data-detect]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.detect===detectCase)));
}
function renderHandover(){
 const elapsed=Number($('#handover-scrub').value),stable=event(handoverCase,4),last=event(handoverCase,handoverCase==='no_pilot'?6:5),delay=seconds(last)-seconds(stable),done=elapsed>=delay;
 $('#handover-time').textContent=fmt(Math.max(0,5-elapsed));$('#handover-bar').style.width=Math.max(0,100*(1-elapsed/5))+'%';
 $('#handover-result').textContent=done?(handoverCase==='no_pilot'?tr('در '+fmt(delay)+' ثانیه: درخواست چتر، قطع موتور و disarm.','Через '+fmt(delay)+' с: запрос парашюта, остановка двигателя и disarm.'):
 tr('در '+fmt(delay)+' ثانیه: FBWA پذیرفته شد؛ چتر آزاد نشد.','Через '+fmt(delay)+' с: переход в FBWA принят. Парашют не выпущен.')):
 tr('پرنده تثبیت شده است؛ منتظر رویداد خلبان یا پایان مهلت.','Борт стабилизирован. Ожидание реакции оператора либо истечения окна.');
 all('[data-handover]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.handover===handoverCase)));
}
const scenarioText={
 warning:[['هشدار بدون گرفتن کنترل','Предупреждение без захвата'],['در شیرجه زیر ۲۰۰ متر، هشدار ثبت شد و RESCUE کنترل را نگرفت.','При пикировании ниже 200 м зарегистрировано предупреждение. RESCUE управление не захватил.']],
 manual:[['ورود از مد جاری','Захват из текущего режима'],['ورود از MANUAL در ۹۹٫۵۲ متر Home با شتاب بیش از پنج ثبت شده است.','Захват из MANUAL зарегистрирован на 99,52 м Home при ускорении более 5 м/с².']],
 auto:[['ورود از مد جاری','Захват из текущего режима'],['ورود از AUTO در ۹۹٫۷۱ متر Home با شتاب بیش از پنج ثبت شده است.','Захват из AUTO зарегистрирован на 99,71 м Home при ускорении более 5 м/с².']],
 recovery:[['بازیابی با TECS','Вывод через TECS'],['پایداری در باند هدف ۲۰۰ متر تأیید شد؛ سرعت از حداقل مدل پایین‌تر نرفت.','Подтверждён устойчивый полёт в диапазоне цели 200 м. Скорость не опускалась ниже минимума модели.']],
 handover:[['واگذاری معتبر به FBWA','Достоверная передача в FBWA'],['تغییر مدِ خلبان پس از تثبیت پذیرفته شد. چتر بسته و پرنده مسلح ماند.','Смена режима оператором после стабилизации принята. Парашют не выпущен, борт остался armed.']],
 no_pilot:[['نبود پاسخ خلبان','Нет реакции оператора'],['حدود ۵٫۰۲ ثانیه پس از تثبیت، درخواست چتر ثبت شد؛ خروجی، موتور و disarm کنترل شده‌اند.','Примерно через 5,02 с после стабилизации зарегистрирован запрос парашюта. Выпуск, остановка двигателя и disarm проверены.']],
 failed:[['بازیابی ناموفق','Неудачный вывод'],['پس از گرفتن کنترل، خرابی پیشران القا شد؛ ناظر در ۷۳٫۵۴ متر به چتر تنزل داد.','После захвата смоделирован отказ двигателя. На высоте 73,54 м над Home надзор перешёл к парашюту.']],
 disabled:[['منطق غیرفعال','Логика отключена'],['RSC_ENABLE=0: هیچ مداخله‌ای از ناظر ثبت نشد. در این حالت، ارتفاع از POS بومی نمایش داده می‌شود.','RSC_ENABLE=0: вмешательство надзора не зарегистрировано. В этом случае показана штатная высота из POS.']]
};
function renderScenario(){
 const f=DATA.flights[scenario],copy=scenarioText[scenario];$('#scenario-title').textContent=tr(...copy[0]);$('#scenario-description').textContent=tr(...copy[1]);
 $('#capture-modes').hidden=!['manual','auto'].includes(scenario);
 chart('#scenario-chart',f,'alt',{title:tr('ارتفاع Home در لاگ','Высота Home в логе'),unit:'m',reference:[{value:100},{value:200,color:'#925800'}],height:280});
 const cap=event(scenario,3),stable=event(scenario,4),chute=event(scenario,6)||event(scenario,8);
 const facts=[];
 if(cap)facts.push(tr('ورود','Захват')+': <b dir="ltr">'+fmt(val(cap,'Alt'))+' m</b>');
 if(stable)facts.push(tr('تثبیت','Стабилизация')+': <b dir="ltr">'+fmt(val(stable,'Alt'))+' m</b>');
 if(chute)facts.push(tr('درخواست چتر','Запрос парашюта')+': <b dir="ltr">'+fmt(val(chute,'Alt'))+' m</b>');
 if(!facts.length)facts.push(tr('عدم ورود RESCUE تأیید شد.','Отсутствие захвата RESCUE подтверждено.'));
 $('#scenario-facts').innerHTML=facts.map(x=>'<span>'+x+'</span>').join('');$('#scenario-bin').href=f.bin;
 all('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===(['manual','auto'].includes(scenario)?'manual':scenario))));
 all('[data-capture]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.capture===scenario)));
}
function dynamic(){
 renderPhases();renderParameters();renderDetection();renderHandover();renderScenario();
 chart('#tecs-height',DATA.flights.recovery,'alt',{title:tr('ارتفاع ناظر','Высота надзора'),unit:'m',reference:[{value:200,color:'#925800'}],start:66});
 chart('#tecs-speed',DATA.flights.recovery,'airspeed',{title:tr('سرعت هوایی','Воздушная скорость'),unit:'m/s',reference:[{value:10}],start:66,height:190,color:'#315e8d'});
 chart('#failure-height',DATA.flights.failed,'alt',{title:tr('ارتفاع در شکست بازیابی','Высота при неудачном выводе'),unit:'m',reference:[{value:100}],start:68,height:250});
}
function setLanguage(next){
 lang=next==='ru'?'ru':'fa';document.documentElement.lang=lang;document.documentElement.dir=lang==='fa'?'rtl':'ltr';
 all('[data-fa][data-ru]').forEach(el=>el.textContent=el.dataset[lang]);
 all('[data-alt-fa]').forEach(el=>el.alt=el.dataset[lang==='fa'?'altFa':'altRu']);
 $('#language').textContent=lang==='fa'?'Русский':'فارسی';$('#language').setAttribute('aria-label',lang==='fa'?'Переключить на русский':'تغییر به فارسی');
 dynamic();show(index,false);
}
function show(n,focus=false){
 index=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,i)=>{s.hidden=i!==index;});
 all('video').forEach(v=>{if(v.closest('.slide').hidden&&!v.paused)v.pause();});
 $('#previous').disabled=index===0;$('#next').disabled=index===slides.length-1;
 $('#page-count').textContent=(index+1)+' / '+slides.length;
 const topic=slides[index].querySelector('h2,h1');$('#page-topic').textContent=topic?.textContent||'RESCUE';
 all('#outline [data-go]').forEach(b=>{if(Number(b.dataset.go)===index)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#outline').hidden=true;$('#outline-toggle').setAttribute('aria-expanded','false');
 const hash='#slide='+index+'&lang='+lang;if(location.hash!==hash)history.replaceState(null,'',hash);
 if(focus){slides[index].scrollTop=0;$('#presentation').focus({preventScroll:true});}
}
$('#previous').addEventListener('click',()=>show(index-1,true));$('#next').addEventListener('click',()=>show(index+1,true));
all('[data-go]').forEach(b=>b.addEventListener('click',()=>show(Number(b.dataset.go),true)));
$('.brand').addEventListener('click',e=>{e.preventDefault();show(0,true);});
$('#language').addEventListener('click',()=>setLanguage(lang==='fa'?'ru':'fa'));
$('#outline-toggle').addEventListener('click',()=>{const open=$('#outline').hidden;$('#outline').hidden=!open;$('#outline-toggle').setAttribute('aria-expanded',String(open));});
all('[data-phase]').forEach(b=>b.addEventListener('click',()=>{phase=Number(b.dataset.phase);renderPhases();}));
all('[data-detect]').forEach(b=>b.addEventListener('click',()=>{detectCase=b.dataset.detect;renderDetection();}));
all('[data-handover]').forEach(b=>b.addEventListener('click',()=>{handoverCase=b.dataset.handover;$('#handover-scrub').value='0';renderHandover();}));
$('#handover-scrub').addEventListener('input',renderHandover);$('#parameter-search').addEventListener('input',renderParameters);
all('[data-scenario]').forEach(b=>b.addEventListener('click',()=>{scenario=b.dataset.scenario;renderScenario();}));
all('[data-capture]').forEach(b=>b.addEventListener('click',()=>{scenario=b.dataset.capture;renderScenario();}));
all('[data-seek]').forEach(b=>b.addEventListener('click',()=>{const video=$('#cycle-video'),seek=()=>{video.currentTime=Math.min(Number(b.dataset.seek),Math.max(0,video.duration-.1));video.play().catch(()=>{});};if(video.readyState>=1)seek();else{video.addEventListener('loadedmetadata',seek,{once:true});video.load();}}));
$('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{const t=$('#toast');t.textContent=tr('در این مرورگر، کلید F11 را برای تمام‌صفحه استفاده کنید.','Для полноэкранного режима используйте F11 в этом браузере.');t.hidden=false;setTimeout(()=>t.hidden=true,4500);}});
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT|VIDEO/.test(e.target.tagName))return;if(e.key==='Escape'){$('#outline').hidden=true;$('#outline-toggle').setAttribute('aria-expanded','false');$('#outline-toggle').focus();return;}let n=index;if(e.key==='ArrowRight')n+=lang==='fa'?-1:1;else if(e.key==='ArrowLeft')n+=lang==='fa'?1:-1;else if(e.key==='PageDown')n++;else if(e.key==='PageUp')n--;else if(e.key==='Home')n=0;else if(e.key==='End')n=slides.length-1;else return;e.preventDefault();show(n,true);});
function fromHash(){const p=new URLSearchParams(location.hash.slice(1));index=Math.max(0,Math.min(slides.length-1,Number(p.get('slide'))||0));setLanguage(p.get('lang')==='ru'?'ru':'fa');}
window.addEventListener('hashchange',fromHash);fromHash();
