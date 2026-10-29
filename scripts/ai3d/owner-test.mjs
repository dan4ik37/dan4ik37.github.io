// AI3D unit checks (owner test.mjs) — author: the site owner (dan4ik37); ported into the site 2026-10-29 (T-112). Run by scripts/ai3d-test.cjs.
// Reads the editor body from js/apps/ai3d/ai3d-core.js (between the @ai3d-body markers) instead of ai3d.html; the checks are his.
// Запуск: node test.mjs  (нужен только Node 18+, интернет не нужен)
// Берёт настоящие функции из ai3d.html и проверяет их на упрощённой модели three.js.
import fs from 'fs';import assert from 'assert';
const src=fs.readFileSync(new URL('../../js/apps/ai3d/ai3d-core.js',import.meta.url),'utf8'),js=src.slice(src.indexOf('/*@ai3d-body*/')+14,src.indexOf('/*@ai3d-body-end*/'));   // site: the editor body (was ai3d.html <script>)
function grab(name){const i=js.indexOf('function '+name+'(');if(i<0)throw new Error('нет функции '+name);let d=0,j=js.indexOf('{',i);for(let k=j;k<js.length;k++){if(js[k]==='{')d++;else if(js[k]==='}'){d--;if(!d)return js.slice(i,k+1)}}}
const names=['kids','withKids','rigid','ccdSolve','mirrorPose','consDist','aimObj','sockWorld','connectSock','snapSock','toMesh','subdivSel','adjM','lap1','lapM','normM','brushM','maskM','decArr','maskFromData','cmpMasks','hintOf','mirrorXf','mirrorSolve','ensureColors','ensureLayer','composite','putColor','paintM','sampleRGB','avgEdge','bakePhoto','layerOn','lockGuard','appendVert','uvGen','bakeUVTex','dilateInto','paintUVTex','nearIdx','viewSample','mkStitch','stitchStat','stitchGains','stitchBlend','bakeMultiVerts','bakeUVMulti','simAABB','spinRot','rng','hexRGB','vA','vC','vN','mbNew','ringTube','leafAt','treeGen','hairGen','shellFrom','pushOut','clothMk','clothSim','qMul','qRot','qAxis','qInv','qEul','qToEul','qSlerp','morphTrackData','fkPose','roleOf','sideOf','rigAuto','gaitGen','interpPose','springFollow','secondaryGen','hash2','vnoise2','fbm2','noise3','meshArea','furGen','warpMesh','faceLM','faceKeys','facePins','facePreset','faceVarPins','erodeT','terrainHeight','terrainSlope','terrainGen','scatterPts','scatterMerge','bumpGen','limbT','ellP','humanParts','animalParts','hexMul','hexMix','artSpline','artPoly','artFill','artCol','artScan','artStroke','rasterArt','eyeOutline','animeArt','eyeTexShapes','faceCtl','gridMesh','puppetBuild','drapeMesh','lidShell','faceHeadPins','face3dParts','faceAnimKeys','wingMesh','addonParts','anthroParts','centaurParts','manifestOf'];
const qE=js.match(/const qE=[^\n]*\n/)[0];
const VT=js.match(/const VT=[^\n]*\n/)[0];
const MINI=`class V3{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}set(x,y,z){this.x=x;this.y=y;this.z=z;return this}clone(){return new V3(this.x,this.y,this.z)}
 add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this}sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this}
 length(){return Math.hypot(this.x,this.y,this.z)}normalize(){return this.multiplyScalar(1/(this.length()||1))}dot(v){return this.x*v.x+this.y*v.y+this.z*v.z}distanceTo(v){return this.clone().sub(v).length()}
 applyQuaternion(q){const{x,y,z}=this,qx=q.x,qy=q.y,qz=q.z,qw=q.w,ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;
  this.x=ix*qw+iw*-qx+iy*-qz-iz*-qy;this.y=iy*qw+iw*-qy+iz*-qx-ix*-qz;this.z=iz*qw+iw*-qz+ix*-qy-iy*-qx;return this}toArray(){return[this.x,this.y,this.z]}}
const mq=(a,b)=>new Q(a.x*b.w+a.w*b.x+a.y*b.z-a.z*b.y,a.y*b.w+a.w*b.y+a.z*b.x-a.x*b.z,a.z*b.w+a.w*b.z+a.x*b.y-a.y*b.x,a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z);
class Q{constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w}
 _s(q){this.x=q.x;this.y=q.y;this.z=q.z;this.w=q.w;return this}
 setFromAxisAngle(a,an){const h=an/2,s=Math.sin(h);this.x=a.x*s;this.y=a.y*s;this.z=a.z*s;this.w=Math.cos(h);return this}
 setFromEuler(e){const c1=Math.cos(e.x/2),c2=Math.cos(e.y/2),c3=Math.cos(e.z/2),s1=Math.sin(e.x/2),s2=Math.sin(e.y/2),s3=Math.sin(e.z/2);
  this.x=s1*c2*c3+c1*s2*s3;this.y=c1*s2*c3-s1*c2*s3;this.z=c1*c2*s3+s1*s2*c3;this.w=c1*c2*c3-s1*s2*s3;return this}
 multiply(b){return this._s(mq(this,b))}premultiply(b){return this._s(mq(b,this))}invert(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this}
 setFromUnitVectors(a,b){let r=a.dot(b)+1;if(r<1e-6){r=0;if(Math.abs(a.x)>Math.abs(a.z)){this.x=-a.y;this.y=a.x;this.z=0;this.w=r}else{this.x=0;this.y=-a.z;this.z=a.y;this.w=r}}
  else{this.x=a.y*b.z-a.z*b.y;this.y=a.z*b.x-a.x*b.z;this.z=a.x*b.y-a.y*b.x;this.w=r}const l=Math.hypot(this.x,this.y,this.z,this.w);this.x/=l;this.y/=l;this.z/=l;this.w/=l;return this}
 angleTo(q){return 2*Math.acos(Math.min(1,Math.abs(this.x*q.x+this.y*q.y+this.z*q.z+this.w*q.w)))}}
class E{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}
 setFromQuaternion(q){const{x,y,z,w}=q,m11=1-2*(y*y+z*z),m12=2*(x*y-w*z),m13=2*(x*z+w*y),m22=1-2*(x*x+z*z),m23=2*(y*z-w*x),m32=2*(y*z+w*x),m33=1-2*(x*x+y*y);
  this.y=Math.asin(Math.max(-1,Math.min(1,m13)));if(Math.abs(m13)<.9999999){this.x=Math.atan2(-m23,m33);this.z=Math.atan2(-m12,m11)}else{this.x=Math.atan2(m32,m22);this.z=0}return this}}
const THREE={Vector3:V3,Quaternion:Q,Euler:E,Color:class{constructor(h){const n=parseInt(String(h).replace('#',''),16);this.r=((n>>16)&255)/255;this.g=((n>>8)&255)/255;this.b=(n&255)/255}}};
`;
const body=`const LAYERS={};let SOLO=null;let state=[];const R2=v=>v.map(x=>+x.toFixed(4));let n=0;const ok=(c,m)=>{assert.ok(c,m);n++};
${qE}${VT}${names.map(grab).join('\n')}
const near=(a,b,e=1e-3)=>a.every((x,i)=>Math.abs(x-b[i])<e);
// сокеты и connect
state=[{name:'A',pos:[0,0,0],rot:[0,0,0],sockets:{top:{pos:[0,1,0],dir:[0,1,0]}}},{name:'B',pos:[5,5,5],rot:[0,0,90],sockets:{bot:{pos:[0,-1,0],dir:[0,-1,0]}}},{name:'C',pos:[5,7,5],rot:[0,0,0],parent:'B'}];
const dist0=Math.hypot(0,2,0);connectSock({a:'B:bot',b:'A:top'});
let sb=sockWorld(state[1],'bot'),sa=sockWorld(state[0],'top');
ok(near(sb.p.toArray(),sa.p.toArray()),'точки гнёзд совпали');ok(near(sb.d.toArray(),[0,-1,0]),'направления встречные');
ok(Math.abs(Math.hypot(...state[2].pos.map((v,i)=>v-state[1].pos[i]))-dist0)<1e-3,'ребёнок сохранил расстояние');
connectSock({a:'B:bot',b:'A:top',gap:.5});ok(near(sockWorld(state[1],'bot').p.toArray(),[0,1.5,0]),'gap');
state[1].pos=[.2,3,0];state[1].rot=[0,0,0];state[2].parent=undefined;snapSock({name:'B',radius:3});ok(near(state[1].pos,[0,2,0]),'snap');
// aim, ik, rotate
state=[{name:'o',pos:[0,0,0],rot:[0,0,0]},{name:'k',pos:[0,0,1],rot:[0,0,0],parent:'o'}];aimObj(state[0],[1,1,0],'z');
ok(near(new THREE.Vector3(0,0,1).applyQuaternion(qE(state[0].rot)).toArray(),[Math.SQRT1_2,Math.SQRT1_2,0]),'aim');ok(aimObj(state[0],[1,1,0],'z')===false,'aim повторно ничего не делает');
state=[{name:'j1',pos:[0,0,0],rot:[0,0,0]},{name:'j2',pos:[0,1,0],rot:[0,0,0],parent:'j1'},{name:'j3',pos:[0,2,0],rot:[0,0,0],parent:'j2'}];
ccdSolve(state.map(x=>x.pos),[1,1.2,.5],30).steps.forEach(s=>{const j=state[s.i],R=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...s.ax),s.an),P=new THREE.Vector3(...j.pos),z=new THREE.Vector3();[j,...kids(j.name)].forEach(x=>rigid(x,R,P,z))});
ok(near(state[2].pos,[1,1.2,.5],.01),'IK достаёт цель');ok(Math.abs(Math.hypot(...state[1].pos)-1)<1e-3,'длина кости сохранена');
state=[{name:'a',pos:[1,0,0],rot:[0,0,0]}];rigid(state[0],new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2),new THREE.Vector3(),new THREE.Vector3());ok(near(state[0].pos,[0,0,-1]),'rotate');
// сетка
const oct={v:[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],f:[0,2,4,2,1,4,1,3,4,3,0,4,2,0,5,1,2,5,3,1,5,0,3,5]};
const vol=m=>{let s=0;for(let i=0;i<m.f.length;i+=3){const a=m.f[i]*3,b=m.f[i+1]*3,c=m.f[i+2]*3,v=m.v;s+=(v[a]*(v[b+1]*v[c+2]-v[b+2]*v[c+1])-v[a+1]*(v[b]*v[c+2]-v[b+2]*v[c])+v[a+2]*(v[b]*v[c+1]-v[b+1]*v[c]))/6}return s};
const closed=m=>{const E=new Map();for(let i=0;i<m.f.length;i+=3)for(let k=0;k<3;k++){const key=m.f[i+k]+'>'+m.f[i+(k+1)%3];E.set(key,(E.get(key)||0)+1)}let r=true;E.forEach((c,k)=>{const[a,b]=k.split('>');if(c!==1||E.get(b+'>'+a)!==1)r=false});return r};
let m=oct;for(let i=0;i<2;i++)m=subdivSel(m,(a,b,d)=>(m.v[a*3+1]+m.v[b*3+1]+m.v[d*3+1])/3>.1);
ok(closed(m),'локальный subdiv замкнут');ok(Math.abs(vol(m)-4/3)<1e-3,'объём сохранён');
const t=subdivSel(subdivSel(oct,null),null);maskM(t,[0,1,0],.6,1);const apex=t.v.slice();brushM(t,'inflate',[0,1,0],.5,.3,0);
let i0=0;for(let i=0;i<t.v.length;i+=3)if(t.v[i]===0&&t.v[i+1]===1&&t.v[i+2]===0)i0=i;ok(t.v[i0+1]===apex[i0+1],'маска держит вершину');
const sph=subdivSel(subdivSel(subdivSel(subdivSel(oct,null),null),null),null);ok(decArr(sph.v,sph.f,null,8).I.length<sph.f.length/2,'LOD упрощает');
ok(near(consDist([0,0,0],[2,0,0],1),[-1,0,0]),'distance');ok(near(mirrorPose({pos:[.2,1,0],rot:[10,20,30]}).rot,[10,-20,-30]),'mirrorPose');
// референс-сравнение и зеркальная связь
{const S=16,A=new Uint8Array(S*S),B=new Uint8Array(S*S);for(let y=2;y<10;y++)for(let x=2;x<10;x++)A[y*S+x]=1;for(let y=2;y<10;y++)for(let x=4;x<12;x++)B[y*S+x]=1;
const cm=cmpMasks(A,B,S);ok(Math.abs(cm.iou-.6)<1e-9,'IoU 0.6');ok(hintOf(cm,S/2).includes('влево'),'подсказка: модель левее референса');ok(Math.abs(cmpMasks(A,A,S).iou-1)<1e-9,'IoU 1 у одинаковых');}
{const w=4,h=4,d=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){d[i*4+3]=255}for(const [x,y] of [[1,1],[2,1],[1,2],[2,2]]){const i=(y*w+x)*4;d[i]=d[i+1]=d[i+2]=255}
ok(maskFromData(d,w,h).reduce((a,b)=>a+b,0)===4,'маска по фону');const e=new Uint8ClampedArray(w*h*4);for(const [x,y] of [[0,0],[1,0]]){e[(y*w+x)*4+3]=255}ok(maskFromData(e,w,h).reduce((a,b)=>a+b,0)===2,'маска по альфе');}
state=[{name:'arm_L',pos:[.5,1,0],rot:[10,20,30]},{name:'arm_R',pos:[-.2,0,0],rot:[0,0,0]}];ok(mirrorSolve({swap:['_L','_R']}),'зеркало сработало');ok(near(state[1].pos,[-.5,1,0])&&near(state[1].rot,[10,-20,-30]),'зеркало поз и поворотов');ok(!mirrorSolve({swap:['_L','_R']}),'второй проход без изменений');
// цветовые слои
{const m={v:[0,0,0,1,0,0,0,1,0,1,1,0],f:[0,1,2,1,3,2]},o={color:'#ff0000',size:m};ensureColors(o);ok(near(m.c.slice(0,3),[1,0,0]),'базовый цвет');
const L=ensureLayer(m,'a');paintM(m,[0,0,0],0,[0,0,1],1,true,L);composite(m);ok(near(m.c.slice(0,3),[0,0,1]),'слой перекрывает базу');
L.op=.5;composite(m);ok(near(m.c.slice(0,3),[.5,0,.5]),'прозрачность слоя');L.on=false;composite(m);ok(near(m.c.slice(0,3),[1,0,0]),'слой выключен: цвет базы вернулся');
L.on=true;L.op=1;m.mk=[1,0,0,0];paintM(m,[0,0,0],0,[0,1,0],1,true);composite(m);ok(near(m.c.slice(0,3),[0,0,1]),'маска защищает от краски (база не тронута)');ok(near(m.c0.slice(3,6),[0,1,0]),'без маски база закрашена');
const s2=subdivSel(m,null);ok(s2.L[0].c.length===s2.v.length&&s2.L[0].a.length===s2.v.length/3&&s2.c0.length===s2.v.length,'subdiv интерполирует слои');}
ok(near(sampleRGB({d:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),w:2,h:2},.25,.25),[1,0,0]),'sampleRGB центр пикселя');
// фото-проекция
{const px={d:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),w:2,h:2},R={px,w:2,u:0,v:1};
const m={v:[-.5,.5,0,.5,.5,0,-.5,1.5,0,.5,1.5,0],f:[0,1,2,1,3,2]},o={name:'p',pos:[0,0,0],rot:[0,0,0],size:m,color:'#000000'};ensureColors(o);
const hit=bakePhoto(o,R,'front',{strength:1,power:1});ok(hit===4,'все 4 вершины окрашены');
const col=i=>m.c.slice(i*3,i*3+3).map(x=>Math.round(x));ok(near(col(0),[0,0,1])&&near(col(1),[1,1,1])&&near(col(2),[1,0,0])&&near(col(3),[0,1,0]),'цвета фото легли на нужные вершины');
const m2={v:m.v.slice(),f:[0,2,1,1,2,3]},o2={name:'q',pos:[0,0,0],rot:[0,0,0],size:m2};ensureColors(o2);ok(bakePhoto(o2,R,'front',{strength:1})===0,'вершины спиной к проекции не окрашиваются');
const m3={v:m.v.slice(),f:m.f.slice()},o3={name:'r',pos:[0,0,0],rot:[0,0,0],size:m3};ensureColors(o3);const L3=ensureLayer(m3,'фото');bakePhoto(o3,R,'front',{strength:1,power:1},L3);composite(m3);ok(near(m3.c.slice(6,9),[1,0,0],.01),'фото в отдельном слое');
const m4={v:[-.5,.5,0,.5,.5,0,-.5,1.5,0,.5,1.5,0],f:m.f.slice()},o4={name:'s',pos:[0,0,0],rot:[0,0,0],size:m4};ensureColors(o4);bakePhoto(o4,R,'front',{strength:1,power:1,fold:'-'});
const c4=i=>m4.c.slice(i*3,i*3+3).map(x=>Math.round(x));ok(near(c4(0),c4(1)),'fold: левая и правая половины берут одну сторону фото');}
// слои сцены
LAYERS.a={visible:false,locked:true};state=[{name:'x',layer:'a'},{name:'y'}];ok(layerOn(state[0])===false&&layerOn(state[1])===true,'скрытый слой');
let thrown=false;try{lockGuard({op:'set',name:'x'})}catch(e){thrown=true}ok(thrown,'замок слоя блокирует правку');lockGuard({op:'set',name:'y'});SOLO='b';ok(layerOn(state[1])===false,'соло скрывает всё остальное');SOLO=null;
// UV и запекание в текстуру
{const px={d:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),w:2,h:2},R={px,w:2,u:0,v:1};
const m={v:[-.5,.5,0,.5,.5,0,-.5,1.5,0,.5,1.5,0],f:[0,1,2,1,3,2],uv:[0,0,1,0,0,1,1,1]},o={name:'p',pos:[0,0,0],rot:[0,0,0],size:m};
const T={w:8,h:8,d:new Uint8ClampedArray(8*8*4).fill(0),cov:new Float32Array(64)};for(let i=0;i<64;i++)T.d[i*4+3]=255;
const hit=bakeUVTex(o,R,'front',{strength:1,power:1},T);ok(hit>=60,'текстура почти целиком закрашена: '+hit);
const px4=(x,y)=>Array.from(T.d.slice((y*8+x)*4,(y*8+x)*4+3));ok(px4(0,7)[2]>150&&px4(0,7)[0]<80,'низ-лево текстуры синий (как в фото)');ok(px4(0,0)[0]>150&&px4(0,0)[2]<80,'верх-лево красный');ok(px4(7,0)[1]>150,'верх-право зелёный');
const dd=new Uint8ClampedArray(8*8*4);const cv0=new Float32Array(64);cv0[27]=1;dd[27*4]=200;dilateInto(dd,cv0,8,8,2);ok(dd[(27+1)*4]===200&&dd[(27+8)*4]===200,'dilate растекает цвет на соседей');}
{const seg=8,V=[],F=[];for(let k=0;k<seg;k++){const a=k/seg*Math.PI*2;V.push(Math.sin(a),0,Math.cos(a),Math.sin(a),1,Math.cos(a))}
for(let k=0;k<seg;k++){const a=k*2,b=((k+1)%seg)*2;F.push(a,a+1,b,a+1,b+1,b)}
const m={v:V,f:F},o={name:'c',pos:[0,0,0],rot:[0,0,0],size:m};const before=V.length/3;uvGen(o,'cylinder',{});
ok(m.v.length/3>before,'шов цилиндра размножил вершины');let okSpan=true;for(let t=0;t<m.f.length;t+=3){const us=[0,1,2].map(i=>m.uv[m.f[t+i]*2]);if(Math.max(...us)-Math.min(...us)>.5)okSpan=false}ok(okSpan,'ни один треугольник не растянут через шов UV');ok(m.uv.length===m.v.length/3*2,'uv на каждую вершину');
const q={v:[-.5,.5,0,.5,.5,0,-.5,1.5,0,.5,1.5,0],f:[0,1,2,1,3,2]},oq={name:'q',pos:[0,0,0],rot:[0,0,0],size:q};uvGen(oq,'planar',{view:'front'});ok(q.uv.every(x=>x>=0&&x<=1)&&q.uv.length===8,'planar uv в пределах 0..1');}
// исправленные ограничения
{const oct0={v:[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],f:[0,2,4,2,1,4,1,3,4,3,0,4,2,0,5,1,2,5,3,1,5,0,3,5]};
let sph=oct0;for(let i=0;i<3;i++)sph=subdivSel(sph,null);for(let i=0;i<sph.v.length;i+=3){const l=Math.hypot(sph.v[i],sph.v[i+1],sph.v[i+2]);sph.v[i]/=l;sph.v[i+1]/=l;sph.v[i+2]/=l}
const os={name:'s',pos:[0,0,0],rot:[0,0,0],size:{v:sph.v,f:sph.f}};uvGen(os,'sphere',{});const ms=os.size;let span=0;for(let t=0;t<ms.f.length;t+=3){const us=[0,1,2].map(i=>ms.uv[ms.f[t+i]*2]);span=Math.max(span,Math.max(...us)-Math.min(...us))}
ok(span<=.5,'сферическая развёртка: нет растянутых через шов треугольников (макс. разброс u '+span.toFixed(2)+')');ok(ms.uv.length===ms.v.length/3*2,'uv на каждую вершину после полюсов и шва');
// формы переживают subdiv и размножение вершин
const base={v:oct0.v.slice(),f:oct0.f.slice(),sk:{k:oct0.v.map(x=>x*.1)},b:oct0.v.slice()};const sd=subdivSel(base,null);ok(sd.sk.k.length===sd.v.length&&sd.b.length===sd.v.length,'subdiv сохраняет формы (shape) и базу');
const base2={v:oct0.v.slice(),f:oct0.f.slice(),sk:{k:oct0.v.map(x=>x*.1)},b:oct0.v.slice()};const o2={name:'z',pos:[0,0,0],rot:[0,0,0],size:base2};uvGen(o2,'sphere',{});ok(base2.sk.k.length===base2.v.length&&base2.b.length===base2.v.length,'uv сохраняет формы при дублировании вершин');
// LOD с UV
const U=[];for(let i=0;i<sph.v.length/3;i++){U.push((Math.atan2(sph.v[i*3],sph.v[i*3+2])/(2*Math.PI)+.5)*.9,.5)}const dr=decArr(sph.v,sph.f,null,10,U);ok(dr.U&&dr.U.length===dr.P.length/3*2&&dr.I.length<sph.f.length,'LOD сохраняет UV');
// bool переносит UV: ближайшие вершины
const A0={type:'mesh',pos:[0,0,0],rot:[0,0,0],scale:1,size:{v:oct0.v,f:oct0.f,uv:oct0.v.map((x,i)=>i%3===0?x:.5).filter((_,i)=>i%3!==2).slice(0,12)}};
const ix=nearIdx({v:[1,0,0,0,0,-1]},A0);ok(ix[0]===0&&ix[1]===5,'nearIdx находит ближайшие вершины');
// краска прямо в текстуру
{const m={v:[-.5,.5,0,.5,.5,0,-.5,1.5,0,.5,1.5,0],f:[0,1,2,1,3,2],uv:[0,0,1,0,0,1,1,1]},o={name:'p',pos:[0,0,0],rot:[0,0,0],size:m},T={w:8,h:8,d:new Uint8ClampedArray(8*8*4),cov:new Float32Array(64)};for(let i=0;i<64;i++)T.d[i*4+3]=255;
const hit=paintUVTex(o,T,[0,1,0],.4,[0,1,0],1,false);ok(hit>5&&hit<64,'краска в текстуре: локально');const mid=(4*8+4)*4;ok(T.d[mid+1]>200&&T.d[mid]<30,'центр мазка зелёный');ok(T.d[1]<5,'угол вне кисти не закрашен');
const T2={w:8,h:8,d:new Uint8ClampedArray(8*8*4),cov:new Float32Array(64)};m.mk=[1,1,1,1];ok(paintUVTex(o,T2,[0,1,0],.4,[0,1,0],1,false)===0&&T2.d[mid+1]===0,'маска защищает текстуру');}
}
// сшивка фото
{const solid=(r,g,b)=>({d:new Uint8ClampedArray([r,g,b,255,r,g,b,255,r,g,b,255,r,g,b,255]),w:2,h:2}),
 plane=()=>({v:[-.5,.5,.5,.5,.5,-.5,-.5,1.5,.5,.5,1.5,-.5],f:[0,1,2,1,3,2]});
ok(viewSample({px:solid(10,20,30),w:2,u:0,v:1},'front',{},[0,1,0],[0,0,1]).c[0]>0,'viewSample: прямо перед камерой');ok(viewSample({px:solid(10,20,30),w:2,u:0,v:1},'front',{},[0,1,0],[0,0,-1])===null,'viewSample: спиной к виду');
ok(viewSample({px:solid(10,20,30),w:2,u:0,v:1},'back',{},[0,1,0],[0,0,-1])!==null&&viewSample({px:solid(10,20,30),w:2,u:0,v:1},'left',{},[0,1,0],[-1,0,0])!==null,'новые виды: back и left');
const Rf={px:solid(200,100,50),w:2,u:0,v:1},Rs={px:solid(160,80,40),w:2,u:0,v:1};
const m={...plane()},o={name:'d',pos:[0,0,0],rot:[0,0,0],size:m};ensureColors(o);const r=bakeMultiVerts(o,[{R:Rf,view:'front'},{R:Rs,view:'side'}],{strength:1,min:.15},null);
ok(r.hit===4,'сшивка: все вершины');ok(r.g[1][0]>1.2&&r.g[1][0]<1.3,'сшивка: боковое фото светлее на 25% (гейн '+r.g[1][0].toFixed(2)+')');
ok(Math.abs(m.c[0]-200/255)<.02&&Math.abs(m.c[1]-100/255)<.02,'сшивка: цвета выровнены по первому фото');
const m2={...plane()},o2={name:'e',pos:[0,0,0],rot:[0,0,0],size:m2};ensureColors(o2);bakeMultiVerts(o2,[{R:Rf,view:'front'},{R:Rs,view:'side'}],{match:false},null);ok(m2.c[0]<190/255,'без match: среднее двух разных фото (видна полоса)');
const m3={...plane(),uv:[0,0,1,0,0,1,1,1]},o3={name:'f',pos:[0,0,0],rot:[0,0,0],size:m3},T={w:8,h:8,d:new Uint8ClampedArray(8*8*4),cov:new Float32Array(64)};for(let i=0;i<64;i++)T.d[i*4+3]=255;
const rt=bakeUVMulti(o3,[{R:Rf,view:'front'},{R:Rs,view:'side'}],{},T);ok(rt.hit>=50,'сшивка в текстуру: закрашено '+rt.hit);const mid=(4*8+4)*4;ok(Math.abs(T.d[mid]-200)<8,'сшивка в текстуру: яркость выровнена ('+T.d[mid]+')');
}
// физика
{const bx=(x,y,z,s=.4)=>({min:[x,y,z],max:[x+s,y+s,z+s],vel:[0,0,0]});
let r=simAABB([bx(0,3,0)],[],{time:3});ok(Math.abs(r.off[0][1]+3)<.01&&r.on[0]==='пол','падение на пол');
r=simAABB([bx(0,3,0)],[{min:[-1,.9,-1],max:[1,1,1],name:'стол'}],{time:3});ok(Math.abs(r.off[0][1]+2)<.01&&r.on[0]==='стол','падение на стол');
r=simAABB([bx(0,0,0),bx(0,1,0)],[],{time:3});ok(Math.abs(1+r.off[1][1]-.4)<.03&&Math.abs(r.off[0][1])<.01,'стопка: верхний лёг на нижний');
r=simAABB([bx(0,2,0)],[],{time:3,rest:.6,every:.05});const ys=r.frames.map(f=>2+f.off[0][1]),fi=ys.findIndex(y=>y<.3);ok(Math.max(...ys.slice(fi+2))>.4,'отскок после удара');
const wall={min:[1,0,-1],max:[1.1,2,1]},bw=bx(.8,.5,0);bw.vel=[3,0,0];r=simAABB([bw],[wall],{time:1});ok(.8+.4+r.off[0][0]<=1.0+1e-3,'стена не пропускает даже при вложенном старте');
r=simAABB([bx(0,5,0)],[],{time:2,floor:false});ok(5+r.off[0][1]<-5,'без пола падает дальше');
{const ball=bx(0,0,0,.4);ball.r=.2;ball.vel=[2,0,0];r=simAABB([ball],[],{time:1.5,every:.5});const dx=r.off[0][0],ang=2*Math.acos(Math.min(1,Math.abs(r.rot[0][3])));
ok(dx>1&&Math.abs(r.rot[0][2])>.1&&Math.abs(r.rot[0][0])<1e-6,'шар катится: вращение вокруг оси Z');
const az=2*Math.atan2(r.rot[0][2],r.rot[0][3]),df=(((az+dx/.2)%(2*Math.PI))+3*Math.PI)%(2*Math.PI)-Math.PI;ok(Math.abs(df)<.25,'угол качения = путь/радиус');
const bb2=bx(0,0,0,.4);bb2.vel=[2,0,0];r=simAABB([bb2],[],{time:1});ok(r.rot[0].every((v,i)=>v===[0,0,0,1][i]),'ящик не вращается');
ok(near(spinRot([0,0,0],[0,0,Math.sin(.25),Math.cos(.25)]),[0,0,28.648],.01),'spinRot: поворот в градусы');}
const th=bx(0,.5,0);th.vel=[2,4,0];r=simAABB([th],[],{time:.5,every:.1});ok(r.frames.length>=6&&r.frames.at(-1).off[0][0]>.9,'бросок: запись кадров и смещение');}
// манифест для игры
{const S=[{name:'ball',type:'sphere',pos:[0,1,0],color:'#f00'},{name:'tube',type:'cylinder',pos:[2,1,0],layer:'L'},{name:'wall',type:'box',pos:[4,1,0],parent:'ball',texid:'t1'},{name:'ghost',type:'box',pos:[0,0,0],hidden:true}];
const bb=n=>n==='ghost'?null:{min:[-.5,0,-.5],max:[.5,2,.5]};const man=manifestOf(S,{walk:{loop:true,keys:[{t:0,poses:{ball:{}}},{t:1,poses:{ball:{},tube:{}}}]}},{L:{visible:false,locked:false}},[{id:'c1',type:'lookat'}],bb);
ok(man.objects[0].collider.shape==='sphere'&&man.objects[0].collider.radius===1,'коллайдер шара (радиус по наибольшему размеру)');ok(man.objects[1].collider.shape==='cylinder'&&man.objects[1].collider.height===2,'коллайдер цилиндра');
ok(man.objects[2].collider.shape==='box'&&man.objects[2].parent==='ball'&&man.objects[2].material.texture===true,'коллайдер-коробка, родитель, текстура');ok(man.objects[3].collider===null&&man.objects[3].visible===false,'скрытый без коллайдера');
ok(man.objects[1].visible===false,'слой скрыт: visible false');ok(man.animations[0].duration===1&&man.animations[0].objects.length===2&&man.animations[0].loop===true,'анимации в манифесте');}
// деревья, волосы, одежда, ткань
{const okM=(M,nm)=>{ok(M.v.every(Number.isFinite)&&M.f.every(i=>i>=0&&i<M.v.length/3),nm+': числа и индексы в порядке');ok(M.c.length===M.v.length,nm+': цвета на каждую вершину')};
const ymax=M=>{let y=-1e9;for(let i=1;i<M.v.length;i+=3)y=Math.max(y,M.v[i]);return y};
['oak','pine','birch','palm','bush','dead'].forEach(sp=>{const M=treeGen({species:sp,height:5,seed:3});okM(M,'дерево '+sp);ok(Math.abs(ymax(M)-5)<.01,'высота '+sp+' = 5 м')});
const t1=treeGen({species:'oak',seed:7}),t2=treeGen({species:'oak',seed:7}),t3=treeGen({species:'oak',seed:8});
ok(JSON.stringify(t1.v)===JSON.stringify(t2.v),'дерево: тот же seed даёт то же дерево');ok(JSON.stringify(t1.v)!==JSON.stringify(t3.v),'дерево: другой seed даёт другое');
ok(treeGen({species:'oak',seed:7,leafDensity:.4}).f.length<t1.f.length,'leafDensity уменьшает листву');ok(treeGen({species:'dead',seed:7}).f.length<t1.f.length,'dead без листвы легче дуба');
let threw=false;try{treeGen({species:'xx'})}catch(e){threw=true}ok(threw,'неизвестный вид: ошибка');
const rd=[.09,.11,.1];const inside=M=>{let mn=1e9;for(let i=0;i<M.v.length;i+=3){const e=Math.hypot(M.v[i]/rd[0],M.v[i+1]/rd[1],M.v[i+2]/rd[2]);mn=Math.min(mn,e)}return mn};
['short','long','bob','ponytail','curly','spiky'].forEach(st=>{const H=hairGen({style:st,center:[0,0,0],radii:rd,seed:2});okM(H,'волосы '+st);ok(inside(H)>.93,'волосы '+st+' не проваливаются в голову ('+inside(H).toFixed(2)+')');ok(H.strands>200,'волосы '+st+': пряди есть')});
const hl=hairGen({style:'long',center:[0,0,0],radii:rd,seed:2}),hb=hairGen({style:'bob',center:[0,0,0],radii:rd,seed:2}),hs=hairGen({style:'short',center:[0,0,0],radii:rd,seed:2});
const ymin=M=>{let y=1e9;for(let i=1;i<M.v.length;i+=3)y=Math.min(y,M.v[i]);return y};
ok(ymin(hl)<-.35&&ymin(hs)>-.2,'длинные ниже коротких');ok(ymin(hb)>-.1&&ymin(hb)<-.07,'каре обрезано у подбородка');
ok(ymin(hairGen({style:'long',center:[0,0,0],radii:[.18,.22,.2],seed:2}))<ymin(hl),'волосы масштабируются с размером головы');
ok(hairGen({style:'long',center:[0,0,0],radii:rd,seed:2,bangs:true}).strands>hl.strands,'челка добавляет пряди');
{const cy=(()=>{const v=[],f=[],N=24,Y=12;for(let j=0;j<=Y;j++)for(let i=0;i<N;i++){const a=i/N*Math.PI*2;v.push(Math.cos(a)*.15,j/Y-.5,Math.sin(a)*.15)}for(let j=0;j<Y;j++)for(let i=0;i<N;i++){const a=j*N+i,b=j*N+(i+1)%N,c=a+N,d=b+N;f.push(a,c,b,b,c,d)}return{v,f}})();
const sh=shellFrom(cy,{y:[-.2,.3]},{gap:.02});ok(sh.v.length/3<cy.v.length/3&&sh.f.length>0,'оболочка: только выбранная область');
ok(Array.from({length:sh.v.length/3},(_,i)=>Math.hypot(sh.v[i*3],sh.v[i*3+2])).every(r=>Math.abs(r-.17)<.002),'оболочка: зазор 2 см над телом');
const sf=shellFrom(cy,{y:[-.2,.3]},{gap:.02,flare:1});const rmax=Math.max(...Array.from({length:sf.v.length/3},(_,i)=>Math.hypot(sf.v[i*3],sf.v[i*3+2])));ok(rmax>.18,'flare расширяет низ');
const st=shellFrom(cy,{y:[-.2,.3]},{gap:.02,thick:.01});ok(st.f.length>sh.f.length*2&&st.v.length===sh.v.length*2&&st.f.every(i=>i<st.v.length/3),'толщина: внутренний слой и кромка');
ok(shellFrom(cy,{y:[5,6]},{})===null,'пустая область: null');}
{const Cl=clothMk({shape:'skirt',pos:[0,1,0],r0:.17,r1:.35,h:.6,nx:20,ny:10}),p0=Cl.pins.map(i=>Cl.P.slice(i*3,i*3+3)),cols=[{k:'ell',c:[0,.9,0],r:[.16,.25,.14]},{k:'cyl',c:[0,.4,0],y:[0,.7],r:.1}];
const P=clothSim(Cl,{colliders:cols,steps:90});ok(P.every(Number.isFinite),'ткань: числа в порядке');
ok(Cl.pins.every((i,k)=>Math.abs(P[i*3]-p0[k][0])+Math.abs(P[i*3+1]-p0[k][1])<1e-9),'ткань: закреплённые точки на месте');
let bad=0;for(let i=0;i<P.length/3;i++){const x=P[i*3],y=P[i*3+1],z=P[i*3+2];const e=Math.hypot(x/.16,(y-.9)/.25,z/.14);if(e<.98)bad++;if(y>0&&y<.7&&Math.hypot(x,z)<.1-1e-3)bad++}ok(bad===0,'ткань не проходит сквозь тело');
let worst=0;Cl.con.forEach(([a,b,r])=>{if(r>1e-6)worst=Math.max(worst,Math.hypot(P[a*3]-P[b*3],P[a*3+1]-P[b*3+1],P[a*3+2]-P[b*3+2])/r)});ok(worst<1.25,'ткань почти не растянута ('+worst.toFixed(2)+')');
const Cr=clothMk({shape:'rect',pos:[0,1.5,0],w:1,h:1,nx:12,ny:12,pin:'corners'});const Q=clothSim(Cr,{steps:90});let mi=1e9;for(let i=1;i<Q.length;i+=3)mi=Math.min(mi,Q[i]);ok(mi<1.1&&mi>.3,'полотно за два угла провисает');
const Cw=clothMk({shape:'rect',pos:[0,1.5,0],w:1,h:1,nx:12,ny:12}),W=clothSim(Cw,{steps:90,wind:[0,0,8]});let mx=0;for(let i=2;i<W.length;i+=3)mx=Math.max(mx,W[i]);ok(mx>.3,'ветер надувает ткань (прогиб '+mx.toFixed(2)+' м)');const W0=clothSim(clothMk({shape:'rect',pos:[0,1.5,0],w:1,h:1,nx:12,ny:12}),{steps:90});let m0=0;for(let i=2;i<W0.length;i+=3)m0=Math.max(m0,Math.abs(W0[i]));ok(m0<.01,'без ветра ткань плоская');
const Cf=clothMk({shape:'rect',pos:[0,.3,0],w:1,h:1,nx:8,ny:8,pin:[]}),F2=clothSim(Cf,{steps:120});let lo=1e9;for(let i=1;i<F2.length;i+=3)lo=Math.min(lo,F2[i]);ok(lo>=.011&&lo<.05,'ткань ложится на пол');}}
// риг, походки, вторичное движение
{const nr=(a,b,e)=>a.every((v,i)=>Math.abs(v-b[i])<(e||1e-3));
[[10,20,30],[0,90,0],[-45,10,170],[33,-60,5]].forEach(e=>{ok(nr(qToEul(qEul(e)),e,.01)||nr(qToEul(qMul(qEul(e),[0,0,0,1])),qToEul(qEul(e)),.01),'эйлер-кватернион '+e)});
ok(nr(qRot(qAxis([0,1,0],90),[0,0,1]),[1,0,0],1e-9),'qRot: 90° вокруг Y');ok(nr(qRot(qAxis([1,0,0],90),[0,-1,0]),[0,0,-1],1e-9),'вращение вокруг X: низ уходит назад');
const mid=qSlerp(qAxis([0,1,0],0),qAxis([0,1,0],90),.5);ok(nr(qRot(mid,[0,0,1]),[Math.sin(Math.PI/4),0,Math.cos(Math.PI/4)],1e-6),'slerp: половина угла');
const rest=[{n:'a',pos:[0,1,0],rot:[0,0,0],parent:-1,pv:[0,1,0]},{n:'b',pos:[0,.5,0],rot:[0,0,0],parent:0,pv:[0,.9,0]},{n:'c',pos:[0,.1,0],rot:[0,0,0],parent:1,pv:[0,.3,0]}];
const id=fkPose(rest,{},{});ok(rest.every(p=>nr(id[p.n].pos,p.pos)&&nr(id[p.n].rot,[0,0,0])),'fk: без углов поза = покой');
const r1=fkPose(rest,{b:[-90,0,0]},{});ok(nr(r1.b.pos,[0,.9,.4],1e-3),'fk: нога вокруг сустава (вперёд-назад)');ok(nr(r1.c.pos,[0,.9,.8],.002),'fk: ребёнок едет с родителем');
const r2=fkPose(rest,{a:[0,90,0]},{});ok(nr(r2.a.pos,[0,1,0]),'fk: корень вращается вокруг своего центра');ok(Math.abs(r2.b.rot[1]-90)<.01,'fk: поворот родителя передаётся детям');
const r3=fkPose(rest,{},{a:[1,0,0]});ok(nr(r3.c.pos,[1,.1,0]),'fk: сдвиг корня несёт всех');
ok(roleOf('left_leg')==='leg'&&roleOf('Голова')==='head'&&roleOf('tail2')==='tail'&&roleOf('chest')==='body'&&roleOf('breast_L')==='breast'&&roleOf('xyz')===null&&roleOf('near')===null,'роли по именам');ok(sideOf('arm_L')==='L'&&sideOf('arm_R1')===null||sideOf('arm_R')==='R','сторона по имени');
const hp=[{n:'body',c:[0,1,0],s:[.4,.6,.25]},{n:'p1',c:[0,1.5,0],s:[.2,.25,.2]},{n:'p2',c:[.35,1.1,0],s:[.1,.5,.1]},{n:'p3',c:[-.35,1.1,0],s:[.1,.5,.1]},{n:'p4',c:[.12,.4,0],s:[.14,.7,.14]},{n:'p5',c:[-.12,.4,0],s:[.14,.7,.14]},{n:'p6',c:[0,.9,-.5],s:[.08,.08,.5]}];
const ra=rigAuto(hp),by=n=>ra.list.find(x=>x.n===n);ok(ra.root==='body'&&ra.list.length===7&&ra.list[0].n==='body','autorig: корень = самая большая часть');
ok(by('p1').role==='head'&&by('p2').role==='arm'&&by('p2').side==='L'&&by('p3').side==='R'&&by('p4').role==='leg'&&by('p6').role==='tail','autorig: роли по геометрии без имён');
ok(nr(by('p2').pv,[.35,1.35,0])&&nr(by('p4').pv,[.12,.75,0]),'autorig: плечо и бедро сверху');ok(ra.list.every((x,i)=>i===0?x.parent===null:ra.list.findIndex(q=>q.n===x.parent)<i),'autorig: родители раньше детей');
ok(nr(rigAuto(hp,{joints:{p2:[.3,1.2,0]}}).list.find(x=>x.n==='p2').pv,[.3,1.2,0]),'autorig: ручной сустав');
const toRig=L=>{const ix=new Map(L.map((x,i)=>[x.n,i]));return L.map(x=>({n:x.n,pos:x.pos,rot:x.rot||[0,0,0],parent:x.parent?ix.get(x.parent):-1,pv:x.pv,role:x.role,side:x.side,depth:x.depth}))};
const hu=toRig(humanParts({height:1.75}));ok(hu.length===16&&hu[0].parent===-1&&hu.filter(x=>x.parent<0).length===1,'человек: 16 частей, один корень');
const hk=gaitGen(hu,{clip:'walk'});ok(hk.length===9&&hk[0].t===0&&hk[8].t===1,'походка: 8 шагов цикла');
ok(Object.keys(hk[0].poses).every(n=>nr(hk[0].poses[n].pos,hk[8].poses[n].pos,.002)&&nr(hk[0].poses[n].rot,hk[8].poses[n].rot,.01)),'походка: цикл замкнут');
const foot=(k,n)=>hk[k].poses[n].pos[2];ok(Math.sign(foot(2,'foot_L')-hu.find(x=>x.n==='foot_L').pos[2])===-Math.sign(foot(2,'foot_R')-hu.find(x=>x.n==='foot_R').pos[2]),'походка: ноги в противофазе');
const ar=(k,n)=>hk[k].poses[n].pos[2]-hu.find(x=>x.n===n).pos[2];ok(Math.sign(ar(2,'hand_L'))===Math.sign(ar(2,'foot_R'))&&Math.abs(ar(2,'hand_L'))>.01,'походка: рука машет против ноги');
const ty=k=>hk[k].poses.pelvis.pos[1];ok(ty(0)>ty(2)&&Math.abs(ty(0)-ty(4))<1e-3,'походка: таз подпрыгивает дважды за цикл');
const sw=g=>Math.max(...g.map(k=>Math.abs(k.poses.foot_L.pos[2]-hu.find(x=>x.n==='foot_L').pos[2])));const rk=gaitGen(hu,{clip:'run'});ok(rk[8].t===.6&&sw(rk)>sw(hk),'бег быстрее и размашистее ходьбы');
const ik=gaitGen(hu,{clip:'idle'});ok(ik.length===13&&ik[12].t===3&&sw(ik)<.02,'idle: почти на месте');
ok(hk.every(k=>Object.values(k.poses).every(p=>p.pos.every(Number.isFinite)&&p.rot.every(Number.isFinite))),'походка: все числа');
const dg=toRig(animalParts('dog'));const dk=gaitGen(dg,{clip:'walk'});const dz=(k,n)=>dk[k].poses[n].pos[2]-dg.find(x=>x.n===n).pos[2];
ok(Math.sign(dz(2,'paw_FL'))===Math.sign(dz(2,'paw_HR'))&&Math.sign(dz(2,'paw_FL'))===-Math.sign(dz(2,'paw_FR')),'собака: диагональная походка');
ok(dk.some(k=>Math.abs(k.poses.tail3.rot[1])>1),'собака: виляет хвостом');
const X=springFollow([...Array(80)].map((_,i)=>[i<20?0:1,0,0]),1/30,200,10,0);ok(Math.max(...X.map(v=>v[0]))>1.1&&Math.abs(X[79][0]-1)<.02,'пружина: перелёт и успокоение');
{const an=[...Array(40)].map((_,i)=>[i<5?0:1,0,0]),xs=springFollow(an,1/30,200,10,.2);ok(xs.every((v,i)=>Math.abs(v[0]-an[i][0])<=.2+1e-9)&&xs.some((v,i)=>Math.abs(v[0]-an[i][0])>.19),'пружина: предел смещения');}
const kk=[{t:0,poses:{P:{pos:[0,1,0],rot:[0,0,0]}}},{t:.5,poses:{P:{pos:[.3,1,0],rot:[0,0,0]}}},{t:1,poses:{P:{pos:[0,1,0],rot:[0,0,0]}}}];
const sg=secondaryGen(kk,true,{n:'S',pos:[0,1.1,.1],rot:[0,0,0],parent:'P'},{pos:[0,1,0],rot:[0,0,0]},{fps:24,size:.1,maxd:.05});
ok(sg.length===25&&Math.abs(sg[0].pos[0]-sg[24].pos[0])<.002,'вторичное: цикл замкнут');
{const kw=[{t:0,poses:{P:{pos:[0,0,0],rot:[0,0,0],w:{a:0}}}},{t:1,poses:{P:{pos:[0,0,0],rot:[0,0,0],w:{a:1}}}}];ok(Math.abs(interpPose(kw,false,'P',.25).w.a-.25)<1e-9&&interpPose(kk,true,'P',.5).w===undefined,'interpPose: веса форм интерполируются');}
const dev=sg.map(r=>{const a=interpPose(kk,true,'P',Math.min(r.t,.9999));return Math.abs(r.pos[0]-a.pos[0])});ok(Math.max(...dev)>.003&&Math.max(...dev)<=.0501,'вторичное: отставание в пределах maxd');
const kc=[{t:0,poses:{P:{pos:[0,1,0],rot:[0,0,0]}}},{t:1,poses:{P:{pos:[0,1,0],rot:[0,0,0]}}}];const sc2=secondaryGen(kc,true,{n:'S',pos:[0,1.1,.1],rot:[0,0,0],parent:'P'},{pos:[0,1,0],rot:[0,0,0]},{});ok(sc2.every(r=>nr(r.pos,[0,1.1,.1],1e-3)),'вторичное: без движения нет дрожи');}
// шерсть, лицо, ландшафт, рассеивание, существа
{const toRig=L=>{const ix=new Map(L.map((x,i)=>[x.n,i]));return L.map(x=>({n:x.n,pos:x.pos,rot:x.rot||[0,0,0],parent:x.parent?ix.get(x.parent):-1,pv:x.pv,role:x.role,side:x.side,depth:x.depth}))},nr=(a,b,e)=>a.every((v,i)=>Math.abs(v-b[i])<(e||1e-3)),sph=(()=>{const v=[],f=[],A=40,B=28;for(let j=0;j<=B;j++)for(let i=0;i<A;i++){const th=j/B*Math.PI,ph=i/A*Math.PI*2;v.push(Math.sin(th)*Math.cos(ph)*.1,Math.cos(th)*.12,Math.sin(th)*Math.sin(ph)*.11)}for(let j=0;j<B;j++)for(let i=0;i<A;i++){const a=j*A+i,b=j*A+(i+1)%A,c=a+A,d=b+A;f.push(a,c,b,b,c,d)}return{v,f}})();
const ft=furGen(sph,{length:.02,density:8000,seed:2});const area=meshArea(sph);ok(Math.abs(ft.strands-Math.round(area*8000))<2,'шерсть: число прядей = площадь × плотность');
ok(ft.v.every(Number.isFinite)&&Math.max(...ft.f)<ft.v.length/3&&ft.c.length===ft.v.length,'шерсть: числа, индексы, цвета');
const rr=i=>Math.hypot(ft.v[i*3]/.1,ft.v[i*3+1]/.12,ft.v[i*3+2]/.11);let mr=0;for(let i=0;i<ft.v.length/3;i++)mr=Math.max(mr,rr(i));ok(mr>1.05&&mr<1.5,'шерсть торчит наружу и не улетает ('+mr.toFixed(2)+')');
ok(JSON.stringify(furGen(sph,{length:.02,density:8000,seed:2}).v)===JSON.stringify(ft.v)&&JSON.stringify(furGen(sph,{length:.02,density:8000,seed:3}).v)!==JSON.stringify(ft.v),'шерсть: seed');
const fr=furGen(sph,{length:.02,count:500,region:{y:[0,.2]}});let yo=true;for(let i=0;i<fr.v.length/3;i+=1)if(fr.v[i*3+1]<-.03)yo=false;ok(yo&&fr.strands>100,'шерсть: только в области region');
const tb=furGen(sph,{length:.02,count:1500,pattern:'tabby',color:'#ffffff',color2:'#000000',rootDark:1,seed:1});const lum=[];for(let i=0;i<tb.c.length;i+=3)lum.push(tb.c[i]);ok(Math.min(...lum)<.2&&Math.max(...lum)>.8,'шерсть: узор табби даёт два тона');
const so=furGen(sph,{length:.02,count:500,color:'#ffffff',color2:'#000000',rootDark:1,pattern:'belly',seed:1});let top=0,bot=0,nt=0,nb=0;for(let i=0;i<so.v.length/3;i++){const y=so.v[i*3+1];if(y>.06){top+=so.c[i*3];nt++}else if(y<-.06){bot+=so.c[i*3];nb++}}ok(nb&&nt&&bot/nb<top/nt,'шерсть: узор belly (низ светлее/темнее по color2)');
const zs=furGen(sph,{length:.04,count:600,zones:[{y:[0,1],k:.25}],seed:1});const zn=furGen(sph,{length:.04,count:600,seed:1});const ext=(M,up)=>{let m=0;for(let i=0;i<M.v.length/3;i++)if((M.v[i*3+1]>.03)===up)m=Math.max(m,Math.hypot(M.v[i*3]/.1,M.v[i*3+1]/.12,M.v[i*3+2]/.11));return m};ok(ext(zs,true)<ext(zn,true)-.05&&Math.abs(ext(zs,false)-ext(zn,false))<.05,'шерсть: зоны укорачивают только свою область');
const wp=warpMesh(sph,[{at:[0,.12,0],by:[0,.05,0],r:.06}],false);let mv=0,out=0;for(let i=0;i<wp.length;i+=3){const d=Math.hypot(wp[i]-sph.v[i],wp[i+1]-sph.v[i+1],wp[i+2]-sph.v[i+2]);if(d>1e-9){mv++;if(Math.hypot(sph.v[i],sph.v[i+1]-.12,sph.v[i+2])>.06)out++}if(d>.05+1e-9)out+=100}ok(mv>10&&out===0,'пин двигает только внутри радиуса и не дальше by');
const ws=warpMesh(sph,[{at:[.1,0,0],by:[.02,0,0],r:.05}],true);let lm=0,rm=0;for(let i=0;i<ws.length;i+=3){if(Math.abs(ws[i]-sph.v[i])>1e-9){if(sph.v[i]>0)lm++;else rm++}}ok(lm>0&&Math.abs(lm-rm)<=2,'warp sym зеркалит по X');
const wk=warpMesh(sph,[{at:[0,0,.11],scale:1.5,r:.08}],false);let g1=0;for(let i=0;i<wk.length;i+=3){const d0=Math.hypot(sph.v[i],sph.v[i+1],sph.v[i+2]-.11),d1=Math.hypot(wk[i],wk[i+1],wk[i+2]-.11);if(d0<.07&&d0>1e-6&&d1>d0)g1++}ok(g1>5,'пин scale раздувает');
const LM=faceLM(sph);ok(Math.abs(LM.hw-.1)<1e-6&&Math.abs(LM.hh-.12)<1e-6&&LM.P(0,0)[2]>.1,'лицо: ориентиры по габаритам');
ok(faceKeys().length===15&&faceKeys().every(k=>{const p=facePins(k,LM);return p&&p.length&&p.every(q=>q.r>0)}),'лицо: у всех 15 форм есть пины');ok(facePins('zzz',LM)===null,'лицо: неизвестная форма null');
const jo=warpMesh(sph,facePins('jaw_open',LM),false);let dn=0;for(let i=1;i<jo.length;i+=3)if(jo[i]<sph.v[i]-1e-6)dn++;ok(dn>20,'jaw_open опускает нижнюю часть');
const sm=warpMesh(sph,facePins('smile',LM),false);let up=0;for(let i=0;i<sm.length;i+=3)if(sm[i+1]>sph.v[i+1]+1e-6&&sph.v[i+2]>0)up++;ok(up>10,'smile поднимает уголки');
const dgp=faceVarPins(facePreset('dog'),LM);const dgv=warpMesh(sph,dgp,false);let zf=0;for(let i=0;i<dgv.length;i+=3)zf=Math.max(zf,dgv[i+2]-sph.v[i+2]);ok(zf>.01,'пёс: морда вытягивается вперёд');
ok(['child','elf','orc','cat','dog','alien','human'].every(n=>facePreset(n)!==null)&&facePreset('x')===null,'пресеты лиц');
const t1=terrainGen({size:[40,40],res:40,amp:5,seed:3}),t2=terrainGen({size:[40,40],res:40,amp:5,seed:3});ok(JSON.stringify(t1.v)===JSON.stringify(t2.v),'ландшафт: детерминирован');ok(t1.v.length/3===41*41&&t1.f.length/3===40*40*2&&t1.c.length===t1.v.length,'ландшафт: сетка и цвета');
const hh=t1.hf.h,hmax=Math.max(...hh),hmin=Math.min(...hh);ok(hmax-hmin>1&&hmax<7&&hmin>-3,'ландшафт: перепад высот по amp ('+hmin.toFixed(1)+'..'+hmax.toFixed(1)+')');
ok(Math.abs(terrainHeight(t1.hf,t1.v[3*100],0)-0)>=0&&nr([terrainHeight(t1.hf,t1.v[3*500],t1.v[3*500+2])],[t1.v[3*500+1]],.01),'terrainHeight совпадает с вершиной');
const isl=terrainGen({size:[40,40],res:32,amp:5,seed:2,island:true}),c0=isl.hf.h[16*33+16],e0=isl.hf.h[0];ok(c0>e0+.5,'остров: края ниже центра');
const fl=terrainGen({size:[40,40],res:40,amp:5,seed:2,flat:[{c:[0,0],r:4,h:1.5}]});ok(Math.abs(terrainHeight(fl.hf,0,0)-1.5)<.01&&Math.abs(terrainHeight(fl.hf,2,2)-1.5)<.05,'площадка под дом ровная');
const er=terrainGen({size:[40,40],res:40,amp:6,seed:2,erode:12,ridge:true}),nr0=terrainGen({size:[40,40],res:40,amp:6,seed:2,ridge:true});const mxs=T=>{let m=0;for(let x=-15;x<15;x+=1)for(let z=-15;z<15;z+=1)m=Math.max(m,terrainSlope(T.hf,x,z));return m};ok(mxs(er)<mxs(nr0),'эрозия сглаживает обрывы');
const ca=terrainGen({size:[40,40],res:40,amp:8,seed:2,sea:1});ok(ca.c.every(x=>x>=0&&x<=1),'цвета ландшафта в 0..1');
const hm=terrainGen({size:[20,20],res:16,amp:3,map:{w:2,h:2,data:[0,1,1,0]}});ok(Math.abs(hm.hf.h[0])<1e-6&&Math.abs(hm.hf.h[16]-3)<1e-6&&Math.abs(hm.hf.h[16*17])-3<1e-6,'карта высот: яркость = высота');
const sp=scatterPts(t1.hf,{count:60,minDist:3,maxSlope:.5,minH:0,seed:1},rng(5));ok(sp.length>10&&sp.every(p=>p.p[1]>=-1e-6&&terrainSlope(t1.hf,p.p[0],p.p[2])<=.5+1e-9),'scatter: высота и уклон');
let md=1e9;for(let i=0;i<sp.length;i++)for(let j=i+1;j<sp.length;j++)md=Math.min(md,Math.hypot(sp[i].p[0]-sp[j].p[0],sp[i].p[2]-sp[j].p[2]));ok(md>=3-1e-9,'scatter: minDist соблюдён');
const av=scatterPts(t1.hf,{count:80,avoid:[{min:[-10,-10],max:[10,10]}],maxSlope:9,seed:2},rng(1));ok(av.length>20&&av.every(p=>Math.abs(p.p[0])>=10||Math.abs(p.p[2])>=10),'scatter: обход зоны avoid');
const mg=scatterMerge({v:[0,0,0,1,0,0,0,1,0],f:[0,1,2]},sp.slice(0,5),{color:'#ff0000'});ok(mg.f.length===15&&mg.v.length===45&&mg.c.length===45&&Math.max(...mg.f)<15,'scatterMerge: копии в одном меше');
const b1=bumpGen('skin',64,1),b2=bumpGen('stone',64,1);ok(b1.length===4096&&JSON.stringify(Array.from(b1))===JSON.stringify(Array.from(bumpGen('skin',64,1)))&&JSON.stringify(Array.from(b1))!==JSON.stringify(Array.from(b2)),'bump: детерминирован, виды различаются');
ok(['skin','stone','fabric','bark','leather','noise'].every(k=>{const b=bumpGen(k,32,2);return Math.max(...b)-Math.min(...b)>40}),'bump: контраст у всех видов');
const bbH=P=>{let lo=1e9,hi=-1e9;P.forEach(p=>{const s=p.type==='ellipsoid'?p.size[1]:0,t=p.type==='tube'?p.size:null;if(t)t.forEach(q=>{lo=Math.min(lo,p.pos[1]+q[1]-q[3]);hi=Math.max(hi,p.pos[1]+q[1]+q[3])});else{lo=Math.min(lo,p.pos[1]-s);hi=Math.max(hi,p.pos[1]+s)}});return[lo,hi]};
const hb=bbH(humanParts({height:1.75}));ok(Math.abs(hb[1]-1.77)<.04&&hb[0]>-.05&&hb[0]<.02,'человек: рост 1.75 и стоит на земле');const hb2=bbH(humanParts({height:2.1}));ok(Math.abs(hb2[1]-1.77*1.2)<.06,'человек: масштаб по height');
ok(humanParts({bust:.5}).filter(p=>p.role==='breast').length===2&&humanParts({}).filter(p=>p.role==='breast').length===0,'человек: bust по запросу');
ok(humanParts({sex:'f'}).find(p=>p.n==='pelvis').size[0]>humanParts({sex:'m'}).find(p=>p.n==='pelvis').size[0],'человек: пол меняет пропорции');
['dog','cat','horse'].forEach(k=>{const P=animalParts(k),names=new Set(P.map(p=>p.n));ok(P.length===23&&P.every(p=>!p.parent||names.has(p.parent))&&P.filter(p=>!p.parent).length===1,k+': родители на месте, один корень');const b=bbH(P);ok(b[0]>-.02&&b[0]<.03,k+': лапы на земле');
const L=toRig(P);const g=gaitGen(L,{clip:'walk'});ok(g.every(kf=>Object.values(kf.poses).every(p=>p.pos.every(Number.isFinite))),k+': походка без NaN')});
ok(bbH(animalParts('horse'))[1]>bbH(animalParts('dog'))[1]*2&&bbH(animalParts('dog',{scale:2}))[1]>bbH(animalParts('dog'))[1]*1.7,'животные: масштаб и вид');
let th2=false;try{animalParts('unicorn')}catch(e){th2=true}ok(th2,'неизвестное животное: ошибка');}
// рисование, аниме-лица, пупеты, аксессуары, антропоморфы
{const nr=(a,b,e)=>a.every((v,i)=>Math.abs(v-b[i])<(e||1e-3)),at=(px,W,x,y)=>Array.from(px.slice((y*W+x)*4,(y*W+x)*4+4));
const c1=rasterArt(64,64,[{t:'ell',c:[.5,.5],r:[.25,.25],fill:'#ff0000'}]);ok(nr(at(c1,64,32,32),[255,0,0,255],1)&&at(c1,64,2,2)[3]===0,'растр: эллипс, прозрачный фон');
let edge=0;for(let x=44;x<52;x++){const a=at(c1,64,x,32)[3];if(a>5&&a<250)edge++}ok(edge>=1,'растр: сглаженный край');
const ar=a=>{let n=0;for(let i=3;i<a.length;i+=4)n+=a[i]/255;return n};ok(Math.abs(ar(c1)-Math.PI*16*16)<25,'растр: площадь круга ('+ar(c1).toFixed(0)+')');
const g1=rasterArt(64,64,[{t:'poly',p:[[0,0],[1,0],[1,1],[0,1]],fill:{g:'lin',a:[0,0],b:[1,0],stops:[[0,'#000000'],[1,'#ffffff']]}}]);ok(at(g1,64,2,30)[0]<12&&at(g1,64,61,30)[0]>240&&Math.abs(at(g1,64,32,30)[0]-128)<12,'растр: линейный градиент');
const g2=rasterArt(64,64,[{t:'ell',c:[.5,.5],r:[.5,.5],fill:{g:'rad',c:[.5,.5],r:[.5,.5],stops:[[0,'#ffffff',1],[1,'#ffffff',0]]}}]);ok(at(g2,64,32,32)[3]>240&&at(g2,64,50,32)[3]<150&&at(g2,64,50,32)[3]>20,'растр: радиальный градиент с прозрачностью');
const cl=rasterArt(64,64,[{t:'ell',c:[.5,.5],r:[.4,.4],clip:[[0,0],[.5,0],[.5,1],[0,1]],fill:'#00ff00'}]);ok(at(cl,64,20,32)[3]>240&&at(cl,64,44,32)[3]===0,'растр: обрезка clip');
const er=rasterArt(64,64,[{t:'poly',p:[[0,0],[1,0],[1,1],[0,1]],fill:'#0000ff'},{t:'ell',c:[.5,.5],r:[.2,.2],erase:true}]);ok(at(er,64,32,32)[3]===0&&at(er,64,4,4)[3]===255,'растр: стирание');
const ln=rasterArt(64,64,[{t:'line',p:[[.1,.5],[.9,.5]],sw:.1,col:'#ffffff'}]);ok(at(ln,64,32,32)[3]>240&&at(ln,64,32,10)[3]===0,'растр: линия с шириной');
const lt=rasterArt(64,64,[{t:'line',p:[[.1,.5],[.9,.5]],sw:.12,sw2:.02,col:'#ffffff'}]);ok(at(lt,64,12,29)[3]>at(lt,64,56,29)[3],'растр: сужение линии');
const vw=rasterArt(32,32,[{t:'ell',c:[.75,.75],r:[.1,.1],fill:'#ffffff'}],[.5,.5,1,1]);ok(at(vw,32,16,16)[3]>240&&at(vw,32,2,2)[3]===0,'растр: область view');
const A=animeArt({});ok(A.layers.length===14&&['hairBack','body','face','eyeL_white','eyeL_iris','eyeL_lash','eyeR_white','browL','mouth','decor','hairFront'].every(n=>A.layers.some(l=>l.n===n)),'аниме-арт: 14 слоёв');
ok(A.layers.every(l=>l.crop[0]>=0&&l.crop[1]>=0&&l.crop[2]<=1.0001&&l.crop[3]<=1.0001&&l.crop[2]>l.crop[0]&&l.shapes.length>0&&l.px>=64),'аниме-арт: области слоёв корректны');
ok(A.lm.eyeL[0]>.5&&A.lm.eyeR[0]<.5&&Math.abs(A.lm.eyeL[0]+A.lm.eyeR[0]-1)<1e-9,'аниме-арт: L справа на картинке, R слева');
const iris=A.layers.find(l=>l.n==='eyeL_iris'),ip=rasterArt(128,102,iris.shapes,iris.crop);let on=0;for(let i=3;i<ip.length;i+=4)if(ip[i]>10)on++;ok(on>500,'аниме-арт: радужка рисуется');
const ew=A.layers.find(l=>l.n==='eyeL_white'),wp=rasterArt(128,102,ew.shapes,ew.crop),ip2=rasterArt(128,102,iris.shapes,iris.crop);let out=0;for(let i=3;i<ip2.length;i+=4)if(ip2[i]>40&&wp[i]<10)out++;ok(out<30,'аниме-арт: радужка обрезана по глазу ('+out+')');
const A2=animeArt({hair:'#ff66aa',eye:'#22aa44',hairStyle:'twin',bangs:'parted',skin:'#c89070'});ok(A2.layers.find(l=>l.n==='hairBack').shapes.length===3&&JSON.stringify(A2.layers[0])!==JSON.stringify(A.layers[0]),'аниме-арт: стили волос и цвета');
const ts=eyeTexShapes({style:'anime',eye:'#3aa0d8'}),tx=rasterArt(128,64,ts,[0,0,1,1]);ok(at(tx,128,41,32)[2]>100&&at(tx,128,32,32)[0]<40&&at(tx,128,100,32)[0]>200&&at(tx,128,100,32)[3]===255,'текстура глаза: радужка в u=.25, белок вокруг');
const fc=faceCtl({clip:'idle',duration:4,seed:2});ok(fc.length===61&&Math.max(...fc.map(f=>f.c.blinkL))>.95,'faceCtl: моргание доходит до 1');
ok(['blinkL','open','mouthO','lookX','lookY','yaw','pitch','roll'].every(k=>Math.abs(fc[0].c[k]-fc[60].c[k])<1e-9),'faceCtl: цикл замкнут');
ok(fc.every(f=>Object.values(f.c).every(Number.isFinite))&&Math.abs(fc.reduce((m,f)=>Math.max(m,Math.abs(f.c.lookX)),0))<=.71,'faceCtl: числа и взгляд в пределах');
const tk=faceCtl({clip:'talk',duration:3,seed:3});ok(Math.max(...tk.map(f=>f.c.open))>.6&&Math.min(...tk.map(f=>f.c.open))===0&&tk.filter(f=>f.c.open>.1).length>8,'faceCtl: речь открывает рот слогами');
ok(faceCtl({clip:'happy'})[10].c.smile>.5&&faceCtl({clip:'angry'})[10].c.angry>.5&&faceCtl({clip:'surprised'})[10].c.wide===1&&faceCtl({clip:'sad'})[10].c.sad>.5&&faceCtl({clip:'sleepy'})[10].c.blinkL>.3,'faceCtl: настроения');
ok(JSON.stringify(faceCtl({seed:5}))===JSON.stringify(faceCtl({seed:5}))&&JSON.stringify(faceCtl({seed:5}))!==JSON.stringify(faceCtl({seed:6})),'faceCtl: seed');
const eyeL=A.layers.find(l=>l.n==='eyeL_white'),pb=puppetBuild(eyeL,.6,.6);ok(pb.role==='eye'&&pb.v.length/3===99&&Object.keys(pb.sk).join()==='blink,wide,narrow'&&pb.uv.length===198,'пупет: глаз, 3 формы');
const hOf=a=>{let lo=1e9,hi=-1e9;for(let i=1;i<a.length;i+=3){lo=Math.min(lo,a[i]);hi=Math.max(hi,a[i])}return hi-lo};
ok(hOf(pb.v.map((x,i)=>x+pb.sk.blink[i]))<hOf(pb.v)*.4&&hOf(pb.v.map((x,i)=>x+pb.sk.wide[i]))>hOf(pb.v)*1.05,'пупет: моргание сжимает глаз, wide раскрывает');
const pm=puppetBuild(A.layers.find(l=>l.n==='mouth'),.6,.6);ok(hOf(pm.v)<.012&&hOf(pm.v.map((x,i)=>x+pm.sk.open[i]))>.045,'пупет: рот закрыт в покое, open раскрывает');
const sm=pm.v.map((x,i)=>x+pm.sk.smile[i]);let up=0;for(let i=0;i<pm.v.length;i+=3)if(Math.abs(pm.v[i])>.015&&sm[i+1]>pm.v[i+1]+1e-4)up++;ok(up>2,'пупет: улыбка поднимает уголки');
ok(Object.keys(puppetBuild(A.layers.find(l=>l.n==='browL'),.6,.6).sk).join()==='up,down,angry,sad'&&puppetBuild(A.layers.find(l=>l.n==='face'),.6,.6).sk===undefined,'пупет: формы бровей, лицо без форм');
const dm=drapeMesh({v:[0,0,0,.05,0,0,0,.05,0],f:[0,1,2],uv:[0,0,1,0,0,1],sk:{k:[0,0,0,0,.01,0,0,0,0]}},[0,0],[.085,.105,.09],.001);ok(Math.abs(dm.v[2]-.091)<1e-3&&dm.v[5]<dm.v[2]&&dm.sk.k[5]!==0,'накладка огибает эллипсоид');
const ls=lidShell(.025,38,92,70,'#ffe3d2','#331510',true);ok(ls.v.length===ls.c.length&&Array.from({length:ls.v.length/3},(_,i)=>Math.hypot(ls.v[i*3],ls.v[i*3+1],ls.v[i*3+2])).every(r=>Math.abs(r-.025)<1e-4)&&Math.min(...ls.c)<.3,'веко: на сфере, тёмный край');
const F3=face3dParts({c:[0,1.65,0],r:[.085,.105,.09],style:'anime'});ok(F3.parts.length===6&&F3.parts.every(p=>p.pos.every(Number.isFinite)&&p.parent==='head')&&F3.parts.filter(p=>p.fc==='eye').length===2,'3D-лицо: глаза и веки');
ok(F3.parts.find(p=>p.n==='eye_L').pos[0]>0&&F3.parts.find(p=>p.n==='eye_R').pos[0]<0&&F3.re>.02,'3D-лицо: L = +X, глаза крупные у аниме');ok(face3dParts({c:[0,1.65,0],r:[.085,.105,.09],style:'real'}).re<F3.re,'3D-лицо: у реалистичного глаза меньше');
const hp=faceHeadPins(.085,.105,.09,'anime',.004,.023);ok(hp.length>=5&&hp.every(q=>q.r>0),'лицо: пины глазниц, подбородка, носа');
const rigF=[{n:'head',pos:[0,1.65,0],rot:[0,0,0],parent:-1,pv:[0,1.5,0],fc:'root',side:'C'},{n:'eyeL',pos:[.03,1.66,.05],rot:[0,0,0],parent:0,pv:[.03,1.66,.05],fc:'eye',side:'L'},{n:'lidL',pos:[.03,1.66,.05],rot:[0,0,0],parent:0,pv:[.03,1.66,.05],fc:'lidU',side:'L'},{n:'lidR',pos:[-.03,1.66,.05],rot:[0,0,0],parent:0,pv:[-.03,1.66,.05],fc:'lidU',side:'R'},{n:'mouth',pos:[0,1.6,.08],rot:[0,0,0],parent:0,pv:[0,1.5,0],fc:'mouth',side:'C'},{n:'iris',pos:[0,1.7,.1],rot:[0,0,0],parent:0,pv:[0,1.5,0],fc:'iris',side:'L',dx:.01,dy:.006}];
const ks=faceAnimKeys(rigF,[{t:0,c:{blinkL:1,blinkR:0,open:.8,smile:.5,mouthO:0,browL:0,browR:0,angry:0,sad:0,wide:0,narrow:0,lookX:1,lookY:0,yaw:10,pitch:0,roll:0}}]);const p0=ks[0].poses;
ok(p0.lidL.rot[0]>40&&Math.abs(p0.lidR.rot[0])<6,'faceAnimKeys: левое веко закрыто, правое открыто');ok(Math.abs(p0.eyeL.rot[1])>5,'faceAnimKeys: глаз смотрит в сторону');ok(p0.mouth.w.open===.8&&p0.mouth.w.smile===.5&&p0.mouth.w.frown===0,'faceAnimKeys: веса рта');ok(Math.abs(p0.iris.pos[0]-(0+.01))<.02&&Math.abs(p0.head.rot[1]-10)<.1,'faceAnimKeys: радужка сдвигается, голова поворачивается');
const ak=a=>a.length;
[['ears','cat'],['ears','fox'],['ears','wolf'],['ears','rabbit'],['ears','dog'],['ears','elf'],['ears','bear'],['ears','mouse'],['horns','small'],['horns','curved'],['horns','ram'],['horns','antlers'],['horns','demon'],['tail','fox'],['tail','cat'],['tail','wolf'],['tail','lizard'],['tail','dragon'],['tail','puff'],['wings','bird'],['wings','bat'],['wings','dragon'],['wings','angel']].forEach(([k,st])=>{const P=addonParts(k,st,{c:[0,1.65,0],s:[.17,.21,.18],k:1,parent:'head'});ok(P.length>0&&P.every(p=>p.pos.every(Number.isFinite)&&(p.type!=='mesh'||(p.size.v.every(Number.isFinite)&&Math.max(...p.size.f)<p.size.v.length/3))),'аксессуар '+k+' '+st)});
let bad=0;try{addonParts('ears','xx',{c:[0,0,0],s:[1,1,1]})}catch(e){bad++}try{addonParts('wings','xx',{c:[0,0,0],s:[1,1,1]})}catch(e){bad++}try{addonParts('tail','xx',{c:[0,0,0],s:[1,1,1]})}catch(e){bad++}try{addonParts('horns','xx',{c:[0,0,0],s:[1,1,1]})}catch(e){bad++}ok(bad===4,'аксессуары: неизвестный стиль даёт ошибку');
const wl=addonParts('wings','bat',{c:[0,1.3,0],s:[.34,.5,.2],k:1,parent:'torso'});ok(wl.filter(p=>p.role==='wing').length===6&&wl.find(p=>p.n==='wing_L1').pos[0]>0&&wl.find(p=>p.n==='wing_R1').pos[0]<0,'крылья: две стороны по три части');
const tr=toRig2=>0;const toRigA=L=>{const ix=new Map(L.map((x,i)=>[x.n,i]));return L.map(x=>({n:x.n,pos:x.pos,rot:x.rot||[0,0,0],parent:x.parent?ix.get(x.parent):-1,pv:x.pv,role:x.role,side:x.side,depth:x.depth,fc:x.fc}))};
['fox','wolf','cat','dog','rabbit','bear'].forEach(sp=>{const P=anthroParts(sp,{}),nm=new Set(P.map(p=>p.n));ok(P.length>=26&&P.every(p=>!p.parent||nm.has(p.parent))&&P.filter(p=>!p.parent).length===1&&['snout','nose','jaw','ear_L','ear_R','tail1'].every(n=>nm.has(n)),'антропоморф '+sp+': части, один корень');
 const g=gaitGen(toRigA(P),{clip:'walk'});ok(g.every(k=>Object.values(k.poses).every(q=>q.pos.every(Number.isFinite)&&q.rot.every(Number.isFinite))),'антропоморф '+sp+': походка без NaN')});
const fx=anthroParts('fox',{});ok(fx.some(p=>p.n==='leg_L3')&&fx.find(p=>p.n==='foot_L').parent==='leg_L3'&&anthroParts('fox',{digitigrade:false}).every(p=>p.n!=='leg_L3'),'антропоморф: птичья посадка ног (3 сегмента)');
ok(fx.find(p=>p.n==='jaw').fc==='jaw','антропоморф: челюсть управляется faceanim');
let hy=0;fx.filter(p=>p.n.startsWith('leg_L')).forEach(p=>{if(p.type==='tube')p.size.forEach(q=>{hy=Math.min(hy,p.pos[1]+q[1])})});ok(hy>-.02,'антропоморф: ноги не уходят под землю');
const ce=centaurParts({}),cn=new Set(ce.map(p=>p.n));ok(ce.every(p=>!p.parent||cn.has(p.parent))&&ce.filter(p=>!p.parent).length===1&&cn.has('torso')&&cn.has('arm_L1')&&cn.has('leg_FL1')&&!cn.has('neck')||cn.has('neck'),'кентавр: человек на лошади, один корень');
const cg=gaitGen(toRigA(ce),{clip:'walk'}),cz=(k,n)=>cg[k].poses[n].pos[2]-ce.find(x=>x.n===n).pos[2];ok(cg.every(k=>Object.values(k.poses).every(q=>q.pos.every(Number.isFinite)))&&Math.sign(cz(2,'paw_FL'))===-Math.sign(cz(2,'paw_FR')),'кентавр: ходит как четвероногий');
const dr=animalParts('dragon',{}),dn=new Set(dr.map(p=>p.n));ok(dr.length===24&&dn.has('tail6')&&!dn.has('ear_L')&&dr.every(p=>!p.parent||dn.has(p.parent)),'дракон: шесть сегментов хвоста, без ушей');
}
{const ks=[{t:0,poses:{m:{pos:[0,0,0],rot:[0,0,0],w:{open:0,smile:1}}}},{t:1,poses:{m:{pos:[0,0,0],rot:[0,0,0],w:{open:.5}}}}],d=morphTrackData(ks,'m',['open','smile','o']);ok(d.times.length===2&&d.values.length===6&&d.values[0]===0&&d.values[1]===1&&d.values[3]===.5&&d.values[4]===0&&d.any,'morph-дорожка: порядок целей и нули');ok(!morphTrackData([{t:0,poses:{m:{pos:[0,0,0],rot:[0,0,0]}}}],'m',['a']).any,'morph-дорожка: без весов не создаётся');}
{const nr=(a,b,e)=>a.every((v,i)=>Math.abs(v-b[i])<(e||1e-3)),tn=faceCtl({clip:'turn',duration:4,seed:1});ok(Math.max(...tn.map(f=>Math.abs(f.c.yaw)))>34&&Math.abs(Math.max(...tn.map(f=>f.c.turn))-1)<.05&&Math.abs(tn[0].c.turn-tn[60].c.turn)<1e-9,'faceCtl: clip turn поворачивает до ±35° и замкнут');
const rg=[{n:'face',pos:[0,1,0],rot:[0,0,0],parent:-1,pv:[0,.8,0],fc:'root',side:'C'},{n:'mouth',pos:[0,.9,.01],rot:[0,0,0],parent:0,pv:[0,.8,0],fc:'mouth',side:'C',tz:.05},{n:'back',pos:[0,1,-.01],rot:[0,0,0],parent:0,pv:[0,.8,0],fc:'hair',side:'C',tz:-.02},{n:'iris',pos:[0,1,.02],rot:[0,0,0],parent:0,pv:[0,.8,0],fc:'iris',side:'L',tz:.05,dx:.01,dy:.006}],cc={blinkL:0,blinkR:0,open:0,smile:0,mouthO:0,browL:0,browR:0,angry:0,sad:0,wide:0,narrow:0,lookX:1,lookY:0,yaw:0,pitch:0,roll:0,turn:1},kt=faceAnimKeys(rg,[{t:0,c:cc}])[0].poses;
ok(Math.abs(kt.mouth.pos[0]-.05)<1e-3&&Math.abs(kt.back.pos[0]+.02)<1e-3,'turn: черты едут вперёд, задние волосы назад');ok(Math.abs(kt.iris.pos[0]-(.05+.01))<1e-3,'turn: радужка складывает сдвиг поворота и взгляда');
const FR=face3dParts({c:[0,1.65,0],r:[.085,.105,.09],style:'real'}),nm=new Set(FR.parts.map(p=>p.n));ok(['nose_bridge','nose_tip','nostril_L','nostril_R','ear_L','ear_R','lip_up','lip_low'].every(n=>nm.has(n))&&FR.parts.every(p=>p.pos.every(Number.isFinite)),'реалистичное лицо: 3D нос, ноздри, уши, губы');
ok(FR.parts.find(p=>p.n==='lip_low').fc==='jaw'&&FR.parts.find(p=>p.n==='lip_up').fc===undefined&&!face3dParts({c:[0,1.65,0],r:[.085,.105,.09],style:'anime'}).parts.some(p=>p.n==='nose_tip'),'реалистичное лицо: нижняя губа следует за челюстью, у аниме 3D-носа нет');
const nt=FR.parts.find(p=>p.n==='nose_tip'),hd=FR.parts.find(p=>p.n==='eye_L');ok(nt.pos[2]>.07&&Math.abs(nt.pos[0])<1e-9&&nt.pos[1]<hd.pos[1],'реалистичное лицо: нос на поверхности лица ниже глаз');
const rl=FR.parts.map(p=>({...p,rot:[0,0,0],parent:p.parent?0:-1})),root={n:'head',pos:[0,1.65,0],rot:[0,0,0],parent:-1,pv:[0,1.5,0],fc:'root',side:'C'},lp=FR.parts.find(p=>p.n==='lip_low'),kj=faceAnimKeys([root,{n:'lip_low',pos:lp.pos,rot:[0,0,0],parent:0,pv:lp.pv,fc:'jaw',side:'C'}],[{t:0,c:{...cc,open:1,turn:0,lookX:0}}])[0].poses;ok(kj.lip_low.rot[0]>15&&kj.lip_low.pos[1]<lp.pos[1],'реалистичное лицо: нижняя губа опускается при открытом рте');}
{const mkb=(mn,mx,tip)=>({name:'b',tip,r:0,min:mn.slice(),max:mx.slice(),vel:[0,0,0]}),S0=[{name:'t',min:[-1,0,-1],max:[1,1,1]}];
let rr=simAABB([mkb([.8,1.001,-.5],[1.8,3.001,.5],true)],S0,{time:3});const Bq=rr.rot[0];ok(Math.abs(Bq[2]+Math.SQRT1_2)<1e-6&&Math.abs(Bq[3]-Math.SQRT1_2)<1e-6,'ящик с выносом центра опрокидывается на 90° (кватернион вокруг Z)');
const bx=[.8,1.001,-.5],by=[1.8,3.001,.5];rr=simAABB([mkb(bx,by,true)],S0,{time:3});ok(rr.off[0][0]>.5&&rr.off[0][1]<-.99,'опрокинутый ящик сместился наружу и вниз');
let B1=mkb(bx,by,true);simAABB([B1],S0,{time:3});ok(Math.abs((B1.max[0]-B1.min[0])-2)<1e-6&&Math.abs((B1.max[1]-B1.min[1])-1)<1e-6&&B1.min[0]>=1-1e-6&&Math.abs(B1.min[1])<1e-3&&B1.tips===1,'после опрокидывания ширина и высота поменялись, ящик лежит у основания');
let B2=mkb([-.5,1.001,-.5],[.5,2.001,.5],true);rr=simAABB([B2],S0,{time:2});ok(!B2.tips&&rr.rot[0][3]===1,'ящик по центру опоры стоит');
B2=mkb(bx,by,false);rr=simAABB([B2],S0,{time:2});ok(!B2.tips&&rr.rot[0][3]===1,'без флага tip ящик не вращается');
const Bz=mkb([-.5,1.001,.8],[.5,3.001,1.8],true);rr=simAABB([Bz],S0,{time:3});ok(Bz.tips===1&&Math.abs(rr.rot[0][0]-Math.SQRT1_2)<1e-6&&Bz.min[2]>=1-1e-6,'опрокидывание через край по оси Z');
const Bw=mkb([-1.8,1.001,-.5],[-.8,3.001,.5],true);rr=simAABB([Bw],S0,{time:3});ok(Bw.tips===1&&Bw.max[0]<=-1+1e-6&&rr.rot[0][2]>0,'опрокидывание в отрицательную сторону');
const Bf=mkb([-.5,2,-.5],[.5,3,.5],true);simAABB([Bf],[],{time:2});ok(!Bf.tips,'на полу ящик не опрокидывается');}
console.log('Все проверки прошли: '+n);`;
new Function('assert',MINI+body)(assert);
