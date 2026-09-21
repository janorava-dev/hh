/* Sdílené: hrdinové (SVG), levely, ikony. Načítá child.html i parent.html. */
(function(){
const $=s=>document.querySelector(s);
const N='#13203A';
const st=`stroke="${N}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const star=(cx,cy,R,r)=>{const p=[];for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,q=i%2?r:R;p.push((cx+q*Math.cos(a)).toFixed(1)+','+(cy+q*Math.sin(a)).toFixed(1));}return p.join(' ');};
const eyes=(y,dx,r)=>`<circle cx="${100-dx}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${100+dx}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${100-dx}" cy="${y}" r="${r/2}" fill="${N}"/><circle cx="${100+dx}" cy="${y}" r="${r/2}" fill="${N}"/>`;
const skin='#F3C9A5';

/* ---------- ekonomika ---------- */
const XPT=[0,100,500,1100,2000,3100,4400,6000,7900,10000];   // práh XP pro level 1..10; skutečné hodnoty posílá server (setXPT)
const setXPT=a=>{if(Array.isArray(a)&&a.length&&a.every(Number.isFinite)){XPT.length=0;XPT.push(...a)}};
const FORMS=['Učeň','Bojovník','Šampion','Legenda'];
const lvlOf=xp=>{let l=1;XPT.forEach((t,i)=>{if(xp>=t)l=i+1});return l};
const tierOf=l=>l>=10?4:l>=6?3:l>=3?2:1;
const SLOTS=[
 {id:'cape',name:'Plášť',lvl:2,opts:[['red','Červený','#E5383B'],['blue','Modrý','#2F7DE1'],['gold','Zlatý','#F2B01E']]},
 {id:'neck',name:'Šála a medaile',lvl:3,opts:[['scarf','Šála','#E5383B'],['medal','Medaile','#F2B01E'],['gem','Amulet','#22C7B8']]},
 {id:'tool',name:'Nástroj',lvl:5,opts:[['broom','Koště moci','#C58B3A'],['spray','Sprej čistoty','#6FC7E8'],['sponge','Houba síly','#FFD23F']]},
 {id:'pet',name:'Parťák',lvl:7,opts:[['slime','Slizík','#5BD08A'],['kitten','Kotě','#F0A15B'],['dragon','Dráček','#22C7B8']]},
 {id:'aura',name:'Aura',lvl:9,opts:[['gold','Zlatá','#F5B300'],['ice','Ledová','#7CD4FF'],['fire','Ohnivá','#FF6A3D']]}
];
const dny=n=>n===1?'den':n>=2&&n<=4?'dny':'dní';

/* ---------- hrdinové (SVG) ---------- */
const HEROES={
 knight:{name:'Rytíř',suit:'#3A6EA5',trim:'#22406B',acc:'#F2C14E',hand:'#C6D0E0',
  head:()=>`<circle cx="100" cy="68" r="38" fill="#C6D0E0" ${st}/><rect x="70" y="58" width="60" height="20" rx="10" fill="#1B2436"/><circle cx="87" cy="68" r="4.5" fill="#fff"/><circle cx="113" cy="68" r="4.5" fill="#fff"/><path d="M100 31v14" stroke="#8B9AB5" stroke-width="5" stroke-linecap="round"/>`},
 wizard:{name:'Čaroděj',suit:'#6C4AB6',trim:'#43297A',acc:'#F2C14E',hand:skin,
  head:()=>`<circle cx="100" cy="78" r="30" fill="${skin}" ${st}/>${eyes(76,11,5.5)}<path d="M72 88Q100 134 128 88Q100 102 72 88Z" fill="#F4F6FA" ${st}/><ellipse cx="99" cy="56" rx="46" ry="10" fill="#43297A" ${st}/><polygon points="58,56 106,-2 140,56" fill="#43297A" ${st}/><polygon points="${star(100,34,8,3.4)}" fill="#F2C14E" stroke="${N}" stroke-width="2"/>`},
 ninja:{name:'Ninja',suit:'#2F3447',trim:'#171A26',acc:'#E5383B',hand:'#171A26',
  head:()=>`<circle cx="100" cy="68" r="38" fill="#2F3447" ${st}/><rect x="68" y="56" width="64" height="26" rx="13" fill="${skin}" ${st}/>${eyes(69,13,6)}<rect x="62" y="42" width="76" height="11" rx="4" fill="#E5383B" ${st}/><path d="M136 45L166 36L160 49L170 60L136 52Z" fill="#E5383B" ${st}/><rect x="90" y="42" width="20" height="11" rx="3" fill="#C6D0E0" ${st}/>`},
 astro:{name:'Kosmonaut',suit:'#F1F3F8',trim:'#B9C2D6',acc:'#FF8A3D',hand:'#FF8A3D',
  head:()=>`<circle cx="100" cy="68" r="40" fill="#F1F3F8" ${st}/><ellipse cx="100" cy="70" rx="30" ry="25" fill="#1D2B4F" ${st}/><path d="M78 60Q84 50 96 48" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/><circle cx="90" cy="72" r="4.5" fill="#7FE3FF"/><circle cx="110" cy="72" r="4.5" fill="#7FE3FF"/><path d="M94 82Q100 87 106 82" stroke="#7FE3FF" stroke-width="3" fill="none" stroke-linecap="round"/>`},
 robot:{name:'Robot',suit:'#2BA6A0',trim:'#16706C',acc:'#FFD23F',hand:'#9FB4C7',
  head:()=>`<line x1="100" y1="34" x2="100" y2="18" ${st}/><circle cx="100" cy="16" r="6" fill="#E5383B" ${st}/><rect x="54" y="56" width="12" height="24" rx="4" fill="#5E7387" ${st}/><rect x="134" y="56" width="12" height="24" rx="4" fill="#5E7387" ${st}/><rect x="62" y="34" width="76" height="66" rx="18" fill="#9FB4C7" ${st}/><rect x="72" y="50" width="56" height="28" rx="10" fill="#1B2436"/><rect x="78" y="57" width="16" height="14" rx="4" fill="#FFD23F"/><rect x="106" y="57" width="16" height="14" rx="4" fill="#FFD23F"/><rect x="82" y="85" width="36" height="8" rx="3" fill="#5E7387"/>`},
 fox:{name:'Liška',suit:'#5BA04A',trim:'#376B2C',acc:'#FFFFFF',hand:'#E8823A',
  head:()=>`<polygon points="64,52 68,12 96,36" fill="#E8823A" ${st}/><polygon points="136,52 132,12 104,36" fill="#E8823A" ${st}/><polygon points="71,44 73,24 86,36" fill="#F6C9A0"/><polygon points="129,44 127,24 114,36" fill="#F6C9A0"/><circle cx="100" cy="70" r="38" fill="#E8823A" ${st}/><ellipse cx="100" cy="86" rx="24" ry="17" fill="#FFF3E6"/><ellipse cx="100" cy="79" rx="6" ry="4.500" fill="${N}"/><path d="M100 83v5M92 90Q100 96 108 90" stroke="${N}" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="84" cy="64" rx="5" ry="6.500" fill="${N}"/><ellipse cx="116" cy="64" rx="5" ry="6.500" fill="${N}"/><circle cx="86" cy="62" r="1.800" fill="#fff"/><circle cx="118" cy="62" r="1.800" fill="#fff"/>`},
 ondatra:{name:'SuperOndatra',suit:'#4B5CA8',trim:'#1F3A33',acc:'#F5B300',hand:'#F1BE97',short:true,noBelt:true,
  torso:(tier,id)=>{const c=tier>=2?'#F5B300':'#FFFFFF';return `<clipPath id="${id}t"><rect x="60" y="98" width="80" height="78" rx="28"/></clipPath><g clip-path="url(#${id}t)"><path d="M56 104C74 98 86 112 104 106C118 102 128 110 144 104V132C126 138 116 124 100 130C84 136 72 126 56 132Z" fill="#D9DB5C"/><path d="M56 152C72 144 88 158 106 150C120 144 132 152 144 148V180H56Z" fill="#26305E"/><path d="M92 112C100 122 112 116 122 124C114 132 100 128 92 112Z" fill="#B7D66A"/><circle cx="72" cy="140" r="3" fill="#F0EC8C"/><circle cx="128" cy="162" r="3" fill="#D9DB5C"/><circle cx="84" cy="168" r="2.5" fill="#F0EC8C"/></g><rect x="60" y="98" width="80" height="78" rx="28" fill="none" stroke="${N}" stroke-width="3"/><path d="M88 98L100 113L112 98" fill="#F1BE97" stroke="${N}" stroke-width="2.5" stroke-linejoin="round"/><path d="M84 126C74 126 70 116 72 108C78 118 86 120 92 122Z" fill="${c}" stroke="${N}" stroke-width="2" stroke-linejoin="round"/><path d="M116 126C126 126 130 116 128 108C122 118 114 120 108 122Z" fill="${c}" stroke="${N}" stroke-width="2" stroke-linejoin="round"/><path d="M88 122Q100 118 112 122L110 142Q100 152 90 142Z" fill="${c}" stroke="${N}" stroke-width="2" stroke-linejoin="round"/><path d="M92 132L98 134L92 137Z" fill="${N}"/><path d="M108 132L102 134L108 137Z" fill="${N}"/>`},
  head:()=>{const sk='#F1BE97',hair='#D7A649',hi='#EBC46A',fr='#C98F6B';return `<ellipse cx="65" cy="76" rx="7" ry="9" fill="${sk}" ${st}/><ellipse cx="135" cy="76" rx="7" ry="9" fill="${sk}" ${st}/><circle cx="100" cy="72" r="35" fill="${sk}" ${st}/>${eyes(73,13,5.5)}<path d="M78 63L94 68M122 63L106 68" stroke="#8A6A2E" stroke-width="4.5" stroke-linecap="round"/><path d="M100 78Q96 85 102 86" fill="none" stroke="${fr}" stroke-width="2.5" stroke-linecap="round"/><path d="M94 74l-5-2M106 74l5-2" stroke="${fr}" stroke-width="2" stroke-linecap="round"/><path d="M85 90Q100 103 116 89Q100 95 85 90Z" fill="#fff" stroke="${N}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="83" cy="84" r="1.6" fill="${fr}"/><circle cx="89" cy="87" r="1.6" fill="${fr}"/><circle cx="117" cy="84" r="1.6" fill="${fr}"/><circle cx="111" cy="87" r="1.6" fill="${fr}"/><path d="M62 70C54 40 76 20 100 22C126 20 148 40 138 70C134 56 126 48 116 47C108 40 96 40 88 46C76 46 66 56 62 70Z" fill="${hair}" ${st}/><path d="M80 28L72 12L94 24Z" fill="${hair}" ${st}/><path d="M102 22L110 6L120 26Z" fill="${hair}" ${st}/><path d="M124 30L142 22L136 42Z" fill="${hair}" ${st}/><path d="M70 44L58 34L76 34Z" fill="${hair}" ${st}/><path d="M78 40C92 32 108 34 120 42" stroke="${hi}" stroke-width="5" fill="none" stroke-linecap="round"/>`}}
};
let uid=0;
function hero(type,level,eq,view){
  const H=HEROES[type],tier=tierOf(level),id='a'+(++uid);
  const armFill=H.short?H.hand:H.suit,sleeve=x=>H.short?`<rect x="${x}" y="106" width="22" height="26" rx="11" fill="${H.suit}" ${st}/>`:'';
  let s=`<svg viewBox="${view||'0 -12 200 252'}" role="img" aria-label="${H.name}" xmlns="http://www.w3.org/2000/svg">`;
  if(eq.aura){const c={gold:['#FFE38A','#F5B300'],ice:['#D6F3FF','#4FB8F0'],fire:['#FFD08A','#FF5B2E']}[eq.aura];
    s+=`<defs><radialGradient id="${id}"><stop offset=".35" stop-color="${c[0]}" stop-opacity=".95"/><stop offset="1" stop-color="${c[1]}" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="118" r="106" fill="url(#${id})"/>`;}
  s+=`<ellipse cx="100" cy="226" rx="54" ry="8" fill="#000" opacity=".16"/>`;
  if(eq.cape){const c={red:'#E5383B',blue:'#2F7DE1',gold:'#F2B01E'}[eq.cape];
    s+=`<path d="M68 104Q32 166 38 216L162 216Q168 166 132 104Z" fill="${c}" ${st}/>`;}
  if(type==='fox') s+=`<path d="M134 182C178 192 198 150 176 120C170 150 152 158 134 160Z" fill="#E8823A" ${st}/><circle cx="177" cy="126" r="7" fill="#FFF3E6"/>`;
  s+=`<rect x="76" y="166" width="18" height="48" rx="8" fill="${H.trim}" ${st}/><rect x="106" y="166" width="18" height="48" rx="8" fill="${H.trim}" ${st}/><ellipse cx="85" cy="214" rx="15" ry="8" fill="${N}"/><ellipse cx="115" cy="214" rx="15" ry="8" fill="${N}"/>`;
  s+=`<rect x="60" y="98" width="80" height="78" rx="28" fill="${H.suit}" ${st}/>`;
  if(H.torso)s+=H.torso(tier,id);
  if(!H.noBelt)s+=`<rect x="65" y="151" width="70" height="11" fill="${H.trim}" stroke="${N}" stroke-width="2.500"/><rect x="94" y="149" width="12" height="15" rx="3" fill="${H.acc}" stroke="${N}" stroke-width="2.500"/>`;
  if(tier>=2&&!H.torso) s+=`<polygon points="${star(100,140,10,4.200)}" fill="${H.acc}" stroke="${N}" stroke-width="2.500" stroke-linejoin="round"/>`;
  if(eq.neck==='scarf') s+=`<path d="M116 104L130 142L114 140L106 106Z" fill="#E5383B" ${st}/><rect x="64" y="92" width="72" height="16" rx="8" fill="#E5383B" ${st}/>`;
  if(eq.neck==='medal') s+=`<path d="M84 98L100 120L116 98" fill="none" stroke="#E5383B" stroke-width="7" stroke-linejoin="round"/><circle cx="100" cy="124" r="9" fill="#F2B01E" ${st}/>`;
  if(eq.neck==='gem') s+=`<path d="M80 98Q100 122 120 98" fill="none" stroke="#F2B01E" stroke-width="3.500" stroke-linecap="round"/><polygon points="100,112 109,123 100,136 91,123" fill="#22C7B8" ${st}/>`;
  s+=`<rect x="40" y="106" width="22" height="58" rx="11" fill="${armFill}" ${st}/>${sleeve(40)}<circle cx="51" cy="168" r="10" fill="${H.hand}" ${st}/>`;
  s+=`<rect x="138" y="106" width="22" height="58" rx="11" fill="${armFill}" ${st}/>${sleeve(138)}`;
  if(eq.tool==='broom') s+=`<rect x="146.500" y="116" width="5" height="98" rx="2.500" fill="#8A5A2B" stroke="${N}" stroke-width="2"/><path d="M136 196L162 196L169 224L129 224Z" fill="#E7C36B" ${st}/><path d="M143 200L141 222M149 200V222M155 200L157 222" stroke="${N}" stroke-width="2" stroke-linecap="round"/>`;
  if(eq.tool==='spray') s+=`<rect x="140" y="150" width="20" height="34" rx="6" fill="#6FC7E8" ${st}/><rect x="141" y="140" width="22" height="12" rx="4" fill="#fff" ${st}/><rect x="162" y="143" width="9" height="5" rx="2" fill="${N}"/><circle cx="178" cy="141" r="2.500" fill="#6FC7E8"/><circle cx="183" cy="149" r="2" fill="#6FC7E8"/><circle cx="177" cy="153" r="1.800" fill="#6FC7E8"/>`;
  if(eq.tool==='sponge') s+=`<rect x="132" y="150" width="34" height="26" rx="8" fill="#FFD23F" ${st}/><circle cx="142" cy="160" r="2.500" fill="#C99A00"/><circle cx="154" cy="167" r="2.500" fill="#C99A00"/><circle cx="141" cy="138" r="6" fill="#fff" stroke="#6FC7E8" stroke-width="2"/><circle cx="158" cy="132" r="8" fill="#fff" stroke="#6FC7E8" stroke-width="2"/><circle cx="171" cy="146" r="4" fill="#fff" stroke="#6FC7E8" stroke-width="2"/>`;
  s+=`<circle cx="149" cy="168" r="10" fill="${H.hand}" ${st}/>`;
  if(tier>=3) s+=`<circle cx="62" cy="110" r="13" fill="${H.trim}" ${st}/><circle cx="138" cy="110" r="13" fill="${H.trim}" ${st}/>`;
  s+=H.head();
  if(tier>=3) s+=`<polygon points="${star(26,66,8,3)}" fill="#F5B300"/><polygon points="${star(176,42,6,2.400)}" fill="#F5B300"/>`;
  if(tier>=4) s+=`<ellipse cx="100" cy="-6" rx="28" ry="7" fill="none" stroke="#F5B300" stroke-width="5"/>`;
  if(eq.pet==='slime') s+=`<path d="M12 218Q12 188 34 188Q56 188 56 218Z" fill="#5BD08A" ${st}/><circle cx="27" cy="206" r="3.500" fill="${N}"/><circle cx="41" cy="206" r="3.500" fill="${N}"/><path d="M22 196Q26 192 31 192" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if(eq.pet==='kitten') s+=`<ellipse cx="34" cy="208" rx="20" ry="12" fill="#F0A15B" ${st}/><polygon points="20,196 22,178 33,190" fill="#F0A15B" ${st}/><polygon points="48,196 46,178 35,190" fill="#F0A15B" ${st}/><circle cx="34" cy="198" r="15" fill="#F0A15B" ${st}/><circle cx="28" cy="197" r="2.500" fill="${N}"/><circle cx="40" cy="197" r="2.500" fill="${N}"/><polygon points="32,202 36,202 34,205" fill="#F08AA3"/>`;
  if(eq.pet==='dragon') s+=`<polygon points="22,200 6,180 32,192" fill="#7EE0D8" ${st}/><ellipse cx="34" cy="208" rx="20" ry="12" fill="#22C7B8" ${st}/><circle cx="48" cy="197" r="11" fill="#22C7B8" ${st}/><polygon points="44,188 46,180 50,187" fill="#F2B01E" ${st}/><circle cx="51" cy="196" r="2.500" fill="${N}"/><circle cx="10" cy="214" r="4" fill="#22C7B8" ${st}/>`;
  return s+'</svg>';
}
const HEAD_VIEW='36 -8 128 128';
const eqFor=(k,lv)=>{const o={};SLOTS.forEach(sl=>{if(sl.lvl<=lv&&k.eq[sl.id])o[sl.id]=k.eq[sl.id]});return o};

/* ---------- ikony ---------- */
const IC={
 bed:'<path d="M3 19V6M3 14h18v5M21 14v-2.500A2.500 2.500 0 0 0 18.500 9H11v5"/><circle cx="7" cy="10.500" r="1.800"/>',
 tooth:'<path d="M12 6C10.500 5 9 4.500 7.500 4.500 5.300 4.500 4 6.200 4 8.500c0 2.500 1.200 3.500 1.600 6 .3 2 .6 5.500 2 5.500 1.300 0 1.300-3.500 2.400-3.500h4c1.100 0 1.100 3.500 2.400 3.500 1.400 0 1.700-3.500 2-5.500.4-2.500 1.600-3.500 1.600-6 0-2.300-1.300-4-3.500-4-1.500 0-3 .5-4.500 1.500z"/>',
 desk:'<path d="M3 11h18M5 11v8M19 11v8M8 11V6h5v5M16 8l2 3"/>',
 bag:'<path d="M9 7a3 3 0 0 1 6 0M6 11a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM9 15h6"/>',
 door:'<path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M3 21h18M12.500 12h.01"/>',
 bin:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
 dish:'<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/>',
 shirt:'<path d="M8 4 3 7l2 4 3-1v10h8V10l3 1 2-4-5-3c-.5 1.500-2 2.500-4 2.500S8.500 5.500 8 4z"/>',
 lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
 flame:'<path d="M12 3c1 4 5 5.500 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 2.500 1.500 2.500C11 9 11 6 12 3z"/>',
 home:'<path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10"/>',
 hero:'<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/>',
 group:'<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.500"/><path d="M3 20c0-3.500 2.500-6 6-6s6 2.500 6 6M15 14.500c3 0 6 1 6 5"/>',
 key:'<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15 12v2"/>',
 check:'<path d="M5 12.500l4.500 4.500L19 7"/>',
 x:'<path d="M6 6l12 12M18 6L6 18"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 play:'<path d="M8 5v14l11-7z"/>',
 calc:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'
};
const ic=(n,c='')=>`<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
const shield=cr=>`<svg class="sh ${cr?'cr':''}" viewBox="0 0 40 46" aria-hidden="true"><path class="sf" d="M20 2 36 8v14c0 11-7 19-16 22C11 41 4 33 4 22V8z"/>${cr?'<path class="sc" d="M21 5 16 17l7 5-8 10 5 11"/>':`<polygon class="ss" points="${star(20,23,9,3.800)}"/>`}</svg>`;


window.HHG={XPT,setXPT,FORMS,lvlOf,tierOf,SLOTS,HEROES,hero,HEAD_VIEW,eqFor,ic,IC,shield,star,esc,dny};
})();
