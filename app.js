/* payday.mcbflow.com · app script (MB Suite v3 shell).
   Calculation code (pay periods, overtime, take-home estimate) is unchanged from the original single-file app.
   Storage keys: 'payday' (data), 'payday.theme' (theme) and other 'payday.*' settings. */
(() => {
'use strict';
const KEY='payday';
const THEME_KEY='payday.theme';
const K_LAST='payday.lastBackup', K_FILE='payday.backupFile', K_WELCOME='payday.welcomed', K_TC='payday.timecard', K_PROBE='payday.probe';
const APP_DOMAIN='payday.mcbflow.com', OLD_DOMAIN='mbpayday.online', APP_VERSION='1.3', BACKUP_FORMAT=1;
const SAMPLE_JOB='Sample job', SAMPLE_NOTE='Sample record', LEGACY_DEMO='DEMO · Sample records';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const uid=()=>{try{if(crypto.randomUUID)return crypto.randomUUID().replace(/-/g,'').slice(0,16)}catch(e){}return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)};
const defaultState=()=>({version:1,settings:{jobName:'My job',hourlyRate:20,payFrequency:'biweekly',payday:5,weekStarts:1,otThreshold:40,otMultiplier:1.5,doubleThreshold:0,doubleMultiplier:2,shiftDiff:0,state:'NH',filing:'single',extraWithholding:0,pretaxDeductions:0,posttaxDeductions:0,workweekStart:'2026-01-05',currency:'USD',reminders:false},shifts:[],paystubs:[],jobs:[],activeShift:null,createdAt:new Date().toISOString()});
const META_KEYS=['app','format','appVersion','exportedAt'];

/* ---------------------------------------------------------------- storage (every write wrapped; failures show a banner) */
let storageOK=true;
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}}
function lsDel(k){try{localStorage.removeItem(k)}catch(e){}}
function probeStorage(){try{localStorage.setItem(K_PROBE,'1');localStorage.removeItem(K_PROBE);return true}catch(e){return false}}
function normalizeState(obj){
 const d=defaultState(),o=(obj&&typeof obj==='object')?obj:{};
 const out={...d,...o,settings:{...d.settings,...(o.settings&&typeof o.settings==='object'?o.settings:{})},shifts:Array.isArray(o.shifts)?o.shifts.filter(x=>x&&typeof x==='object'):[],paystubs:Array.isArray(o.paystubs)?o.paystubs.filter(x=>x&&typeof x==='object'):[],jobs:Array.isArray(o.jobs)?o.jobs.filter(x=>x&&typeof x==='object'&&x.name):[],activeShift:o.activeShift&&typeof o.activeShift==='object'?o.activeShift:null};
 META_KEYS.forEach(k=>delete out[k]);
 return out;
}
let state, loadNote='', SYNC=null;
{const raw=lsGet(KEY);
 if(raw==null)state=defaultState();
 else{try{state=normalizeState(JSON.parse(raw))}catch(e){lsSet('payday.unreadable',raw);state=defaultState();loadNote='Your saved data could not be read, so the app started empty. A copy of it was kept in this browser.'}}}
let page='home',editingId=null,editingJobId=null,formDirty=false,search='',tcJob=(()=>{try{return JSON.parse(lsGet(K_TC)||'{}').job||''}catch(e){return ''}})();

/* ---------------------------------------------------------------- jobs (unchanged logic) */
// Jobs: each job keeps its own name, rate, differential and active/past status. Shifts reference jobs by name.
function ensureJobs(){
 if(!Array.isArray(state.jobs))state.jobs=[];
 const s=state.settings,names=new Set(state.jobs.map(j=>j.name));
 const add=(name,rate,diff)=>{if(name&&!names.has(name)){state.jobs.push({id:uid(),name,rate:Number(rate)||0,differential:Number(diff)||0,active:true});names.add(name)}};
 if(!state.jobs.length)add(s.jobName||'My job',s.hourlyRate,s.shiftDiff);
 for(const sh of state.shifts)add(sh.job||s.jobName,sh.rate,sh.differential);
 for(const st of state.paystubs)add(st.employer,s.hourlyRate,0);
 for(const j of state.jobs){j.payFrequency??=s.payFrequency||'biweekly';j.weekStarts??=Number(s.weekStarts??1);if(j.anchor===undefined)j.anchor=s.workweekStart||'';j.payday??='';j.otThreshold??=Number(s.otThreshold??40);j.otMultiplier??=Number(s.otMultiplier??1.5)}
 if(!state.jobs.some(j=>j.name===s.jobName&&j.active))s.jobName=(state.jobs.find(j=>j.active)||state.jobs[0]).name;
}
ensureJobs();
function jobByName(n){return state.jobs.find(j=>j.name===n)}
function activeJobs(){return state.jobs.filter(j=>j.active)}
function jobOptions(selected,includePast=true){return (includePast?state.jobs:activeJobs()).map(j=>`<option value="${esc(j.name)}" ${j.name===selected?'selected':''}>${esc(j.name)}${j.active?'':' (past job)'}</option>`).join('')}
function syncDefaultJob(){const j=jobByName(state.settings.jobName);if(j){state.settings.hourlyRate=j.rate;state.settings.shiftDiff=j.differential||0}}
function jobSelect(label,name,value,includePast=true){return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${jobOptions(value,includePast)}</select></div>`}
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const FREQ={weekly:'Weekly',biweekly:'Every two weeks',semimonthly:'Twice a month',monthly:'Monthly'};

/* ---------------------------------------------------------------- pay math (unchanged from the original app) */
// Pay schedule + overtime rules for a job (falls back to the default job).
function jobCfg(name){const j=jobByName(name)||jobByName(state.settings.jobName)||state.jobs[0]||{};const n=(v,d)=>v===''||v==null||isNaN(Number(v))?d:Number(v);return {name:j.name,payFrequency:j.payFrequency||'biweekly',weekStarts:n(j.weekStarts,1),anchor:j.anchor||'',payday:j.payday||'',otThreshold:Math.max(0,n(j.otThreshold,40)),otMultiplier:Math.max(1,n(j.otMultiplier,1.5))}}
function nextPayday(name){const c=jobCfg(name);if(!c.payday||c.payFrequency==='semimonthly')return '';const t=today(),now=new Date(t+'T12:00:00'),p=new Date(c.payday+'T12:00:00');if(isNaN(p))return '';
 if(c.payFrequency==='monthly'){const day=p.getDate();for(let k=0;k<2;k++){const y=now.getFullYear(),mo=now.getMonth()+k,last=new Date(y,mo+1,0).getDate(),x=ymd(new Date(y,mo,Math.min(day,last)));if(x>=t)return x}return ''}
 const step=c.payFrequency==='weekly'?7:14,k=Math.ceil(Math.round((now-p)/86400000)/step);p.setDate(p.getDate()+k*step);return ymd(p)}
// Each job's current pay period, its shifts in that period, and totals.
function jobPeriods(date=today()){return state.jobs.map(j=>{const range=periodRange(date,j.name),shifts=state.shifts.filter(s=>(s.job||state.settings.jobName)===j.name&&inRange((s.start||'').slice(0,10),range.start,range.end));return {job:j,range,shifts,t:totals(shifts)}}).filter(p=>p.job.active||p.shifts.length)}
function rangeLabel(jp){const set=[...new Set(jp.filter(p=>p.shifts.length||p.job.name===state.settings.jobName).map(p=>p.range.start+'|'+p.range.end))];if(set.length===1){const [a,b]=set[0].split('|');return `${dateFmt(a)} – ${dateFmt(b)}`}return 'Varies by job'}
// Each employer withholds on its own paycheck, so take-home is estimated per job; deductions apply to the default job's check.
function periodNet(jp){const out={net:0,fed:0,stateTax:0,fica:0};for(const p of jp){const isDef=p.job.name===state.settings.jobName;if(!p.t.gross&&!isDef)continue;const n=estimateNet(p.t.gross,p.job.name,isDef);out.net+=n.net;out.fed+=n.fed;out.stateTax+=n.stateTax;out.fica+=n.fica}return out}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function money(n){try{return new Intl.NumberFormat('en-US',{style:'currency',currency:state.settings.currency||'USD'}).format(Number(n)||0)}catch(e){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0)}}
function dateFmt(s){if(!s)return '—';const d=new Date(s+'T12:00:00');return isNaN(d)?esc(s):d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
function dtLocalValue(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function toDate(s){if(!s)return null;let d=new Date(s);return isNaN(d)?null:d}
function hoursBetween(start,end){let a=toDate(start),b=toDate(end);return a&&b?Math.max(0,(b-a)/3600000):0}
function shiftHours(s){let raw=hoursBetween(s.start,s.end||new Date());return Math.max(0,raw-(Number(s.unpaidBreak)||0)/60)}
function weekStartDate(dateStr,starts=1){let d=new Date((dateStr||today())+'T12:00:00');let delta=(d.getDay()-Number(starts)+7)%7;d.setDate(d.getDate()-delta);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function weekEndFromStart(start){let d=new Date(start+'T12:00:00');d.setDate(d.getDate()+6);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function inRange(date,a,b){return date>=a&&date<=b}
function periodRange(date=today(),jobName=state.settings.jobName){const c=jobCfg(jobName),d=new Date(date+'T12:00:00'),y=d.getFullYear(),m=d.getMonth();let start,end;
 if(c.payFrequency==='weekly'){start=weekStartDate(date,c.weekStarts);end=weekEndFromStart(start)}
 else if(c.payFrequency==='biweekly'){const first=state.shifts.filter(s=>(s.job||state.settings.jobName)===c.name&&s.start).map(s=>s.start.slice(0,10)).sort()[0];const a=new Date((c.anchor||weekStartDate(first||date,c.weekStarts))+'T12:00:00');a.setDate(a.getDate()+Math.floor(Math.round((d-a)/86400000)/14)*14);start=ymd(a);a.setDate(a.getDate()+13);end=ymd(a)}
 else if(c.payFrequency==='monthly'){start=ymd(new Date(y,m,1));end=ymd(new Date(y,m+1,0))}
 else if(d.getDate()<=15){start=ymd(new Date(y,m,1));end=ymd(new Date(y,m,15))}else{start=ymd(new Date(y,m,16));end=ymd(new Date(y,m+1,0))}
 return {start,end};
}
function shiftPay(s){const settings=state.settings,c=jobCfg(s.job||settings.jobName);
 const h=shiftHours(s),rate=Number(s.rate??settings.hourlyRate)||0,diff=Number(s.differential??settings.shiftDiff)||0;
 const otLimit=c.otThreshold,mult=c.otMultiplier;
 // Federal-style weekly OT model: overtime is counted per employer, so only shifts for the same job in the same workweek are grouped.
 const week=weekStartDate((s.start||'').slice(0,10),c.weekStarts),jobKey=s.job||settings.jobName;
 const group=state.shifts.filter(x=>(x.job||settings.jobName)===jobKey&&weekStartDate((x.start||'').slice(0,10),c.weekStarts)===week).slice().sort((a,b)=>a.start.localeCompare(b.start));
 let before=0, regular=0, overtime=0;
 for(const x of group){let hx=shiftHours(x),lim=Math.max(0,otLimit-before),reg=Math.min(hx,lim),ot=Math.max(0,hx-reg);if(x.id===s.id){regular=reg;overtime=ot;break}before+=hx}
 if(!s.id){regular=Math.min(h,Math.max(0,otLimit-before));overtime=Math.max(0,h-regular)}
 const base=regular*rate, otPay=overtime*rate*mult, differential=h*diff;
 return {hours:h,regular,overtime,base,otPay,differential,gross:base+otPay+differential};
}
function totals(shifts){let hours=0,reg=0,ot=0,gross=0;for(const s of shifts){let p=shiftPay(s);hours+=p.hours;reg+=p.regular;ot+=p.overtime;gross+=p.gross}return {hours,reg,ot,gross}}
function allSorted(){return [...state.shifts].sort((a,b)=>(b.start||'').localeCompare(a.start||''))}
function periodShifts(range=periodRange()){return state.shifts.filter(s=>inRange((s.start||'').slice(0,10),range.start,range.end))}
function estimateNet(gross,jobName=state.settings.jobName,withDeductions=true){const s=state.settings,f=jobCfg(jobName).payFrequency,dd=withDeductions?1:0;const taxable=Math.max(0,gross-dd*(Number(s.pretaxDeductions)||0)); // coarse transparent estimate, not payroll-grade
 let fed=0,stateTax=0,fica=taxable*.0765;
 // Annualized rough progressive federal estimate using simplified 2025 single/other brackets, then per-period allocation.
 const annual=taxable*(f==='weekly'?52:f==='biweekly'?26:f==='semimonthly'?24:12);
 const single=s.filing==='married'?{std:31500,br:[23850,96750,206700,394600,501050,751600],rates:[.1,.12,.22,.24,.32,.35,.37]}:{std:15750,br:[11925,48475,103350,197300,250525,626350],rates:[.1,.12,.22,.24,.32,.35,.37]};
 let taxableAnnual=Math.max(0,annual-single.std),tax=0,prev=0;
 for(let i=0;i<single.br.length;i++){let amt=Math.max(0,Math.min(taxableAnnual,single.br[i])-prev);tax+=amt*single.rates[i];prev=single.br[i]}
 if(taxableAnnual>prev)tax+=(taxableAnnual-prev)*single.rates[single.rates.length-1];
 fed=tax/(f==='weekly'?52:f==='biweekly'?26:f==='semimonthly'?24:12);
 const stateRates={NH:0,AK:.02,FL:.02,NV:.02,SD:.02,TN:.02,TX:.02,WA:.02,WY:.02,CT:.045,MA:.05,ME:.05,NY:.055,NJ:.04,CA:.06,PA:.0307};
 stateTax=taxable*(stateRates[s.state]??.04);
 const net=Math.max(0,gross-fed-stateTax-fica-dd*((Number(s.extraWithholding)||0)+(Number(s.posttaxDeductions)||0)));
 return {net,fed,stateTax,fica,taxable,disclaimer:'Rough planning estimate. Simplified federal brackets and state-rate assumptions; not a payroll or tax filing calculation.'};
}
function fmtHours(h){return `${(Math.round(h*100)/100).toFixed(2)} h`}
function activeHours(){if(!state.activeShift)return 0;return shiftHours(state.activeShift)}

/* ---------------------------------------------------------------- small render helpers */
const ic=(id,cls='uic')=>`<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
function field(label,name,value,type='text',opts={}){return `<div class="field ${opts.full?'full':''}"><label for="${name}">${label}</label>${type==='select'?`<select id="${name}" name="${name}">${opts.options.map(o=>`<option value="${esc(o[0])}" ${String(value)===String(o[0])?'selected':''}>${esc(o[1])}</option>`).join('')}</select>`:type==='textarea'?`<textarea id="${name}" name="${name}" ${opts.required?'required':''}>${esc(value)}</textarea>`:`<input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${opts.step?`step="${opts.step}"`:''} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.required?'required':''} ${opts.placeholder?`placeholder="${esc(opts.placeholder)}"`:''}>`}</div>`}
function viewHead(title,desc,actions=''){return `<div class="view-head"><div class="vh-txt"><h2>${title}</h2><p>${desc}</p></div>${actions?`<div class="actions no-print">${actions}</div>`:''}</div>`}
function stat(label,value,sub='',cls=''){return `<div class="card ${cls}"><div class="statlabel">${label}</div><div class="stat">${value}</div><div class="sub">${sub}</div></div>`}
const art=id=>`<span data-art="${id}"></span>`;
function emptyState(title,why,action=''){return `<div class="empty">${art('artEmpty')}<b>${title}</b><p>${why}</p>${action}</div>`}
const isSampleShift=s=>!!(s&&(s.sample||String(s.notes||'').startsWith(LEGACY_DEMO)));
const isSampleStub=p=>!!(p&&(p.sample||String(p.notes||'').startsWith(LEGACY_DEMO)));
const sampleTag=on=>on?' <span class="tag accent">Sample</span>':'';
function hasSample(){return state.shifts.some(isSampleShift)||state.paystubs.some(isSampleStub)}
function hasData(){return state.shifts.length>0||state.paystubs.length>0}
function timeFmt(dt,refDay){const d=toDate(dt);if(!d)return esc(dt||'');const t=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});return refDay&&String(dt).slice(0,10)!==refDay?`${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}, ${t}`:t}
const hrsWords=h=>(Math.round(h*100)/100).toLocaleString('en-US',{maximumFractionDigits:2});

/* ---------------------------------------------------------------- persistence */
function save(){const ok=lsSet(KEY,JSON.stringify(state));if(ok!==storageOK){storageOK=ok;$('#storeBanner').hidden=ok}if(SYNC)SYNC.changed();return ok}

/* ---------------------------------------------------------------- toasts (success ~4s, Undo ~6s) */
function toast(msg,undo,label='Undo'){
 const host=$('#toasts'),t=document.createElement('div');t.className='toast';
 const span=document.createElement('span');span.textContent=msg;t.appendChild(span);
 if(undo){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{t.remove();undo()};t.appendChild(b)}
 host.innerHTML='';host.appendChild(t);
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.remove(),undo?6000:4000);
}
const notify=msg=>toast(msg);

/* ---------------------------------------------------------------- theme */
function applyTheme(theme,remember=true){theme=theme==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;if(remember)lsSet(THEME_KEY,theme);
 const b=$('#themeBtn');b.setAttribute('aria-checked',String(theme==='dark'));
 $$('[data-theme-pick]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.themePick===theme)))}

/* ---------------------------------------------------------------- dialogs */
let lastFocus=null;
function openDlg(d){lastFocus=document.activeElement;if(!d.open)d.showModal()}
function closeDlg(d){if(d.open)d.close();if(lastFocus&&document.contains(lastFocus))try{lastFocus.focus()}catch(e){}}
// One confirm dialog for the whole app: names what's lost, Cancel is focused, optional "Save backup first".
function askConfirm({title,body,ok='Delete',danger=true,backup=false,cancel='Cancel'}){
 return new Promise(res=>{const d=$('#confirmDlg');$('#confirmTitle').textContent=title;$('#confirmBody').textContent=body;
  const okb=$('#confirmOk');okb.textContent=ok;okb.className='btn '+(danger?'danger solid':'primary');$('#confirmCancel').textContent=cancel;$('#confirmBackupRow').hidden=!backup;
  const done=v=>{d.onclose=null;closeDlg(d);res(v)};
  okb.onclick=()=>done(true);$('#confirmCancel').onclick=()=>done(false);d.onclose=()=>{d.onclose=null;res(false)};
  $('#confirmBackup').onclick=()=>saveNow();
  openDlg(d);$('#confirmCancel').focus()})}
async function guardLeave(){if(!formDirty)return true;const ok=await askConfirm({title:'Discard changes?',body:'You have unsaved changes in this form.',ok:'Discard',cancel:'Keep editing'});if(ok)formDirty=false;return ok}

/* ---------------------------------------------------------------- navigation */
const VIEWS={home:'Overview',timecard:'Timecard',pay:'Pay calculator',paystubs:'Paycheck check',reports:'Reports',settings:'Settings'};
async function go(v,opts={}){if(!VIEWS[v])v='home';if(v!==page||opts.force){if(!(await guardLeave()))return;editingId=null;editingJobId=null}page=v;render();if(!opts.keepScroll)window.scrollTo(0,0)}

function render(){
 formDirty=false;
 $$('[data-view]').forEach(b=>{if(b.dataset.view===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 const more=$('#moreBtn');if(['reports','settings'].includes(page))more.setAttribute('aria-current','page');else more.removeAttribute('aria-current');
 $('#pageTitle').textContent=VIEWS[page];MBTitle.set(VIEWS[page]);
 const cs=$('[data-count=shifts]'),cp=$('[data-count=stubs]');cs.textContent=state.shifts.length||'';cp.textContent=state.paystubs.length||'';
 $('#searchWrap').hidden=page!=='timecard';
 $('#settingsTail').hidden=page!=='settings';
 $('#pageCsvSub').textContent=page==='paystubs'?'Paystubs on this page, for Excel or Sheets':page==='timecard'&&(search||tcJob)?'The shifts shown, for Excel or Sheets':'Shifts, for Excel or Sheets';
 $('#dmRemoveSample').hidden=!hasSample();
 updateClockButton();
 const main=$('#view');
 main.innerHTML=({home:renderHome,timecard:renderTimecard,pay:renderPay,paystubs:renderPaystubs,reports:renderReports,settings:renderSettings}[page]||renderHome)();
 $$('[data-art]',main).forEach(el=>{const t=document.getElementById(el.dataset.art);if(t)el.replaceWith(t.content.firstElementChild.cloneNode(true))});
 bindPage();
 if(page==='settings')MBInstall.render();
 updateBackupUI();tick();
}
function updateClockButton(){const b=$('#headerClock');b.querySelector('use').setAttribute('href',state.activeShift?'#i-stop':'#i-clock');$('#headerClockText').textContent=state.activeShift?'Clock out':'Clock in';$('#headerClockAmt').textContent=state.activeShift?` · ${money(shiftPay(state.activeShift).gross)}`:'';b.setAttribute('aria-label',state.activeShift?'Clock out':'Clock in')}

/* ---------------------------------------------------------------- views */
function renderHome(){
 const jp=jobPeriods(),ps=jp.flatMap(p=>p.shifts),t=totals(ps),net=periodNet(jp),rl=rangeLabel(jp),ws=jobCfg().weekStarts,np=nextPayday(state.settings.jobName),week=periodShifts({start:weekStartDate(today(),ws),end:weekEndFromStart(weekStartDate(today(),ws))}),wt=totals(week),recent=allSorted().slice(0,5);
 const subBits=[`Pay period ${rl}`,`${week.length} shift${week.length===1?'':'s'} this week`];if(np)subBits.push(`next payday ${dateFmt(np)}`);
 return `<section class="cu-banner">${art('artBanner')}<div class="cu-txt"><h2 class="cu-t">Track your hours. Check your pay.</h2><p class="cu-s">${hasData()?subBits.join(' · '):'Clock in or add a shift to get started.'}</p></div></section>
 ${loadNote?`<div class="notice warn">${ic('warn')}<div>${esc(loadNote)}</div></div>`:''}
 ${hasSample()?`<div class="notice accent">${ic('info')}<div>You're looking at sample data. It's labeled <span class="tag accent">Sample</span> everywhere it shows up. <button type="button" class="linkbtn" data-action="removeSample">Remove sample data</button></div></div>`:''}
 ${state.activeShift?`<div class="notice good">${ic('clock')}<div><strong>Shift in progress</strong> · Started ${new Date(state.activeShift.start).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · ${esc(state.activeShift.job)} · Earned so far: <strong data-live-earn>${money(shiftPay(state.activeShift).gross)}</strong>. Remember to clock out when you finish.</div></div>`:''}
 <div class="cards">${stat('Hours this pay period',fmtHours(t.hours),rl,'cu-hero')}${stat('Estimated gross',money(t.gross),`${fmtHours(t.reg)} regular · ${fmtHours(t.ot)} overtime`)}${stat('Estimated take-home',money(net.net),'Rough estimate after modeled deductions')}${stat('Hours this week',fmtHours(wt.hours),`${fmtHours(wt.ot)} overtime hours`)}</div>
 <div class="grid2">
 <section class="panel"><div class="panelhead"><h3>Time clock</h3><span class="tag ${state.activeShift?'good':''}">${state.activeShift?'In progress':'Ready'}</span></div>
 <div class="bigclock" id="liveClock">--:--</div><div class="muted">${dateFmt(today())} · ${esc(state.activeShift?state.activeShift.job:state.settings.jobName)}</div>
 ${state.activeShift?`<div class="divider"></div><div class="statlabel">Earned this shift</div><div class="bigclock accent" data-live-earn>${money(shiftPay(state.activeShift).gross)}</div><div class="sub" id="liveRate">${money(Number(state.activeShift.rate)+(Number(state.activeShift.differential)||0))}/hr</div>`:activeJobs().length>1?`<div class="field sectiongap"><label for="clockJob">Clock in to</label><select id="clockJob">${jobOptions(state.settings.jobName,false)}</select></div>`:''}
 <div class="actions"><button type="button" class="btn primary" data-action="clock">${ic(state.activeShift?'stop':'play')}${state.activeShift?'Clock out':'Clock in'}</button><button type="button" class="btn" data-action="newshift">Enter a past shift</button></div>
 <div class="divider"></div><div class="resultline"><span class="muted">Pay period</span><strong>${rl}</strong></div>${np?`<div class="resultline"><span class="muted">Next payday</span><strong>${dateFmt(np)}</strong></div>`:''}<div class="resultline"><span class="muted">Regular earnings</span><strong>${money(t.base||ps.reduce((n,s)=>n+shiftPay(s).base,0))}</strong></div><div class="resultline"><span class="muted">Overtime earnings</span><strong>${money(ps.reduce((n,s)=>n+shiftPay(s).otPay,0))}</strong></div>
 ${jp.filter(p=>p.shifts.length).length>1?`<div class="divider"></div><div class="statlabel">This period by job</div>${jp.filter(p=>p.shifts.length).map(p=>`<div class="resultline"><span>${esc(p.job.name)} <span class="sub">· ${fmtHours(p.t.hours)} · ${dateFmt(p.range.start)} – ${dateFmt(p.range.end)}</span></span><strong>${money(p.t.gross)}</strong></div>`).join('')}`:''}
 </section>
 <section class="panel"><div class="panelhead"><h3>Recent shifts</h3>${recent.length?`<button type="button" class="btn sm" data-goto="timecard">View all</button>`:''}</div>
 ${recent.length?`<div>${recent.map(s=>{const p=shiftPay(s);return `<div class="resultline"><div><strong>${dateFmt((s.start||'').slice(0,10))}</strong>${sampleTag(isSampleShift(s))}<div class="sub">${esc(s.job||state.settings.jobName)} · ${fmtHours(p.hours)}</div></div><strong>${money(p.gross)}</strong></div>`}).join('')}</div>`:emptyState('No shifts yet','Clock in or add a past shift, and your pay period fills in here.',`<button type="button" class="btn primary" data-action="newshift">${ic('plus')}Add shift</button><p class="hint">Just looking? <button type="button" class="linkbtn" data-action="sample">Try it with sample data</button></p>`)}
 <div class="divider"></div><div class="panelhead"><h3>Paycheck forecast</h3><span class="tag warn">Estimate</span></div><div class="bigclock">${money(net.net)}</div><div class="sub">Estimated take-home for this pay period, before any deductions you haven't set up.</div><div class="actions"><button type="button" class="btn" data-goto="pay">See the math</button><button type="button" class="btn" data-goto="paystubs">Check a paystub</button></div>
 </section></div>
 <section class="panel sectiongap"><div class="panelhead"><h3>Quick reminders</h3></div><div class="twocol"><div><strong>Keep records complete</strong><p class="sub">Check for missed clock-outs and breaks before payday.</p></div><div><strong>Back up your data</strong><p class="sub">Your records live only in this browser. Clearing browser data or some device settings can erase them.</p><button type="button" class="btn sm" data-action="saveNow">${ic('save')}Save backup now</button></div></div></section>`;
}
function filteredShifts(){const q=search.trim().toLowerCase();return allSorted().filter(s=>{if(tcJob&&(s.job||state.settings.jobName)!==tcJob)return false;if(!q)return true;const hay=[s.job||state.settings.jobName,s.notes,s.start,dateFmt((s.start||'').slice(0,10))].join(' ').toLowerCase();return hay.includes(q)})}
function shiftTable(){
 const all=state.shifts.length,shifts=filteredShifts(),filt=!!(search.trim()||tcJob);
 if(!all)return emptyState('No shifts recorded','Add a shift by hand or clock in from the Overview. Hours, overtime and pay are figured for you.',`<button type="button" class="btn primary" data-action="newshift">${ic('plus')}Add shift</button>`);
 if(!shifts.length)return `<div class="empty"><b>No shifts match${search.trim()?` "${esc(search.trim())}"`:''}${tcJob?` for ${esc(tcJob)}`:''}</b><p>Try a different search or show every job.</p><button type="button" class="btn" data-action="clearFilters">Clear filters</button></div>`;
 return `${filt?`<p class="hint">Showing ${shifts.length} of ${all} shifts. <button type="button" class="linkbtn" data-action="clearFilters">Clear filters</button></p>`:''}<div class="tablewrap sectiongap"><table><thead><tr><th scope="col">Date</th><th scope="col">Job</th><th scope="col">Start</th><th scope="col">End</th><th scope="col">Break</th><th scope="col">Hours</th><th scope="col">OT</th><th scope="col" class="right">Gross</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${shifts.map(s=>{let p=shiftPay(s);const day=(s.start||'').slice(0,10),dl=dateFmt(day);return `<tr><td>${dl}${sampleTag(isSampleShift(s))}</td><td>${esc(s.job||state.settings.jobName)}</td><td>${timeFmt(s.start)}</td><td>${s.end?timeFmt(s.end,day):'<span class="tag good">Active</span>'}</td><td>${Number(s.unpaidBreak)||0}m</td><td>${fmtHours(p.hours)}</td><td>${fmtHours(p.overtime)}</td><td class="right">${money(p.gross)}</td><td><div class="rowacts"><button type="button" class="btn sm" data-action="editShift" data-id="${esc(s.id)}" aria-label="Edit shift on ${dl}">Edit</button><button type="button" class="btn sm danger" data-action="deleteShift" data-id="${esc(s.id)}" aria-label="Delete shift on ${dl}">Delete</button></div></td></tr>`}).join('')}</tbody></table></div>`;
}
function renderTimecard(){
 const jp=jobPeriods(),cur=totals(jp.flatMap(p=>p.shifts)),shifts=allSorted();let edit=editingId?(state.shifts.find(s=>s.id===editingId)||{}):null;
 return `${viewHead('Timecard','Record shifts, breaks, different rates and corrections.',`<button type="button" class="btn primary" data-action="newshift">${ic('plus')}Add shift</button>`)}
 <div class="cards">${stat('Total recorded',fmtHours(totals(shifts).hours),`${shifts.length} shift entries`)}${stat('This pay period',fmtHours(cur.hours),rangeLabel(jp))}${stat('Regular hours',fmtHours(cur.reg),'Figured by workweek')}${stat('Overtime hours',fmtHours(cur.ot),'Using each job\'s overtime rule')}</div>
 ${edit?`<section class="panel sectiongap subform"><div class="panelhead"><h3 id="shiftFormTitle">${edit.id?'Edit shift':'New shift'}</h3></div>${shiftForm(edit)}</section>`:''}
 <section class="panel sectiongap"><div class="panelhead"><h3>All shifts</h3><div class="actions" style="margin:0">${state.jobs.length>1?`<label class="sr" for="tcJob">Show job</label><select class="fsel" id="tcJob"><option value="">All jobs</option>${state.jobs.map(j=>`<option value="${esc(j.name)}" ${j.name===tcJob?'selected':''}>${esc(j.name)}</option>`).join('')}</select>`:''}</div></div>
 <div class="phone-search"><div class="searchbox">${ic('search')}<input id="searchPhone" type="search" placeholder="Search shifts" aria-label="Search shifts" autocomplete="off" value="${esc(search)}"></div></div>
 <div id="shiftTable">${shiftTable()}</div>
 <p class="hint">Overtime is split by time order within each workweek. Check your employer's workweek and the pay rules that apply to you.</p></section>`;
}
function shiftForm(s={}){const now=dtLocalValue();return `<form id="shiftForm" novalidate><input type="hidden" name="id" value="${esc(s.id||'')}"><div class="fieldgrid">
 ${field('Work date &amp; start','start',s.start||now,'datetime-local',{required:true,step:'1'})}
 <div class="field"><label for="end">End date &amp; time</label><input id="end" name="end" type="datetime-local" value="${esc(s.end||now)}" step="1" aria-describedby="endErr"><p class="err" id="endErr" hidden>End time must be after the start time.</p></div>
 ${jobSelect('Job','job',s.job||state.settings.jobName)}
 ${field('Hourly rate ($)','rate',s.rate??(jobByName(s.job||state.settings.jobName)?.rate??state.settings.hourlyRate),'number',{step:'0.01',min:0,required:true})}
 ${field('Unpaid break (minutes)','unpaidBreak',s.unpaidBreak??0,'number',{step:'1',min:0})}
 ${field('Extra hourly differential ($)','differential',s.differential??(jobByName(s.job||state.settings.jobName)?.differential??state.settings.shiftDiff),'number',{step:'0.01',min:0})}
 ${field('Notes','notes',s.notes||'','textarea',{full:true})}
 </div><div class="formactions"><button type="button" class="btn" data-action="cancelEdit">Cancel</button><button class="btn primary" type="submit">Save shift</button></div></form>`}
function renderPay(){
 const jp=jobPeriods(),ps=jp.flatMap(p=>p.shifts),t=totals(ps),net=periodNet(jp),s=state.settings,dc=jobCfg();
 return `${viewHead('Pay calculator','Estimate earnings, overtime, deductions and take-home pay.')}
 <div class="notice warn">${ic('warn')}<div>Estimates only. Tax withholding is simplified and may differ from your payroll. Check the overtime rules, regular-rate rules and state requirements that apply to you. This isn't tax, payroll or legal advice.</div></div>
 <div class="cards">${stat('Gross this period',money(t.gross),rangeLabel(jp))}${stat('Estimated take-home',money(net.net),'After modeled deductions')}${stat('Regular / OT',`${fmtHours(t.reg)} / ${fmtHours(t.ot)}`,'Hours from recorded shifts')}${stat('Effective gross rate',money(t.hours?t.gross/t.hours:0),'Gross divided by all recorded hours')}</div>
 <div class="twocol"><section class="panel"><h3>Pay breakdown</h3><div class="resultline"><span>Regular earnings</span><strong>${money(ps.reduce((n,x)=>n+shiftPay(x).base,0))}</strong></div><div class="resultline"><span>Overtime earnings</span><strong>${money(ps.reduce((n,x)=>n+shiftPay(x).otPay,0))}</strong></div><div class="resultline"><span>Shift differentials</span><strong>${money(ps.reduce((n,x)=>n+shiftPay(x).differential,0))}</strong></div><div class="resultline"><strong>Estimated gross</strong><strong>${money(t.gross)}</strong></div><div class="divider"></div><div class="resultline"><span>Federal withholding (rough)</span><strong>−${money(net.fed)}</strong></div><div class="resultline"><span>State estimate (${esc(s.state)})</span><strong>−${money(net.stateTax)}</strong></div><div class="resultline"><span>Social Security + Medicare estimate</span><strong>−${money(net.fica)}</strong></div><div class="resultline"><span>Pre-tax deductions</span><strong>−${money(s.pretaxDeductions)}</strong></div><div class="resultline"><span>Extra withholding + post-tax deductions</span><strong>−${money((Number(s.extraWithholding)||0)+(Number(s.posttaxDeductions)||0))}</strong></div><div class="divider"></div><div class="resultline"><strong>Estimated take-home</strong><strong>${money(net.net)}</strong></div><p class="hint">Rough planning estimate, figured per job paycheck. Deductions apply to your default job's check. Not a payroll or tax filing calculation.</p></section>
 <section class="panel"><h3>What-if calculator</h3><form id="whatifForm" novalidate><div class="fieldgrid">${field('Extra regular hours','extraHours',5,'number',{min:0,step:.25})}${field('Extra overtime hours','extraOT',0,'number',{min:0,step:.25})}${field('Hourly rate ($)','whatRate',jobByName(s.jobName)?.rate??s.hourlyRate,'number',{min:0,step:.01})}${field('Overtime multiplier','whatMult',dc.otMultiplier,'number',{min:1,step:.1})}</div><div class="actions"><button class="btn primary" type="submit">Calculate</button></div></form><div id="whatifResult" class="sectiongap" aria-live="polite"></div><div class="divider"></div><h3>Pay periods</h3>${jp.map(p=>{const c=jobCfg(p.job.name),np=nextPayday(p.job.name);return `<div class="resultline"><div><strong>${esc(p.job.name)}</strong><div class="sub">${FREQ[c.payFrequency]} · OT after ${c.otThreshold}h at ${c.otMultiplier}×${np?` · next payday ${dateFmt(np)}`:''}</div></div><strong>${dateFmt(p.range.start)} – ${dateFmt(p.range.end)}</strong></div>`}).join('')}<p class="hint">Set each job's pay schedule and overtime rule in Settings → Jobs → Edit.</p></section></div>`;
}
function renderPaystubs(){
 let edit=editingId?(state.paystubs.find(x=>x.id===editingId)||{}):null;
 const rows=state.paystubs.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 return `${viewHead('Paycheck check','Compare your own records with the figures on a real paystub.',`<button type="button" class="btn primary" data-action="newstub">${ic('plus')}Add paystub</button>`)}
 <div class="notice">${ic('info')}<div>A difference is a reason to review your hours, pay period, rates and deductions. It isn't proof of an error or a wage violation. Comparing gross pay usually tells you more than comparing estimated net pay with a bank deposit.</div></div>
 ${edit?`<section class="panel sectiongap subform"><div class="panelhead"><h3>${edit.id?'Edit paystub':'Add paystub'}</h3></div>${stubForm(edit)}</section>`:''}
 ${rows.map(stub=>{let range={start:stub.start,end:stub.end},t=totals(periodShifts(range).filter(s=>(s.job||state.settings.jobName)===stub.employer)),diff=Number(stub.actualGross)-t.gross;return `<section class="panel sectiongap"><div class="panelhead"><div><h3>${esc(stub.employer||'Paycheck')} · ${dateFmt(stub.date)}${sampleTag(isSampleStub(stub))}</h3><div class="sub">${dateFmt(stub.start)} – ${dateFmt(stub.end)}</div></div><span class="tag ${Math.abs(diff)<.02?'good':'warn'}">${Math.abs(diff)<.02?'Gross matches':`${diff<0?'Actual lower':'Actual higher'} by ${money(Math.abs(diff))}`}</span></div><div class="cards">${stat('Logged gross',money(t.gross),'From your saved shifts')}${stat('Actual gross',money(stub.actualGross),'Entered from the paystub')}${stat('Gross difference',money(diff),'Actual minus logged estimate')}${stat('Actual net',money(stub.actualNet),'Your deposit may differ from net pay')}</div>${stub.notes?`<p class="sub">${esc(stub.notes)}</p>`:''}<div class="actions"><button type="button" class="btn sm" data-action="editStub" data-id="${esc(stub.id)}">Edit</button><button type="button" class="btn sm danger" data-action="deleteStub" data-id="${esc(stub.id)}">Delete</button></div></section>`}).join('')}
 ${!rows.length&&!edit?`<section class="panel">${emptyState('No paystubs yet','Add the gross and net pay from a real paystub to compare it with your time records.',`<button type="button" class="btn primary" data-action="newstub">${ic('plus')}Add paystub</button>`)}</section>`:''}
 <section class="panel sectiongap"><h3>Entering paystubs</h3><p class="muted">Type in the figures from your paystub. The app doesn't read PDF paystubs, and it's best not to upload payroll documents to outside converter sites.</p></section>`;
}
function stubForm(s={}){return `<form id="stubForm" novalidate><input type="hidden" name="id" value="${esc(s.id||'')}"><div class="fieldgrid">${jobSelect('Job this paycheck is from','employer',s.employer||state.settings.jobName)}${field('Pay date','date',s.date||today(),'date',{required:true})}${field('Period start','start',s.start||periodRange(today(),s.employer).start,'date',{required:true})}${field('Period end','end',s.end||periodRange(today(),s.employer).end,'date',{required:true})}${field('Actual gross pay ($)','actualGross',s.actualGross??0,'number',{step:.01,min:0,required:true})}${field('Actual net pay ($)','actualNet',s.actualNet??0,'number',{step:.01,min:0})}${field('Notes or questions','notes',s.notes||'','textarea',{full:true})}</div><div class="formactions"><button type="button" class="btn" data-action="cancelEdit">Cancel</button><button class="btn primary" type="submit">Save paystub</button></div></form>`}
/* last finished pay period for the default job (for the share card) */
function lastPeriod(){const name=state.settings.jobName,cur=periodRange(today(),name),d=new Date(cur.start+'T12:00:00');d.setDate(d.getDate()-1);const range=periodRange(ymd(d),name),shifts=state.shifts.filter(s=>(s.job||name)===name&&inRange((s.start||'').slice(0,10),range.start,range.end));return {name,range,shifts,t:totals(shifts)}}
function renderReports(){
 const all=allSorted(),month=today().slice(0,7),monthly=state.shifts.filter(s=>(s.start||'').slice(0,7)===month),mt=totals(monthly),year=today().slice(0,4),annual=state.shifts.filter(s=>(s.start||'').slice(0,4)===year),yt=totals(annual);
 const byJob={};state.shifts.forEach(s=>{let j=s.job||state.settings.jobName;byJob[j]??={hours:0,gross:0,shifts:0};let p=shiftPay(s);byJob[j].hours+=p.hours;byJob[j].gross+=p.gross;byJob[j].shifts++});
 const monthsGross=Array.from({length:12},(_,j)=>totals(state.shifts.filter(s=>(s.start||'').slice(0,4)===year&&(s.start||'').slice(5,7)===String(j+1).padStart(2,'0'))).gross),max=Math.max(1,...monthsGross);
 const lp=lastPeriod();
 return `${viewHead('Reports','Your work history and earnings over time.')}
 <div class="cards">${stat('This month',money(mt.gross),`${fmtHours(mt.hours)} recorded hours`)}${stat('Year to date',money(yt.gross),`${fmtHours(yt.hours)} recorded hours`)}${stat('Total shifts',String(all.length),'All saved entries')}${stat('Paystubs logged',String(state.paystubs.length),'Actual checks recorded')}</div>
 <div class="twocol"><section class="panel"><h3>By job</h3>${Object.keys(byJob).length?Object.entries(byJob).map(([j,x])=>`<div class="resultline"><div><strong>${esc(j)}</strong><div class="sub">${x.shifts} shifts · ${fmtHours(x.hours)}</div></div><strong>${money(x.gross)}</strong></div>`).join(''):emptyState('Nothing to report yet','Your hours and earnings by job show up here once you record shifts.',`<button type="button" class="btn" data-goto="timecard">Go to Timecard</button>`)}</section>
 <section class="panel"><h3>Monthly earnings · ${year}</h3>${monthsGross.map((gross,i)=>`<div class="mrow"><span class="sub">${new Date(Number(year),i,1).toLocaleDateString('en-US',{month:'short'})}</span><div class="progress" role="img" aria-label="${new Date(Number(year),i,1).toLocaleDateString('en-US',{month:'long'})}: ${money(gross)}"><span data-w="${gross/max*100}"></span></div><strong>${money(gross)}</strong></div>`).join('')}</section></div>
 <section class="panel sectiongap"><div class="panelhead"><h3>Share your progress</h3></div><p class="muted">Make an image of a finished pay period or your year so far. Pay amounts and job names stay off the image unless you turn them on.</p>
 ${lp.shifts.length?`<div class="resultline"><div><strong>Last pay period: ${hrsWords(lp.t.hours)} hours</strong><div class="sub">${dateFmt(lp.range.start)} – ${dateFmt(lp.range.end)} · ${lp.shifts.length} shift${lp.shifts.length===1?'':'s'}</div></div><button type="button" class="btn sm mb-share-btn" data-action="sharePeriod">${ic('share')}Share</button></div>`:''}
 ${annual.length?`<div class="resultline"><div><strong>${year} so far: ${hrsWords(yt.hours)} hours</strong><div class="sub">${annual.length} shift${annual.length===1?'':'s'}</div></div><button type="button" class="btn sm mb-share-btn" data-action="shareYear">${ic('share')}Share</button></div>`:''}
 ${!lp.shifts.length&&!annual.length?`<p class="hint">Once you record shifts, you can share a finished pay period here.</p>`:''}</section>
 <section class="panel sectiongap"><h3>Export records</h3><p class="muted">Backups and spreadsheet exports are in the <b>Data</b> menu at the top of the page. CSV opens in Excel or Sheets; the JSON backup keeps everything; the .zip has both.</p></section>`;
}
function renderSettings(){
 const s=state.settings,theme=document.documentElement.dataset.theme;
 const ej=editingJobId?(state.jobs.find(j=>j.id===editingJobId)||{}):null,ec=ej?(ej.id?jobCfg(ej.name):jobCfg()):null,isDef=ej&&ej.id&&ej.name===s.jobName;
 return `${viewHead('Settings','Appearance, your jobs and the take-home estimate.')}
 <section class="panel"><h3>Appearance</h3><div class="setrow"><span class="muted">Light or dark. The app always opens in light unless you pick dark.</span><div class="seg" role="group" aria-label="Appearance"><button type="button" class="chip" data-theme-pick="light" aria-pressed="${theme!=='dark'}">${ic('sun')}Light</button><button type="button" class="chip" data-theme-pick="dark" aria-pressed="${theme==='dark'}">${ic('moon')}Dark</button></div></div></section>
 <section class="panel sectiongap"><div class="panelhead"><h3>Jobs</h3><button type="button" class="btn sm" data-action="newJob">${ic('plus')}Add job</button></div>
 ${ej?`<form id="jobForm" class="subform" novalidate><input type="hidden" name="id" value="${esc(ej.id||'')}"><h3>${ej.id?'Edit job':'New job'}</h3><div class="fieldgrid">
 <div class="field"><label for="jobName">Job or employer name</label><input id="jobName" name="jobName" type="text" value="${esc(ej.name||'')}" required aria-describedby="jobNameErr"><p class="err" id="jobNameErr" hidden></p></div>
 ${field('Hourly rate ($)','jobRate',ej.rate??s.hourlyRate,'number',{min:0,step:.01,required:true})}
 ${field('Shift differential ($/hour, optional)','jobDiff',ej.differential||0,'number',{min:0,step:.01})}
 ${field('Paid','jobFreq',ec.payFrequency,'select',{options:[['weekly','Weekly'],['biweekly','Every two weeks'],['semimonthly','Twice a month (1st–15th, 16th–end)'],['monthly','Monthly']]})}
 ${field('Workweek starts on','jobWeek',ec.weekStarts,'select',{options:[[0,'Sunday'],[1,'Monday'],[2,'Tuesday'],[3,'Wednesday'],[4,'Thursday'],[5,'Friday'],[6,'Saturday']]})}
 ${field('A recent payday (optional)','jobPayday',ej.id?ec.payday:'','date')}
 ${field('First day of a pay period (optional)','jobAnchor',ej.id?ec.anchor:'','date')}
 ${field('Overtime after (hours/week)','jobOt',ec.otThreshold,'number',{min:0,step:.25})}
 ${field('Overtime pay multiplier','jobOtMult',ec.otMultiplier,'number',{min:1,step:.1})}
 <label class="checkrow" style="grid-column:1/-1"><input type="checkbox" name="jobDefault" ${isDef?'checked disabled':''}> Make this my default job (used for clock-in)${isDef?'. To change it, mark another job as default.':''}</label>
 </div><p class="hint" id="jobAnchorHint">The pay-period date tells the app which two weeks line up with your paychecks. Leave it blank and periods count from your first shift. The payday only shows your next payday; leave it blank to skip it.</p><div class="formactions"><button type="button" class="btn" data-action="cancelJob">Cancel</button><button class="btn primary" type="submit">Save job</button></div></form>`:''}
 ${state.jobs.map(j=>{const n=state.shifts.filter(x=>(x.job||s.jobName)===j.name).length,c=jobCfg(j.name);return `<div class="resultline jobrow"><div><strong>${esc(j.name)}</strong>${sampleTag(j.sample)} ${j.active?(j.name===s.jobName?'<span class="tag good">Default</span>':''):'<span class="tag">Past job</span>'}<div class="sub">${money(j.rate)}/hr${Number(j.differential)?` + ${money(j.differential)} differential`:''} · ${FREQ[c.payFrequency]} · OT after ${c.otThreshold}h · ${n} shift${n===1?'':'s'}</div></div><div class="actions" style="margin:0"><button type="button" class="btn sm" data-action="editJob" data-id="${esc(j.id)}">Edit</button>${j.active?`<button type="button" class="btn sm" data-action="toggleJob" data-id="${esc(j.id)}">Mark as past job</button>`:`<button type="button" class="btn sm" data-action="toggleJob" data-id="${esc(j.id)}">Reactivate</button>`}${n?'':`<button type="button" class="btn sm danger" data-action="deleteJob" data-id="${esc(j.id)}">Delete</button>`}</div></div>`}).join('')}
 <p class="hint">Leaving a job? Mark it as past instead of deleting it, so its shifts and paystubs stay in your history. Overtime is counted separately for each job, since each employer tracks its own week.</p></section>
 <form id="settingsForm" novalidate>
 <section class="panel sectiongap"><h3>Take-home pay estimate</h3><div class="fieldgrid">
 <div class="field"><label for="state">State you pay tax in</label><select id="state" name="state">${['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'].map(x=>`<option ${s.state===x?'selected':''}>${x}</option>`).join('')}</select></div>
 ${field('Filing status','filing',s.filing,'select',{options:[['single','Single / other'],['married','Married filing jointly (rough model)']]})}
 ${field('Currency','currency',s.currency,'select',{options:[['USD','USD: US dollar'],['CAD','CAD: Canadian dollar'],['GBP','GBP: British pound'],['EUR','EUR: euro']]})}
 ${field('Extra withholding per paycheck ($)','extraWithholding',s.extraWithholding,'number',{min:0,step:.01})}
 ${field('Pre-tax deductions per paycheck ($)','pretaxDeductions',s.pretaxDeductions,'number',{min:0,step:.01})}
 ${field('Post-tax deductions per paycheck ($)','posttaxDeductions',s.posttaxDeductions,'number',{min:0,step:.01})}
 </div><p class="hint">Tax estimates are simplified and aren't payroll-grade. State withholding varies a lot, and some states and cities need different treatment.</p>
 <div class="formactions"><button class="btn primary" type="submit">Save settings</button></div></section></form>
 <section class="panel sectiongap"><h3>Your data</h3><p class="muted">Your jobs, shifts, paystubs and settings are stored in this browser on this device. Clearing your browser data deletes them, so keep a backup. Backups, import, export and Clear all data are in the <b>Data</b> menu at the top of the page.</p>
 ${hasSample()?`<div class="actions"><button type="button" class="btn" data-action="removeSample">${ic('x')}Remove sample data</button></div>`:''}</section>`;
}

/* ---------------------------------------------------------------- events inside the view */
function markDirty(f){if(f)f.addEventListener('input',()=>{formDirty=true},{once:false})}
function bindPage(){
 $$('#view .progress span[data-w]').forEach(el=>{el.style.width=el.dataset.w+'%'});
 $$('#view [data-goto]').forEach(b=>b.onclick=()=>go(b.dataset.goto));
 $$('#view [data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action,b.dataset.id,b));
 $$('#view [data-theme-pick]').forEach(b=>b.onclick=()=>applyTheme(b.dataset.themePick));
 const sf=$('#shiftForm');if(sf){markDirty(sf);const endIn=$('#end'),chk=()=>{const bad=!!(endIn.value&&sf.start.value&&new Date(endIn.value)<new Date(sf.start.value));endIn.setAttribute('aria-invalid',String(bad));$('#endErr').hidden=!bad;return !bad};endIn.addEventListener('blur',chk);
  sf.onsubmit=e=>{e.preventDefault();if(!sf.reportValidity())return;if(!chk()){endIn.focus();return}const f=new FormData(sf),id=f.get('id')||uid(),prev=state.shifts.find(x=>x.id===id),obj={id,start:f.get('start'),end:f.get('end')||null,job:f.get('job'),rate:Number(f.get('rate')),unpaidBreak:Number(f.get('unpaidBreak'))||0,differential:Number(f.get('differential'))||0,notes:f.get('notes')||''};if(prev&&prev.sample)obj.sample=true;let idx=state.shifts.findIndex(x=>x.id===id);if(idx>=0)state.shifts[idx]=obj;else state.shifts.push(obj);if(state.activeShift?.id===id)state.activeShift=null;editingId=null;save();render();notify('Shift saved')};
  setTimeout(()=>{if(sf.isConnected){sf.scrollIntoView({block:'start'});sf.start.focus({preventScroll:true})}},20)}
 const stf=$('#stubForm');if(stf){markDirty(stf);stf.onsubmit=e=>{e.preventDefault();if(!stf.reportValidity())return;const f=new FormData(stf),id=f.get('id')||uid(),prev=state.paystubs.find(x=>x.id===id),obj={id,employer:f.get('employer'),date:f.get('date'),start:f.get('start'),end:f.get('end'),actualGross:Number(f.get('actualGross'))||0,actualNet:Number(f.get('actualNet'))||0,notes:f.get('notes')||''};if(prev&&prev.sample)obj.sample=true;let i=state.paystubs.findIndex(x=>x.id===id);if(i>=0)state.paystubs[i]=obj;else state.paystubs.push(obj);editingId=null;save();render();notify('Paystub saved')};
  setTimeout(()=>{if(stf.isConnected){stf.scrollIntoView({block:'start'});stf.employer.focus({preventScroll:true})}},20)}
 const setf=$('#settingsForm');if(setf){markDirty(setf);setf.onsubmit=e=>{e.preventDefault();const f=new FormData(setf);for(const k of ['extraWithholding','pretaxDeductions','posttaxDeductions'])state.settings[k]=Number(f.get(k))||0;for(const k of ['state','filing','currency'])state.settings[k]=f.get(k);save();render();notify('Settings saved')}}
 const jf=$('#jobForm');if(jf){markDirty(jf);const nameIn=$('#jobName'),showErr=m=>{nameIn.setAttribute('aria-invalid',String(!!m));const er=$('#jobNameErr');er.textContent=m||'';er.hidden=!m;if(m)nameIn.focus()};
  jf.onsubmit=e=>{e.preventDefault();const f=new FormData(jf),id=f.get('id'),name=String(f.get('jobName')||'').trim(),rate=Number(f.get('jobRate'))||0,differential=Number(f.get('jobDiff'))||0,sched={payFrequency:f.get('jobFreq'),weekStarts:Number(f.get('jobWeek'))||0,payday:f.get('jobPayday')||'',anchor:f.get('jobFreq')==='biweekly'?(f.get('jobAnchor')||''):'',otThreshold:f.get('jobOt')===''?40:Number(f.get('jobOt')),otMultiplier:Math.max(1,Number(f.get('jobOtMult'))||1.5)},makeDef=!!f.get('jobDefault');if(!name){showErr('Give the job a name.');return}if(state.jobs.some(j=>j.name===name&&j.id!==id)){showErr('You already have a job with that name.');return}
  const existing=state.jobs.find(j=>j.id===id);
  if(existing){const old=existing.name;if(old!==name){state.shifts.forEach(x=>{if((x.job||state.settings.jobName)===old)x.job=name});state.paystubs.forEach(x=>{if(x.employer===old)x.employer=name});if(state.activeShift&&state.activeShift.job===old)state.activeShift.job=name;if(state.settings.jobName===old)state.settings.jobName=name}Object.assign(existing,{name,rate,differential},sched);if(makeDef){existing.active=true;state.settings.jobName=name}}
  else{state.jobs.push({id:uid(),name,rate,differential,active:true,...sched});if(makeDef||activeJobs().length===1)state.settings.jobName=name}
  editingJobId=null;syncDefaultJob();save();render();notify('Job saved')};
  setTimeout(()=>{if(jf.isConnected){jf.scrollIntoView({block:'start'});nameIn.focus({preventScroll:true})}},20)}
 const jfq=$('#jobFreq');if(jfq){const vis=()=>{const v=jfq.value;$('#jobAnchor').closest('.field').hidden=v!=='biweekly';$('#jobPayday').closest('.field').hidden=v==='semimonthly'};jfq.onchange=vis;vis()}
 const se=$('#stubForm [name=employer]');if(se&&!$('#stubForm [name=id]').value)se.onchange=()=>{const r=periodRange(today(),se.value);$('#stubForm [name=start]').value=r.start;$('#stubForm [name=end]').value=r.end};
 const sj=$('#shiftForm [name=job]');if(sj)sj.onchange=()=>{const j=jobByName(sj.value);if(j){$('#shiftForm [name=rate]').value=j.rate;$('#shiftForm [name=differential]').value=j.differential||0}};
 const wf=$('#whatifForm');if(wf)wf.onsubmit=e=>{e.preventDefault();const f=new FormData(wf),rate=Number(f.get('whatRate'))||0,reg=Number(f.get('extraHours'))||0,ot=Number(f.get('extraOT'))||0,gross=reg*rate+ot*rate*(Number(f.get('whatMult'))||1.5),net=estimateNet(gross);$('#whatifResult').innerHTML=`<div class="callout">This adds <strong>${money(gross)}</strong> gross, with a rough estimated take-home of <strong>${money(net.net)}</strong>. The take-home figure is approximate, not a payroll quote.</div>`};
 const tj=$('#tcJob');if(tj)tj.onchange=()=>{tcJob=tj.value;lsSet(K_TC,JSON.stringify({job:tcJob}));refreshShiftTable()};
 const sp=$('#searchPhone');if(sp)sp.oninput=()=>{search=sp.value;$('#search').value=search;refreshShiftTable()};
}
function refreshShiftTable(){const box=$('#shiftTable');if(!box)return;box.innerHTML=shiftTable();$$('[data-art]',box).forEach(el=>{const t=document.getElementById(el.dataset.art);if(t)el.replaceWith(t.content.firstElementChild.cloneNode(true))});$$('[data-action]',box).forEach(b=>b.onclick=()=>action(b.dataset.action,b.dataset.id,b));$('#pageCsvSub').textContent=search||tcJob?'The shifts shown, for Excel or Sheets':'Shifts, for Excel or Sheets'}

async function action(a,id,btn){
 if(a==='clock'){toggleClock();return}
 if(a==='sample'){loadSampleData();return}
 if(a==='removeSample'){removeSampleData();return}
 if(a==='saveNow'){saveNow();return}
 if(a==='clearFilters'){search='';tcJob='';$('#search').value='';const sp=$('#searchPhone');if(sp)sp.value='';const tj=$('#tcJob');if(tj)tj.value='';lsSet(K_TC,'{}');refreshShiftTable();return}
 if(a==='sharePeriod'){sharePeriod();return}
 if(a==='shareYear'){shareYear();return}
 if(a==='newJob'){if(!(await guardLeave()))return;editingJobId='new';render();return}
 if(a==='editJob'){if(!(await guardLeave()))return;editingJobId=id;render();return}
 if(a==='cancelJob'){editingJobId=null;render();return}
 if(a==='toggleJob'){const j=state.jobs.find(x=>x.id===id);if(!j)return;if(j.active&&activeJobs().length===1){notify('Add your new job first, then mark this one as past.');return}if(j.active&&state.activeShift?.job===j.name){notify('Clock out of this job first.');return}j.active=!j.active;if(!j.active&&state.settings.jobName===j.name)state.settings.jobName=activeJobs()[0].name;syncDefaultJob();save();render();notify(j.active?'Job reactivated':'Marked as past job. History kept.');return}
 if(a==='deleteJob'){const j=state.jobs.find(x=>x.id===id);if(!j)return;if(j.active&&activeJobs().length===1){notify('You need at least one active job.');return}if(await askConfirm({title:`Delete "${j.name}"?`,body:'This job has no shifts. Its name, rate and pay schedule will be deleted.',ok:'Delete job'})){state.jobs=state.jobs.filter(x=>x.id!==id);ensureJobs();syncDefaultJob();save();render();notify('Job deleted')}return}
 if(a==='newshift'){if(page!=='timecard'||editingId){if(!(await guardLeave()))return}editingId='new';page='timecard';render();return}
 if(a==='cancelEdit'){editingId=null;render();return}
 if(a==='editShift'){if(!(await guardLeave()))return;editingId=id;page='timecard';render();return}
 if(a==='deleteShift'){deleteShift(id);return}
 if(a==='newstub'){if(!(await guardLeave()))return;editingId='new';render();return}
 if(a==='editStub'){if(!(await guardLeave()))return;editingId=id;render();return}
 if(a==='deleteStub'){deleteStub(id);return}
}
/* single-record deletes: immediate, with Undo (SUITE-STANDARDS §4) */
function deleteShift(id){const i=state.shifts.findIndex(s=>s.id===id);if(i<0)return;const rec=state.shifts[i],wasActive=state.activeShift&&state.activeShift.id===id?state.activeShift:null;state.shifts.splice(i,1);if(wasActive)state.activeShift=null;if(editingId===id)editingId=null;save();render();
 toast('Shift deleted',()=>{state.shifts.splice(Math.min(i,state.shifts.length),0,rec);if(wasActive&&!state.activeShift)state.activeShift=wasActive;save();render();notify('Shift restored')})}
function deleteStub(id){const i=state.paystubs.findIndex(s=>s.id===id);if(i<0)return;const rec=state.paystubs[i];state.paystubs.splice(i,1);if(editingId===id)editingId=null;save();render();
 toast('Paystub deleted',()=>{state.paystubs.splice(Math.min(i,state.paystubs.length),0,rec);save();render();notify('Paystub restored')})}

/* ---------------------------------------------------------------- sample data (labeled, flagged, removable in one click) */
function loadSampleData(){
 if(hasData()){notify('Sample data is only added to an empty app, so it never mixes with your records.');return}
 const base=new Date();base.setDate(base.getDate()-6);
 const dates=[];for(let i=0;i<6;i++){const d=new Date(base);d.setDate(d.getDate()+i);dates.push(ymd(d))}
 const local=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
 const examples=dates.map((day,i)=>{const hours=i===5?5.5:8;const start=new Date(`${day}T08:00:00`);const end=new Date(start.getTime()+hours*3600000);return{id:uid(),start:local(start),end:local(end),job:SAMPLE_JOB,rate:22.5,unpaidBreak:i===5?0:30,differential:0.75,notes:SAMPLE_NOTE,sample:true}});
 state.shifts.push(...examples);
 const start=new Date();start.setDate(start.getDate()-13);
 ensureJobs();
 const sj=jobByName(SAMPLE_JOB);if(sj){sj.sample=true;sj.rate=22.5;sj.differential=0.75;state.settings.jobName=SAMPLE_JOB;syncDefaultJob()}
 const gross=totals(examples).gross;
 state.paystubs.push({id:uid(),employer:SAMPLE_JOB,date:today(),start:ymd(start),end:today(),actualGross:Math.round((gross+12.5)*100)/100,actualNet:Math.round(gross*.78*100)/100,notes:`${SAMPLE_NOTE}. A small gross difference is included on purpose to show the comparison.`,sample:true});
 save();page='home';editingId=null;render();notify('Sample data added. Remove it any time from the Data menu.');
}
function removeSampleData(){
 if(!hasSample())return;
 const snap=JSON.stringify(state);
 const sampleJobs=new Set(state.jobs.filter(j=>j.sample||j.name==='Demo job').map(j=>j.name));
 state.shifts=state.shifts.filter(s=>!isSampleShift(s));state.paystubs=state.paystubs.filter(p=>!isSampleStub(p));
 if(state.activeShift&&isSampleShift(state.activeShift))state.activeShift=null;
 state.jobs=state.jobs.filter(j=>!sampleJobs.has(j.name)||state.shifts.some(s=>s.job===j.name)||state.paystubs.some(p=>p.employer===j.name));
 if(!state.jobs.some(j=>j.name===state.settings.jobName))state.settings.jobName=(state.jobs.find(j=>j.active)||state.jobs[0]||{name:'My job'}).name;
 ensureJobs();syncDefaultJob();save();render();
 toast('Sample data removed',()=>{state=normalizeState(JSON.parse(snap));ensureJobs();save();render();notify('Sample data restored')});
}

/* ---------------------------------------------------------------- time clock (unchanged behavior) */
function toggleClock(){
 if(state.activeShift){const id=state.activeShift.id,shift=state.shifts.find(s=>s.id===id);if(shift){const n=new Date();shift.end=dtLocalValue(n)+':'+String(n.getSeconds()).padStart(2,'0');}state.activeShift=null;save();render();notify('Clocked out. Shift saved.');return}
 const pick=$('#clockJob')?.value,job=jobByName(pick)||jobByName(state.settings.jobName)||activeJobs()[0];
 const n=new Date(),s={id:uid(),start:dtLocalValue(n)+':'+String(n.getSeconds()).padStart(2,'0'),end:null,job:job.name,rate:Number(job.rate)||0,unpaidBreak:0,differential:Number(job.differential)||0,notes:''};state.shifts.push(s);state.activeShift=s;save();render();notify('Clocked in')
}
function tick(){const el=$('#liveClock');if(el){el.textContent=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'});if(state.activeShift){const sub=el.nextElementSibling;if(sub)sub.textContent=`${dateFmt(today())} · ${state.activeShift.job} · Shift so far ${fmtHours(activeHours())}`}}
 if(state.activeShift){const p=shiftPay(state.activeShift),a=state.activeShift,base=(Number(a.rate)||0),diff=Number(a.differential)||0;
  $$('[data-live-earn]').forEach(x=>x.textContent=money(p.gross));
  const r=$('#liveRate');if(r)r.textContent=p.overtime>0?`Overtime: ${money(base*jobCfg(a.job).otMultiplier+diff)}/hr`:`${money(base+diff)}/hr`;
  $('#headerClockAmt').textContent=` · ${money(p.gross)}`}}

/* ---------------------------------------------------------------- files: export */
function download(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function backupPayload(){const clean={...state};META_KEYS.forEach(k=>delete clean[k]);return {app:APP_DOMAIN,format:BACKUP_FORMAT,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),...clean}}
function backupBlob(){return new Blob([JSON.stringify(backupPayload(),null,2)],{type:'application/json'})}
// CSV: UTF-8 BOM, quotes where needed, and a formula guard (cells starting with = + - @ get a leading apostrophe).
function csvEscape(v){let s=String(v??'');if(/^[=+\-@]/.test(s)&&!/^-?\d+(\.\d+)?$/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
const SHIFT_COLS=['id','start','end','job','rate','unpaidBreak','differential','notes'],STUB_COLS=['id','employer','date','start','end','actualGross','actualNet','notes'];
const toCSV=(cols,rows)=>'﻿'+[cols.join(','),...rows.map(r=>cols.map(k=>csvEscape(r[k])).join(','))].join('\r\n');
function markBackedUp(name){lsSet(K_LAST,new Date().toISOString());if(name)lsSet(K_FILE,name);updateBackupUI()}
const fsOK=()=>{try{return 'showSaveFilePicker' in window&&window.self===window.top}catch(e){return false}};
/* file handle for "Save backup now" lives in IndexedDB (handles can't go in localStorage) */
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open('payday.backup',1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function handleGet(){try{const db=await idb();return await new Promise(res=>{const q=db.transaction('handles').objectStore('handles').get('json');q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null)})}catch(e){return null}}
async function handleSet(h){try{const db=await idb();await new Promise(res=>{const tx=db.transaction('handles','readwrite');tx.objectStore('handles').put(h,'json');tx.oncomplete=res;tx.onerror=res})}catch(e){}}
async function handleClear(){try{const db=await idb();await new Promise(res=>{const tx=db.transaction('handles','readwrite');tx.objectStore('handles').clear();tx.oncomplete=res;tx.onerror=res})}catch(e){}lsDel(K_FILE)}
async function writeHandle(h){if(h.queryPermission&&(await h.queryPermission({mode:'readwrite'}))!=='granted'){if((await h.requestPermission({mode:'readwrite'}))!=='granted')throw new Error('permission')}const w=await h.createWritable();await w.write(backupBlob());await w.close()}
async function pickAndSave(){const h=await window.showSaveFilePicker({suggestedName:'payday-backup.json',types:[{description:'payday.mcbflow.com backup',accept:{'application/json':['.json']}}]});await writeHandle(h);await handleSet(h);markBackedUp(h.name);return h.name}
async function saveNow(){
 closeMenu();
 if(!hasData()&&!(await askConfirm({title:'Save an empty backup?',body:'There are no shifts or paystubs yet, so the backup will only hold your jobs and settings.',ok:'Save anyway',danger:false})))return;
 if(!fsOK()){download(`payday-backup-${today()}.json`,backupBlob());markBackedUp('');notify('Backup saved to your Downloads folder');return}
 try{const h=await handleGet();if(h){await writeHandle(h);markBackedUp(h.name);notify(`Backup saved to ${h.name}`);return}const n=await pickAndSave();notify(`Backup saved to ${n}. Save backup now will update this file.`)}
 catch(e){if(e&&e.name==='AbortError')return;download(`payday-backup-${today()}.json`,backupBlob());markBackedUp('');notify('Backup saved to your Downloads folder')}
}
async function exportJSON(){closeMenu();if(fsOK()){try{const n=await pickAndSave();notify(`Backup saved to ${n}`);return}catch(e){if(e&&e.name==='AbortError')return}}download(`payday-backup-${today()}.json`,backupBlob());markBackedUp('');notify('JSON backup exported')}
function exportPageCSV(){closeMenu();if(page==='paystubs'){download(`payday-paystubs-${today()}.csv`,new Blob([toCSV(STUB_COLS,state.paystubs)],{type:'text/csv;charset=utf-8'}));notify('Paystubs CSV exported');return}
 const rows=page==='timecard'?filteredShifts().slice().reverse():state.shifts;download(`payday-shifts-${today()}.csv`,new Blob([toCSV(SHIFT_COLS,rows)],{type:'text/csv;charset=utf-8'}));notify('Shifts CSV exported')}
async function exportZIP(){closeMenu();if(!window.JSZip){notify('ZIP export isn\'t available in this browser. Use Export All (JSON) instead.');return}try{const zip=new JSZip();zip.file('payday-backup.json',JSON.stringify(backupPayload(),null,2));zip.file('shifts.csv',toCSV(SHIFT_COLS,state.shifts));zip.file('paystubs.csv',toCSV(STUB_COLS,state.paystubs));zip.file('README.txt','Payday (payday.mcbflow.com) backup. payday-backup.json holds all app data and can be imported with Data > Import Backup. The CSV files are for spreadsheets. Keep this file private.');const blob=await zip.generateAsync({type:'blob'});download(`payday-backup-${today()}.zip`,blob);markBackedUp('');notify('ZIP backup exported')}catch(e){notify('ZIP export failed. Try Export All (JSON) instead.')}}

/* ---------------------------------------------------------------- files: import (validate first, then Merge or Replace) */
function parseCSV(text){let rows=[],row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){let c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=c}if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}if(rows.length<2)return [];const headers=rows.shift().map(x=>x.replace(/^﻿/,'').trim());return rows.filter(r=>r.some(x=>x!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])))}
const unguard=v=>typeof v==='string'&&/^'[=+\-@]/.test(v)?v.slice(1):v;
const str=(v,d='')=>v==null?d:String(v);
const validDT=v=>typeof v==='string'&&!!toDate(v);
function cleanShift(x){if(!x||typeof x!=='object'||!validDT(x.start))return null;const o={...x,id:str(x.id)||uid(),start:x.start,end:validDT(x.end)?x.end:null,job:str(x.job),rate:Number(x.rate)||0,unpaidBreak:Number(x.unpaidBreak)||0,differential:Number(x.differential)||0,notes:str(x.notes)};if(!o.job)delete o.job;return o}
function cleanStub(x){if(!x||typeof x!=='object')return null;return {...x,id:str(x.id)||uid(),employer:str(x.employer),date:str(x.date),start:str(x.start),end:str(x.end),actualGross:Number(x.actualGross)||0,actualNet:Number(x.actualNet)||0,notes:str(x.notes)}}
const shiftSig=s=>[s.start,s.end||'',s.job||''].join('|'),stubSig=p=>[p.employer,p.date,Number(p.actualGross)||0].join('|');
async function readImport(file){
 const ext=file.name.toLowerCase().split('.').pop();
 if(file.size>25e6)throw Error('That file is too large to be a Payday backup.');
 if(ext==='csv'){const rows=parseCSV(await file.text());if(!rows.length)throw Error('No rows found in that CSV file.');if(!('start' in rows[0]))throw Error('This CSV has no "start" column. Use a shifts CSV exported from Payday.');
  let bad=0;const shifts=[];rows.forEach(r=>{const o={};Object.keys(r).forEach(k=>o[k]=unguard(r[k]));const s=cleanShift({id:o.id||uid(),start:o.start,end:o.end||null,job:o.job||state.settings.jobName,rate:Number(o.rate)||Number(state.settings.hourlyRate),unpaidBreak:o.unpaidBreak,differential:o.differential,notes:o.notes||''});if(s)shifts.push(s);else bad++});
  if(!shifts.length)throw Error('None of the rows have a valid start date and time.');
  return {kind:'csv',shifts,paystubs:[],jobs:[],bad}}
 let obj;
 if(ext==='zip'){if(!window.JSZip)throw Error('ZIP import isn\'t available in this browser. Import the JSON file instead.');let zip;try{zip=await JSZip.loadAsync(file)}catch(e){throw Error('That .zip file could not be opened.')}const jf=zip.file('payday-backup.json')||zip.file('mbpayday-backup.json')||zip.file('mbpaystub-backup.json');if(!jf)throw Error('This .zip has no payday-backup.json inside.');try{obj=JSON.parse(await jf.async('text'))}catch(e){throw Error('The backup inside the .zip is damaged.')}}
 else if(ext==='json'){try{obj=JSON.parse(await file.text())}catch(e){throw Error('That file isn\'t valid JSON.')}}
 else throw Error('Choose a .json or .zip backup, or a shifts .csv file.');
 if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('That file doesn\'t look like a Payday backup.');
 if(obj.app&&obj.app!==APP_DOMAIN&&obj.app!==OLD_DOMAIN)throw Error(`That backup is from ${String(obj.app).slice(0,40)}, not Payday.`);
 if(!Array.isArray(obj.shifts)||!obj.settings||typeof obj.settings!=='object')throw Error('That file doesn\'t look like a Payday backup.');
 let bad=0;const shifts=[];obj.shifts.forEach(x=>{const s=cleanShift(x);if(s)shifts.push(s);else bad++});
 const paystubs=(Array.isArray(obj.paystubs)?obj.paystubs:[]).map(cleanStub).filter(Boolean);
 const jobs=(Array.isArray(obj.jobs)?obj.jobs:[]).filter(j=>j&&typeof j==='object'&&j.name).map(j=>({...j,id:str(j.id)||uid(),name:String(j.name),rate:Number(j.rate)||0,differential:Number(j.differential)||0}));
 const active=obj.activeShift&&typeof obj.activeShift==='object'?cleanShift(obj.activeShift):null;
 return {kind:'backup',obj,shifts,paystubs,jobs,active,bad}
}
let pending=null;
async function importFile(file){
 closeMenu();let r;
 try{r=await readImport(file)}catch(e){toast('Import failed: '+(e&&e.message?e.message:'the file could not be read.'));return}
 const ids=new Set(state.shifts.map(s=>s.id)),sigs=new Set(state.shifts.map(shiftSig)),pids=new Set(state.paystubs.map(p=>p.id)),psigs=new Set(state.paystubs.map(stubSig)),jnames=new Set(state.jobs.map(j=>j.name));
 const newShifts=r.shifts.filter(s=>!ids.has(s.id)&&!sigs.has(shiftSig(s))),newStubs=r.paystubs.filter(p=>!pids.has(p.id)&&!psigs.has(stubSig(p))),newJobs=r.jobs.filter(j=>!jnames.has(j.name));
 const dupes=r.shifts.length-newShifts.length+r.paystubs.length-newStubs.length,empty=!hasData();
 pending={r,newShifts,newStubs,newJobs,empty};
 $('#importTitle').textContent=r.kind==='csv'?'Import shifts from CSV':'Import backup';
 $('#importFileName').textContent=file.name+(r.obj&&r.obj.exportedAt&&toDate(r.obj.exportedAt)?` · saved ${new Date(r.obj.exportedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`:'');
 const li=[`${newShifts.length} new shift${newShifts.length===1?'':'s'}`];if(r.kind!=='csv')li.push(`${newStubs.length} new paystub${newStubs.length===1?'':'s'}`,`${newJobs.length} new job${newJobs.length===1?'':'s'}`);li.push(`${dupes} already here (skipped)`);
 $('#importSummary').innerHTML=li.map(x=>`<li>${esc(x)}</li>`).join('')+(r.bad?`<li class="bad">${r.bad} row${r.bad===1?'':'s'} without a valid start time (skipped)</li>`:'');
 $('#importNote').textContent=r.kind==='csv'?'Merge adds the new shifts to your timecard. Nothing you have is changed.':empty?'Merge adds everything from the backup. This browser has no shifts or paystubs yet, so its settings come from the backup too.':`Merge adds what's new and keeps your current settings. Replace deletes your ${state.shifts.length} shift${state.shifts.length===1?'':'s'} and ${state.paystubs.length} paystub${state.paystubs.length===1?'':'s'} here and loads the backup instead.`;
 $('#importReplace').hidden=r.kind==='csv'||empty;$('#importBackupRow').hidden=r.kind==='csv'||empty;
 const d=$('#importDlg');openDlg(d);$('#importMerge').focus();
}
function finishImport(mode){
 const p=pending;pending=null;if(!p)return;const r=p.r,before=JSON.stringify(state);
 try{
  if(mode==='replace'){const o=r.obj;state=normalizeState({...defaultState(),...o,settings:{...defaultState().settings,...o.settings},shifts:r.shifts,paystubs:r.paystubs,jobs:r.jobs,activeShift:r.active})}
  else{state.shifts.push(...p.newShifts);state.paystubs.push(...p.newStubs);state.jobs.push(...p.newJobs);
   if(r.kind==='backup'&&p.empty){state.settings={...defaultState().settings,...r.obj.settings};if(r.active&&!state.activeShift)state.activeShift=r.active}}
  ensureJobs();syncDefaultJob();
  if(!save())throw Error('save');
 }catch(e){state=normalizeState(JSON.parse(before));ensureJobs();toast('Import failed. Nothing was changed.');return}
 editingId=null;page='home';lsSet(K_WELCOME,'1');render();
 notify(mode==='replace'?'Backup loaded. Your previous data was replaced.':`Imported ${p.newShifts.length} shift${p.newShifts.length===1?'':'s'}${r.kind==='csv'?'':` and ${p.newStubs.length} paystub${p.newStubs.length===1?'':'s'}`}`);
}

/* ---------------------------------------------------------------- clear all data */
async function clearAll(){closeMenu();
 const synced=SYNC&&SYNC.status().signedIn;
 const ok=await askConfirm({title:'Clear all data?',body:`This deletes all ${state.shifts.length} shift${state.shifts.length===1?'':'s'}, ${state.paystubs.length} paystub${state.paystubs.length===1?'':'s'}, your jobs and settings from this browser.${synced?' You’re signed in to sync, so they’re also deleted from your account and your other devices. To clear only this device, sign out first (Data → Sync).':''} It can't be undone.`,ok:'Clear all data',backup:hasData()});
 if(!ok)return;state=defaultState();ensureJobs();save();lsDel(K_LAST);lsDel(K_TC);await handleClear();search='';tcJob='';editingId=null;editingJobId=null;page='home';render();notify('All data cleared')}

/* ---------------------------------------------------------------- backup status chip */
function updateBackupUI(){
 const last=lsGet(K_LAST),file=lsGet(K_FILE),chip=$('#bkChip');let text='Never backed up',warn=hasData(),line='Never backed up';
 if(last&&toDate(last)){const d0=new Date(last),days=Math.floor((new Date(today()+'T12:00:00')-new Date(ymd(d0)+'T12:00:00'))/86400000);text=days<=0?'Backed up today':days===1?'Backed up yesterday':`Backed up ${days} days ago`;warn=days>=7&&hasData();line=`Last backup: ${d0.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}, ${d0.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`}
 $('#bkChipText').textContent=text;chip.classList.toggle('warn',warn);$('#dataDot').hidden=!warn;$('#bkStatusLine').textContent=line;
 const fl=$('#bkFileLine');
 if(!fsOK()){fl.textContent='This browser saves backups to your Downloads folder.';$('#saveNowSub').textContent='Downloads a dated .json file'}
 else if(file){fl.innerHTML=`Saving to <b>${esc(file)}</b> in the folder you chose. <button type="button" class="linkbtn" id="changeLoc">Change location…</button>`;$('#saveNowSub').textContent=`Updates ${file}`;$('#changeLoc').onclick=async()=>{try{const n=await pickAndSave();notify(`Backup saved to ${n}`)}catch(e){}}}
 else{fl.textContent='No backup file chosen yet. Save backup now asks where to put it.';$('#saveNowSub').textContent='Choose where to save it the first time'}
}

/* ---------------------------------------------------------------- share cards (MBShare, kit v3 §6) */
const shareMonth=()=>new Date().toLocaleDateString('en-US',{month:'short',year:'numeric'});
function sharePeriod(){const lp=lastPeriod();if(!lp.shifts.length)return;const range=`${dateFmt(lp.range.start)} – ${dateFmt(lp.range.end)}`;
 MBShare.open({title:'Share your pay period',kicker:'Pay period wrapped up',headline:`${hrsWords(lp.t.hours)} hours worked`,fileName:'payday-pay-period.png',date:shareMonth(),art:$('#shareArt').content.firstElementChild,
  options:[{id:'amounts',label:'Show pay amounts',value:false},{id:'job',label:'Show job name',value:false}],
  build:o=>({sub:o.job?`${lp.name} · ${range}`:range,stats:[{label:'Shifts',value:String(lp.shifts.length)},{label:'Overtime',value:`${hrsWords(lp.t.ot)} h`}].concat(o.amounts?[{label:'Est. gross',value:money(lp.t.gross)}]:[{label:'Regular',value:`${hrsWords(lp.t.reg)} h`}])})})}
function shareYear(){const year=today().slice(0,4),list=state.shifts.filter(s=>(s.start||'').slice(0,4)===year),t=totals(list);if(!list.length)return;const jobs=[...new Set(list.map(s=>s.job||state.settings.jobName))];
 MBShare.open({title:'Share your year so far',kicker:`${year} so far`,headline:`${hrsWords(t.hours)} hours worked this year`,fileName:'payday-year.png',date:shareMonth(),art:$('#shareArt').content.firstElementChild,
  options:[{id:'amounts',label:'Show pay amounts',value:false},{id:'job',label:'Show job names',value:false}],
  build:o=>({sub:o.job?jobs.join(', '):`${list.length} shifts logged`,stats:[{label:'Shifts',value:String(list.length)},{label:'Overtime',value:`${hrsWords(t.ot)} h`}].concat(o.amounts?[{label:'Est. gross',value:money(t.gross)}]:[])})})}

/* ---------------------------------------------------------------- Data menu */
function openMenu(){const m=$('#dataMenu');m.hidden=false;$('#dataBtn').setAttribute('aria-expanded','true');updateBackupUI();const f=m.querySelector('.dm-item:not([hidden])');if(f)f.focus()}
function closeMenu(focusBtn){const m=$('#dataMenu');if(m.hidden)return;m.hidden=true;$('#dataBtn').setAttribute('aria-expanded','false');if(focusBtn)$('#dataBtn').focus()}
const MENU={sync:()=>{closeMenu();if(SYNC)SYNC.open()},saveNow,exportJson:exportJSON,import:()=>{closeMenu();$('#importFile').click()},exportPageCsv:exportPageCSV,exportZip:exportZIP,removeSample:()=>{closeMenu();removeSampleData()},clearAll};

/* ---------------------------------------------------------------- optional account sync (mb-sync.js) */
// Each shift and paystub is its own record; settings, jobs and the running clock are one record each. Sample records never sync.
function syncRecords(){
 const r={settings:state.settings,jobs:state.jobs,active:state.activeShift,meta:{version:state.version,createdAt:state.createdAt}};
 for(const x of state.shifts){if(isSampleShift(x))continue;if(!x.id)x.id=uid();r['shift:'+x.id]=x}
 for(const x of state.paystubs){if(isSampleStub(x))continue;if(!x.id)x.id=uid();r['stub:'+x.id]=x}
 return r}
function syncApply(m){
 const list=pre=>Object.keys(m).filter(k=>k.startsWith(pre)).map(k=>m[k]).filter(x=>x&&typeof x==='object'),meta=m.meta||{};
 state=normalizeState({version:meta.version||state.version,createdAt:meta.createdAt||state.createdAt,settings:m.settings||state.settings,jobs:Array.isArray(m.jobs)?m.jobs:state.jobs,activeShift:m.active||null,
  shifts:[...list('shift:'),...state.shifts.filter(isSampleShift)],paystubs:[...list('stub:'),...state.paystubs.filter(isSampleStub)]});
 ensureJobs();save();
 if(!formDirty&&!editingId&&!editingJobId)render();else updateClockButton()}   // don't wipe a form the person is typing in
function updateSyncUI(st){
 const t=$('#dmSyncTitle'),sub=$('#dmSyncSub');if(!t)return;
 t.textContent=st.signedIn?`Sync: ${st.label}`:'Sync across devices…';
 sub.textContent=st.signedIn?st.email:'Optional free account. Your data stays on this device too'}
if(window.MBSync)SYNC=MBSync.create({app:'payday',label:'Payday',toRecords:syncRecords,fromRecords:syncApply,
 hasData:()=>state.shifts.some(x=>!isSampleShift(x))||state.paystubs.some(x=>!isSampleStub(x)),onStatus:updateSyncUI});

/* ---------------------------------------------------------------- wire up the shell */
$('#dataBtn').onclick=e=>{e.stopPropagation();if($('#dataMenu').hidden)openMenu();else closeMenu()};
$('#dataMenu').addEventListener('click',e=>{e.stopPropagation();const b=e.target.closest('[data-act]');if(b&&MENU[b.dataset.act])MENU[b.dataset.act]()});
$('#dataMenu').addEventListener('keydown',e=>{if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;e.preventDefault();const items=$$('#dataMenu .dm-item:not([hidden])'),i=items.indexOf(document.activeElement);items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus()});
document.addEventListener('click',()=>closeMenu());
$('#storeBanner [data-act]').onclick=exportJSON;
$('#bkChip').onclick=saveNow;
$('#themeBtn').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
$('#headerClock').onclick=toggleClock;
$('#importFile').onchange=async()=>{const f=$('#importFile').files[0];$('#importFile').value='';if(f)await importFile(f)};
$('#importMerge').onclick=()=>{closeDlg($('#importDlg'));finishImport('merge')};
$('#importReplace').onclick=()=>{closeDlg($('#importDlg'));finishImport('replace')};
$('#importCancel').onclick=()=>{pending=null;closeDlg($('#importDlg'))};
$('#importDlg').addEventListener('cancel',()=>{pending=null});
$('#importBackup').onclick=()=>saveNow();
$('#search').oninput=()=>{search=$('#search').value;const sp=$('#searchPhone');if(sp)sp.value=search;refreshShiftTable()};
document.addEventListener('click',e=>{
 const v=e.target.closest('[data-view]');if(v&&!v.closest('#view')){e.preventDefault();const md=$('#moreSheet');if(md.open)md.close();go(v.dataset.view);return}
 const h=e.target.closest('[data-home]');if(h){e.preventDefault();go('home',{force:page==='home'})}
});
$('#moreBtn').onclick=()=>{const d=$('#moreSheet');$$('#moreSheet [data-view]').forEach(b=>{if(b.dataset.view===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});openDlg(d)};
$$('#moreSheet [data-close]').forEach(b=>b.onclick=()=>closeDlg($('#moreSheet')));
$$('dialog.dlg').forEach(d=>d.addEventListener('click',e=>{if(e.target===d&&d.id==='moreSheet')closeDlg(d)}));
document.addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='s'){e.preventDefault();saveNow();return}
 if(e.key==='Escape'&&!$('#dataMenu').hidden){e.preventDefault();closeMenu(true);return}
 if(e.key==='/'&&page==='timecard'&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'')&&!document.querySelector('dialog[open]')){e.preventDefault();const t=window.innerWidth<768?$('#searchPhone'):$('#search');if(t)t.focus()}
});
/* first-run screen: once per browser, skippable, theme choice, points at Import */
function welcome(){const d=$('#welcomeDlg'),done=()=>{lsSet(K_WELCOME,'1');closeDlg(d)};
 $$('#welcomeDlg [data-theme-pick]').forEach(b=>b.onclick=()=>applyTheme(b.dataset.themePick));
 $('#welcomeStart').onclick=done;$('#welcomeSample').onclick=()=>{done();loadSampleData()};$('#welcomeImport').onclick=()=>{done();$('#importFile').click()};
 d.addEventListener('cancel',()=>lsSet(K_WELCOME,'1'),{once:true});
 openDlg(d);$('#welcomeStart').focus()}

applyTheme(document.documentElement.dataset.theme,false);
if(!probeStorage()){storageOK=false;$('#storeBanner').hidden=false}
render();setInterval(tick,1000);
// Opened from the hub's Install link (?install): let the install sheet go first, then show the first-run screen.
function maybeWelcome(){let via=false;try{const n=performance.getEntriesByType('navigation')[0];via=!!n&&/[?&]install(=|&|$)|#install$/.test(n.name)}catch(e){}
 if(!via){welcome();return}const wait=()=>{if(document.querySelector('.mb-isheet'))setTimeout(wait,400);else welcome()};setTimeout(wait,1800)}
if(!lsGet(K_WELCOME)){if(hasData())lsSet(K_WELCOME,'1');else maybeWelcome()}
MBInstall.registerSW('sw.js');
})();
