const pptxgen = require("pptxgenjs");
const fs = require("fs");
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
const PAGEW = 13.33, PAGEH = 7.5;

const NAVY="1F3A5F", NAVY2="2E5C8A", CARD="EAF1FB", CARDBR="C7D8EE",
      MUTED="5B6B7C", MONEY="0F6E4F", ASSUM="B45309",
      VACFILL="FBE4E4", VACBR="E3B4B4", INK="1F2A37", WHITE="FFFFFF";
const FONT="Arial";

function grp(n){const s=String(Math.round(n));let o="",c=0;for(let i=s.length-1;i>=0;i--){o=s[i]+o;if(++c%3===0&&i>0)o=" "+o;}return o;}
const money=n=>grp(n)+" ₸";

// ================= recording layer (dual emit) =================
const REC=[]; let CUR=null;
function newSlide(bg){ const s=pres.addSlide(); if(bg) s.background={color:bg}; CUR={name:"",bg:bg||"FFFFFF",shapes:[]}; REC.push(CUR); return s; }
function rect(s,type,o){
  const opt={x:o.x,y:o.y,w:o.w,h:o.h};
  if(type==="roundRect") opt.rectRadius=o.radius||0.06;
  opt.fill=o.fill?{color:o.fill}:{type:"none"};
  opt.line=o.lineNone?{type:"none"}:{color:o.line||CARDBR,width:o.lw==null?1:o.lw};
  if(o.shadow) opt.shadow={type:"outer",color:"9AA7B4",opacity:0.28,blur:4,offset:2,angle:90};
  s.addShape(type,opt);
  CUR.shapes.push({k:"rect",type,x:o.x,y:o.y,w:o.w,h:o.h,fill:o.fill||null,line:o.lineNone?null:(o.line||CARDBR),lw:o.lw==null?1:o.lw,radius:opt.rectRadius||0});
}
function line(s,x1,y1,x2,y2,color){ s.addShape("line",{x:x1,y:y1,w:x2-x1,h:y2-y1,line:{color:color||CARDBR,width:1}}); CUR.shapes.push({k:"line",x1,y1,x2,y2,color:color||CARDBR}); }
function txt(s,runs,o){
  const opt={x:o.x,y:o.y,w:o.w,h:o.h,align:o.align||"left",valign:o.valign||"top",fontFace:FONT,margin:o.margin==null?0:o.margin};
  if(o.lineSpacingMultiple) opt.lineSpacingMultiple=o.lineSpacingMultiple;
  s.addText(runs,opt);
  CUR.shapes.push({k:"text",x:o.x,y:o.y,w:o.w,h:o.h,align:o.align||"left",valign:o.valign||"middle",
    runs:runs.map(r=>({t:r.text,bold:!!r.options.bold,italic:!!r.options.italic,size:r.options.fontSize||12,color:r.options.color||INK,br:r.options.breakLine!==false}))});
}

// ============================ DATA (from Excel via deck_data.json) ============================
const D = JSON.parse(fs.readFileSync(__dirname + "/deck_data.json", "utf8"));
function P(key){ const d=D[key]; if(!d) throw new Error("missing key in deck_data.json: "+key);
  return {label:d.label, detail:d.detail, salary:d.salary, assumed:!!d.assumed, vacant:!!d.vacant}; }
const M = keys => keys.map(P);

const marcom={ name:"Marcom", head:P("M_HEAD"),
  columns:[
    {title:"Промо / Контент  (original · sport)", cards:M(["M_PROMO_1","M_PROMO_2","M_PROMO_3","M_PROMO_4","M_PROMO_5","M_PROMO_6"])},
    {title:"SMM  (gen · original · sport)",       cards:M(["M_SMM_1","M_SMM_2","M_SMM_3","M_SMM_4","M_SMM_5","M_SMM_6"])},
    {title:"PR",                                   cards:M(["M_PR_1"])},
  ],
};
const kanaly={ name:"Каналы коммуникации", head:P("K_HEAD"),
  row:M(["K_1","K_2","K_3","K_4","K_5"]),
};
const prodakshn={ name:"Продакшн", head:P("P_HEAD"),
  subleads:[
    Object.assign(P("P_ART"),  {reports:M(["P_ART_1","P_ART_2","P_ART_3","P_ART_4","P_ART_5"])}),
    Object.assign(P("P_PROD"), {reports:M(["P_PROD_1","P_PROD_2","P_PROD_3","P_PROD_4"])}),
  ],
};
const prodzhekt={ name:"Проджект", head:P("PJ_HEAD"),
  row:M(["PJ_1","PJ_2","PJ_3","PJ_4"]),
};

function peopleOf(d){const arr=[d.head];if(d.columns)d.columns.forEach(c=>c.cards.forEach(x=>arr.push(x)));if(d.row)d.row.forEach(x=>arr.push(x));if(d.subleads)d.subleads.forEach(s=>{arr.push(s);(s.reports||[]).forEach(x=>arr.push(x));});return arr;}
const deptTotal=d=>peopleOf(d).reduce((a,p)=>a+p.salary,0);
const deptCount=d=>peopleOf(d).length;
const DEPTS=[marcom,kanaly,prodakshn,prodzhekt];
const GRAND=DEPTS.reduce((a,d)=>a+deptTotal(d),0);

// ============================ card ============================
function card(s,x,y,w,h,p,kind){
  const isHead=kind==="head",isSub=kind==="sublead";
  const fill=p.vacant?VACFILL:isHead?NAVY:isSub?NAVY2:CARD;
  const border=p.vacant?VACBR:isHead?NAVY:isSub?NAVY2:CARDBR;
  const labelColor=(isHead||isSub)?WHITE:INK;
  const detailColor=(isHead||isSub)?"DCE6F5":MUTED;
  const salColor=p.assumed?((isHead||isSub)?"FFD9A6":ASSUM):((isHead||isSub)?WHITE:MONEY);
  rect(s,"roundRect",{x,y,w,h,radius:0.06,fill,line:border,lw:(isHead||isSub)?0:1,shadow:true});
  const labelSz=isHead?13:isSub?12:10.5, detailSz=isHead?9:8, salSz=isHead?12.5:isSub?12:11;
  const salTxt=money(p.salary)+(p.assumed?"  *":"");
  txt(s,[
    {text:p.label,options:{bold:true,fontSize:labelSz,color:labelColor,breakLine:true}},
    {text:p.detail,options:{fontSize:detailSz,italic:true,color:detailColor,breakLine:true}},
    {text:salTxt,options:{bold:true,fontSize:salSz,color:salColor,breakLine:false}},
  ],{x:x+0.08,y:y+0.05,w:w-0.16,h:h-0.1,align:"center",valign:"middle",lineSpacingMultiple:1.0});
}
function deptHeader(s,d){
  txt(s,[{text:d.name,options:{bold:true,fontSize:30,color:NAVY}}],{x:0.5,y:0.28,w:7.5,h:0.62,align:"left",valign:"middle"});
  const pw=4.55,ph=0.82,px=PAGEW-0.5-pw,py=0.24;
  rect(s,"roundRect",{x:px,y:py,w:pw,h:ph,radius:0.1,fill:NAVY,lineNone:true});
  txt(s,[
    {text:money(deptTotal(d)),options:{fontSize:19,color:WHITE,bold:true,breakLine:true}},
    {text:"ФОТ отдела · "+deptCount(d)+" чел. · оклады/мес",options:{fontSize:9.5,color:"CADCFC"}},
  ],{x:px+0.15,y:py+0.08,w:pw-0.3,h:ph-0.16,align:"right",valign:"middle",lineSpacingMultiple:1.0});
}

// ============================ SLIDE 1 ============================
(function(){
  const s=newSlide("F4F7FB");
  txt(s,[{text:"Структура команды маркетинга",options:{bold:true,fontSize:34,color:NAVY}}],{x:0.6,y:0.5,w:12.1,h:0.7,align:"left",valign:"middle"});
  txt(s,[{text:"Отделы и ФОТ · сводка по позициям",options:{fontSize:15,color:MUTED}}],{x:0.62,y:1.18,w:12,h:0.4,align:"left",valign:"middle"});
  const gx=0.6,gy=1.9,gw=(PAGEW-2*0.6-0.4)/2,gh=1.65,gapx=0.4,gapy=0.35;
  DEPTS.forEach((d,i)=>{
    const col=i%2,rr=Math.floor(i/2),x=gx+col*(gw+gapx),y=gy+rr*(gh+gapy);
    rect(s,"roundRect",{x,y,w:gw,h:gh,radius:0.08,fill:WHITE,line:CARDBR,lw:1,shadow:true});
    rect(s,"roundRect",{x:x+0.28,y:y+0.32,w:0.95,h:1.0,radius:0.1,fill:NAVY,lineNone:true});
    txt(s,[{text:String(deptCount(d)),options:{bold:true,fontSize:29,color:WHITE}}],{x:x+0.28,y:y+0.36,w:0.95,h:0.6,align:"center",valign:"middle"});
    txt(s,[{text:"чел.",options:{fontSize:9,color:"CADCFC"}}],{x:x+0.28,y:y+0.98,w:0.95,h:0.28,align:"center",valign:"middle"});
    txt(s,[{text:d.name,options:{bold:true,fontSize:18,color:NAVY}}],{x:x+1.45,y:y+0.34,w:gw-1.7,h:0.5,align:"left",valign:"middle"});
    txt(s,[{text:"ФОТ отдела:  ",options:{fontSize:12,color:MUTED,breakLine:false}},{text:money(deptTotal(d)),options:{fontSize:16,bold:true,color:MONEY,breakLine:false}}],{x:x+1.45,y:y+0.86,w:gw-1.6,h:0.45,align:"left",valign:"middle"});
  });
  const by=gy+2*gh+gapy+0.2,bw=PAGEW-1.2,bh=0.95;
  rect(s,"roundRect",{x:0.6,y:by,w:bw,h:bh,radius:0.1,fill:NAVY,lineNone:true});
  txt(s,[{text:"Итого ФОТ · 4 отдела",options:{bold:true,fontSize:17,color:"CADCFC"}}],{x:0.9,y:by,w:6,h:bh,align:"left",valign:"middle"});
  txt(s,[{text:money(GRAND),options:{bold:true,fontSize:26,color:WHITE}}],{x:PAGEW-0.9-6,y:by,w:6,h:bh,align:"right",valign:"middle"});
  txt(s,[{text:"Суммы — должностной оклад (тотал), в месяц (₸).  Источник: Excel «Должностной оклад» + оргструктура по отделам (скрины).  * — имя на позиции не определено, взята максимальная стоимость по позиции (см. последний слайд).",options:{italic:true,fontSize:8.5,color:MUTED}}],{x:0.6,y:PAGEH-0.52,w:PAGEW-1.2,h:0.38,align:"left",valign:"middle"});
})();

// ============================ Marcom (3 cols, fits 6) ============================
(function(){
  const s=newSlide("F4F7FB"); deptHeader(s,marcom);
  const hw=4.6,hh=0.80,hx=(PAGEW-hw)/2,hy=1.10; card(s,hx,hy,hw,hh,marcom.head,"head");
  const cols=marcom.columns,nCol=cols.length,mL=0.5,mR=0.5,gap=0.4;
  const cw=(PAGEW-mL-mR-gap*(nCol-1))/nCol;
  const busY=1.96, titleY=2.02, colTop=2.40, cardH=0.70, gapv=0.075, pitch=cardH+gapv;
  line(s,PAGEW/2,hy+hh,PAGEW/2,busY);
  const centers=cols.map((_,i)=>mL+cw/2+i*(cw+gap));
  line(s,centers[0],busY,centers[nCol-1],busY);
  cols.forEach((col,i)=>{
    const cx=mL+i*(cw+gap);
    line(s,centers[i],busY,centers[i],titleY);
    txt(s,[{text:col.title,options:{bold:true,fontSize:12,color:NAVY2}}],{x:cx,y:titleY,w:cw,h:0.32,align:"center",valign:"middle"});
    col.cards.forEach((p,j)=>card(s,cx,colTop+j*pitch,cw,cardH,p,"member"));
  });
})();

// ============================ Каналы (row of 5) ============================
(function(){
  const s=newSlide("F4F7FB"); deptHeader(s,kanaly);
  const hw=4.6,hh=0.92,hx=(PAGEW-hw)/2,hy=1.55; card(s,hx,hy,hw,hh,kanaly.head,"head");
  const items=kanaly.row,n=items.length,mL=0.5,mR=0.5,gap=0.28;
  const cw=(PAGEW-mL-mR-gap*(n-1))/n,ch=1.7,cy=4.0,busY=3.55;
  line(s,PAGEW/2,hy+hh,PAGEW/2,busY);
  const centers=items.map((_,i)=>mL+cw/2+i*(cw+gap));
  line(s,centers[0],busY,centers[n-1],busY);
  items.forEach((p,i)=>{ line(s,centers[i],busY,centers[i],cy); card(s,mL+i*(cw+gap),cy,cw,ch,p,"member"); });
})();

// ============================ Продакшн (two subtrees) ============================
(function(){
  const s=newSlide("F4F7FB"); deptHeader(s,prodakshn);
  const hw=4.8,hh=0.84,hx=(PAGEW-hw)/2,hy=1.16; card(s,hx,hy,hw,hh,prodakshn.head,"head");
  const subW=4.9,subH=0.80,leftX=0.9,rightX=PAGEW-0.9-subW,subY=2.30,busY=2.06;
  const subs=prodakshn.subleads;
  line(s,PAGEW/2,hy+hh,PAGEW/2,busY);
  const lc=leftX+subW/2,rc=rightX+subW/2;
  line(s,lc,busY,rc,busY); line(s,lc,busY,lc,subY); line(s,rc,busY,rc,subY);
  card(s,leftX,subY,subW,subH,subs[0],"sublead"); card(s,rightX,subY,subW,subH,subs[1],"sublead");
  const cardH=0.68,gapv=0.075,pitch=cardH+gapv,repTop=subY+subH+0.20;
  [[subs[0],leftX],[subs[1],rightX]].forEach(([sub,sx])=>{
    line(s,sx+subW/2,subY+subH,sx+subW/2,repTop);
    sub.reports.forEach((p,j)=>card(s,sx,repTop+j*pitch,subW,cardH,p,"member"));
  });
})();

// ============================ Проджект (row of 4) ============================
(function(){
  const s=newSlide("F4F7FB"); deptHeader(s,prodzhekt);
  const hw=4.6,hh=0.92,hx=(PAGEW-hw)/2,hy=1.6; card(s,hx,hy,hw,hh,prodzhekt.head,"head");
  const items=prodzhekt.row,n=items.length,mL=0.9,mR=0.9,gap=0.4;
  const cw=(PAGEW-mL-mR-gap*(n-1))/n,ch=1.7,cy=3.9,busY=3.35;
  line(s,PAGEW/2,hy+hh,PAGEW/2,busY);
  const centers=items.map((_,i)=>mL+cw/2+i*(cw+gap));
  line(s,centers[0],busY,centers[n-1],busY);
  items.forEach((p,i)=>{ line(s,centers[i],busY,centers[i],cy); card(s,mL+i*(cw+gap),cy,cw,ch,p,"member"); });
})();

// ============================ Assumptions ============================
(function(){
  const s=newSlide("F4F7FB");
  txt(s,[{text:"Допущения по расчёту ФОТ",options:{bold:true,fontSize:28,color:NAVY}}],{x:0.6,y:0.45,w:12,h:0.6,align:"left",valign:"middle"});
  txt(s,[{text:"Где на позиции не указано имя (отмечено * / курсивом), взята максимальная стоимость по этой позиции из Excel — по правилу заказчика.",options:{fontSize:13,color:MUTED}}],{x:0.62,y:1.1,w:12,h:0.4,align:"left",valign:"middle"});
  const rows=[
    ["SMM Original / Gen / Sport (4 позиции)","SMM менеджер — макс. из 4",money(867456)],
    ["Graph / Graph Спорт (3 позиции)","Дизайнер — макс. из 5",money(940000)],
    ["Motion (2 позиции)","Видеодизайнер (Motion) — единственная ставка",money(877000)],
    ["Мобилограф / монтажёр (4 позиции)","Видеограф — макс. из 5",money(1498769)],
    ["PPC (1)","Трафик менеджер — макс. из 2",money(1124000)],
    ["CVM (?) — планируемая позиция","CVM ≈ CRM менеджер",money(867456)],
  ];
  const tx=0.6,tw=PAGEW-1.2,ty=1.65,rh=0.6;
  rect(s,"roundRect",{x:tx,y:ty,w:tw,h:0.48,radius:0.05,fill:NAVY,lineNone:true});
  txt(s,[{text:"Позиция в оргструктуре",options:{bold:true,fontSize:12,color:WHITE}}],{x:tx+0.25,y:ty,w:5.4,h:0.48,align:"left",valign:"middle"});
  txt(s,[{text:"Соответствие в Excel",options:{bold:true,fontSize:12,color:WHITE}}],{x:tx+5.8,y:ty,w:4.4,h:0.48,align:"left",valign:"middle"});
  txt(s,[{text:"Стоимость (макс.)",options:{bold:true,fontSize:12,color:WHITE}}],{x:tx+tw-2.7,y:ty,w:2.5,h:0.48,align:"right",valign:"middle"});
  rows.forEach((r,i)=>{
    const y=ty+0.48+i*rh;
    rect(s,"rect",{x:tx,y,w:tw,h:rh,fill:i%2?"FFFFFF":"EAF1FB",line:CARDBR,lw:0.5});
    txt(s,[{text:r[0],options:{fontSize:12,color:INK}}],{x:tx+0.25,y,w:5.4,h:rh,align:"left",valign:"middle"});
    txt(s,[{text:r[1],options:{fontSize:11,italic:true,color:MUTED}}],{x:tx+5.8,y,w:4.6,h:rh,align:"left",valign:"middle"});
    txt(s,[{text:r[2],options:{fontSize:13,bold:true,color:ASSUM}}],{x:tx+tw-2.7,y,w:2.5,h:rh,align:"right",valign:"middle"});
  });
  const noteY=ty+0.48+rows.length*rh+0.3;
  txt(s,[
    {text:"Как считалось.  ",options:{bold:true,color:NAVY,fontSize:12,breakLine:false}},
    {text:"ФОТ отдела = сумма должностных окладов (тотал) всех позиций отдела, включая руководителя. Суммы взяты из Excel; руководители и senior-роли — из отдельного блока стоимостей. Итог по 4 отделам: "+money(GRAND)+" в месяц.",options:{color:INK,fontSize:12,breakLine:false}},
  ],{x:tx,y:noteY,w:tw,h:0.8,align:"left",valign:"top",lineSpacingMultiple:1.15});
})();

const OUT = process.env.DECK_OUT || (__dirname + "/out.pptx");
pres.writeFile({fileName:OUT}).then(()=>{
  fs.writeFileSync(__dirname + "/shapes.json",JSON.stringify({PAGEW,PAGEH,slides:REC}));
  console.log("WROTE out.pptx + shapes.json");
  DEPTS.forEach(d=>console.log("  "+d.name+": "+deptCount(d)+" чел, ФОТ "+money(deptTotal(d))));
  console.log("  GRAND: "+money(GRAND));
  // overflow guard
  let bad=0;
  REC.forEach((sl,si)=>sl.shapes.forEach(sh=>{ if(sh.k==="rect"&&(sh.y+sh.h>7.45||sh.x+sh.w>13.36||sh.x<-0.01||sh.y<-0.01)){bad++;console.log("  !! offslide rect slide",si+1,JSON.stringify({x:sh.x,y:sh.y,w:sh.w,h:sh.h}));}}));
  if(!bad) console.log("  geometry OK: all rects within slide bounds");
});
