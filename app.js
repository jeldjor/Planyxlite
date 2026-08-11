(() => {
'use strict';
const $=id=>document.getElementById(id);
const STORE='planyx-lite-state-v1';
const PREF='planyx-lite-prefs-v1';
const REQUIRED=['d_name','d_phone','d_address1','d_zipcode','d_city','d_country','delivery_date'];
let deferredInstall=null, movingStopId=null, transferLink='', currentView='';
let state=loadState();
let prefs=loadPrefs();

function defaultState(){return {version:1,sourceName:'',startAddress:'',endAddress:'',sameEnd:true,startPoint:null,endPoint:null,stops:[],days:{},selectedDay:'',planningReady:false,updatedAt:null}}
function loadState(){try{return {...defaultState(),...JSON.parse(localStorage.getItem(STORE)||'{}')}}catch{return defaultState()}}
function saveState(){state.updatedAt=new Date().toISOString();localStorage.setItem(STORE,JSON.stringify(state))}
function loadPrefs(){try{return {tomtomKey:'',navApp:'google',startAddress:'',endAddress:'',sameEnd:true,...JSON.parse(localStorage.getItem(PREF)||'{}')}}catch{return {tomtomKey:'',navApp:'google',startAddress:'',endAddress:'',sameEnd:true}}}
function savePrefs(){localStorage.setItem(PREF,JSON.stringify(prefs))}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').classList.add('hidden'),2600)}
function isoDate(v){
  if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);
  if(typeof v==='number'&&window.XLSX){const d=XLSX.SSF.parse_date_code(v);if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}
  const s=String(v??'').trim(); if(!s)return '';
  const nl=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if(nl)return `${nl[3]}-${nl[2].padStart(2,'0')}-${nl[1].padStart(2,'0')}`;
  const ymd=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);if(ymd)return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
  const d=new Date(s); return isNaN(d)?'':d.toISOString().slice(0,10)
}
function formatDay(iso,short=false){if(!iso)return '';const d=new Date(iso+'T12:00:00');return new Intl.DateTimeFormat('nl-NL',short?{weekday:'short',day:'numeric',month:'short'}:{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d)}
function countryCode(country){const s=String(country||'').trim().toLowerCase();if(['nl','nederland','netherlands','holland'].includes(s))return 'NL';if(['be','belgie','belgië','belgium'].includes(s))return 'BE';return ''}
function addressOf(s){return [s.d_address1,s.d_zipcode,s.d_city,s.d_country].filter(Boolean).join(', ')}
function uid(row,i){return String(row.cargoid||row.c_id||`stop-${Date.now()}-${i}-${Math.random().toString(36).slice(2,7)}`)}
function hav(a,b){if(!a||!b)return Infinity;const R=6371,rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),la1=rad(a.lat),la2=rad(b.lat);const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function routeDistance(order,start,end){let d=0,p=start;for(const s of order){d+=hav(p,s.position);p=s.position}if(end)d+=hav(p,end);return d}
function optimizeStops(stops,start,end){
  const left=[...stops],order=[];let cur=start;
  while(left.length){let bi=0,bd=Infinity;for(let i=0;i<left.length;i++){const d=hav(cur,left[i].position)+(end&&left.length===1?hav(left[i].position,end)*.15:0);if(d<bd){bd=d;bi=i}}const next=left.splice(bi,1)[0];order.push(next);cur=next.position}
  let improved=true,loops=0;
  while(improved&&loops++<50){improved=false;let base=routeDistance(order,start,end);for(let i=0;i<order.length-1;i++){for(let j=i+1;j<order.length;j++){const cand=[...order.slice(0,i),...order.slice(i,j+1).reverse(),...order.slice(j+1)];const nd=routeDistance(cand,start,end);if(nd+0.05<base){order.splice(0,order.length,...cand);base=nd;improved=true}}}}
  return order;
}
const GEO_CACHE='planyx-lite-geocache-v1';
let lastTomTomCall=0;
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function loadGeoCache(){try{return JSON.parse(localStorage.getItem(GEO_CACHE)||'{}')}catch{return {}}}
function saveGeoCache(cache){try{localStorage.setItem(GEO_CACHE,JSON.stringify(cache))}catch{}}
async function tomtomJson(url,{retries=12}={}){
  for(let attempt=0;;attempt++){
    // Bewust conservatief: maximaal circa 1 TomTom-call per 2,5 seconde.
    // De app mag iets langer rekenen, maar hoort niet op API-limieten vast te lopen.
    const gap=2500-(Date.now()-lastTomTomCall);if(gap>0)await sleep(gap);lastTomTomCall=Date.now();
    const r=await fetch(url);const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch{}
    if(r.ok)return j;
    const msg=j.errorText||j?.detailedError?.message||text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()||`TomTom fout (${r.status})`;
    const limited=r.status===429||r.status===403&&/rate|volume|limit|exceeded/i.test(msg)||/rate limit|too many requests|permitted rate|exceeded.*limit/i.test(msg);
    if(limited&&attempt<retries){const retryAfter=Number(r.headers.get('Retry-After'));const waits=[5000,8000,12000,18000,25000,35000,45000,60000,60000,60000,60000,60000];await sleep(Number.isFinite(retryAfter)&&retryAfter>0?Math.max(5000,retryAfter*1000):waits[Math.min(attempt,waits.length-1)]);continue}
    if(limited){const err=new Error('TomTom rate-limit bereikt.');err.code='TOMTOM_RATE_LIMIT';throw err;}
    throw new Error(msg||`TomTom fout (${r.status})`);
  }
}
async function geocodeAddress(query,country,key){
  const cache=loadGeoCache(),cacheKey=`${countryCode(country)}|${String(query).trim().toLowerCase()}`;if(cache[cacheKey])return cache[cacheKey];
  const u=new URL(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(query)}.json`);u.searchParams.set('key',key);u.searchParams.set('limit','1');const cc=countryCode(country);if(cc)u.searchParams.set('countrySet',cc);const j=await tomtomJson(u);const p=j.results?.[0]?.position;if(!p)throw new Error(`Adres niet gevonden: ${query}`);
  const found={lat:Number(p.lat),lon:Number(p.lon),freeform:j.results?.[0]?.address?.freeformAddress||query};cache[cacheKey]=found;saveGeoCache(cache);return found
}
async function routeWholeDay(start,stops,end,key,optimize=true){
  const points=[start,...stops.map(s=>s.position),end];if(points.length<2)throw new Error('Geen routepunten gevonden.');if(points.length-2>150)throw new Error('Een dag bevat meer dan 150 stops; splits deze dag op.');
  const locs=points.map(p=>`${p.lat},${p.lon}`).join(':');const u=new URL(`https://api.tomtom.com/routing/1/calculateRoute/${locs}/json`);u.searchParams.set('key',key);u.searchParams.set('travelMode','car');u.searchParams.set('traffic','true');u.searchParams.set('routeType','fastest');u.searchParams.set('routeRepresentation','summaryOnly');if(optimize&&stops.length>1)u.searchParams.set('computeBestOrder','true');
  const j=await tomtomJson(u);const route=j.routes?.[0];if(!route?.summary)throw new Error('Geen route gevonden.');
  let ordered=[...stops];if(optimize&&Array.isArray(route.optimizedWaypoints)&&route.optimizedWaypoints.length===stops.length){ordered=[...stops];for(const w of route.optimizedWaypoints){if(Number.isInteger(w.providedIndex)&&Number.isInteger(w.optimizedIndex)&&stops[w.providedIndex])ordered[w.optimizedIndex]=stops[w.providedIndex]}}
  return {ordered,summary:route.summary,legs:route.legs||[]};
}
function setBusy(msg){$('generateBtn').disabled=true;$('generateBtn').textContent=msg}
function clearBusy(){$('generateBtn').disabled=false;$('generateBtn').textContent='Genereer en optimaliseer planning'}

async function importExcel(file){
  if(!window.XLSX)throw new Error('Excel-module is nog niet geladen. Controleer de internetverbinding en probeer opnieuw.');
  const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array',cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});
  if(!rows.length)throw new Error('Het bestand bevat geen gegevens.');
  const headers=Object.keys(rows[0]).map(x=>String(x).trim());const missing=REQUIRED.filter(h=>!headers.includes(h));if(missing.length)throw new Error('Ontbrekende kolommen: '+missing.join(', '));
  const stops=[];rows.forEach((r,i)=>{const deliveryDate=isoDate(r.delivery_date);if(!deliveryDate)return;stops.push({id:uid(r,i),d_name:String(r.d_name||'').trim(),d_phone:String(r.d_phone||'').trim(),d_address1:String(r.d_address1||'').trim(),d_zipcode:String(r.d_zipcode||'').trim(),d_city:String(r.d_city||'').trim(),d_country:String(r.d_country||'').trim(),delivery_date:deliveryDate,original_delivery_date:deliveryDate,visited:false,position:null,order:0,legKm:null,legMin:null})});
  if(!stops.length)throw new Error('Geen regels met een geldige delivery_date gevonden.');
  state={...defaultState(),sourceName:file.name,stops,startAddress:$('startAddress').value.trim(),sameEnd:$('sameEnd').checked,endAddress:$('sameEnd').checked?$('startAddress').value.trim():$('endAddress').value.trim()};
  buildDayShells();state.planningReady=false;saveState();$('importStatus').textContent=`${stops.length} afleveringen ingelezen uit ${file.name}. Klik op ‘Genereer en optimaliseer planning’.`;render();
}
function buildDayShells(){const old=state.days||{};const dates=[...new Set(state.stops.map(s=>s.delivery_date).filter(Boolean))].sort();const days={};for(const d of dates){days[d]=old[d]||{date:d,summary:null,generated:false};}state.days=days;if(!state.selectedDay||!days[state.selectedDay])state.selectedDay=dates.includes(todayIso())?todayIso():dates[0]||''}
function todayIso(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

function weekBounds(baseIso=todayIso()){
  const d=new Date(baseIso+'T12:00:00');const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);
  const start=new Date(d),end=new Date(d);end.setDate(end.getDate()+6);
  const toIso=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  return {start:toIso(start),end:toIso(end)};
}
function currentWeekDates(){const {start,end}=weekBounds();return Object.keys(state.days||{}).filter(d=>d>=start&&d<=end).sort()}
function isPhoneLayout(){return window.matchMedia('(max-width: 760px)').matches}
function setView(view,{remember=true}={}){
  currentView=view==='database'?'database':'route';
  $('databaseView').classList.toggle('hidden',currentView!=='database');
  $('routeView').classList.toggle('hidden',currentView!=='route');
  $('databaseTab').classList.toggle('active',currentView==='database');
  $('routeTab').classList.toggle('active',currentView==='route');
  if(remember)sessionStorage.setItem('planyx-lite-view',currentView);
}
function defaultView(){return isPhoneLayout()?'route':'database'}

async function generateAll(){
  if(!state.stops.length)return toast('Importeer eerst een Excel-bestand.');
  state.planningReady=false;saveState();render();const key=$('tomtomKey').value.trim();if(!key)return toast('Vul je TomTom API-key in.');const start=$('startAddress').value.trim();if(!start)return toast('Vul een startadres in.');const same=$('sameEnd').checked,end=same?start:$('endAddress').value.trim();if(!end)return toast('Vul een eindadres in.');
  prefs={...prefs,tomtomKey:key,startAddress:start,endAddress:end,sameEnd:same};savePrefs();state.startAddress=start;state.endAddress=end;state.sameEnd=same;
  try{
    for(let run=0;run<3;run++){
      try{
        setBusy(run?'TomTom limiet hersteld · automatisch doorgaan…':'Startadres controleren…');
        state.startPoint=state.startPoint||await geocodeAddress(start,'',key);state.endPoint=same?state.startPoint:(state.endPoint||await geocodeAddress(end,'',key));saveState();
        const ungeocoded=state.stops.filter(s=>!s.position);let done=0;
        for(const s of ungeocoded){setBusy(`Adressen zoeken ${++done}/${ungeocoded.length}`);s.position=await geocodeAddress(addressOf(s),s.d_country,key);saveState()}
        buildDayShells();const dates=Object.keys(state.days).sort();
        // Geef TomTom na het geocoderen extra ruimte voordat de routeberekeningen beginnen.
        if(dates.length){setBusy('Alle adressen gevonden · routes voorbereiden…');await sleep(3500)}
        for(let di=0;di<dates.length;di++){
          const date=dates[di];
          setBusy(`Dag ${di+1}/${dates.length} · ${formatDay(date,true)} optimaliseren…`);
          await optimizeDay(date,key,true);saveState();
          // Ook tussen dagen bewust pauzeren; betrouwbaarheid gaat boven snelheid.
          if(di<dates.length-1)await sleep(3000);
        }
        const incomplete=dates.filter(d=>!state.days[d]?.generated||!state.days[d]?.summary);
        if(incomplete.length)throw new Error(`Niet alle dagen zijn afgerond (${incomplete.length} resterend).`);
        state.planningReady=true;saveState();render();setView('route');toast(`Alle ${dates.length} dagroute${dates.length===1?'':'s'} zijn gegenereerd en geoptimaliseerd.`);return;
      }catch(e){
        if(e?.code==='TOMTOM_RATE_LIMIT'&&run<2){setBusy('TomTom limiet · automatisch langer wachten en doorgaan…');saveState();await sleep(run===0?30000:60000);continue}
        throw e;
      }
    }
  }catch(e){console.error(e);alert(e?.code==='TOMTOM_RATE_LIMIT'?'TomTom blijft de API-limiet blokkeren nadat Planyx-lite meerdere keren automatisch heeft gewacht. Reeds gevonden adressen zijn bewaard; probeer later nogmaals.':(e.message||String(e)))}finally{clearBusy()}
}
async function optimizeDay(date,key,withLive){
  const all=state.stops.filter(s=>s.delivery_date===date),visited=all.filter(s=>s.visited).sort((a,b)=>a.order-b.order),remaining=all.filter(s=>!s.visited&&s.position);
  let combined=[...visited];let totalKm=0,totalMin=null,liveOk=withLive&&!!key;
  if(liveOk&&remaining.length){
    setBusy(`${formatDay(date,true)} · optimale route berekenen…`);const routeStart=visited.length?visited[visited.length-1].position:state.startPoint;const result=await routeWholeDay(routeStart,remaining,state.endPoint,key,true);combined=[...visited,...result.ordered];
    const routeKm=Number(result.summary.lengthInMeters||0)/1000,routeMin=Number(result.summary.travelTimeInSeconds||0)/60;
    if(visited.length){let p=state.startPoint;for(const s of visited){const km=hav(p,s.position);s.legKm=km;s.legMin=null;totalKm+=km;p=s.position}totalKm+=routeKm}else{totalKm=routeKm;totalMin=routeMin}
    const legs=result.legs||[];result.ordered.forEach((s,i)=>{const leg=legs[i]?.summary;s.legKm=leg?Number(leg.lengthInMeters||0)/1000:null;s.legMin=leg?Number(leg.travelTimeInSeconds||0)/60:null});
  }else{
    const localStart=visited.length?visited[visited.length-1].position:state.startPoint;const optimized=optimizeStops(remaining,localStart,state.endPoint);combined=[...visited,...optimized];let p=state.startPoint;for(const s of combined){const km=hav(p,s.position);s.legKm=km;s.legMin=null;totalKm+=km;p=s.position}if(combined.length)totalKm+=hav(p,state.endPoint);liveOk=false
  }
  combined.forEach((s,i)=>s.order=i+1);state.days[date]={date,generated:true,summary:{km:totalKm,min:totalMin,live:liveOk,updatedAt:new Date().toISOString()}};
}
async function reoptimizeCurrent(){
  const d=state.selectedDay;if(!d)return;
  const key=prefs.tomtomKey||$('tomtomKey').value.trim();
  const btn=$('reoptimizeBtn'),oldText=btn.textContent;btn.disabled=true;btn.textContent='Optimaliseren…';
  try{await optimizeDay(d,key,!!key);saveState();render();toast('Route geoptimaliseerd.')}catch(e){console.error(e);alert(e.message||String(e))}finally{btn.disabled=false;btn.textContent=oldText}
}

function dayStops(date){return state.stops.filter(s=>s.delivery_date===date).sort((a,b)=>(a.order||9999)-(b.order||9999))}
function navUrl(s){const q=encodeURIComponent(addressOf(s));if(prefs.navApp==='apple')return `https://maps.apple.com/?daddr=${q}&dirflg=d`;if(prefs.navApp==='waze')return `https://www.waze.com/ul?q=${q}&navigate=yes`;return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`}
function fullRouteUrl(){const stops=dayStops(state.selectedDay).filter(s=>!s.visited);if(!stops.length)return '';const origin=state.startAddress||'';const destination=state.endAddress||addressOf(stops[stops.length-1]);if(prefs.navApp==='google'){const mids=stops.slice(0,-1).slice(0,9).map(addressOf);const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');if(origin)u.searchParams.set('origin',origin);u.searchParams.set('destination',destination);u.searchParams.set('travelmode','driving');if(mids.length)u.searchParams.set('waypoints',mids.join('|'));return u.toString()}return ''}
function openWholeRoute(){const stops=dayStops(state.selectedDay).filter(s=>!s.visited);if(!stops.length)return toast('Geen resterende stops.');if(prefs.navApp!=='google'){const name=prefs.navApp==='waze'?'Waze':'Apple Kaarten';alert(`${name} ondersteunt vanuit een webapp geen complete multi-stop route. Planyx-lite toont daarom de volledige volgorde zelf; gebruik Navigeren per stop. Kies Google Maps als je de dagroute met tussenstops in één kaart wilt openen.`);return}const u=fullRouteUrl();if(!u)return;window.open(u,'_blank','noopener')}
function minutesText(min){if(min==null||!isFinite(min))return '—';const h=Math.floor(min/60),m=Math.round(min%60);return h?`${h}u ${m}m`:`${m} min`}
function render(){
  buildDayShells();const ready=state.planningReady===true;const dates=ready?currentWeekDates():[];
  if(ready&&dates.length&&!dates.includes(state.selectedDay))state.selectedDay=dates.includes(todayIso())?todayIso():dates[0];
  $('daySelect').innerHTML=dates.length?dates.map(d=>`<option value="${d}" ${d===state.selectedDay?'selected':''}>${esc(formatDay(d,true))}</option>`).join(''):'<option>Geen route deze week</option>';
  $('prevDay').disabled=dates.length<2||dates.indexOf(state.selectedDay)<=0;$('nextDay').disabled=dates.length<2||dates.indexOf(state.selectedDay)>=dates.length-1;
  const d=ready&&dates.includes(state.selectedDay)?state.selectedDay:'';$('pageTitle').textContent=d===todayIso()?'Vandaag':(d?formatDay(d,true):'Vandaag');$('dateLabel').textContent=d?formatDay(d):formatDay(todayIso());
  const stops=ready&&d?dayStops(d):[],has=ready&&stops.length>0;$('emptyState').classList.toggle('hidden',has);$('summaryCard').classList.toggle('hidden',!has);$('routeActions').classList.toggle('hidden',!has);$('routeList').innerHTML='';
  if(has){const visited=stops.filter(s=>s.visited).length,sum=state.days[d]?.summary;$('stopCount').textContent=stops.length;$('visitedCount').textContent=visited;$('distanceTotal').textContent=sum?.km!=null?sum.km.toFixed(0):'—';$('timeTotal').textContent=minutesText(sum?.min);
    $('routeList').innerHTML=stops.map((s,i)=>stopHtml(s,i)).join('');
  }
  $('startAddress').value=state.startAddress||prefs.startAddress||'';$('sameEnd').checked=state.sameEnd??prefs.sameEnd;$('endAddress').value=state.endAddress||prefs.endAddress||'';$('endAddress').disabled=$('sameEnd').checked;$('tomtomKey').value=prefs.tomtomKey||'';$('navApp').value=prefs.navApp||'google';
  if(state.stops.length&&!ready)$('importStatus').textContent=`${state.stops.length} afleveringen ingelezen${state.sourceName?' uit '+state.sourceName:''}. Klaar om te genereren en optimaliseren.`;
  else if(state.stops.length&&ready)$('importStatus').textContent=`Planning gereed: ${state.stops.length} afleveringen verdeeld over ${Object.keys(state.days).length} dag(en).`;
}
function stopHtml(s,i){const km=s.legKm!=null?`${s.legKm.toFixed(1)} km vanaf vorige`:'';const phone=s.d_phone?`<a href="tel:${esc(s.d_phone)}">☎ Bellen</a>`:'';return `<article class="stopCard ${s.visited?'visited':''}" data-id="${esc(s.id)}"><div class="stopNo">${s.visited?'✓':(s.order||i+1)}</div><div class="stopInfo"><div class="stopName">${esc(s.d_name||'Naam onbekend')}</div><div class="stopAddress">${esc(s.d_address1)} · ${esc(s.d_zipcode)} ${esc(s.d_city)}</div><div class="stopMeta">${s.d_phone?`<span>☎ ${esc(s.d_phone)}</span>`:''}<span>${esc(s.d_country)}</span>${km?`<span>${km}</span>`:''}</div></div><div class="stopButtons"><a class="navigate" href="${navUrl(s)}" target="_blank" rel="noopener">Navigeren</a><button class="visitBtn ${s.visited?'active':''}" data-action="visit">${s.visited?'Bezocht ✓':'Bezocht'}</button><button class="moreBtn" data-action="more">•••</button></div><div class="stopMove"><button data-action="move">Naar andere dag</button><button data-action="up">↑ Omhoog</button><button data-action="down">↓ Omlaag</button></div></article>`}
function selectDay(delta){const ds=currentWeekDates();if(!ds.length)return;let i=Math.max(0,ds.indexOf(state.selectedDay));i=Math.max(0,Math.min(ds.length-1,i+delta));state.selectedDay=ds[i];saveState();render()}
function toggleVisit(id){const s=state.stops.find(x=>x.id===id);if(!s)return;s.visited=!s.visited;saveState();render()}
function manualMove(id,delta){const d=state.selectedDay,arr=dayStops(d),i=arr.findIndex(s=>s.id===id),j=i+delta;if(i<0||j<0||j>=arr.length)return;[arr[i].order,arr[j].order]=[arr[j].order||j+1,arr[i].order||i+1];state.days[d].summary={...state.days[d].summary,live:false,min:null};saveState();render()}
function moveToDate(id,date){const s=state.stops.find(x=>x.id===id);if(!s||!date)return;const old=s.delivery_date;s.delivery_date=date;s.visited=false;s.order=0;buildDayShells();if(state.days[old])state.days[old].summary={...state.days[old].summary,live:false,min:null};if(state.days[date])state.days[date].summary={...state.days[date].summary,live:false,min:null};try{optimizeDay(old,'',false);optimizeDay(date,'',false)}catch{}state.selectedDay=old;saveState();render();toast(`Verplaatst naar ${formatDay(date,true)}.`)}

function exportExcel(){if(!window.XLSX)return toast('Excel-module niet beschikbaar.');if(!state.stops.length)return;const rows=[...state.stops].sort((a,b)=>a.delivery_date.localeCompare(b.delivery_date)||(a.order||0)-(b.order||0)).map(s=>({d_name:s.d_name,d_phone:s.d_phone,d_address1:s.d_address1,d_zipcode:s.d_zipcode,d_city:s.d_city,d_country:s.d_country,delivery_date:s.delivery_date,bezocht:s.visited?'Ja':'Nee'}));const ws=XLSX.utils.json_to_sheet(rows,{header:[...REQUIRED,'bezocht']});ws['!cols']=[{wch:28},{wch:16},{wch:30},{wch:12},{wch:22},{wch:14},{wch:16},{wch:10}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Routes');XLSX.writeFile(wb,`Planyx-lite resultaat ${todayIso()}.xlsx`)}
function compactPayload(){return {v:1,s:state.startAddress,e:state.endAddress,se:state.sameEnd,sp:state.startPoint,ep:state.endPoint,st:state.stops.map(x=>({i:x.id,n:x.d_name,p:x.d_phone,a:x.d_address1,z:x.d_zipcode,c:x.d_city,o:x.d_country,d:x.delivery_date,od:x.original_delivery_date,v:x.visited?1:0,pos:x.position,r:x.order,k:x.legKm,m:x.legMin})),dy:state.days,sd:state.selectedDay}}
function payloadToState(p){if(!p||p.v!==1||!Array.isArray(p.st))throw new Error('Ongeldige Planyx-lite overdracht.');state={...defaultState(),startAddress:p.s||'',endAddress:p.e||'',sameEnd:p.se!==false,startPoint:p.sp||null,endPoint:p.ep||null,selectedDay:p.sd||'',days:p.dy||{},planningReady:true,stops:p.st.map(x=>({id:x.i,d_name:x.n||'',d_phone:x.p||'',d_address1:x.a||'',d_zipcode:x.z||'',d_city:x.c||'',d_country:x.o||'',delivery_date:x.d,original_delivery_date:x.od||x.d,visited:!!x.v,position:x.pos||null,order:x.r||0,legKm:x.k??null,legMin:x.m??null}))};buildDayShells();saveState();render();setView('route')}
function bytesToB64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function b64ToBytes(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
async function compressText(text){if('CompressionStream'in window){const cs=new CompressionStream('gzip');const ab=await new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer();return 'g'+bytesToB64(new Uint8Array(ab))}return 'j'+bytesToB64(new TextEncoder().encode(text))}
async function decompressText(data){const mode=data[0],bytes=b64ToBytes(data.slice(1));if(mode==='g'&&'DecompressionStream'in window){const ds=new DecompressionStream('gzip');return await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text()}return new TextDecoder().decode(bytes)}
async function makePhoneLink(){const packed=await compressText(JSON.stringify(compactPayload()));const base=location.href.split('#')[0];return `${base}#plan=${packed}`}
async function showPhone(){if(!state.stops.length)return;try{transferLink=await makePhoneLink();$('phoneModal').classList.remove('hidden');$('transferInfo').textContent=`${state.stops.length} stops · ${Object.keys(state.days||{}).length} dag(en)`;$('qrcode').innerHTML='';if(window.QRCode&&transferLink.length<3000){new QRCode($('qrcode'),{text:transferLink,width:250,height:250,correctLevel:QRCode.CorrectLevel.L});$('qrInfo').textContent='Scan alleen als je liever geen link verstuurt.'}else{$('qrcode').innerHTML='<div style="text-align:center;color:#66758a;padding:30px">Planning is te groot voor één betrouwbare QR-code.<br><br>Gebruik de deelbare link of het overdrachtsbestand.</div>';$('qrInfo').textContent='Gebruik bij voorkeur Delen, WhatsApp of Link kopiëren.'}}catch(e){alert(e.message)}}
async function sharePhoneLink(){if(!transferLink)transferLink=await makePhoneLink();const data={title:'Planyx-lite planning',text:'Open deze Planyx-lite planning op je telefoon:',url:transferLink};if(navigator.share){try{await navigator.share(data);return}catch(e){if(e?.name==='AbortError')return}}try{await navigator.clipboard.writeText(transferLink);toast('Delen niet beschikbaar; link is gekopieerd.')}catch{prompt('Kopieer deze link naar je telefoon:',transferLink)}}
async function shareWhatsApp(){if(!transferLink)transferLink=await makePhoneLink();const text=`Planyx-lite planning\n${transferLink}`;window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank','noopener')}
function downloadTransfer(){const blob=new Blob([JSON.stringify(compactPayload())],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Planyx-lite overdracht ${todayIso()}.planyx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function receiveHash(){const m=location.hash.match(/^#plan=(.+)$/);if(!m)return;try{const text=await decompressText(m[1]);payloadToState(JSON.parse(text));history.replaceState(null,'',location.pathname+location.search);toast('Planning op telefoon geladen.')}catch(e){console.error(e);alert('Planning kon niet worden geladen: '+e.message)}}

function bind(){
  $('databaseTab').onclick=()=>setView('database');$('routeTab').onclick=()=>setView('route');
  $('excelInput').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{await importExcel(f)}catch(err){alert(err.message)}e.target.value=''});
  $('transferInput').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{payloadToState(JSON.parse(await f.text()));toast('Overdracht geladen.')}catch(err){alert('Overdracht kon niet worden geopend: '+err.message)}e.target.value=''});
  $('sameEnd').addEventListener('change',()=>{$('endAddress').disabled=$('sameEnd').checked;if($('sameEnd').checked)$('endAddress').value=$('startAddress').value});$('startAddress').addEventListener('input',()=>{if($('sameEnd').checked)$('endAddress').value=$('startAddress').value});
  $('generateBtn').addEventListener('click',generateAll);$('clearBtn').addEventListener('click',()=>{if(!confirm('Huidige planning wissen en opnieuw beginnen?'))return;state=defaultState();saveState();render();toast('Planning gewist.')});
  $('daySelect').addEventListener('change',e=>{state.selectedDay=e.target.value;saveState();render()});$('prevDay').onclick=()=>selectDay(-1);$('nextDay').onclick=()=>selectDay(1);
  $('routeList').addEventListener('click',e=>{const card=e.target.closest('.stopCard');if(!card)return;const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;const id=card.dataset.id;if(action==='visit')toggleVisit(id);if(action==='more')card.classList.toggle('expanded');if(action==='up')manualMove(id,-1);if(action==='down')manualMove(id,1);if(action==='move'){movingStopId=id;$('moveDate').value=state.selectedDay;$('moveModal').classList.remove('hidden')}});
  $('reoptimizeBtn').onclick=reoptimizeCurrent;$('wholeRouteBtn').onclick=openWholeRoute;$('exportBtn').onclick=exportExcel;$('phoneBtn').onclick=showPhone;
  $('settingsBtn').onclick=()=>$('settingsModal').classList.remove('hidden');document.querySelector('.closeModal').onclick=()=>$('settingsModal').classList.add('hidden');document.querySelector('.closePhone').onclick=()=>$('phoneModal').classList.add('hidden');document.querySelector('.closeMove').onclick=()=>$('moveModal').classList.add('hidden');
  $('saveSettings').onclick=()=>{prefs.navApp=$('navApp').value;savePrefs();$('settingsModal').classList.add('hidden');render();toast('Instellingen opgeslagen.')};
  $('confirmMove').onclick=()=>{moveToDate(movingStopId,$('moveDate').value);$('moveModal').classList.add('hidden')};
  $('shareLinkBtn').onclick=sharePhoneLink;$('whatsappBtn').onclick=shareWhatsApp;$('copyLinkBtn').onclick=async()=>{if(!transferLink)transferLink=await makePhoneLink();try{await navigator.clipboard.writeText(transferLink);toast('Link gekopieerd. Stuur hem naar je telefoon.')}catch{prompt('Kopieer deze link:',transferLink)}};$('transferFileBtn').onclick=downloadTransfer;
  $('toggleSetup').onclick=()=>{const b=$('setupBody'),hide=!b.classList.contains('hidden');b.classList.toggle('hidden',hide);$('toggleSetup').textContent=hide?'Tonen':'Verbergen'};
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installBtn').classList.remove('hidden')});$('installBtn').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installBtn').classList.add('hidden')}};
  window.addEventListener('click',e=>{if(e.target.classList.contains('modal'))e.target.classList.add('hidden')});
}
async function init(){
  bind();render();currentView=sessionStorage.getItem('planyx-lite-view')||defaultView();setView(currentView,{remember:false});
  await receiveHash();if(location.hash.startsWith('#plan='))setView('route');
  window.matchMedia('(max-width: 760px)').addEventListener?.('change',()=>{if(!sessionStorage.getItem('planyx-lite-view'))setView(defaultView(),{remember:false})});
  setTimeout(()=>$('splash').classList.add('hide'),700);setTimeout(()=>$('splash').remove(),1200);if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{})
}
document.addEventListener('DOMContentLoaded',init);
})();
