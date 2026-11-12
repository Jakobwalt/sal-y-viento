/* Wave details and wind details. One of the two spot panels opens to the full spot view and the other
   folds into a slim bar; tapping the bar (or "Wind & waves") brings both tables back.
   One column per hour (06–21), a drawing on top, then the numbers.
   - Waves: a drawn wave per three hours (larger screens), primary swell (height, direction, period,
     energy), secondary swell, tide, wind in brief. The map shows waves while open.
   - Wind: mean-wind bars with the gusts as caps, wind (coloured as on the map), gusts, direction,
     weather, tide, waves in brief. The map shows wind while open.
   Reads the per-spot arrays in FC.spots; if the swell partitions (s1h…s2d) are not there, the combined
   sea (wh/wp/wd) stands in for the primary swell. */
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
const ECUT=[200,500,1000,2000,3000,5000,8000,12000];
const ECOL=["233,238,232","251,245,230","196,230,160","118,194,112","243,194,90","240,151,62","238,106,57","200,52,68","125,42,110"];
const eCol=e=>{let i=0;while(i<ECUT.length&&e>=ECUT[i])i++;return ECOL[i]};
// period colour (on the period number only): longer period, deeper blue
const PCOL=[[5,[205,230,226]],[8,[138,196,214]],[11,[78,143,196]],[14,[58,94,174]],[17,[64,55,143]]];
const pCol=t=>{if(t==null)return "rgb(138,196,214)";for(let i=0;i<PCOL.length-1;i++){const [a,ca]=PCOL[i],[b,cb]=PCOL[i+1];if(t<=b){const k=Math.max(0,(t-a)/(b-a));return `rgb(${ca.map((c,n)=>Math.round(c+(cb[n]-c)*k))})`}}return `rgb(${PCOL.at(-1)[1]})`};

const M={waves:{box:"sw",mini:"i-wmini",btn:"i-swell",layer:"waves"},wind:{box:"wx",mini:"i-vmini",btn:"i-wdet",layer:"wind"}};
let mode=null,key="",cols=[],busy=0,lastNow=-1,prevLayer=null;
const boxEl=()=>mode&&$(M[mode].box);

/* ---------- data ---------- */
function at(o,k,T){const a=o[k];return a&&a[T]!=null?a[T]:null}
function cell(o,T){
  const split=Array.isArray(o.s1h)&&o.s1h.some(v=>v!=null);
  const p=split?{h:at(o,"s1h",T),t:at(o,"s1p",T),d:at(o,"s1d",T)}:{h:at(o,"wh",T),t:at(o,"wp",T),d:at(o,"wd",T)};
  const tr=(a,b,c)=>{const h=at(o,a,T);return h!=null&&h>=.05?{h,t:at(o,b,T),d:at(o,c,T)}:null};
  const kn=at(o,"kn",T);
  return{T,split,p:p.h!=null?p:null,s:tr("s2h","s2p","s2d"),
    sea:at(o,"wh",T)==null?null:{h:at(o,"wh",T),t:at(o,"wp",T),d:at(o,"wd",T)},
    w:kn==null?null:{kn,g:Math.max(at(o,"gust",T)??0,kn),d:at(o,"dir",T)},
    wx:{temp:at(o,"temp",T),rain:at(o,"rain",T),cloud:at(o,"cloud",T)},
    m:at(o,"wm",T)||(p.h!=null?"pde":null),wm:FC.model[T]||null}}
// sunrise / sunset as hours since T0 (NOAA's simple solar equations; a few minutes is plenty here)
function sun(d,lat,lon){
  const noon=atHour(d*24+12),J=noon.getTime()/864e5+2440587.5,n=Math.round(J-2451545+.0008),Js=n-lon/360,r=Math.PI/180;
  const Mm=(357.5291+.98560028*Js)%360,C=1.9148*Math.sin(Mm*r)+.02*Math.sin(2*Mm*r)+.0003*Math.sin(3*Mm*r),L=(Mm+C+282.9372)%360;
  const Jt=2451545+Js+.0053*Math.sin(Mm*r)-.0069*Math.sin(2*L*r),sd=Math.sin(L*r)*Math.sin(23.44*r),cd=Math.cos(Math.asin(sd));
  const cw=(Math.sin(-.833*r)-Math.sin(lat*r)*sd)/(Math.cos(lat*r)*cd);if(cw<-1||cw>1)return null;
  const w=Math.acos(cw)/r/360,hr=j=>((j-2440587.5)*864e5-T0.getTime())/3600e3;return[hr(Jt-w),hr(Jt+w)]}

function collect(s,md){const o=FC&&FC.spots[s.id];if(!o)return[];const out=[];
  for(let d=0;d<NDAYS;d++){const day=[];for(let h=H0;h<=H1;h++){const T=d*24+h;if(T<N)day.push(cell(o,T))}
    if(!day.some(c=>md==="wind"?c.w:c.p))continue;const st=sun(d,s.lat,s.lon);
    day.forEach((c,i)=>{c.d=d;c.first=i===0;c.night=st?(c.T<st[0]-.5||c.T>st[1]+.5):false;out.push(c)})}
  return out}
const hasData=(s,md)=>{const o=FC&&FC.spots[s.id];return !!o&&(md==="wind"?o.kn:o.wh).some(v=>v!=null)};

/* ---------- drawings ---------- */
// a curling wave in a unit box (u to the right, v up); it breaks to the right
const WAVE=[[0,0],[.22,.02,.42,.45,.58,.86],[.66,1.02,.84,1.04,.94,.88],[.99,.8,.96,.7,.9,.73],[.85,.76,.8,.66,.8,.55],[.8,.35,.88,.12,1,0]];
function wavePath(x0,base,w,h){const P=(u,v)=>`${(x0+u*w).toFixed(1)} ${(base-v*h).toFixed(1)}`;
  return "M"+P(...WAVE[0])+WAVE.slice(1).map(s=>"C"+P(s[0],s[1])+" "+P(s[2],s[3])+" "+P(s[4],s[5])).join("")+"Z"}
function backLine(x0,base,w,h){const P=(u,v)=>`${(x0+u*w).toFixed(1)} ${(base-v*h).toFixed(1)}`;return `M${P(.08,0)}C${P(.28,.04)} ${P(.44,.45)} ${P(.58,.86)}C${P(.66,1.02)} ${P(.84,1.04)} ${P(.93,.89)}`}
function frame(cw,GH,base,ticks,Y){const W=cols.length*cw;
  let g=`<svg class="sw-g" width="${W}" height="${GH}" viewBox="0 0 ${W} ${GH}" aria-hidden="true"><defs><linearGradient id="sw-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;
  cols.forEach((c,i)=>{if(c.night)g+=`<rect x="${i*cw}" y="0" width="${cw}" height="${GH}" fill="rgba(16,28,44,.16)"/>`;if(c.first&&i)g+=`<line x1="${i*cw}" x2="${i*cw}" y1="2" y2="${GH}" stroke="rgba(251,245,230,.28)"/>`});
  for(const t of ticks)g+=`<line x1="0" x2="${W}" y1="${(base-Y(t)).toFixed(1)}" y2="${(base-Y(t)).toFixed(1)}" stroke="rgba(251,245,230,.14)" stroke-dasharray="2 5"/>`;
  return g+`<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(251,245,230,.4)"/>`}
function waveGraph(cw,GH){const base=GH-8,top=12;
  // three-hour blocks within each day (06–08, 09–11 … 18–21); the mean height of each block
  const blk=c=>Math.min(4,Math.floor((hourOf(c.T)-H0)/3));
  const groups=[];cols.forEach((c,i)=>{const g=groups.at(-1);if(g&&g.d===c.d&&blk(c)===g.k)g.n++;else groups.push({i,n:1,d:c.d,k:blk(c)})});
  const mean=(g,k)=>{const v=cols.slice(g.i,g.i+g.n).map(c=>c[k]?.h).filter(x=>x!=null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
  groups.forEach(g=>{g.p=mean(g,"p");g.s=mean(g,"s")});
  const hmax=Math.max(1.5,...groups.flatMap(g=>[g.p??0,g.s??0]))*1.08,Y=h=>Math.max(0,h)/hmax*(base-top);
  const ticks=[.5,1,1.5,2,3,4,5,6,8,10].filter(t=>t<=hmax&&(hmax<2.6||t>=1)&&(hmax<5||t%1===0)&&(hmax<7||t%2===0));
  let g=frame(cw,GH,base,ticks,Y);
  for(const gr of groups){const gw=gr.n*cw,x=gr.i*cw;
    for(const [k,v] of [["s",gr.s],["p",gr.p]]){if(v==null)continue;const h=Y(v),w=Math.min(gw*1.25,Math.max(cw*2.4,h*1.05)),x0=x+(gw-w)/2+(k==="s"?-w*.12:0);
      if(h<4){g+=`<path d="M${x0} ${base-1}q${w/4} -4 ${w/2} 0t${w/2} 0" fill="none" stroke="rgba(251,245,230,${k==="p"?.8:.5})" stroke-width="1.3"/>`;continue}
      const d=wavePath(x0,base,w,h);
      if(k==="p"){g+=`<path d="${d}" fill="rgb(112,166,204)" stroke="rgba(251,245,230,.92)" stroke-width="1.1"/><path d="${d}" fill="url(#sw-sheen)"/>`;
        if(h>16)for(const f of [.7,.42])g+=`<path d="${backLine(x0+w*(1-f)*.62,base,w*f,h*f)}" fill="none" stroke="rgba(251,245,230,${f>.5?.4:.28})" stroke-width=".9"/>`}
      else g+=`<path d="${d}" fill="rgba(251,245,230,.16)" stroke="rgba(251,245,230,.75)" stroke-width="1" stroke-dasharray="3 2"/>`}}
  return{svg:g+"</svg>",ticks:ticks.map(t=>({t,y:base-Y(t),u:"m"}))}}
// wind: a bar per hour for the mean wind (coloured as on the map), a cap on a fine stem for the gusts
function windGraph(cw,GH){const base=GH-8,top=14,gmax=Math.max(25,...cols.map(c=>c.w?c.w.g:0))*1.08,Y=v=>Math.max(0,v)/gmax*(base-top);
  const ticks=[10,20,30,40,50,60].filter(t=>t<=gmax);let g=frame(cw,GH,base,ticks,Y);
  cols.forEach((c,i)=>{if(!c.w)return;const x=i*cw,bw=Math.max(6,cw*.46),bx=x+(cw-bw)/2,yk=base-Y(c.w.kn),yg=base-Y(c.w.g),cx=x+cw/2;
    if(c.w.g>c.w.kn+.5)g+=`<line x1="${cx}" x2="${cx}" y1="${yk.toFixed(1)}" y2="${yg.toFixed(1)}" stroke="rgba(251,245,230,.55)" stroke-width="1" stroke-dasharray="1.5 2"/><line x1="${(cx-bw*.42).toFixed(1)}" x2="${(cx+bw*.42).toFixed(1)}" y1="${yg.toFixed(1)}" y2="${yg.toFixed(1)}" stroke="#fbf5e6" stroke-width="2" stroke-linecap="round"/>`;
    g+=`<rect x="${bx.toFixed(1)}" y="${yk.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,base-yk).toFixed(1)}" rx="2" fill="${barCol(c.w.kn)}" stroke="rgba(251,245,230,.5)" stroke-width=".8" ${c.wm==="ecmwf"?'fill-opacity=".75"':""}/>`});
  return{svg:g+"</svg>",ticks:ticks.map(t=>({t,y:base-Y(t),u:"kn"}))}}

const badge=(v,big)=>v?`<b class="ht${big?"":" sec"}" title="${v.h.toFixed(1)} m${v.t!=null?` · ${Math.round(v.t)} s`:""}${v.d!=null?` · from ${comp(v.d)} ${Math.round(v.d)}°`:""}">${v.h<10?v.h.toFixed(1):Math.round(v.h)}</b>`:"<i>·</i>";
const perPill=t=>`<i class="pp" style="background:${pCol(t)};color:${t>=10.5?"#fbf5e6":"#23312f"}">${Math.round(t)}s</i>`;
const dirPer=v=>v?`<span class="dp" title="${v.d!=null?`from ${comp(v.d)} ${Math.round(v.d)}°`:""}${v.t!=null?` · ${Math.round(v.t)} s`:""}">${v.d!=null?arrow(v.d):""}${v.t!=null?perPill(v.t):""}</span>`:"";
const knPill=kn=>`<b class="kp" style="background:${barCol(kn)}">${kn}</b>`;
function skyOf(wx,night){if(wx.rain!=null&&wx.rain>=.2)return "rain";if(wx.cloud!=null&&wx.cloud>=60)return "cloud";return night?"night":"sun"}
const MOON='<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9.6 10.8A4.6 4.6 0 0 1 5.2 3.2a4.6 4.6 0 1 0 4.4 7.6Z" fill="currentColor"/></svg>';
const SRC={pde:"Puertos del Estado · fine",mf:"Météo-France MFWAM · outlook",gib:"Strait model · fine",ibi:"IBI regional · 2.5 km",out:"Outlook · global",
  aemet:"AEMET HARMONIE · 2.5 km",ecmwf:"ECMWF IFS · 9 km · outlook"};
const span=(cls,inner,c)=>`<span class="${cls||""}${c&&c.night?" nt":""}">${inner}</span>`;
function bands(field,label){let h="",i=0;while(i<cols.length){const m=field(cols[i]);let j=i;while(j<cols.length&&field(cols[j])===m)j++;if(m)h+=`<span class="src s-${m}" style="grid-column:${i+1}/${j+1}"><em>${label(m)}</em></span>`;i=j}return h}

function rowsFor(s,md,narrow,cw,gr){const R=(cls,lab,sub,cells)=>({cls,lab,sub,cells}),FROM=narrow?"from · s":"from · period";
  const o=FC.spots[s.id],hasTide=!!tideRange(o),head=[
    R("r-day","","",()=>{let h="",i=0;while(i<cols.length){const d=cols[i].d;let j=i;while(j<cols.length&&cols[j].d===d)j++;h+=`<span class="sw-day" style="grid-column:${i+1}/${j+1}"><em>${dayName(d)}</em></span>`;i=j}return h}),
    R("r-hr","","",()=>cols.map(c=>span(c.night?"nt":"",String(hourOf(c.T)).padStart(2,"0"))).join("")),
    ...(gr?[R("r-graph","","",null)]:[])],
    tide=hasTide?[R("r-tide","Tide","high · low",()=>tideRow(s,cw))]:[];
  if(md==="wind"){const hasWx=cols.some(c=>c.wx.temp!=null),hasSea=cols.some(c=>c.sea);
    return[...head,
      R("r-big","Wind","knots · mean",()=>cols.map(c=>span("",c.w?knPill(c.w.kn):"<i>·</i>",c)).join("")),
      R("r-mid","Gusts","knots",()=>cols.map(c=>span("",c.w?`<b class="ht sec">${c.w.g}</b>`:"",c)).join("")),
      R("r-sm","","from",()=>cols.map(c=>span("",c.w&&c.w.d!=null?`<span class="dp" title="from ${comp(c.w.d)} ${Math.round(c.w.d)}°">${arrow(c.w.d)}<small class="cp">${comp(c.w.d)}</small></span>`:"",c)).join("")),
      ...(hasWx?[R("r-wx","Weather","°C · rain mm",()=>cols.map(c=>{const w=c.wx;if(w.temp==null)return span("","",c);const k=skyOf(w,c.night);
        return span("wxc",`<span class="sk sk-${k}">${k==="night"?MOON:SKY[k]}</span><small>${Math.round(w.temp)}°</small>${w.rain>=.1?`<small class="rn">${w.rain<1?w.rain.toFixed(1):Math.round(w.rain)}</small>`:""}`,c)}).join(""))]:[]),
      ...tide,
      ...(hasSea?[R("r-wind","Waves","metres · s",()=>cols.map(c=>c.sea?span("wd",`<small class="wvh">${c.sea.h.toFixed(1)}</small>${c.sea.t!=null?`<small>${Math.round(c.sea.t)}s</small>`:""}`,c):span("","",c)).join(""))]:[]),
      R("r-src","Source","",()=>bands(c=>c.w?c.wm:null,m=>(SRC[m]||m)+(s.custom?" · map grid":"")))]}
  const split=cols.some(c=>c.split),hasS=cols.some(c=>c.s);
  return[...head,
    R("r-big",split?"Primary swell":"Waves",split?"metres":"metres · combined sea",()=>cols.map(c=>span("",badge(c.p,true),c)).join("")),
    R("r-sm","",FROM,()=>cols.map(c=>span("",dirPer(c.p),c)).join("")),
    R("r-en","Energy",split?"kJ · primary":"kJ",()=>cols.map((c,i)=>{const e=c.p?energy(c.p.h,c.p.t):null;if(e==null)return "<span></span>";const rgb=eCol(e),dark=["200,52,68","125,42,110","238,106,57"].includes(rgb);
      return `<span class="en${c.first?" f":""}${cols[i+1]&&!cols[i+1].first?"":" l"}${c.night?" nt":""}" style="background:rgb(${rgb});color:${dark?"#fbf5e6":"#23312f"}" title="${eRange(e)}">${eLab(e)}</span>`}).join("")),
    ...(!split?[]:[R("r-mid","Secondary","metres",()=>cols.map(c=>span("",hasS?badge(c.s,false):"",c)).join("")),
      R("r-sm","",FROM,()=>cols.map(c=>span("",dirPer(c.s),c)).join(""))]),
    ...tide,
    R("r-wind","Wind","knots",()=>cols.map(c=>c.w?`<span class="wd${c.night?" nt":""}" title="${c.w.kn} kn, gusts ${c.w.g} kn${c.w.d!=null?`, from ${comp(c.w.d)}`:""}"><i style="background:${barCol(c.w.kn)}"></i>${c.w.d!=null?arrow(c.w.d):""}<small>${c.w.kn}</small></span>`:"<span></span>").join("")),
    R("r-src","Source","",()=>bands(c=>c.m,m=>(SRC[m]||m)+(s.custom?" · map grid":"")))]}

function render(s,ghFit){if(!s||!mode)return;const md=mode,box=boxEl();cols=collect(s,md);key=md+":"+s.id+":"+(FC&&FC.meta.generated);
  const narrow=innerWidth<760,short=innerHeight<560,cw=narrow?32:42;
  const GH=ghFit||(md==="wind"?(short?80:narrow?96:112):(short?92:narrow?120:140));
  if(!cols.length){box.innerHTML=`<p class="sw-empty">No ${md==="wind"?"wind":"wave"} forecast here right now.</p>`;return}
  const pic=md==="wind"||!narrow,gr=pic?(md==="wind"?windGraph(cw,GH):waveGraph(cw,GH)):null;
  const rows=rowsFor(s,md,narrow,cw,gr);
  const labs=rows.map(r=>`<div class="sw-l ${r.cls}">${r.cls==="r-graph"?gr.ticks.map(t=>`<span style="top:${t.y.toFixed(0)}px">${t.t}${t.u}</span>`).join(""):r.lab?`<b>${r.lab}</b>${r.sub?`<small>${r.sub}</small>`:""}`:r.sub?`<small>${r.sub}</small>`:""}</div>`).join("");
  const body=rows.map(r=>`<div class="sw-r ${r.cls}">${r.cls==="r-graph"?gr.svg:r.cells()}</div>`).join("");
  const sl=box.querySelector(".sw-scroll")?.scrollLeft,st=box.querySelector(".sw-body")?.scrollTop;
  box.style.setProperty("--cw",cw+"px");box.style.setProperty("--n",cols.length);box.style.setProperty("--gh",GH+"px");
  const split=cols.some(c=>c.split),hasS=cols.some(c=>c.s);
  const keyline=md==="wind"
    ?`<span><i class="k-bar"></i>bar = mean wind</span><span><i class="k-cap"></i>cap = gusts</span><span class="k-3h">colours as on the map</span>`
    :`${split?`<span><i class="k-p"></i>Primary</span>${hasS?`<span><i class="k-s"></i>Secondary</span>`:""}`:`<span><i class="k-p"></i>Combined sea</span>${s.custom?`<span class="note">Swell trains are only worked out at the named spots</span>`:""}`}<span class="k-per">period <i></i> short → long</span><span class="k-3h">drawn per 3 hours</span>`;
  box.innerHTML=`<div class="sw-key">${keyline}</div>
    <div class="sw-body"><div class="sw-labs">${labs}</div><div class="sw-scroll"><div class="sw-in">${body}<div class="sw-now"></div></div></div></div>`;
  const sc=box.querySelector(".sw-scroll");
  sc.addEventListener("click",e=>{if(e.target.closest("a,button"))return;const r=sc.querySelector(".sw-in").getBoundingClientRect(),i=Math.floor((e.clientX-r.left)/cw);const c=cols[i];if(!c)return;setPlaying(false);setTime(c.T)});
  if(sl!=null&&!isNaN(sl)){sc.scrollLeft=sl;box.querySelector(".sw-body").scrollTop=st||0}else{const x=nowX(cw);sc.scrollLeft=Math.max(0,x-sc.clientWidth*.22)}
  lastNow=-1;mark();
  // let the drawing take whatever height is left (or give some back on short screens)
  if(!ghFit&&pic){const b=box.querySelector(".sw-body"),l=b.querySelector(".sw-labs"),spare=Math.round(b.getBoundingClientRect().bottom-l.lastElementChild.getBoundingClientRect().bottom-4);
    if(!narrow&&(spare>12||(spare<-8&&GH>96))){const g2=Math.round(Math.max(90,Math.min(md==="wind"?200:180,GH+spare-6)));if(Math.abs(g2-GH)>6)render(s,g2)}}}
// the tide as one curve under the columns (each day's 06–21 stretch), with high and low water marked
function tideRow(s,cw){const o=FC.spots[s.id],rg=tideRange(o),H=54,top=15,bot=H-15,W=cols.length*cw;
  const Y=v=>bot-(v-rg[0])/Math.max(.2,rg[1]-rg[0])*(bot-top);let g=`<svg class="sw-tide" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
  let i=0;while(i<cols.length){const d=cols[i].d;let j=i;while(j<cols.length&&cols[j].d===d)j++;
    const a=cols[i].T-.5,b=cols[j-1].T+.5,X=t=>(i+(t-a))*cw,pts=[];
    for(let t=a;t<=b+1e-6;t+=.25){const v=tideAt(o,t);if(v!=null)pts.push([X(t),Y(v)])}
    if(pts.length>1){const line="M"+pts.map(p=>p[0].toFixed(1)+" "+p[1].toFixed(1)).join("L");
      g+=`<path d="${line}L${pts.at(-1)[0].toFixed(1)} ${bot+6}L${pts[0][0].toFixed(1)} ${bot+6}Z" fill="rgba(251,245,230,.1)"/><path d="${line}" fill="none" stroke="rgba(251,245,230,.8)" stroke-width="1.4"/>`;
      for(const e of tideTurns(o,a,b)){const x=X(e.t),y=Y(e.h);
        g+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${e.hi?"#fbf5e6":"none"}" stroke="#fbf5e6" stroke-width="1.2"/><text x="${x.toFixed(1)}" y="${(e.hi?y-6:y+12).toFixed(1)}" text-anchor="middle">${hm(e.t)} <tspan>${tsign(e.h)}</tspan></text>`}}
    i=j}
  return g+"</svg>"}

function nowX(cw){if(!cols.length)return 0;let i=0;for(let k=0;k<cols.length;k++)if(cols[k].T<=curT+1e-6)i=k;const c=cols[i];
  return (i+Math.max(0,Math.min(1,curT-c.T+.5)))*cw}
function mark(){const box=boxEl();if(!box)return;const m=box.querySelector(".sw-now");if(!m||!cols.length)return;const cw=parseFloat(getComputedStyle(box).getPropertyValue("--cw"))||42;
  const t=Math.round(curT*4)/4;if(t===lastNow)return;lastNow=t;
  m.style.transform=`translateX(${nowX(cw).toFixed(1)}px)`;
  const h=Math.round(curT);box.querySelectorAll(".r-hr span").forEach((e,i)=>e.classList.toggle("cur",cols[i]&&cols[i].T===h))}

// the folded panel: what it shows now, and a strip of the next three days
function mini(s){const o=FC&&FC.spots[s.id];if(!mode)return;const el=$(M[mode].mini);if(!o){el.innerHTML="";return}
  const T=Math.round(curT),from=Math.max(0,Math.floor(curT/24)*24),seg=[];
  if(mode==="waves"){const kn=o.kn[T],g=Math.max(o.gust[T]??kn??0,kn??0),d=o.dir[T];
    for(let k=from;k<Math.min(N,from+72);k++)seg.push(o.kn[k]==null?"transparent":barCol(o.kn[k]));
    el.innerHTML=`<span class="wm-l">Wind</span>${kn!=null?`<span class="wm-now">${d!=null?arrow(d):""}<b>${kn}</b><small>kn · gusts ${g}${d!=null?` · from ${comp(d)}`:""}</small></span>`:""}${strip(seg,T-from)}<span class="wm-go">Show wind <span aria-hidden="true">↙</span></span>`;
    el.setAttribute("aria-label","Show the wind table again")}
  else{const h=o.wh[T],p=o.wp[T],d=o.wd[T];
    for(let k=from;k<Math.min(N,from+72);k++)seg.push(o.wh[k]==null?"transparent":waveCol(o.wh[k]));
    el.innerHTML=`<span class="wm-l">Waves</span>${h!=null?`<span class="wm-now">${d!=null?arrow(d):""}<b>${h.toFixed(1)}</b><small>m${p!=null?` · ${Math.round(p)} s`:""}${d!=null?` · from ${comp(d)}`:""}</small></span>`:""}${strip(seg,T-from)}<span class="wm-go">Show waves <span aria-hidden="true">↙</span></span>`;
    el.setAttribute("aria-label","Show the waves table again")}}
const strip=(seg,cur)=>`<span class="wm-strip" aria-hidden="true">${seg.map((c,i)=>`<i style="background:${c}"${i===cur?' class="c"':""}></i>`).join("")}</span>`;

function place(){const f=fcEl();if(!mode){f.style.top="";return}
  const h=$("i-head").getBoundingClientRect(),i=$("info").getBoundingClientRect();f.style.top=Math.round(h.bottom-i.top+(innerHeight<560?8:16))+"px"}

function labels(){
  const w=$("i-wdet"),v=$("i-swell");
  w.setAttribute("aria-expanded",mode==="wind");v.setAttribute("aria-expanded",mode==="waves");
  w.innerHTML=mode==="wind"?'Wind &amp; waves <span aria-hidden="true">↙</span>':'Wind details <span aria-hidden="true">↗</span>';
  v.innerHTML=mode==="waves"?'Wind &amp; waves <span aria-hidden="true">↙</span>':'Wave details <span aria-hidden="true">↗</span>';
  $("i-klab").textContent=mode==="wind"?"Wind details · hourly":"Wind · knots";
  $("i-wlab").textContent=mode==="waves"?"Wave details · swell trains":"Waves · metres · period · tide";
  $("i-wmini").tabIndex=mode==="waves"?0:-1;$("i-vmini").tabIndex=mode==="wind"?0:-1}
function apply(md){mode=md;const b=document.body;b.classList.toggle("swell",!!md);b.classList.toggle("dx-waves",md==="waves");b.classList.toggle("dx-wind",md==="wind");
  $("sw").hidden=md!=="waves";$("wx").hidden=md!=="wind";if(md!=="waves")$("sw").innerHTML="";if(md!=="wind")$("wx").innerHTML="";
  labels();
  // the map behind follows the panel that is open, and goes back to what it was after
  if(md){if(prevLayer==null)prevLayer=layer;if(layer!==M[md].layer)setLayer(M[md].layer)}
  else if(prevLayer!=null){const p=prevLayer;prevLayer=null;if(layer!==p)setLayer(p)}
  key="";place();if(md&&selected){render(selected);mini(selected)}}
function toggle(md,instant){if(md===mode&&!busy)return;const f=fcEl();clearTimeout(busy);
  f.getAnimations&&f.getAnimations().forEach(a=>a.cancel());
  if(instant||reduce||!f.animate){busy=0;apply(md);return}
  let done=false;const swap=()=>{if(done)return;done=true;apply(md);
    f.animate([{opacity:0,transform:"translateY(16px)"},{opacity:1,transform:"none"}],{duration:460,easing:"cubic-bezier(.2,.8,.2,1)"});out.cancel();busy=0};
  const out=f.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateY(8px)"}],{duration:190,easing:"ease-in",fill:"forwards"});
  out.onfinish=swap;busy=setTimeout(swap,400)}           // never left half-way, even if the animation is dropped

$("i-swell").addEventListener("click",e=>{e.stopPropagation();toggle(mode==="waves"?null:"waves")});
$("i-wdet").addEventListener("click",e=>{e.stopPropagation();toggle(mode==="wind"?null:"wind")});
$("i-wmini").addEventListener("click",e=>{e.stopPropagation();toggle(null)});
$("i-vmini").addEventListener("click",e=>{e.stopPropagation();toggle(null)});
$("b-wind").addEventListener("click",e=>{if(mode==="waves"&&!e.target.closest("button:not(#i-wmini)"))toggle(null)});
$("b-wave").addEventListener("click",e=>{if(mode==="wind"&&!e.target.closest("button:not(#i-vmini)"))toggle(null)});
let rz=0;addEventListener("resize",()=>{if(!mode)return;place();clearTimeout(rz);rz=setTimeout(()=>selected&&render(selected),150)});

window.swellOpen=()=>!!mode;
window.swellClose=instant=>toggle(null,instant);
window.swellFill=s=>{const hw=hasData(s,"waves"),hk=hasData(s,"wind");$("i-swell").hidden=!hw;$("i-wdet").hidden=!hk;
  if(!mode)return;if(!hasData(s,mode)){toggle(null,true);return}
  const k=mode+":"+s.id+":"+(FC&&FC.meta.generated);if(k!==key)render(s);else mark();mini(s)};
})();
