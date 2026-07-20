const fs=require("fs");
const {chromium}=require("playwright");
const DIR="/tmp/claude-0/-home-user-marketing/b959a48e-8341-5387-9cf8-20ac6b48ee5c/scratchpad";
const data=JSON.parse(fs.readFileSync(DIR+"/shapes.json"));
const PX=96; // 1 inch = 96px
const esc=t=>String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function slideHTML(sl,PAGEW,PAGEH){
  let h=`<div class="slide" style="width:${PAGEW*PX}px;height:${PAGEH*PX}px;background:#${sl.bg}">`;
  for(const sh of sl.shapes){
    if(sh.k==="rect"){
      const st=`left:${sh.x*PX}px;top:${sh.y*PX}px;width:${sh.w*PX}px;height:${sh.h*PX}px;`+
        `background:${sh.fill?'#'+sh.fill:'transparent'};`+
        `border:${sh.line?sh.lw+'px solid #'+sh.line:'none'};`+
        `border-radius:${(sh.radius||0)*PX}px;box-shadow:0 1px 3px rgba(120,135,150,.35);`;
      h+=`<div class="rc" style="${st}"></div>`;
    } else if(sh.k==="line"){
      const x1=sh.x1*PX,y1=sh.y1*PX,x2=sh.x2*PX,y2=sh.y2*PX;
      const len=Math.hypot(x2-x1,y2-y1),ang=Math.atan2(y2-y1,x2-x1)*180/Math.PI;
      h+=`<div style="position:absolute;left:${x1}px;top:${y1}px;width:${len}px;height:0;border-top:1px solid #${sh.color};transform-origin:0 0;transform:rotate(${ang}deg)"></div>`;
    } else if(sh.k==="text"){
      const jc=sh.valign==="middle"?"center":sh.valign==="bottom"?"flex-end":"flex-start";
      const ai=sh.align==="center"?"center":sh.align==="right"?"flex-end":"flex-start";
      // group runs into lines using breakLine flags (a run with br:false continues the current line)
      const lines=[]; let cur=[];
      for(const r of sh.runs){ cur.push(r); if(r.br){ lines.push(cur); cur=[]; } }
      if(cur.length) lines.push(cur);
      let inner="";
      for(const ln of lines){
        const maxsz=Math.max(...ln.map(r=>r.size))*1.333;
        let spans="";
        for(const r of ln){ const st=`font-size:${r.size*1.333}px;color:#${r.color};font-weight:${r.bold?700:400};font-style:${r.italic?"italic":"normal"};`; spans+=`<span style="${st}">${esc(r.t)}</span>`; }
        inner+=`<div style="line-height:${(maxsz*1.16).toFixed(1)}px;width:100%;text-align:${sh.align}">${spans}</div>`;
      }
      const st=`left:${sh.x*PX}px;top:${sh.y*PX}px;width:${sh.w*PX}px;height:${sh.h*PX}px;`+
        `display:flex;flex-direction:column;justify-content:${jc};align-items:${ai};font-size:0;overflow:hidden;`;
      h+=`<div class="tx" style="${st}">${inner}</div>`;
    }
  }
  h+=`</div>`;
  return h;
}
(async()=>{
  const pages=data.slides.map(sl=>slideHTML(sl,data.PAGEW,data.PAGEH)).join("\n");
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,'Liberation Sans',sans-serif}
    body{background:#888}
    .slide{position:relative;margin:0;overflow:hidden}
    .rc,.tx{position:absolute}
  </style></head><body>${pages}</body></html>`;
  fs.writeFileSync(DIR+"/proxy.html",html);
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
  const page=await browser.newPage({viewport:{width:Math.round(data.PAGEW*PX),height:Math.round(data.PAGEH*PX)},deviceScaleFactor:1});
  await page.goto("file://"+DIR+"/proxy.html");
  const slides=await page.$$(".slide");
  for(let i=0;i<slides.length;i++){
    await slides[i].screenshot({path:`${DIR}/qa-${i+1}.png`});
  }
  await browser.close();
  console.log("rendered",slides.length,"slides");
})();
