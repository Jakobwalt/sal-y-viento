/* The address follows the page, so a view can be shared and the browser's back button works:
     #valde                     a spot
     #valde/beach               its beach view
     #@36.034,-5.702            a place picked on the map
     …/sat14/15h                day of the month and hour (Madrid time); left out when it is "now"
     …/waves                    the waves map; left out for wind
   Opening a spot or a beach view adds a history entry, so Back steps out one level. Changing the hour
   or the layer only rewrites the current entry. A link with such an address opens that view. */
(()=>{
const WD=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,weekday:"short"}),DM=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric"});
const keyOf=s=>!s?null:s.custom?`@${s.lat.toFixed(3)},${s.lon.toFixed(3)}`:s.id;
const beachOn=()=>!!(window.beachOpen&&beachOpen());
function hashFor(spot,beach){const p=[];if(spot)p.push(spot);if(spot&&beach)p.push("beach");
  const h=Math.round(curT);if(FC&&h!==NOW){const d=atHour(h);p.push(WD.format(d).toLowerCase()+DM.format(d),String(hourOf(h)).padStart(2,"0")+"h")}
  if(layer==="waves")p.push("waves");
  return p.length?"#"+p.join("/"):location.pathname+location.search}
const depth=()=>(history.state&&history.state.syv)||0;
const push=(spot,beach)=>history.pushState({syv:depth()+1},"",hashFor(spot,beach));
const replace=(spot,beach)=>{try{history.replaceState(history.state,"",hashFor(spot,beach))}catch(e){}};

function parse(hash){const o={spot:null,ll:null,beach:false,t:null,layer:"wind"};let day=null,hr=null;
  let txt="";try{txt=decodeURIComponent(hash.replace(/^#/,""))}catch(e){}
  for(const seg of txt.toLowerCase().split("/").filter(Boolean)){let m;
    if(SPOTS.some(s=>s.id===seg))o.spot=seg;
    else if((m=seg.match(/^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/))){o.ll=[+m[2],+m[1]];o.spot=`@${(+m[1]).toFixed(3)},${(+m[2]).toFixed(3)}`}
    else if(seg==="beach")o.beach=true;
    else if(seg==="waves"||seg==="wind")o.layer=seg;
    else if((m=seg.match(/^(\d{1,2})h$/)))hr=+m[1];
    else if((m=seg.match(/^[a-z]*(\d{1,2})$/)))day=+m[1]}
  // a place outside the forecast grid is ignored
  if(o.ll&&!(FC&&gridSample(o.ll[0],o.ll[1],0,readWind))){o.ll=null;o.spot=null}
  if(day!=null&&FC){const want=hr??12;for(let k=0;k<N;k++)if(+DM.format(atHour(k))===day&&hourOf(k)===want){o.t=k;break}}
  return o}

/* Steps the page towards the wanted view one level at a time, waiting for each transition to finish. */
let want=null,until=0,loop=0,quiet=false;
function step(){if(!want)return;if(performance.now()>until){want=null;return}
  const bo=beachOn(),busy=diving||(window.beachBusy&&beachBusy()),cur=keyOf(selected);
  if(!busy){quiet=true;try{
    if(bo&&(!want.beach||cur!==want.spot))closeBeach();
    else if(!bo&&selected&&cur!==want.spot)closeSpot();
    else if(!selected&&want.spot){const s=SPOTS.find(x=>x.id===want.spot);
      if(s)openSpot(s);else if(want.ll&&window.probeOpen)probeOpen(...want.ll);else want.spot=null}
    else if(selected&&want.beach&&!bo&&document.body.classList.contains("ready")){if(window.beachHas&&beachHas(selected.id))openBeach();else want.beach=false}
    else if(!want.beach||bo){want=null;return}
  }finally{quiet=false}}
  loop=requestAnimationFrame(step)}
// on load the address also sets the hour and layer; Back and Forward only change the view (the hour stays where it is)
function go(o,full){if(full){if(o.layer!==layer)setLayer(o.layer);if(o.t!=null)setTime(o.t)}else navNote();
  want=o;until=performance.now()+20000;cancelAnimationFrame(loop);step()}

addEventListener("popstate",()=>{if(FC)go(parse(location.hash),false)});
// the page calls these
window.navOpened=()=>{if(!quiet&&selected)push(keyOf(selected),false)};     // a spot was opened by a tap
window.navBeach=()=>{if(beachOn())push(keyOf(selected),true)};              // the beach view was opened by a tap
// Back (the ← button or Escape): step back through history when we added the entry, otherwise go up a level here
window.navBack=()=>{want=null;cancelAnimationFrame(loop);
  if(depth()>0&&(selected||beachOn())){history.back();return}
  const b=beachOn(),s=keyOf(selected);goBack();replace(b?s:null,false)};
// hour and layer: rewrite the current entry once things settle (not while playing or moving)
let noteT=0;
window.navNote=()=>{clearTimeout(noteT);noteT=setTimeout(function again(){
  if(want||playing||diving||(window.beachBusy&&beachBusy())){noteT=setTimeout(again,600);return}
  replace(keyOf(selected),beachOn())},500)};

let started=false;
function start(){if(started)return;started=true;if(location.hash.length>1)go(parse(location.hash),true)}
if(FC)start();else window.navStart=start;
})();
