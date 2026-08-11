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
const GEO_CACHE='planyx-lite-geocache-v2';
const MATRIX_CACHE='planyx-lite-matrix-cache-v1';
let lastTomTomCall=0;
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function loadGeoCache(){try{return JSON.parse(localStorage.getItem(GEO_CACHE)||'{}')}catch{return {}}}
function saveGeoCache(cache){try{localStorage.setItem(GEO_CACHE,JSON.stringify(cache))}catch{}}
function normalizeText(v){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ')}
function normalizePostal(v){return String(v??'').toUpperCase().replace(/\s+/g,'')}
async function tomtomJson(url,{retries=12,fetchOptions={}}={}){
  for(let attempt=0;;attempt++){
    const gap=2500-(Date.now()-lastTomTomCall);if(gap>0)await sleep(gap);lastTomTomCall=Date.now();
    const r=await fetch(url,fetchOptions);const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch{}
    if(r.ok)return j;
    const msg=j.errorText||j?.detailedError?.message||j?.message||text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()||`TomTom fout (${r.status})`;
    const limited=r.status===429||r.status===403&&/rate|volume|limit|exceeded|quota/i.test(msg)||/rate limit|too many requests|permitted rate|exceeded.*limit/i.test(msg);
    if(limited&&attempt<retries){const retryAfter=Number(r.headers.get('Retry-After'));const waits=[5000,8000,12000,18000,25000,35000,45000,60000,60000,60000,60000,60000];await sleep(Number.isFinite(retryAfter)&&retryAfter>0?Math.max(5000,retryAfter*1000):waits[Math.min(attempt,waits.length-1)]);continue}
    if(limited){const err=new Error('TomTom rate-limit bereikt.');err.code='TOMTOM_RATE_LIMIT';throw err;}
    if(r.status===403&&/matrix|entitl|forbidden|inactive|invalid|api key/i.test(msg)){const err=new Error('Deze TomTom API-key heeft geen toegang tot Matrix Routing v2. Controleer in TomTom Developer Portal of Matrix Routing voor deze key beschikbaar is.');err.code='TOMTOM_MATRIX_ACCESS';throw err;}
    throw new Error(msg||`TomTom fout (${r.status})`);
  }
}
function scoreGeocodeResult(result,expected={}){
  const a=result?.address||{};let score=Number(result?.score||0)/1000;
  const wantedPostal=normalizePostal(expected.postcode),gotPostal=normalizePostal(a.postalCode);
  if(wantedPostal&&gotPostal){score+=wantedPostal===gotPostal?100:-25}
  const wantedCity=normalizeText(expected.city);const gotCity=normalizeText([a.municipality,a.municipalitySubdivision,a.localName,a.freeformAddress].filter(Boolean).join(' '));
  if(wantedCity&&gotCity.includes(wantedCity))score+=30;
  const wantedStreet=normalizeText(expected.street);const gotStreet=normalizeText([a.streetName,a.freeformAddress].filter(Boolean).join(' '));
  if(wantedStreet&&gotStreet.includes(wantedStreet.split(/\s+\d/)[0]))score+=10;
  return score;
}
async function geocodeAddress(query,country,key,expected={}){
  const cache=loadGeoCache(),cacheKey=`${countryCode(country)}|${normalizeText(query)}|${normalizePostal(expected.postcode)}|${normalizeText(expected.city)}`;if(cache[cacheKey])return cache[cacheKey];
  const u=new URL(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(query)}.json`);u.searchParams.set('key',key);u.searchParams.set('limit','5');const cc=countryCode(country);if(cc)u.searchParams.set('countrySet',cc);const j=await tomtomJson(u);const results=Array.isArray(j.results)?j.results:[];if(!results.length)throw new Error(`Adres niet gevonden: ${query}`);
  const best=[...results].sort((a,b)=>scoreGeocodeResult(b,expected)-scoreGeocodeResult(a,expected))[0],p=best?.position;if(!p)throw new Error(`Adres niet gevonden: ${query}`);
  const found={lat:Number(p.lat),lon:Number(p.lon),freeform:best?.address?.freeformAddress||query,postalCode:best?.address?.postalCode||'',city:best?.address?.municipality||best?.address?.localName||''};cache[cacheKey]=found;saveGeoCache(cache);return found
}
function matrixCacheKey(points){return points.map(p=>`${Number(p.lat).toFixed(5)},${Number(p.lon).toFixed(5)}`).join('|')}
function loadMatrixCache(){try{return JSON.parse(localStorage.getItem(MATRIX_CACHE)||'{}')}catch{return {}}}
function saveMatrixCache(cache){try{const entries=Object.entries(cache).sort((a,b)=>(b[1]?.ts||0)-(a[1]?.ts||0)).slice(0,8);localStorage.setItem(MATRIX_CACHE,JSON.stringify(Object.fromEntries(entries)))}catch{}}
async function buildTravelMatrix(points,key,onProgress=()=>{}){
  const n=points.length;if(n<2)throw new Error('Te weinig punten voor routeoptimalisatie.');
  if(n>50)throw new Error('Voor de nauwkeurige routeoptimalisatie ondersteunt Planyx-lite maximaal 48 afleverstops per dag. Splits deze dag op.');
  const cache=loadMatrixCache(),ck=matrixCacheKey(points);if(cache[ck]?.times?.length===n){onProgress('Reistijdmatrix uit cache laden…');return cache[ck]}
  const times=Array.from({length:n},()=>Array(n).fill(Infinity)),distances=Array.from({length:n},()=>Array(n).fill(Infinity));for(let i=0;i<n;i++){times[i][i]=0;distances[i][i]=0}
  const maxCells=200,chunkSize=Math.max(1,Math.floor(maxCells/n));let requestNo=0,totalRequests=Math.ceil(n/chunkSize);
  for(let from=0;from<n;from+=chunkSize){const originIdx=[];for(let i=from;i<Math.min(n,from+chunkSize);i++)originIdx.push(i);requestNo++;onProgress(`Reistijden ophalen ${requestNo}/${totalRequests}…`);
    const body={origins:originIdx.map(i=>({point:{latitude:points[i].lat,longitude:points[i].lon}})),destinations:points.map(p=>({point:{latitude:p.lat,longitude:p.lon}})),options:{departAt:'any',traffic:'historical',routeType:'fastest',travelMode:'car'}};
    const u=new URL('https://api.tomtom.com/routing/matrix/2');u.searchParams.set('key',key);
    const j=await tomtomJson(u,{fetchOptions:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}});
    for(const cell of (j.data||[])){const gi=originIdx[Number(cell.originIndex)],dj=Number(cell.destinationIndex);if(!Number.isInteger(gi)||!Number.isInteger(dj)||gi<0||dj<0||dj>=n)continue;const sum=cell.routeSummary;if(sum){times[gi][dj]=Number(sum.travelTimeInSeconds);distances[gi][dj]=Number(sum.lengthInMeters)}}
  }
  const missing=[];for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j&&!Number.isFinite(times[i][j]))missing.push([i,j]);
  if(missing.length){throw new Error(`TomTom kon ${missing.length} verbinding(en) in de reistijdmatrix niet berekenen. Controleer de adressen en probeer opnieuw.`)}
  const result={times,distances,ts:Date.now()};cache[ck]=result;saveMatrixCache(cache);return result
}
function pathCost(order,times){if(!order.length)return times[0][times.length-1];let total=times[0][order[0]+1];for(let i=1;i<order.length;i++)total+=times[order[i-1]+1][order[i]+1];total+=times[order[order.length-1]+1][times.length-1];return total}
function greedyOrder(stopCount,times,forcedFirst=null){const left=new Set(Array.from({length:stopCount},(_,i)=>i)),order=[];let node=0;if(forcedFirst!=null&&left.has(forcedFirst)){order.push(forcedFirst);left.delete(forcedFirst);node=forcedFirst+1}while(left.size){let best=null,bestCost=Infinity;for(const s of left){const direct=times[node][s+1],toEnd=times[s+1][times.length-1];const score=direct+(left.size===1?toEnd:toEnd*.03);if(score<bestCost){bestCost=score;best=s}}if(best==null)break;order.push(best);left.delete(best);node=best+1}return order}
function improveMatrixOrder(seed,times){let best=[...seed],bestCost=pathCost(best,times);const n=best.length;for(let pass=0;pass<28;pass++){let move=null,moveCost=bestCost;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){if(i===j)continue;const cand=[...best],x=cand.splice(i,1)[0];cand.splice(j,0,x);const c=pathCost(cand,times);if(c+0.5<moveCost){move=cand;moveCost=c}}
    for(let i=0;i<n-1;i++)for(let j=i+1;j<n;j++){const cand=[...best];[cand[i],cand[j]]=[cand[j],cand[i]];const c=pathCost(cand,times);if(c+0.5<moveCost){move=cand;moveCost=c}}
    for(let i=0;i<n-1;i++)for(let j=i+1;j<n;j++){const cand=[...best.slice(0,i),...best.slice(i,j+1).reverse(),...best.slice(j+1)];const c=pathCost(cand,times);if(c+0.5<moveCost){move=cand;moveCost=c}}
    if(!move)break;best=move;bestCost=moveCost
  }return {order:best,cost:bestCost}}
function findBestMatrixOrder(stopCount,times){const original=Array.from({length:stopCount},(_,i)=>i),seeds=[original,greedyOrder(stopCount,times)];for(let first=0;first<stopCount;first++)seeds.push(greedyOrder(stopCount,times,first));const unique=new Map;for(const seed of seeds){if(seed.length===stopCount)unique.set(seed.join(','),seed)}const ranked=[...unique.values()].map(order=>({order,cost:pathCost(order,times)})).sort((a,b)=>a.cost-b.cost).slice(0,8);let best={order:original,cost:pathCost(original,times)};for(const seed of ranked){const improved=improveMatrixOrder(seed.order,times);if(improved.cost<best.cost)best=improved}return {original,originalCost:pathCost(original,times),...best}}
async function calculateFixedRoute(start,ordered,end,key,onProgress=()=>{}){
  onProgress('Definitieve route bij TomTom berekenen…');const points=[start,...ordered.map(s=>s.position),end],locs=points.map(p=>`${p.lat},${p.lon}`).join(':');const u=new URL(`https://api.tomtom.com/routing/1/calculateRoute/${locs}/json`);u.searchParams.set('key',key);u.searchParams.set('travelMode','car');u.searchParams.set('traffic','true');u.searchParams.set('routeType','fastest');u.searchParams.set('routeRepresentation','summaryOnly');const j=await tomtomJson(u);const route=j.routes?.[0];if(!route?.summary)throw new Error('TomTom kon de definitieve route niet berekenen.');return {summary:route.summary,legs:route.legs||[]}}
async function optimizeRouteByTravelTime(start,stops,end,key,onProgress=()=>{}){
  if(!start||!end)throw new Error('Start- of eindpunt ontbreekt.');if(!stops.length)return {ordered:[],summary:{lengthInMeters:0,travelTimeInSeconds:0},legs:[],changed:false,savedSeconds:0,beforeSummary:null};
  const points=[start,...stops.map(s=>s.position),end];onProgress('Echte reistijden tussen alle stops bepalen…');const matrix=await buildTravelMatrix(points,key,onProgress);onProgress('Beste stopvolgorde zoeken…');const best=findBestMatrixOrder(stops.length,matrix.times);const candidate=best.order.map(i=>stops[i]);const same=best.order.every((v,i)=>v===i);
  onProgress('Huidige route controleren…');const before=await calculateFixedRoute(start,stops,end,key,onProgress);if(same)return {ordered:[...stops],summary:before.summary,legs:before.legs,changed:false,savedSeconds:0,beforeSummary:before.summary,matrixBeforeSeconds:best.originalCost,matrixAfterSeconds:best.cost};
  onProgress('Geoptimaliseerde route controleren…');const after=await calculateFixedRoute(start,candidate,end,key,onProgress);const beforeSec=Number(before.summary.travelTimeInSeconds||0),afterSec=Number(after.summary.travelTimeInSeconds||0),beforeM=Number(before.summary.lengthInMeters||0),afterM=Number(after.summary.lengthInMeters||0);const faster=afterSec<beforeSec||afterSec===beforeSec&&afterM<beforeM;
  return faster?{ordered:candidate,summary:after.summary,legs:after.legs,changed:true,savedSeconds:Math.max(0,beforeSec-afterSec),beforeSummary:before.summary,matrixBeforeSeconds:best.originalCost,matrixAfterSeconds:best.cost}:{ordered:[...stops],summary:before.summary,legs:before.legs,changed:false,savedSeconds:0,beforeSummary:before.summary,matrixBeforeSeconds:best.originalCost,matrixAfterSeconds:best.cost}
}
function setBusy(msg){$('generateBtn').disabled=true;$('generateBtn').textContent=msg}
function clearBusy(){$('generateBtn').disabled=false;$('generateBtn').textContent='Genereer planning'}

async function importExcel(file){
  if(!window.XLSX)throw new Error('Excel-module is nog niet geladen. Controleer de internetverbinding en probeer opnieuw.');
  const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array',cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});
  if(!rows.length)throw new Error('Het bestand bevat geen gegevens.');
  const headers=Object.keys(rows[0]).map(x=>String(x).trim());const missing=REQUIRED.filter(h=>!headers.includes(h));if(missing.length)throw new Error('Ontbrekende kolommen: '+missing.join(', '));
  const stops=[];rows.forEach((r,i)=>{const deliveryDate=isoDate(r.delivery_date);if(!deliveryDate)return;stops.push({id:uid(r,i),d_name:String(r.d_name||'').trim(),d_phone:String(r.d_phone||'').trim(),d_address1:String(r.d_address1||'').trim(),d_zipcode:String(r.d_zipcode||'').trim(),d_city:String(r.d_city||'').trim(),d_country:String(r.d_country||'').trim(),delivery_date:deliveryDate,original_delivery_date:deliveryDate,visited:false,position:null,order:0,legKm:null,legMin:null})});
  if(!stops.length)throw new Error('Geen regels met een geldige delivery_date gevonden.');
  state={...defaultState(),sourceName:file.name,stops,startAddress:$('startAddress').value.trim(),sameEnd:$('sameEnd').checked,endAddress:$('sameEnd').checked?$('startAddress').value.trim():$('endAddress').value.trim()};
  buildDayShells();state.planningReady=false;saveState();$('importStatus').textContent=`${stops.length} afleveringen ingelezen uit ${file.name}. Klik op ‘Genereer planning’.`;render();
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
  state.planningReady=false;saveState();render();
  const key=$('tomtomKey').value.trim();if(!key)return toast('Vul je TomTom API-key in.');
  const start=$('startAddress').value.trim();if(!start)return toast('Vul een startadres in.');
  const same=$('sameEnd').checked,end=same?start:$('endAddress').value.trim();if(!end)return toast('Vul een eindadres in.');
  prefs={...prefs,tomtomKey:key,startAddress:start,endAddress:end,sameEnd:same};savePrefs();
  state.startAddress=start;state.endAddress=end;state.sameEnd=same;
  try{
    for(let run=0;run<3;run++){
      try{
        setBusy(run?'TomTom limiet hersteld · automatisch doorgaan…':'Startadres controleren…');
        state.startPoint=state.startPoint||await geocodeAddress(start,'',key);
        state.endPoint=same?state.startPoint:(state.endPoint||await geocodeAddress(end,'',key));saveState();
        const ungeocoded=state.stops.filter(s=>!s.position);let done=0;
        for(const s of ungeocoded){setBusy(`Adressen zoeken ${++done}/${ungeocoded.length}`);s.position=await geocodeAddress(addressOf(s),s.d_country,key,{postcode:s.d_zipcode,city:s.d_city,street:s.d_address1});saveState()}
        buildDayShells();const dates=Object.keys(state.days).sort();
        // Genereer alleen de dagplanning. Bewaar per dag de volgorde uit het Excel-bestand.
        for(const date of dates){
          const day=state.stops.filter(s=>s.delivery_date===date);
          day.forEach((s,i)=>{s.order=i+1;s.legKm=null;s.legMin=null});
          state.days[date]={date,generated:true,summary:{km:null,min:null,live:false,optimized:false,updatedAt:new Date().toISOString()}};
        }
        state.planningReady=true;saveState();render();setView('route');
        toast(`Planning gegenereerd voor ${dates.length} dag${dates.length===1?'':'en'}. Klik per dag op Optimaliseer route.`);return;
      }catch(e){
        if(e?.code==='TOMTOM_RATE_LIMIT'&&run<2){setBusy('TomTom limiet · automatisch langer wachten en doorgaan…');saveState();await sleep(run===0?30000:60000);continue}
        throw e;
      }
    }
  }catch(e){console.error(e);alert(e?.code==='TOMTOM_RATE_LIMIT'?'TomTom blijft de API-limiet blokkeren nadat Planyx-lite meerdere keren automatisch heeft gewacht. Reeds gevonden adressen zijn bewaard; probeer later nogmaals.':(e.message||String(e)))}finally{clearBusy()}
}

async function optimizeDay(date,key,onProgress=()=>{}){
  const all=state.stops.filter(s=>s.delivery_date===date),visited=all.filter(s=>s.visited).sort((a,b)=>a.order-b.order),remaining=all.filter(s=>!s.visited&&s.position).sort((a,b)=>(a.order||9999)-(b.order||9999));
  if(!key)throw new Error('Vul op dit apparaat eerst de TomTom API-key in via Import / Database.');
  if(!remaining.length){return {changed:false,savedSeconds:0,beforeSummary:null,afterSummary:null}}
  const routeStart=visited.length?visited[visited.length-1].position:state.startPoint;if(!routeStart||!state.endPoint)throw new Error('Start- of eindpunt ontbreekt. Genereer de planning opnieuw.');
  const result=await optimizeRouteByTravelTime(routeStart,remaining,state.endPoint,key,onProgress),combined=[...visited,...result.ordered];combined.forEach((s,i)=>s.order=i+1);
  result.ordered.forEach((s,i)=>{const leg=result.legs?.[i]?.summary;s.legKm=leg?Number(leg.lengthInMeters||0)/1000:null;s.legMin=leg?Number(leg.travelTimeInSeconds||0)/60:null});
  const totalKm=Number(result.summary?.lengthInMeters||0)/1000,totalMin=Number(result.summary?.travelTimeInSeconds||0)/60,beforeKm=Number(result.beforeSummary?.lengthInMeters||0)/1000,beforeMin=Number(result.beforeSummary?.travelTimeInSeconds||0)/60;
  state.days[date]={date,generated:true,summary:{km:totalKm,min:totalMin,live:true,optimized:true,changed:result.changed,beforeKm:Number.isFinite(beforeKm)?beforeKm:null,beforeMin:Number.isFinite(beforeMin)?beforeMin:null,savedMin:Number(result.savedSeconds||0)/60,algorithm:'tomtom-matrix-travel-time',updatedAt:new Date().toISOString()}};
  return {changed:result.changed,savedSeconds:result.savedSeconds,beforeSummary:result.beforeSummary,afterSummary:result.summary}
}
async function reoptimizeCurrent(){
  const d=state.selectedDay;if(!d)return;
  const key=prefs.tomtomKey||$('tomtomKey').value.trim();if(!key)return alert('Vul eerst de TomTom API-key in via Import / Database.');
  const btn=$('reoptimizeBtn'),oldText=btn.textContent;btn.disabled=true;const progress=msg=>{btn.textContent=msg};
  try{
    const beforeOrder=dayStops(d).map(s=>s.id).join('|');progress('Reistijden ophalen…');const outcome=await optimizeDay(d,key,progress);const afterOrder=dayStops(d).map(s=>s.id).join('|');saveState();render();
    const saved=Math.round(Number(outcome.savedSeconds||0)/60);
    if(beforeOrder!==afterOrder&&outcome.changed)toast(saved>0?`Route herschikt · ongeveer ${saved} min sneller.`:`Route is herschikt en geoptimaliseerd.`);
    else toast('Geen snellere volgorde gevonden; huidige route is behouden.');
  }catch(e){console.error(e);alert(e.message||String(e))}finally{btn.disabled=false;btn.textContent=oldText}
}

function dayStops(date){return state.stops.filter(s=>s.delivery_date===date).sort((a,b)=>(a.order||9999)-(b.order||9999))}
function navUrl(s){const q=encodeURIComponent(addressOf(s));if(prefs.navApp==='apple')return `https://maps.apple.com/?daddr=${q}&dirflg=d`;if(prefs.navApp==='waze')return `https://www.waze.com/ul?q=${q}&navigate=yes`;return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`}
function fullRouteUrl(){
  const stops=dayStops(state.selectedDay).filter(s=>!s.visited);if(!stops.length)return '';
  const origin=(state.startAddress||'').trim();
  const configuredEnd=(state.endAddress||'').trim();
  if(prefs.navApp==='google'){
    // Als er een apart eindadres is, zijn ALLE klanten tussenstops. Zonder eindadres is de laatste klant de bestemming.
    const destination=configuredEnd||addressOf(stops[stops.length-1]);
    const mids=(configuredEnd?stops:stops.slice(0,-1)).map(addressOf);
    // Google Maps URLs ondersteunen maximaal 9 waypoints. Nooit stilletjes klanten afkappen.
    if(mids.length>9)return {tooMany:true,count:mids.length,destination,origin};
    const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');if(origin)u.searchParams.set('origin',origin);u.searchParams.set('destination',destination);u.searchParams.set('travelmode','driving');if(mids.length)u.searchParams.set('waypoints',mids.join('|'));return {url:u.toString(),tooMany:false}
  }
  return ''
}
function openWholeRoute(){
  const stops=dayStops(state.selectedDay).filter(s=>!s.visited);if(!stops.length)return toast('Geen resterende stops.');
  if(prefs.navApp!=='google'){const name=prefs.navApp==='waze'?'Waze':'Apple Kaarten';alert(`${name} ondersteunt vanuit een webapp geen complete multi-stop route. Planyx-lite toont daarom de volledige volgorde zelf; gebruik Navigeren per stop. Kies Google Maps als je de dagroute met tussenstops in één kaart wilt openen.`);return}
  const result=fullRouteUrl();if(!result)return;
  if(result.tooMany){alert(`Deze dag heeft ${stops.length} resterende klanten. Google Maps kan via één gedeelde route maximaal 9 tussenstops verwerken. Planyx-lite kapt daarom geen klanten meer stilletjes af. Gebruik Navigeren per stop, of verdeel de route in delen.`);return}
  window.open(result.url,'_blank','noopener')
}
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
  if(state.stops.length&&!ready)$('importStatus').textContent=`${state.stops.length} afleveringen ingelezen${state.sourceName?' uit '+state.sourceName:''}. Klaar om planning te genereren.`;
  else if(state.stops.length&&ready)$('importStatus').textContent=`Planning gereed: ${state.stops.length} afleveringen verdeeld over ${Object.keys(state.days).length} dag(en).`;
}
function stopHtml(s,i){const km=s.legKm!=null?`${s.legKm.toFixed(1)} km vanaf vorige`:'';const phone=s.d_phone?`<a href="tel:${esc(s.d_phone)}">☎ Bellen</a>`:'';return `<article class="stopCard ${s.visited?'visited':''}" data-id="${esc(s.id)}"><div class="stopNo">${s.visited?'✓':(s.order||i+1)}</div><div class="stopInfo"><div class="stopName">${esc(s.d_name||'Naam onbekend')}</div><div class="stopAddress">${esc(s.d_address1)} · ${esc(s.d_zipcode)} ${esc(s.d_city)}</div><div class="stopMeta">${s.d_phone?`<span>☎ ${esc(s.d_phone)}</span>`:''}<span>${esc(s.d_country)}</span>${km?`<span>${km}</span>`:''}</div></div><div class="stopButtons"><a class="navigate" href="${navUrl(s)}" target="_blank" rel="noopener">Navigeren</a><button class="visitBtn ${s.visited?'active':''}" data-action="visit">${s.visited?'Bezocht ✓':'Bezocht'}</button><button class="moreBtn" data-action="more">•••</button></div><div class="stopMove"><button data-action="move">Naar andere dag</button><button data-action="up">↑ Omhoog</button><button data-action="down">↓ Omlaag</button></div></article>`}
function selectDay(delta){const ds=currentWeekDates();if(!ds.length)return;let i=Math.max(0,ds.indexOf(state.selectedDay));i=Math.max(0,Math.min(ds.length-1,i+delta));state.selectedDay=ds[i];saveState();render()}
function toggleVisit(id){const s=state.stops.find(x=>x.id===id);if(!s)return;s.visited=!s.visited;saveState();render()}
function manualMove(id,delta){const d=state.selectedDay,arr=dayStops(d),i=arr.findIndex(s=>s.id===id),j=i+delta;if(i<0||j<0||j>=arr.length)return;[arr[i].order,arr[j].order]=[arr[j].order||j+1,arr[i].order||i+1];state.days[d].summary={...state.days[d].summary,live:false,min:null};saveState();render()}
function moveToDate(id,date){const s=state.stops.find(x=>x.id===id);if(!s||!date)return;const old=s.delivery_date;s.delivery_date=date;s.visited=false;s.order=0;buildDayShells();for(const d of [old,date]){const arr=state.stops.filter(x=>x.delivery_date===d).sort((a,b)=>(a.order||9999)-(b.order||9999));arr.forEach((x,i)=>x.order=i+1);if(state.days[d])state.days[d].summary={...state.days[d].summary,km:null,min:null,live:false,optimized:false,changed:false}}state.selectedDay=old;saveState();render();toast(`Verplaatst naar ${formatDay(date,true)}. Optimaliseer de route opnieuw.`)}

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
