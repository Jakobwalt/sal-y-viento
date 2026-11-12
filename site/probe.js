/* Tap anywhere on the map: a pin with the wind (or the waves, on the waves map) at that place and time.
   Tapping the card opens a spot view for that place, built from the forecast grids: wind, gusts and
   direction everywhere; waves wherever the wave model has sea; the tide of the nearest named spot
   (if it is close). Temperature, rain, cloud, swell trains and the beach view exist only for the
   named spots. */
(()=>{
const $=id=>document.getElementById(id);
const box=$("probe");
const COMP=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const comp=d=>COMP[Math.round((((d%360)+360)%360)/22.5)%16];
let pw=null,lon=0,lat=0,n=0;

const km=(a,b,c,d)=>Math.hypot((c-a)*111.3*Math.cos(b*Math.PI/180),(d-b)*111.3);
function windAt(t){const w=gridSample(lon,lat,t,readWind);if(!w)return null;const kn=Math.hypot(w[0],w[1]);
  return{kn,g:Math.max(kn,w[2]||0),d:(Math.atan2(-w[0],-w[1])*180/Math.PI+360)%360}}
// the wave model leaves cells close inshore empty: use the nearest cell it has (up to ~15 km away)
let wlon=null,wlat=null;
function wavePoint(){wlon=wlat=null;if(!FC||!FC.wv)return;const t=Math.min(N-1,Math.max(0,Math.round(curT))),st=FC.g.step;
  for(let r=0;r<=3;r++){let best=null;
    for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++){if(Math.max(Math.abs(di),Math.abs(dj))!==r)continue;
      const lo=lon+di*st,la=lat+dj*st;let ok=false;for(const tt of [t,0,Math.min(N-1,24)])if(gridSample(lo,la,tt,readWave)){ok=true;break}
      if(ok){const d=Math.hypot(di,dj);if(!best||d<best.d)best={lo,la,d}}}
    if(best){wlon=best.lo;wlat=best.la;return}}}
function waveAt(t){if(wlon==null)return null;const w=gridSample(wlon,wlat,t,readWave);if(!w)return null;return{h:w[0],p:w[1],d:(Math.atan2(w[2],w[3])*180/Math.PI+360)%360}}

function place(){if(!pw)return;const [x,y]=toScreen(...pw);box.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  box.classList.toggle("flip",x>W-200)}
function fill(){if(!pw||!FC)return;const w=windAt(curT),v=waveAt(curT),waves=layer==="waves"&&v;
  $("pb-k").textContent=waves?"Waves":"Wind";
  if(waves){$("pb-v").textContent=v.h.toFixed(1);$("pb-u").textContent="m";$("pb-dir").innerHTML=`${arrow(v.d)}${comp(v.d)}`;
    $("pb-row").innerHTML=[`${Math.round(v.p)} s`,w?`<span><i style="background:${barCol(w.kn)}"></i>wind ${Math.round(w.kn)} kn</span>`:""].filter(Boolean).join("<span>·</span>")}
  else if(w){$("pb-v").textContent=Math.round(w.kn);$("pb-u").textContent="kn";$("pb-dir").innerHTML=`${arrow(w.d)}${comp(w.d)}`;
    $("pb-row").innerHTML=[`<span><i style="background:${barCol(w.g)}"></i>gusts ${Math.round(w.g)}</span>`,v?`waves ${v.h.toFixed(1)} m · ${Math.round(v.p)} s`:""].filter(Boolean).join("<span>·</span>")}
  else{$("pb-v").textContent="–";$("pb-row").textContent="no forecast here";$("pb-dir").innerHTML=""}}

function name(){let best=null;
  for(const [nm,lo,la] of TOWNS){const d=km(lon,lat,lo,la);if(!best||d<best.d)best={nm,d}}
  for(const s of SPOTS){const d=km(lon,lat,s.lon,s.lat);if(d<(best?best.d:1e9))best={nm:s.name,d}}
  const sea=!onLand(...pw);if(!best)return sea?"Open water":"Inland";
  return best.d<1.5?best.nm:`${sea?"Off":"Near"} ${best.nm}`}

// a spot for this place, from the grids
function build(){const id="c"+(++n),o={kn:[],gust:[],dir:[],wh:[],wp:[],wd:[],temp:[],rain:[],cloud:[],tide:null};
  for(let T=0;T<N;T++){const w=windAt(T),v=waveAt(T);
    o.kn.push(w?Math.round(w.kn):null);o.gust.push(w?Math.round(w.g):null);o.dir.push(w?Math.round(w.d):null);
    o.wh.push(v?Math.round(v.h*100)/100:null);o.wp.push(v?Math.round(v.p*10)/10:null);o.wd.push(v?Math.round(v.d):null);
    o.temp.push(null);o.rain.push(null);o.cloud.push(null)}
  // the tide of the nearest named spot, if it is within ~15 km
  let near=null;for(const s of SPOTS){const d=km(lon,lat,s.lon,s.lat);if(!near||d<near.d)near={s,d}}
  let tideNote="";if(near&&near.d<15&&FC.spots[near.s.id]&&FC.spots[near.s.id].tide){o.tide=FC.spots[near.s.id].tide;tideNote=` · tide as at ${near.s.name}`}
  for(const k of Object.keys(FC.spots))if(/^c\d+$/.test(k))delete FC.spots[k];
  FC.spots[id]=o;
  const ns=(v,p,q)=>`${Math.abs(v).toFixed(2)}° ${v>=0?p:q}`;
  return{id,custom:true,name:name(),sub:`${ns(lat,"N","S")} · ${ns(lon,"E","W")}${tideNote}`,sym:null,lon,lat,fc:[lon,lat],wp:[lon,lat],
    pal:{sea:"#2a6f78",ring:"#4a8d95",shallow:"#9ccfc6",land:"#f0e4c8",ink:"#1b2f33"}}}

window.probeAt=(sx,sy)=>{if(!FC||selected)return;const [x,y]=toWorld(sx,sy);pw=[x,y];lon=lonOf(x);lat=latOf(y);
  wavePoint();box.hidden=false;place();fill();
  if(!reduce&&box.animate)box.querySelector(".pb-wrap").animate([{opacity:0,transform:"translateY(8px)"},{opacity:1,transform:"none"}],{duration:280,easing:"cubic-bezier(.2,.8,.2,1)"})};
window.probeMove=place;
window.probeFill=fill;
const hide=()=>{box.hidden=true;pw=null};
$("pb-x").addEventListener("click",e=>{e.stopPropagation();hide()});
$("pb-card").addEventListener("click",e=>{e.stopPropagation();if(!pw||!FC)return;const s=build();hide();requestSpot(s)});
addEventListener("keydown",e=>{if(e.key==="Escape"&&pw&&!selected)hide()});
})();
