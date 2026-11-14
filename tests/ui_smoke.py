"""Browser stress test: random taps, drags, zooms, rotations and panel toggles on four devices,
then checks the page is still fully usable (back on the map, nothing invisible blocking taps,
zoom works, markers line up, a spot and its details open and close, no script errors).

    pip install playwright && python -m playwright install chromium
    python -m http.server -d site 8000          # with data in site/data (see docs/development.md)
    python tests/ui_smoke.py [url] [rounds] [seed]

Defaults: http://localhost:8000/, 8 rounds, seed 1. Exits 1 if any round fails.
"""
import asyncio, random, sys, json
from playwright.async_api import async_playwright
URL=sys.argv[1] if len(sys.argv)>1 else "http://localhost:8000/"
ROUNDS=int(sys.argv[2]) if len(sys.argv)>2 else 8
SEED=int(sys.argv[3]) if len(sys.argv)>3 else 1
AUDIT = """(()=>{const bad={};const hidden=e=>{for(let n=e;n&&n!==document.documentElement;n=n.parentElement){const c=getComputedStyle(n);if(c.visibility==='hidden'||+c.opacity<0.05||c.display==='none')return n.id||n.className||n.tagName}return null};
  for(let x=10;x<innerWidth;x+=Math.round(innerWidth/20))for(let y=10;y<innerHeight;y+=Math.round(innerHeight/20)){const e=document.elementFromPoint(x,y);if(!e||e.id==='tl-range'||(e.closest&&e.closest('#map')))continue;const h=hidden(e);if(h){const k=(e.id||String(e.className))+'<'+h;bad[k]=(bad[k]||0)+1}}return bad})()"""
CHECK = """(()=>{const svgEl=document.getElementById('map'),m=svgEl.getScreenCTM(),pt=svgEl.createSVGPoint();let w=0;
  for(const s of SPOTS){const [x,y]=P(s.lon,s.lat);pt.x=x;pt.y=y;const q=pt.matrixTransform(m);const r=document.getElementById('mk-'+s.id).getBoundingClientRect();w=Math.max(w,Math.hypot(r.x+r.width/2-q.x,r.y+r.height/2-q.y))}return Math.round(w)})()"""
async def center(pg, sel):
    return await pg.evaluate(f"(()=>{{const e=document.querySelector('{sel}');if(!e)return null;const r=e.getBoundingClientRect();if(!r.width)return null;return [r.x+r.width/2,r.y+r.height/2]}})()")
async def tap(pg, sel):
    if sel=="#i-swell":   # on phones the waves panel is one swipe to the right
        await pg.evaluate("(()=>{const b=document.getElementById('b-wave'),f=b&&b.parentElement;if(f&&f.scrollWidth>f.clientWidth)f.scrollLeft=b.offsetLeft})()"); await pg.wait_for_timeout(300)
    c=await center(pg, sel)
    if c: await pg.mouse.click(*c)
async def main():
    rnd=random.Random(SEED); fails=[]
    async with async_playwright() as p:
        b=await p.chromium.launch()
        devs=[("desktop",{"viewport":{"width":1366,"height":768}}),("iPhone13",{k:v for k,v in p.devices["iPhone 13"].items() if k!="default_browser_type"}),
              ("Pixel7",{k:v for k,v in p.devices["Pixel 7"].items() if k!="default_browser_type"}),("iPad",{k:v for k,v in p.devices["iPad Mini"].items() if k!="default_browser_type"})]
        for r in range(ROUNDS):
            name,o=devs[r%len(devs)]; ctx=await b.new_context(**o); pg=await ctx.new_page(); errs=[]
            pg.on("pageerror", lambda e: errs.append(str(e)[:140]))
            await pg.goto(URL); await pg.wait_for_timeout(2500)
            spots=["sancti","palmar","canos","zahara","bolonia","valde","lances","balneario"]; log=[]
            vp0=pg.viewport_size
            for step in range(rnd.randint(8,22)):
                a=rnd.choice(["spot","spot","spot","back","back","beach","beach","zin","zout","esc","drag","rotate","play","day","tap","swell","swell","mini","swcol","wdet","vmini","probe","probe"])
                if a=="spot": await tap(pg, f"#mk-{rnd.choice(spots)}")
                elif a=="back": await tap(pg,"#back")
                elif a=="beach": await tap(pg,"#i-beach")
                elif a=="zin": await tap(pg,"#z-in")
                elif a=="zout": await tap(pg,"#z-out")
                elif a=="esc": await pg.keyboard.press("Escape")
                elif a=="drag":
                    vp=pg.viewport_size; x,y=vp["width"]/2,vp["height"]/2
                    await pg.mouse.move(x,y); await pg.mouse.down(); await pg.mouse.move(x+rnd.randint(-120,120),y+rnd.randint(-80,80),steps=5); await pg.mouse.up()
                elif a=="rotate":
                    vp=pg.viewport_size; await pg.set_viewport_size({"width":vp["height"],"height":vp["width"]})
                elif a=="play": await tap(pg,"#tl-play")
                elif a=="day": await tap(pg,".tbl .row[data-day]")
                elif a=="swell": await tap(pg,"#i-swell")
                elif a=="mini": await tap(pg,"#i-wmini")
                elif a=="wdet": await tap(pg,"#i-wdet")
                elif a=="vmini": await tap(pg,"#i-vmini")
                elif a=="probe":
                    vp=pg.viewport_size; x=rnd.randint(60,vp["width"]-60); y=rnd.randint(120,vp["height"]-140)
                    if name!="desktop": await pg.touchscreen.tap(x,y)
                    else: await pg.mouse.click(x,y)
                    await pg.wait_for_timeout(300)
                    if rnd.random()<.6: await tap(pg,"#pb-card")
                elif a=="swcol":
                    c=await center(pg,"#sw-scroll")
                    if c: await pg.mouse.click(c[0]+rnd.randint(-100,100),c[1])
                elif a=="tap":
                    vp=pg.viewport_size; await pg.mouse.click(rnd.randint(5,vp["width"]-5),rnd.randint(5,vp["height"]-5))
                log.append(a); await pg.wait_for_timeout(rnd.choice([0,50,200,600,1500,3000]))
            # settle, then the page must be fully usable
            await pg.set_viewport_size(vp0)
            playing=await pg.evaluate("playing")
            if playing: await tap(pg,"#tl-play")
            await pg.wait_for_timeout(12000)
            for _ in range(3):
                if not await pg.evaluate("!!selected||(window.beachOpen&&beachOpen())"): break
                await tap(pg,"#back"); await pg.wait_for_timeout(9000)
            res={}
            res["back to map"]=not await pg.evaluate("!!selected||(window.beachOpen&&beachOpen())")
            blockers=await pg.evaluate(AUDIT); res["no hidden blockers"]=blockers=={}
            z0=await pg.evaluate("cam.z"); await tap(pg,"#z-in"); await pg.wait_for_timeout(800)
            z1=await pg.evaluate("cam.z"); res["zoom works"]=z1>z0*1.2 or z0>=await pg.evaluate("fitZ*14")-1e-6
            await tap(pg,"#z-out"); await pg.wait_for_timeout(800)
            mis=await pg.evaluate(CHECK); res["markers aligned"]=mis<=1
            if mis>1: await pg.wait_for_timeout(1500); print("   misaligned px:",mis,"after 1.5s:",await pg.evaluate(CHECK), "anim:",await pg.evaluate("!!anim"))
            await tap(pg,"#mk-zahara"); await pg.wait_for_timeout(4200)
            res["spot opens"]=await pg.evaluate("selected&&selected.id==='zahara'")
            await tap(pg,"#i-swell"); await pg.wait_for_timeout(900)
            res["details open"]=await pg.evaluate("swellOpen()&&document.querySelectorAll('#sw .sw-r').length>8&&document.getElementById('sw').getBoundingClientRect().height>200")
            await tap(pg,"#i-wmini"); await pg.wait_for_timeout(900)
            res["details close"]=await pg.evaluate("!swellOpen()&&document.getElementById('i-wind').getBoundingClientRect().height>40")
            await tap(pg,"#i-swell"); await pg.wait_for_timeout(900)
            await tap(pg,"#back"); await pg.wait_for_timeout(4200)
            res["swell cleared"]=not await pg.evaluate("document.body.classList.contains('swell')")
            res["and closes"]=not await pg.evaluate("!!selected")
            res["no errors"]=not errs
            ok=all(res.values())
            print(f"round {r+1:2d} {name:9s} {'OK  ' if ok else 'FAIL'} {' '.join(log)}" + ("" if ok else "  →  "+json.dumps({k:v for k,v in res.items() if not v})+(" "+str(errs[:1]) if errs else "")+(" blockers="+json.dumps(blockers) if blockers else "")), flush=True)
            if not ok: fails.append(r+1)
            await ctx.close()
        await b.close()
    print("FAILED rounds:", fails or "none")
    return fails
sys.exit(1 if asyncio.run(main()) else 0)
