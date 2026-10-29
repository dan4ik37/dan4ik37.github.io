// ═══════════════════════════════════════
//  AI3D — 3D workshop for AI and by hand (hidden page /tools/3d). Author: the site owner (dan4ik37). Ported into the site 2026-10-29 (T-112, A1).
// ═══════════════════════════════════════
// This is the owner's editor script from ai3d.html (one inline script; 63 ops in run(cmds), atomic rollback of the scene state),
// kept as he wrote it. It runs inside D37AI3DCore.create(host, env) so it can be opened and closed many times on the SPA:
//   host — the editor root (.a3, markup from ai3d-ui.js, ids with the "a3-" prefix); env — { ws, exportGLB(group, clips), onAI(on) }.
//   Returns __site: { api (= window.AI3D), say, run, reset, frame, cam, dispose, redraw, exportGLB, connectAI, aiOn, stats, state, clips, frames }.
// The text between the @ai3d-body markers also runs as a plain top-level script in node (scripts/ai3d-test.cjs: the owner's test.mjs
// and test-run.mjs checks, real three r149, GLB export) — keep the markers and do not use `return` in the body.
// Site changes are marked "site:" (made once from the owner's ai3d.html; list in docs/areas/studio3d.md; edit this file directly now):
//   ids scoped to the host; colours from .a3 tokens; ColorManagement.legacyMode = true while open (r128 colour maths on r149, restored on
//   close); no "morphTargets" material parameter (r149); one offscreen renderer for snapshots (was a new WebGL context per call); outline
//   program per thickness; LOD copies freed with their geometry; undo snapshots capped (~24M chars); stoppable render loop and resize
//   observer; frame CPU ring for e2e; GLB through ai3d-gltf.js (binary on r149, no userData extras, linear colours); the MCP bridge
//   (server.mjs, ws://localhost) only on demand; full GPU cleanup in __dispose().
(function(){
function create(host,env){
/*@ai3d-body*/
const $=s=>host.querySelector(String(s).replace(/#([\w-]+)/g,'#a3-$1'));   // site: ids inside the host only, prefixed a3-
let state=[],hist=[],redo=[];
const cs=()=>getComputedStyle(host);   // site: colours from the editor root (.a3 tokens, both site themes)
let __bgC='',__bgN=0;const bg=()=>{if(!__bgC||++__bgN>90){__bgN=0;__bgC=cs().getPropertyValue('--bg').trim()||'#10171d'}return __bgC};   // site: no style recalc every frame
const __cm=THREE.ColorManagement,__cmL=__cm?__cm.legacyMode:undefined;if(__cm&&'legacyMode' in __cm)__cm.legacyMode=true;   // site: restored in __dispose
let __alive=true,__raf=0;
const cv=$('#c'),R=new THREE.WebGLRenderer({canvas:cv,antialias:true});
const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(50,1,.1,500);
scene.add(new THREE.HemisphereLight(0xffffff,0x556070,.55));
const dl=new THREE.DirectionalLight(0xfff4e6,.85);dl.position.set(5,10,7);scene.add(dl);scene.add(dl.target);
const fl2=new THREE.DirectionalLight(0xbcd4ff,.25);fl2.position.set(-6,4,-5);scene.add(fl2);
R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;dl.castShadow=true;dl.shadow.mapSize.set(2048,2048);dl.shadow.bias=-.0004;dl.shadow.normalBias=.02;
const catcher=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.28}));catcher.rotation.x=-Math.PI/2;catcher.position.y=.002;catcher.receiveShadow=true;catcher.userData.aux=true;scene.add(catcher);
(function(){try{const pm=new THREE.PMREMGenerator(R),es=new THREE.Scene(),g=new THREE.SphereGeometry(50,24,16),col=[],p=g.attributes.position,top=new THREE.Color(0x9fc4ee),hor=new THREE.Color(0xf2efe8),bot=new THREE.Color(0x6a6258);for(let i=0;i<p.count;i++){const y=p.getY(i)/50,c=y>0?hor.clone().lerp(top,Math.pow(y,.6)):hor.clone().lerp(bot,Math.pow(-y,.5));col.push(c.r,c.g,c.b)}g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));es.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide})));scene.environment=pm.fromScene(es,.04).texture;pm.dispose();g.dispose()}catch(e){}})();
scene.add(new THREE.GridHelper(20,20,0x7f8a94,0x4a5560));
const group=new THREE.Group();scene.add(group);

const W='#a8754a',DW='#6d4a2e',B=(n,size,pos,color,main)=>({n,type:'box',size,pos,color:color||W,main});
const PREFABS={
 chair:({w=.45,d=.45,h=.9,s=.45}={})=>{const a=w/2-.03,b=d/2-.03,r=[B('seat',[w,.05,d],[0,s,0],W,1),B('back',[w,h-s,.04],[0,s+(h-s)/2,-d/2+.02],W,1)];
  [[-a,-b],[a,-b],[-a,b],[a,b]].forEach(([x,z],i)=>r.push(B('leg'+(i+1),[.04,s,.04],[x,s/2,z],DW)));return r},
 table:({w=1.4,d=.8,h=.75,t=.04}={})=>{const a=w/2-.06,b=d/2-.06,r=[B('top',[w,t,d],[0,h-t/2,0],W,1)];
  [[-a,-b],[a,-b],[-a,b],[a,b]].forEach(([x,z],i)=>r.push(B('leg'+(i+1),[.06,h-t,.06],[x,(h-t)/2,z],DW)));return r},
 shelf:({w=.8,d=.3,h=1.8,n=4}={})=>{const r=[B('left',[.02,h,d],[-w/2+.01,h/2,0],W,1),B('right',[.02,h,d],[w/2-.01,h/2,0],W,1),B('back',[w,h,.01],[0,h/2,-d/2+.005],DW)];
  for(let i=0;i<=n;i++)r.push(B('board'+i,[w-.04,.02,d],[0,.01+i*(h-.02)/n,0],W,1));return r},
 door:({w=.9,h=2.1,t=.04}={})=>[B('leaf',[w,h,t],[0,h/2,0],W,1),{n:'handle',type:'sphere',size:[.03],pos:[w/2-.08,1,t],color:'#c9c9c9',metal:1,rough:.3}],
 window:({w=1.2,h=1.2,y=.9}={})=>[B('top',[w,.05,.08],[0,y+h-.025,0],'#e8e6e1',1),B('bottom',[w,.05,.08],[0,y+.025,0],'#e8e6e1',1),
  B('left',[.05,h-.1,.08],[-w/2+.025,y+h/2,0],'#e8e6e1',1),B('right',[.05,h-.1,.08],[w/2-.025,y+h/2,0],'#e8e6e1',1),
  {n:'glass',type:'box',size:[w-.1,h-.1,.01],pos:[0,y+h/2,0],color:'#9fd0f0',opacity:.3,rough:.05}],
 wall:({w=4,h=2.7,t=.2}={})=>[B('wall',[w,h,t],[0,h/2,0],'#e8e6e1',1)],
 stairs:({n=10,w=1,rise=.18,run=.28}={})=>Array.from({length:n},(_,i)=>B('step'+(i+1),[w,rise*(i+1),run],[0,rise*(i+1)/2,i*run],'#9a9a96',1)),
 lamp:({h=1.5}={})=>[{n:'base',type:'cylinder',size:[.15,.03],pos:[0,.015,0],color:'#3a3f45',metal:1,rough:.4},
  {n:'pole',type:'cylinder',size:[.015,h],pos:[0,h/2,0],color:'#3a3f45',metal:1,rough:.4},
  {n:'shade',type:'cylinder',size:[.2,.25],pos:[0,h+.05,0],color:'#f2e9d0',opacity:.85,rough:.9}]
};
const CUSTOM={},ANIM={};
function ccdSolve(P0,T,iter){const P=P0.map(p=>p.slice()),n=P.length,steps=[],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cr=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dt=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
 const rot=(v,ax,an)=>{const c=Math.cos(an),s=Math.sin(an),k=cr(ax,v),d=dt(ax,v);return[v[0]*c+k[0]*s+ax[0]*d*(1-c),v[1]*c+k[1]*s+ax[1]*d*(1-c),v[2]*c+k[2]*s+ax[2]*d*(1-c)]};
 for(let it=0;it<(iter||20);it++){
  for(let i=n-2;i>=0;i--){const e=P[n-1],a=sub(e,P[i]),b=sub(T,P[i]),ax=cr(a,b),l=Math.hypot(...ax);if(l<1e-9)continue;const an=Math.atan2(l,dt(a,b));if(an<1e-5)continue;const u=ax.map(x=>x/l);
   for(let j=i+1;j<n;j++){const r=rot(sub(P[j],P[i]),u,an);P[j]=[P[i][0]+r[0],P[i][1]+r[1],P[i][2]+r[2]]}steps.push({i,ax:u,an})}
  if(Math.hypot(...sub(P[n-1],T))<1e-3)break}
 return{steps,end:P[n-1]}}
const EASE={linear:x=>x,in:x=>x*x,out:x=>1-(1-x)*(1-x),inout:x=>x<.5?2*x*x:1-2*(1-x)*(1-x)};
function mirrorPose(p){return{pos:[-p.pos[0],p.pos[1],p.pos[2]],rot:[p.rot[0],-p.rot[1],-p.rot[2]],w:p.w}}
const qE=r=>new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r||[0,0,0]).map(a=>a*Math.PI/180)));
function sampleInto(A,t){const K=A.keys;if(!K.length)return;const T=K[K.length-1].t;if(A.loop&&T>0)t=t%T;
 let i=0;while(i<K.length-1&&K[i+1].t<=t)i++;
 const a=K[i],b=K[Math.min(i+1,K.length-1)],f0=b.t>a.t?Math.min(1,Math.max(0,(t-a.t)/(b.t-a.t))):0,f=(EASE[a.ease]||EASE.linear)(f0);
 Object.keys(a.poses).forEach(n=>{const o=state.find(x=>x.name===n),pa=a.poses[n],pb=b.poses[n]||pa;if(!o)return;
  o.pos=pa.pos.map((v,k)=>v+(pb.pos[k]-v)*f);
  if(pa.w||pb.w){const w={};new Set([...Object.keys(pa.w||{}),...Object.keys(pb.w||{})]).forEach(k=>{const x=(pa.w||{})[k]||0,y=(pb.w||{})[k]||0;w[k]=+(x+(y-x)*f).toFixed(3)});o.w=w}
  const e=new THREE.Euler().setFromQuaternion(qE(pa.rot).slerp(qE(pb.rot),f));o.rot=[e.x,e.y,e.z].map(r=>+(r*180/Math.PI).toFixed(3))})}
function morphTrackData(ks,name,order){const kk=ks.filter(k=>k.poses[name]),times=kk.map(k=>k.t),values=kk.flatMap(k=>order.map(o=>{const w=k.poses[name].w;return w&&w[o]!==undefined?w[o]:0}));return{times,values,any:kk.some(k=>k.poses[name].w)}}
function clips(){return Object.entries(ANIM).filter(([,A])=>A.keys.length>1).map(([nm,A])=>{
 const names=new Set();A.keys.forEach(k=>Object.keys(k.poses).forEach(n=>names.add(n)));const tr=[];
 names.forEach(n=>{const ks=A.keys.filter(k=>k.poses[n]);if(ks.length<2||!group.children.some(m=>m.name===n))return;
  tr.push(new THREE.VectorKeyframeTrack(n+'.position',ks.map(k=>k.t),ks.flatMap(k=>k.poses[n].pos)));
  tr.push(new THREE.QuaternionKeyframeTrack(n+'.quaternion',ks.map(k=>k.t),ks.flatMap(k=>qE(k.poses[n].rot).toArray())));
  const so=state.find(x=>x.name===n),ord=so&&so.size&&so.size.sk?Object.keys(so.size.sk):null;if(ord&&ord.length){const md=morphTrackData(ks,n,ord);if(md.any)tr.push(new THREE.NumberKeyframeTrack(n+'.morphTargetInfluences',md.times,md.values))}});
 return new THREE.AnimationClip(nm,-1,tr)})}
const MATS={wood:{color:'#a8754a',rough:.6},darkwood:{color:'#6d4a2e',rough:.55},metal:{color:'#b5bac0',metal:1,rough:.3},gold:{color:'#d4af37',metal:1,rough:.25},
 glass:{color:'#9fd0f0',opacity:.3,rough:.05},concrete:{color:'#9a9a96',rough:.9},white:{color:'#e8e6e1',rough:.8},black:{color:'#1c1d1f',rough:.5},
 plastic:{color:'#d9534f',rough:.35},fabric:{color:'#6b7fa3',rough:1},brick:{color:'#9c4a3a',rough:.95},grass:{color:'#5b8c3a',rough:1}};
const dt=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
class Pl{constructor(n,w){this.n=n;this.w=w}
 clone(){return new Pl(this.n.slice(),this.w)}
 flip(){this.n=this.n.map(x=>-x);this.w=-this.w}
 split(p,cf,cb,f,b){
  let T=0;const ty=p.v.map(v=>{const t=dt(this.n,v)-this.w,k=t<-1e-5?2:t>1e-5?1:0;T|=k;return k});
  if(T===0){(dt(this.n,p.pl.n)>0?cf:cb).push(p)}else if(T===1)f.push(p);else if(T===2)b.push(p);
  else{const F=[],B=[],n=p.v.length;
   for(let i=0;i<n;i++){const j=(i+1)%n,ti=ty[i],tj=ty[j],vi=p.v[i],vj=p.v[j];
    if(ti!==2)F.push(vi);if(ti!==1)B.push(vi);
    if((ti|tj)===3){const e=[vj[0]-vi[0],vj[1]-vi[1],vj[2]-vi[2]],t=(this.w-dt(this.n,vi))/dt(this.n,e),v=[vi[0]+e[0]*t,vi[1]+e[1]*t,vi[2]+e[2]*t];F.push(v);B.push(v.slice())}}
   if(F.length>=3){const q=mk(F);if(q)f.push(q)}if(B.length>=3){const q=mk(B);if(q)b.push(q)}}}}
class Po{constructor(v,pl){this.v=v;this.pl=pl}flip(){this.v.reverse();this.pl.flip()}}
function mk(v){let x=0,y=0,z=0;for(let i=0;i<v.length;i++){const a=v[i],b=v[(i+1)%v.length];x+=(a[1]-b[1])*(a[2]+b[2]);y+=(a[2]-b[2])*(a[0]+b[0]);z+=(a[0]-b[0])*(a[1]+b[1])}
 const l=Math.hypot(x,y,z);if(l<1e-10)return null;const n=[x/l,y/l,z/l];return new Po(v,new Pl(n,dt(n,v[0])))}
class Nd{constructor(p){this.pl=null;this.f=null;this.b=null;this.p=[];if(p)this.build(p)}
 invert(){this.p.forEach(x=>x.flip());if(this.pl)this.pl.flip();if(this.f)this.f.invert();if(this.b)this.b.invert();const t=this.f;this.f=this.b;this.b=t}
 clip(ps){if(!this.pl)return ps.slice();let f=[],b=[];ps.forEach(x=>this.pl.split(x,f,b,f,b));f=this.f?this.f.clip(f):f;b=this.b?this.b.clip(b):[];return f.concat(b)}
 clipTo(n){this.p=n.clip(this.p);if(this.f)this.f.clipTo(n);if(this.b)this.b.clipTo(n)}
 all(){let a=this.p.slice();if(this.f)a=a.concat(this.f.all());if(this.b)a=a.concat(this.b.all());return a}
 build(ps){if(!ps.length)return;if(!this.pl)this.pl=ps[0].pl.clone();const f=[],b=[];ps.forEach(x=>this.pl.split(x,this.p,this.p,f,b));
  if(f.length){if(!this.f)this.f=new Nd();this.f.build(f)}if(b.length){if(!this.b)this.b=new Nd();this.b.build(b)}}}
function csgOp(mode,A,B){
 const cp=ps=>ps.map(p=>mk(p.v.map(v=>v.slice()))).filter(Boolean),a=new Nd(cp(A)),b=new Nd(cp(B));
 if(mode==='sub'){a.invert();a.clipTo(b);b.clipTo(a);b.invert();b.clipTo(a);b.invert();a.build(b.all());a.invert()}
 else if(mode==='union'){a.clipTo(b);b.clipTo(a);b.invert();b.clipTo(a);b.invert();a.build(b.all())}
 else{a.invert();b.clipTo(a);b.invert();a.clipTo(b);b.clipTo(a);a.build(b.all());a.invert()}
 return a.all()}
function worldPolys(x){const g=geo(x.type,x.size),m=new THREE.Mesh(g);
 m.position.set(...(x.pos||[0,0,0]));m.rotation.set(...(x.rot||[0,0,0]).map(d=>d*Math.PI/180));m.scale.setScalar(x.scale||1);m.updateMatrix();g.applyMatrix4(m.matrix);
 const p=g.attributes.position,ix=g.index,n=ix?ix.count:p.count,out=[];
 for(let i=0;i<n;i+=3){const q=mk([0,1,2].map(k=>{const j=ix?ix.getX(i+k):i+k;return[p.getX(j),p.getY(j),p.getZ(j)]}));if(q)out.push(q)}
 g.dispose();return out}
function polysObj(ps){const key=new Map(),V=[],F=[];
 const id=v=>{const k=v.map(a=>Math.round(a*1e5)).join();let i=key.get(k);if(i===undefined){i=V.length+1;key.set(k,i);V.push(v)}return i};
 ps.forEach(p=>F.push(p.v.map(id)));
 return V.map(v=>'v '+v.map(a=>+a.toFixed(5)).join(' ')).join('\n')+'\n'+F.filter(f=>new Set(f).size>=3).map(f=>'f '+f.join(' ')).join('\n')}
function tubeGeo(s){
 if(!s||s.length<2)throw new Error('tube: нужно минимум 2 точки [x,y,z,радиус]');
 const pts=s.map(p=>new THREE.Vector3(p[0],p[1],p[2])),rs=s.map(p=>p[3]),curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.5),N=Math.max(8,s.length*8),M=12,fr=curve.computeFrenetFrames(N,false),P=[],I=[];
 for(let i=0;i<=N;i++){const u=i/N,c=curve.getPointAt(u),k=u*(rs.length-1),a=Math.min(Math.floor(k),rs.length-2),r=Math.max(rs[a]+(rs[a+1]-rs[a])*(k-a),.001),n=fr.normals[i],b=fr.binormals[i];
  for(let j=0;j<M;j++){const t=j/M*Math.PI*2,co=Math.cos(t),si=Math.sin(t);P.push(c.x+r*(co*n.x+si*b.x),c.y+r*(co*n.y+si*b.y),c.z+r*(co*n.z+si*b.z))}}
 for(let i=0;i<N;i++)for(let j=0;j<M;j++){const a=i*M+j,b=i*M+(j+1)%M,c=(i+1)*M+j,d=(i+1)*M+(j+1)%M;I.push(a,b,c,b,d,c)}
 const c0=P.length/3;P.push(pts[0].x,pts[0].y,pts[0].z);const c1=c0+1;const e=pts[pts.length-1];P.push(e.x,e.y,e.z);
 for(let j=0;j<M;j++){const j1=(j+1)%M;I.push(c0,j1,j,c1,N*M+j,N*M+j1)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setIndex(I);g.computeVertexNormals();return g}
function boolPolys(A0,bl,mode){
 if([A0,...bl].some(x=>x.type==='lathe'&&(x.size[0][0]>0||x.size[x.size.length-1][0]>0)))throw new Error('bool: lathe должен начинаться и кончаться на r=0 (замкнутый)');
 let P=worldPolys(A0);bl.forEach(x=>{P=csgOp(mode,P,worldPolys(x))});
 if(!P.length)throw new Error('bool: результат пуст (объекты не пересекаются?)');return P}
function toMesh(g){
 const p=g.attributes.position,ix=g.index,map=new Map(),v=[],f=[];
 const id=i=>{const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=Math.round(x*1e4)+','+Math.round(y*1e4)+','+Math.round(z*1e4);let r=map.get(k);if(r===undefined){r=v.length/3;map.set(k,r);v.push(+x.toFixed(4),+y.toFixed(4),+z.toFixed(4))}return r};
 const n=ix?ix.count:p.count;
 for(let i=0;i<n;i+=3){const a=id(ix?ix.getX(i):i),b=id(ix?ix.getX(i+1):i+1),c=id(ix?ix.getX(i+2):i+2);if(a!==b&&b!==c&&a!==c)f.push(a,b,c)}
 return{v,f}}
function meshGeo(s){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(s.v,3));g.setIndex(s.f);if(s.c)g.setAttribute('color',new THREE.Float32BufferAttribute(s.c,3));if(s.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(s.uv,2));if(s.sk){g.morphAttributes.position=Object.keys(s.sk).map(k=>{const a=new THREE.Float32BufferAttribute(s.sk[k],3);a.name=k;return a});g.morphTargetsRelative=true}g.computeVertexNormals();return g}
function subdivM(m){const v=m.v.slice(),f=[],cache=new Map(),c=m.c?m.c.slice():null;
 const mid=(a,b)=>{const k=a<b?a+'_'+b:b+'_'+a;let r=cache.get(k);if(r===undefined){r=v.length/3;cache.set(k,r);for(let i=0;i<3;i++)v.push(+((m.v[a*3+i]+m.v[b*3+i])/2).toFixed(4));if(c)for(let i=0;i<3;i++)c.push(+((m.c[a*3+i]+m.c[b*3+i])/2).toFixed(3))}return r};
 for(let i=0;i<m.f.length;i+=3){const a=m.f[i],b=m.f[i+1],c=m.f[i+2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);f.push(a,ab,ca,b,bc,ab,c,ca,bc,ab,bc,ca)}
 return{v,f,c}}
function adjM(m){const n=m.v.length/3,A=Array.from({length:n},()=>new Set());
 for(let i=0;i<m.f.length;i+=3){const a=m.f[i],b=m.f[i+1],c=m.f[i+2];A[a].add(b).add(c);A[b].add(a).add(c);A[c].add(a).add(b)}return A}
function lap1(m,amt){const A=adjM(m),nv=m.v.slice();
 A.forEach((s,i)=>{if(!s.size)return;let x=0,y=0,z=0;s.forEach(j=>{x+=m.v[j*3];y+=m.v[j*3+1];z+=m.v[j*3+2]});const c=s.size;
  nv[i*3]=m.v[i*3]+(x/c-m.v[i*3])*amt;nv[i*3+1]=m.v[i*3+1]+(y/c-m.v[i*3+1])*amt;nv[i*3+2]=m.v[i*3+2]+(z/c-m.v[i*3+2])*amt});
 m.v=nv.map(x=>+x.toFixed(4))}
function lapM(m,it,amt){for(let k=0;k<it;k++){lap1(m,amt);lap1(m,-amt*1.06)}}
function normM(m){const N=new Array(m.v.length).fill(0),v=m.v;
 for(let i=0;i<m.f.length;i+=3){const a=m.f[i]*3,b=m.f[i+1]*3,c=m.f[i+2]*3,
  ux=v[b]-v[a],uy=v[b+1]-v[a+1],uz=v[b+2]-v[a+2],wx=v[c]-v[a],wy=v[c+1]-v[a+1],wz=v[c+2]-v[a+2],
  nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx;
  [a,b,c].forEach(q=>{N[q]+=nx;N[q+1]+=ny;N[q+2]+=nz})}
 for(let i=0;i<N.length;i+=3){const l=Math.hypot(N[i],N[i+1],N[i+2])||1;N[i]/=l;N[i+1]/=l;N[i+2]/=l}return N}
// кисть в локальных координатах меша: c=[x,y,z], R радиус, S смещение (м) или доля, D=[x,y,z] для move
function brushM(m,br,c,R,S,f0,D){const N=normM(m),A=(br==='smooth')?adjM(m):null,nv=m.v.slice(),v=m.v;let pm=[0,0,0],nm=[0,0,0],wt=0;
 const W=i=>{const d=Math.hypot(v[i*3]-c[0],v[i*3+1]-c[1],v[i*3+2]-c[2]);return d>=R?0:Math.pow(1-(d/R)*(d/R),2)*(1-(m.mk?m.mk[i]:0))};
 const n=v.length/3;
 if(br==='flatten'){for(let i=0;i<n;i++){const w=W(i);if(!w)continue;wt+=w;for(let k=0;k<3;k++){pm[k]+=v[i*3+k]*w;nm[k]+=N[i*3+k]*w}}
  if(!wt)return;pm=pm.map(x=>x/wt);const l=Math.hypot(...nm)||1;nm=nm.map(x=>x/l)}
 for(let i=0;i<n;i++){const w=W(i);if(!w)continue;const p=[v[i*3],v[i*3+1],v[i*3+2]],q=[N[i*3],N[i*3+1],N[i*3+2]],fr=Math.min(1,f0*w);let o=p;
  if(br==='inflate')o=p.map((x,k)=>x+q[k]*S*w);
  else if(br==='deflate')o=p.map((x,k)=>x-q[k]*S*w);
  else if(br==='move'&&D)o=p.map((x,k)=>x+D[k]*S*w);
  else if(br==='pinch')o=p.map((x,k)=>x+(c[k]-x)*fr);
  else if(br==='smooth'){const s=A[i];if(s.size){const a=[0,0,0];s.forEach(j=>{a[0]+=v[j*3];a[1]+=v[j*3+1];a[2]+=v[j*3+2]});o=p.map((x,k)=>x+(a[k]/s.size-x)*fr)}}
  else if(br==='flatten'){const dd=(p[0]-pm[0])*nm[0]+(p[1]-pm[1])*nm[1]+(p[2]-pm[2])*nm[2];o=p.map((x,k)=>x-nm[k]*dd*fr)}
  nv[i*3]=o[0];nv[i*3+1]=o[1];nv[i*3+2]=o[2]}
 m.v=nv.map(x=>+x.toFixed(4))}


function isoDir(o){if(!o||(o.az===undefined&&o.el===undefined))return new THREE.Vector3(1,.8,1.2).normalize();const a=(o.az===undefined?40:o.az)*Math.PI/180,e=(o.el===undefined?25:o.el)*Math.PI/180;return new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e))}
function subdivSel(m,test){const v=m.v.slice(),f=[],cache=new Map(),c=m.c?m.c.slice():null,mk=m.mk?m.mk.slice():null,c0=m.c0?m.c0.slice():null,uvv=m.uv?m.uv.slice():null,skk=m.sk?Object.fromEntries(Object.entries(m.sk).map(([k,a])=>[k,a.slice()])):null,bb=m.b?m.b.slice():null,Ls=(m.L||[]).map(l=>({n:l.n,c:l.c.slice(),a:l.a.slice(),op:l.op,on:l.on})),mark=new Set(),key=(a,b)=>a<b?a+'_'+b:b+'_'+a;
 const mid=(a,b)=>{const k=key(a,b);let r=cache.get(k);if(r===undefined){r=v.length/3;cache.set(k,r);
  for(let i=0;i<3;i++)v.push(+((m.v[a*3+i]+m.v[b*3+i])/2).toFixed(4));
  if(c)for(let i=0;i<3;i++)c.push(+((m.c[a*3+i]+m.c[b*3+i])/2).toFixed(3));
  if(mk)mk.push(+((m.mk[a]+m.mk[b])/2).toFixed(3));if(c0)for(let i=0;i<3;i++)c0.push(+((m.c0[a*3+i]+m.c0[b*3+i])/2).toFixed(3));if(uvv)for(let i=0;i<2;i++)uvv.push(+((m.uv[a*2+i]+m.uv[b*2+i])/2).toFixed(5));if(skk)Object.keys(skk).forEach(k=>{for(let i=0;i<3;i++)skk[k].push(+((m.sk[k][a*3+i]+m.sk[k][b*3+i])/2).toFixed(4))});if(bb)for(let i=0;i<3;i++)bb.push(+((m.b[a*3+i]+m.b[b*3+i])/2).toFixed(4));(m.L||[]).forEach((l,li)=>{for(let i=0;i<3;i++)Ls[li].c.push(+((l.c[a*3+i]+l.c[b*3+i])/2).toFixed(3));Ls[li].a.push(+((l.a[a]+l.a[b])/2).toFixed(3))})}return r};
 for(let i=0;i<m.f.length;i+=3){const a=m.f[i],b=m.f[i+1],d=m.f[i+2];if(!test||test(a,b,d)){mark.add(key(a,b));mark.add(key(b,d));mark.add(key(d,a))}}
 for(let i=0;i<m.f.length;i+=3){const p=[m.f[i],m.f[i+1],m.f[i+2]],mm=[mark.has(key(p[0],p[1])),mark.has(key(p[1],p[2])),mark.has(key(p[2],p[0]))],n=mm.filter(Boolean).length;
  if(n===0)f.push(...p);
  else if(n===1){const e=mm.indexOf(true),q0=p[e],q1=p[(e+1)%3],q2=p[(e+2)%3],x=mid(q0,q1);f.push(q0,x,q2,x,q1,q2)}
  else if(n===2){const u=mm.indexOf(false),q0=p[(u+1)%3],q1=p[(u+2)%3],q2=p[u],x=mid(q0,q1),y=mid(q1,q2);f.push(q1,y,x,q0,x,y,q0,y,q2)}
  else{const ab=mid(p[0],p[1]),bc=mid(p[1],p[2]),ca=mid(p[2],p[0]);f.push(p[0],ab,ca,p[1],bc,ab,p[2],ca,bc,ab,bc,ca)}}
 return{v,f,c,mk,c0,uv:uvv,sk:skk,b:bb,L:Ls.length?Ls:undefined}}
function maskM(m,c,R,str){if(!m.mk)m.mk=new Array(m.v.length/3).fill(0);
 for(let i=0;i<m.mk.length;i++){const d=Math.hypot(m.v[i*3]-c[0],m.v[i*3+1]-c[1],m.v[i*3+2]-c[2]);if(d>=R)continue;const w=Math.pow(1-(d/R)*(d/R),2);m.mk[i]=+Math.max(m.mk[i],Math.min(1,str*w)).toFixed(3)}}
function polysMesh(ps,A0){const map=new Map(),v=[],f=[];
 const id=p=>{const k=p.map(a=>Math.round(a*1e4)).join();let r=map.get(k);if(r===undefined){r=v.length/3;map.set(k,r);v.push(...p.map(a=>+a.toFixed(4)))}return r};
 ps.forEach(p=>{const ix=p.v.map(id);for(let i=1;i<ix.length-1;i++)if(ix[0]!==ix[i]&&ix[i]!==ix[i+1]&&ix[0]!==ix[i+1])f.push(ix[0],ix[i],ix[i+1])});
 const m={v,f,c:null,mk:null};if(A0&&A0.type==='mesh'&&(A0.size.c||A0.size.uv)){const ix=nearIdx(m,A0),a=A0.size;if(a.c)m.c=nearColors(m,A0);if(a.uv){m.uv=[];ix.forEach(j=>m.uv.push(a.uv[j*2],a.uv[j*2+1]))}}return m}

let VER=Date.now();const GC=new Map();
function gkey(o){const s=o.size;return o.type+'|'+(o.ver||0)+'|'+(o.type==='mesh'?s.v.length+'/'+s.f.length+(s.c?'c':'')+(s.sk?'s'+Object.keys(s.sk).join('|'):''):(o.type==='obj'||o.type==='csg')?s.length:JSON.stringify(s))}
function cgeo(o){const k=gkey(o);let g=GC.get(k);if(!g){g=geo(o.type,o.size);GC.set(k,g);if(GC.size>60){const f=GC.keys().next().value,ev=GC.get(f);ev.dispose();const L=LODC.get(ev);if(L)L.forEach(x=>x.dispose());GC.delete(f)}}return g}

const SET={lod:true,cull:true,adaptive:true,onDemand:true,shadows:true};
let TG=null;function toonGrad(){if(!TG){TG=new THREE.DataTexture(new Uint8Array([95,95,95,255,175,175,175,255,255,255,255,255]),3,1,THREE.RGBAFormat);   // site: was LuminanceFormat (r149 WebGL2)
TG.minFilter=TG.magFilter=THREE.NearestFilter;TG.needsUpdate=true}return TG}
function mkMat(o,P){P=Object.assign({},P);delete P.morphTargets;   // site: r149
 if(o.card){const Q={map:P.map,transparent:true,alphaTest:.02,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2};return o.card==='lit'?new THREE.MeshStandardMaterial({...Q,color:'#ffffff',roughness:.7}):new THREE.MeshBasicMaterial({...Q,color:'#ffffff'})}
 if(o.toon){const Q={...P};delete Q.roughness;delete Q.metalness;return new THREE.MeshToonMaterial({...Q,gradientMap:toonGrad()})}return new THREE.MeshStandardMaterial(P)}
function regTex(rgba,w,h){const id='t'+Date.now().toString(36)+(++TID),cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').putImageData(new ImageData(rgba,w,h),0,0);const tex=new THREE.CanvasTexture(cv);TEXS[id]={w,h,d:rgba.slice(),cov:new Float32Array(w*h).fill(1),cv,tex};return id}
const BT=new Map();function bumpTex(k,sc){const key=k+'|'+sc;let t=BT.get(key);if(!t){const S=128,B=bumpGen(k,S,3),cv=document.createElement('canvas');cv.width=cv.height=S;const x=cv.getContext('2d'),im=x.createImageData(S,S);for(let i=0;i<S*S;i++){im.data[i*4]=im.data[i*4+1]=im.data[i*4+2]=B[i];im.data[i*4+3]=255}x.putImageData(im,0,0);t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(sc,sc);BT.set(key,t)}return t}
let PLAYSEL=[],dirty=true,playing=null,lodOn=true,lodN=0,lastT=0,ft=16,PR=Math.min(devicePixelRatio,2);
const LODC=new WeakMap();

function lodsOf(g){let L=LODC.get(g);if(!L){L=[decimate(g,28),decimate(g,12)];LODC.set(g,L);lodN+=2}return L}
const triOf=g=>g.index?g.index.count/3:g.attributes.position.count/3;
const __wc=new THREE.Vector3();let __lodB=1,__lodPend=false;function lodUpdate(force){const wc=__wc;__lodB=1;
 group.children.forEach(m=>{const g0=m.userData.g0;if(!g0)return;
  if(force){if(m.geometry!==g0)m.geometry=g0;m.visible=true;return}
  if(!g0.boundingSphere)g0.computeBoundingSphere();m.updateMatrixWorld();
  const bs=g0.boundingSphere,rad=bs.radius*Math.max(m.scale.x,m.scale.y,m.scale.z),dist=Math.max(cam.position.distanceTo(wc.copy(bs.center).applyMatrix4(m.matrixWorld)),1e-3),cov=rad/dist;
  m.visible=SET.cull?cov>=.0015:true;
  if(m.userData.n===undefined)m.userData.n=triOf(g0);
  if(SET.lod&&!g0.morphAttributes.position&&m.userData.n>3000){let g=g0;if(cov<=.12){const L=LODC.get(g0)||(__lodB-->0?lodsOf(g0):null);if(L)g=cov>.04?L[0]:L[1];else __lodPend=true}if(m.geometry!==g)m.geometry=g}   // site: lazy, ≤1 per frame
  else if(m.geometry!==g0)m.geometry=g0})}
function stats(){let tri=0,full=0,vis=0;group.children.forEach(m=>{full+=triOf(m.userData.g0||m.geometry);tri+=triOf(m.geometry);if(m.visible)vis++});
 return{objects:state.length,drawn:vis,tris_now:Math.round(tri),tris_full:Math.round(full),geom_cache:GC.size,lod_geoms:lodN,pixelRatio:+PR.toFixed(2),ms_per_frame:+ft.toFixed(1)}}

function selftest(){
 const kS=state,kH=hist.slice(),kR=redo.slice(),kC=Object.assign({},CUSTOM),kA=JSON.parse(JSON.stringify(ANIM)),kK=CON.slice(),kL=JSON.stringify(LAYERS),kSo=SOLO,res=[];
 state=[];hist.length=0;redo.length=0;CON.length=0;Object.keys(LAYERS).forEach(k=>delete LAYERS[k]);SOLO=null;Object.keys(ANIM).forEach(k=>delete ANIM[k]);
 const g=n=>group.children.find(m=>m.name===n);
 const T=[
  ['примитивы',[{op:'add',name:'b1',type:'box',size:[1,1,1],pos:[0,.5,0],mat:'wood'},{op:'add',name:'e1',type:'ellipsoid',size:[.4,.3,.3],pos:[2,.5,0]},{op:'add',name:'t1',type:'tube',size:[[0,0,0,.1],[0,.5,0,.08],[.3,1,0,.03]],pos:[-2,0,0]},{op:'add',name:'l1',type:'lathe',size:[[0,0],[.3,0],[.2,.5],[0,.6]],pos:[0,0,-2]},{op:'add',name:'c1',type:'cylinder',size:[.2,.5],pos:[1,.25,2]},{op:'add',name:'k1',type:'cone',size:[.2,.4],pos:[3,.2,3]},{op:'add',name:'o1',type:'torus',size:[.4,.1],pos:[-3,.5,3]},{op:'add',name:'p1',type:'plane',size:[2,2],pos:[0,0,4]},{op:'add',name:'x1',type:'extrude',size:[.2,[[0,0],[.5,0],[.25,.5]]],pos:[-4,0,0]}]],
  ['set/clone/mirror/array',[{op:'set',name:'b1',color:'#ff8800'},{op:'clone',name:'b1',as:'b2',pos:[4,.5,0]},{op:'mirror',name:'e1',axis:'x',as:'e1m'},{op:'array',name:'c1',count:3,step:[0,0,.6]},{op:'array',name:'k1',count:6,around:[0,0,0],axis:'y',angle:360}]],
  ['place/move/rotate',[{op:'place',name:'b2',to:'b1',rel:'on'},{op:'move',name:'b2',by:[.1,0,0]},{op:'rotate',name:'b2',axis:'y',deg:30,pivot:[0,0,0]}]],
  ['иерархия',[{op:'add',name:'j1',type:'sphere',size:[.05],pos:[0,2,0]},{op:'add',name:'j2',type:'sphere',size:[.05],pos:[0,2.5,0],parent:'j1'},{op:'set',name:'j1',pos:[0,2,1]}]],
  ['дети следуют за родителем',()=>{const j=state.find(x=>x.name==='j2');if(!j||Math.abs(j.pos[2]-1)>1e-6)throw new Error('ребёнок не сдвинулся');}],
  ['prefab/define',[{op:'prefab',type:'chair',name:'ch',pos:[5,0,5],yaw:45},{op:'define',name:'mychair',prefix:'ch_'},{op:'prefab',type:'mychair',name:'ch2',pos:[6,0,5]}]],
  ['mesh/subdiv/smooth',[{op:'subdiv',name:'e1',levels:1,smooth:1},{op:'smooth',name:'e1',iter:1},{op:'subdiv',name:'e1',center:[2,.5,0],radius:.2}]],
  ['sculpt',[{op:'sculpt',name:'e1',brush:'inflate',center:[2,.8,0],radius:.2,symmetry:true},{op:'sculpt',name:'e1',strokes:[{brush:'smooth',center:[2,.5,0],radius:.2},{brush:'pinch',center:[2,.5,0],radius:.2},{brush:'flatten',center:[2,.5,0],radius:.2},{brush:'deflate',center:[2,.5,0],radius:.2},{brush:'move',center:[2,.5,0],radius:.2,dir:[0,1,0]}]}]],
  ['paint',[{op:'paint',name:'e1',color:'#ff0000',all:true},{op:'paint',name:'e1',color:'#00ff00',center:[2,.8,0],radius:.2,symmetry:true}]],
  ['mask',[{op:'mask',name:'e1',center:[2,.8,0],radius:.2},{op:'mask',name:'e1',invert:true},{op:'mask',name:'e1',clear:true}]],
  ['shape keys',[{op:'shape',name:'e1',base:true},{op:'sculpt',name:'e1',brush:'inflate',center:[2,.8,0],radius:.3,strength:.1},{op:'shape',name:'e1',key:'a'},{op:'shape',name:'e1',weights:{a:.5}}]],
  ['bool sub',[{op:'add',name:'cut',type:'box',size:[.3,2,.3],pos:[0,.5,0]},{op:'bool',mode:'sub',a:'b1',b:'cut',name:'b1'}]],
  ['bool live/rebool/unbool',[{op:'add',name:'cut2',type:'box',size:[.2,.2,3],pos:[0,.5,-2]},{op:'add',name:'l2',type:'box',size:[1,1,1],pos:[0,.5,-2]},{op:'bool',mode:'sub',a:'l2',b:'cut2',live:true},{op:'rebool',name:'l2_cut'},{op:'unbool',name:'l2_cut'}]],
  ['chain/ik/aim',[{op:'chain',prefix:'arm',points:[[0,0,3],[0,1,3],[0,2,3]]},{op:'ik',chain:['arm1','arm2','arm3'],target:[1,1,3]},{op:'aim',name:'arm3',target:[3,3,3]}]],
  ['анимация',[{op:'key',anim:'w',time:0,names:['arm1','arm2','arm3'],loop:true},{op:'rotate',name:'arm2',axis:'z',deg:40,pivot:'arm2'},{op:'key',anim:'w',time:.5,ease:'out'},{op:'cycle',anim:'w',duration:1},{op:'anim_copy',anim:'w',from:0,to:.25},{op:'pose',anim:'w',time:.3}]],
  ['гнёзда и connect',[{op:'add',name:'sa',type:'box',size:[1,1,1],pos:[0,.5,12]},{op:'add',name:'sb',type:'box',size:[1,1,1],pos:[5,.5,12],rot:[0,0,90]},{op:'socket',name:'sa',id:'top',at:'top'},{op:'socket',name:'sb',id:'bot',at:'bottom'},{op:'connect',a:'sb:bot',b:'sa:top'},{op:'snap',name:'sb',radius:5},{op:'socket',name:'sb',id:'bot',delete:true}]],
  ['связи',[{op:'add',name:'tgt',type:'sphere',size:[.1],pos:[0,3,3]},{op:'add',name:'eye',type:'cone',size:[.1,.2],pos:[1,1,1]},{op:'constrain',type:'lookat',name:'eye',target:'tgt'},{op:'constrain',type:'limit',name:'eye',axis:'x',min:-30,max:30},{op:'add',name:'bx',type:'box',size:[1,1,1],pos:[8,5,8]},{op:'constrain',type:'rest',name:'bx'},{op:'add',name:'ra',type:'sphere',size:[.1],pos:[9,1,9]},{op:'add',name:'rb',type:'sphere',size:[.1],pos:[9,2,9]},{op:'constrain',type:'distance',a:'ra',b:'rb',dist:.5},{op:'set',name:'tgt',pos:[0,3,-3]}]],
  ['rest ставит на пол',()=>{build();const b=new THREE.Box3().setFromObject(g('bx'));if(Math.abs(b.min.y)>1e-3)throw new Error('min.y='+b.min.y)}],
  ['запросы',()=>{queryRun({q:'height',x:0,z:0});queryRun({q:'ray',from:[0,10,0],dir:[0,-1,0]});queryRun({q:'distance',a:'b1',b:'b2'});queryRun({q:'contacts'});queryRun({q:'nearest',name:'b1'})}],
  ['референс-сравнение',()=>{const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,64,64);x.fillStyle='#fff';x.fillRect(16,8,32,48);const was=REF.front;REF.front={img:cv,w:1,u:0,v:.5,op:.4};try{refCompare('front',128);snap(128,['Спереди'])}finally{if(was)REF.front=was;else delete REF.front}}],
  ['зеркальная и плоская связь',[{op:'add',name:'q_L',type:'box',size:[.1,.1,.1],pos:[.5,1,13]},{op:'add',name:'q_R',type:'box',size:[.1,.1,.1],pos:[-.1,0,13]},{op:'constrain',type:'mirror'},{op:'constrain',type:'plane',name:'q_L',axis:'z',value:13}]],
  ['слои сцены',[{op:'layer',name:'L1',objects:['sa'],visible:true},{op:'layer',name:'L1',locked:true}]],
  ['замок слоя',()=>{const r=run([{op:'set',name:'sa',color:'#00ff00'}]);if(r.ok)throw new Error('заблокированный слой не защитил объект')}],
  ['слои: соло и показать всё',[{op:'layer',name:'L1',locked:false,solo:true},{op:'layer',name:'L1',show_all:true,solo:false}]],
  ['цветовые слои',[{op:'paint',name:'e1',color:'#aa5533',layer:'кожа',all:true},{op:'paint',name:'e1',color:'#ffffff',layer:'блик',center:[2,.8,0],radius:.2},{op:'clayer',name:'e1',layer:'блик',opacity:.5},{op:'clayer',name:'e1',layer:'блик',on:false},{op:'clayer',name:'e1',layer:'блик',merge:true}]],
  ['фото на сетку',()=>{const cv=document.createElement('canvas');cv.width=cv.height=8;const x=cv.getContext('2d');x.fillStyle='#c88';x.fillRect(0,0,8,8);const was=REF.front;REF.front={img:cv,w:2,u:2,v:.5,op:.4};try{const r=run([{op:'photo',name:'e1',view:'front',layer:'фото',strength:1}]);if(!r.ok)throw new Error(r.error)}finally{if(was)REF.front=was;else delete REF.front}}],
  ['формы + subdiv + uv sphere',[{op:'add',name:'sh',type:'ellipsoid',size:[.3,.3,.3],pos:[0,.5,24]},{op:'subdiv',name:'sh',levels:1},{op:'shape',name:'sh',base:true},{op:'sculpt',name:'sh',brush:'inflate',center:[0,.8,24],radius:.2,strength:.05},{op:'shape',name:'sh',key:'k'},{op:'subdiv',name:'sh',levels:1},{op:'uv',name:'sh',mode:'sphere'},{op:'shape',name:'sh',weights:{k:.5}}]],
  ['физика',[{op:'add',name:'pb1',type:'box',size:[.4,.4,.4],pos:[0,3,30]},{op:'add',name:'pt',type:'box',size:[2,.1,2],pos:[0,.95,30]},{op:'simulate',bodies:['pb1'],time:2,record:'fall',every:.1},{op:'add',name:'pb2',type:'sphere',size:[.2],pos:[.3,4,30]},{op:'drop',bodies:['pb2']}]],
  ['физика: коробка легла на стол',()=>{const b=state.find(x=>x.name==='pb1');if(!b||Math.abs(b.pos[1]-1.2)>.05)throw new Error('pb1.y='+(b&&b.pos[1])+', ожидалось около 1.2')}],
  ['сшивка фото',()=>{const mk=col=>{const cv=document.createElement('canvas');cv.width=cv.height=8;const x=cv.getContext('2d');x.fillStyle=col;x.fillRect(0,0,8,8);return cv},wf=REF.front,ws=REF.side;
   REF.front={img:mk('#c88'),w:4,u:0,v:.5,op:.4};REF.side={img:mk('#a66'),w:4,u:0,v:.5,op:.4};
   try{const r=run([{op:'photo',name:'sh',views:['front','side'],layer:'ф'},{op:'texture',name:'sh',views:['front','side'],size:64}]);if(!r.ok)throw new Error(r.error)}finally{if(wf)REF.front=wf;else delete REF.front;if(ws)REF.side=ws;else delete REF.side}}],
  ['UV и текстура',()=>{const r0=run([{op:'add',name:'tx',type:'ellipsoid',size:[.4,.4,.4],pos:[0,.5,20]},{op:'uv',name:'tx',mode:'cylinder'}]);if(!r0.ok)throw new Error(r0.error);
   const cv=document.createElement('canvas');cv.width=cv.height=8;const x=cv.getContext('2d');x.fillStyle='#c88';x.fillRect(0,0,8,8);const was=REF.front;REF.front={img:cv,w:2,u:0,v:.5,op:.4};
   try{const r=run([{op:'texture',name:'tx',view:'front',size:64}]);if(!r.ok)throw new Error(r.error);const rp=run([{op:'paint',name:'tx',color:'#00ff00',center:[0,.5,20.4],radius:.3,symmetry:true},{op:'photo',name:'tx',view:'front'}]);if(!rp.ok)throw new Error(rp.error);const r2=run([{op:'texture',name:'tx',clear:true}]);if(!r2.ok)throw new Error(r2.error)}finally{if(was)REF.front=was;else delete REF.front}}],
  ['манифест для игры',()=>{const j=JSON.parse(JSON.stringify(manifestOf(state,ANIM,LAYERS,CON,n=>{const m=group.children.find(x=>x.name===n);if(!m)return null;const b=new THREE.Box3().setFromObject(m);return{min:b.min.toArray(),max:b.max.toArray()}})));if(!j.objects.length)throw new Error('пустой манифест')}],
  ['сводка и проверки',()=>{if(!summary().includes('Объектов'))throw new Error('пустая сводка')}],
  ['скриншот и фокус',()=>{snap(128,['Спереди'],true,{focus:['b1'],zoom:2})}],
  ['растения',[{op:'tree',name:'tr1',species:'oak',height:4,pos:[0,0,40],seed:2},{op:'tree',name:'tr2',species:'pine',height:5,pos:[3,0,40]},{op:'tree',name:'tr3',species:'palm',height:4,pos:[-3,0,40]},{op:'tree',name:'tr4',species:'bush',height:1,pos:[6,0,40]}]],
  ['волосы',[{op:'add',name:'hd',type:'ellipsoid',size:[.09,.11,.1],pos:[0,1.7,45]},{op:'hair',name:'hr',on:'hd',style:'long',bangs:true},{op:'add',name:'hd2',type:'ellipsoid',size:[.09,.11,.1],pos:[1,1.7,45]},{op:'hair',name:'hr2',on:'hd2',style:'ponytail'}]],
  ['одежда и ткань',[{op:'add',name:'tt',type:'cylinder',size:[.15,.6],pos:[0,1,50]},{op:'wear',name:'sh1',on:'tt',region:{y:[-.2,.3]},gap:.02,flare:.4,thick:.008},{op:'cloth',name:'sk',shape:'skirt',pos:[0,1.2,50],r0:.17,r1:.35,h:.6,collide:['tt']},{op:'cloth',name:'cp',shape:'rect',pos:[2,2,50],w:1,h:1,pin:'corners',wind:[2,0,0]}]],
  ['существо с шерстью и походкой',[{op:'make',type:'dog',name:'dg',pos:[0,0,60],fur:{density:1500}},{op:'gait',prefix:'dg_',clip:'walk',anim:'dgwalk'},{op:'pose',anim:'dgwalk',time:.25}]],
  ['человек: лицо, походка, вторичное движение',[{op:'make',type:'human',name:'hm',pos:[3,0,60],bust:.4},{op:'face',on:'hm_head',variant:'elf'},{op:'gait',prefix:'hm_',clip:'walk',anim:'hmwalk'},{op:'surface',name:'hm_torso',bump:'skin'}]],
  ['ландшафт и рассеивание',[{op:'terrain',name:'tn',size:[30,30],res:32,amp:3,pos:[0,0,90],sea:.3},{op:'tree',name:'tsrc',species:'pine',height:3,pos:[40,0,90],leafDensity:.3},{op:'scatter',src:'tsrc',on:'tn',count:15,hideSrc:true}]],
  ['авториг своей модели',[{op:'add',name:'ar_body',type:'ellipsoid',size:[.2,.3,.12],pos:[8,1,60]},{op:'add',name:'ar_head',type:'sphere',size:[.12],pos:[8,1.5,60]},{op:'add',name:'ar_leg_L',type:'cylinder',size:[.06,.6],pos:[8.1,.4,60]},{op:'add',name:'ar_leg_R',type:'cylinder',size:[.06,.6],pos:[7.9,.4,60]},{op:'autorig',prefix:'ar_'},{op:'gait',prefix:'ar_',clip:'walk',anim:'arwalk'}]],
  ['пины (warp)',[{op:'add',name:'wp',type:'sphere',size:[.3],pos:[10,1,60]},{op:'warp',name:'wp',pins:[{at:[0,.3,0],by:[0,.1,0],r:.2}]}]],
  ['рисованное аниме-лицо',[{op:'puppet',name:'pp',pos:[0,2,120],width:.6},{op:'faceanim',prefix:'pp_',clip:'talk',anim:'pptalk'},{op:'pose',anim:'pptalk',time:.4}]],
  ['3D аниме-лицо',[{op:'facegen',name:'fg',pos:[4,1.65,120],style:'anime',eye:'#ff8a3a'},{op:'faceanim',prefix:'fg_',clip:'happy',anim:'fghappy'},{op:'pose',anim:'fghappy',time:.5}]],
  ['реалистичное лицо',[{op:'facegen',name:'fr',pos:[7,1.65,120],style:'real',skin:'#e8b99a',eye:'#6a4a2a'}]],
  ['антропоморф и аксессуары',[{op:'make',type:'anthro',species:'fox',name:'fx',pos:[0,0,130],face:'anime',fur:{density:900}},{op:'gait',prefix:'fx_',clip:'walk',anim:'fxwalk'},{op:'make',type:'human',name:'kz',pos:[3,0,130],ears:'cat',tail:'cat',horns:'small',wings:'bat'},{op:'make',type:'centaur',name:'ct',pos:[6,0,130]},{op:'make',type:'dragon',name:'dr',pos:[10,0,130]},{op:'gait',prefix:'dr_',clip:'walk',anim:'drwalk'}]],
  ['рисунок-карточка',[{op:'art',name:'ar1',pos:[0,1,140],w:.5,h:.5,shapes:[{t:'ell',c:[.5,.5],r:[.4,.4],fill:{g:'rad',c:[.5,.5],r:[.4,.4],stops:[[0,'#ffe9a0'],[1,'#ff8a3a']]},stroke:'#503010',sw:.02}]}]],
  ['опрокидывание ящика',[{op:'add',name:'tb',type:'box',size:[2,1,2],pos:[0,.5,150]},{op:'add',name:'cr',type:'box',size:[1,2,1],pos:[1.3,2.05,150]},{op:'drop',bodies:['cr'],time:3}]],
  ['LOD и статистика',()=>{const m=g('e1');if(m)decimate(m.userData.g0||m.geometry,12);lodUpdate(false);lodUpdate(true);stats()}],
  ['экспорт OBJ и клипы',()=>{obj();clips()}]
 ];
 T.forEach(([n,c])=>{try{if(typeof c==='function'){c();res.push('✓ '+n)}else{const r=run(c);res.push(r.ok?'✓ '+n:'✗ '+n+': '+r.error)}}catch(e){res.push('✗ '+n+': '+e.message)}});
 state=kS;hist.length=0;kH.forEach(x=>hist.push(x));redo.length=0;kR.forEach(x=>redo.push(x));
 Object.keys(CUSTOM).forEach(k=>delete CUSTOM[k]);Object.assign(CUSTOM,kC);Object.keys(ANIM).forEach(k=>delete ANIM[k]);Object.assign(ANIM,kA);CON.length=0;kK.forEach(x=>CON.push(x));Object.keys(LAYERS).forEach(k=>delete LAYERS[k]);Object.assign(LAYERS,JSON.parse(kL));SOLO=kSo;
 build();const bad=res.filter(x=>x[0]==='✗').length;return (bad?'Ошибок: '+bad+' из '+res.length:'Все '+res.length+' проверок прошли')+'\n'+res.join('\n')}
const CON=[];
function consDist(pa,pb,dist){const v=[pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]],d=Math.hypot(...v);if(Math.abs(d-dist)<1e-4)return null;const u=d<1e-9?[1,0,0]:v.map(x=>x/d);return u.map(x=>x*(dist-d))}
function bbName(n){const e=group.children.filter(m=>m.name===n),a=e.length?e:group.children.filter(m=>m.name.startsWith(n));if(!a.length)return null;const b=new THREE.Box3();a.forEach(m=>b.expandByObject(m));return b}
function aimObj(o,tg,axn){const ax={x:[1,0,0],y:[0,1,0],z:[0,0,1]}[axn||'z'],d=new THREE.Vector3(...tg).sub(new THREE.Vector3(...o.pos));if(d.length()<1e-6)return false;d.normalize();
 const R=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...ax).applyQuaternion(qE(o.rot)),d);if(R.angleTo(new THREE.Quaternion())<1e-5)return false;
 const Pv=new THREE.Vector3(...o.pos),z=new THREE.Vector3();[o,...kids(o.name)].forEach(x=>rigid(x,R,Pv,z));return true}
function solveCons(){let ch=false;
 for(const k of CON){if(k.type==='mirror'){if(mirrorSolve(k))ch=true;continue}const o=state.find(x=>x.name===(k.name||k.b));if(!o)continue;
  if(k.type==='lookat'){const tg=Array.isArray(k.target)?k.target:(state.find(x=>x.name===k.target)||{}).pos;if(tg&&aimObj(o,tg,k.axis))ch=true}
  else if(k.type==='limit'){const ai={x:0,y:1,z:2}[k.axis||'x'],r=o.rot||[0,0,0],v=Math.min(k.max,Math.max(k.min,r[ai]));
   if(Math.abs(v-r[ai])>1e-3){const nr=[...r];nr[ai]=v;const R=qE(nr).multiply(qE(r).invert()),Pv=new THREE.Vector3(...o.pos),z=new THREE.Vector3();kids(o.name).forEach(x=>rigid(x,R,Pv,z));o.rot=nr;ch=true}}
  else if(k.type==='distance'){const a=state.find(x=>x.name===k.a);if(!a)continue;const d=consDist(a.pos,o.pos,k.dist);if(d){withKids([o]).forEach(x=>{x.pos=x.pos.map((v,i)=>v+d[i])});ch=true}}
  else if(k.type==='plane'){const ai={x:0,y:1,z:2}[k.axis||'y'];if(Math.abs(o.pos[ai]-k.value)>1e-4){const dd=[0,0,0];dd[ai]=k.value-o.pos[ai];withKids([o]).forEach(x=>{x.pos=x.pos.map((v,i)=>v+dd[i])});ch=true}}
  else if(k.type==='rest'){const sb=bbName(k.name);if(!sb)continue;let top=0;if(k.on&&k.on!=='floor'){const tb=bbName(k.on);if(!tb)continue;top=tb.max.y}
   const dy=top+(k.gap||0)-sb.min.y;if(Math.abs(dy)>1e-4){const g=state.filter(x=>x.name===k.name);withKids(g.length?g:state.filter(x=>x.name.startsWith(k.name))).forEach(x=>{x.pos=[x.pos[0],x.pos[1]+dy,x.pos[2]]});ch=true;build()}}}
 return ch}
function settle(){if(!CON.length)return '';try{for(let i=0;i<3;i++){build();if(!solveCons())break}build();return ''}catch(e){return '\nСвязи: ошибка '+e.message}}
function queryRun(q){lodUpdate(true);group.updateMatrixWorld(true);dirty=true;lodOn=true;
 const ms=group.children.filter(m=>m.visible!==false),f=v=>+v.toFixed(3),V=v=>[f(v.x),f(v.y),f(v.z)];
 const bb=n=>{const e=ms.filter(m=>m.name===n),a=e.length?e:ms.filter(m=>m.name.startsWith(n));if(!a.length)throw new Error('Нет объекта: '+n);const b=new THREE.Box3();a.forEach(m=>b.expandByObject(m));return b};
 const gap=(A,B)=>Math.hypot(Math.max(A.min.x-B.max.x,B.min.x-A.max.x,0),Math.max(A.min.y-B.max.y,B.min.y-A.max.y,0),Math.max(A.min.z-B.max.z,B.min.z-A.max.z,0));
 if(q.q==='ray'||q.q==='height'){
  const h=q.q==='height',rc=new THREE.Raycaster(new THREE.Vector3(...(h?[q.x,1000,q.z]:q.from)),new THREE.Vector3(...(h?[0,-1,0]:q.dir)).normalize()),ig=q.ignore||[];
  const hit=rc.intersectObjects(ms.filter(m=>!ig.some(n=>m.name===n||m.name.startsWith(n))),false)[0];
  if(h)return hit?{object:hit.object.name,y:f(hit.point.y)}:{object:null,y:0};
  return hit?{object:hit.object.name,point:V(hit.point),distance:f(hit.distance),normal:hit.face?V(hit.face.normal.clone().transformDirection(hit.object.matrixWorld)):null}:{object:null}}
 if(q.q==='distance'){const A=bb(q.a),B=bb(q.b);return{gap:f(gap(A,B)),centers:f(A.getCenter(new THREE.Vector3()).distanceTo(B.getCenter(new THREE.Vector3()))),a_from_b:V(A.getCenter(new THREE.Vector3()).sub(B.getCenter(new THREE.Vector3())))}}
 if(q.q==='nearest'){const A=bb(q.name);return ms.filter(m=>m.name!==q.name&&!m.name.startsWith(q.name)).map(m=>({object:m.name,gap:f(gap(A,new THREE.Box3().setFromObject(m)))})).sort((a,b)=>a.gap-b.gap).slice(0,q.count||5)}
 if(q.q==='contacts'){const B=ms.slice(0,80).map(m=>({n:m.name,b:new THREE.Box3().setFromObject(m)})),out=[],nm=q.names||null;
  for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++){if(nm&&!nm.some(n=>B[i].n.startsWith(n)||B[j].n.startsWith(n)))continue;
   const a=B[i].b,b=B[j].b,ox=Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x),oy=Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y),oz=Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z);
   if(ox<-1e-3||oy<-1e-3||oz<-1e-3)continue;const dp=Math.min(ox,oy,oz);out.push({a:B[i].n,b:B[j].n,state:dp>1e-3?'пересекаются':'касаются',depth:f(Math.max(dp,0))})}
  return out.sort((x,y)=>y.depth-x.depth).slice(0,30)}
 throw new Error('q: ray, height, distance, nearest, contacts')}
function sockWorld(o,id){const s=o.sockets&&o.sockets[id];if(!s)throw new Error('нет гнезда '+id+' у '+o.name);const q=qE(o.rot),sc=o.scale||1;
 return{p:new THREE.Vector3(...s.pos).multiplyScalar(sc).applyQuaternion(q).add(new THREE.Vector3(...o.pos)),d:new THREE.Vector3(...(s.dir||[0,1,0])).applyQuaternion(q).normalize()}}
function connectSock(c){
 const [an,ai]=String(c.a).split(':'),[bn,bi]=String(c.b).split(':'),A=state.find(x=>x.name===an),B=state.find(x=>x.name===bn);
 if(!A||!B)throw new Error('connect: нет объекта '+(A?bn:an));if(A===B)throw new Error('connect: a и b один объект');
 const sa=sockWorld(A,ai),sb=sockWorld(B,bi),Q=new THREE.Quaternion().setFromUnitVectors(sa.d,sb.d.clone().multiplyScalar(-1)),
  mv=withKids([A,...(c.group?state.filter(x=>x.name.startsWith(c.group)&&x!==A):[])]);
 if(mv.includes(B))throw new Error('connect: b входит в перемещаемую группу a (родитель или ребёнок)');
 const z=new THREE.Vector3(),tgt=sb.p.clone().add(sb.d.clone().multiplyScalar(c.gap||0)),d=tgt.clone().sub(sa.p);
 mv.forEach(x=>rigid(x,Q,sa.p,d));
 if(c.spin){const S=new THREE.Quaternion().setFromAxisAngle(sb.d.clone().normalize(),c.spin*Math.PI/180);mv.forEach(x=>rigid(x,S,tgt,z))}}
function snapSock(c){
 const A=state.find(x=>x.name===c.name);if(!A||!A.sockets)throw new Error('snap: у '+c.name+' нет гнёзд');
 const mine=withKids([A]);let best=null;
 Object.keys(A.sockets).forEach(ia=>{const a=sockWorld(A,ia);state.forEach(B=>{if(!B.sockets||mine.includes(B))return;Object.keys(B.sockets).forEach(ib=>{const b=sockWorld(B,ib),dd=a.p.distanceTo(b.p);if(a.d.dot(b.d)<-.5&&dd<=(c.radius||.3)&&(!best||dd<best.dd))best={dd,a:A.name+':'+ia,b:B.name+':'+ib}})})});
 if(!best)throw new Error('snap: нет подходящих гнёзд в радиусе '+(c.radius||.3));connectSock({a:best.a,b:best.b,gap:c.gap,spin:c.spin,group:c.group})}
const REF={},VK={'Спереди':'front','Сбоку':'side','Сверху':'top'};
function maskFromData(d,w,h){const n=w*h,m=new Uint8Array(n);let hasA=false;for(let i=3;i<d.length;i+=4)if(d[i]<250){hasA=true;break}
 if(hasA){for(let i=0;i<n;i++)m[i]=d[i*4+3]>128?1:0;return m}
 const ix=[0,w-1,w*(h-1),n-1],bg=[0,1,2].map(k=>ix.map(i=>d[i*4+k]).sort((a,b)=>a-b)[1]);
 for(let i=0;i<n;i++)m[i]=(Math.abs(d[i*4]-bg[0])+Math.abs(d[i*4+1]-bg[1])+Math.abs(d[i*4+2]-bg[2]))>60?1:0;return m}
function cmpMasks(A,B,S){let i=0,u=0,a=0,b=0;const ba={x0:S,y0:S,x1:-1,y1:-1},bbb={x0:S,y0:S,x1:-1,y1:-1},ext=(o,x,y)=>{if(x<o.x0)o.x0=x;if(x>o.x1)o.x1=x;if(y<o.y0)o.y0=y;if(y>o.y1)o.y1=y};
 for(let p=0;p<S*S;p++){const x=p%S,y=(p/S)|0;if(A[p]){a++;ext(ba,x,y)}if(B[p]){b++;ext(bbb,x,y)}if(A[p]&&B[p])i++;if(A[p]||B[p])u++}
 return{iou:u?i/u:0,a,b,ba,bbb}}
function hintOf(cm,ppm){const A=cm.ba,B=cm.bbb,f=v=>+v.toFixed(3);if(!cm.a)return 'модель не видна в этом виде';if(!cm.b)return 'референс пуст (проверь изображение)';
 const wa=(A.x1-A.x0+1)/ppm,ha=(A.y1-A.y0+1)/ppm,wb=(B.x1-B.x0+1)/ppm,hb=(B.y1-B.y0+1)/ppm,dx=((A.x0+A.x1)-(B.x0+B.x1))/2/ppm,dy=-((A.y0+A.y1)-(B.y0+B.y1))/2/ppm;
 return 'IoU '+f(cm.iou)+'; модель '+f(wa)+'×'+f(ha)+' м, референс '+f(wb)+'×'+f(hb)+' м (ширина ×'+f(wa/wb)+', высота ×'+f(ha/hb)+'); центр модели смещён '+(dx>=0?'вправо ':'влево ')+f(Math.abs(dx))+' м, '+(dy>=0?'вверх ':'вниз ')+f(Math.abs(dy))+' м'}
function refRect(R,v,cu,cv,rad,S){const ppm=S/(2*rad),w=R.w*ppm,h=w*R.img.height/R.img.width,sx=v==='side'?-1:1,sy=v==='top'?-1:1;return{x:S/2+sx*(R.u-cu)*ppm-w/2,y:S/2-sy*(R.v-cv)*ppm-h/2,w,h}}
function drawRef(x,px,py,S,name,c,rad){const v=VK[name],R=v&&REF[v];if(!R)return;const q=refRect(R,v,v==='side'?c.z:c.x,v==='top'?c.z:c.y,rad,S);
 x.save();x.beginPath();x.rect(px,py,S,S);x.clip();x.globalAlpha=R.op;x.drawImage(R.img,px+q.x,py+q.y,q.w,q.h);x.restore()}
function refCompare(view,S=256){
 const R=REF[view];if(!R)throw new Error('нет референса для вида '+view);
 const asp=R.img.height/R.img.width,rad=Math.max(R.w,R.w*asp)*.65,ppm=S/(2*rad),cu=R.u,cv=R.v;
 const r=offR();r.setSize(S,S);r.setClearColor(0x000000);
 const env=scene.environment,om=scene.overrideMaterial,grid={set visible(v){scene.children.forEach(o=>{if(o.type==='GridHelper'||o.userData.aux)o.visible=v})}};let mA;
 scene.environment=null;scene.overrideMaterial=new THREE.MeshBasicMaterial({color:0xffffff});if(grid)grid.visible=false;lodUpdate(true);
 try{const k=new THREE.OrthographicCamera(-rad,rad,rad,-rad,.01,1000),T=view==='front'?[cu,cv,0]:view==='side'?[0,cv,cu]:[cu,0,cv],D=view==='front'?[0,0,1]:view==='side'?[1,0,0]:[0,1,0];
  k.position.set(T[0]+D[0]*100,T[1]+D[1]*100,T[2]+D[2]*100);if(view==='top')k.up.set(0,0,-1);k.lookAt(new THREE.Vector3(...T));r.render(scene,k);
  const mc=document.createElement('canvas');mc.width=mc.height=S;const cx=mc.getContext('2d');cx.drawImage(r.domElement,0,0);const d=cx.getImageData(0,0,S,S).data;mA=new Uint8Array(S*S);for(let i=0;i<S*S;i++)mA[i]=d[i*4]>128?1:0}
 finally{scene.environment=env;if(scene.overrideMaterial&&scene.overrideMaterial!==om)scene.overrideMaterial.dispose();scene.overrideMaterial=om;if(grid)grid.visible=true;dirty=true;lodOn=true}
 const iw=Math.min(R.img.width,256),ih2=Math.max(1,Math.round(iw*asp)),tc=document.createElement('canvas');tc.width=iw;tc.height=ih2;const tx=tc.getContext('2d');tx.drawImage(R.img,0,0,iw,ih2);
 const m0=maskFromData(tx.getImageData(0,0,iw,ih2).data,iw,ih2),id=tx.createImageData(iw,ih2);
 for(let i=0;i<iw*ih2;i++){id.data[i*4]=id.data[i*4+1]=id.data[i*4+2]=255;id.data[i*4+3]=m0[i]?255:0}tx.putImageData(id,0,0);
 const fc=document.createElement('canvas');fc.width=fc.height=S;const fx=fc.getContext('2d'),q=refRect(R,view,cu,cv,rad,S);fx.drawImage(tc,q.x,q.y,q.w,q.h);
 const d2=fx.getImageData(0,0,S,S).data,mB=new Uint8Array(S*S);for(let i=0;i<S*S;i++)mB[i]=d2[i*4+3]>128?1:0;
 const cm=cmpMasks(mA,mB,S),out=document.createElement('canvas');out.width=out.height=S;const ox=out.getContext('2d'),od=ox.createImageData(S,S);
 for(let i=0;i<S*S;i++){const a=mA[i],b=mB[i],c=a&&b?[230,230,230]:a?[255,60,60]:b?[60,120,255]:[20,20,20];od.data[i*4]=c[0];od.data[i*4+1]=c[1];od.data[i*4+2]=c[2];od.data[i*4+3]=255}ox.putImageData(od,0,0);
 return{text:hintOf(cm,ppm)+'. Красное только модель, синее только референс.',image:out.toDataURL('image/jpeg',.7).split(',')[1]}}
async function loadRef(q){
 if(q.clear){delete REF[q.view];dirty=true;return{text:'Референс '+q.view+' убран'}}
 if(!/^data:image\/(png|jpeg|webp|gif);base64,/.test(String(q.data||'')))return{error:'Референс — картинка data:image/png|jpeg|webp;base64,…'};   // site
 const img=new Image();await new Promise(ok=>{img.onload=ok;img.onerror=ok;img.src=q.data});if(!img.width)return{error:'Не удалось прочитать изображение'};
 const sc=Math.min(1,1024/Math.max(img.width,img.height)),cv=document.createElement('canvas');cv.width=Math.round(img.width*sc);cv.height=Math.round(img.height*sc);cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
 REF[q.view]={img:cv,w:q.width||1,u:q.u||0,v:q.v||0,op:q.opacity===undefined?.4:q.opacity};dirty=true;
 return{text:'Референс '+q.view+': ширина '+(q.width||1)+' м, центр ('+(q.u||0)+', '+(q.v||0)+'). Плоскости: front (x,y), side (z,y), top (x,z).'}}
function mirrorXf(o,ai,pl){const pos=[...o.pos];pos[ai]=2*pl-pos[ai];const r=o.rot||[0,0,0];return{pos,rot:ai===0?[r[0],-r[1],-r[2]]:ai===1?[-r[0],r[1],-r[2]]:[-r[0],-r[1],r[2]]}}
function mirrorSolve(k){const l=(k.swap||['_L','_R'])[0],r=(k.swap||['_L','_R'])[1],ai={x:0,y:1,z:2}[k.axis||'x'],pl=k.plane||0;let ch=false;
 state.forEach(a=>{if(!a.name.includes(l))return;const b=state.find(x=>x.name===a.name.replace(l,r));if(!b)return;const m=mirrorXf(a,ai,pl);
  if(m.pos.some((v,i)=>Math.abs(v-b.pos[i])>1e-4)||m.rot.some((v,i)=>Math.abs(v-(b.rot||[0,0,0])[i])>1e-3)){b.pos=m.pos;b.rot=m.rot;ch=true}});return ch}
const LAYERS={};let SOLO=null,NOTE='';
function layerOn(o){if(SOLO)return o.layer===SOLO;const l=o.layer&&LAYERS[o.layer];return !l||l.visible!==false}
function lockGuard(c){const W=['set','del','move','rotate','sculpt','paint','mask','subdiv','smooth','shape','mesh','bool','place','photo','clayer','parent','aim','clone','texture','uv'];if(!W.includes(c.op))return;
 const locked=x=>x.layer&&LAYERS[x.layer]&&LAYERS[x.layer].locked,bad=x=>{throw new Error('Слой «'+x.layer+'» заблокирован ('+x.name+'). Разблокируй: {op:"layer",name:"'+x.layer+'",locked:false}')};
 [c.name,c.a].filter(Boolean).forEach(n=>state.forEach(x=>{if(x.name===n&&locked(x))bad(x)}));
 if(c.prefix)state.forEach(x=>{if(x.name.startsWith(c.prefix)&&locked(x))bad(x)})}
function ensureColors(o){const m=o.size;if(!m.c){const b=new THREE.Color(o.color||'#b0b0b0');m.c=[];for(let i=0;i<m.v.length/3;i++)m.c.push(b.r,b.g,b.b)}return m}
function ensureLayer(m,name){m.L=m.L||[];let l=m.L.find(x=>x.n===name);if(!l){if(!m.c0)m.c0=m.c.slice();const n=m.v.length/3;l={n:name,c:new Array(n*3).fill(0),a:new Array(n).fill(0),op:1,on:true};m.L.push(l)}return l}
function composite(m){if(!m.L||!m.c0)return;const c=m.c0.slice(),n=m.v.length/3;
 m.L.forEach(l=>{if(!l.on||!l.op)return;for(let i=0;i<n;i++){const t=l.op*l.a[i];if(t<=0)continue;for(let k=0;k<3;k++)c[i*3+k]+=(l.c[i*3+k]-c[i*3+k])*t}});m.c=c.map(x=>+x.toFixed(3))}
function putColor(T,i,col,f){if(T.a&&T.a[i]===0){for(let k=0;k<3;k++)T.c[i*3+k]=+col[k].toFixed(3)}else for(let k=0;k<3;k++)T.c[i*3+k]=+(T.c[i*3+k]+(col[k]-T.c[i*3+k])*f).toFixed(3);if(T.a)T.a[i]=+(1-(1-T.a[i])*(1-f)).toFixed(3)}
function paintM(m,c,R,col,str,all,L){const v=m.v,n=v.length/3,T=L||{c:(m.L&&m.c0)?m.c0:m.c,a:null};
 for(let i=0;i<n;i++){let w=1;if(!all){const d=Math.hypot(v[i*3]-c[0],v[i*3+1]-c[1],v[i*3+2]-c[2]);w=d>=R?0:Math.pow(1-(d/R)*(d/R),2)}
  w*=1-(m.mk?m.mk[i]:0);if(!w)continue;putColor(T,i,col,Math.min(1,str*w))}
 if(!L&&m.L&&m.c0)composite(m)}
function sampleRGB(px,u,v){const w=px.w,h=px.h,x=Math.min(w-1.001,Math.max(0,u*w-.5)),y=Math.min(h-1.001,Math.max(0,v*h-.5)),x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,d=px.d,g=(a,b,k)=>d[(b*w+a)*4+k];
 return[0,1,2].map(k=>(g(x0,y0,k)*(1-fx)*(1-fy)+g(x0+1,y0,k)*fx*(1-fy)+g(x0,y0+1,k)*(1-fx)*fy+g(x0+1,y0+1,k)*fx*fy)/255)}
function avgEdge(m){let s=0,n=0;for(let i=0;i<m.f.length&&n<4500;i+=3)for(let k=0;k<3;k++){const a=m.f[i+k]*3,b=m.f[i+(k+1)%3]*3;s+=Math.hypot(m.v[a]-m.v[b],m.v[a+1]-m.v[b+1],m.v[a+2]-m.v[b+2]);n++}return n?s/n:0}
function bakePhoto(o,R,view,opt,L){
 const m=o.size,n=m.v.length/3,q=qE(o.rot),sc=o.scale||1,N=normM(m),dir=view==='side'?[1,0,0]:view==='top'?[0,1,0]:[0,0,1],hw=R.w,hh=R.w*R.px.h/R.px.w;
 const pw=opt.power||1.5,thr=opt.min===undefined?.15:opt.min,str=opt.strength===undefined?1:opt.strength,sx=view==='side'?-1:1,sy=view==='top'?-1:1,T=L||{c:(m.L&&m.c0)?m.c0:m.c,a:null};let hit=0;
 for(let i=0;i<n;i++){
  const p=new THREE.Vector3(m.v[i*3],m.v[i*3+1],m.v[i*3+2]).multiplyScalar(sc).applyQuaternion(q).add(new THREE.Vector3(...o.pos)),
   nn=new THREE.Vector3(N[i*3],N[i*3+1],N[i*3+2]).applyQuaternion(q),face=nn.x*dir[0]+nn.y*dir[1]+nn.z*dir[2];
  if(face<thr)continue;
  let hu=view==='side'?p.z:p.x;const vv=view==='top'?p.z:p.y;
  if(opt.fold){const a=opt.plane||0;hu=opt.fold==='+'?a+Math.abs(hu-a):a-Math.abs(hu-a)}
  const u=.5+sx*(hu-R.u)/hw,vt=.5-sy*(vv-R.v)/hh;if(u<0||u>1||vt<0||vt>1)continue;
  const xi=Math.min(R.px.w-1,Math.floor(u*R.px.w)),yi=Math.min(R.px.h-1,Math.floor(vt*R.px.h));if(R.px.d[(yi*R.px.w+xi)*4+3]<128)continue;
  const f=Math.min(1,str*Math.pow(face,pw)*(1-(m.mk?m.mk[i]:0)));if(f<=0)continue;
  putColor(T,i,sampleRGB(R.px,u,vt),f);hit++}
 return hit}
const TEXS={};let TID=0;
function appendVert(m,i){const idx=m.v.length/3,cp=(a,k)=>{for(let j=0;j<k;j++)a.push(a[i*k+j])};cp(m.v,3);if(m.c)cp(m.c,3);if(m.c0)cp(m.c0,3);if(m.mk)m.mk.push(m.mk[i]);if(m.uv)cp(m.uv,2);if(m.b)cp(m.b,3);if(m.sk)Object.values(m.sk).forEach(a=>cp(a,3));(m.L||[]).forEach(l=>{cp(l.c,3);l.a.push(l.a[i])});return idx}
function uvGen(o,mode,opt){
 const m=o.size,n=m.v.length/3,q=qE(o.rot),sc=o.scale||1,P=[];
 for(let i=0;i<n;i++){const p=new THREE.Vector3(m.v[i*3],m.v[i*3+1],m.v[i*3+2]).multiplyScalar(sc).applyQuaternion(q).add(new THREE.Vector3(...o.pos));P.push(p.x,p.y,p.z)}
 const mm=(a,k)=>{let lo=1e30,hi=-1e30;for(let i=0;i<n;i++){const x=a(i);if(x<lo)lo=x;if(x>hi)hi=x}return[lo,hi]};
 if(mode==='planar'){
  const view=opt.view||'front',pl=opt.plane||0,fo=opt.fold;
  const fu=i=>{let x=view==='side'?-P[i*3+2]:P[i*3];if(fo){x=view==='side'?-x:x;x=fo==='+'?pl+Math.abs(x-pl):pl-Math.abs(x-pl);x=view==='side'?-x:x}return x},fv=i=>view==='top'?-P[i*3+2]:P[i*3+1];
  const[ul,uh]=mm(fu),[vl,vh]=mm(fv),s=Math.max(uh-ul,vh-vl)||1;m.uv=[];
  for(let i=0;i<n;i++)m.uv.push(+(.01+.98*(fu(i)-ul)/s).toFixed(5),+(.01+.98*(fv(i)-vl)/s).toFixed(5));
  return m.uv}
 if(mode==='cylinder'||mode==='sphere'){
  const[xl,xh]=mm(i=>P[i*3]),[zl,zh]=mm(i=>P[i*3+2]),[yl,yh]=mm(i=>P[i*3+1]),cx=(xl+xh)/2,cz=(zl+zh)/2,cy=(yl+yh)/2,H=yh-yl||1,rr=Math.max(xh-xl,zh-zl)/2||1;m.uv=[];const pole=new Set();
  for(let i=0;i<n;i++){const dx=P[i*3]-cx,dz=P[i*3+2]-cz,dy=P[i*3+1]-cy;if(mode==='sphere'&&Math.hypot(dx,dz)<1e-3*rr)pole.add(i);
   m.uv.push(+(Math.atan2(dx,dz)/(2*Math.PI)+.5).toFixed(5),+(mode==='cylinder'?.01+.98*(P[i*3+1]-yl)/H:.01+.98*(.5+Math.asin(Math.max(-1,Math.min(1,dy/(Math.hypot(dx,dy,dz)||1))))/Math.PI)).toFixed(5))}
  if(pole.size)for(let t=0;t<m.f.length;t+=3)for(let k=0;k<3;k++){const id=m.f[t+k];if(!pole.has(id))continue;let a=m.uv[m.f[t+(k+1)%3]*2],b=m.uv[m.f[t+(k+2)%3]*2];if(Math.abs(a-b)>.5){if(a<b)a+=1;else b+=1}const dI=appendVert(m,id);m.uv[dI*2]=(a+b)/2;m.f[t+k]=dI}
  const dup=new Map();
  for(let t=0;t<m.f.length;t+=3){const ids=[m.f[t],m.f[t+1],m.f[t+2]],us=ids.map(i=>m.uv[i*2]);
   if(Math.max(...us)-Math.min(...us)>.5)for(let k=0;k<3;k++)if(us[k]<.5){let d=dup.get(ids[k]);if(d===undefined){d=appendVert(m,ids[k]);m.uv[d*2]+=1;dup.set(ids[k],d)}m.f[t+k]=d}}
  return m.uv}
 throw new Error('uv mode: planar, cylinder, sphere')}
function bakeUVTex(o,R,view,opt,T){
 const m=o.size,uv=m.uv;if(!uv)throw new Error('нет UV: сначала {op:"uv",name,mode}');
 const n=m.v.length/3,q=qE(o.rot),sc=o.scale||1,N=normM(m),Wp=[],Wn=[];
 for(let i=0;i<n;i++){const p=new THREE.Vector3(m.v[i*3],m.v[i*3+1],m.v[i*3+2]).multiplyScalar(sc).applyQuaternion(q).add(new THREE.Vector3(...o.pos)),nn=new THREE.Vector3(N[i*3],N[i*3+1],N[i*3+2]).applyQuaternion(q);Wp.push(p.x,p.y,p.z);Wn.push(nn.x,nn.y,nn.z)}
 const dir=view==='side'?[1,0,0]:view==='top'?[0,1,0]:[0,0,1],hw=R.w,hh=R.w*R.px.h/R.px.w,sx=view==='side'?-1:1,sy=view==='top'?-1:1,pw=opt.power||1.5,thr=opt.min===undefined?.15:opt.min,str=opt.strength===undefined?1:opt.strength,{w,h,d,cov}=T;let hit=0;
 for(let t=0;t<m.f.length;t+=3){
  const I=[m.f[t],m.f[t+1],m.f[t+2]],X=I.map(i=>uv[i*2]*w),Y=I.map(i=>(1-uv[i*2+1])*h),den=(Y[1]-Y[2])*(X[0]-X[2])+(X[2]-X[1])*(Y[0]-Y[2]);if(Math.abs(den)<1e-9)continue;
  const x0=Math.floor(Math.min(...X)),x1=Math.ceil(Math.max(...X)),y0=Math.max(0,Math.floor(Math.min(...Y))),y1=Math.min(h-1,Math.ceil(Math.max(...Y)));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const px=x+.5,py=y+.5,l0=((Y[1]-Y[2])*(px-X[2])+(X[2]-X[1])*(py-Y[2]))/den,l1=((Y[2]-Y[0])*(px-X[2])+(X[0]-X[2])*(py-Y[2]))/den,l2=1-l0-l1;if(l0<-.02||l1<-.02||l2<-.02)continue;
   const P=[0,1,2].map(k=>Wp[I[0]*3+k]*l0+Wp[I[1]*3+k]*l1+Wp[I[2]*3+k]*l2),Nn=[0,1,2].map(k=>Wn[I[0]*3+k]*l0+Wn[I[1]*3+k]*l1+Wn[I[2]*3+k]*l2),face=(Nn[0]*dir[0]+Nn[1]*dir[1]+Nn[2]*dir[2])/(Math.hypot(...Nn)||1);if(face<thr)continue;
   let hu=view==='side'?P[2]:P[0];const vv=view==='top'?P[2]:P[1];if(opt.fold){const a=opt.plane||0;hu=opt.fold==='+'?a+Math.abs(hu-a):a-Math.abs(hu-a)}
   const u=.5+sx*(hu-R.u)/hw,vt=.5-sy*(vv-R.v)/hh;if(u<0||u>1||vt<0||vt>1)continue;
   const xi=Math.min(R.px.w-1,Math.floor(u*R.px.w)),yi=Math.min(R.px.h-1,Math.floor(vt*R.px.h));if(R.px.d[(yi*R.px.w+xi)*4+3]<128)continue;
   const col=sampleRGB(R.px,u,vt),f=Math.min(1,str*Math.pow(face,pw)),ti=y*w+(((x%w)+w)%w);
   if(cov[ti]===0){for(let k=0;k<3;k++)d[ti*4+k]=col[k]*255}else for(let k=0;k<3;k++)d[ti*4+k]+=(col[k]*255-d[ti*4+k])*f;
   cov[ti]=1-(1-cov[ti])*(1-f);hit++}}
 return hit}
function dilateInto(dd,cov,w,h,passes){const fl=new Uint8Array(w*h);for(let i=0;i<w*h;i++)fl[i]=cov[i]>0?1:0;
 for(let p=0;p<passes;p++){const add=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(fl[i])continue;
  for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const yy=y+dy;if(yy<0||yy>=h)continue;const j=yy*w+((x+dx+w)%w);if(fl[j]){add.push(i,j);break}}}
  for(let k=0;k<add.length;k+=2){const i=add[k],j=add[k+1];for(let c=0;c<3;c++)dd[i*4+c]=dd[j*4+c];fl[i]=1}}}
function getTex(o,size){let id=o.texid;if(id&&TEXS[id]&&TEXS[id].w===size)return TEXS[id];
 id=id||('t'+Date.now().toString(36)+(++TID));const w=size,d=new Uint8ClampedArray(w*w*4),b=new THREE.Color(o.color||'#b0b0b0');
 for(let i=0;i<w*w;i++){d[i*4]=b.r*255;d[i*4+1]=b.g*255;d[i*4+2]=b.b*255;d[i*4+3]=255}
 const cv=document.createElement('canvas');cv.width=w;cv.height=w;const tex=new THREE.CanvasTexture(cv);tex.wrapS=THREE.RepeatWrapping;
 TEXS[id]={w,h:w,d,cov:new Float32Array(w*w),cv,tex};o.texid=id;return TEXS[id]}
function syncTex(T){const dd=T.d.slice();dilateInto(dd,T.cov,T.w,T.h,2);T.cv.getContext('2d').putImageData(new ImageData(dd,T.w,T.h),0,0);T.tex.needsUpdate=true}
function loadTex(id,url){if(!/^data:image\/(png|jpeg|webp|gif);base64,/.test(String(url||'')))return;   // site: only pictures saved inside the scene
 const img=new Image();img.onload=()=>{const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const x=cv.getContext('2d');x.drawImage(img,0,0);
 const t=new THREE.CanvasTexture(cv);t.wrapS=THREE.RepeatWrapping;TEXS[id]={w:img.width,h:img.height,d:x.getImageData(0,0,img.width,img.height).data.slice(),cov:new Float32Array(img.width*img.height).fill(1),cv,tex:t};build()};img.src=url}
function refPx(R){if(!R.px){const cx=R.img.getContext('2d');R.px={d:cx.getImageData(0,0,R.img.width,R.img.height).data,w:R.img.width,h:R.img.height}}return R.px}
function decArr(P,I,C,cells,U){const n=P.length/3,mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(let i=0;i<n;i++)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],P[i*3+k]);mx[k]=Math.max(mx[k],P[i*3+k])}
 const h=Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])/cells||1e-3,map=new Map(),np=[],nc=[],nu=[],cnt=[],rem=new Array(n);
 for(let i=0;i<n;i++){const k=Math.floor((P[i*3]-mn[0])/h)+','+Math.floor((P[i*3+1]-mn[1])/h)+','+Math.floor((P[i*3+2]-mn[2])/h)+(U?','+Math.floor(U[i*2]*16)+','+Math.floor(U[i*2+1]*16):'');let r=map.get(k);
  if(r===undefined){r=cnt.length;map.set(k,r);cnt.push(0);np.push(0,0,0);if(C)nc.push(0,0,0);if(U)nu.push(0,0)}
  for(let q=0;q<3;q++){np[r*3+q]+=P[i*3+q];if(C)nc[r*3+q]+=C[i*3+q]}if(U){nu[r*2]+=U[i*2];nu[r*2+1]+=U[i*2+1]}cnt[r]++;rem[i]=r}
 for(let r=0;r<cnt.length;r++){for(let q=0;q<3;q++){np[r*3+q]/=cnt[r];if(C)nc[r*3+q]/=cnt[r]}if(U){nu[r*2]/=cnt[r];nu[r*2+1]/=cnt[r]}}
 const ni=[];for(let i=0;i<I.length;i+=3){const a=rem[I[i]],b=rem[I[i+1]],c=rem[I[i+2]];if(a!==b&&b!==c&&a!==c)ni.push(a,b,c)}
 return{P:np,I:ni,C:C?nc:null,U:U?nu:null}}
function decimate(g,cells){const p=g.attributes.position,col=g.attributes.color,uvA=g.attributes.uv,P=Array.from(p.array),I=g.index?Array.from(g.index.array):Array.from({length:p.count},(_,i)=>i),C=col?Array.from(col.array):null,U=uvA?Array.from(uvA.array):null,r=decArr(P,I,C,cells,U),o=new THREE.BufferGeometry();
 o.setAttribute('position',new THREE.Float32BufferAttribute(r.P,3));if(r.C)o.setAttribute('color',new THREE.Float32BufferAttribute(r.C,3));if(r.U)o.setAttribute('uv',new THREE.Float32BufferAttribute(r.U,2));o.setIndex(r.I);o.computeVertexNormals();return o}
function nearIdx(m,A0){
 const s=A0.scale||1,q=qE(A0.rot),a=A0.size,n=a.v.length/3,W=[];
 for(let i=0;i<n;i++){const t=new THREE.Vector3(a.v[i*3],a.v[i*3+1],a.v[i*3+2]).multiplyScalar(s).applyQuaternion(q).add(new THREE.Vector3(...A0.pos));W.push(t.x,t.y,t.z)}
 const mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(let i=0;i<n;i++)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],W[i*3+k]);mx[k]=Math.max(mx[k],W[i*3+k])}
 const h=Math.max(Math.cbrt((mx[0]-mn[0]+1e-3)*(mx[1]-mn[1]+1e-3)*(mx[2]-mn[2]+1e-3)/n)*2,1e-3),G=new Map(),ck=(x,y,z)=>x+','+y+','+z,cell=(p,k)=>Math.floor((p-mn[k])/h);
 for(let i=0;i<n;i++){const k=ck(cell(W[i*3],0),cell(W[i*3+1],1),cell(W[i*3+2],2));if(!G.has(k))G.set(k,[]);G.get(k).push(i)}
 const out=[],nv=m.v.length/3,d2=(j,x,y,z)=>(W[j*3]-x)**2+(W[j*3+1]-y)**2+(W[j*3+2]-z)**2;
 for(let i=0;i<nv;i++){const x=m.v[i*3],y=m.v[i*3+1],z=m.v[i*3+2],cx=cell(x,0),cy=cell(y,1),cz=cell(z,2);let best=-1,bd=1e30;
  for(let r=1;r<=3&&best<0;r++)for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++)for(let dz=-r;dz<=r;dz++){const L=G.get(ck(cx+dx,cy+dy,cz+dz));if(L)L.forEach(j=>{const d=d2(j,x,y,z);if(d<bd){bd=d;best=j}})}
  if(best<0)for(let j=0;j<n;j++){const d=d2(j,x,y,z);if(d<bd){bd=d;best=j}}
  out.push(best)}
 return out}
function nearColors(m,A0){const a=A0.size,out=[];nearIdx(m,A0).forEach(j=>out.push(a.c[j*3],a.c[j*3+1],a.c[j*3+2]));return out}
function paintUVTex(o,T,C,Rr,col,str,all){
 const m=o.size,uv=m.uv,n=m.v.length/3,q=qE(o.rot),sc=o.scale||1,Wp=[];
 for(let i=0;i<n;i++){const p=new THREE.Vector3(m.v[i*3],m.v[i*3+1],m.v[i*3+2]).multiplyScalar(sc).applyQuaternion(q).add(new THREE.Vector3(...o.pos));Wp.push(p.x,p.y,p.z)}
 const{w,h,d,cov}=T;let hit=0;
 for(let t=0;t<m.f.length;t+=3){
  const I=[m.f[t],m.f[t+1],m.f[t+2]];
  if(!all){const cx=(Wp[I[0]*3]+Wp[I[1]*3]+Wp[I[2]*3])/3,cy=(Wp[I[0]*3+1]+Wp[I[1]*3+1]+Wp[I[2]*3+1])/3,cz=(Wp[I[0]*3+2]+Wp[I[1]*3+2]+Wp[I[2]*3+2])/3;let rm=0;for(let k=0;k<3;k++)rm=Math.max(rm,Math.hypot(Wp[I[k]*3]-cx,Wp[I[k]*3+1]-cy,Wp[I[k]*3+2]-cz));if(Math.hypot(cx-C[0],cy-C[1],cz-C[2])-rm>Rr)continue}
  const X=I.map(i=>uv[i*2]*w),Y=I.map(i=>(1-uv[i*2+1])*h),den=(Y[1]-Y[2])*(X[0]-X[2])+(X[2]-X[1])*(Y[0]-Y[2]);if(Math.abs(den)<1e-9)continue;
  const x0=Math.floor(Math.min(...X)),x1=Math.ceil(Math.max(...X)),y0=Math.max(0,Math.floor(Math.min(...Y))),y1=Math.min(h-1,Math.ceil(Math.max(...Y)));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const px=x+.5,py=y+.5,l0=((Y[1]-Y[2])*(px-X[2])+(X[2]-X[1])*(py-Y[2]))/den,l1=((Y[2]-Y[0])*(px-X[2])+(X[0]-X[2])*(py-Y[2]))/den,l2=1-l0-l1;if(l0<-.02||l1<-.02||l2<-.02)continue;
   let wgt=1;if(!all){const P=[0,1,2].map(k=>Wp[I[0]*3+k]*l0+Wp[I[1]*3+k]*l1+Wp[I[2]*3+k]*l2),dd=Math.hypot(P[0]-C[0],P[1]-C[1],P[2]-C[2]);if(dd>=Rr)continue;wgt=Math.pow(1-(dd/Rr)*(dd/Rr),2)}
   if(m.mk)wgt*=1-(m.mk[I[0]]*l0+m.mk[I[1]]*l1+m.mk[I[2]]*l2);
   const f=Math.min(1,str*wgt);if(f<=0)continue;const ti=y*w+(((x%w)+w)%w);for(let k=0;k<3;k++)d[ti*4+k]+=(col[k]*255-d[ti*4+k])*f;cov[ti]=1-(1-cov[ti])*(1-f);hit++}}
 return hit}
const VT={front:{d:[0,0,1],h:0,hs:1,v:1,vs:1},back:{d:[0,0,-1],h:0,hs:-1,v:1,vs:1},side:{d:[1,0,0],h:2,hs:-1,v:1,vs:1},left:{d:[-1,0,0],h:2,hs:1,v:1,vs:1},top:{d:[0,1,0],h:0,hs:1,v:2,vs:-1},bottom:{d:[0,-1,0],h:0,hs:1,v:2,vs:1}};
function viewSample(R,view,opt,P,Nn){const T=VT[view];if(!T)throw new Error('вид '+view+': front, back, side, left, top, bottom');
 const face=Nn[0]*T.d[0]+Nn[1]*T.d[1]+Nn[2]*T.d[2],thr=opt.min===undefined?.15:opt.min;if(face<thr)return null;
 let hu=P[T.h];if(opt.fold){const a=opt.plane||0;hu=opt.fold==='+'?a+Math.abs(hu-a):a-Math.abs(hu-a)}
 const hw=R.w,hh=R.w*R.px.h/R.px.w,u=.5+T.hs*(hu-R.u)/hw,vt=.5-T.vs*(P[T.v]-R.v)/hh;if(u<0||u>1||vt<0||vt>1)return null;
 const xi=Math.min(R.px.w-1,Math.floor(u*R.px.w)),yi=Math.min(R.px.h-1,Math.floor(vt*R.px.h));if(R.px.d[(yi*R.px.w+xi)*4+3]<128)return null;
 const s=(face-thr)/(1-thr);return{c:sampleRGB(R.px,u,vt),w:Math.pow(s*s*(3-2*s),opt.power||1)+1e-4}}
function mkStitch(n){return{n,sr:Array.from({length:n},()=>[0,0,0]),sk:Array.from({length:n},()=>[0,0,0]),cnt:new Array(n).fill(0),g:null}}
function stitchStat(S,smp){const r=smp[0];if(!r||r.w<.25)return;for(let k=1;k<S.n;k++){const s=smp[k];if(!s||s.w<.25)continue;for(let c=0;c<3;c++){S.sr[k][c]+=r.c[c];S.sk[k][c]+=s.c[c]}S.cnt[k]++}}
function stitchGains(S,opt){S.g=Array.from({length:S.n},(_,k)=>(k===0||opt.match===false||S.cnt[k]<3)?[1,1,1]:S.sr[k].map((v,c)=>Math.max(.6,Math.min(1.6,v/(S.sk[k][c]||1)))));return S.g}
function stitchBlend(S,smp){let W=0;const c=[0,0,0];for(let k=0;k<S.n;k++){const s=smp[k];if(!s)continue;W+=s.w;for(let q=0;q<3;q++)c[q]+=Math.min(1,s.c[q]*S.g[k][q])*s.w}return W>0?{c:c.map(x=>x/W),w:Math.min(1,W)}:null}
function bakeMultiVerts(o,refs,opt,L){
 const m=o.size,n=m.v.length/3,q=qE(o.rot),sc=o.scale||1,N=normM(m),str=opt.strength===undefined?1:opt.strength,T=L||{c:(m.L&&m.c0)?m.c0:m.c,a:null};
 const smp=i=>{const P=new THREE.Vector3(m.v[i*3],m.v[i*3+1],m.v[i*3+2]).multiplyScalar(sc).applyQuaternion(q).add(new THREE.Vector3(...o.pos)).toArray(),Nn=new THREE.Vector3(N[i*3],N[i*3+1],N[i*3+2]).applyQuaternion(q).toArray();return refs.map(r=>viewSample(r.R,r.view,opt,P,Nn))};
 const S=mkStitch(refs.length);for(let i=0;i<n;i++)stitchStat(S,smp(i));stitchGains(S,opt);
 let hit=0;for(let i=0;i<n;i++){const b=stitchBlend(S,smp(i));if(!b)continue;const f=Math.min(1,str*b.w*(1-(m.mk?m.mk[i]:0)));if(f<=0)continue;putColor(T,i,b.c,f);hit++}
 return{hit,g:S.g}}
function bakeUVMulti(o,refs,opt,T){
 const m=o.size,uv=m.uv;if(!uv)throw new Error('нет UV: сначала {op:"uv",name,mode}');
 const n=m.v.length/3,q=qE(o.rot),sc=o.scale||1,N=normM(m),Wp=[],Wn=[],str=opt.strength===undefined?1:opt.strength,{w,h,d,cov}=T;
 for(let i=0;i<n;i++){const p=new THREE.Vector3(m.v[i*3],m.v[i*3+1],m.v[i*3+2]).multiplyScalar(sc).applyQuaternion(q).add(new THREE.Vector3(...o.pos)),nn=new THREE.Vector3(N[i*3],N[i*3+1],N[i*3+2]).applyQuaternion(q);Wp.push(p.x,p.y,p.z);Wn.push(nn.x,nn.y,nn.z)}
 const scan=cb=>{for(let t=0;t<m.f.length;t+=3){const I=[m.f[t],m.f[t+1],m.f[t+2]],X=I.map(i=>uv[i*2]*w),Y=I.map(i=>(1-uv[i*2+1])*h),den=(Y[1]-Y[2])*(X[0]-X[2])+(X[2]-X[1])*(Y[0]-Y[2]);if(Math.abs(den)<1e-9)continue;
  const x0=Math.floor(Math.min(...X)),x1=Math.ceil(Math.max(...X)),y0=Math.max(0,Math.floor(Math.min(...Y))),y1=Math.min(h-1,Math.ceil(Math.max(...Y)));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=x+.5,py=y+.5,l0=((Y[1]-Y[2])*(px-X[2])+(X[2]-X[1])*(py-Y[2]))/den,l1=((Y[2]-Y[0])*(px-X[2])+(X[0]-X[2])*(py-Y[2]))/den,l2=1-l0-l1;if(l0<-.02||l1<-.02||l2<-.02)continue;
   const P=[0,1,2].map(k=>Wp[I[0]*3+k]*l0+Wp[I[1]*3+k]*l1+Wp[I[2]*3+k]*l2),Nn=[0,1,2].map(k=>Wn[I[0]*3+k]*l0+Wn[I[1]*3+k]*l1+Wn[I[2]*3+k]*l2),nl=Math.hypot(...Nn)||1;cb(y*w+(((x%w)+w)%w),P,Nn.map(v=>v/nl))}}};
 const smp=(P,Nn)=>refs.map(r=>viewSample(r.R,r.view,opt,P,Nn)),S=mkStitch(refs.length);
 scan((ti,P,Nn)=>{if(ti%3===0)stitchStat(S,smp(P,Nn))});stitchGains(S,opt);
 let hit=0;scan((ti,P,Nn)=>{const b=stitchBlend(S,smp(P,Nn));if(!b)return;const f=Math.min(1,str*b.w);
  if(cov[ti]===0){for(let k=0;k<3;k++)d[ti*4+k]=b.c[k]*255}else for(let k=0;k<3;k++)d[ti*4+k]+=(b.c[k]*255-d[ti*4+k])*f;cov[ti]=1-(1-cov[ti])*(1-f);hit++});
 return{hit,g:S.g}}
function simAABB(B,S,o){
 const dt=o.dt||1/60,g=o.g===undefined?-9.8:o.g,rest=o.rest===undefined?.2:o.rest,fric=o.fric===undefined?.5:o.fric,every=o.every||0,steps=Math.min(Math.ceil((o.time||2)/dt),2400),floorY=o.floorY||0,useFloor=o.floor!==false;
 const off=B.map(()=>[0,0,0]),Q=B.map(()=>[0,0,0,1]),fr=()=>({off:off.map(a=>a.slice()),rot:Q.map(a=>a.slice())}),frames=[{t:0,...fr()}];B.forEach(b=>{b.w=[0,0,0]});let calm=0,last=0,t=0,s=0;
 const shift=(b,i,k,a)=>{b.min[k]+=a;b.max[k]+=a;off[i][k]+=a};
 const hit=(b,c)=>{let best=null;for(let k=0;k<3;k++){const sg=b.pc[k]>=(c.min[k]+c.max[k])/2?1:-1,pen=sg>0?c.max[k]-b.min[k]:b.max[k]-c.min[k],ov=Math.min(b.max[k],c.max[k])-Math.max(b.min[k],c.min[k]);if(ov<=1e-7)return null;if(!best||pen<best.pen)best={k,pen,sg}}return best};
 const bounce=(v,sg)=>{if(v*sg>=0)return v;const r=-v*rest;return Math.abs(r)<.3?0:r};
 for(s=0;s<steps;s++){t=(s+1)*dt;
  B.forEach((b,i)=>{b.pc=[0,1,2].map(k=>(b.min[k]+b.max[k])/2);b.vel[1]+=g*dt;for(let k=0;k<3;k++){const d=b.vel[k]*dt;b.min[k]+=d;b.max[k]+=d;off[i][k]+=d}b.on=null;b.gr=false;b.sup=null});
  for(let it=0;it<4;it++)B.forEach((b,i)=>{
   if(useFloor&&b.min[1]<floorY){shift(b,i,1,floorY-b.min[1]);b.vel[1]=bounce(b.vel[1],1);b.vel[0]*=1-(b.r?.02:fric*.3);b.vel[2]*=1-(b.r?.02:fric*.3);b.on='пол';b.gr=true}
   S.map(c=>({c,j:-1})).concat(B.map((c,j)=>({c,j})).filter(x=>x.j!==i)).forEach(({c,j})=>{const h=hit(b,c);if(!h)return;
    if(j<0){shift(b,i,h.k,h.pen*h.sg);b.vel[h.k]=bounce(b.vel[h.k],h.sg);b.on=c.name}
    else{shift(b,i,h.k,h.pen*h.sg/2);shift(c,j,h.k,-h.pen*h.sg/2);const mv=(b.vel[h.k]+c.vel[h.k])/2;b.vel[h.k]=mv;c.vel[h.k]=mv;b.on=c.name||'тело'}
    if(h.k===1&&h.sg===1){b.gr=true;b.sup=c;b.vel[0]*=1-(b.r?.02:fric*.3);b.vel[2]*=1-(b.r?.02:fric*.3)}})});
  B.forEach((b,i)=>{if(!b.tip||!b.sup||(b.tips||0)>=3||Math.hypot(b.vel[0],b.vel[1],b.vel[2])>.6)return;const sp=b.sup,cx=(b.min[0]+b.max[0])/2,cz=(b.min[2]+b.max[2])/2,ox=cx<sp.min[0]?sp.min[0]-cx:cx>sp.max[0]?cx-sp.max[0]:0,oz=cz<sp.min[2]?sp.min[2]-cz:cz>sp.max[2]?cz-sp.max[2]:0;if(Math.max(ox,oz)<1e-3)return;
   const k=ox>=oz?0:2,dir=k===0?(cx>sp.max[0]?1:-1):(cz>sp.max[2]?1:-1),e=dir>0?sp.max[k]:sp.min[k],c0=[0,1,2].map(q=>(b.min[q]+b.max[q])/2),h0=[0,1,2].map(q=>(b.max[q]-b.min[q])/2),yb=b.min[1],dxo=Math.abs(c0[k]-e),nc=c0.slice(),nh=h0.slice();nc[k]=e+dir*h0[1];nc[1]=yb-dxo;nh[k]=h0[1];nh[1]=h0[k];
   for(let q=0;q<3;q++){b.min[q]=nc[q]-nh[q];b.max[q]=nc[q]+nh[q];off[i][q]+=nc[q]-c0[q]}Q[i]=qMul(qAxis(k===0?[0,0,1]:[1,0,0],(k===0?-90:90)*dir),Q[i]);b.vel=[k===0?dir*.3:0,0,k===2?dir*.3:0];b.tips=(b.tips||0)+1;b.sup=null});
  B.forEach((b,i)=>{if(!b.r)return;if(b.gr)b.w=[b.vel[2]/b.r,0,-b.vel[0]/b.r];const an=Math.hypot(...b.w)*dt;if(an<1e-9)return;const u=b.w.map(v=>v/Math.hypot(...b.w)),sn=Math.sin(an/2),d=[u[0]*sn,u[1]*sn,u[2]*sn,Math.cos(an/2)],q=Q[i];
   Q[i]=[d[3]*q[0]+d[0]*q[3]+d[1]*q[2]-d[2]*q[1],d[3]*q[1]+d[1]*q[3]+d[2]*q[0]-d[0]*q[2],d[3]*q[2]+d[2]*q[3]+d[0]*q[1]-d[1]*q[0],d[3]*q[3]-d[0]*q[0]-d[1]*q[1]-d[2]*q[2]]});
  if(every&&t-last>=every-1e-9){frames.push({t:+t.toFixed(4),...fr()});last=t}
  const sp=Math.max(0,...B.map(b=>Math.hypot(...b.vel)));calm=sp<.25?calm+1:0;if(calm>20)break}
 frames.push({t:+((s+1)*dt).toFixed(4),...fr()});
 return{off,rot:Q,frames,steps:s+1,on:B.map(b=>b.on)}}
function spinRot(rot,q){const R=new THREE.Quaternion(q[0],q[1],q[2],q[3]).multiply(qE(rot)),e=new THREE.Euler().setFromQuaternion(R);return[e.x,e.y,e.z].map(a=>+(a*180/Math.PI).toFixed(3))}
// ===== растительность, волосы, одежда (чистые функции, без DOM) =====
function rng(seed){let a=(seed|0)||1;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
function hexRGB(h){const n=parseInt(String(h||'#808080').replace('#',''),16)||0;return[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255]}
function vA(a,b,s){s=s===undefined?1:s;return[a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s]}
function vC(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function vN(a){const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]}
function mbNew(){return{v:[],f:[],c:[],uv:[]}}
function ringTube(M,P,Rr,c0,c1,S){
 const n=P.length,base=M.v.length/3;let len=0,u=null;
 for(let i=0;i<n;i++){
  const a=P[Math.max(i-1,0)],b=P[Math.min(i+1,n-1)],t=vN([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);
  if(!u)u=vN(vC(t,Math.abs(t[1])>.9?[1,0,0]:[0,1,0]));else{u=vN(vA(u,t,-(u[0]*t[0]+u[1]*t[1]+u[2]*t[2])))}
  const w=vC(t,u);if(i)len+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1],P[i][2]-P[i-1][2]);
  const k=n>1?i/(n-1):0,col=[0,1,2].map(q=>c0[q]+(c1[q]-c0[q])*k);
  for(let j=0;j<=S;j++){const th=j/S*Math.PI*2,co=Math.cos(th)*Rr[i],si=Math.sin(th)*Rr[i];M.v.push(P[i][0]+co*u[0]+si*w[0],P[i][1]+co*u[1]+si*w[1],P[i][2]+co*u[2]+si*w[2]);M.c.push(col[0],col[1],col[2]);M.uv.push(j/S,len)}}
 for(let i=0;i<n-1;i++)for(let j=0;j<S;j++){const a=base+i*(S+1)+j,b=a+1,c=a+S+1,d=c+1;M.f.push(a,c,b,b,c,d)}
 const e=P[n-1],ap=M.v.length/3,lc=base+(n-1)*(S+1);M.v.push(e[0],e[1],e[2]);M.c.push(c1[0],c1[1],c1[2]);M.uv.push(.5,len);
 for(let j=0;j<S;j++)M.f.push(lc+j,ap,lc+j+1)}
// лист: основание b, ось u (к кончику), ширина вдоль s; 6 вершин, 4 треугольника
function leafAt(M,b,u,s,w,h,col){const base=M.v.length/3,sh=[[0,0],[-1,.35],[-.6,.8],[0,1],[.6,.8],[1,.35]];
 sh.forEach(([x,y])=>{M.v.push(b[0]+s[0]*x*w+u[0]*y*h,b[1]+s[1]*x*w+u[1]*y*h,b[2]+s[2]*x*w+u[2]*y*h);M.c.push(col[0],col[1],col[2]);M.uv.push(.5+x*.5,y)});
 M.f.push(base,base+1,base+2,base,base+2,base+3,base,base+3,base+4,base,base+4,base+5)}
function treeGen(o){
 o=o||{};const sp=o.species||'oak',R=rng(o.seed||1),H=o.height||5,
 P0={oak:{lv:3,tr:.035,bare:.35,n:[7,5,4],ang:[55,45,40],len:[.5,.5,.5],tp:.15,ls:.07,lc:4,tl:.65},
  pine:{lv:2,tr:.028,bare:.12,n:[26,4],ang:[85,60],len:[.3,.4],tp:-.18,ls:.05,lc:3,tl:.95},
  birch:{lv:3,tr:.02,bare:.3,n:[6,4,3],ang:[30,30,30],len:[.5,.5,.5],tp:.2,ls:.045,lc:4,tl:.8},
  bush:{lv:2,tr:.018,bare:.05,n:[9,5],ang:[50,45],len:[.75,.6],tp:.05,ls:.09,lc:5,tl:.55},
  dead:{lv:3,tr:.035,bare:.3,n:[6,5,4],ang:[50,45,40],len:[.6,.55,.5],tp:.05,ls:0,lc:0,tl:.8},
  palm:{lv:0,tr:.03,bare:0,n:[],ang:[],len:[],tp:0,ls:.05,lc:0,tl:1}}[sp];
 if(!P0)throw new Error('tree: species = oak, pine, birch, palm, bush, dead');
 const M=mbNew(),bark=hexRGB(o.bark||(sp==='birch'?'#d8d4c8':sp==='pine'?'#4a3624':'#5a4030')),bark2=bark.map(v=>v*.7),
  lc=hexRGB(o.leaf||(sp==='pine'?'#2d5a33':sp==='bush'?'#4a8a3a':sp==='birch'?'#8fb04a':'#4f8a3c')),
  rad0=o.trunk||H*P0.tr,LS=(o.leafSize||H*P0.ls),dens=o.leafDensity===undefined?1:o.leafDensity,pine=sp==='pine';
 const jit=(c,a)=>{const k=1+(R()-.5)*a;return c.map(v=>Math.max(0,Math.min(1,v*k)))};
 const fitH=M=>{let my=0;for(let i=1;i<M.v.length;i+=3)if(M.v[i]>my)my=M.v[i];if(my>1e-6&&o.fit!==false){const k=H/my;for(let i=0;i<M.v.length;i++)M.v[i]*=k}return M};
 const cluster=(c,sc)=>{const k=Math.round(P0.lc*dens*sc*(R()<.5?1:1)+R()*.5);for(let i=0;i<k;i++){
   const off=[(R()-.5)*LS*1.8,(R()-.5)*LS*(pine?.8:1.8),(R()-.5)*LS*1.8],
    u=vN(pine?[(R()-.5),-.7-R()*.3,(R()-.5)]:[(R()-.5)*2,(R()-.2),(R()-.5)*2]),s=vN(vC(u,[R()-.5,R()-.5,R()-.5]));
   leafAt(M,vA(c,off),u,s,pine?LS*.12:LS*.55,pine?LS*(1.2+R()*.5):LS*(.9+R()*.5),jit(lc,.35))}};
 if(sp==='palm'){const n=9,lean=(R()-.5)*.25*H,pts=[],rr=[];
  for(let i=0;i<=n;i++){const k=i/n;pts.push([lean*k*k,H*k,lean*.4*k*k]);rr.push(rad0*(1-.4*k)*(1+.07*(i%2)))}
  ringTube(M,pts,rr,bark,bark2,8);const top=pts[n],fr=Math.max(3,Math.round((o.fronds||10)*Math.max(.3,dens))),L=H*.4;
  for(let f=0;f<fr;f++){const az=f/fr*Math.PI*2+R()*.3,d=vN([Math.cos(az),.6+R()*.3,Math.sin(az)]),rp=[],rrr=[];
   for(let i=0;i<=6;i++){const k=i/6;rp.push([top[0]+d[0]*L*k,top[1]+d[1]*L*k-L*.4*k*k,top[2]+d[2]*L*k]);rrr.push(H*.006*(1-k*.7)+.002)}
   ringTube(M,rp,rrr,lc.map(v=>v*.7),lc.map(v=>v*.7),3);
   for(let i=1;i<=6;i++){const tg=vN([rp[Math.min(i+1,6)][0]-rp[i-1][0],rp[Math.min(i+1,6)][1]-rp[i-1][1],rp[Math.min(i+1,6)][2]-rp[i-1][2]]),sd=vN(vC(tg,[0,1,0])),ll=L*.3*Math.sin(Math.PI*(i/7)+.25);
    for(const sg of[-1,1]){const u=vN(vA(vA(vA([0,0,0],sd,sg*.8),[0,-1,0],.5),tg,.4));leafAt(M,rp[i],u,vN(vC(u,tg)),L*.05,ll,jit(lc,.3))}}}
  return fitH(M)}
 const grow=(p,d,len,rad,lv)=>{
  const segs=lv===0?7:4,pts=[p.slice()],rr=[rad];let q=p.slice();
  for(let i=1;i<=segs;i++){const j=lv?1:.3;d=vN([d[0]+(R()-.5)*.35*j,d[1]+(lv?P0.tp*.45:0)+(R()-.5)*.2*j,d[2]+(R()-.5)*.35*j]);q=vA(q,d,len/segs);pts.push(q);rr.push(Math.max(rad*(1-.85*i/segs),rad*.12))}
  ringTube(M,pts,rr,bark,bark2,lv===0?(o.sides||7):lv===1?5:4);
  if(lv<P0.lv){const cnt=Math.max(1,Math.round(P0.n[lv]*(o.branches||1))),t0=lv===0?P0.bare:.2;
   for(let k=0;k<cnt;k++){const t=t0+(1-t0-.05)*((k+R()*.7)/cnt),fi=t*segs,i0=Math.min(Math.floor(fi),segs-1),fr=fi-i0,dd=[pts[i0+1][0]-pts[i0][0],pts[i0+1][1]-pts[i0][1],pts[i0+1][2]-pts[i0][2]],
     pos=vA(pts[i0],dd,fr),tg=vN(dd),rad2=rr[i0]+(rr[i0+1]-rr[i0])*fr,az=k*2.39996+R()*.8,u=vN(vC(tg,Math.abs(tg[1])>.9?[1,0,0]:[0,1,0])),w=vC(tg,u),an=(P0.ang[lv]+(R()-.5)*20)*Math.PI/180,
     nd=vA(vA(vA([0,0,0],tg,Math.cos(an)),u,Math.cos(az)*Math.sin(an)),w,Math.sin(az)*Math.sin(an)),
     cl=len*P0.len[lv]*(pine&&lv===0?(1.05-t)*1.1:1)*(.8+R()*.4);
    grow(pos,vN(nd),cl,Math.min(rad2*.6,rad*.5),lv+1)}}
  else if(P0.lc>0){cluster(pts[segs],1);if(segs>2)cluster(pts[Math.floor(segs*.6)],.7)}};
 grow([0,0,0],[0,1,0],H*P0.tl,rad0,0);return fitH(M)}
function hairGen(o){
 o=o||{};const R=rng(o.seed||1),c=o.center||[0,0,0],r=o.radii||[.09,.11,.1],st=o.style||'long',sf=(r[0]+r[2])/2/.1,
  L=(o.length||({short:.07,long:.45,bob:.45,ponytail:.4,curly:.3,spiky:.09}[st]||.3*1)*(o.length?1:sf)),
  cnt=Math.round(o.count||(st==='short'||st==='spiky'?260:340)),wd=o.width||.022*sf,c0=hexRGB(o.color||'#3a2a1c'),c1=hexRGB(o.tip||'#6b4a2e'),
  SEG=st==='spiky'?3:st==='ponytail'?9:7,M=mbNew(),down=[0,-1,0],hlF=(o.hairline||68)*Math.PI/180,
  hl=ph=>hlF+((106*Math.PI/180)-hlF)*(1-Math.cos(ph))/2,
  P=(n,k)=>[c[0]+n[0]*r[0]*k,c[1]+n[1]*r[1]*k,c[2]+n[2]*r[2]*k],
  nrm=n=>vN([n[0]/r[0],n[1]/r[1],n[2]/r[2]]),dn=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  T=st==='ponytail'?[c[0],c[1]+r[1]*.35,c[2]-r[2]*1.12]:null,
  out=p=>{const e=[(p[0]-c[0])/(r[0]*1.06),(p[1]-c[1])/(r[1]*1.06),(p[2]-c[2])/(r[2]*1.06)],m=Math.hypot(...e);return m<1&&m>1e-9?[c[0]+e[0]/m*r[0]*1.06,c[1]+e[1]/m*r[1]*1.06,c[2]+e[2]/m*r[2]*1.06]:p};
 if(o.cap!==false){const NR=5,NS=24,b=M.v.length/3;for(let j=0;j<=NR;j++)for(let k=0;k<=NS;k++){const ph=k/NS*Math.PI*2,th=hl(ph)*j/NR,n=[Math.sin(th)*Math.sin(ph),Math.cos(th),Math.sin(th)*Math.cos(ph)],p=P(n,1.015);M.v.push(...p);M.c.push(...c0.map(v=>v*.85));M.uv.push(k/NS,j/NR)}
  for(let j=0;j<NR;j++)for(let k=0;k<NS;k++){const a=b+j*(NS+1)+k,bb=a+1,cc=a+NS+1,d=cc+1;M.f.push(a,cc,bb,bb,cc,d)}}
 const strand=(root,ne,len,cut,bangs)=>{
  let pts=[root],p=root,d,tg=vA(down,ne,-dn(down,ne)),tl=Math.hypot(...tg),hz=Math.hypot(ne[0],ne[2])||1,hh=[ne[0]/hz,0,ne[2]/hz];d=st==='spiky'?vN(vA(ne,[(R()-.5)*.3,(R()-.5)*.3,(R()-.5)*.3])):(tl>.15?vN(tg):vN(vA(hh,ne,-dn(hh,ne))));const step=len/SEG;
  if(T&&!bangs){const j=[(R()-.5)*.025*sf,(R()-.5)*.02*sf,(R()-.5)*.025*sf],E=vA(T,j),Cp=vA(root,ne,r[0]*.4);
   for(let i=1;i<=3;i++){const t=i/3,a=(1-t)*(1-t),b=2*(1-t)*t,cc=t*t;pts.push(out([a*root[0]+b*Cp[0]+cc*E[0],a*root[1]+b*Cp[1]+cc*E[1],a*root[2]+b*Cp[2]+cc*E[2]]))}
   for(let i=1;i<=SEG-3;i++)pts.push([E[0]+j[0]*i*.5,E[1]-i*step*1.15,E[2]-i*step*.12-Math.sin(i*.5)*.01*sf])}
  else for(let i=1;i<=SEG;i++){const k=i/SEG,gr=st==='spiky'?0:Math.min(1,.25+k*1.1)*.5;d=vN(vA(d,down,gr));let q=vA(p,d,step);if(st!=='spiky'&&q[1]>c[1]-r[1]*.25){const e=[(q[0]-c[0])/(r[0]*1.06),(q[1]-c[1])/(r[1]*1.06),(q[2]-c[2])/(r[2]*1.06)],m=Math.hypot(...e)||1;q=[c[0]+e[0]/m*r[0]*1.06,c[1]+e[1]/m*r[1]*1.06,c[2]+e[2]/m*r[2]*1.06]}else q=out(q);d=vN([q[0]-p[0],q[1]-p[1],q[2]-p[2]]);p=q;
   if(cut!==null&&p[1]<=cut){p=[p[0],cut,p[2]];pts.push(p);break}pts.push(p)}
  if(st==='curly'&&!bangs){const ph=R()*6.28;pts=pts.map((q,i)=>{if(!i)return q;const k=i/(pts.length-1),a=ph+i*1.9,pr=pts[i-1],t=vN([q[0]-pr[0],q[1]-pr[1],q[2]-pr[2]]),u=vN(vC(t,[0,0,1]||t)),w=vC(t,u),am=.02*sf*k;return out([q[0]+am*(Math.cos(a)*u[0]+Math.sin(a)*w[0]),q[1]+am*(Math.cos(a)*u[1]+Math.sin(a)*w[1]),q[2]+am*(Math.cos(a)*u[2]+Math.sin(a)*w[2])])})}
  if(pts.length<2)return;const base=M.v.length/3,jt=1+(R()-.5)*.25,n=pts.length;
  for(let i=0;i<n;i++){const k=i/(n-1),a=pts[Math.max(i-1,0)],b=pts[Math.min(i+1,n-1)],t=vN([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);let sd=vC(t,ne);if(Math.hypot(...sd)<.2)sd=vC(t,Math.abs(t[2])>.9?[1,0,0]:[0,0,1]);sd=vN(sd);
   const w=(st==='spiky'?wd*1.3*(1-k*.95):wd*(1-.75*k))/2,col=[0,1,2].map(q=>Math.min(1,(c0[q]+(c1[q]-c0[q])*k)*jt));
   M.v.push(pts[i][0]-sd[0]*w,pts[i][1]-sd[1]*w,pts[i][2]-sd[2]*w,pts[i][0]+sd[0]*w,pts[i][1]+sd[1]*w,pts[i][2]+sd[2]*w);M.c.push(...col,...col);M.uv.push(0,k,1,k)}
  for(let i=0;i<n-1;i++){const a=base+i*2;M.f.push(a,a+1,a+2,a+1,a+3,a+2)}};
 const cutY=st==='bob'?c[1]-r[1]*.75:null;let ns=0;
 for(let s=0;s<cnt;s++){const ph=R()*Math.PI*2,tm=hl(ph),ct=1-R()*(1-Math.cos(tm)),th=Math.acos(ct),n=[Math.sin(th)*Math.sin(ph),Math.cos(th),Math.sin(th)*Math.cos(ph)];
  strand(P(n,1),nrm(n),L*(.75+R()*.5),cutY,false);ns++}
 if(o.bangs){const nb=Math.round(cnt*.12);for(let s=0;s<nb;s++){const ph=(R()-.5)*1.4,th=(50+R()*26)*Math.PI/180,n=[Math.sin(th)*Math.sin(ph),Math.cos(th),Math.sin(th)*Math.cos(ph)];strand(P(n,1),nrm(n),r[1]*.9,c[1]+r[1]*(o.bangsY===undefined?.2:o.bangsY),true);ns++}}
 M.strands=ns;return M}
function shellFrom(m,R,opt){
 opt=opt||{};R=R||{};const N=normM(m),gap=opt.gap===undefined?.01:opt.gap,fl=opt.flare||0,wr=opt.wrinkle||0,th=opt.thick||0,
  inb=i=>{const x=m.v[i*3],y=m.v[i*3+1],z=m.v[i*3+2];return(!R.x||(x>=R.x[0]&&x<=R.x[1]))&&(!R.y||(y>=R.y[0]&&y<=R.y[1]))&&(!R.z||(z>=R.z[0]&&z<=R.z[1]))};
 const map=new Map(),src=[],F=[],id=i=>{let r=map.get(i);if(r===undefined){r=src.length;map.set(i,r);src.push(i)}return r};
 for(let i=0;i<m.f.length;i+=3){const a=m.f[i],b=m.f[i+1],c=m.f[i+2];if(inb(a)&&inb(b)&&inb(c))F.push(id(a),id(b),id(c))}
 if(!F.length)return null;
 let lo=1e30,hi=-1e30;src.forEach(i=>{const y=m.v[i*3+1];if(y<lo)lo=y;if(y>hi)hi=y});if(R.y){lo=R.y[0];hi=R.y[1]}
 const n=src.length,v=[],uv=m.uv?[]:null;
 src.forEach(i=>{const x=m.v[i*3],y=m.v[i*3+1],z=m.v[i*3+2],t=hi>lo?(hi-y)/(hi-lo):0,off=gap*(1+fl*t)+wr*.006*Math.sin(y*41+x*29+z*17)*Math.cos(x*23-z*31);
  v.push(+(x+N[i*3]*off).toFixed(4),+(y+N[i*3+1]*off).toFixed(4),+(z+N[i*3+2]*off).toFixed(4));if(uv)uv.push(m.uv[i*2],m.uv[i*2+1])});
 let f=F;
 if(th>0){const inner=[];src.forEach((i,k)=>{const x=m.v[i*3],y=m.v[i*3+1],z=m.v[i*3+2],t=hi>lo?(hi-y)/(hi-lo):0,off=Math.max(gap*(1+fl*t)-th,.0005);
   inner.push(+(x+N[i*3]*off).toFixed(4),+(y+N[i*3+1]*off).toFixed(4),+(z+N[i*3+2]*off).toFixed(4));if(uv)uv.push(m.uv[i*2],m.uv[i*2+1])});
  v.push(...inner);f=F.slice();for(let i=0;i<F.length;i+=3)f.push(F[i]+n,F[i+2]+n,F[i+1]+n);
  const E=new Map();for(let i=0;i<F.length;i+=3)for(let k=0;k<3;k++){const a=F[i+k],b=F[i+(k+1)%3];E.set(a+'>'+b,[a,b])}
  E.forEach(([a,b],key)=>{if(!E.has(b+'>'+a))f.push(a,b,b+n,a,b+n,a+n)})}
 const r={v,f};if(uv)r.uv=uv;return r}
function pushOut(P,i,c,th){const x=P[i*3],y=P[i*3+1],z=P[i*3+2];
 if(c.k==='ell'){const rx=c.r[0]+th,ry=c.r[1]+th,rz=c.r[2]+th,ex=(x-c.c[0])/rx,ey=(y-c.c[1])/ry,ez=(z-c.c[2])/rz,m=Math.hypot(ex,ey,ez);if(m<1&&m>1e-9){P[i*3]=c.c[0]+ex/m*rx;P[i*3+1]=c.c[1]+ey/m*ry;P[i*3+2]=c.c[2]+ez/m*rz}}
 else if(c.k==='cyl'){if(y<c.y[0]-th||y>c.y[1]+th)return;const dx=x-c.c[0],dz=z-c.c[2],d=Math.hypot(dx,dz),Rr=c.r+th;if(d<Rr){if(d<1e-9)P[i*3]=c.c[0]+Rr;else{P[i*3]=c.c[0]+dx/d*Rr;P[i*3+2]=c.c[2]+dz/d*Rr}}}
 else{const p=[x,y,z];let best=-1,bp=1e30,bs=1;for(let k=0;k<3;k++){const lo=c.min[k]-th,hi=c.max[k]+th;if(p[k]<=lo||p[k]>=hi)return;const a=p[k]-lo,b=hi-p[k];if(a<bp){bp=a;best=k;bs=-1}if(b<bp){bp=b;best=k;bs=1}}
  P[i*3+best]=bs<0?c.min[best]-th:c.max[best]+th}}
function clothMk(o){
 const sh=o.shape||'rect',nx=Math.max(2,Math.round(o.nx||(sh==='skirt'?24:16))),ny=Math.max(2,Math.round(o.ny||14)),pos=o.pos||[0,1,0],P=[],UV=[],F=[],pins=[],con=[],wrap=sh==='skirt'||sh==='tube',cols=wrap?nx:nx+1,
  ix=(i,j)=>j*cols+((i%cols)+cols)%cols;
 if(wrap){const r0=o.r0||.2,r1=o.r1===undefined?r0*1.6:o.r1,h=o.h||.8;
  for(let j=0;j<=ny;j++)for(let i=0;i<nx;i++){const a=i/nx*Math.PI*2,r=r0+(r1-r0)*j/ny;P.push(pos[0]+Math.cos(a)*r,pos[1]-h*j/ny,pos[2]+Math.sin(a)*r);UV.push(i/nx,1-j/ny)}
  for(let i=0;i<nx;i++)pins.push(ix(i,0))}
 else{const w=o.w||1,h=o.h||1,ya=(o.yaw||0)*Math.PI/180,co=Math.cos(ya),si=Math.sin(ya);
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const x=(i/nx-.5)*w;P.push(pos[0]+x*co,pos[1]-h*j/ny,pos[2]-x*si);UV.push(i/nx,1-j/ny)}
  const pm=o.pin||'top';
  if(Array.isArray(pm))pm.forEach(k=>pins.push(k));
  else for(let i=0;i<=nx;i++){const k=i/nx;if(pm==='top'||(pm==='corners'&&(i===0||i===nx))||(pm==='neck'&&k>=.35&&k<=.65))pins.push(ix(i,0))}}
 const nI=wrap?nx:nx+1;
 for(let j=0;j<ny;j++)for(let i=0;i<(wrap?nx:nx);i++){if(!wrap&&i>=nx)continue;const a=ix(i,j),b=ix(i+1,j),c=ix(i,j+1),d=ix(i+1,j+1);F.push(a,c,b,b,c,d)}
 const dist=(a,b)=>Math.hypot(P[a*3]-P[b*3],P[a*3+1]-P[b*3+1],P[a*3+2]-P[b*3+2]),add=(a,b)=>{if(a!==b)con.push([a,b,dist(a,b)])};
 for(let j=0;j<=ny;j++)for(let i=0;i<nI;i++){if(wrap||i<nx)add(ix(i,j),ix(i+1,j));if(j<ny)add(ix(i,j),ix(i,j+1));
  if(j<ny&&(wrap||i<nx)){add(ix(i,j),ix(i+1,j+1));add(ix(i+1,j),ix(i,j+1))}
  if(j<ny-1)add(ix(i,j),ix(i,j+2));if(wrap||i<nx-1)if(wrap||i+2<=nx)add(ix(i,j),ix(i+2,j))}
 return{P,F,UV,pins,con,wrap}}
function clothSim(Cl,opt){
 opt=opt||{};const P=Cl.P,Pp=P.slice(),pin=new Set(Cl.pins),g=opt.gravity===undefined?-9.8:opt.gravity,dt=opt.dt||1/30,steps=opt.steps||90,it=opt.iter||8,damp=opt.damp===undefined?.985:opt.damp,th=opt.thick===undefined?.012:opt.thick,
  wind=opt.wind||[0,0,0],cols=opt.colliders||[],fl=opt.floor===false?null:(opt.floorY||0),n=P.length/3,Wf=(wind[0]||wind[1]||wind[2])?new Array(P.length).fill(0):null,pp=Cl.pins.map(i=>[P[i*3],P[i*3+1],P[i*3+2]]);
 for(let s=0;s<steps;s++){
  if(Wf){Wf.fill(0);for(let q=0;q<Cl.F.length;q+=3){const a=Cl.F[q],b=Cl.F[q+1],c=Cl.F[q+2],e1=[P[b*3]-P[a*3],P[b*3+1]-P[a*3+1],P[b*3+2]-P[a*3+2]],e2=[P[c*3]-P[a*3],P[c*3+1]-P[a*3+1],P[c*3+2]-P[a*3+2]],nn=vC(e1,e2),l=Math.hypot(nn[0],nn[1],nn[2]);if(l<1e-12)continue;
    const dd=(nn[0]*wind[0]+nn[1]*wind[1]+nn[2]*wind[2])/(l*l)*(.75+.25*Math.sin(s*.31+q*.12));for(let k=0;k<3;k++){const f=nn[k]*dd/6;Wf[a*3+k]+=f;Wf[b*3+k]+=f;Wf[c*3+k]+=f}}}
  for(let i=0;i<n;i++){if(pin.has(i))continue;for(let k=0;k<3;k++){const x=P[i*3+k],v=(x-Pp[i*3+k])*damp;Pp[i*3+k]=x;P[i*3+k]=x+v+((k===1?g:0)+(Wf?Wf[i*3+k]:0))*dt*dt}}
  for(let q=0;q<it;q++){
   for(const[a,b,rs]of Cl.con){const dx=P[b*3]-P[a*3],dy=P[b*3+1]-P[a*3+1],dz=P[b*3+2]-P[a*3+2],d=Math.hypot(dx,dy,dz);if(d<1e-9)continue;const df=(d-rs)/d,pa=pin.has(a),pb=pin.has(b);if(pa&&pb)continue;const wa=pa?0:pb?1:.5,wb=pb?0:pa?1:.5;
    P[a*3]+=dx*df*wa;P[a*3+1]+=dy*df*wa;P[a*3+2]+=dz*df*wa;P[b*3]-=dx*df*wb;P[b*3+1]-=dy*df*wb;P[b*3+2]-=dz*df*wb}
   for(let i=0;i<n;i++){if(pin.has(i))continue;for(const c of cols)pushOut(P,i,c,th);if(fl!==null&&P[i*3+1]<fl+th)P[i*3+1]=fl+th}
   Cl.pins.forEach((i,k)=>{P[i*3]=pp[k][0];P[i*3+1]=pp[k][1];P[i*3+2]=pp[k][2]})}}
 return P}
// ===== риг, походки, вторичное движение (чистые функции) =====
function qMul(a,b){return[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]+a[1]*b[3]+a[2]*b[0]-a[0]*b[2],a[3]*b[2]+a[2]*b[3]+a[0]*b[1]-a[1]*b[0],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]]}
function qRot(q,v){const t=[2*(q[1]*v[2]-q[2]*v[1]),2*(q[2]*v[0]-q[0]*v[2]),2*(q[0]*v[1]-q[1]*v[0])];return[v[0]+q[3]*t[0]+q[1]*t[2]-q[2]*t[1],v[1]+q[3]*t[1]+q[2]*t[0]-q[0]*t[2],v[2]+q[3]*t[2]+q[0]*t[1]-q[1]*t[0]]}
function qAxis(ax,deg){const h=deg*Math.PI/360,s=Math.sin(h),l=Math.hypot(ax[0],ax[1],ax[2])||1;return[ax[0]/l*s,ax[1]/l*s,ax[2]/l*s,Math.cos(h)]}
function qInv(q){return[-q[0],-q[1],-q[2],q[3]]}
function qEul(r){const x=r[0]*Math.PI/360,y=r[1]*Math.PI/360,z=r[2]*Math.PI/360,c1=Math.cos(x),c2=Math.cos(y),c3=Math.cos(z),s1=Math.sin(x),s2=Math.sin(y),s3=Math.sin(z);return[s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3]}
function qToEul(q){const x=q[0],y=q[1],z=q[2],w=q[3],m11=1-2*(y*y+z*z),m12=2*(x*y-w*z),m13=2*(x*z+w*y),m22=1-2*(x*x+z*z),m23=2*(y*z-w*x),m32=2*(y*z+w*x),m33=1-2*(x*x+y*y);let ey=Math.asin(Math.max(-1,Math.min(1,m13))),ex,ez;if(Math.abs(m13)<.9999999){ex=Math.atan2(-m23,m33);ez=Math.atan2(-m12,m11)}else{ex=Math.atan2(m32,m22);ez=0}return[ex,ey,ez].map(a=>+(a*180/Math.PI).toFixed(3))}
function qSlerp(a,b,t){let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3],bb=b;if(d<0){d=-d;bb=[-b[0],-b[1],-b[2],-b[3]]}if(d>.9995){const r=[0,1,2,3].map(i=>a[i]+(bb[i]-a[i])*t),l=Math.hypot(...r);return r.map(x=>x/l)}
 const th=Math.acos(d),s=Math.sin(th),k0=Math.sin((1-t)*th)/s,k1=Math.sin(t*th)/s;return[0,1,2,3].map(i=>a[i]*k0+bb[i]*k1)}
// P: части от корня к детям {n,pos,rot,parent(индекс|-1),pv}; A: {имя: эйлер[3] или кватернион[4]}; T: {имя: сдвиг}
function fkPose(P,A,T){const M=[],out={};
 P.forEach((p,i)=>{const a=A&&A[p.n],R=a?(a.length===4?a:qEul(a)):[0,0,0,1],pv=p.pv||p.pos,par=p.parent>=0?M[p.parent]:{q:[0,0,0,1],t:[0,0,0]},
  Rp=qRot(R,pv),d=[pv[0]-Rp[0],pv[1]-Rp[1],pv[2]-Rp[2]],qd=qRot(par.q,d),q=qMul(par.q,R),t=[qd[0]+par.t[0],qd[1]+par.t[1],qd[2]+par.t[2]],tr=T&&T[p.n];
  if(tr){t[0]+=tr[0];t[1]+=tr[1];t[2]+=tr[2]}M.push({q,t});const pp=qRot(q,p.pos);
  out[p.n]={pos:[+(pp[0]+t[0]).toFixed(4),+(pp[1]+t[1]).toFixed(4),+(pp[2]+t[2]).toFixed(4)],rot:qToEul(qMul(q,qEul(p.rot||[0,0,0])))}});return out}
function roleOf(nm){const n=String(nm).toLowerCase();
 const T=[['breast',/breast|bust|груд[ьи]|грудн/],['head',/head|голов|skull|череп/],['neck',/neck|шея|шеи/],['jaw',/jaw|chin|челюст|подбород/],['eye',/eye|глаз/],['ear',/(^|[^a-z])ears?([^a-z]|$)|(^|_)ear|уш[оеи]/],['horn',/horn|рог/],['wing',/wing|крыл/],['tail',/tail|хвост/],['foot',/foot|feet|стоп|ступн|hoof|копыт|ankle|paw|лап/],['hand',/hand|кист|ладон|finger|пал[еь]ц/],['leg',/leg|нога|ноги|нож|thigh|бедр|shin|голен|knee|колен/],['arm',/arm|рук|плеч|shoulder|elbow|локот|forearm|предплеч/],['belly',/belly|живот|пуз/],['body',/torso|body|trunk|chest|spine|hip|pelvis|тел[оа]|туловищ|торс|таз|корпус|спин/]];
 for(const[r,re]of T)if(re.test(n))return r;return null}
function sideOf(nm){const n=String(nm).toLowerCase();if(/(^|[_\-.])l($|[_\-.])|left|лев|_l$/.test(n))return'L';if(/(^|[_\-.])r($|[_\-.])|right|прав|_r$/.test(n))return'R';return null}
// parts: [{n,c:[x,y,z],s:[sx,sy,sz]}] -> {root,list:[{n,parent,pv,role,side,depth}]} в порядке от корня
function rigAuto(parts,opt){opt=opt||{};if(!parts.length)throw new Error('autorig: нет частей');
 const vol=p=>p.s[0]*p.s[1]*p.s[2];let ri=opt.root?parts.findIndex(p=>p.n===opt.root):-1;
 if(ri<0){const bi=parts.findIndex(p=>roleOf(p.n)==='body');ri=bi>=0?bi:parts.reduce((b,p,i)=>vol(p)>vol(parts[b])?i:b,0)}
 const gap=(a,b)=>{let s=0,cd=0;for(let k=0;k<3;k++){const d=Math.abs(a.c[k]-b.c[k]),g=Math.max(0,d-(a.s[k]+b.s[k])/2);s+=g*g;cd+=d*d}return Math.sqrt(s)+.01*Math.sqrt(cd)};
 const done=[ri],par=new Array(parts.length).fill(-1),rest=parts.map((_,i)=>i).filter(i=>i!==ri);
 while(rest.length){let bi=-1,bj=-1,bd=1e30;rest.forEach(i=>done.forEach(j=>{const d=gap(parts[i],parts[j])*(roleOf(parts[i].n)==='head'&&roleOf(parts[j].n)==='arm'?5:1);if(d<bd){bd=d;bi=i;bj=j}}));par[bi]=bj;done.push(bi);rest.splice(rest.indexOf(bi),1)}
 const R=parts[ri],rtop=R.c[1]+R.s[1]/2,info=parts.map((p,i)=>{let role=roleOf(p.n),side=sideOf(p.n);
  if(i===ri)role='body';
  if(!role){const dx=(p.c[0]-R.c[0])/(R.s[0]||1),dy=p.c[1]-R.c[1],dz=(p.c[2]-R.c[2])/(R.s[2]||1);
   if(p.c[1]>rtop-.1*R.s[1]&&Math.abs(dx)<.4)role='head';else if(dz<-.4&&p.s[2]>=Math.max(p.s[0],p.s[1])&&p.s[2]>1.5*Math.min(p.s[0],p.s[1]))role='tail';else if(Math.abs(dx)>.3&&dy>-.1*R.s[1]&&p.c[1]>R.c[1]-R.s[1]*.3)role='arm';else if(dy<0)role='leg';else role='part'}
  if(!side&&i!==ri){const dx=p.c[0]-R.c[0];if(Math.abs(dx)>.08*(R.s[0]||1))side=dx>0?'L':'R'}
  return{role,side:side||'C'}});
 const depth=[];const dep=i=>{if(depth[i]!==undefined)return depth[i];const j=par[i];depth[i]=(j>=0&&info[j].role===info[i].role&&info[j].side===info[i].side)?dep(j)+1:1;return depth[i]};
 const J=opt.joints||{},pvOf=i=>{const p=parts[i];if(J[p.n])return J[p.n].slice();if(i===ri)return p.c.slice();const q=parts[par[i]],ax=[0,1,2].reduce((b,k)=>p.s[k]>p.s[b]?k:b,0),oth=Math.max(...[0,1,2].filter(k=>k!==ax).map(k=>p.s[k]));
  if(p.s[ax]>1.4*oth){const e0=p.c.slice(),e1=p.c.slice();e0[ax]-=p.s[ax]/2;e1[ax]+=p.s[ax]/2;const rl=info[i].role;if(ax===1&&(rl==='arm'||rl==='leg')&&info[par[i]].role!==rl)return e1;const d0=Math.abs(e0[ax]-q.c[ax]),d1=Math.abs(e1[ax]-q.c[ax]);return d0<d1?e0:e1}
  const d=[0,1,2].map(k=>q.c[k]-p.c[k]),l=Math.hypot(...d)||1;return[0,1,2].map(k=>p.c[k]+d[k]/l*p.s[k]/2*.9)};
 const list=done.map(i=>({n:parts[i].n,parent:par[i]>=0?parts[par[i]].n:null,pv:pvOf(i).map(v=>+v.toFixed(4)),role:info[i].role,side:info[i].side,depth:dep(i)}));
 return{root:parts[ri].n,list}}
// походка: rig = [{n,pos,rot,parent(индекс),pv,role,side,depth}] от корня; возвращает ключи [{t,poses}]
function gaitGen(rig,o){o=o||{};const kind=o.clip||'walk',T=o.duration||(kind==='run'?.6:kind==='idle'?3:1),N=o.keys||(kind==='idle'?12:8),am=o.amp===undefined?1:o.amp,
 f=vN(o.forward||[0,0,1]),up=[0,1,0],ax=vN(vC(up,f)),by=r=>rig.filter(p=>p.role===r),legs=by('leg'),arms=by('arm'),feet=by('foot'),
 quad=legs.filter(p=>p.depth===1).length>=3,run=kind==='run',sw=(run?1.6:1)*am,rootP=rig[0],bodyH=Math.max(.1,rootP.pos[1]);
 const zc=rootP.pos[0]*f[0]+rootP.pos[2]*f[2],fz=p=>p.pos[0]*f[0]+p.pos[1]*0+p.pos[2]*f[2]-zc,side=p=>p.side==='L'?0:1;
 const keys=[];
 for(let i=0;i<=N;i++){const t=T*i/N,ph=2*Math.PI*i/N,A={},Tr={};
  const rotAx=(n,a,deg)=>{A[n]=A[n]?qMul(qAxis(a,deg),A[n].length===4?A[n]:qEul(A[n])):qAxis(a,deg)};
  if(kind==='idle'){const br=Math.sin(ph);by('body').forEach(p=>rotAx(p.n,ax,-1.2*am*br));by('head').forEach(p=>rotAx(p.n,up,5*am*Math.sin(ph*.5)));
   by('tail').forEach(p=>rotAx(p.n,up,10*am*Math.sin(ph+p.depth*.7)));by('arm').forEach(p=>rotAx(p.n,ax,(p.depth===1?-2:-3)*am*Math.sin(ph+side(p)*Math.PI)));
   by('ear').forEach(p=>rotAx(p.n,f,3*am*Math.sin(ph*2+side(p))));Tr[rootP.n]=[0,.004*bodyH*am*br,0]}
  else{
   const legPh=p=>quad?(((fz(p)>0?0:1)+side(p))%2)*Math.PI+ph:ph+side(p)*Math.PI;
   legs.forEach(p=>{const q=legPh(p),L=28*sw;if(p.depth===1)rotAx(p.n,ax,-L*Math.sin(q));else if(p.depth===2)rotAx(p.n,ax,(quad&&fz(p)<0?-1:1)*45*sw*Math.max(0,Math.cos(q)));else rotAx(p.n,ax,8*sw*Math.sin(q))});
   feet.forEach(p=>{const q=legPh(p);rotAx(p.n,ax,-12*sw*Math.max(0,Math.cos(q))+8*sw*Math.sin(q))});
   arms.forEach(p=>{const q=ph+(p.side==='R'?0:Math.PI);if(p.depth===1)rotAx(p.n,ax,-(quad?0:22)*sw*Math.sin(q));else rotAx(p.n,ax,-(12+14*sw*Math.max(0,Math.sin(q))))});
   by('body').forEach(p=>{rotAx(p.n,f,2.5*sw*Math.sin(ph));if(run)rotAx(p.n,ax,6)});by('body').forEach((p,k)=>{if(k===0)Tr[p.n]=[0,bodyH*.025*sw*Math.cos(2*ph),0]});
   by('head').forEach(p=>rotAx(p.n,ax,-1.5*sw*Math.cos(2*ph)));by('tail').forEach(p=>rotAx(p.n,up,14*sw*Math.sin(ph+p.depth*.8)));
   by('wing').forEach(p=>rotAx(p.n,f,(p.side==='L'?1:-1)*20*sw*Math.sin(ph)));by('ear').forEach(p=>rotAx(p.n,f,4*sw*Math.sin(2*ph+side(p))))}
  keys.push({t:+t.toFixed(4),poses:fkPose(rig,A,Tr)})}
 return keys}
function interpPose(keys,loop,name,t){const T=keys[keys.length-1].t;if(loop&&T>0)t=t%T;let i=0;while(i<keys.length-1&&keys[i+1].t<=t)i++;const a=keys[i],b=keys[Math.min(i+1,keys.length-1)],pa=a.poses[name],pb=b.poses[name]||pa;if(!pa)return null;
 const f=b.t>a.t?Math.min(1,Math.max(0,(t-a.t)/(b.t-a.t))):0;let w;if(pa.w){w={};for(const k in pa.w){const b0=pa.w[k],b1=(pb.w&&pb.w[k]!==undefined)?pb.w[k]:b0;w[k]=+(b0+(b1-b0)*f).toFixed(3)}}
 return{pos:pa.pos.map((v,k)=>v+(pb.pos[k]-v)*f),q:qSlerp(qEul(pa.rot),qEul(pb.rot),f),w}}
function springFollow(anch,dt,k,c,maxD){const x=anch[0].slice(),v=[0,0,0],out=[],sub=4,h=dt/sub;
 for(const a of anch){for(let s=0;s<sub;s++)for(let q=0;q<3;q++){const acc=k*(a[q]-x[q])-c*v[q];v[q]+=acc*h;x[q]+=v[q]*h}
  const d=[x[0]-a[0],x[1]-a[1],x[2]-a[2]],l=Math.hypot(...d);if(maxD&&l>maxD){for(let q=0;q<3;q++)x[q]=a[q]+d[q]/l*maxD}out.push(x.slice())}return out}
// вторичное движение: S {n,pos,rot,parent}, P0 {pos,rot} покой родителя; keys клипа с родителем; шаг 1/fps; прогон 3 циклов, берём последний
function secondaryGen(keys,loop,S,P0,o){o=o||{};const fps=o.fps||24,T=keys[keys.length-1].t,n=Math.max(2,Math.round(T*fps)),dt=1/fps,k=o.k||180,c=o.damp===undefined?2*.28*Math.sqrt(k):o.damp,q0=qEul(P0.rot||[0,0,0]),qs0=qEul(S.rot||[0,0,0]),off=[S.pos[0]-P0.pos[0],S.pos[1]-P0.pos[1],S.pos[2]-P0.pos[2]],reps=loop?3:1,A=[],Q=[];
 for(let r=0;r<reps;r++)for(let i=0;i<=n;i++){if(loop&&r>0&&i===n)continue;const t=i*dt,pp=interpPose(keys,loop,S.parent,Math.min(t,T-1e-9)+(i===n?1e-9:0)),d=qMul(pp.q,qInv(q0)),r0=qRot(d,off);A.push([pp.pos[0]+r0[0],pp.pos[1]+r0[1],pp.pos[2]+r0[2]]);Q.push(qMul(d,qs0))}
 const X=springFollow(A,dt,k,c,o.maxd||.05*(o.size||1)),per=n+(loop?0:1),st=A.length-per-(loop?0:0),res=[];const gain=o.gain===undefined?1:o.gain,sz=o.size||.1;
 for(let i=0;i<=n;i++){const j=loop?st+(i%per):i,x=X[j],a=A[j],dd=[(x[0]-a[0])*gain,(x[1]-a[1])*gain,(x[2]-a[2])*gain],ax=vC([0,1,0],dd),l=Math.hypot(...ax);
  let q=Q[j];if(l>1e-9){const ang=Math.min(25,Math.atan(Math.hypot(...dd)/sz)*180/Math.PI*1.5);q=qMul(qAxis(ax,ang),q)}
  res.push({t:+(i*dt).toFixed(4),pos:[a[0]+dd[0],a[1]+dd[1],a[2]+dd[2]].map(v=>+v.toFixed(4)),rot:qToEul(q)})}
 return res}
// ===== шерсть, лицо (пины), ландшафт, рассеивание, текстуры, готовые существа =====
function hash2(ix,iz,s){let n=(Math.imul(ix,374761393)+Math.imul(iz,668265263)+Math.imul(s|0,1274126177))|0;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296}
function vnoise2(x,z,s,P){const xi=Math.floor(x),zi=Math.floor(z),fx=x-xi,fz=z-zi,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz),w=P?(a=>((a%P)+P)%P):(a=>a),a=hash2(w(xi),w(zi),s),b=hash2(w(xi+1),w(zi),s),c=hash2(w(xi),w(zi+1),s),d=hash2(w(xi+1),w(zi+1),s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
function fbm2(x,z,s,oct,ridge){let a=1,f=1,t=0,n=0;for(let i=0;i<oct;i++){let q=vnoise2(x*f,z*f,s+i*17);if(ridge)q=1-Math.abs(2*q-1);t+=q*a;n+=a;a*=.5;f*=2}return t/n}
function noise3(x,y,z,s){return(vnoise2(x+y*.37,z-y*.71,s)+vnoise2(y*1.3+z,x*.9-z*.4,s+5))/2}
function meshArea(m){let t=0;for(let i=0;i<m.f.length;i+=3){const a=m.f[i]*3,b=m.f[i+1]*3,c=m.f[i+2]*3,n=vC([m.v[b]-m.v[a],m.v[b+1]-m.v[a+1],m.v[b+2]-m.v[a+2]],[m.v[c]-m.v[a],m.v[c+1]-m.v[a+1],m.v[c+2]-m.v[a+2]]);t+=Math.hypot(n[0],n[1],n[2])/2}return t}
function furGen(m,o){o=o||{};const R=rng(o.seed||1),N=normM(m),tri=m.f.length/3,cum=[];let tot=0,lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
 for(let i=0;i<m.v.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],m.v[i+k]);hi[k]=Math.max(hi[k],m.v[i+k])}
 {const cx=[0,1,2].map(k=>(lo[k]+hi[k])/2);let sg=0;for(let i=0;i<m.v.length;i+=3)sg+=N[i]*(m.v[i]-cx[0])+N[i+1]*(m.v[i+1]-cx[1])+N[i+2]*(m.v[i+2]-cx[2]);if(sg<0)for(let i=0;i<N.length;i++)N[i]=-N[i]}
 for(let t=0;t<tri;t++){const a=m.f[t*3]*3,b=m.f[t*3+1]*3,c=m.f[t*3+2]*3,n=vC([m.v[b]-m.v[a],m.v[b+1]-m.v[a+1],m.v[b+2]-m.v[a+2]],[m.v[c]-m.v[a],m.v[c+1]-m.v[a+1],m.v[c+2]-m.v[a+2]]);tot+=Math.hypot(n[0],n[1],n[2])/2;cum.push(tot)}
 if(!tot)return null;
 const len=o.length||.03,cnt=Math.min(o.count||Math.round(tot*(o.density||3000)),o.maxStrands||9000),seg=Math.max(1,Math.min(3,o.segments||1)),wd=o.width||len*.22,c0=hexRGB(o.color||'#8a6a45'),c1=hexRGB(o.color2||'#d8c8a8'),ct=o.tip?hexRGB(o.tip):null,rd=o.rootDark===undefined?.55:o.rootDark,
  g=vN(o.comb||[0,-.3,-1]),gk=o.groom===undefined?.6:o.groom,gr=o.gravity===undefined?.35:o.gravity,curl=o.curl||0,pat=o.pattern||'solid',fr=o.freq||25,ctr=[0,1,2].map(k=>(lo[k]+hi[k])/2),rad=Math.max(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2])/2||1,
  sm=(a,b,x)=>Math.max(0,Math.min(1,(x-a)/(b-a))),RG=o.region||{},zs=o.zones||[],M={v:[],f:[],c:[]};let made=0;
 for(let tries=0;tries<cnt*2&&made<cnt;tries++){
  const r=R()*tot;let a=0,b=tri-1;while(a<b){const mid=(a+b)>>1;if(cum[mid]<r)a=mid+1;else b=mid}
  const ia=m.f[a*3],ib=m.f[a*3+1],ic=m.f[a*3+2],r1=Math.sqrt(R()),r2=R(),wa=1-r1,wb=r1*(1-r2),wc=r1*r2,
   p=[0,1,2].map(k=>m.v[ia*3+k]*wa+m.v[ib*3+k]*wb+m.v[ic*3+k]*wc),n=vN([0,1,2].map(k=>N[ia*3+k]*wa+N[ib*3+k]*wb+N[ic*3+k]*wc));
  if((RG.y&&(p[1]<RG.y[0]||p[1]>RG.y[1]))||(RG.x&&(p[0]<RG.x[0]||p[0]>RG.x[1]))||(RG.z&&(p[2]<RG.z[0]||p[2]>RG.z[1])))continue;
  let L=len*(.7+R()*.6);zs.forEach(z=>{if(p[1]>=z.y[0]&&p[1]<=z.y[1])L*=z.k});
  const gt=vA(g,n,-(g[0]*n[0]+g[1]*n[1]+g[2]*n[2]));let d=vN(vA(n,gt,gk));if(n[1]<-.5)d=vN(vA(d,[0,-1,0],.6));
  let t=0;if(pat==='belly')t=sm(0,-.5,n[1]);else if(pat==='gradient')t=sm(lo[1],hi[1],p[1]);else if(pat==='tabby')t=sm(.1,.5,Math.sin(p[2]*fr/rad*.5+noise3(p[0]*8,p[1]*8,p[2]*8,3)*4+p[1]*3))*(1-sm(0,-.4,n[1]));
  else if(pat==='spots')t=sm(.6,.66,noise3(p[0]/rad*fr*.3,p[1]/rad*fr*.3,p[2]/rad*fr*.3,7));else if(pat==='points')t=sm(.45,.9,Math.hypot(p[0]-ctr[0],p[1]-ctr[1],p[2]-ctr[2])/rad);
  const jt=.92+R()*.16,base=[0,1,2].map(k=>Math.min(1,(c0[k]+(c1[k]-c0[k])*t)*jt)),tipc=ct?ct.map((v,k)=>Math.min(1,v*jt*(1-t)+base[k]*t)):base,
   P=[vA(p,n,-L*.05)],D=[];let q=P[0];
  for(let j=1;j<=seg;j++){d=vN(vA(vA(d,[0,-1,0],gr/seg),[R()-.5,R()-.5,R()-.5],curl));const dd=d[0]*n[0]+d[1]*n[1]+d[2]*n[2];if(dd<.35)d=vN(vA(d,n,.35-dd));q=vA(q,d,L/seg);P.push(q)}
  let sd=vC(d,n);if(Math.hypot(...sd)<.2)sd=vC(d,[0,1,0]);sd=vN(sd);const base0=M.v.length/3;
  for(let j=0;j<seg;j++){const w=wd/2*(1-.8*j/seg),cc=[0,1,2].map(k=>(base[k]*rd+(tipc[k]-base[k]*rd)*j/seg));M.v.push(P[j][0]-sd[0]*w,P[j][1]-sd[1]*w,P[j][2]-sd[2]*w,P[j][0]+sd[0]*w,P[j][1]+sd[1]*w,P[j][2]+sd[2]*w);M.c.push(...cc,...cc)}
  const e=P[seg];M.v.push(e[0],e[1],e[2]);M.c.push(tipc[0],tipc[1],tipc[2]);
  for(let j=0;j<seg-1;j++){const q0=base0+j*2;M.f.push(q0,q0+1,q0+2,q0+1,q0+3,q0+2)}M.f.push(base0+(seg-1)*2,base0+(seg-1)*2+1,base0+seg*2);made++}
 M.strands=made;return M}
// пины: [{at:[x,y,z],by:[dx,dy,dz]|to:[..]|scale:k,r:радиус}] плавное смещение; sym:true зеркалит по X
function warpMesh(m,pins,sym){const v=m.v.slice(),all=[];pins.forEach(p=>{all.push(p);if(sym&&Math.abs(p.at[0])>1e-6){const q={...p,at:[-p.at[0],p.at[1],p.at[2]]};if(p.by)q.by=[-p.by[0],p.by[1],p.by[2]];if(p.to)q.to=[-p.to[0],p.to[1],p.to[2]];all.push(q)}});
 for(let i=0;i<v.length;i+=3)for(const p of all){const dx=m.v[i]-p.at[0],dy=m.v[i+1]-p.at[1],dz=m.v[i+2]-p.at[2],d=Math.hypot(dx,dy,dz);if(d>=p.r)continue;const t=1-d/p.r,w=t*t*(3-2*t);
  if(p.scale!==undefined){const k=(p.scale-1)*w;v[i]+=dx*k;v[i+1]+=dy*k;v[i+2]+=dz*k}else if(p.sx!==undefined||p.sy!==undefined||p.sz!==undefined){v[i]+=dx*((p.sx===undefined?1:p.sx)-1)*w;v[i+1]+=dy*((p.sy===undefined?1:p.sy)-1)*w;v[i+2]+=dz*((p.sz===undefined?1:p.sz)-1)*w}else{const b=p.by||[p.to[0]-p.at[0],p.to[1]-p.at[1],p.to[2]-p.at[2]];v[i]+=b[0]*w;v[i+1]+=b[1]*w;v[i+2]+=b[2]*w}}
 return v}
function faceLM(m){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,z0=1e9,z1=-1e9;for(let i=0;i<m.v.length;i+=3){x0=Math.min(x0,m.v[i]);x1=Math.max(x1,m.v[i]);y0=Math.min(y0,m.v[i+1]);y1=Math.max(y1,m.v[i+1]);z0=Math.min(z0,m.v[i+2]);z1=Math.max(z1,m.v[i+2])}
 const c=[(x0+x1)/2,(y0+y1)/2,(z0+z1)/2],hw=(x1-x0)/2,hh=(y1-y0)/2,hd=(z1-z0)/2;return{c,hw,hh,hd,P:(u,v)=>[c[0]+u*hw,c[1]+v*hh,c[2]+hd*Math.sqrt(Math.max(1-u*u-v*v,.04))]}}
function faceKeys(){return['blink_L','blink_R','smile','frown','jaw_open','mouth_o','brow_up','brow_down','brow_angry','eyes_wide','eyes_narrow','nose_up','nose_wide','snout_long','cheeks_puff']}
function facePins(nm,L){const hw=L.hw,hh=L.hh,hd=L.hd,P=L.P,E=[P(.4,.12),P(-.4,.12)],Mo=[P(.28,-.42),P(-.28,-.42)],mv=(at,by,r)=>({at,by,r}),sc=(at,s,r)=>({at,scale:s,r}),sg=i=>i?-1:1;
 switch(nm){
 case'blink_L':case'blink_R':{const e=E[nm==='blink_L'?0:1];return[mv(vA(e,[0,.06*hh,0]),[0,-.13*hh,-.02*hd],.2*hh),mv(vA(e,[0,-.06*hh,0]),[0,.05*hh,0],.15*hh)]}
 case'smile':return[...Mo.map((q,i)=>mv(q,[sg(i)*.07*hw,.1*hh,.03*hd],.3*hh)),...[P(.6,-.2),P(-.6,-.2)].map(c=>mv(c,[0,.06*hh,.03*hd],.3*hh))];
 case'frown':return Mo.map((q,i)=>mv(q,[sg(i)*.02*hw,-.1*hh,0],.3*hh));
 case'jaw_open':return[mv(P(0,-.8),[0,-.38*hh,-.05*hd],.55*hh),mv(P(0,-.42),[0,-.16*hh,0],.3*hh)];
 case'mouth_o':return Mo.map((q,i)=>mv(q,[-sg(i)*.14*hw,0,.06*hd],.25*hh));
 case'brow_up':return[P(.4,.4),P(-.4,.4)].map(b=>mv(b,[0,.1*hh,0],.22*hh));
 case'brow_down':return[P(.4,.4),P(-.4,.4)].map(b=>mv(b,[0,-.09*hh,0],.22*hh));
 case'brow_angry':return[mv(P(.15,.38),[0,-.1*hh,0],.2*hh),mv(P(-.15,.38),[0,-.1*hh,0],.2*hh),mv(P(.6,.36),[0,.04*hh,0],.2*hh),mv(P(-.6,.36),[0,.04*hh,0],.2*hh)];
 case'eyes_wide':return E.map(e=>sc(e,1.25,.2*hh));case'eyes_narrow':return E.map(e=>sc(e,.75,.2*hh));
 case'nose_up':return[mv(P(0,-.12),[0,.06*hh,.04*hd],.2*hh)];
 case'nose_wide':return[mv(P(.1,-.18),[.08*hw,0,0],.15*hh),mv(P(-.1,-.18),[-.08*hw,0,0],.15*hh)];
 case'snout_long':return[mv(P(0,-.3),[0,0,.3*hd],.55*hh)];
 case'cheeks_puff':return[mv(P(.6,-.2),[.1*hw,0,.1*hd],.3*hh),mv(P(-.6,-.2),[-.1*hw,0,.1*hd],.3*hh)]}
 return null}
function facePreset(nm){return({human:{},child:{eyeSize:.35,noseSize:-.3,jaw:-.25,chin:-.3,forehead:.4,cheek:.3},elf:{eyeSize:.2,eyeHeight:.2,noseSize:-.25,jaw:-.3,chin:.3,cheek:-.3},orc:{jaw:.5,chin:.4,brow:.6,noseSize:.4,eyeSize:-.2,snout:.15,cheek:.2},cat:{eyeSize:.35,noseSize:-.2,snout:.1,cheek:.3,mouthW:-.2,jaw:-.2},dog:{snout:.7,noseSize:.35,jaw:.1,eyeSpace:.3,brow:.2},alien:{eyeSize:1,eyeSpace:.4,jaw:-.5,chin:.5,noseSize:-.6,mouthW:-.4}})[nm]||null}
function faceVarPins(p,L){p=p||{};const hw=L.hw,hh=L.hh,hd=L.hd,P=L.P,o=[],E=[P(.4,.12),P(-.4,.12)],sg=i=>i?-1:1;
 if(p.eyeSize)E.forEach(e=>o.push({at:e,scale:1+.5*p.eyeSize,r:.22*hh}));if(p.eyeSpace)E.forEach((e,i)=>o.push({at:e,by:[sg(i)*.12*hw*p.eyeSpace,0,0],r:.22*hh}));if(p.eyeHeight)E.forEach(e=>o.push({at:e,by:[0,.1*hh*p.eyeHeight,0],r:.22*hh}));
 if(p.noseSize)o.push({at:P(0,-.12),scale:1+.6*p.noseSize,r:.2*hh});if(p.noseLen)o.push({at:P(0,-.12),by:[0,0,.12*hd*p.noseLen],r:.2*hh});
 if(p.mouthW)[P(.28,-.42),P(-.28,-.42)].forEach((q,i)=>o.push({at:q,by:[sg(i)*.1*hw*p.mouthW,0,0],r:.2*hh}));if(p.mouthY)o.push({at:P(0,-.42),by:[0,.1*hh*p.mouthY,0],r:.25*hh});
 if(p.jaw)o.push({at:P(0,-.8),scale:1+.35*p.jaw,r:.45*hh});if(p.chin)o.push({at:P(0,-.85),by:[0,-.12*hh*p.chin,.05*hd*p.chin],r:.3*hh});
 if(p.cheek)[P(.6,-.2),P(-.6,-.2)].forEach((c,i)=>o.push({at:c,by:[sg(i)*.08*hw*p.cheek,0,.05*hd*p.cheek],r:.3*hh}));if(p.brow)[P(.4,.4),P(-.4,.4)].forEach(b=>o.push({at:b,by:[0,0,.1*hd*p.brow],r:.22*hh}));
 if(p.snout)o.push({at:P(0,-.3),by:[0,0,.3*hd*p.snout],r:.55*hh});if(p.forehead)o.push({at:P(0,.6),by:[0,0,.1*hd*p.forehead],r:.3*hh});return o}
function erodeT(H,res,iters,talus,k){const w=res+1;for(let it=0;it<iters;it++){const D=new Float32Array(H.length);for(let z=0;z<w;z++)for(let x=0;x<w;x++){const i=z*w+x;for(const q of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+q[0],zz=z+q[1];if(xx<0||zz<0||xx>res||zz>res)continue;const j=zz*w+xx,d=H[i]-H[j];if(d>talus){const mv=k*(d-talus)/4;D[i]-=mv;D[j]+=mv}}}for(let i=0;i<H.length;i++)H[i]+=D[i]}}
function terrainHeight(hf,x,z){const w=hf.res+1,u=Math.min(hf.res-1e-9,Math.max(0,(x/hf.W+.5)*hf.res)),v=Math.min(hf.res-1e-9,Math.max(0,(z/hf.D+.5)*hf.res)),i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j,H=hf.h;
 return H[j*w+i]*(1-fu)*(1-fv)+H[j*w+i+1]*fu*(1-fv)+H[(j+1)*w+i]*(1-fu)*fv+H[(j+1)*w+i+1]*fu*fv}
function terrainSlope(hf,x,z){const e=Math.max(hf.W,hf.D)/hf.res;return Math.hypot((terrainHeight(hf,x+e,z)-terrainHeight(hf,x-e,z))/(2*e),(terrainHeight(hf,x,z+e)-terrainHeight(hf,x,z-e))/(2*e))}
function terrainGen(o){o=o||{};const W=(o.size||[40,40])[0],D=(o.size||[40,40])[1],res=Math.min(200,Math.max(8,Math.round(o.res||64))),w=res+1,s=o.seed||1,amp=o.amp===undefined?4:o.amp,fq=o.freq||3,pw=o.power||1.4,H=new Float32Array(w*w),mp=o.map;
 const sm=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
 for(let j=0;j<w;j++)for(let i=0;i<w;i++){const u=i/res,v=j/res;let h;
  if(mp&&mp.data){const x=u*(mp.w-1),y=v*(mp.h-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(mp.w-1,x0+1),y1=Math.min(mp.h-1,y0+1),fx=x-x0,fy=y-y0,g=(a,b)=>mp.data[b*mp.w+a];h=amp*(g(x0,y0)*(1-fx)*(1-fy)+g(x1,y0)*fx*(1-fy)+g(x0,y1)*(1-fx)*fy+g(x1,y1)*fx*fy)}
  else{const n=fbm2(u*fq*2,v*fq*2*D/W,s,o.octaves||5,o.ridge);h=amp*Math.pow(Math.max(0,n),pw)*2-amp*.3}
  if(o.island){const d=Math.hypot(u-.5,v-.5)*2,mk=1-sm(.55,1,d);h=h*mk-(1-mk)*amp*.5}
  H[j*w+i]=h+(o.base||0)}
 (o.flat||[]).forEach(F=>{for(let j=0;j<w;j++)for(let i=0;i<w;i++){const x=(i/res-.5)*W,z=(j/res-.5)*D,d=Math.hypot(x-F.c[0],z-F.c[1]),k=1-sm(F.r,F.r*1.6,d);if(k>0)H[j*w+i]+=((F.h===undefined?0:F.h)-H[j*w+i])*k}});
 if(o.erode)erodeT(H,res,o.erode,amp*3/res,.5);
 const hf={res,W,D,h:Array.from(H,x=>+x.toFixed(3))},sea=o.sea===undefined?-1e9:o.sea,C=hexRGB,cs={sand:C(o.sand||'#d8c89a'),grass:C(o.grass||'#5d8a3c'),grass2:C(o.grass2||'#486f2c'),rock:C(o.rock||'#7d7a74'),snow:C(o.snow||'#f2f4f6'),dirt:C(o.dirt||'#7a6044')},snowLine=o.snowLine===undefined?amp*.75:o.snowLine;
 const M={v:[],f:[],c:[],uv:[]},mx=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
 for(let j=0;j<w;j++)for(let i=0;i<w;i++){const x=(i/res-.5)*W,z=(j/res-.5)*D,y=H[j*w+i],sl=terrainSlope(hf,Math.max(-W/2+1e-6,Math.min(W/2-1e-6,x)),Math.max(-D/2+1e-6,Math.min(D/2-1e-6,z))),nz=vnoise2(x*.4,z*.4,s+3);
  let c=mx(cs.grass,cs.grass2,nz);c=mx(c,cs.dirt,sm(.35,.7,vnoise2(x*.15,z*.15,s+9))*.5);c=mx(c,cs.sand,1-sm(sea+.1,sea+.7,y));c=mx(c,cs.rock,sm(.5,.9,sl));c=mx(c,cs.snow,sm(snowLine-.3,snowLine+.3,y+nz*.6)*(1-sm(.9,1.4,sl)));
  M.v.push(+x.toFixed(3),+y.toFixed(3),+z.toFixed(3));M.c.push(+c[0].toFixed(3),+c[1].toFixed(3),+c[2].toFixed(3));M.uv.push(i/res*(W/4),j/res*(D/4))}
 for(let j=0;j<res;j++)for(let i=0;i<res;i++){const a=j*w+i,b=a+1,c=a+w,d=c+1;M.f.push(a,c,b,b,c,d)}
 M.hf=hf;return M}
function scatterPts(hf,o,R){const n=o.count||50,pts=[],cell=o.minDist||0,grid=new Map(),mn=o.minH===undefined?-1e9:o.minH,mxh=o.maxH===undefined?1e9:o.maxH,ms=o.maxSlope===undefined?.6:o.maxSlope,reg=o.region,sc=o.scale||[.8,1.3];
 for(let t=0;t<n*40&&pts.length<n;t++){let x=(R()-.5)*hf.W*.98,z=(R()-.5)*hf.D*.98;if(reg){x=reg.c[0]+(R()*2-1)*reg.r;z=reg.c[1]+(R()*2-1)*reg.r;if(Math.hypot(x-reg.c[0],z-reg.c[1])>reg.r||Math.abs(x)>hf.W/2||Math.abs(z)>hf.D/2)continue}
  const y=terrainHeight(hf,x,z);if(y<mn||y>mxh||terrainSlope(hf,x,z)>ms)continue;
  if((o.avoid||[]).some(a=>x>a.min[0]&&x<a.max[0]&&z>a.min[1]&&z<a.max[1]))continue;
  if(cell){const gx=Math.floor(x/cell),gz=Math.floor(z/cell);let bad=false;for(let a=-1;a<=1&&!bad;a++)for(let b=-1;b<=1;b++){const q=grid.get((gx+a)+','+(gz+b));if(q&&q.some(p=>Math.hypot(p[0]-x,p[1]-z)<cell)){bad=true;break}}if(bad)continue;const k=gx+','+gz;(grid.get(k)||grid.set(k,[]).get(k)).push([x,z])}
  pts.push({p:[x,y+(o.sink||0),z],yaw:o.yaw===false?0:R()*360,s:sc[0]+R()*(sc[1]-sc[0])})}
 return pts}
function scatterMerge(src,xf,o){o=o||{};const R=rng(o.seed||1),M={v:[],f:[],c:[]},bc=hexRGB(o.color||'#808080'),jit=o.jitter===undefined?.12:o.jitter,nv=src.v.length/3;
 xf.forEach(t=>{const a=t.yaw*Math.PI/180,co=Math.cos(a),si=Math.sin(a),b=M.v.length/3,k=1+(R()-.5)*jit*2;
  for(let i=0;i<nv;i++){const x=src.v[i*3]*t.s,y=src.v[i*3+1]*t.s,z=src.v[i*3+2]*t.s;M.v.push(+(t.p[0]+x*co+z*si).toFixed(3),+(t.p[1]+y).toFixed(3),+(t.p[2]-x*si+z*co).toFixed(3));
   if(src.c)M.c.push(Math.min(1,src.c[i*3]*k),Math.min(1,src.c[i*3+1]*k),Math.min(1,src.c[i*3+2]*k));else M.c.push(Math.min(1,bc[0]*k),Math.min(1,bc[1]*k),Math.min(1,bc[2]*k))}
  for(let i=0;i<src.f.length;i++)M.f.push(src.f[i]+b)});return M}
function bumpGen(kind,size,seed){const S=size||128,B=new Uint8Array(S*S),s=seed||1;
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){const u=x/S,v=y/S;let h;const pn=(f,sd)=>vnoise2(u*f,v*f,s+sd,f);
  if(kind==='skin')h=.5*pn(48,1)+.3*pn(96,2)+.2*(pn(24,3)>.7?1:0);
  else if(kind==='stone'){const r=pn(6,1),q=pn(12,2),c=1-Math.abs(2*pn(5,3)-1);h=.5*r+.3*q+.4*Math.pow(c,3)}
  else if(kind==='fabric'){const w=.5+.25*Math.sin(u*S*1.2)+.25*Math.sin(v*S*1.2);h=.7*w+.3*pn(64,4)}
  else if(kind==='bark'){h=Math.abs(2*vnoise2(u*14,v*2,s+5,14)-1)*.6+.4*pn(8,6)}
  else if(kind==='leather'){h=1-Math.abs(2*pn(20,7)-1)*.8;h=.7*h+.3*pn(60,8)}
  else h=.5*pn(8,1)+.3*pn(16,2)+.2*pn(32,3);
  B[y*S+x]=Math.max(0,Math.min(255,Math.round(h*255)))}
 return B}
// готовые существа: детали с родителями, ролями и суставами (лицом к +z, левая сторона = +x)
function limbT(n,pts,rad,extra){const p0=pts[0];return Object.assign({n,type:'tube',size:pts.map((p,i)=>[+(p[0]-p0[0]).toFixed(4),+(p[1]-p0[1]).toFixed(4),+(p[2]-p0[2]).toFixed(4),rad[i]]),pos:p0.slice()},extra)}
function ellP(n,sz,pos,extra){return Object.assign({n,type:'ellipsoid',size:sz,pos},extra)}
function humanParts(o){o=o||{};const H=o.height||1.75,k=H/1.75,wf=({slim:.9,avg:1,heavy:1.22,muscular:1.1})[o.build||'avg']||1,fem=o.sex==='f',sk=o.skin||'#d9a688',S=a=>a.map(v=>+(v*k).toFixed(4)),r=v=>+(v*k).toFixed(4),sh=fem?.93:1,hp=fem?1.12:1,P=[];
 P.push(ellP('pelvis',S([.17*wf*hp,.11,.11]),S([0,.95,0]),{color:sk,role:'body',side:'C',depth:1,parent:null,pv:S([0,.95,0])}));
 P.push(ellP('torso',S([.18*wf*sh,.25,.115*(fem?.95:1)]),S([0,1.2,0]),{color:sk,role:'body',side:'C',depth:2,parent:'pelvis',pv:S([0,1.02,0])}));
 P.push(limbT('neck',[S([0,1.45,-.005]),S([0,1.57,.015])],[r(.052),r(.045)],{color:sk,role:'neck',side:'C',depth:1,parent:'torso',pv:S([0,1.45,0])}));
 P.push(ellP('head',S([.095,.12,.105]),S([0,1.65,.012]),{color:sk,role:'head',side:'C',depth:1,parent:'neck',pv:S([0,1.57,.01])}));
 if(o.bust>0){const b=o.bust;[1,-1].forEach((s,i)=>P.push(ellP('breast_'+(i?'R':'L'),S([.055*(.6+b*.8),.05*(.6+b*.8),.055*(.6+b*.8)]),S([s*.085*wf,1.28,.1]),{color:sk,role:'breast',side:i?'R':'L',depth:1,parent:'torso',pv:S([s*.085*wf,1.3,.07])})))}
 [1,-1].forEach((s,i)=>{const L=i?'R':'L',x=a=>a*s*wf;
  P.push(limbT('arm_'+L+'1',[S([x(.21*sh),1.4,0]),S([x(.28*sh),1.12,-.01])],[r(.046),r(.038)],{color:sk,role:'arm',side:L,depth:1,parent:'torso',pv:S([x(.21*sh),1.4,0])}));
  P.push(limbT('arm_'+L+'2',[S([x(.28*sh),1.12,-.01]),S([x(.31*sh),.88,.04])],[r(.036),r(.028)],{color:sk,role:'arm',side:L,depth:2,parent:'arm_'+L+'1',pv:S([x(.28*sh),1.12,-.01])}));
  P.push(ellP('hand_'+L,S([.032,.065,.022]),S([x(.32*sh),.81,.05]),{color:sk,role:'hand',side:L,depth:1,parent:'arm_'+L+'2',pv:S([x(.31*sh),.88,.04])}));
  P.push(limbT('leg_'+L+'1',[S([x(.095*hp),.94,0]),S([x(.1*hp),.52,.01])],[r(.082),r(.055)],{color:sk,role:'leg',side:L,depth:1,parent:'pelvis',pv:S([x(.095*hp),.94,0])}));
  P.push(limbT('leg_'+L+'2',[S([x(.1*hp),.52,.01]),S([x(.1*hp),.085,-.005])],[r(.052),r(.036)],{color:sk,role:'leg',side:L,depth:2,parent:'leg_'+L+'1',pv:S([x(.1*hp),.52,.01])}));
  P.push(ellP('foot_'+L,S([.045,.04,.115]),S([x(.1*hp),.045,.05]),{color:sk,role:'foot',side:L,depth:1,parent:'leg_'+L+'2',pv:S([x(.1*hp),.085,0])}))});
 return P}
function animalParts(kind,o){o=o||{};const T=({dog:{len:.75,h:.58,br:.14,neck:.18,hs:.085,sn:.09,ear:'drop',tail:.3,lt:.042,col:'#9a6b3f'},cat:{len:.45,h:.25,br:.075,neck:.08,hs:.055,sn:.025,ear:'point',tail:.35,lt:.02,col:'#8a8a8a'},dragon:{len:1.8,h:1.1,br:.34,neck:.8,hs:.2,sn:.35,ear:'none',tail:2,lt:.09,col:'#3d7a4a',tseg:6},horse:{len:1.6,h:1.5,br:.3,neck:.6,hs:.16,sn:.25,ear:'point',tail:.8,lt:.06,col:'#7a4a2a'}})[kind];
 if(!T)throw new Error('make: животные dog, cat, horse, dragon');const sc=o.scale||1,c=o.color||T.col,dk='#2a2020',L=T.len*sc,h=T.h*sc,br=T.br*sc,nk=T.neck*sc,hs=T.hs*sc,sn=T.sn*sc,tl=T.tail*sc,lt=T.lt*sc,P=[],r=v=>+v.toFixed(4),cy=+(h-br*.9).toFixed(4);
 P.push(ellP('body',[br,br*1.1,L*.5],[0,cy,0],{color:c,role:'body',side:'C',depth:1,parent:null,pv:[0,cy,0]}));
 P.push(ellP('chest',[br*1.02,br*1.15,L*.25],[0,cy-.01*sc,L*.22],{color:c,role:'body',side:'C',depth:2,parent:'body',pv:[0,cy,L*.1]}));
 const nb=[0,cy+br*.45,L*.4],ne=[0,cy+br*.45+nk*.7,L*.4+nk*.7];
 P.push(limbT('neck',[nb,ne],[r(br*.6),r(br*.45)],{color:c,role:'neck',side:'C',depth:1,parent:'body',pv:nb}));
 const hc=[0,ne[1],ne[2]+hs*.5];
 P.push(ellP('head',[hs*.9,hs,hs*1.1],hc,{color:c,role:'head',side:'C',depth:1,parent:'neck',pv:ne.slice()}));
 P.push(ellP('snout',[hs*.45,hs*.4,sn],[0,hc[1]-hs*.25,hc[2]+hs+sn*.4],{color:c,role:'face',side:'C',depth:1,parent:'head',pv:hc.slice()}));
 P.push(ellP('nose',[hs*.18,hs*.14,hs*.14],[0,hc[1]-hs*.2,hc[2]+hs+sn*1.35],{color:dk,role:'face',side:'C',depth:1,parent:'head',pv:hc.slice()}));
 [1,-1].forEach((s,i)=>{const Sd=i?'R':'L',drop=T.ear==='drop';
  if(T.ear!=='none')P.push(ellP('ear_'+Sd,drop?[hs*.2,hs*.5,hs*.1]:[hs*.22,hs*.55,hs*.08],[s*hs*.6,hc[1]+hs*(drop?.55:.9),hc[2]-hs*.2],{color:c,rot:[0,0,s*(drop?25:10)],role:'ear',side:Sd,depth:1,parent:'head',pv:[s*hs*.45,hc[1]+hs*.6,hc[2]-hs*.2]}));
  const fx=s*br*.65,fz=L*.35,hz=-L*.33;
  P.push(limbT('leg_F'+Sd+'1',[[fx,h*.85,fz],[fx,h*.48,fz-.02*sc]],[r(lt*1.6),r(lt*1.2)],{color:c,role:'leg',side:Sd,depth:1,parent:'chest',pv:[fx,h*.85,fz]}));
  P.push(limbT('leg_F'+Sd+'2',[[fx,h*.48,fz-.02*sc],[fx,h*.1,fz]],[r(lt*1.1),r(lt*.8)],{color:c,role:'leg',side:Sd,depth:2,parent:'leg_F'+Sd+'1',pv:[fx,h*.48,fz-.02*sc]}));
  P.push(ellP('paw_F'+Sd,[lt*1.1,h*.05,lt*1.6],[fx,h*.05,fz+lt],{color:dk,role:'foot',side:Sd,depth:1,parent:'leg_F'+Sd+'2',pv:[fx,h*.1,fz]}));
  P.push(limbT('leg_H'+Sd+'1',[[fx,h*.9,hz],[fx,h*.5,hz+.04*sc]],[r(lt*2),r(lt*1.3)],{color:c,role:'leg',side:Sd,depth:1,parent:'body',pv:[fx,h*.9,hz]}));
  P.push(limbT('leg_H'+Sd+'2',[[fx,h*.5,hz+.04*sc],[fx,h*.1,hz-.03*sc]],[r(lt*1.2),r(lt*.8)],{color:c,role:'leg',side:Sd,depth:2,parent:'leg_H'+Sd+'1',pv:[fx,h*.5,hz+.04*sc]}));
  P.push(ellP('paw_H'+Sd,[lt*1.1,h*.05,lt*1.6],[fx,h*.05,hz+lt*.5],{color:dk,role:'foot',side:Sd,depth:1,parent:'leg_H'+Sd+'2',pv:[fx,h*.1,hz-.03*sc]}))});
 const ty=cy+br*.55,NT=T.tseg||3,TP=NT===3?[[0,ty,-L*.5],[0,ty+.05*sc,-L*.5-tl*.35],[0,ty+.07*sc,-L*.5-tl*.7],[0,ty+.05*sc,-L*.5-tl]]:Array.from({length:NT+1},(_,i)=>{const t=i/NT;return[0,ty+.12*sc*Math.sin(Math.PI*t*.9)-t*.25*sc,-L*.5-tl*t]});
 for(let i=0;i<NT;i++)P.push(limbT('tail'+(i+1),[TP[i],TP[i+1]],[r(lt*(.9-.7*i/NT)),r(lt*(.9-.7*(i+1)/NT))],{color:c,role:'tail',side:'C',depth:i+1,parent:i?'tail'+i:'body',pv:TP[i]}));
 return P}
// ===== рисование (растеризатор), аниме-арт, управление лицом =====
function hexMul(h,k){const c=hexRGB(h);return'#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v*255*k))).toString(16).padStart(2,'0')).join('')}
function hexMix(a,b,t){const x=hexRGB(a),y=hexRGB(b);return'#'+x.map((v,i)=>Math.round((v+(y[i]-v)*t)*255).toString(16).padStart(2,'0')).join('')}
function artSpline(p,closed,n){n=n||8;const m=p.length,out=[],g=i=>closed?p[((i%m)+m)%m]:p[Math.max(0,Math.min(m-1,i))],segs=closed?m:m-1;
 for(let i=0;i<segs;i++){const a=g(i-1),b=g(i),c=g(i+1),d=g(i+2);for(let k=0;k<n;k++){const t=k/n,t2=t*t,t3=t2*t,f=q=>.5*(2*b[q]+(-a[q]+c[q])*t+(2*a[q]-5*b[q]+4*c[q]-d[q])*t2+(-a[q]+3*b[q]-3*c[q]+d[q])*t3);out.push([f(0),f(1)])}}
 if(!closed)out.push(p[m-1]);return out}
function artPoly(sh){if(sh.t==='ell'){const n=56,r=(sh.rot||0)*Math.PI/180,co=Math.cos(r),si=Math.sin(r),P=[];for(let i=0;i<n;i++){const a=i/n*Math.PI*2,x=Math.cos(a)*sh.r[0],y=Math.sin(a)*sh.r[1];P.push([sh.c[0]+x*co-y*si,sh.c[1]+x*si+y*co])}return P}
 return sh.smooth?artSpline(sh.p,sh.t!=='line'&&sh.closed!==false,sh.n||8):sh.p}
function artFill(f){if(typeof f==='string'){const c=hexRGB(f);return{c:[c[0]*255,c[1]*255,c[2]*255]}}
 return{g:f,st:f.stops.map(s=>{const c=hexRGB(s[1]);return[s[0],c[0]*255,c[1]*255,c[2]*255,s[2]===undefined?1:s[2]]})}}
function artCol(F,x,y,u,v,view){if(F.c)return[F.c[0],F.c[1],F.c[2],1];const g=F.g,uu=view[0]+(x/ (F.W))*(view[2]-view[0]),vv=view[1]+(y/F.H)*(view[3]-view[1]);let t;
 if(g.g==='rad')t=Math.hypot((uu-g.c[0])/g.r[0],(vv-g.c[1])/g.r[1]);else{const dx=g.b[0]-g.a[0],dy=g.b[1]-g.a[1];t=((uu-g.a[0])*dx+(vv-g.a[1])*dy)/(dx*dx+dy*dy)}
 const S=F.st;if(t<=S[0][0])return S[0].slice(1);for(let i=1;i<S.length;i++)if(t<=S[i][0]){const f=(t-S[i-1][0])/Math.max(1e-9,S[i][0]-S[i-1][0]);return[1,2,3,4].map(k=>S[i-1][k]+(S[i][k]-S[i-1][k])*f)}return S[S.length-1].slice(1)}
function artScan(P,cov,x0,y0,bw,bh){const n=P.length,SS=4;for(let r=0;r<bh;r++)for(let s=0;s<SS;s++){const yy=y0+r+(s+.5)/SS,xs=[];for(let i=0;i<n;i++){const a=P[i],b=P[(i+1)%n];if((a[1]<=yy)!==(b[1]<=yy))xs.push(a[0]+(yy-a[1])/(b[1]-a[1])*(b[0]-a[0]))}xs.sort((p,q)=>p-q);
  for(let k=0;k+1<xs.length;k+=2){let xa=xs[k]-x0,xb=xs[k+1]-x0;if(xb<=0||xa>=bw)continue;xa=Math.max(0,xa);xb=Math.min(bw,xb);const ia=Math.floor(xa),ib=Math.floor(xb);if(ia===ib)cov[r*bw+ia]+=(xb-xa)/SS;else{cov[r*bw+ia]+=(ia+1-xa)/SS;for(let q=ia+1;q<ib;q++)cov[r*bw+q]+=1/SS;if(ib<bw)cov[r*bw+ib]+=(xb-ib)/SS}}}}
function artStroke(P,closed,w0,w1,cov,x0,y0,bw,bh){const n=P.length,segs=closed?n:n-1,cum=[0];for(let s=0;s<segs;s++){const a=P[s],b=P[(s+1)%n];cum.push(cum[s]+Math.hypot(b[0]-a[0],b[1]-a[1]))}const tot=cum[segs]||1,wm=Math.max(w0,w1);
 for(let s=0;s<segs;s++){const a=P[s],b=P[(s+1)%n],h=wm/2+1,ax=Math.max(x0,Math.floor(Math.min(a[0],b[0])-h)),ay=Math.max(y0,Math.floor(Math.min(a[1],b[1])-h)),bx=Math.min(x0+bw-1,Math.ceil(Math.max(a[0],b[0])+h)),by=Math.min(y0+bh-1,Math.ceil(Math.max(a[1],b[1])+h)),dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy||1e-9,sl=Math.sqrt(l2);
  for(let y=ay;y<=by;y++)for(let x=ax;x<=bx;x++){const px=x+.5,py=y+.5,t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/l2)),d=Math.hypot(px-a[0]-dx*t,py-a[1]-dy*t),w=w0+(w1-w0)*((cum[s]+t*sl)/tot),c=Math.max(0,Math.min(1,w/2+.5-d)),i=(y-y0)*bw+(x-x0);if(c>cov[i])cov[i]=c}}}
function rasterArt(W,H,shapes,view){view=view||[0,0,1,1];const sx=W/(view[2]-view[0]),sy=H/(view[3]-view[1]),X=u=>(u-view[0])*sx,Y=v=>(v-view[1])*sy,out=new Float32Array(W*H*4);
 const blend=(i,c,al)=>{const ad=out[i+3],ao=al+ad*(1-al);if(ao<=0)return;for(let k=0;k<3;k++)out[i+k]=(c[k]*al+out[i+k]*ad*(1-al))/ao;out[i+3]=ao};
 for(const sh of shapes){const fa=sh.a===undefined?1:sh.a,P=artPoly(sh).map(p=>[X(p[0]),Y(p[1])]);if(P.length<2)continue;let bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;P.forEach(p=>{bx0=Math.min(bx0,p[0]);by0=Math.min(by0,p[1]);bx1=Math.max(bx1,p[0]);by1=Math.max(by1,p[1])});
  const isLine=sh.t==='line',sw=(sh.sw||0)*sx,sw2=(sh.sw2===undefined?sh.sw||0:sh.sw2)*sx,doS=isLine||(sh.stroke&&sw>0),pad=(doS?Math.max(sw,sw2)/2+1:0)+1,x0=Math.max(0,Math.floor(bx0-pad)),y0=Math.max(0,Math.floor(by0-pad)),x1=Math.min(W-1,Math.ceil(bx1+pad)),y1=Math.min(H-1,Math.ceil(by1+pad)),bw=x1-x0+1,bh=y1-y0+1;if(bw<=0||bh<=0)continue;
  let clipC=null;if(sh.clip){clipC=new Float32Array(bw*bh);artScan(sh.clip.map(p=>[X(p[0]),Y(p[1])]),clipC,x0,y0,bw,bh)}
  const paint=(cov,F)=>{F.W=W;F.H=H;for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){let c=Math.min(1,cov[y*bw+x]);if(c<=0)continue;if(clipC)c*=Math.min(1,clipC[y*bw+x]);if(c<=0)continue;const i=((y0+y)*W+x0+x)*4;
    if(sh.erase){out[i+3]*=1-c;continue}const q=artCol(F,x0+x+.5,y0+y+.5,0,0,view);blend(i,q,c*q[3]*fa)}};
  if(!isLine&&((sh.fill!==undefined&&sh.fill!==null)||sh.erase)&&P.length>2){const cov=new Float32Array(bw*bh);artScan(P,cov,x0,y0,bw,bh);paint(cov,artFill(sh.fill||'#000000'))}
  if(doS){const cov=new Float32Array(bw*bh);artStroke(P,!isLine&&sh.closed!==false,sw,sw2,cov,x0,y0,bw,bh);paint(cov,artFill(isLine?(sh.col||sh.stroke||'#000000'):sh.stroke))}}
 const u8=new Uint8ClampedArray(W*H*4);for(let i=0;i<W*H;i++){u8[i*4]=out[i*4];u8[i*4+1]=out[i*4+1];u8[i*4+2]=out[i*4+2];u8[i*4+3]=Math.round(out[i*4+3]*255)}return u8}
function eyeOutline(c,w,h,s,n){n=n||8;const inn=[c[0]-s*w/2,c[1]+h*.04],out=[c[0]+s*w/2,c[1]-h*.06],top=[c[0]+s*w*.06,c[1]-h/2],bot=[c[0]+s*w*.02,c[1]+h*.36],q=(a,b,k,t)=>[(1-t)*(1-t)*a[0]+2*(1-t)*t*k[0]+t*t*b[0],(1-t)*(1-t)*a[1]+2*(1-t)*t*k[1]+t*t*b[1]],
  kt=[c[0]+s*w*.04,c[1]-h*.95],kb=[c[0]+s*w*.02,c[1]+h*.7],U=[],B=[];for(let i=0;i<=n;i++)U.push(q(inn,out,kt,i/n));for(let i=0;i<=n;i++)B.push(q(out,inn,kb,i/n));return{upper:U,lower:B,poly:U.concat(B.slice(1,-1))}}
// аниме-лицо: слои с областью (crop) в единицах холста 0..1; lm: ориентиры
function animeArt(o){o=o||{};const sk=o.skin||'#ffe3d2',skd=hexMul(sk,.9),hr=o.hair||'#4a3a6a',hrd=hexMul(hr,.45),hrl=hexMix(hr,'#ffffff',.35),ey=o.eye||'#3aa0d8',es=(o.eyeSize||1)*1.2,st=o.hairStyle||'long',bang=o.bangs||'straight',cloth=o.cloth||'#3a4a7a',oc=hexMul(sk,.55),
  eyeW=.125*es,eyeH=.1*es,ex=.095,ey0=.475,fW=o.faceWidth||1,L=[],R0=o.real;
 const fx=x=>.5+(x-.5)*fW;
 const face=[[.5,.14],[.62,.16],[.71,.26],[.73,.40],[.70,.54],[.62,.66],[.54,.72],[.5,.735],[.46,.72],[.38,.66],[.30,.54],[.27,.40],[.29,.26],[.38,.16]].map(p=>[fx(p[0]),p[1]]);
 const lm={eyeL:[.5+ex,ey0],eyeR:[.5-ex,ey0],browL:[.5+ex,.365],browR:[.5-ex,.365],mouth:[.5,.62],nose:[.5,.53],cheekL:[.63,.56],cheekR:[.37,.56],chin:[.5,.735],face:[.5,.42]};
 // волосы сзади
 const bot=({long:.98,bob:.7,short:.5,twin:.55})[st]||.9,hb=[[.5,.07],[.66,.09],[.78,.2],[.82,.4],[.83,(.4+bot)/2],[.84,bot],[.7,bot-.02],[.66,.7],[.34,.7],[.3,bot-.02],[.16,bot],[.17,(.4+bot)/2],[.18,.4],[.22,.2],[.34,.09]];
 const hbS=[{t:'poly',p:hb,smooth:true,fill:hexMul(hr,.8),stroke:hrd,sw:.004}];
 if(st==='twin')[-1,1].forEach(s=>hbS.push({t:'ell',c:[.5+s*.36,.62],r:[.07,.2],rot:s*10,fill:hexMul(hr,.8),stroke:hrd,sw:.004}));
 L.push({n:'hairBack',crop:[0,0,1,1],z:0,px:256,shapes:hbS});
 L.push({n:'body',crop:[0,.66,1,1],z:1,px:256,shapes:[{t:'poly',p:[[.44,.66],[.56,.66],[.57,.84],[.43,.84]],fill:skd},{t:'poly',p:[[.08,1],[.16,.9],[.34,.83],[.44,.8],[.5,.84],[.56,.8],[.66,.83],[.84,.9],[.92,1]],smooth:true,fill:cloth,stroke:hexMul(cloth,.5),sw:.004},{t:'poly',p:[[.44,.8],[.5,.88],[.56,.8]],fill:'#ffffff'}]});
 L.push({n:'face',crop:[.2,.08,.8,.8],z:2,px:256,shapes:[{t:'ell',c:[.265,.42],r:[.022,.035],fill:sk,stroke:oc,sw:.003},{t:'ell',c:[.735,.42],r:[.022,.035],fill:sk,stroke:oc,sw:.003},
  {t:'poly',p:face,smooth:true,fill:sk,stroke:oc,sw:.004},{t:'ell',c:[.5,.3],r:[.17,.09],fill:{g:'rad',c:[.5,.3],r:[.17,.09],stops:[[0,skd,.5],[1,skd,0]]}},
  ]});
 L.push({n:'decor',crop:[.3,.5,.7,.6],z:2.5,px:128,shapes:[{t:'ell',c:lm.cheekR,r:[.055,.026],fill:{g:'rad',c:lm.cheekR,r:[.055,.026],stops:[[0,'#ff8a9a',.6],[1,'#ff8a9a',0]]}},{t:'ell',c:lm.cheekL,r:[.055,.026],fill:{g:'rad',c:lm.cheekL,r:[.055,.026],stops:[[0,'#ff8a9a',.6],[1,'#ff8a9a',0]]}},{t:'line',p:[[.497,.517],[.499,.537],[.51,.542]],smooth:false,sw:.004,col:hexMul(sk,.72)}]});
 [['L',1],['R',-1]].forEach(([id,s])=>{const c=lm['eye'+id],eo=eyeOutline(c,eyeW,eyeH,s),cr=[c[0]-.1,c[1]-.085,c[0]+.1,c[1]+.075],ir=[.046*es,.052*es];
  const top=c[1]-eyeH*.45,bot=c[1]+eyeH*.35;L.push({n:'eye'+id+'_white',crop:cr,z:3,px:128,eye:id,top,bot,shapes:[{t:'poly',p:eo.poly,smooth:true,fill:{g:'lin',a:[c[0],c[1]-eyeH/2],b:[c[0],c[1]+eyeH/2],stops:[[0,'#d8d0e8'],[.4,'#ffffff'],[1,'#ffffff']]}}]});
  L.push({n:'eye'+id+'_iris',crop:cr,z:4,px:128,eye:id,top,bot,shapes:[{t:'ell',c:c,r:ir,clip:eo.poly,fill:{g:'rad',c:c,r:ir,stops:[[0,hexMix(ey,'#ffffff',.35)],[.55,ey],[.9,hexMul(ey,.45)],[1,hexMul(ey,.25)]]}},
   {t:'ell',c:c,r:[ir[0]*.42,ir[1]*.45],clip:eo.poly,fill:'#14101c'},{t:'ell',c:[c[0]-s*.014,c[1]-.016*es],r:[.013*es,.015*es],clip:eo.poly,fill:'#ffffff'},{t:'ell',c:[c[0]+s*.015,c[1]+.016*es],r:[.006*es,.007*es],clip:eo.poly,fill:'#ffffff',a:.85},
   {t:'ell',c:[c[0],c[1]+.03*es],r:[ir[0]*.8,ir[1]*.35],clip:eo.poly,fill:hexMix(ey,'#ffffff',.5),a:.35}]});
  const fl=[c[0]+s*(eyeW/2+.012),c[1]-eyeH*.28];
  L.push({n:'eye'+id+'_lash',crop:cr,z:5,px:128,eye:id,top,bot,shapes:[{t:'line',p:eo.upper.concat([fl]),smooth:false,sw:.0075,sw2:.002,col:'#1c1424'},{t:'line',p:eo.lower,sw:.0025,sw2:.0025,col:hexMul(sk,.45),a:.6},{t:'line',p:eo.upper.map(p=>[p[0],p[1]-.014*es]),smooth:false,sw:.002,sw2:.001,col:hexMul(sk,.6),a:.7}]})});
 [['L',1],['R',-1]].forEach(([id,s])=>{const c=lm['brow'+id];L.push({n:'brow'+id,side:id,crop:[c[0]-.07,c[1]-.04,c[0]+.07,c[1]+.04],z:6,px:64,brow:id,shapes:[{t:'line',p:[[c[0]-s*.05,c[1]+.004],[c[0],c[1]-.006],[c[0]+s*.05,c[1]+.001]],smooth:true,sw:R0?.011:.008,sw2:.002,col:hexMul(hr,.8)}]})});
 const m=lm.mouth;L.push({n:'mouth',crop:[m[0]-.07,m[1]-.045,m[0]+.07,m[1]+.045],z:7,px:96,shapes:[{t:'ell',c:m,r:[.032,.02],fill:'#7a2535',stroke:'#4a1220',sw:.003},{t:'ell',c:[m[0],m[1]+.011],r:[.02,.009],fill:'#ff8a9a'},{t:'poly',p:[[m[0]-.026,m[1]-.012],[m[0]+.026,m[1]-.012],[m[0]+.022,m[1]-.004],[m[0]-.022,m[1]-.004]],fill:'#ffffff'}]});
 // чёлка
 const bp=[[fx(.265),.42],[fx(.27),.26],[fx(.34),.15],[.5,.115],[fx(.66),.15],[fx(.73),.26],[fx(.735),.42]];
 const tips=bang==='parted'?[[.68,.33],[.62,.40],[.56,.30],[.5,.36],[.44,.30],[.38,.40],[.32,.33]]:[[.70,.37],[.65,.31],[.60,.38],[.55,.31],[.5,.38],[.45,.31],[.40,.38],[.35,.31],[.30,.37]];
 const hf=[{t:'poly',p:bp.concat(tips.map(p=>[fx(p[0]),p[1]])),smooth:true,n:5,fill:hr,stroke:hrd,sw:.004},{t:'line',p:[[fx(.34),.2],[.5,.17],[fx(.66),.2]],smooth:true,sw:.02,sw2:.008,col:hrl,a:.4}];
 [-1,1].forEach(s=>hf.push({t:'poly',p:[[fx(.5+s*.225),.3],[fx(.5+s*.235),.5],[fx(.5+s*.2),.64],[fx(.5+s*.2),.45]],smooth:true,fill:hr,stroke:hrd,sw:.004}));
 L.push({n:'hairFront',crop:[0,0,1,.75],z:8,px:256,shapes:hf});
 return{layers:L,lm,size:1}}
// лицо 3D: текстура глаза (равнопромежуточная развёртка, радужка в u=.25,v=.5), шейпы в единицах 0..1
function eyeTexShapes(o){o=o||{};const real=o.style==='real',ey=o.eye||'#3aa0d8',a=o.iris||(real?24:32),rx=a/360,ry=a/180,c=[.25,.5],S=[{t:'poly',p:[[0,0],[1,0],[1,1],[0,1]],fill:{g:'lin',a:[0,0],b:[0,1],stops:[[0,'#d9d2e0'],[.35,'#f4f1f5'],[.7,'#ffffff']]}}];
 S.push({t:'ell',c,r:[rx,ry],fill:{g:'rad',c,r:[rx,ry],stops:[[0,hexMix(ey,'#ffffff',real?.1:.35)],[.55,ey],[.88,hexMul(ey,.45)],[1,hexMul(ey,.2)]]}});
 if(real)for(let i=0;i<28;i++){const t=i/28*Math.PI*2;S.push({t:'line',p:[[c[0]+Math.cos(t)*rx*.3,c[1]+Math.sin(t)*ry*.3],[c[0]+Math.cos(t)*rx*.92,c[1]+Math.sin(t)*ry*.92]],sw:.0035,sw2:.0015,col:i%2?hexMul(ey,.6):hexMix(ey,'#ffffff',.3),a:.35})}
 S.push({t:'ell',c,r:[rx*.4,ry*.42],fill:'#100c14'},{t:'ell',c:[c[0]-10/360,c[1]-10/180],r:[rx*.34,ry*.36],fill:'#ffffff',a:real?.85:1},{t:'ell',c:[c[0]+9/360,c[1]+9/180],r:[rx*.16,ry*.17],fill:'#ffffff',a:.8});
 return S}
// управление лицом по времени: списком кадров {t,c:{blinkL,blinkR,open,smile,mouthO,browL,browR,angry,sad,wide,narrow,lookX,lookY,yaw,pitch,roll}}
function faceCtl(o){o=o||{};const clip=o.clip||'idle',T=o.duration||4,fps=o.fps||15,R=rng(o.seed||1),n=Math.round(T*fps),fr=[],sm=x=>x*x*(3-2*x);
 const bl=[];for(let t=.8+R()*1.2;t<T-.6;t+=2.4+R()*2.2){bl.push(t);if(R()<.2)bl.push(t+.32)}
 const sac=[[0,0,0]];for(let t=.6;t<T-.4;t+=.7+R()*1.6)sac.push([t,(R()*2-1)*.7,(R()*2-1)*.45]);sac.push([T,0,0]);
 const syl=[];if(clip==='talk'){for(let t=.2;t<T-.5;t+=.13+R()*.12)syl.push([t,R()<.2?0:.25+R()*.75,R()<.25?1:0])}
 const mood=({idle:{},talk:{brow:.1},happy:{smile:.8,narrow:.35,brow:.25},angry:{angry:.9,smile:-.5,narrow:.3,brow:-.2},sad:{sad:.8,smile:-.5,narrow:.25,brow:.1},surprised:{wide:1,open:.55,brow:.9,mouthO:.5},sleepy:{narrow:.7,smile:.05}})[clip]||{};
 const look=t=>{let i=0;while(i<sac.length-2&&sac[i+1][0]<=t)i++;const a=sac[i],b=sac[i+1],f=sm(Math.min(1,Math.max(0,(t-a[0])/.18)));return[a[1]+(b[1]-a[1])*0,a[2]]};
 const lookAt=t=>{let i=0;while(i<sac.length-1&&sac[i+1][0]<=t)i++;const a=sac[i],b=sac[Math.min(i+1,sac.length-1)],f=sm(Math.min(1,Math.max(0,(t-b[0]+.18)/.18)));return[a[1]+(b[1]-a[1])*(t>=b[0]-.18?f:0),a[2]+(b[2]-a[2])*(t>=b[0]-.18?f:0)]};
 for(let i=0;i<=n;i++){const t=i/fps,c={};let b=0;bl.forEach(s=>{const d=t-s;if(d>=0&&d<.2)b=Math.max(b,Math.min(1,1.4*(d<.07?d/.07:1-(d-.07)/.13)))});const ls=clip==='sleepy'?.5:0;
  let op=0,oo=0;if(syl.length){let j=0;while(j<syl.length-1&&syl[j+1][0]<=t)j++;const s=syl[j],d=t-s[0];if(d>=0&&d<.2){const e=Math.sin(Math.PI*d/.2);op=s[1]*e;oo=s[2]*e*.8}}
  const lk=lookAt(t),w=Math.PI*2/T,yw=clip==='turn'?35*Math.sin(w*t):3*Math.sin(w*t)+(clip==='talk'?2*Math.sin(w*t*3):0);
  Object.assign(c,{blinkL:Math.max(b,ls*(mood.narrow||0)),blinkR:Math.max(b,ls*(mood.narrow||0)),open:Math.max(op*(i===n?0:1),mood.open||0),smile:(mood.smile||0)*(1-.3*op),mouthO:Math.max(oo,mood.mouthO||0),browL:(mood.brow||0)+(op>.5?.2:0),browR:(mood.brow||0)+(op>.5?.2:0),angry:mood.angry||0,sad:mood.sad||0,wide:mood.wide||0,narrow:clip==='sleepy'?0:(mood.narrow||0),lookX:lk[0],lookY:lk[1],
   yaw:yw,turn:yw/35,pitch:1.5*Math.sin(w*t*2)+(clip==='sad'?-6:0)+(clip==='happy'?2:0),roll:1*Math.sin(w*t+1)});fr.push({t:+t.toFixed(4),c})}
 const f0=fr[0].c,fl=fr[n].c;['blinkL','blinkR','open','mouthO','lookX','lookY'].forEach(k=>{if(k!=='open')fl[k]=f0[k]});fl.open=f0.open;fl.yaw=f0.yaw;fl.turn=f0.turn;fl.pitch=f0.pitch;fl.roll=f0.roll;return fr}
// ===== карточки-пупеты, лицо 3D, аксессуары, антропоморфы =====
function gridMesh(gx,gy,w,h){const v=[],uv=[],f=[];for(let j=0;j<=gy;j++)for(let i=0;i<=gx;i++){v.push(+((i/gx-.5)*w).toFixed(5),+((.5-j/gy)*h).toFixed(5),0);uv.push(i/gx,1-j/gy)}for(let j=0;j<gy;j++)for(let i=0;i<gx;i++){const a=j*(gx+1)+i,b=a+1,c=a+gx+1,d=c+1;f.push(a,c,b,b,c,d)}return{v,f,uv}}
// слой аниме-арта -> деформируемая карточка с формами. Ww,Hh: размер всего холста в метрах
function puppetBuild(L,Ww,Hh){const c=L.crop,cw=(c[2]-c[0])*Ww,ch=(c[3]-c[1])*Hh,role=/_(white|iris|lash)$/.test(L.n)?'eye':/^brow/.test(L.n)?'brow':L.n==='mouth'?'mouth':'static',gx=role==='eye'||role==='brow'?10:role==='mouth'?12:8,gy=role==='eye'?8:role==='brow'?4:8,g=gridMesh(gx,gy,cw,ch);
 let base=g.v;const sk={},rd=a=>a.map(x=>+x.toFixed(5)),W=(b,pins)=>warpMesh({v:b},pins,false),D=(a,b)=>rd(a.map((x,i)=>x-b[i]));
 if(role==='eye'){const mid=(c[1]+c[3])/2,yT=(mid-L.top)*Hh,yC=(mid-(L.top+L.bot)/2)*Hh,r=cw*3;sk.blink=D(W(base,[{at:[0,yT,0],sy:.07,r}]),base);sk.wide=D(W(base,[{at:[0,yC,0],sy:1.28,r}]),base);sk.narrow=D(W(base,[{at:[0,yT,0],sy:.62,r}]),base)}
 else if(role==='brow'){const s=L.side==='L'?1:-1,ix=-s*cw*.35,ox=s*cw*.35;sk.up=D(W(base,[{at:[0,0,0],by:[0,.012*Ww,0],r:cw*2}]),base);sk.down=D(W(base,[{at:[0,0,0],by:[0,-.01*Ww,0],r:cw*2}]),base);
  sk.angry=D(W(base,[{at:[ix,0,0],by:[0,-.014*Ww,0],r:cw*.7},{at:[ox,0,0],by:[0,.006*Ww,0],r:cw*.7}]),base);sk.sad=D(W(base,[{at:[ix,0,0],by:[0,.014*Ww,0],r:cw*.7},{at:[ox,0,0],by:[0,-.004*Ww,0],r:cw*.7}]),base)}
 else if(role==='mouth'){const nat=base;base=W(nat,[{at:[0,0,0],sy:.12,r:cw*5}]);sk.open=D(nat,base);sk.o=D(W(base,[{at:[0,0,0],sx:.62,sy:4,r:cw*5}]),base);
  sk.smile=D(W(base,[{at:[-cw*.3,0,0],by:[0,.016*Ww,0],r:cw*.35},{at:[cw*.3,0,0],by:[0,.016*Ww,0],r:cw*.35},{at:[0,0,0],by:[0,-.004*Ww,0],r:cw*.3}]),base);
  sk.frown=D(W(base,[{at:[-cw*.3,0,0],by:[0,-.014*Ww,0],r:cw*.35},{at:[cw*.3,0,0],by:[0,-.014*Ww,0],r:cw*.35},{at:[0,0,0],by:[0,.004*Ww,0],r:cw*.3}]),base)}
 const m={v:rd(base),f:g.f,uv:g.uv};if(Object.keys(sk).length)m.sk=sk;m.role=role;return m}
// накладывает карточку на эллипсоид головы: вершины и формы
function drapeMesh(m,off,rad,eps){const fz=(x,y)=>rad[2]*Math.sqrt(Math.max(.04,1-(x/rad[0])**2-(y/rad[1])**2))+eps,P=(a,ox)=>{const o=[];for(let i=0;i<a.length;i+=3){const x=a[i]+off[0]+(ox?0:0),y=a[i+1]+off[1];o.push(+x.toFixed(5),+y.toFixed(5),+fz(x,y).toFixed(5))}return o},base=P(m.v),r={v:base,f:m.f,uv:m.uv};
 if(m.sk){r.sk={};Object.keys(m.sk).forEach(k=>{const d=m.sk[k],w=m.v.map((x,i)=>x+d[i]),q=P(w);r.sk[k]=q.map((x,i)=>+(x-base[i]).toFixed(5))})}return r}
// веко: полоса сферы, ось вверх; e0..e1 высота над экватором, az полуширина по азимуту (градусы); цвет кожи, у свободного края тёмная ресничная линия
function lidShell(r,e0,e1,az,skin,edgeCol,upper){const v=[],f=[],c=[],NA=10,NE=5,sk=hexRGB(skin),ec=hexRGB(edgeCol);
 for(let j=0;j<=NE;j++)for(let i=0;i<=NA;i++){const t=j/NE,e=(e0+(e1-e0)*t)*Math.PI/180,a=(-az+2*az*i/NA)*Math.PI/180;v.push(+(r*Math.sin(a)*Math.cos(e)).toFixed(5),+(r*Math.sin(e)).toFixed(5),+(r*Math.cos(a)*Math.cos(e)).toFixed(5));
  const edge=upper?(1-t):t,k=Math.max(0,1-edge/.18)*(1-Math.abs(i/NA*2-1)*.2);c.push(...[0,1,2].map(q=>+(sk[q]+(ec[q]-sk[q])*k).toFixed(3)))}
 for(let j=0;j<NE;j++)for(let i=0;i<NA;i++){const a=j*(NA+1)+i,b=a+1,cc=a+NA+1,d=cc+1;f.push(a,cc,b,b,cc,d)}return{v,f,c}}
function faceHeadPins(hw,hh,hd,style,eyeY,re){const zs=hd*Math.sqrt(Math.max(.1,1-.16-(eyeY/hh)**2)),real=style==='real',p=[];
 [1,-1].forEach(s=>p.push({at:[s*.4*hw,eyeY,zs],by:[0,0,-re*(real?.55:.35)],r:re*1.9}));
 p.push({at:[0,-.7*hh,hd*.3],sx:real?.9:.8,r:.8*hh});p.push({at:[0,-.85*hh,hd*.4],by:[0,-.06*hh,.01*hd],r:.45*hh});p.push({at:[0,eyeY-.3*hh,hd*.92],by:[0,0,(real?.1:.045)*hd],r:.14*hh});return p}
// 3D-лицо: глаза-сферы с радужкой, веки, брови и рот накладками. c центр головы, r [hw,hh,hd]
function face3dParts(o){const c=o.c,r=o.r,hw=r[0],hh=r[1],hd=r[2],anime=o.style!=='real',re=hw*(anime?.27:.18),eyeY=(anime?.04:.12)*hh,ex=.4*hw,zs=hd*Math.sqrt(Math.max(.1,1-.16-(eyeY/hh)**2)),skin=o.skin||'#ffe3d2',P=[],par=o.parent||'head',
  edge=hexMul(skin,.35);
 [1,-1].forEach((s,i)=>{const Sd=i?'R':'L',ep=[+(c[0]+s*ex).toFixed(4),+(c[1]+eyeY).toFixed(4),+(c[2]+zs-re*.55).toFixed(4)];
  P.push({n:'eye_'+Sd,type:'sphere',size:[+re.toFixed(4)],pos:ep,color:'#ffffff',rough:.12,role:'eye',side:Sd,depth:1,parent:par,pv:ep,fc:'eye',eyeTex:{style:o.style,eye:o.eye}});
  const lr=+(re*1.08).toFixed(4);P.push({n:'lid_up_'+Sd,type:'mesh',size:lidShell(lr,anime?38:30,92,70,skin,edge,true),pos:ep,color:'#ffffff',rough:.6,role:'lid',side:Sd,depth:1,parent:par,pv:ep,fc:'lidU'});
  P.push({n:'lid_low_'+Sd,type:'mesh',size:lidShell(lr,-88,-48,62,skin,edge,false),pos:ep,color:'#ffffff',rough:.6,role:'lid',side:Sd,depth:2,parent:par,pv:ep,fc:'lidL'})});
 if(!anime){const my=eyeY-.5*hh,zf=y=>hd*Math.sqrt(Math.max(.1,1-(y/hh)**2)),r4=v=>+v.toFixed(4),dk=hexMul(skin,.55),sk2=hexMul(skin,.93),E=(n,sz,pos,e)=>Object.assign({n,type:'ellipsoid',size:sz.map(r4),pos:pos.map(r4),color:skin,rough:.55,role:'face',side:'C',depth:1,parent:par,pv:[c[0],c[1],c[2]]},e);
  const ny=eyeY-.36*hh;P.push(E('nose_bridge',[hw*.05,hh*.17,hd*.06],[c[0],c[1]+eyeY-.15*hh,c[2]+zf(eyeY-.15*hh)+hd*.015]),E('nose_tip',[hw*.1,hh*.07,hd*.085],[c[0],c[1]+ny,c[2]+zf(ny)+hd*.04]));
  [1,-1].forEach((s,i)=>{const Sd=i?'R':'L';P.push(E('nostril_'+Sd,[hw*.035,hh*.02,hd*.03],[c[0]+s*hw*.075,c[1]+ny-.03*hh,c[2]+zf(ny)+hd*.065],{color:dk}),E('nose_wing_'+Sd,[hw*.06,hh*.05,hd*.05],[c[0]+s*hw*.085,c[1]+ny-.01*hh,c[2]+zf(ny)+hd*.015]),
   E('ear_'+Sd,[hw*.07,hh*.2,hd*.11],[c[0]+s*hw*.99,c[1]-.02*hh,c[2]-hd*.05],{rot:[0,0,s*-8],color:sk2,side:Sd,role:'ear'}),E('earin_'+Sd,[hw*.035,hh*.12,hd*.06],[c[0]+s*hw*1.0,c[1]-.02*hh,c[2]-hd*.02],{color:hexMul(skin,.8),side:Sd,role:'ear',depth:2}))});
  const lc='#b86a6a',lp=(y,wd,e)=>{const z=c[2]+zf(y)+hd*.012;return{type:'tube',size:[[-wd,0,0,hh*.028],[0,e,hd*.012,hh*.034],[wd,0,0,hh*.028]].map(q=>q.map(r4)),pos:[r4(c[0]),r4(c[1]+y),r4(z)],color:lc,rough:.4,side:'C',parent:par}};
  P.push({n:'lip_up',...lp(my,hw*.2,hh*.012),role:'lip',depth:1,pv:[c[0],c[1]+my,c[2]]},{n:'lip_low',...lp(my-.055*hh,hw*.17,-hh*.01),role:'lip',depth:1,fc:'jaw',pv:[r4(c[0]),r4(c[1]-.05*hh),r4(c[2]+hd*.2)]})}
 return{parts:P,re,eyeY,kw:2*hw/.46,kh:2*hh/.6,zs}}
// управление лицом -> ключи. rig: части {n,pos,rot,parent,pv,fc,side,dx,dy}, frames из faceCtl
function faceAnimKeys(rig,frames,o){o=o||{};const f=[0,0,1],ax=[1,0,0],up=[0,1,0],keys=[];
 for(const fr of frames){const c=fr.c,A={},T={},Wt={};const rootAng=qMul(qAxis([0,0,1],c.roll),qMul(qAxis(ax,-c.pitch),qAxis(up,c.yaw)));
  rig.forEach(p=>{const L=p.side==='L',bl=L?c.blinkL:c.blinkR,k=p.fc;
   if(p.tz)T[p.n]=[(c.turn||0)*p.tz,0,0];
   if(k==='root')A[p.n]=rootAng;
   else if(k==='eye')A[p.n]=[-c.lookY*14,c.lookX*18,0];
   else if(k==='lidU')A[p.n]=[Math.min(78,bl*62+c.narrow*22-c.wide*14),0,0];
   else if(k==='lidL')A[p.n]=[-(bl*10+c.narrow*6),0,0];
   else if(k==='jaw')A[p.n]=[c.open*20,0,0];
   else if(k==='iris'){const t0=T[p.n]||[0,0,0];T[p.n]=[t0[0]+c.lookX*(p.dx||.01),t0[1]+c.lookY*(p.dy||.006),0]}
   else if(k==='eyeCard')Wt[p.n]={blink:+bl.toFixed(3),wide:+c.wide.toFixed(3),narrow:+c.narrow.toFixed(3)};
   else if(k==='brow'){const b=L?c.browL:c.browR;Wt[p.n]={up:+Math.max(0,b).toFixed(3),down:+Math.max(0,-b).toFixed(3),angry:+c.angry.toFixed(3),sad:+c.sad.toFixed(3)}}
   else if(k==='mouth')Wt[p.n]={open:+c.open.toFixed(3),o:+c.mouthO.toFixed(3),smile:+Math.max(0,c.smile).toFixed(3),frown:+Math.max(0,-c.smile).toFixed(3)}});
  const poses=fkPose(rig,A,T);Object.keys(Wt).forEach(n=>{poses[n].w=Wt[n]});keys.push({t:fr.t,poses})}
 return keys}
// ===== аксессуары =====
function wingMesh(kind,sh,el,tip,sg,col,col2){const M={v:[],f:[],c:[],uv:[]},c1=hexRGB(col),c2=hexRGB(col2||col),push=(p,c)=>{M.v.push(+p[0].toFixed(4),+p[1].toFixed(4),+p[2].toFixed(4));M.c.push(c[0],c[1],c[2])};
 if(kind==='bat'||kind==='dragon'){const F=[0,1,2,3].map(i=>[el[0]+(tip[0]-el[0])*(1-.15*i)+sg*.0,el[1]+(tip[1]-el[1])*(1-.15*i)-i*(tip[0]-el[0])*.18*0-i*.18*Math.abs(tip[0]-el[0]),el[2]+(tip[2]-el[2])*(1-.15*i)-i*.12*Math.abs(tip[0]-el[0])]),B=[sh[0],sh[1]-Math.abs(tip[0]-sh[0])*.55,sh[2]-.04];
  [sh,el,...F,B].forEach((p,i)=>push(p,i<2?c1:c2));for(let i=2;i<5;i++)M.f.push(0,i,i+1);M.f.push(0,5,6);M.f.push(0,1,2)}
 else{const bones=[sh,el,tip];for(let i=0;i<11;i++){const t=.12+i/11*.88,seg=t<.5?0:1,a=bones[seg],b=bones[seg+1],q=(t-seg*.5)*2,b0=[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q,a[2]+(b[2]-a[2])*q],u=vN([sg*.35,-.55-.25*t,-.75]),len=.22+.35*Math.sin(Math.PI*Math.min(1,t*.9+.1)),side=vN(vC(u,[0,0,1]));leafAt(M,b0,u,side,len*.16,len,i%2?c1:c2)}}
 return M}
function addonParts(kind,style,x){const c=x.c,s=x.s,k=x.k||1,col=x.col||'#b08050',col2=x.col2||'#f0d0c0',par=x.parent,P=[],r=v=>+v.toFixed(4),ep=(n,sz,pos,e)=>Object.assign({n,type:'ellipsoid',size:sz.map(r),pos:pos.map(r),color:col,parent:par,depth:1,side:'C'},e);
 if(kind==='ears'){const T=({cat:{w:.22,h:.3,d:.08,x:.28,y:.46,z:-.05,a:12,in:true},fox:{w:.2,h:.45,d:.07,x:.3,y:.5,z:-.1,a:10,in:true},wolf:{w:.2,h:.36,d:.07,x:.3,y:.48,z:-.1,a:12,in:true},rabbit:{w:.14,h:.72,d:.05,x:.2,y:.65,z:-.1,a:6,in:true},dog:{w:.17,h:.34,d:.06,x:.46,y:.15,z:-.05,a:38,in:false},elf:{w:.42,h:.08,d:.04,x:.5,y:.0,z:-.05,a:-22,in:false},bear:{w:.2,h:.2,d:.1,x:.34,y:.42,z:-.1,a:0,in:true},mouse:{w:.3,h:.3,d:.06,x:.38,y:.42,z:-.1,a:0,in:true}})[style];if(!T)throw new Error('ears: cat fox wolf rabbit dog elf bear mouse');
  [1,-1].forEach((sg,i)=>{const Sd=i?'R':'L',w=T.w*s[0],h=T.h*s[1],px=c[0]+sg*T.x*s[0],py=c[1]+T.y*s[1]+(style==='rabbit'||style==='fox'||style==='wolf'||style==='cat'?h*.45:0),pz=c[2]+T.z*s[2],tilt=sg*T.a;
   P.push(ep('ear_'+Sd,[style==='elf'?w:w/2,style==='elf'?h:h/2,T.d*s[2]],[px,py,pz],{rot:[0,0,tilt],role:'ear',side:Sd,pv:[px,py-h*.4,pz]}));
   if(T.in)P.push(ep('earin_'+Sd,[w*.3,h*.38,T.d*s[2]*.6],[px,py-h*.02,pz+T.d*s[2]*.5],{rot:[0,0,tilt],color:col2,role:'ear',side:Sd,depth:2,parent:'ear_'+Sd,pv:[px,py-h*.4,pz]}))})}
 else if(kind==='horns'){[1,-1].forEach((sg,i)=>{const Sd=i?'R':'L',bx=c[0]+sg*.28*s[0],by=c[1]+.78*s[1],bz=c[2]+.1*s[2],hl=({small:.18,curved:.5,ram:.45,antlers:.7,demon:.55})[style];if(!hl)throw new Error('horns: small curved ram antlers demon');const L=hl*s[1];
   const pts=style==='ram'?[[0,0,0],[sg*.18,.1,-.08],[sg*.3,0,-.2],[sg*.28,-.18,-.2],[sg*.15,-.2,-.1]].map(p=>p.map(v=>v*L*2)):style==='antlers'?[[0,0,0],[sg*.1,.4,-.05],[sg*.2,.8,-.1],[sg*.15,1.1,-.1]].map(p=>p.map(v=>v*L)):style==='small'?[[0,0,0],[sg*.08,.5,0],[sg*.12,1,0]].map(p=>p.map(v=>v*L)):[[0,0,0],[sg*.1,.5,-.1],[sg*.18,.9,-.35],[sg*.12,1.1,-.65]].map(p=>p.map(v=>v*L));
   const rad=.075*s[0]*(style==='antlers'?.5:1);P.push({n:'horn_'+Sd,type:'tube',size:pts.map((p,j)=>[r(p[0]),r(p[1]),r(p[2]),r(rad*(1-j/(pts.length+.5)))]),pos:[r(bx),r(by),r(bz)],color:col2||'#d8d0c0',role:'horn',side:Sd,depth:1,parent:par,pv:[r(bx),r(by),r(bz)]});
   if(style==='antlers')P.push({n:'horn_'+Sd+'2',type:'tube',size:[[0,0,0],[sg*.2*L,.25*L,0],[sg*.4*L,.4*L,.05*L]].map((p,j)=>[r(p[0]),r(p[1]),r(p[2]),r(rad*.4*(1-j/3.5))]),pos:[r(bx+sg*.1*L),r(by+.4*L),r(bz-.05*L)],color:col2||'#d8d0c0',role:'horn',side:Sd,depth:2,parent:'horn_'+Sd,pv:[r(bx+sg*.1*L),r(by+.4*L),r(bz-.05*L)]})})}
 else if(kind==='tail'){const T=({fox:{n:5,len:.75,rad:[.05,.075,.085,.07,.03],up:.3},cat:{n:6,len:.8,rad:[.022,.02,.02,.02,.02,.018],up:.8},wolf:{n:5,len:.6,rad:[.04,.055,.06,.05,.025],up:-.2},lizard:{n:6,len:1.1,rad:[.06,.05,.04,.03,.02,.01],up:0},dragon:{n:7,len:1.6,rad:[.09,.08,.07,.06,.045,.03,.012],up:.1},puff:{n:1,len:.12,rad:[.07],up:.4}})[style];if(!T)throw new Error('tail: fox cat wolf lizard dragon puff');
  const L=T.len*k*(x.len||1),root=[c[0],c[1]-s[1]*.1,c[2]-s[2]*.5];let prev=root,pn=par;
  if(style==='puff'){P.push(ep('tail1',[T.rad[0]*k,T.rad[0]*k,T.rad[0]*k],[root[0],root[1]+.04*k,root[2]-.05*k],{role:'tail',pv:root,color:col2}));return P}
  for(let i=0;i<T.n;i++){const t=(i+1)/T.n,nx=[root[0]+Math.sin(i*.9)*.04*k*(style==='fox'||style==='wolf'?1:.4),root[1]+T.up*L*Math.sin(t*Math.PI*.6)*.8-(style==='lizard'||style==='dragon'?t*.15*k:0)+(style==='wolf'?-t*L*.45:0),root[2]-L*t],rr=T.rad[i]*k,rp=T.rad[Math.max(0,i-1)]*k,nm='tail'+(i+1);
   P.push({n:nm,type:'tube',size:[[0,0,0,r(rp)],[r(nx[0]-prev[0]),r(nx[1]-prev[1]),r(nx[2]-prev[2]),r(rr)]],pos:prev.map(r),color:(i===T.n-1&&(style==='fox'||style==='wolf'))?col2:col,role:'tail',side:'C',depth:i+1,parent:pn,pv:prev.map(r)});prev=nx;pn=nm}}
 else if(kind==='wings'){const Lw=(x.len||1)*s[1]*2.4,sty=style||'bird';if(!['bird','bat','dragon','angel'].includes(sty))throw new Error('wings: bird bat dragon angel');
  [1,-1].forEach((sg,i)=>{const Sd=i?'R':'L',sh=[c[0]+sg*.22*s[0],c[1]+.3*s[1],c[2]-.55*s[2]],el=[sh[0]+sg*Lw*.4,sh[1]+Lw*.3,sh[2]-Lw*.1],tp=[el[0]+sg*Lw*.5,el[1]+Lw*.05,el[2]-Lw*.2],sg2=sg;
   P.push({n:'wing_'+Sd+'1',type:'tube',size:[[0,0,0,r(.03*k)],[r(el[0]-sh[0]),r(el[1]-sh[1]),r(el[2]-sh[2]),r(.025*k)]],pos:sh.map(r),color:col,role:'wing',side:Sd,depth:1,parent:par,pv:sh.map(r)});
   P.push({n:'wing_'+Sd+'2',type:'tube',size:[[0,0,0,r(.025*k)],[r(tp[0]-el[0]),r(tp[1]-el[1]),r(tp[2]-el[2]),r(.015*k)]],pos:el.map(r),color:col,role:'wing',side:Sd,depth:2,parent:'wing_'+Sd+'1',pv:el.map(r)});
   P.push({n:'wing_'+Sd+'3',type:'mesh',size:wingMesh(sty,sh,el,tp,sg2,col2||col,col),pos:[0,0,0],color:'#ffffff',role:'wing',side:Sd,depth:3,parent:'wing_'+Sd+'2',pv:el.map(r)})})}
 else throw new Error('addon: ears horns tail wings');
 return P}
function anthroParts(sp,o){o=o||{};const T=({fox:{col:'#d9722b',bel:'#f4e8d8',tip:'#ffffff',sn:[.05,.042,.1],ear:'fox',tail:'fox',nose:'#1b1417'},wolf:{col:'#7d7d86',bel:'#d8d8dc',tip:'#cfcfd4',sn:[.055,.048,.12],ear:'wolf',tail:'wolf',nose:'#1b1417'},cat:{col:'#c9a063',bel:'#f1e6d0',tip:'#8a6a3a',sn:[.04,.034,.05],ear:'cat',tail:'cat',nose:'#d98a8a'},dog:{col:'#a8794a',bel:'#e8d6b8',tip:'#7a5636',sn:[.05,.044,.09],ear:'dog',tail:'wolf',nose:'#1b1417'},rabbit:{col:'#e8e2d8',bel:'#ffffff',tip:'#ffffff',sn:[.038,.034,.05],ear:'rabbit',tail:'puff',nose:'#e8a0a0'},bear:{col:'#6a4630',bel:'#8a6a50',tip:'#6a4630',sn:[.06,.05,.07],ear:'bear',tail:'puff',nose:'#1b1417'}})[sp];if(!T)throw new Error('anthro: fox wolf cat dog rabbit bear');
 const col=o.color||T.col,k=(o.height||1.75)/1.75,P=humanParts({...o,skin:col}),hd=P.find(p=>p.n==='head'),pl=P.find(p=>p.n==='pelvis'),r=v=>+v.toFixed(4),sn=T.sn.map(v=>v*k),hp=hd.pos,hs=hd.size;
 P.push(ellP('snout',[r(sn[0]),r(sn[1]),r(sn[2])],[hp[0],r(hp[1]-.03*k),r(hp[2]+hs[2]*.75+sn[2]*.45)],{color:col,role:'face',side:'C',depth:1,parent:'head',pv:hp.slice()}));
 P.push(ellP('nose',[r(sn[0]*.4),r(sn[1]*.35),r(sn[1]*.35)],[hp[0],r(hp[1]-.018*k),r(hp[2]+hs[2]*.75+sn[2]*1.35)],{color:T.nose,role:'face',side:'C',depth:1,parent:'head',pv:hp.slice()}));
 P.push(ellP('jaw',[r(sn[0]*.85),r(.016*k),r(sn[2]*.8)],[hp[0],r(hp[1]-.058*k),r(hp[2]+hs[2]*.65+sn[2]*.4)],{color:T.bel,role:'jaw',side:'C',depth:1,fc:'jaw',parent:'head',pv:[hp[0],r(hp[1]-.05*k),r(hp[2]+hs[2]*.3)]}));
 const hx={c:hp,s:[hs[0]*2,hs[1]*2,hs[2]*2],k,col,col2:'#f2b8b0',parent:'head'};P.push(...addonParts('ears',o.ears||T.ear,hx));
 P.push(...addonParts('tail',o.tail||T.tail,{c:pl.pos,s:[pl.size[0]*2,pl.size[1]*2,pl.size[2]*2],k,col,col2:T.tip,parent:'pelvis'}));
 if(o.digitigrade!==false)['L','R'].forEach(S=>{const sg=S==='L'?1:-1,hx0=.095*sg*k,s1=P.find(p=>p.n==='leg_'+S+'1'),s2=P.find(p=>p.n==='leg_'+S+'2'),ft=P.find(p=>p.n==='foot_'+S);
  const hip=[hx0,.94*k,0],kn=[hx0*1.05,.62*k,.1*k],hk=[hx0*1.05,.33*k,-.03*k],an=[hx0*1.05,.09*k,.05*k],rep=(p,pts,rad)=>{p.pos=pts[0].map(r);p.size=pts.map((q,i)=>[r(q[0]-pts[0][0]),r(q[1]-pts[0][1]),r(q[2]-pts[0][2]),r(rad[i])]);p.pv=pts[0].map(r)};
  rep(s1,[hip,kn],[.082*k,.058*k]);rep(s2,[kn,hk],[.055*k,.04*k]);const s3=limbT('leg_'+S+'3',[hk,an],[r(.04*k),r(.03*k)],{color:col,role:'leg',side:S,depth:3,parent:'leg_'+S+'2',pv:hk.map(r)});P.splice(P.indexOf(s2)+1,0,s3);
  ft.pos=[r(an[0]),r(.045*k),r(an[2]+.04*k)];ft.parent='leg_'+S+'3';ft.pv=an.map(r)});
 return P}
function centaurParts(o){o=o||{};const H=animalParts('horse',{scale:o.scale||1,color:o.color}),sc=o.scale||1,hu=humanParts({height:(o.height||1.75)*sc,skin:o.skin||'#d9a688',sex:o.sex,build:o.build,bust:o.bust}),r=v=>+v.toFixed(4);
 const drop=new Set(['neck','head','snout','nose','ear_L','ear_R']),keep=hu.filter(p=>!['pelvis','leg_L1','leg_L2','foot_L','leg_R1','leg_R2','foot_R'].includes(p.n)),ch=H.find(p=>p.n==='chest'),k=sc*(o.height||1.75)/1.75,
  topY=ch.pos[1]+ch.size[1]*.9,dy=topY-(.95*k),dz=ch.pos[2]+ch.size[2]*.2,out=H.filter(p=>!drop.has(p.n));
 keep.forEach(p=>{const q={...p,pos:[p.pos[0],r(p.pos[1]+dy),r(p.pos[2]+dz)],pv:[p.pv[0],r(p.pv[1]+dy),r(p.pv[2]+dz)]};if(p.n==='torso'){q.parent='chest';q.depth=3}out.push(q)});return out}
function manifestOf(S,AN,LAY,CN,bb){
 const f=v=>+v.toFixed(4),mid=(a,b)=>a.map((x,i)=>f((x+b[i])/2)),dim=(a,b)=>a.map((x,i)=>f(b[i]-x));
 const objects=S.map(o=>{const b=bb(o.name);let col=null;
  if(b){const size=dim(b.min,b.max),c=mid(b.min,b.max);
   if(o.type==='sphere')col={shape:'sphere',center:c,radius:f(Math.max(...size)/2)};
   else if(o.type==='cylinder'||o.type==='cone')col={shape:'cylinder',center:c,radius:f(Math.max(size[0],size[2])/2),height:size[1]};
   else col={shape:'box',center:c,size}}
  return{name:o.name,type:o.type,parent:o.parent||null,layer:o.layer||null,pos:o.pos,rot:o.rot||[0,0,0],scale:o.scale||1,
   material:{color:o.color||null,roughness:o.rough===undefined?.7:o.rough,metalness:o.metal||0,opacity:o.opacity===undefined?1:o.opacity,texture:!!o.texid,vertexColors:!!(o.type==='mesh'&&o.size&&o.size.c)},
   sockets:o.sockets||null,visible:!(o.hidden||(o.layer&&LAY[o.layer]&&LAY[o.layer].visible===false)),collider:col}});
 const animations=Object.entries(AN).map(([n,A])=>({name:n,loop:!!A.loop,duration:A.keys.length?A.keys[A.keys.length-1].t:0,keys:A.keys.length,objects:[...new Set(A.keys.flatMap(k=>Object.keys(k.poses)))]}));
 return{version:1,units:'m',up:'Y',objects,animations,layers:LAY,constraints:CN.map(k=>({id:k.id,type:k.type}))}}
function objGeo(t,flat){const v=[],p=[];
 t.split('\n').forEach(l=>{const a=l.trim().split(/\s+/);if(a[0]==='v')v.push(+a[1],+a[2],+a[3]);else if(a[0]==='f'){const i=a.slice(1).map(x=>parseInt(x)-1);for(let k=1;k<i.length-1;k++)p.push(i[0],i[k],i[k+1])}});
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(p);const h=flat?g.toNonIndexed():g;h.computeVertexNormals();return h}
function geo(t,s){s=s||[];
 switch(t){
  case'box':return new THREE.BoxGeometry(s[0]||1,s[1]||1,s[2]||1);
  case'sphere':return new THREE.SphereGeometry(s[0]||.5,32,20);
  case'cylinder':return new THREE.CylinderGeometry(s[0]||.5,s[0]||.5,s[1]||1,32);
  case'cone':return new THREE.ConeGeometry(s[0]||.5,s[1]||1,32);
  case'torus':return new THREE.TorusGeometry(s[0]||.5,s[1]||.15,16,48);
  case'plane':return new THREE.BoxGeometry(s[0]||1,.02,s[1]||1);
  case'tube':return tubeGeo(s);
  case'mesh':return meshGeo(s);
  case'ellipsoid':{const g=new THREE.SphereGeometry(1,32,20);g.scale(s[0]||.5,s[1]||.5,s[2]||.5);return g}
  case'obj':return objGeo(s);
  case'csg':return objGeo(s,true);
  case'lathe':return new THREE.LatheGeometry(s.map(p=>new THREE.Vector2(p[0],p[1])),32);
  case'extrude':{const g=new THREE.ExtrudeGeometry(new THREE.Shape(s[1].map(p=>new THREE.Vector2(p[0],p[1]))),{depth:s[0],bevelEnabled:false});g.translate(0,0,-s[0]/2);return g}
 }
 throw new Error('Неизвестный тип: '+t+'. Доступны: box, sphere, cylinder, cone, torus, plane');
}
function build(){dirty=true;
 while(group.children.length){const m=group.children[0];group.remove(m);m.material.dispose();m.children.forEach(c=>c.material&&c.material.dispose())}
 state.filter(o=>!o.hidden&&layerOn(o)).forEach(o=>{
  const m=new THREE.Mesh(cgeo(o),mkMat(o,{color:((o.type==='mesh'&&o.size.c)||(o.texid&&TEXS[o.texid]))?'#ffffff':(o.color||'#b0b0b0'),vertexColors:!!(o.type==='mesh'&&o.size.c&&!(o.texid&&TEXS[o.texid])),map:(o.texid&&TEXS[o.texid])?TEXS[o.texid].tex:null,morphTargets:!!(o.type==='mesh'&&o.size.sk),roughness:o.rough??.7,metalness:o.metal||0,transparent:(o.opacity??1)<1,opacity:o.opacity??1,side:THREE.DoubleSide}));
  if(o.type==='mesh'&&o.size.sk)m.morphTargetInfluences=Object.keys(o.size.sk).map(k=>(o.w&&o.w[k])||0);m.userData.g0=m.geometry;m.position.set(...(o.pos||[0,0,0]));m.scale.setScalar(o.scale||1);
  m.rotation.set(...(o.rot||[0,0,0]).map(d=>d*Math.PI/180));
  m.renderOrder=o.ro||0;m.name=o.name;m.castShadow=m.receiveShadow=SET.shadows&&!(o.opacity<1)&&!o.card;
  if(o.outline&&!o.card){try{const t=o.outline,hm=new THREE.MeshBasicMaterial({color:'#1b1420',side:THREE.BackSide});hm.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>','vec3 transformed=position+normalize(normal)*'+t.toFixed(5)+';')};hm.customProgramCacheKey=()=>'a3ol'+t.toFixed(5);const hull=new THREE.Mesh(m.geometry,hm);hull.castShadow=false;hull.userData.outline=1;m.add(hull)}catch(e){}}
 if(m.material&&scene.environment)m.material.envMapIntensity=.6;
  if(o.bump&&m.geometry.attributes.uv){try{m.material.bumpMap=bumpTex(o.bump.k,o.bump.sc);m.material.bumpScale=o.bump.st}catch(e){}}
  group.add(m);
 });
 fitShadow();
}
function fitShadow(){try{const b=new THREE.Box3().setFromObject(group);if(b.isEmpty())return;const c=b.getCenter(new THREE.Vector3()),r=Math.max(b.getSize(new THREE.Vector3()).length()/2,1);dl.target.position.copy(c);dl.position.copy(c).add(new THREE.Vector3(5,10,7).normalize().multiplyScalar(r*3+4));const sc=dl.shadow.camera;sc.left=sc.bottom=-r*1.2;sc.right=sc.top=r*1.2;sc.near=.5;sc.far=r*8+10;sc.updateProjectionMatrix();dl.target.updateMatrixWorld()}catch(e){}}
function summary(only){
 const f=v=>+v.toFixed(3);
 const bs=group.children.map(m=>({n:m.name,b:new THREE.Box3().setFromObject(m)}));
 const lines=bs.filter(({n})=>!only||only.includes(n)).map(({n,b})=>{const s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());
  const so=state.find(o=>o.name===n)||{},pr=so.parent;return n+': размер ['+[s.x,s.y,s.z].map(f)+'] центр ['+[c.x,c.y,c.z].map(f)+']'+(pr?' ← '+pr:'')+(so.sockets?' ⌖'+Object.keys(so.sockets).join(','):'')+(so.src?' ⟵ '+so.src.mode+' '+so.src.a+' / '+so.src.b.join(','):'')+(so.type==='mesh'?' ['+so.size.v.length/3+' верш.]':'')+(so.type==='mesh'&&so.size.sk?' формы:'+Object.keys(so.size.sk).join(','):'')+(so.type==='mesh'&&so.size.mk?' +маска':'')+(so.type==='mesh'&&so.size.c?' +цвет'+(so.size.L?':'+so.size.L.map(l=>l.n+(l.on?'':'(выкл)')).join(','):''):'')});
 const ov=[],fl=[],mnd=b=>{const s=b.getSize(new THREE.Vector3());return Math.max(Math.min(s.x,s.y,s.z),1e-4)};const U=new THREE.Box3();bs.forEach(x=>U.union(x.b));const SZ=U.isEmpty()?'пусто':U.getSize(new THREE.Vector3()).toArray().map(f).join(',');
 for(let i=0;i<bs.length;i++){
  for(let j=i+1;j<bs.length;j++)if(bs[i].b.clone().expandByScalar(-Math.min(.01,mnd(bs[i].b)*.1,mnd(bs[j].b)*.1)).intersectsBox(bs[j].b)&&(!only||only.includes(bs[i].n)||only.includes(bs[j].n)))ov.push(bs[i].n+'×'+bs[j].n);
  const ex=bs[i].b.clone().expandByScalar(Math.min(.03,mnd(bs[i].b)*.5));
  if((!only||only.includes(bs[i].n))&&bs[i].b.min.y>Math.min(.05,mnd(bs[i].b)*.5)&&!bs.some((x,j)=>j!==i&&x.b.intersectsBox(ex)))fl.push(bs[i].n);
 }
 return 'Объектов: '+bs.length+'\n'+lines.join('\n')+'\nСлои: '+(Object.keys(LAYERS).map(k=>k+'('+state.filter(x=>x.layer===k).length+')'+(LAYERS[k].visible?'':' скрыт')+(LAYERS[k].locked?' 🔒':'')).join(', ')||'нет')+(SOLO?' [соло: '+SOLO+']':'')+'\nСвязи: '+(CON.map(k=>k.id).join(', ')||'нет')+'\nГабариты сцены: ['+SZ+']\nПересечения габаритов: '+(ov.join(', ')||'нет')+'\nВисят в воздухе: '+(fl.join(', ')||'нет')+(function(){const t=stats().tris_full;return '\nТреугольников: '+t+(t>400000?' (тяжело: уменьши subdiv/детализацию)':'')})()+'\nАнимации: '+(Object.entries(ANIM).map(([n,A])=>n+'('+A.keys.length+' ключей, '+(A.keys.length?A.keys[A.keys.length-1].t:0)+' с'+(A.loop?', цикл':'')+')').join(', ')||'нет');
}
function kids(n,acc=[]){state.filter(x=>x.parent===n).forEach(x=>{if(!acc.includes(x)){acc.push(x);kids(x.name,acc)}});return acc}
function withKids(g){const a=[...g];g.forEach(x=>kids(x.name).forEach(k=>{if(!a.includes(k))a.push(k)}));return a}
function rigid(x,R,P,d){x.pos=new THREE.Vector3(...x.pos).sub(P).applyQuaternion(R).add(P).add(d).toArray();
 const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...(x.rot||[0,0,0]).map(a=>a*Math.PI/180))).premultiply(R),e=new THREE.Euler().setFromQuaternion(q);
 x.rot=[e.x,e.y,e.z].map(r=>+(r*180/Math.PI).toFixed(3))}
function __histCap(){let b=0;for(let i=hist.length-1;i>=0;i--){b+=hist[i].length;if(b>24e6&&i<hist.length-1){hist.splice(0,i+1);break}}}   // site
function run(cmds){
 hist.push(JSON.stringify(state));redo.length=0;if(hist.length>30)hist.shift();__histCap();NOTE='';
 try{
  (Array.isArray(cmds)?cmds:[cmds]).forEach(c=>{
   if(c.mat){const m=MATS[c.mat];if(!m)throw new Error('Нет материала: '+c.mat+'. Есть: '+Object.keys(MATS).join(', '));c={...m,...c}}
   lockGuard(c);
   if(c.op==='clear'){state=[];return}
   if(c.op==='add'){
    const n=c.name||c.type+(state.length+1);
    if(state.some(o=>o.name===n))throw new Error('Имя занято: '+n);
    geo(c.type,c.size);
    if(c.parent&&!state.some(s=>s.name===c.parent))throw new Error('Нет родителя: '+c.parent);
    state.push({parent:c.parent,ver:(c.type==='obj'||c.type==='mesh')?++VER:undefined,name:n,type:c.type,size:c.size,pos:c.pos||[0,0,0],rot:c.rot||[0,0,0],color:c.color||'#b0b0b0',rough:c.rough,metal:c.metal,scale:c.scale,opacity:c.opacity});return;
   }
   if(c.op==='prefab'){
    const f=PREFABS[c.type]||CUSTOM[c.type];if(!f)throw new Error('Нет заготовки: '+c.type+'. Есть: '+Object.keys(PREFABS).concat(Object.keys(CUSTOM)).join(', '));
    const yw=c.yaw||0,a=yw*Math.PI/180,co=Math.cos(a),si=Math.sin(a),P=c.pos||[0,0,0],pre=c.name||c.type;
    f(c.params||{}).forEach(q=>{const n=pre+'_'+q.n;if(state.some(s=>s.name===n))throw new Error('Имя занято: '+n);
     geo(q.type,q.size);state.push({name:n,type:q.type,size:q.size,pos:[P[0]+q.pos[0]*co+q.pos[2]*si,P[1]+q.pos[1],P[2]-q.pos[0]*si+q.pos[2]*co],rot:[(q.rot||[0,0,0])[0],(q.rot||[0,0,0])[1]+yw,(q.rot||[0,0,0])[2]],color:(c.color&&q.main)?c.color:q.color,rough:q.rough,metal:q.metal,opacity:q.opacity,scale:q.scale})});
    return}
   if(c.op==='bool'){
    const A0=state.find(x=>x.name===c.a);if(!A0)throw new Error('bool: нет объекта a: '+c.a);
    const bl=[].concat(c.b||[]).flatMap(n=>{const e=state.filter(x=>x.name===n);return e.length?e:state.filter(x=>x.name.startsWith(n))}).filter(x=>x!==A0);
    if(!bl.length)throw new Error('bool: нет объектов b');
    const mode=c.mode||'sub';if(!['sub','union','int'].includes(mode))throw new Error('bool mode: sub, union, int');
    const P=boolPolys(A0,bl,mode);
    const nm=c.name||(c.live?A0.name+'_cut':A0.name);
    if(state.some(s=>s.name===nm&&(c.keep||c.live||(s!==A0&&!bl.includes(s)))))throw new Error('Имя занято: '+nm);
    const asM=c.as==='mesh'||(A0.type==='mesh'&&A0.size&&(A0.size.c||A0.size.uv)),res={ver:++VER,texid:A0.texid,name:nm,type:asM?'mesh':'csg',size:asM?polysMesh(P,A0):polysObj(P),pos:[0,0,0],rot:[0,0,0],color:A0.color,rough:A0.rough,metal:A0.metal,opacity:A0.opacity,parent:A0.parent,src:c.live?{mode,a:A0.name,b:bl.map(x=>x.name)}:undefined};
    if(c.live)[A0,...bl].forEach(x=>{x.hidden=true});else if(!c.keep){const rm=[A0,...bl];state=state.filter(s=>!rm.includes(s))}
    state.push(res);return}
   if(c.op==='mesh'||c.op==='subdiv'||c.op==='smooth'||c.op==='sculpt'){
    const o=state.find(x=>x.name===c.name);if(!o)throw new Error(c.op+': нет объекта '+c.name);
    if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}
    if(c.op==='subdiv'){let r=o.size,C2=null,R2=0;
     if(c.center&&c.radius){const s=o.scale||1;C2=new THREE.Vector3(...c.center).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...o.pos),qE(o.rot),new THREE.Vector3(s,s,s)).invert());R2=c.radius/s}
     for(let i=0;i<(c.levels||1);i++){const cur=r,t=C2?((a,b,d)=>Math.hypot((cur.v[a*3]+cur.v[b*3]+cur.v[d*3])/3-C2.x,(cur.v[a*3+1]+cur.v[b*3+1]+cur.v[d*3+1])/3-C2.y,(cur.v[a*3+2]+cur.v[b*3+2]+cur.v[d*3+2])/3-C2.z)<R2):null;
      r=subdivSel(cur,t);if(r.v.length/3>40000)throw new Error('subdiv: слишком много вершин (лимит 40000), уменьши levels или radius')}
     if(c.smooth)lapM(r,c.smooth,.5);if(r.L)composite(r);o.size=r}
    if(c.op==='smooth')lapM(o.size,c.iter||1,c.amount||.5);
    if(c.op==='sculpt'){
     const s=o.scale||1,inv=new THREE.Matrix4().compose(new THREE.Vector3(...o.pos),qE(o.rot),new THREE.Vector3(s,s,s)).invert(),iq=qE(o.rot).invert();
     (c.strokes||[c]).forEach(st=>{
      if(!st.center||!st.radius)throw new Error('sculpt: нужны center [x,y,z] (мировые) и radius');
      const br=st.brush||c.brush||'inflate';if(!['inflate','deflate','move','pinch','smooth','flatten'].includes(br))throw new Error('brush: inflate, deflate, move, pinch, smooth, flatten');
      const C=new THREE.Vector3(...st.center).applyMatrix4(inv),R=st.radius/s,sym=st.symmetry!==undefined?st.symmetry:c.symmetry,big=['inflate','deflate','move'].includes(br),
       str=st.strength!==undefined?st.strength:(big?st.radius*.15:.5),S=big?str/s:0,f0=big?0:str,D=st.dir?new THREE.Vector3(...st.dir).applyQuaternion(iq).normalize():null;
      brushM(o.size,br,C.toArray(),R,S,f0,D?D.toArray():null);
      if(sym)brushM(o.size,br,[-C.x,C.y,C.z],R,S,f0,D?[-D.x,D.y,D.z]:null)})}
    o.ver=++VER;return}
   if(c.op==='chain'){
    const pts=c.points;if(!pts||pts.length<2)throw new Error('chain: points минимум 2 точки [x,y,z]');
    const pre=c.prefix||'j';let prev=c.parent;if(prev&&!state.some(x=>x.name===prev))throw new Error('Нет родителя: '+prev);
    pts.forEach((p,i)=>{const n=pre+(i+1);if(state.some(x=>x.name===n))throw new Error('Имя занято: '+n);state.push({name:n,type:'sphere',size:[c.size||.03],pos:p,rot:[0,0,0],color:c.color||'#ffcc00',opacity:c.opacity,parent:prev});prev=n});
    return}
   if(c.op==='ik'){
    const ch=(c.chain||[]).map(n=>state.find(x=>x.name===n));if(ch.length<2||ch.some(x=>!x))throw new Error('ik: chain из 2+ существующих объектов-суставов');
    for(let i=0;i<ch.length-1;i++)if(!kids(ch[i].name).includes(ch[i+1]))throw new Error('ik: '+ch[i+1].name+' должен быть ребёнком '+ch[i].name+' (parent)');
    if(!c.target)throw new Error('ik: нужен target [x,y,z]');
    ccdSolve(ch.map(x=>x.pos),c.target,c.iter).steps.forEach(s=>{const j=ch[s.i],R=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...s.ax),s.an),Pv=new THREE.Vector3(...j.pos),z=new THREE.Vector3();[j,...kids(j.name)].forEach(x=>rigid(x,R,Pv,z))});
    return}
   if(c.op==='aim'){
    const o=state.find(x=>x.name===c.name);if(!o)throw new Error('aim: нет объекта '+c.name);if(!c.target)throw new Error('aim: нужен target [x,y,z]');
    const ax={x:[1,0,0],y:[0,1,0],z:[0,0,1]}[c.axis||'z'],d=new THREE.Vector3(...c.target).sub(new THREE.Vector3(...o.pos));if(d.length()<1e-6)throw new Error('aim: цель совпадает с объектом');
    const R=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...ax).applyQuaternion(qE(o.rot)),d.normalize()),Pv=new THREE.Vector3(...o.pos),z=new THREE.Vector3();
    [o,...kids(o.name)].forEach(x=>rigid(x,R,Pv,z));return}
   if(c.op==='cycle'){
    const A=ANIM[c.anim];if(!A||A.keys.length<2)throw new Error('cycle: нужна анимация с 2+ ключами');const d=c.duration||A.keys[A.keys.length-1].t*1.5||1;
    A.keys=A.keys.filter(k=>k.t!==d);const f0=A.keys[0];A.keys.push({t:d,poses:JSON.parse(JSON.stringify(f0.poses)),ease:f0.ease});A.keys.sort((p,q)=>p.t-q.t);A.loop=true;return}
   if(c.op==='anim_copy'){
    const A=ANIM[c.anim];if(!A)throw new Error('Нет анимации: '+c.anim);const src=A.keys.find(k=>k.t===c.from);if(!src)throw new Error('anim_copy: нет ключа at '+c.from);
    const l=(c.swap||['_L','_R'])[0],r=(c.swap||['_L','_R'])[1],sw=n=>n.includes(l)?n.replace(l,r):n.includes(r)?n.replace(r,l):n,poses={};
    Object.keys(src.poses).forEach(n=>{const q=sw(n),p=src.poses[q]||src.poses[n],m=q!==n&&src.poses[q]&&c.mirror!==false;poses[n]=m?mirrorPose(p):{pos:[...p.pos],rot:[...p.rot],w:p.w}});
    const ex=A.keys.find(k=>k.t===c.to);if(ex)Object.assign(ex.poses,poses);else{A.keys.push({t:c.to,poses,ease:c.ease});A.keys.sort((p,q)=>p.t-q.t)}return}
   if(c.op==='uv'){
    const o=state.find(x=>x.name===c.name);if(!o)throw new Error('uv: нет объекта '+c.name);
    if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}
    
    uvGen(o,c.mode||'planar',c);o.ver=++VER;return}
   if(c.op==='texture'){
    const tg=c.prefix?state.filter(x=>x.name.startsWith(c.prefix)):state.filter(x=>x.name===c.name);if(!tg.length)throw new Error('texture: нет объектов (name или prefix)');
    if(c.clear){tg.forEach(o=>{if(o.texid){delete TEXS[o.texid];delete o.texid;o.ver=++VER}});return}
    const vs1=c.views||(['front','side','top'].includes(c.view||'front')?null:[c.view]);
    if(vs1){const refs=vs1.map(v=>{const R=REF[v];if(!R)throw new Error('texture: нет референса '+v+' (scene_reference)');refPx(R);return{R,view:v}});
     tg.forEach(o=>{if(o.type!=='mesh'||!o.size.uv)throw new Error('texture: у '+o.name+' нет UV, сначала {op:"uv",name:"'+o.name+'",mode:"planar|cylinder|sphere"}');
      const T=getTex(o,Math.min(2048,c.size||1024)),r=bakeUVMulti(o,refs,c,T);syncTex(T);o.ver=++VER;
      NOTE+='сшивка текстуры '+o.name+': '+T.w+'×'+T.h+', '+r.hit+' пикселей; яркость '+vs1.map((v,k)=>v+'×'+r.g[k].map(x=>x.toFixed(2)).join('/')).join(', ')+'\n'});
     return}
    const view=c.view||'front',R=REF[view];if(!R)throw new Error('texture: сначала scene_reference для вида '+view);refPx(R);
    tg.forEach(o=>{if(o.type!=='mesh'||!o.size.uv)throw new Error('texture: у '+o.name+' нет UV, сначала {op:"uv",name:"'+o.name+'",mode:"planar|cylinder"}');
     const T=getTex(o,Math.min(2048,c.size||1024)),hit=bakeUVTex(o,R,view,c,T);syncTex(T);o.ver=++VER;
     NOTE+='текстура→'+o.name+': '+T.w+'×'+T.h+', закрашено '+(100*T.cov.reduce((a,v)=>a+(v>0?1:0),0)/T.cov.length).toFixed(1)+'% (попаданий '+hit+')\n'});
    return}
   if(c.op==='layer'){
    const n=c.name;if(!n)throw new Error('layer: нужен name');
    if(c.show_all){SOLO=null;Object.keys(LAYERS).forEach(k=>{LAYERS[k].visible=true})}
    if(c.delete){state.forEach(x=>{if(x.layer===n)delete x.layer});delete LAYERS[n];if(SOLO===n)SOLO=null;return}
    const L=LAYERS[n]||(LAYERS[n]={visible:true,locked:false});
    (c.objects||[]).forEach(p=>{const g=state.filter(x=>x.name===p),t=g.length?g:state.filter(x=>x.name.startsWith(p));if(!t.length)throw new Error('layer: нет объектов '+p);t.forEach(x=>{x.layer=n})});
    if(c.visible!==undefined)L.visible=!!c.visible;if(c.locked!==undefined)L.locked=!!c.locked;
    if(c.solo===true)SOLO=n;else if(c.solo===false&&SOLO===n)SOLO=null;
    return}
   if(c.op==='clayer'){
    const o=state.find(x=>x.name===c.name);if(!o||o.type!=='mesh'||!o.size.L)throw new Error('clayer: у '+c.name+' нет цветовых слоёв (сначала paint или photo с layer)');
    const m=o.size,i=m.L.findIndex(x=>x.n===c.layer);if(i<0)throw new Error('clayer: нет слоя '+c.layer+'. Есть: '+m.L.map(x=>x.n).join(', '));const l=m.L[i];
    if(c.on!==undefined)l.on=!!c.on;if(c.opacity!==undefined)l.op=Math.max(0,Math.min(1,c.opacity));
    if(c.order==='up'&&i<m.L.length-1){m.L.splice(i,1);m.L.splice(i+1,0,l)}if(c.order==='down'&&i>0){m.L.splice(i,1);m.L.splice(i-1,0,l)}
    if(c.merge){for(let k=0;k<l.a.length;k++){const t=l.op*l.a[k];if(t>0)for(let q=0;q<3;q++)m.c0[k*3+q]+=(l.c[k*3+q]-m.c0[k*3+q])*t}m.L.splice(m.L.indexOf(l),1)}
    if(c.delete)m.L.splice(m.L.indexOf(l),1);
    if(!m.L.length){m.c=m.c0;m.c0=null;m.L=null}else composite(m);
    o.ver=++VER;return}
   const asMesh=o=>{if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}return o.size};
   const furFor=(src,c,nm)=>{const m0=src.type==='mesh'?src.size:toMesh(geo(src.type,src.size)),sc=src.scale||1,zr={head:.55,face:.45,leg:.7,foot:0,ear:.6,tail:1.1},rl=src.rg&&src.rg.role,k=(c.auto!==false&&rl&&zr[rl]!==undefined)?zr[rl]:1;if(!k)return 0;
    const area=meshArea(m0)*sc*sc,L=(c.length||.03)*k/sc,cnt=Math.min(c.count||Math.round(area*(c.density||3000)),c.maxStrands||9000);
    const m=furGen(m0,{...c,length:L,width:c.width?c.width/sc:L*.22,count:cnt,seed:(c.seed||1)+src.name.length*7,comb:c.comb||[0,-.3,-1]});if(!m)return 0;
    const n=nm||(src.name+'_fur');const old=state.findIndex(x=>x.name===n);if(old>=0)state.splice(old,1);
    const out={v:m.v.map(x=>+x.toFixed(4)),f:m.f,c:m.c.map(x=>+x.toFixed(3))};
    const o={name:n,type:'mesh',size:out,pos:src.pos.slice(),rot:(src.rot||[0,0,0]).slice(),color:'#ffffff',rough:.9,scale:src.scale,parent:src.name,ver:++VER};
    if(src.rg)o.rg={role:'fur',side:src.rg.side,depth:1,pv:src.rg.pv,p0:src.pos.slice(),r0:(src.rot||[0,0,0]).slice()};
    state.push(o);if(c.tint!==false&&(src.type!=='mesh'||!src.size.c)){const col=new THREE.Color(c.color||'#8a6a45').multiplyScalar(.6);src.color='#'+col.getHexString()}
    NOTE+='шерсть '+n+': '+m.strands+' прядей\n';return m.strands};
   const rigList=c=>{const sel=state.filter(x=>x.rg&&(c.names?c.names.includes(x.name):c.prefix?x.name.startsWith(c.prefix):true));if(!sel.length)throw new Error('нет частей с ригом: сначала autorig или make');
    const names=new Set(sel.map(x=>x.name));for(let ch=true;ch;){ch=false;state.forEach(x=>{if(x.rg&&!names.has(x.name)&&x.parent&&names.has(x.parent)){names.add(x.name);sel.push(x);ch=true}})}
    const order=[],seen=new Set(),add=x=>{if(seen.has(x.name))return;if(x.parent&&names.has(x.parent)&&!seen.has(x.parent))add(state.find(q=>q.name===x.parent));seen.add(x.name);order.push(x)};sel.forEach(add);
    const ix=new Map(order.map((x,i)=>[x.name,i]));return order.map(x=>({n:x.name,pos:x.rg.p0,rot:x.rg.r0,parent:x.parent&&ix.has(x.parent)?ix.get(x.parent):-1,pv:x.rg.pv,role:x.rg.role,side:x.rg.side,depth:x.rg.depth,fc:x.fc,dx:x.fcd&&x.fcd.dx,dy:x.fcd&&x.fcd.dy,tz:x.fcd&&x.fcd.tz}))};
   const jiggleApply=(an,names,o)=>{const A=ANIM[an];if(!A||A.keys.length<2)throw new Error('jiggle: нет анимации '+an);const T=A.keys[A.keys.length-1].t,n=Math.max(2,Math.round(T*(o.fps||24))),all=new Set();A.keys.forEach(k=>Object.keys(k.poses).forEach(x=>all.add(x)));
    const dense=[];for(let i=0;i<=n;i++){const t=T*i/n,poses={};all.forEach(nm=>{const q=interpPose(A.keys,A.loop,nm,i===n?T-1e-9:t);if(q)poses[nm]={pos:q.pos.map(v=>+v.toFixed(4)),rot:qToEul(q.q),...(q.w?{w:q.w}:{})}});dense.push({t:+t.toFixed(4),poses})}
    let done=0;names.forEach(nm=>{const S=state.find(x=>x.name===nm);if(!S||!S.parent)return;const P=state.find(x=>x.name===S.parent);if(!P||!dense[0].poses[P.name])return;
     const P0=P.rg?{pos:P.rg.p0,rot:P.rg.r0}:{pos:P.pos,rot:P.rot||[0,0,0]},S0=S.rg?{pos:S.rg.p0,rot:S.rg.r0}:{pos:S.pos,rot:S.rot||[0,0,0]};
     const res=secondaryGen(dense,A.loop,{n:S.name,pos:S0.pos,rot:S0.rot,parent:S.parent},P0,{fps:n/T,k:o.k,damp:o.damp,gain:o.gain,maxd:o.maxd,size:o.size||.08});
     res.forEach((r,i)=>{dense[i].poses[S.name]={pos:r.pos,rot:r.rot}});done++});
    A.keys=dense;return done};
   if(c.op==='autorig'){build();const sel=c.names?state.filter(x=>c.names.includes(x.name)):c.prefix?state.filter(x=>x.name.startsWith(c.prefix)):[];if(sel.length<2)throw new Error('autorig: нужен prefix или names (минимум 2 части)');
    const parts=sel.map(x=>{const m=group.children.find(q=>q.name===x.name);if(!m)throw new Error('autorig: объект скрыт: '+x.name);const b=new THREE.Box3().setFromObject(m);return{n:x.name,c:b.getCenter(new THREE.Vector3()).toArray(),s:b.getSize(new THREE.Vector3()).toArray()}});
    const r=rigAuto(parts,{root:c.root,joints:c.joints});r.list.forEach(it=>{const o=state.find(x=>x.name===it.n);if(it.parent)o.parent=it.parent;else delete o.parent;o.rg={role:it.role,side:it.side,depth:it.depth,pv:it.pv,p0:o.pos.slice(),r0:(o.rot||[0,0,0]).slice()}});
    NOTE+='риг: корень '+r.root+': '+r.list.map(i=>i.n+'='+i.role+(i.side!=='C'?i.side:'')+i.depth).join(' ')+'. Роль неверна: поправь имя (leg, arm, head, tail) и повтори autorig, либо joints:{имя:[x,y,z]}\n';return}
   if(c.op==='gait'){const rig=rigList(c),fw=({'-z':[0,0,-1],'+x':[1,0,0],'-x':[-1,0,0]})[c.forward]||[0,0,1],keys=gaitGen(rig,{clip:c.clip||'walk',duration:c.duration,amp:c.amp,forward:fw,keys:c.keys}),an=c.anim||c.clip||'walk';
    ANIM[an]={keys,loop:c.loop!==false};let nj=0;const sec=Array.isArray(c.secondary)?c.secondary:c.secondary===false?[]:rig.filter(p=>p.role==='breast'||p.role==='belly').map(p=>p.n);if(sec.length)nj=jiggleApply(an,sec,{k:c.k,damp:c.damp,gain:c.gain});
    NOTE+='анимация '+an+' ('+(c.clip||'walk')+', '+keys[keys.length-1].t+' с, '+Object.keys(keys[0].poses).length+' частей'+(nj?', вторичное движение: '+nj:'')+'). Выбрать для кнопки «Играть»: play{anim} или anims:[тело,лицо] (тело и лицо вместе); кадр: pose{anim,time}\n';return}
   if(c.op==='jiggle'){const n=jiggleApply(c.anim,c.parts||[],c);NOTE+='jiggle: '+n+' частей\n';return}
   if(c.op==='fur'){const tg=c.on?state.filter(x=>x.name===c.on):c.prefix?state.filter(x=>x.name.startsWith(c.prefix)&&!x.name.endsWith('_fur')&&!(x.rg&&x.rg.role==='fur')):[];if(!tg.length)throw new Error('fur: нужен on:имя или prefix');let t=0;tg.forEach(x=>{t+=furFor(x,c,c.name&&tg.length===1?c.name:undefined)});if(!t)throw new Error('fur: ни одной пряди (проверь region/length)');return}
   if(c.op==='warp'){const o=state.find(x=>x.name===c.name);if(!o)throw new Error('warp: нет объекта '+c.name);let m=asMesh(o),k=0;while(m.v.length/3<(c.minVerts||1500)&&k<3){m=subdivSel(m,null);k++}
    if(!Array.isArray(c.pins)||!c.pins.length)throw new Error('warp: pins:[{at:[x,y,z],by:[dx,dy,dz]|to|scale,r}] в локальных координатах');
    const v=warpMesh(m,c.pins,!!c.sym);o.size={...m,v:v.map(x=>+x.toFixed(4))};o.ver=++VER;NOTE+='warp '+c.name+': '+c.pins.length+' пинов, '+v.length/3+' вершин\n';return}
   if(c.op==='face'){const o=state.find(x=>x.name===(c.on||c.name));if(!o)throw new Error('face: нет объекта '+(c.on||c.name));let m=asMesh(o),k=0;while(m.v.length/3<(c.minVerts||2000)&&k<3){m=subdivSel(m,null);k++}
    const LM=faceLM(m);let v=m.v;const par=c.variant?(typeof c.variant==='string'?facePreset(c.variant):c.variant):null;if(c.variant&&!par)throw new Error('face: variant human|child|elf|orc|cat|dog|alien или объект параметров');
    if(par)v=warpMesh({v},faceVarPins(par,LM),false);
    const names=(c.keys===false)?[]:(Array.isArray(c.keys)?c.keys:['blink_L','blink_R','smile','frown','jaw_open','mouth_o','brow_up','brow_angry']);if(names.length>8)throw new Error('face: максимум 8 форм на объект');
    const sk=m.sk?{...m.sk}:{};names.forEach(nm=>{const pins=facePins(nm,LM);if(!pins)throw new Error('face: неизвестная форма '+nm+'. Есть: '+faceKeys().join(','));const v2=warpMesh({v},pins,false);sk[nm]=v2.map((x,i)=>+(x-v[i]).toFixed(4))});
    if(Object.keys(sk).length>8)throw new Error('face: итого больше 8 форм (сними старые shape{delete})');
    o.size={...m,v:v.map(x=>+x.toFixed(4)),sk:Object.keys(sk).length?sk:null};if(!o.size.sk)delete o.size.sk;o.ver=++VER;NOTE+='лицо '+o.name+(par?' ('+(c.variant.length?c.variant:'свои')+')':'')+', формы: '+names.join(',')+'. Анимация: key со weights {форма:0..1}, лицо смотрит в +Z\n';return}
   if(c.op==='terrain'){const n=c.name||'terrain';if(state.some(x=>x.name===n))throw new Error('Имя занято: '+n);let mp=null;
    if(c.map){const R0=REF[c.map==='top'?'top':c.map==='front'?'front':c.map==='side'?'side':c.map];if(!R0)throw new Error('terrain: нет референса '+c.map+' (загрузи картинку как ref)');const cv0=document.createElement('canvas');cv0.width=cv0.height=128;const x0=cv0.getContext('2d');x0.drawImage(R0.img,0,0,128,128);const d=x0.getImageData(0,0,128,128).data,L=new Float32Array(128*128);for(let i=0;i<L.length;i++)L[i]=(d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114)/255;mp={w:128,h:128,data:L}}
    const m=terrainGen({...c,map:mp}),hf=m.hf,sea=c.sea;state.push({name:n,type:'mesh',size:{v:m.v,f:m.f,c:m.c,uv:m.uv},hf,pos:c.pos||[0,0,0],rot:[0,0,0],color:'#ffffff',rough:.95,ver:++VER});
    if(sea!==undefined&&c.water!==false)state.push({name:n+'_water',type:'plane',size:[hf.W,hf.D],pos:[(c.pos||[0,0,0])[0],(c.pos||[0,0,0])[1]+sea,(c.pos||[0,0,0])[2]],rot:[0,0,0],color:'#3a78a8',rough:.15,opacity:.72,ver:++VER});
    NOTE+='ландшафт '+n+': '+hf.W+'x'+hf.D+' м, высоты '+hf.h.reduce((a,b)=>Math.min(a,b),1e9).toFixed(1)+'..'+hf.h.reduce((a,b)=>Math.max(a,b),-1e9).toFixed(1)+', '+m.f.length/3+' треугольников. Деревья: scatter{src,on:"'+n+'"}\n';return}
   if(c.op==='scatter'){const T0=state.find(x=>x.name===c.on);if(!T0||!T0.hf)throw new Error('scatter: on должен быть ландшафтом (terrain)');const S0=state.find(x=>x.name===c.src);if(!S0)throw new Error('scatter: нет объекта src '+c.src);
    const n=c.name||c.src+'_scatter';if(state.some(x=>x.name===n))throw new Error('Имя занято: '+n);let m0=S0.type==='mesh'?S0.size:toMesh(geo(S0.type,S0.size));const ts=m0.f.length/3,bud=c.budget||60000,cnt=Math.min(c.count||50,Math.max(1,Math.floor(bud/ts)));
    let av=[];if(c.avoid&&c.avoid.length){build();c.avoid.forEach(nm=>group.children.filter(x=>x.name===nm||x.name.startsWith(nm)).forEach(x=>{const b=new THREE.Box3().setFromObject(x),mg=c.margin===undefined?.5:c.margin;av.push({min:[b.min.x-T0.pos[0]-mg,b.min.z-T0.pos[2]-mg],max:[b.max.x-T0.pos[0]+mg,b.max.z-T0.pos[2]+mg]})}))}
    const pts=scatterPts(T0.hf,{...c,count:cnt,avoid:av},rng(c.seed||1));if(!pts.length)throw new Error('scatter: нет подходящих мест (ослабь maxSlope/minH/maxH/minDist)');
    const ss=S0.scale||1,mm=ss===1?m0:{...m0,v:m0.v.map(x=>x*ss)},col=new THREE.Color(S0.color||'#808080').getHexString(),r=scatterMerge(mm,pts,{color:'#'+col,seed:c.seed||1,jitter:c.jitter});
    state.push({name:n,type:'mesh',size:{v:r.v,f:r.f,c:r.c.map(x=>+x.toFixed(3))},pos:T0.pos.slice(),rot:[0,0,0],color:'#ffffff',rough:.9,ver:++VER});if(c.hideSrc)S0.hidden=true;
    NOTE+='рассеяно '+pts.length+'/'+(c.count||50)+' копий '+c.src+' одним мешем ('+r.f.length/3+' треугольников)'+(cnt<(c.count||50)?', ограничено бюджетом '+bud:'')+'\n';return}
   const faceGen3=(nm,hd,ctr,rad,style,c,eyesOnly)=>{const anime=style!=='real',F=face3dParts({c:ctr,r:rad,style,skin:c.skin||hd.color,eye:c.eye,parent:hd.name}),sc=rad[0]/.085;
    if(!eyesOnly&&c.reshape!==false){let m=asMesh(hd),k=0;while(m.v.length/3<2500&&k<3){m=subdivSel(m,null);k++}hd.size={...m,v:warpMesh(m,faceHeadPins(rad[0],rad[1],rad[2],style,F.eyeY,F.re),false).map(x=>+x.toFixed(4))};hd.ver=++VER}
    hd.fc='root';if(anime&&c.toon!==false){hd.toon=true;hd.outline=.0018*sc}
    const eid=regTex(rasterArt(256,128,eyeTexShapes({style,eye:c.eye,iris:c.iris}),[0,0,1,1]),256,128);
    F.parts.forEach(q=>{const o={name:nm+'_'+q.n,type:q.type,size:q.size,pos:q.pos,rot:[0,0,0],color:q.color,rough:q.rough,parent:hd.name,ver:++VER,fc:q.fc,rg:{role:q.role,side:q.side,depth:q.depth,pv:q.pv,p0:q.pos.slice(),r0:[0,0,0]}};if(q.fc==='eye')o.texid=eid;else if(anime)o.toon=true;state.push(o)});
    if(eyesOnly)return F.parts.length;
    const A=animeArt({skin:c.skin||hd.color,hair:c.hair,eye:c.eye,real:!anime}),Ww=F.kw,Hh=F.kh,eyeV=A.lm.eyeL[1];let n=0;
    A.layers.filter(L=>(anime?/^brow|^mouth$|^decor$/:/^brow/).test(L.n)).forEach(L=>{const cr=L.crop,pw=L.px,ph=Math.max(8,Math.round(pw*(cr[3]-cr[1])/(cr[2]-cr[0]))),id=regTex(rasterArt(pw,ph,L.shapes,cr),pw,ph),m0=puppetBuild(L,Ww,Hh),uc=(cr[0]+cr[2])/2,vc=(cr[1]+cr[3])/2,mm=drapeMesh(m0,[(uc-.5)*Ww,(eyeV-vc)*Hh+F.eyeY],rad,rad[2]*.012),sd=L.side||'C',fc=/^brow/.test(L.n)?'brow':L.n==='mouth'?'mouth':'static';
     state.push({name:nm+'_'+L.n,type:'mesh',size:mm,pos:ctr.slice(),rot:[0,0,0],color:'#ffffff',card:anime?true:'lit',ro:10+Math.round(L.z),texid:id,parent:hd.name,ver:++VER,fc,rg:{role:'decal',side:sd,depth:1,pv:ctr.slice(),p0:ctr.slice(),r0:[0,0,0]}});n++});
    return F.parts.length+n};
   const pushParts=(parts,pre,off,hostName,extra)=>{const O=a=>a.map((v,i)=>+(v+off[i]).toFixed(4));parts.forEach(q=>{const sz=q.size&&q.size.uv&&!q.size.uv.length?{...q.size,uv:undefined}:q.size;if(sz&&sz.uv===undefined)delete sz.uv;
     state.push({name:pre+q.n,type:q.type,size:sz,pos:O(q.pos),rot:q.rot||[0,0,0],color:q.color,rough:q.rough||.7,parent:q.parent?(q.parent===hostName?hostName:pre+q.parent):undefined,ver:++VER,fc:q.fc||(q.n==='head'?'root':undefined),rg:{role:q.role,side:q.side,depth:q.depth,pv:O(q.pv),p0:O(q.pos),r0:(q.rot||[0,0,0]).slice()},...(extra||{})})});state.forEach(x=>{if(x.parent===undefined)delete x.parent;if(x.fc===undefined)delete x.fc})};
   if(c.op==='make'){const ty=c.type||'human',pre=(c.name||ty)+'_';if(state.some(x=>x.name.startsWith(pre)))throw new Error('make: имя занято '+pre);const off=c.pos||[0,0,0];let parts;
    if(ty==='human')parts=humanParts({height:c.height,build:c.build,sex:c.sex,bust:c.bust,skin:c.skin||c.color});
    else if(ty==='anthro')parts=anthroParts(c.species||'fox',{height:c.height,build:c.build,sex:c.sex,bust:c.bust,color:c.color,ears:c.ears,tail:c.tail,digitigrade:c.digitigrade});
    else if(ty==='centaur')parts=centaurParts({scale:c.scale,height:c.height,color:c.color,skin:c.skin,sex:c.sex,build:c.build,bust:c.bust});
    else{parts=animalParts(ty,{scale:c.scale,color:c.color});if(ty==='dragon'){const hd=parts.find(p=>p.n==='head'),bd=parts.find(p=>p.n==='body'),dc=c.color||'#3d7a4a';parts.push(...addonParts('horns',c.horns||'curved',{c:hd.pos,s:hd.size.map(v=>v*2),col2:'#d8d0c0',parent:'head'}),...addonParts('wings',c.wings||'dragon',{c:bd.pos,s:bd.size.map(v=>v*2),col:dc,col2:hexMul(dc,.7),parent:'body',len:1.1}))}}
    const hk=(ty==='human'||ty==='centaur')?1:(c.height||1.75)/1.75,hdp=parts.find(p=>p.n==='head'),pel=parts.find(p=>p.n==='pelvis')||parts.find(p=>p.n==='body'),trs=parts.find(p=>p.n==='torso')||pel;
    if((ty==='human'||ty==='centaur')&&hdp){if(c.ears)parts.push(...addonParts('ears',c.ears,{c:hdp.pos,s:hdp.size.map(v=>v*2),k:hk,col:c.hairColor||c.color||'#6a4a3a',col2:'#f2b8b0',parent:'head'}));if(c.horns)parts.push(...addonParts('horns',c.horns,{c:hdp.pos,s:hdp.size.map(v=>v*2),k:hk,col2:'#d8d0c0',parent:'head'}))}
    if(ty==='human'&&pel){if(c.tail)parts.push(...addonParts('tail',c.tail,{c:pel.pos,s:pel.size.map(v=>v*2),k:hk,col:c.hairColor||c.color||'#6a4a3a',col2:'#ffffff',parent:'pelvis'}));if(c.wings&&trs)parts.push(...addonParts('wings',c.wings,{c:trs.pos,s:trs.size.map(v=>v*2),k:hk,col:c.wingColor||'#f4f4f8',col2:c.wingColor||'#f4f4f8',parent:'torso'}))}
    pushParts(parts,pre,off,null,c.toon?{toon:true,outline:.002}:null);
    if(c.face&&hdp&&(ty==='human'||ty==='anthro'||ty==='centaur')){const hd=state.find(x=>x.name===pre+'head'),rad=hd.size.slice(),n=faceGen3(pre+'f',hd,hd.pos.slice(),rad,c.face==='real'?'real':'anime',{skin:c.skin,eye:c.eye,hair:c.hairColor,toon:c.toon!==false},ty==='anthro')}
    if(c.fur){const fc=typeof c.fur==='object'?c.fur:{},fcol=c.color||(parts[0]&&parts[0].color);state.filter(x=>x.name.startsWith(pre)&&x.rg&&x.rg.role!=='fur'&&['body','neck','head','leg','arm','tail','ear','face','foot','hand','horn'].includes(x.rg.role)&&x.type!=='mesh'&&x.name!==pre+'nose').forEach(x=>furFor(x,{color:fcol,...fc}))}
    NOTE+='создано '+ty+' '+pre+': '+parts.length+' частей с ригом. Дальше: gait{prefix:"'+pre+'",clip:"walk"}'+(c.face?', faceanim{prefix:"'+pre+'",clip:"idle"}':', facegen{on:"'+pre+'head",style:"anime"}')+(c.fur?'':', fur{prefix:"'+pre+'"}')+'\n';return}
   if(c.op==='addon'){const T0=state.find(x=>x.name===c.on);if(!T0)throw new Error('addon: нет объекта '+c.on);build();const mm=group.children.find(q=>q.name===c.on);if(!mm)throw new Error('addon: объект скрыт');const b=new THREE.Box3().setFromObject(mm),pre=(c.name||c.kind)+'_';if(state.some(x=>x.name.startsWith(pre)))throw new Error('addon: имя занято '+pre);
    const parts=addonParts(c.kind,c.style,{c:b.getCenter(new THREE.Vector3()).toArray(),s:b.getSize(new THREE.Vector3()).toArray(),k:c.k||1,col:c.color,col2:c.color2,parent:c.on,len:c.length});pushParts(parts,pre,[0,0,0],c.on);NOTE+='добавлено '+c.kind+(c.style?' '+c.style:'')+': '+parts.length+' частей на '+c.on+'\n';return}
   if(c.op==='facegen'){const nm=c.name||'face',style=c.style==='real'?'real':'anime';let hd,ctr,rad;
    if(c.on){hd=state.find(x=>x.name===c.on);if(!hd)throw new Error('facegen: нет объекта '+c.on);build();const mm=group.children.find(q=>q.name===c.on),b=new THREE.Box3().setFromObject(mm);ctr=b.getCenter(new THREE.Vector3()).toArray().map(v=>+v.toFixed(4));rad=b.getSize(new THREE.Vector3()).multiplyScalar(.5).toArray();if(!hd.rg)hd.rg={role:'head',side:'C',depth:1,pv:[ctr[0],ctr[1]-rad[1]*.9,ctr[2]],p0:hd.pos.slice(),r0:(hd.rot||[0,0,0]).slice()}}
    else{if(state.some(x=>x.name===nm+'_head'))throw new Error('facegen: имя занято '+nm);rad=c.size||[.085,.105,.09];ctr=c.pos||[0,1.65,0];hd={name:nm+'_head',type:'ellipsoid',size:rad,pos:ctr,rot:[0,0,0],color:c.skin||'#ffe3d2',rough:style==='real'?.55:.8,ver:++VER,rg:{role:'head',side:'C',depth:1,pv:[ctr[0],ctr[1]-rad[1]*.9,ctr[2]],p0:ctr.slice(),r0:[0,0,0]}};state.push(hd)}
    const n=faceGen3(nm,hd,ctr,rad,style,c,false);NOTE+='лицо 3D ('+style+') '+nm+': '+n+' частей (глаза, веки, брови, рот). Дальше: faceanim{prefix:"'+nm+'_'+(c.on?'",names:[...]':'')+'",clip:"idle|talk|happy|angry|sad|surprised|sleepy"}, волосы: hair{on:"'+hd.name+'"}\n';return}
   if(c.op==='puppet'){const nm=c.name||'puppet';if(state.some(x=>x.name.startsWith(nm+'_')))throw new Error('puppet: имя занято '+nm);const A=animeArt({skin:c.skin,hair:c.hair,eye:c.eye,eyeSize:c.eyeSize,hairStyle:c.hairStyle,bangs:c.bangs,cloth:c.cloth,faceWidth:c.faceWidth,real:c.real}),Wd=c.width||.6,Hh=Wd*(c.aspect||1),off=c.pos||[0,0,0],zs=c.depth||.008,pv=[off[0],+(off[1]+(.5-.7)*Hh).toFixed(4),off[2]];
    A.layers.forEach(L=>{const cr=L.crop,pw=L.px,ph=Math.max(8,Math.round(pw*(cr[3]-cr[1])/(cr[2]-cr[0]))),id=regTex(rasterArt(pw,ph,L.shapes,cr),pw,ph),mesh=puppetBuild(L,Wd,Hh),uc=(cr[0]+cr[2])/2,vc=(cr[1]+cr[3])/2,pos=[+(off[0]+(uc-.5)*Wd).toFixed(4),+(off[1]+(.5-vc)*Hh).toFixed(4),+(off[2]+L.z*zs).toFixed(4)];
     const role=L.n==='face'?'root':/_iris$/.test(L.n)?'iris':/_(white|lash)$/.test(L.n)?'eyeCard':/^brow/.test(L.n)?'brow':L.n==='mouth'?'mouth':/^hair/.test(L.n)?'hair':'static',side=L.eye||L.side||'C';
     const o={name:nm+'_'+L.n,type:'mesh',size:{v:mesh.v,f:mesh.f,uv:mesh.uv,...(mesh.sk?{sk:mesh.sk}:{})},pos,rot:[0,0,0],color:'#ffffff',card:true,ro:Math.round(L.z*10),texid:id,parent:L.n==='face'?undefined:nm+'_face',ver:++VER,fc:role,rg:{role:'card',side,depth:1,pv:pv.slice(),p0:pos.slice(),r0:[0,0,0]}};
     const tzf=({eyeCard:.06,iris:.06,brow:.06,mouth:.06})[role]||(L.n==='decor'?.06:L.n==='hairFront'?.035:L.n==='hairBack'?-.02:0);o.fcd={...(role==='iris'?{dx:.014*Wd,dy:.008*Hh}:{}),...(tzf?{tz:+(tzf*Wd).toFixed(4)}:{})};if(!Object.keys(o.fcd).length)delete o.fcd;if(o.parent===undefined)delete o.parent;state.push(o)});
    NOTE+='рисованный пупет '+nm+': '+A.layers.length+' слоёв-карточек (глаза, брови, рот с деформацией). Анимация: faceanim{prefix:"'+nm+'_",clip:"idle|talk|happy|angry|sad|surprised|sleepy|turn"}, play{anim}. clip turn поворачивает голову до ±35° со сдвигом слоёв (фальшивый 3D). Смотреть спереди (view front)\n';return}
   if(c.op==='art'){const n=c.name;if(!n)throw new Error('art: нужен name');if(state.some(x=>x.name===n))throw new Error('Имя занято: '+n);if(!Array.isArray(c.shapes))throw new Error('art: shapes:[{t:"ell",c:[u,v],r:[ru,rv],fill:"#hex"|{g:"rad"|"lin",...stops},stroke,sw,a}|{t:"poly",p:[[u,v]..],smooth,fill}|{t:"line",p,sw,col}], координаты 0..1, v вниз');
    const w=c.w||.5,h=c.h||.5,px=Math.min(1024,c.px||256),py=Math.max(8,Math.round(px*h/w)),id=regTex(rasterArt(px,py,c.shapes,[0,0,1,1]),px,py),g=gridMesh(c.gx||1,c.gy||1,w,h);
    state.push({name:n,type:'mesh',size:{v:g.v,f:g.f,uv:g.uv},pos:c.pos||[0,0,0],rot:c.rot||[0,0,0],color:'#ffffff',card:c.lit?'lit':true,ro:c.ro||0,texid:id,ver:++VER});NOTE+='рисунок '+n+' '+px+'x'+py+'\n';return}
   if(c.op==='faceanim'){const rig=rigList(c),clip=c.clip||'idle',frames=faceCtl({clip,duration:c.duration,fps:c.fps,seed:c.seed}),keys=faceAnimKeys(rig,frames),an=c.anim||('face_'+clip);ANIM[an]={keys,loop:c.loop!==false};let hs=0;
    if(c.hair!==false){const nm=rig.filter(p=>p.fc==='hair').map(p=>p.n);if(nm.length){hs=nm.length;jiggleApply(an,nm,{k:70,gain:1,maxd:.012,size:.3})}}
    NOTE+='лицевая анимация '+an+' ('+clip+', '+frames[frames.length-1].t+' с, '+rig.length+' частей'+(hs?', волосы качаются':'')+'). Выбрать для кнопки «Играть»: play{anim} или anims:[тело,лицо] (тело и лицо вместе); кадр: pose{anim,time}\n';return}
   if(c.op==='play'){const L=c.anims||(c.anim?[c.anim]:[]);if(c.stop||!L.length){PLAYSEL=[];NOTE+='кнопка «Играть» проиграет первую анимацию\n';return}L.forEach(n=>{if(!ANIM[n])throw new Error('play: нет анимации '+n+'. Есть: '+(Object.keys(ANIM).join(', ')||'нет'))});PLAYSEL=L.slice();NOTE+='кнопка «Играть» проиграет вместе: '+L.join(' + ')+'\n';return}
   if(c.op==='surface'){const tg=c.name?state.filter(x=>x.name===c.name):state.filter(x=>x.name.startsWith(c.prefix||'\u0000'));if(!tg.length)throw new Error('surface: нужен name или prefix');tg.forEach(x=>{if(c.bump===false)delete x.bump;else x.bump={k:c.bump||'noise',sc:c.scale||4,st:c.strength===undefined?1.2:c.strength};x.ver=++VER});NOTE+='поверхность: '+tg.length+' объектов ('+(c.bump||'noise')+'). Нужны UV: примитивы и terrain имеют, tube и mesh после uv{}\n';return}
   if(c.op==='tree'||c.op==='hair'||c.op==='wear'||c.op==='cloth'){
    const n=c.name||c.op+(state.length+1);if(state.some(o=>o.name===n))throw new Error('Имя занято: '+n);
    let m,pos=c.pos||[0,0,0],rot=c.rot||[0,0,0],sc=c.scale,par=c.parent,rough=c.rough,col=c.color,info='';
    if(c.op==='tree'){m=treeGen(c);rough=rough===undefined?.9:rough;info='дерево '+(c.species||'oak')+' '+(c.height||5)+' м'}
    else if(c.op==='hair'){build();let ctr=c.center,rad=c.radii;
     if(c.on){const mm=group.children.find(x=>x.name===c.on);if(!mm)throw new Error('hair: нет объекта '+c.on);const b=new THREE.Box3().setFromObject(mm);ctr=ctr||b.getCenter(new THREE.Vector3()).toArray();rad=rad||b.getSize(new THREE.Vector3()).multiplyScalar(.5).toArray();par=par||c.on}
     if(!ctr||!rad)throw new Error('hair: нужен on (объект головы) или center и radii');
     m=hairGen({...c,center:[0,0,0],radii:rad});pos=ctr.map(v=>+v.toFixed(4));rough=rough===undefined?.55:rough;info='волосы '+(c.style||'long')+', прядей '+m.strands}
    else if(c.op==='wear'){const src=state.find(x=>x.name===(c.on||c.src));if(!src)throw new Error('wear: нет объекта '+(c.on||c.src)+' (поле on)');
     let m0=src.type==='mesh'?src.size:toMesh(geo(src.type,src.size)),k=0;const want=c.levels!==undefined?c.levels:3;
     while(k<want&&(c.levels!==undefined||m0.f.length/3<600)){m0=subdivSel(m0,null);k++}
     m=shellFrom(m0,c.region,{gap:c.gap,flare:c.flare,wrinkle:c.wrinkle,thick:c.thick});if(!m)throw new Error('wear: в области region нет граней (проверь локальные координаты y/x/z у '+src.name+' или добавь levels)');
     pos=src.pos.slice();rot=(src.rot||[0,0,0]).slice();sc=src.scale;par=c.parent||src.name;rough=rough===undefined?.85:rough;col=col||'#8a3a3a';info='одежда на '+src.name}
    else{build();const cols=[];(c.collide||[]).forEach(nm=>{const ms=group.children.filter(x=>x.name===nm||x.name.startsWith(nm));if(!ms.length)throw new Error('cloth: нет объекта '+nm);
      ms.forEach(x=>{const o=state.find(q=>q.name===x.name),b=new THREE.Box3().setFromObject(x),mn=b.min.toArray(),mx=b.max.toArray(),ct=[0,1,2].map(q=>(mn[q]+mx[q])/2),rr=[0,1,2].map(q=>(mx[q]-mn[q])/2),t=o&&o.type,tilt=o&&o.rot&&(Math.abs(o.rot[0]%180)>1||Math.abs(o.rot[2]%180)>1);
       if((t==='cylinder'||t==='cone')&&!tilt)cols.push({k:'cyl',c:ct,y:[mn[1],mx[1]],r:Math.max(rr[0],rr[2])});else if(t==='box'||t==='plane'||t==='extrude')cols.push({k:'box',min:mn,max:mx});else cols.push({k:'ell',c:ct,r:rr})})});
     const Cl=clothMk(c);clothSim(Cl,{colliders:cols,steps:c.steps,iter:c.iter,gravity:c.gravity,wind:c.wind,thick:c.thick,floor:c.floor,floorY:c.floorY,damp:c.damp});
     m={v:Cl.P,f:Cl.F,uv:Cl.UV};pos=[0,0,0];rot=[0,0,0];sc=undefined;rough=rough===undefined?.9:rough;col=col||'#8a3a3a';info='ткань '+(c.shape||'rect')+', коллайдеров '+cols.length}
    const out={v:m.v.map(x=>+x.toFixed(4)),f:m.f};if(m.c)out.c=m.c.map(x=>+x.toFixed(3));if(m.uv)out.uv=m.uv.map(x=>+x.toFixed(4));
    const o2={name:n,type:'mesh',size:out,pos,rot,color:col||'#b0b0b0',rough,metal:c.metal,opacity:c.opacity,scale:sc,parent:par,ver:++VER},pp=par&&state.find(x=>x.name===par);if(pp&&pp.rg)o2.rg={role:'attach',side:pp.rg.side,depth:1,pv:pp.rg.pv,p0:pos.slice(),r0:rot.slice()};state.push(o2);
    const tr=out.f.length/3;NOTE+=info+': '+n+', '+tr+' треугольников'+(tr>8000?' (много для игры: уменьши leafDensity/count/nx,ny)':'')+'\n';return}
   if(c.op==='simulate'||c.op==='drop'){
    build();
    const names=c.bodies||c.names||(c.prefix?[c.prefix]:null);if(!names||!names.length)throw new Error(c.op+': нужны bodies (имена или префиксы падающих объектов)');
    const groups=names.map(n=>{const e=state.filter(x=>x.name===n),g0=e.length?e:state.filter(x=>x.name.startsWith(n));if(!g0.length)throw new Error(c.op+': нет объектов '+n);return withKids(g0)});
    groups.flat().forEach(x=>{if(x.layer&&LAYERS[x.layer]&&LAYERS[x.layer].locked)throw new Error('Слой «'+x.layer+'» заблокирован ('+x.name+')')});
    const inB=new Set(groups.flat().map(x=>x.name)),exact=nm=>group.children.find(m=>m.name===nm),
     B=groups.map((g,i)=>{const bb=new THREE.Box3();g.forEach(x=>{const m=exact(x.name);if(m)bb.expandByObject(m)});if(bb.isEmpty())throw new Error(c.op+': у '+names[i]+' нет геометрии');
      const sp=g.length===1&&g[0].type==='sphere'&&c.spin!==false;const tp=g.length===1&&g[0].type==='box'&&c.tip!==false&&!(g[0].rot&&g[0].rot.some(v=>Math.abs(v)>1e-6));return{name:names[i],tip:tp,r:sp?(bb.max.y-bb.min.y)/2:0,min:bb.min.toArray(),max:bb.max.toArray(),vel:((c.vel||{})[names[i]]||[0,0,0]).slice()}}),
     S=group.children.filter(m=>m.visible!==false&&!inB.has(m.name)).map(m=>{const b=new THREE.Box3().setFromObject(m);return{name:m.name,min:b.min.toArray(),max:b.max.toArray()}});
    const drop=c.op==='drop',r=simAABB(B,S,{time:c.time||(drop?3:2),dt:c.dt,g:c.gravity,rest:drop?0:c.restitution,fric:c.friction,floor:c.floor,floorY:c.floorY,every:c.record?(c.every||.05):0});
    const base=groups.map(g=>g.map(x=>x.pos.slice())),rot0=groups.map(g=>g.map(x=>[...(x.rot||[0,0,0])]));
    if(c.record){const A=ANIM[c.record]={keys:[],loop:false};r.frames.forEach(f=>{const poses={};groups.forEach((g,i)=>g.forEach((x,j)=>{poses[x.name]={pos:base[i][j].map((v,k)=>+(v+f.off[i][k]).toFixed(4)),rot:(B[i].r||B[i].tip)?spinRot(rot0[i][j],f.rot[i]):[...rot0[i][j]]}}));A.keys.push({t:f.t,poses})})}
    groups.forEach((g,i)=>g.forEach((x,j)=>{x.pos=base[i][j].map((v,k)=>+(v+r.off[i][k]).toFixed(4));if(B[i].r||B[i].tip)x.rot=spinRot(rot0[i][j],r.rot[i])}));
    NOTE+='физика: '+B.map((b,i)=>b.name+' сместился на ['+r.off[i].map(v=>v.toFixed(2)).join(', ')+'], лежит на: '+(r.on[i]||'воздухе')+(B[i].tips?', опрокинулся '+B[i].tips+' раз':'')).join('; ')+' ('+r.steps+' шагов'+(c.record?', анимация «'+c.record+'»: '+r.frames.length+' ключей':'')+')\n';
    return}
   if(c.op==='photo'){
    const vs0=c.views||(['front','side','top'].includes(c.view||'front')?null:[c.view]);
    if(vs0){const refs=vs0.map(v=>{const R=REF[v];if(!R)throw new Error('photo: нет референса '+v+' (scene_reference)');refPx(R);return{R,view:v}});
     const tg=c.prefix?state.filter(x=>x.name.startsWith(c.prefix)):state.filter(x=>x.name===c.name);if(!tg.length)throw new Error('photo: нет объектов (name или prefix)');
     tg.forEach(o=>{let r;
      if(o.texid&&TEXS[o.texid]&&o.size.uv){const T=TEXS[o.texid];r=bakeUVMulti(o,refs,c,T);syncTex(T)}
      else{if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}const m=ensureColors(o),Lyr=c.layer?ensureLayer(m,c.layer):null;r=bakeMultiVerts(o,refs,c,Lyr);if(m.L)composite(m)}
      o.ver=++VER;NOTE+='сшивка '+o.name+': '+r.hit+' точек; яркость '+vs0.map((v,k)=>v+'×'+r.g[k].map(x=>x.toFixed(2)).join('/')).join(', ')+'\n'});
     return}
    const view=c.view||'front',R=REF[view];if(!R)throw new Error('photo: сначала scene_reference для вида '+view);
    if(!R.px){const cx=R.img.getContext('2d');R.px={d:cx.getImageData(0,0,R.img.width,R.img.height).data,w:R.img.width,h:R.img.height}}
    const tg=c.prefix?state.filter(x=>x.name.startsWith(c.prefix)):state.filter(x=>x.name===c.name);if(!tg.length)throw new Error('photo: нет объектов (name или prefix)');
    tg.forEach(o=>{if(o.texid&&TEXS[o.texid]&&o.size.uv){const T=TEXS[o.texid],hit=bakeUVTex(o,R,view,c,T);syncTex(T);o.ver=++VER;NOTE+='фото→текстура '+o.name+': '+hit+' пикселей\n';return}if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}const m=ensureColors(o),Lyr=c.layer?ensureLayer(m,c.layer):null,hit=bakePhoto(o,R,view,c,Lyr);if(m.L)composite(m);o.ver=++VER;
     const te=R.w/R.px.w,ed=avgEdge(m)*(o.scale||1);NOTE+='фото→'+o.name+': '+hit+' из '+(m.v.length/3)+' вершин'+(ed>te*1.5?'; сетка грубее фото в '+(ed/te).toFixed(1)+' раза (добавь subdiv center/radius)':'')+'\n'});
    return}
   if(c.op==='socket'){
    const o=state.find(x=>x.name===c.name);if(!o)throw new Error('socket: нет объекта '+c.name);if(!c.id)throw new Error('socket: нужен id');
    if(c.delete){if(o.sockets){delete o.sockets[c.id];if(!Object.keys(o.sockets).length)delete o.sockets}return}
    let pos=c.pos,dir=c.dir||[0,1,0];
    if(c.at||c.world){
     const iq=qE(o.rot).invert(),loc=w=>new THREE.Vector3(...w).sub(new THREE.Vector3(...o.pos)).applyQuaternion(iq.clone()).multiplyScalar(1/(o.scale||1)),ld=d=>new THREE.Vector3(...d).applyQuaternion(iq.clone()).normalize();
     let w=c.world,d=c.dir||[0,1,0];
     if(c.at){build();const b=bbName(o.name);if(!b)throw new Error('socket: нет геометрии '+o.name);const C=b.getCenter(new THREE.Vector3()),F={top:[[C.x,b.max.y,C.z],[0,1,0]],bottom:[[C.x,b.min.y,C.z],[0,-1,0]],left:[[b.min.x,C.y,C.z],[-1,0,0]],right:[[b.max.x,C.y,C.z],[1,0,0]],front:[[C.x,C.y,b.max.z],[0,0,1]],back:[[C.x,C.y,b.min.z],[0,0,-1]],center:[[C.x,C.y,C.z],[0,1,0]]}[c.at];
      if(!F)throw new Error('socket at: top, bottom, left, right, front, back, center');w=F[0];d=F[1]}
     pos=loc(w).toArray().map(x=>+x.toFixed(4));dir=ld(d).toArray().map(x=>+x.toFixed(4))}
    if(!pos)throw new Error('socket: нужен at, world или pos');
    o.sockets=Object.assign({},o.sockets,{[c.id]:{pos,dir}});return}
   if(c.op==='connect'){connectSock(c);return}
   if(c.op==='snap'){snapSock(c);return}
   if(c.op==='constrain'){
    const t=c.type;if(!['lookat','limit','distance','rest','mirror','plane'].includes(t))throw new Error('constrain type: lookat, limit, distance, rest, mirror, plane');
    const has=n=>state.some(x=>x.name===n||x.name.startsWith(n));
    if(t==='distance'){if(!has(c.a)||!has(c.b)||typeof c.dist!=='number')throw new Error('distance: нужны a, b (объекты) и dist (метры)')}
    else if(t!=='mirror'){if(!c.name||!has(c.name))throw new Error(t+': нет объекта '+c.name);if(t==='plane'&&typeof c.value!=='number')throw new Error('plane: нужны axis (x|y|z) и value');
     if(t==='lookat'&&!(Array.isArray(c.target)||has(c.target)))throw new Error('lookat: target имя объекта или [x,y,z]');
     if(t==='limit'&&(typeof c.min!=='number'||typeof c.max!=='number'))throw new Error('limit: нужны axis, min, max (градусы)');
     if(t==='rest'&&c.on&&c.on!=='floor'&&!has(c.on))throw new Error('rest: нет объекта '+c.on)}
    const k={...c,id:c.id||t+'_'+(c.name||c.b||(c.swap?c.swap.join(''):'LR'))};delete k.op;const i=CON.findIndex(x=>x.id===k.id);if(i>=0)CON[i]=k;else CON.push(k);
    return}
   if(c.op==='unconstrain'){
    const n=CON.length;for(let i=CON.length-1;i>=0;i--)if(CON[i].id===c.id||CON[i].name===c.name||CON[i].b===c.name)CON.splice(i,1);
    if(CON.length===n)throw new Error('unconstrain: нет такой связи (id или name)');return}
   if(c.op==='shape'){
    const o=state.find(x=>x.name===c.name);if(!o)throw new Error('shape: нет объекта '+c.name);
    if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}
    const m=o.size;
    if(c.base)m.b=m.v.slice();
    if(c.key){
     if(!m.b)throw new Error('shape: сначала {op:"shape",name,base:true}, потом лепи выражение, потом сохрани key');
     if(m.v.length!==m.b.length)throw new Error('shape: топология изменилась после base');
     if(!(m.sk&&m.sk[c.key])&&Object.keys(m.sk||{}).length>=8)throw new Error('shape: максимум 8 форм на объект');
     m.sk=m.sk||{};m.sk[c.key]=m.v.map((x,i)=>+(x-m.b[i]).toFixed(4));m.v=m.b.slice()}
    if(c.delete&&m.sk){delete m.sk[c.delete];if(!Object.keys(m.sk).length)m.sk=null;if(o.w)delete o.w[c.delete]}
    if(c.weights){Object.keys(c.weights).forEach(k=>{if(!m.sk||!m.sk[k])throw new Error('shape: нет формы '+k+'. Есть: '+Object.keys(m.sk||{}).join(', '))});o.w=Object.assign({},o.w,c.weights)}
    o.ver=++VER;return}
   if(c.op==='mask'){
    const o=state.find(x=>x.name===c.name);if(!o)throw new Error('mask: нет объекта '+c.name);
    if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}
    const m=o.size;
    if(c.clear)m.mk=null;
    else if(c.invert){if(!m.mk)m.mk=new Array(m.v.length/3).fill(0);m.mk=m.mk.map(x=>+(1-x).toFixed(3))}
    else{const s=o.scale||1,inv=new THREE.Matrix4().compose(new THREE.Vector3(...o.pos),qE(o.rot),new THREE.Vector3(s,s,s)).invert();
     (c.strokes||[c]).forEach(st=>{if(!st.center||!st.radius)throw new Error('mask: нужны center [x,y,z] (мировые) и radius, или clear/invert');
      const C=new THREE.Vector3(...st.center).applyMatrix4(inv),R=st.radius/s,str=st.strength!==undefined?st.strength:1,sym=st.symmetry!==undefined?st.symmetry:c.symmetry;
      maskM(m,C.toArray(),R,str);if(sym)maskM(m,[-C.x,C.y,C.z],R,str)})}
    o.ver=++VER;return}
   if(c.op==='paint'){
    const o=state.find(x=>x.name===c.name);if(!o)throw new Error('paint: нет объекта '+c.name);
    if(o.type!=='mesh'){o.size=toMesh(geo(o.type,o.size));o.type='mesh'}
    const m=o.size;if(!m.c){const b=new THREE.Color(o.color||'#b0b0b0');m.c=[];for(let i=0;i<m.v.length/3;i++)m.c.push(b.r,b.g,b.b)}
    const s=o.scale||1,inv=new THREE.Matrix4().compose(new THREE.Vector3(...o.pos),qE(o.rot),new THREE.Vector3(s,s,s)).invert();
    (c.strokes||[c]).forEach(st=>{
     const hex=st.color||c.color;if(!hex)throw new Error('paint: нужен color');const col=new THREE.Color(hex),rgb=[col.r,col.g,col.b],Lyr=(st.layer||c.layer)?ensureLayer(m,st.layer||c.layer):null;
     if(o.texid&&TEXS[o.texid]&&m.uv){const T=TEXS[o.texid];
      if(st.all||c.all)paintUVTex(o,T,null,0,rgb,1,true);
      else{if(!st.center||!st.radius)throw new Error('paint: нужны center [x,y,z] (мировые) и radius, или all:true');const str2=st.strength!==undefined?st.strength:1,sym2=st.symmetry!==undefined?st.symmetry:c.symmetry;
       paintUVTex(o,T,st.center,st.radius,rgb,str2,false);
       if(sym2){const s0=o.scale||1,Cl=new THREE.Vector3(...st.center).applyMatrix4(inv),Cm=new THREE.Vector3(-Cl.x,Cl.y,Cl.z).multiplyScalar(s0).applyQuaternion(qE(o.rot)).add(new THREE.Vector3(...o.pos));paintUVTex(o,T,Cm.toArray(),st.radius,rgb,str2,false)}}
      syncTex(T);return}
     if(st.all||c.all){paintM(m,[0,0,0],1,rgb,1,true,Lyr);return}
     if(!st.center||!st.radius)throw new Error('paint: нужны center [x,y,z] (мировые) и radius, или all:true');
     const C=new THREE.Vector3(...st.center).applyMatrix4(inv),R=st.radius/s,str=st.strength!==undefined?st.strength:1,sym=st.symmetry!==undefined?st.symmetry:c.symmetry;
     paintM(m,C.toArray(),R,rgb,str,false,Lyr);if(sym)paintM(m,[-C.x,C.y,C.z],R,rgb,str,false,Lyr)});
    if(m.L)composite(m);o.ver=++VER;return}
   if(c.op==='unbool'||c.op==='rebool'){
    const R0=state.find(x=>x.name===c.name&&x.src);if(!R0)throw new Error(c.op+': нет живого выреза '+c.name+' (нужен bool с live:true)');
    const a0=state.find(x=>x.name===R0.src.a),bs=R0.src.b.map(n=>state.find(x=>x.name===n)).filter(Boolean);if(!a0||!bs.length)throw new Error(c.op+': исходники потеряны');
    if(c.op==='rebool'){const PP=boolPolys(a0,bs,R0.src.mode);R0.size=R0.type==='mesh'?polysMesh(PP,a0):polysObj(PP);R0.ver=++VER}
    else{[a0,...bs].forEach(x=>{delete x.hidden});state=state.filter(x=>x!==R0)}
    return}
   if(c.op==='key'){
    const A=ANIM[c.anim]||(ANIM[c.anim]={keys:[],loop:false});if(c.loop!==undefined)A.loop=!!c.loop;
    const sel=c.names?state.filter(x=>c.names.includes(x.name)):c.prefix?state.filter(x=>x.name.startsWith(c.prefix)):state;
    if(!sel.length)throw new Error('key: нечего записывать');
    const poses={};sel.forEach(x=>poses[x.name]={pos:[...x.pos],rot:[...(x.rot||[0,0,0])],w:x.w?{...x.w}:undefined});
    const t=c.time||0,ex=A.keys.find(k=>k.t===t);if(ex){Object.assign(ex.poses,poses);if(c.ease)ex.ease=c.ease}else{A.keys.push({t,poses,ease:c.ease});A.keys.sort((p,q)=>p.t-q.t)}
    return}
   if(c.op==='pose'){const A=ANIM[c.anim];if(!A)throw new Error('Нет анимации: '+c.anim);sampleInto(A,c.time||0);return}
   if(c.op==='anim_del'){delete ANIM[c.anim];return}
   if(c.op==='parent'){
    const o2=state.find(x=>x.name===c.name);if(!o2)throw new Error('Нет объекта: '+c.name);
    if(c.to){if(!state.some(x=>x.name===c.to))throw new Error('Нет родителя: '+c.to);if(c.to===c.name||kids(c.name).some(k=>k.name===c.to))throw new Error('Цикл в иерархии');o2.parent=c.to}else delete o2.parent;
    return}
   if(c.op==='rotate'){
    const g=withKids(state.filter(x=>x.name===c.name||(c.prefix&&x.name.startsWith(c.prefix))));if(!g.length)throw new Error('rotate: нет объектов (name или prefix)');
    const pv=typeof c.pivot==='string'?(state.find(x=>x.name===c.pivot)||{}).pos:c.pivot;if(!pv)throw new Error('rotate: нужен pivot [x,y,z] или имя объекта');
    const R=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...({x:[1,0,0],y:[0,1,0],z:[0,0,1]}[c.axis||'y'])),(c.deg||0)*Math.PI/180),P=new THREE.Vector3(...pv);
    g.forEach(x=>{x.pos=new THREE.Vector3(...x.pos).sub(P).applyQuaternion(R).add(P).toArray();
     const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...(x.rot||[0,0,0]).map(d=>d*Math.PI/180))).premultiply(R),e=new THREE.Euler().setFromQuaternion(q);
     x.rot=[e.x,e.y,e.z].map(r=>+(r*180/Math.PI).toFixed(3))});return}
   if(c.op==='place'){
    build();
    const sel=n=>{const e=group.children.filter(m=>m.name===n);return e.length?e:group.children.filter(m=>m.name.startsWith(n))};
    const bb=n=>{const a=sel(n);if(!a.length)throw new Error('Нет объекта: '+n);const b=new THREE.Box3();a.forEach(m=>b.expandByObject(m));return b};
    const s=bb(c.name),t=bb(c.to),sc=s.getCenter(new THREE.Vector3()),tc=t.getCenter(new THREE.Vector3()),g=c.gap||0,d=[0,0,0];
    switch(c.rel||'on'){
     case'on':d[1]=t.max.y+g-s.min.y;d[0]=tc.x-sc.x;d[2]=tc.z-sc.z;break;
     case'under':d[1]=t.min.y-g-s.max.y;d[0]=tc.x-sc.x;d[2]=tc.z-sc.z;break;
     case'left':d[0]=t.min.x-g-s.max.x;d[1]=t.min.y-s.min.y;d[2]=tc.z-sc.z;break;
     case'right':d[0]=t.max.x+g-s.min.x;d[1]=t.min.y-s.min.y;d[2]=tc.z-sc.z;break;
     case'front':d[2]=t.max.z+g-s.min.z;d[1]=t.min.y-s.min.y;d[0]=tc.x-sc.x;break;
     case'behind':d[2]=t.min.z-g-s.max.z;d[1]=t.min.y-s.min.y;d[0]=tc.x-sc.x;break;
     default:throw new Error('rel: on, under, left, right, front, behind');
    }
    const nn=sel(c.name).map(m=>m.name);
    withKids(state.filter(x=>nn.includes(x.name))).forEach(x=>{x.pos=x.pos.map((v,i)=>v+d[i])});return}
   if(c.op==='define'){
    const g=state.filter(x=>x.name.startsWith(c.prefix||'\u0000'));if(!g.length||!c.name)throw new Error('define: нужны name и prefix существующих объектов');
    const O=c.origin||[g.reduce((s,x)=>s+x.pos[0],0)/g.length,0,g.reduce((s,x)=>s+x.pos[2],0)/g.length];
    const parts=g.map(x=>({n:x.name.slice(c.prefix.length)||'part',type:x.type,size:x.size,pos:[x.pos[0]-O[0],x.pos[1]-O[1],x.pos[2]-O[2]],rot:x.rot,color:x.color,rough:x.rough,metal:x.metal,opacity:x.opacity,scale:x.scale,main:1}));
    CUSTOM[c.name]=()=>parts;return}
   if((c.prefix||c.op==='move')&&(c.op==='move'||c.op==='del'||c.op==='set')){
    const g=c.prefix?state.filter(x=>x.name.startsWith(c.prefix)):state.filter(x=>x.name===c.name);if(!g.length)throw new Error('Нет объектов: '+(c.prefix||c.name));
    if(c.op==='del'){const rm=withKids(g);state=state.filter(x=>!rm.includes(x))}else if(c.op==='set')g.forEach(x=>['color','rough','metal','opacity'].forEach(k=>{if(c[k]!==undefined)x[k]=c[k]}));else withKids(g).forEach(x=>{x.pos=x.pos.map((v,i)=>v+(c.by||[0,0,0])[i])});return}
   const o=state.find(x=>x.name===c.name);
   if(!o)throw new Error('Нет объекта: '+c.name);
   if(c.op==='del'){state=state.filter(x=>x!==o);return}
   if(c.op==='set'){
    const ks=kids(o.name);if(c.size!==undefined)o.ver=++VER;
    if(ks.length&&(c.pos||c.rot)){const P0=new THREE.Vector3(...o.pos),qe=r=>new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r||[0,0,0]).map(a=>a*Math.PI/180)));
     const d=c.pos?new THREE.Vector3(...c.pos).sub(P0):new THREE.Vector3(),R=c.rot?qe(c.rot).multiply(qe(o.rot).invert()):new THREE.Quaternion();
     ks.forEach(k=>{if(c.rot)rigid(k,R,P0,d);else k.pos=new THREE.Vector3(...k.pos).add(d).toArray()})}
    ;['pos','rot','size','color','type','rough','metal','opacity','scale'].forEach(k=>{if(c[k]!==undefined)o[k]=c[k]});geo(o.type,o.size);return}
   const nm=x=>{if(state.some(s=>s.name===x))throw new Error('Имя занято: '+x);return x};
   const cp=(n,f)=>{const q=JSON.parse(JSON.stringify(o));q.name=nm(n);if(f)f(q);state.push(q)};
   if(c.op==='clone'){cp(c.as||o.name+'_копия',q=>{if(c.pos)q.pos=c.pos});return}
   if(c.op==='mirror'){const a={x:0,y:1,z:2}[c.axis||'x'];cp(c.as||o.name+'_зерк',q=>{q.pos[a]=-q.pos[a]});return}
   if(c.op==='array'){const n=c.count||2;for(let i=1;i<n;i++)cp(o.name+'_'+(i+1),q=>{if(c.around){rigid(q,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...({x:[1,0,0],y:[0,1,0],z:[0,0,1]}[c.axis||'y'])),(c.angle||360)/n*i*Math.PI/180),new THREE.Vector3(...c.around),new THREE.Vector3())}else q.pos=q.pos.map((v,k)=>v+(c.step||[1,0,0])[k]*i)});return}
   throw new Error('Неизвестная команда: '+c.op+'. Доступны: add, set, del, clone, mirror, array, clear');
  });
 }catch(e){state=JSON.parse(hist.pop());build();return{ok:false,error:e.message}}
 build();const warn=settle();return{ok:true,summary:summary()+warn+(NOTE?'\n'+NOTE.trim():'')};
}
let __SR=null,__SRenv=null;   // site: shared offscreen renderer (freed in __dispose)
function offR(){if(!__SR)__SR=new THREE.WebGLRenderer({preserveDrawingBuffer:true});return __SR}
function offEnv(){if(!__SRenv)__SRenv=mkEnv(offR());return __SRenv}
function snap(S=256,only,lab,opt){
 const r=offR();const prevEnv=scene.environment;scene.environment=offEnv();lodUpdate(true);
 r.setSize(S,S);r.setClearColor(bg());
 const out=document.createElement('canvas');const VS=[['Спереди',[0,0,1]],['Сбоку',[1,0,0]],['Сверху',[0,1,0]],['Три четверти',null]].filter(v=>!only||only.includes(v[0]));const cols=VS.length>1?2:1;out.width=S*cols;out.height=S*Math.ceil(VS.length/cols);
 const x=out.getContext('2d');
 const fm=opt&&opt.focus?group.children.filter(m=>opt.focus.some(n=>m.name===n||m.name.startsWith(n))):[],bb=new THREE.Box3();(fm.length?fm:[group]).forEach(m=>bb.expandByObject(m));const e=bb.isEmpty();
 const c=e?new THREE.Vector3(0,.5,0):bb.getCenter(new THREE.Vector3());
 const rad=Math.max(e?1:bb.getSize(new THREE.Vector3()).length()/2,fm.length?.004:1)*1.25/((opt&&opt.zoom)||1);
 VS.forEach(([t,d],i)=>{
  let k;
  if(d){k=new THREE.OrthographicCamera(-rad,rad,rad,-rad,.1,500);k.position.copy(c).addScaledVector(new THREE.Vector3(...d),50)}
  else{k=new THREE.PerspectiveCamera(40,1,.01,500);k.position.copy(c).add(isoDir(opt).multiplyScalar(rad*3))}
  if(t==='Сверху')k.up.set(0,0,-1);k.lookAt(c);r.render(scene,k);
  const px=i%cols*S,py=Math.floor(i/cols)*S;
  x.drawImage(r.domElement,px,py);
  if(d)drawRef(x,px,py,S,t,c,rad);
  if(lab){x.font='10px system-ui,sans-serif';x.lineWidth=2.5;x.strokeStyle='#000';x.fillStyle='#ffe066';
   group.children.slice(0,40).forEach(m=>{const v=new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).project(k);
    if(Math.abs(v.x)>1||Math.abs(v.y)>1||v.z>1)return;const lx=px+(v.x*.5+.5)*S,ly=py+(-v.y*.5+.5)*S;x.strokeText(m.name,lx,ly);x.fillText(m.name,lx,ly)})}
  if(d){const L=S/(2*rad);x.fillStyle='#fff';x.fillRect(px+8,py+S-14,L,3);x.font='10px system-ui,sans-serif';x.lineWidth=2.5;x.strokeStyle='#000';x.strokeText('1 м',px+L+12,py+S-9);x.fillText('1 м',px+L+12,py+S-9)}
  x.font='bold 14px system-ui,sans-serif';x.lineWidth=3;x.strokeStyle='#000';x.fillStyle='#fff';
  x.strokeText(t,px+8,py+20);x.fillText(t,px+8,py+20);
 });
 x.strokeStyle='#888';x.lineWidth=1;x.strokeRect(.5,.5,out.width-1,out.height-1);
 scene.environment=prevEnv;dirty=true;lodOn=true;return out;
}
function mkEnv(rend){try{
 const c=document.createElement('canvas');c.width=2;c.height=256;const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,256);
 gr.addColorStop(0,'#cfe3f5');gr.addColorStop(.5,'#8d98a3');gr.addColorStop(1,'#3a3f45');g.fillStyle=gr;g.fillRect(0,0,2,256);
 const es=new THREE.Scene();
 es.add(new THREE.Mesh(new THREE.SphereGeometry(50,32,16),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),side:THREE.BackSide})));
 const b=new THREE.Mesh(new THREE.BoxGeometry(30,1,20),new THREE.MeshBasicMaterial({color:new THREE.Color(6,6,6)}));b.position.set(0,30,0);es.add(b);
 const pm=new THREE.PMREMGenerator(rend),t=pm.fromScene(es).texture;pm.dispose();return t;
}catch(e){return null}}
// камера
let th=.8,ph=1.1,dist=9;const tgt=new THREE.Vector3(0,.8,0),P=new Map();
function place(){cam.position.set(tgt.x+dist*Math.sin(ph)*Math.sin(th),tgt.y+dist*Math.cos(ph),tgt.z+dist*Math.sin(ph)*Math.cos(th));cam.lookAt(tgt)}
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);P.set(e.pointerId,[e.clientX,e.clientY])});
cv.addEventListener('pointermove',e=>{
 const p=P.get(e.pointerId);if(!p)return;
 if(P.size===1){th-=(e.clientX-p[0])*.01;ph=Math.min(3,Math.max(.1,ph-(e.clientY-p[1])*.01))}
 else if(P.size===2){
  const a=[...P.values()],d0=Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]);
  P.set(e.pointerId,[e.clientX,e.clientY]);
  const b=[...P.values()],d1=Math.hypot(b[0][0]-b[1][0],b[0][1]-b[1][1]);
  if(d1>0)dist=Math.min(60,Math.max(2,dist*d0/d1));
 }
 P.set(e.pointerId,[e.clientX,e.clientY]);dirty=true;
});
['pointerup','pointercancel'].forEach(t=>cv.addEventListener(t,e=>P.delete(e.pointerId)));
cv.addEventListener('wheel',e=>{e.preventDefault();dist=Math.min(60,Math.max(2,dist*(1+e.deltaY*.001)));dirty=true},{passive:false});
function fit(){const w=cv.clientWidth,h=cv.clientHeight;R.setPixelRatio(PR);R.setSize(w,h,false);cam.aspect=w/Math.max(h,1);cam.updateProjectionMatrix();dirty=true}
const __ro=new ResizeObserver(fit);__ro.observe($('#stage'));
const __FR=new Float32Array(4096);let __frN=0,__rend=false,__tick=0,__cost=0;   // site: CPU ms of rendered frames (ring); frame pacing
(function loop(){if(!__alive)return;__raf=requestAnimationFrame(loop);
 const __now=performance.now();if(__rend){const d=__now-__tick;if(d<100&&d>0)ft=ft*.9+d*.1;__rend=false}__tick=__now;
 if(!(dirty||playing||!SET.onDemand))return;
 const t0=performance.now();R.setClearColor(bg());place();
 if(SET.lod||SET.cull){lodOn=true;lodUpdate(false)}else if(lodOn){lodUpdate(true);lodOn=false}
 R.render(scene,cam);dirty=false;if(__lodPend){__lodPend=false;dirty=true}const __c=performance.now()-t0;__FR[__frN++&4095]=__c;__cost=__cost*.9+__c*.1;__rend=true;lastT=t0;
 if(SET.adaptive){const mx=Math.min(devicePixelRatio,2);if(ft>30&&PR>.6&&__cost<ft*.6){PR=Math.max(.6,PR-.1);fit()}else if(ft<20&&PR<mx){PR=Math.min(mx,PR+.1);fit()}}   // site
})();

// интерфейс
const out=$('#out');
function say(t,err){out.textContent=t;out.className=err?'err':''}
$('#run').onclick=()=>{
 let c;try{c=JSON.parse($('#cmd').value)}catch(e){return say('Это не JSON: '+e.message,1)}
 const r=run(c);r.ok?say(r.summary):say('Ошибка: '+r.error+'\nСцена не изменилась.',1);
};
$('#undo').onclick=()=>{if(!hist.length)return say('Отменять нечего.');redo.push(JSON.stringify(state));state=JSON.parse(hist.pop());build();say(summary())};
$('#redo').onclick=()=>{if(!redo.length)return say('Возвращать нечего.');hist.push(JSON.stringify(state));state=JSON.parse(redo.pop());build();say(summary())};
$('#sum').onclick=()=>say(summary());
$('#json').onclick=()=>say(JSON.stringify(state));
$('#snap').onclick=()=>{const s=$('#shot');s.src=snap().toDataURL('image/png');s.style.display='block';say('Скриншот ниже. Сохрани его и отправь ИИ вместе со сводкой.')};
function obj(){let s='',off=1;group.children.forEach(m=>{m.updateMatrixWorld();const g=m.geometry,p=g.attributes.position,ix=g.index;s+='o '+m.name+'\n';
 for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);s+='v '+v.x.toFixed(4)+' '+v.y.toFixed(4)+' '+v.z.toFixed(4)+'\n'}
 const n=ix?ix.count:p.count;
 for(let i=0;i<n;i+=3){const a=ix?ix.getX(i):i,b=ix?ix.getX(i+1):i+1,d=ix?ix.getX(i+2):i+2;s+='f '+(a+off)+' '+(b+off)+' '+(d+off)+'\n'}
 off+=p.count});return s}
const PROMPT=`Ты управляешь 3D-сценой. Отвечай ТОЛЬКО JSON-массивом команд. Y вверх, единицы — метры, углы в градусах, pos — центр объекта.
Команды: add {name,type,size,pos,rot,color,rough,metal,opacity}; set {name,...поля}; del {name}; clone {name,as,pos}; mirror {name,axis:"x"|"y"|"z",as}; array {name,count,step:[x,y,z]}; clear.
Типы и size: box [w,h,d]; sphere [r]; cylinder [r,h]; cone [r,h]; torus [R,r]; plane [w,d]; lathe [[r,y],...] профиль вращения; extrude [глубина,[[x,y],...]] контур.
После выполнения я пришлю сводку и скриншот 2×2 (спереди, сбоку, сверху, 3/4). Исправляй по ним пересечения и объекты в воздухе. Работай по шагам: сначала крупные формы, потом детали.`;
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch(e){return false}}
$('#ins').onclick=async()=>{const ok=await copyText(PROMPT);say((ok?'Скопировано. Вставь ИИ в начале чата:\n\n':'Скопируй вручную и вставь ИИ:\n\n')+PROMPT)};
$('#obj').onclick=async()=>{const t=obj();say(await copyText(t)?'OBJ скопирован ('+t.length+' символов). Вставь в файл с расширением .obj.':t)};
function __exportGLB(){return env&&env.exportGLB?env.exportGLB(group,clips()):Promise.reject(new Error('экспорт GLB недоступен'))}   // site: ai3d-gltf.js
$('#glb').onclick=()=>{say('Готовлю GLB…');__exportGLB().then(b=>{const a=document.createElement('a'),u=URL.createObjectURL(new Blob([b],{type:'model/gltf-binary'}));a.href=u;a.download='model.glb';a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);say('GLB готов: '+Math.round(b.byteLength/1024)+' КБ')},e=>say('Экспорт GLB не удался: '+(e&&e.message||e),1))};
$('#play').onclick=()=>{
 if(playing){cancelAnimationFrame(playing.id);state=JSON.parse(playing.keep);build();playing=null;$('#play').textContent='Играть';return}
 const names=(PLAYSEL.length?PLAYSEL:[Object.keys(ANIM).find(k=>ANIM[k].keys.length>1)]).filter(k=>k&&ANIM[k]&&ANIM[k].keys.length>1);if(!names.length)return say('Анимаций нет. Claude создаёт их командами key, gait, faceanim.');
 const keep=JSON.stringify(state),t0=performance.now();playing={keep};$('#play').textContent='Стоп';
 const step=()=>{const t=(performance.now()-t0)/1000;names.forEach(nm=>{const A=ANIM[nm],T=A.keys[A.keys.length-1].t||1;sampleInto(A,A.loop?t:Math.min(t,T))});build();settle();playing.id=requestAnimationFrame(step)};playing.id=requestAnimationFrame(step)};
['lod','cull','adaptive','onDemand'].forEach(k=>{const el=$('#set-'+k);el.checked=SET[k];el.onchange=()=>{SET[k]=el.checked;dirty=true;lodOn=true;$('#st').textContent=JSON.stringify(stats())}});
$('#perf').addEventListener('toggle',()=>{$('#st').textContent=JSON.stringify(stats())});
$('#test').onclick=()=>say(selftest());
const __api=window.AI3D={run,selftest,summary,obj,state:()=>state,snapshot:()=>snap().toDataURL('image/png'),stats,exportGLB:()=>__exportGLB()};   // site: + stats, exportGLB
let __ws=null,__wsT=0,__wsTry=0;const __wsCtl={};
function __wsUrl(u){if(!u)return null;if(u==='1'||u===true)u='ws://localhost:3737';try{const x=new URL(String(u));return /^wss?:$/.test(x.protocol)&&/^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)?x.href:null}catch(e){return null}}

$('#cmd').value=JSON.stringify([
 {op:'add',name:'столешница',type:'box',size:[3,.15,1.6],pos:[0,1.5,0],color:'#a8754a'},
 {op:'add',name:'нога1',type:'box',size:[.15,1.5,.15],pos:[-1.35,.75,-.65],color:'#6d4a2e'},
 {op:'add',name:'нога2',type:'box',size:[.15,1.5,.15],pos:[1.35,.75,-.65],color:'#6d4a2e'},
 {op:'add',name:'нога3',type:'box',size:[.15,1.5,.15],pos:[-1.35,.75,.65],color:'#6d4a2e'},
 {op:'add',name:'нога4',type:'box',size:[.15,1.5,.15],pos:[1.35,.75,.65],color:'#6d4a2e'},
 {op:'add',name:'ваза',type:'cylinder',size:[.18,.5],pos:[.6,1.825,0],color:'#3d8fd1'}
],null,1);
(function(){
 let url=__wsUrl(env&&env.ws);   // site: was ?ws= or always ws://localhost:3737
 const VN={front:'Спереди',side:'Сбоку',top:'Сверху',iso:'Три четверти'};
 let last=[];
 const img=(v,S,hl,lab,opt)=>{const ms=group.children.filter(m=>hl&&hl.includes(m.name));ms.forEach(m=>m.material.emissive.set(0x663300));const u=snap(S||384,v&&v.map(k=>VN[k]),lab,opt).toDataURL('image/jpeg',.7).split(',')[1];ms.forEach(m=>m.material.emissive.set(0));return u};
 const key=a=>Object.fromEntries(a.map(o=>[o.name,JSON.stringify(o)]));
 function diff(a,b){const A=key(a),B=key(b);return{added:b.filter(o=>!A[o.name]).map(o=>o.name),changed:b.filter(o=>A[o.name]&&A[o.name]!==B[o.name]).map(o=>o.name),removed:a.filter(o=>!B[o.name]).map(o=>o.name)}}
 async function handle(q){
  if(q.tool==='apply'){const b=JSON.parse(JSON.stringify(state)),r=run(q.commands);
   if(!r.ok)return{error:r.error+' Сцена не изменена.'};
   const d=diff(b,state),ch=[...d.added,...d.changed];last=ch;
   return{text:'+'+d.added.join(',')+' ~'+d.changed.join(',')+' -'+d.removed.join(',')+'\n'+summary(ch),image:q.view&&q.view!=='none'?img(q.view==='grid'?null:[q.view],384,ch):null}}
  if(q.tool==='look')return{text:'виды: '+(q.views||['iso']).join(','),image:img(q.views,q.size,q.highlight?last:null,q.labels,{focus:q.focus,az:q.az,el:q.el,zoom:q.zoom})};
  if(q.tool==='info')return{text:summary(q.names)};
  if(q.tool==='sheet'){const A=ANIM[q.anim];if(!A||A.keys.length<2)return{error:'Нет анимации с 2+ ключами: '+q.anim};
   const keep=JSON.stringify(state),n=q.frames||4,S=q.size||192,T=A.keys[A.keys.length-1].t,cv2=document.createElement('canvas');cv2.width=S*n;cv2.height=S;const x=cv2.getContext('2d');
   try{for(let i=0;i<n;i++){const t=T*i/(A.loop?n:n-1);sampleInto(A,t);build();settle();x.drawImage(snap(S,[VN[q.view||'side']]),i*S,0);
    x.font='bold 12px system-ui,sans-serif';x.lineWidth=3;x.strokeStyle='#000';x.fillStyle='#fff';const tx=(+t.toFixed(2))+' с';x.strokeText(tx,i*S+S-52,S-8);x.fillText(tx,i*S+S-52,S-8)}}
   finally{state=JSON.parse(keep);build()}
   return{text:'Анимация '+q.anim+': '+n+' кадров, 0–'+T+' с',image:cv2.toDataURL('image/jpeg',.7).split(',')[1]}}
  if(q.tool==='perf'){['lod','cull','adaptive','onDemand'].forEach(k=>{if(q[k]!==undefined){SET[k]=!!q[k];$('#set-'+k).checked=SET[k]}});dirty=true;lodOn=true;return{text:JSON.stringify({...SET,...stats()})}}
  if(q.tool==='selftest')return{text:selftest()};
  if(q.tool==='query')return{text:JSON.stringify(queryRun(q))};
  if(q.tool==='ref')return await loadRef(q);
  if(q.tool==='compare')return refCompare(q.view,q.size||256);
  if(q.tool==='manifest'){const bbx=n=>{const m=group.children.find(x=>x.name===n);if(!m)return null;const b=new THREE.Box3().setFromObject(m);return{min:b.min.toArray(),max:b.max.toArray()}};return{text:JSON.stringify(manifestOf(state,ANIM,LAYERS,CON,bbx))}}
  if(q.tool==='dump')return{text:JSON.stringify({s:state,a:ANIM,k:CON,l:LAYERS,so:SOLO,t:Object.fromEntries(Object.entries(TEXS).filter(([id])=>state.some(o=>o.texid===id)).map(([id,T])=>[id,T.cv.toDataURL('image/png')])),c:Object.fromEntries(Object.entries(CUSTOM).map(([k,f])=>[k,f()]))})};
  if(q.tool==='load'){hist.push(JSON.stringify(state));const j=JSON.parse(q.json);state=j.s||j;if(j.c)Object.entries(j.c).forEach(([k,v])=>CUSTOM[k]=()=>v);Object.keys(ANIM).forEach(k=>delete ANIM[k]);if(j.a)Object.assign(ANIM,j.a);CON.length=0;if(j.k)CON.push(...j.k);Object.keys(LAYERS).forEach(k=>delete LAYERS[k]);if(j.l)Object.assign(LAYERS,j.l);SOLO=j.so||null;if(j.t)Object.entries(j.t).forEach(([id,u])=>loadTex(id,u));build();return{text:'Загружено.\n'+summary()}}
  if(q.tool==='export')return __exportGLB().then(b=>{const u=new Uint8Array(b);let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return{text:'GLB, '+u.length+' байт',data:btoa(s)}});
  if(q.tool==='undo'||q.tool==='redo'){for(let i=0;i<(q.n||1);i++)$('#'+q.tool).click();return{text:(q.tool==='undo'?'Отменено':'Возвращено')+' шагов: '+(q.n||1)+'\n'+summary()}}
  return{error:'Неизвестный инструмент'};
 }
 function conn(){if(!__alive||!url)return;let ws;try{ws=new WebSocket(url)}catch(e){return}__ws=ws;
  ws.onopen=()=>{__wsTry=0;say('ИИ подключён: '+url);if(env&&env.onAI)env.onAI(true)};
  ws.onclose=()=>{if(__ws===ws)__ws=null;if(env&&env.onAI)env.onAI(false);if(__alive&&url&&++__wsTry<=20)__wsT=setTimeout(conn,3000)};
  ws.onmessage=async m=>{let q;try{q=JSON.parse(m.data)}catch(e){return}let r;try{r=await handle(q)}catch(e){r={error:e.message}}if(ws.readyState===1)ws.send(JSON.stringify({id:q.id,...r}))};
 }
 __wsCtl.connect=u=>{const v=__wsUrl(u||'1');if(!v)return false;url=v;__wsTry=0;clearTimeout(__wsT);if(__ws){try{__ws.onclose=null;__ws.close()}catch(e){}__ws=null}conn();return true};
 conn();
})();
{const e0=scene.environment;scene.environment=mkEnv(R)||e0;if(e0&&e0!==scene.environment)e0.dispose()}
// ═══ site: what the shell (ai3d-ui.js) and tests use ═══
function __frame(){const b=new THREE.Box3();group.children.forEach(m=>{if(!m.userData.aux)b.expandByObject(m)});if(b.isEmpty())return;b.getCenter(tgt);dist=Math.min(150,Math.max(2,b.getSize(new THREE.Vector3()).length()*1.05));dirty=true}   // site: camera onto the scene (examples)
function __reset(){state=[];hist.length=0;redo.length=0;Object.keys(ANIM).forEach(k=>delete ANIM[k]);CON.length=0;Object.keys(LAYERS).forEach(k=>delete LAYERS[k]);SOLO=null;PLAYSEL=[];build()}
function __dispose(){if(!__alive)return;__alive=false;cancelAnimationFrame(__raf);try{__ro.disconnect()}catch(e){}
 if(playing){cancelAnimationFrame(playing.id);playing=null}
 clearTimeout(__wsT);if(__ws){try{__ws.onclose=null;__ws.close()}catch(e){}__ws=null}
 while(group.children.length){const m=group.children[0];group.remove(m);m.material.dispose();m.children.forEach(c=>c.material&&c.material.dispose())}
 GC.forEach(g=>{g.dispose();const L=LODC.get(g);if(L)L.forEach(x=>x.dispose())});GC.clear();
 Object.keys(TEXS).forEach(k=>{if(TEXS[k].tex)TEXS[k].tex.dispose();delete TEXS[k]});BT.forEach(t=>t.dispose());BT.clear();if(TG){TG.dispose();TG=null}
 scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(mt=>{if(mt.map)mt.map.dispose();mt.dispose()})});
 if(scene.environment)scene.environment.dispose();scene.environment=null;if(__SRenv){__SRenv.dispose();__SRenv=null}
 if(dl.shadow&&dl.shadow.map){dl.shadow.map.dispose();dl.shadow.map=null}
 try{R.dispose();R.forceContextLoss()}catch(e){}if(__SR){try{__SR.dispose();__SR.forceContextLoss()}catch(e){}__SR=null}
 if(__cm&&'legacyMode' in __cm)__cm.legacyMode=__cmL;
 if(window.AI3D===__api)delete window.AI3D}
const __site={api:__api,say,run,reset:__reset,frame:__frame,cam:(t,p,d)=>{th=+t;ph=Math.min(3,Math.max(.1,+p));if(d)dist=Math.min(150,Math.max(.3,+d));dirty=true},dispose:__dispose,redraw:()=>{dirty=true},exportGLB:__exportGLB,connectAI:u=>__wsCtl.connect(u),
 aiOn:()=>!!(__ws&&__ws.readyState===1),stats,state:()=>state,clips,
 frames:()=>{const n=Math.min(__frN,4096),o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=__FR[(__frN-n+i)&4095];__frN=0;return o}};
fit();build();$('#run').click();
/*@ai3d-body-end*/
return __site;
}
window.D37AI3DCore={create};
})();
