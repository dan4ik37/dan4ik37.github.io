// ═══════════════════════════════════════
//  САУНДБОРД — Web Audio API (без файлов)
// ═══════════════════════════════════════
let audioCtx=null;
function getCtx(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();return audioCtx}

const SOUNDS={
  clap:   ()=>synthClap(),
  airhorn:()=>synthAirhorn(),
  tada:   ()=>synthTada(),
  sad:    ()=>synthSad(),
  wow:    ()=>synthWow(),
  gg:     ()=>synthGG(),
  fail:   ()=>synthFail(),
  bruh:   ()=>synthBruh(),
};

function getVol(){return parseFloat(document.getElementById('soundVol')?.value||0.7)}

function makeOsc(type,freq,start,dur,vol=0.4){
  const ctx=getCtx(),o=ctx.createOscillator(),g=ctx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,ctx.currentTime+start);
  g.gain.setValueAtTime(0,ctx.currentTime+start);
  g.gain.linearRampToValueAtTime(vol*getVol(),ctx.currentTime+start+0.01);
  g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+start+dur);
  o.connect(g);g.connect(ctx.destination);
  o.start(ctx.currentTime+start);o.stop(ctx.currentTime+start+dur+0.05);
}
function makeNoise(start,dur,vol=0.3){
  const ctx=getCtx(),buf=ctx.createBuffer(1,ctx.sampleRate*dur,ctx.sampleRate);
  const d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1);
  const src=ctx.createBufferSource(),g=ctx.createGain(),f=ctx.createBiquadFilter();
  src.buffer=buf;f.type='bandpass';f.frequency.value=1000;
  g.gain.setValueAtTime(vol*getVol(),ctx.currentTime+start);
  g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+start+dur);
  src.connect(f);f.connect(g);g.connect(ctx.destination);
  src.start(ctx.currentTime+start);
}
function synthClap(){makeNoise(0,.08,.5);makeNoise(0.1,.1,.4);makeNoise(0.2,.12,.3)}
function synthAirhorn(){[0,.1,.2,.3].forEach(t=>makeOsc('sawtooth',440+t*20,t,.4,.6));makeOsc('sawtooth',660,0,.8,.5)}
function synthTada(){[0,.15,.3].forEach((t,i)=>{makeOsc('sine',[523,659,784][i],t,.4,.4)});makeOsc('sine',1047,.45,.6,.5)}
function synthSad(){makeOsc('sine',392,0,.6,.3);makeOsc('sine',349,.3,.6,.3);makeOsc('sine',330,.6,.8,.3)}
function synthWow(){const ctx=getCtx(),o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(200,ctx.currentTime);o.frequency.linearRampToValueAtTime(800,ctx.currentTime+.3);o.frequency.linearRampToValueAtTime(400,ctx.currentTime+.6);g.gain.setValueAtTime(.4*getVol(),ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+.7);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.75)}
function synthGG(){[0,.1,.2,.35].forEach((t,i)=>makeOsc('square',[523,659,784,1047][i],t,.25,.35))}
function synthFail(){makeOsc('sawtooth',400,0,.15,.4);makeOsc('sawtooth',300,.15,.2,.4);makeOsc('sawtooth',200,.35,.3,.4);makeOsc('sawtooth',150,.65,.4,.3)}
function synthBruh(){makeOsc('sine',180,0,.8,.5);makeOsc('sine',160,.1,.9,.3)}

function playSound(btn,type){
  SOUNDS[type]&&SOUNDS[type]();
  btn.classList.add('playing');
  setTimeout(()=>btn.classList.remove('playing'),600);
}
