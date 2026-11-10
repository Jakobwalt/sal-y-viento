/* Wave details: the waves panel of the spot view opens to the full page.
   One column per hour (06–21), a drawn wave for every swell train, then the numbers:
   primary swell (height, direction, period, energy), secondary and tertiary swell, and the wind in brief.
   The wind table folds into a slim bar; tapping it (or "Wind & waves") brings the tables back.
   Reads the per-spot arrays in spots.json; if the swell partitions (s1h…s3d) are not there yet,
   the combined sea (wh/wp/wd) stands in for the primary swell. */
(()=>{
const $=id=>document.getElementById(id);
const fcEl=()=>document.querySelector("#info .fc");
const H0=6,H1=21;                                  // hours shown per day
const COMP=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const comp=d=>COMP[Math.round((((d%360)+360)%360)/22.5)%16];
// energy per metre of crest over one wavelength, deep water: ρ g² H² T² / 16π  (kJ)
const KJ=1025*9.81*9.81/(16*Math.PI)/1000;
const energy=(h,t)=>h!=null&&t!=null?KJ*h*h*t*t:null;
const eStep=e=>e<1000?Math.floor(e/50)*50:Math.floor(e/100)*100;
const eLab=e=>e<50?"<50":e<1000?String(eStep(e)):(eStep(e)/1000).toFixed(1).replace(/\.0$/,"")+"k";
const eRange=e=>{const a=eStep(e),b=a+(e<1000?50:100);return `${a.toLocaleString("en")}–${b.toLocaleString("en")} kJ`};
// more power, warmer colour (same family as the wind)
const ECUT=[200,500,1000,2000,3000,5000,8000,12000];
const ECOL=["233,238,232","251,245,230","196,230,160","118,194,112","243,194,90","240,151,62","238,106,57","200,52,68","125,42,110"];
const eCol=e=>{let i=0;while(i<ECUT.length&&e>=ECUT[i])i++;return ECOL[i]};
// longer period, deeper blue
const PCOL=[[5,[205,230,226]],[8,[138,196,214]],[11,[78,143,196]],[14,[58,94,174]],[17,[64,55,143]]];
const pCol=t=>{if(t==null)return "rgb(138,196,214)";for(let i=0;i<PCOL.length-1;i++){const [a,ca]=PCOL[i],[b,cb]=PCOL[i+1];if(t<=b){const k=Math.max(0,(t-a)/(b-a));return `rgb(${ca.map((c,n)=>Math.round(c+(cb[n]-c)*k))})`}}return `rgb(${PCOL.at(-1)[1]})`};

let open=false,key="",cols=[],busy=0,lastNow=-1;

/* ---------- data ---------- */
function at(o,k,T){const a=o[k];return a&&a[T]!=null?a[T]:null}
function cell(o,T){
  const split=Array.isArray(o.s1h);
  const p=split?{h:at(o,"s1h",T),t:at(o,"s1p",T),d:at(o,"s1d",T)}:{h:at(o,"wh",T),t:at(o,"wp",T),d:at(o,"wd",T)};
  const tr=(a,b,c)=>{const h=at(o,a,T);return h!=null&&h>=.05?{h,t:at(o,b,T),d:at(o,c,T)}:null};
  return{T,split,p:p.h!=null?p:null,s:tr("s2h","s2p","s2d"),t:tr("s3h","s3p","s3d"),
    w:at(o,"kn",T)==null?null:{kn:at(o,"kn",T),g:Math.max(at(o,"gust",T)??0,at(o,"kn",T)),d:at(o,"dir",T)},
    m:at(o,"wm",T)||(p.h!=null?"pde":null)}}
// sunrise / sunset as hours since T0 (NOAA's simple solar equations; a few minutes is plenty here)
function sun(d,lat,lon){
  const noon=atHour(d*24+12),J=noon.getTime()/864e5+2440587.5,n=Math.round(J-2451545+.0008),Js=n-lon/360,r=Math.PI/180;
  const M=(357.5291+.98560028*Js)%360,C=1.9148*Math.sin(M*r)+.02*Math.sin(2*M*r)+.0003*Math.sin(3*M*r),L=(M+C+282.9372)%360;
  const Jt=2451545+Js+.0053*Math.sin(M*r)-.0069*Math.sin(2*L*r),sd=Math.sin(L*r)*Math.sin(23.44*r),cd=Math.cos(Math.asin(sd));
  const cw=(Math.sin(-.833*r)-Math.sin(lat*r)*sd)/(Math.cos(lat*r)*cd);if(cw<-1||cw>1)return null;
  const w=Math.acos(cw)/r/360,hr=j=>((j-2440587.5)*864e5-T0.getTime())/3600e3;return[hr(Jt-w),hr(Jt+w)]}

function collect(s){const o=FC&&FC.spots[s.id];if(!o)return[];const out=[];
  for(let d=0;d<NDAYS;d++){const day=[];for(let h=H0;h<=H1;h++){const T=d*24+h;if(T<N)day.push(cell(o,T))}
    if(!day.some(c=>c.p))continue;const st=sun(d,s.lat,s.lon);
    day.forEach((c,i)=>{c.d=d;c.first=i===0;c.night=st?(c.T<st[0]-.5||c.T>st[1]+.5):false;c.dusk=st?(!c.night&&(c.T<st[0]+.5||c.T>st[1]-.5)):false;out.push(c)})}
  return out}

/* ---------- drawing ---------- */
// a curling wave in a unit box (u to the right, v up); it breaks to the right
const WAVE=[[0,0],[.22,.02,.42,.45,.58,.86],[.66,1.02,.84,1.04,.94,.88],[.99,.8,.96,.7,.9,.73],[.85,.76,.8,.66,.8,.55],[.8,.35,.88,.12,1,0]];
function wavePath(x0,base,w,h){const P=(u,v)=>`${(x0+u*w).toFixed(1)} ${(base-v*h).toFixed(1)}`;
  return "M"+P(...WAVE[0])+WAVE.slice(1).map(s=>"C"+P(s[0],s[1])+" "+P(s[2],s[3])+" "+P(s[4],s[5])).join("")+"Z"}
function backLine(x0,base,w,h){const P=(u,v)=>`${(x0+u*w).toFixed(1)} ${(base-v*h).toFixed(1)}`;return `M${P(.08,0)}C${P(.28,.04)} ${P(.44,.45)} ${P(.58,.86)}C${P(.66,1.02)} ${P(.84,1.04)} ${P(.93,.89)}`}
function graph(cw,GH){const n=cols.length,W=n*cw,base=GH-8,top=14;
  const hmax=Math.max(2,...cols.flatMap(c=>[c.p?.h??0,c.s?.h??0,c.t?.h??0]))*1.05;
  const Y=h=>Math.sqrt(Math.max(0,h)/hmax)*(base-top);           // square-root scale: small waves stay readable next to big ones
  const ticks=[.5,1,2,3,5,8].filter(t=>t<=hmax);
  let g=`<svg class="sw-g" width="${W}" height="${GH}" viewBox="0 0 ${W} ${GH}" aria-hidden="true"><defs><linearGradient id="sw-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;
  cols.forEach((c,i)=>{if(c.night)g+=`<rect x="${i*cw}" y="0" width="${cw}" height="${GH}" fill="rgba(16,28,44,.16)"/>`;if(c.first&&i)g+=`<line x1="${i*cw}" x2="${i*cw}" y1="2" y2="${GH}" stroke="rgba(251,245,230,.28)"/>`});
  for(const t of ticks)g+=`<line x1="0" x2="${W}" y1="${(base-Y(t)).toFixed(1)}" y2="${(base-Y(t)).toFixed(1)}" stroke="rgba(251,245,230,.13)" stroke-dasharray="2 5"/>`;
  g+=`<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(251,245,230,.4)"/>`;
  cols.forEach((c,i)=>{const cx=i*cw+cw*.5;
    const trains=[["p",c.p,0],["s",c.s,-.16],["t",c.t,.16]].filter(x=>x[1]).sort((a,b)=>b[1].h-a[1].h);
    for(const [k,v,off] of trains){const h=Y(v.h);
      if(h<3){g+=`<path d="M${cx-cw*.4} ${base-1}q${cw*.2} -3 ${cw*.4} 0t${cw*.4} 0" fill="none" stroke="rgba(251,245,230,.7)" stroke-width="1.2"/>`;continue}
      const w=Math.min(cw*4,Math.max(cw*1.15,h*1.05)),x0=cx+off*cw-w*.74,d=wavePath(x0,base,w,h);
      if(k==="p"){g+=`<path d="${d}" fill="${pCol(v.t)}" stroke="rgba(251,245,230,.92)" stroke-width="1.1"/><path d="${d}" fill="url(#sw-sheen)"/>`;
        // engraved water lines inside the face, like an old print
        if(h>14)for(const f of [.7,.42])g+=`<path d="${backLine(x0+w*(1-f)*.62,base,w*f,h*f)}" fill="none" stroke="rgba(251,245,230,${f>.5?.42:.3})" stroke-width=".9"/>`}
      else g+=`<path d="${d}" fill="${pCol(v.t)}" fill-opacity="${k==="s"?.42:.26}" stroke="rgba(251,245,230,${k==="s"?.85:.6})" stroke-width="1" ${k==="t"?'stroke-dasharray="2.5 2"':""}/>`}});
  return{svg:g+"</svg>",ticks:ticks.map(t=>({t,y:base-Y(t)})),base}}

const badge=(v,big)=>v?`<b class="bd${big?"":" ghost"}" style="${big?`background:${waveCol(v.h)}`:""}" title="${v.h.toFixed(1)} m${v.t!=null?` · ${Math.round(v.t)} s`:""}${v.d!=null?` · from ${comp(v.d)} ${Math.round(v.d)}°`:""}">${v.h<10?v.h.toFixed(1):Math.round(v.h)}</b>`:"<i>·</i>";
const dirPer=v=>v?`<span class="dp" title="${v.d!=null?`from ${comp(v.d)} ${Math.round(v.d)}°`:""}">${v.d!=null?arrow(v.d):""}${v.t!=null?Math.round(v.t)+"s":""}</span>`:"";

function render(s,ghFit){if(!s)return;cols=collect(s);key=s.id+":"+(FC&&FC.meta.generated);
  const box=$("sw"),narrow=innerWidth<760,short=innerHeight<560,cw=narrow?32:42,GH=ghFit||(short?92:narrow?120:140);
  if(!cols.length){box.innerHTML=`<p class="sw-empty">No wave forecast for this spot right now.</p>`;return}
  const split=cols.some(c=>c.split),hasS=cols.some(c=>c.s),hasT=cols.some(c=>c.t),gr=graph(cw,GH);
  const R=(cls,lab,sub,cells)=>({cls,lab,sub,cells}),FROM=narrow?"from · s":"from · period";
  const rows=[
    R("r-day","","",()=>{let h="",i=0;while(i<cols.length){const d=cols[i].d;let j=i;while(j<cols.length&&cols[j].d===d)j++;h+=`<span class="sw-day" style="grid-column:${i+1}/${j+1}"><em>${dayName(d)}</em></span>`;i=j}return h}),
    R("r-hr","","",()=>cols.map(c=>`<span class="${c.night?"nt":""}">${String(hourOf(c.T)).padStart(2,"0")}</span>`).join("")),
    R("r-graph","","",null),
    R("r-big",split?"Primary swell":"Waves",split?"metres":"metres · combined sea",()=>cols.map(c=>`<span class="${c.night?"nt":""}">${badge(c.p,true)}</span>`).join("")),
    R("r-sm","",FROM,()=>cols.map(c=>`<span class="${c.night?"nt":""}">${dirPer(c.p)}</span>`).join("")),
    R("r-en","Energy",split?"kJ · primary":"kJ",()=>cols.map((c,i)=>{const e=c.p?energy(c.p.h,c.p.t):null;if(e==null)return "<span></span>";const rgb=eCol(e),dark=["200,52,68","125,42,110","238,106,57"].includes(rgb);
      return `<span class="en${c.first?" f":""}${cols[i+1]&&!cols[i+1].first?"":" l"}${c.night?" nt":""}" style="background:rgb(${rgb});color:${dark?"#fbf5e6":"#23312f"}" title="${eRange(e)}">${eLab(e)}</span>`}).join("")),
    ...(!split?[]:[R("r-mid","Secondary","metres",()=>cols.map(c=>`<span class="${c.night?"nt":""}">${hasS?badge(c.s,false):""}</span>`).join("")),
    R("r-sm","",FROM,()=>cols.map(c=>`<span class="${c.night?"nt":""}">${dirPer(c.s)}</span>`).join("")),
    R("r-mid","Tertiary","metres",()=>cols.map(c=>`<span class="${c.night?"nt":""}">${hasT?badge(c.t,false):""}</span>`).join("")),
    R("r-sm","",FROM,()=>cols.map(c=>`<span class="${c.night?"nt":""}">${dirPer(c.t)}</span>`).join(""))]),
    R("r-wind","Wind","knots",()=>cols.map(c=>c.w?`<span class="wd${c.night?" nt":""}" title="${c.w.kn} kn, gusts ${c.w.g} kn${c.w.d!=null?`, from ${comp(c.w.d)}`:""}"><i style="background:${barCol(c.w.g)}"></i>${c.w.d!=null?arrow(c.w.d):""}<small>${c.w.kn}</small></span>`:"<span></span>").join("")),
    R("r-src","Source","",()=>{let h="",i=0;while(i<cols.length){const m=cols[i].m;let j=i;while(j<cols.length&&cols[j].m===m)j++;if(m)h+=`<span class="src s-${m}" style="grid-column:${i+1}/${j+1}"><em>${SRC[m]||m}</em></span>`;i=j}return h})];
  const labs=rows.map(r=>`<div class="sw-l ${r.cls}">${r.cls==="r-graph"?gr.ticks.map(t=>`<span style="top:${t.y.toFixed(0)}px">${t.t}m</span>`).join(""):r.lab?`<b>${r.lab}</b>${r.sub?`<small>${r.sub}</small>`:""}`:r.sub?`<small>${r.sub}</small>`:""}</div>`).join("");
  const body=rows.map(r=>`<div class="sw-r ${r.cls}">${r.cls==="r-graph"?gr.svg:r.cells()}</div>`).join("");
  const sl=$("sw-scroll")?.scrollLeft,st=$("sw-body")?.scrollTop;
  box.style.setProperty("--cw",cw+"px");box.style.setProperty("--n",cols.length);box.style.setProperty("--gh",GH+"px");
  box.innerHTML=`<div class="sw-key">${split?`<span><i class="k-p"></i>Primary</span>${hasS?`<span><i class="k-s"></i>Secondary</span>`:""}${hasT?`<span><i class="k-t"></i>Tertiary</span>`:""}`:`<span><i class="k-p"></i>Combined sea</span><span class="note">Swell trains arrive with the next data update</span>`}<span class="k-per">period <i></i> short → long</span></div>
    <div class="sw-body" id="sw-body"><div class="sw-labs">${labs}</div><div class="sw-scroll" id="sw-scroll"><div class="sw-in">${body}<div class="sw-now" id="sw-now"></div></div></div></div>`;
  const sc=$("sw-scroll");
  sc.addEventListener("click",e=>{if(e.target.closest("a,button"))return;const r=sc.querySelector(".sw-in").getBoundingClientRect(),i=Math.floor((e.clientX-r.left)/cw);const c=cols[i];if(!c)return;setPlaying(false);setTime(c.T)});
  if(sl!=null&&!isNaN(sl)){sc.scrollLeft=sl;$("sw-body").scrollTop=st||0}else{const x=nowX(cw);sc.scrollLeft=Math.max(0,x-sc.clientWidth*.22)}
  lastNow=-1;mark();
  // let the drawing take whatever height is left (or give some back on short screens)
  if(!ghFit){const b=$("sw-body"),l=b.querySelector(".sw-labs"),spare=Math.round(b.getBoundingClientRect().bottom-l.lastElementChild.getBoundingClientRect().bottom-4);
    if(spare>12||(spare<-8&&GH>96)){const g2=Math.round(Math.max(90,Math.min(narrow?150:210,GH+spare-6)));if(Math.abs(g2-GH)>6)render(s,g2)}}}
const SRC={pde:"Puertos del Estado",gib:"Strait model · fine",ibi:"IBI regional · 2.5 km",out:"Outlook · global"};

function nowX(cw){if(!cols.length)return 0;let i=0;for(let k=0;k<cols.length;k++)if(cols[k].T<=curT+1e-6)i=k;const c=cols[i];
  return (i+Math.max(0,Math.min(1,curT-c.T+.5)))*cw}
function mark(){const m=$("sw-now");if(!m||!cols.length)return;const cw=parseFloat(getComputedStyle($("sw")).getPropertyValue("--cw"))||42;
  const t=Math.round(curT*4)/4;if(t===lastNow)return;lastNow=t;
  m.style.transform=`translateX(${nowX(cw).toFixed(1)}px)`;
  const h=Math.round(curT);$("sw").querySelectorAll(".r-hr span").forEach((e,i)=>e.classList.toggle("cur",cols[i]&&cols[i].T===h))}

function mini(s){const o=FC&&FC.spots[s.id],el=$("i-wmini");if(!o){el.innerHTML="";return}
  const T=Math.round(curT),kn=o.kn[T],g=Math.max(o.gust[T]??kn??0,kn??0),d=o.dir[T],from=Math.max(0,Math.floor(curT/24)*24),seg=[];
  for(let k=from;k<Math.min(N,from+72);k++)seg.push(o.kn[k]==null?"transparent":barCol(Math.max(o.gust[k]??o.kn[k],o.kn[k])));
  el.innerHTML=`<span class="wm-l">Wind</span>${kn!=null?`<span class="wm-now">${d!=null?arrow(d):""}<b>${kn}</b><small>kn · gusts ${g}${d!=null?` · from ${comp(d)}`:""}</small></span>`:""}<span class="wm-strip" aria-hidden="true">${seg.map((c,i)=>`<i style="background:${c}"${i===T-from?' class="c"':""}></i>`).join("")}</span><span class="wm-go">Show wind <span aria-hidden="true">↙</span></span>`;
  el.setAttribute("aria-label","Show the wind table again")}

function place(){const f=fcEl();if(!open){f.style.top="";return}
  const h=document.getElementById("i-name").getBoundingClientRect(),i=$("info").getBoundingClientRect();f.style.top=Math.round(h.bottom-i.top+(innerHeight<560?8:16))+"px"}

function apply(on){open=on;document.body.classList.toggle("swell",on);$("sw").hidden=!on;
  const b=$("i-swell");b.setAttribute("aria-expanded",on);b.innerHTML=on?'Wind &amp; waves <span aria-hidden="true">↙</span>':'Wave details <span aria-hidden="true">↗</span>';
  $("i-wlab").textContent=on?"Wave details · swell trains":"Waves · metres · period";$("i-wmini").tabIndex=on?0:-1;
  place();if(on&&selected){render(selected);mini(selected)}}
function toggle(on,instant){if(on===open&&!busy)return;const f=fcEl();clearTimeout(busy);
  f.getAnimations&&f.getAnimations().forEach(a=>a.cancel());
  if(instant||reduce||!f.animate){busy=0;apply(on);return}
  let done=false;const swap=()=>{if(done)return;done=true;apply(on);
    f.animate([{opacity:0,transform:"translateY(16px)"},{opacity:1,transform:"none"}],{duration:460,easing:"cubic-bezier(.2,.8,.2,1)"});out.cancel();busy=0};
  const out=f.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateY(8px)"}],{duration:190,easing:"ease-in",fill:"forwards"});
  out.onfinish=swap;busy=setTimeout(swap,400)}           // never left half-way, even if the animation is dropped

$("i-swell").addEventListener("click",e=>{e.stopPropagation();toggle(!open)});
$("i-wmini").addEventListener("click",e=>{e.stopPropagation();toggle(false)});
$("b-wind").addEventListener("click",e=>{if(open&&!e.target.closest("button:not(#i-wmini)"))toggle(false)});
addEventListener("resize",()=>{if(!open)return;place();clearTimeout(rz);rz=setTimeout(()=>selected&&render(selected),150)});let rz=0;

window.swellOpen=()=>open;
window.swellClose=instant=>toggle(false,instant);
window.swellFill=s=>{const has=FC&&FC.spots[s.id]&&FC.spots[s.id].wh.some(v=>v!=null);$("i-swell").hidden=!has;
  if(!open)return;if(!has){toggle(false,true);return}
  const k=s.id+":"+(FC&&FC.meta.generated);if(k!==key)render(s);else mark();mini(s)};
})();
