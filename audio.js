'use strict';
function audioContext() {
 if(!S.ctx){ const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('当前浏览器不支持 Web Audio。请改用桌面 Chrome、Edge 或 Firefox。');
  S.ctx=new AC();S.gain=S.ctx.createGain();S.gain.gain.value=Number($('volume').value)/100;S.gain.connect(S.ctx.destination);
  $('sampleRateInfo').textContent=(S.ctx.sampleRate/1000).toFixed(1)+' kHz'; }
 return S.ctx;
}
function makeBuffer(n,sr){return audioContext().createBuffer(1,Math.max(1,n),sr);}
function toMono(buf){const out=makeBuffer(buf.length,buf.sampleRate),d=out.getChannelData(0);for(let c=0;c<buf.numberOfChannels;c++){const x=buf.getChannelData(c);for(let i=0;i<d.length;i++)d[i]+=x[i]/buf.numberOfChannels;}return out;}
function copySlice(buf,a=0,b=buf.duration){const sr=buf.sampleRate,start=clamp(Math.round(a*sr),0,buf.length-1),end=clamp(Math.round(b*sr),start+1,buf.length);const o=makeBuffer(end-start,sr);o.getChannelData(0).set(buf.getChannelData(0).subarray(start,end));return o;}
// Exact reversal. No fading or filtering here: R(R(x)) === x sample-for-sample.
function reverseBuffer(buf){const o=makeBuffer(buf.length,buf.sampleRate),d=o.getChannelData(0),x=buf.getChannelData(0);for(let i=0;i<x.length;i++)d[i]=x[x.length-1-i];return o;}
function peakOf(buf){let p=0;const x=buf.getChannelData(0);for(let i=0;i<x.length;i++)p=Math.max(p,Math.abs(x[i]));return p;}
function silenceBounds(buf){
 // 10 ms RMS blocks; conservative threshold, retain 55 ms around speech.
 const x=buf.getChannelData(0),sr=buf.sampleRate,block=Math.max(1,Math.round(sr*.01)),levels=[];
 let max=0;for(let s=0;s<x.length;s+=block){let power=0;const len=Math.min(block,x.length-s);for(let j=0;j<len;j++)power+=x[s+j]*x[s+j];const rms=Math.sqrt(power/len);levels.push(rms);max=Math.max(max,rms);}
 if(max<0.0001)return [0,buf.duration];
 const threshold=Math.max(.0005,max*.022);let a=0,b=levels.length-1;
 while(a<b && levels[a]<threshold)a++;while(b>a && levels[b]<threshold)b--;
 return [Math.max(0,a*block/sr-.055),Math.min(buf.duration,(b+1)*block/sr+.055)];
}
function trimSilence(buf){const [a,b]=silenceBounds(buf);return copySlice(buf,a,b);}
function validRange(a,b,duration,min=.03){
 if(!Number.isFinite(a)||!Number.isFinite(b))return [0,duration];
 const minLen=Math.min(min,duration);a=clamp(a,0,Math.max(0,duration-minLen));b=clamp(b,a+minLen,duration);return [a,b];
}
async function decodeBytes(bytes){
 const ctx=audioContext();let b;try{b=await ctx.decodeAudioData(bytes.slice(0));}catch(_){throw new Error('无法解码这个文件。格式可能不受当前浏览器支持，或文件已损坏；请改用 WAV / MP3。');}
 if(!Number.isFinite(b.duration)||b.duration<.04)throw new Error('音频太短，至少需要 0.04 秒。');
 if(b.duration>MAX_SECONDS+.15)throw new Error('这个音频超过 90 秒。请先截成短片段再导入。');return toMono(b);
}
function setSource(buf,name){
 stopPlayback();clearSegmentState();S.source=buf;S.sourceName=name;S.sourceRange=[0,buf.duration];
 views.source.setBuffer(buf);invalidate();checkLevel(buf);
}

function checkLevel(buf){const p=peakOf(buf);if(p<.003)notice('这段音频非常安静或接近无声。请确认麦克风选择正确，或靠近麦克风重新录制。','info');else if(p>.998)notice('输入音频接近满幅，可能已削波。后期峰值保护不能修复输入失真，建议降低录音音量。','info');}

function invalidate(){S.sessionDirty=true;S.revision++;S.result=null;S.resultInfo=null;views.result.setBuffer(null);if(S.play)stopPlayback();sync();}

function sync(){
 const busy=locked(),hasSrc=!!S.source,hasResult=!!S.result,ready=segmentReady();
 $('sourceChip').textContent=hasSrc?'已就绪 · '+fmt(S.source.duration):'等待音频';$('sourceChip').className='chip'+(hasSrc?' ready':'');
 $('sourceName').textContent=hasSrc?S.sourceName:'WAV · MP3 · M4A 等，取决于浏览器解码支持';$('sourceName').title=S.sourceName;
 $('sourceBounds').hidden=!hasSrc;
 if(hasSrc){$('sourceStart').value=S.sourceRange[0].toFixed(2);$('sourceEnd').value=S.sourceRange[1].toFixed(2);$('sourceStart').max=S.source.duration.toFixed(3);$('sourceEnd').max=S.source.duration.toFixed(3);views.source.setSelection(S.sourceRange);}
 $('sourceEmpty').classList.toggle('hide',hasSrc);$('resultEmpty').classList.toggle('hide',hasResult);
 for(const id of ['importSource','loadDemo','loadSession','clearAll','recordSource'])$(id).disabled=busy;
 for(const id of ['sourceStart','sourceEnd','sourceTrim','sourceReset','playSource','exportSource','addSourceSegment','wholeAsSegment'])$(id).disabled=busy||!hasSrc;
 $('trimTake').disabled=busy;document.querySelectorAll('.effect,.preset').forEach(e=>e.disabled=busy);
 $('recordSource').classList.toggle('active',S.mic?.target==='source');
 $('generate').disabled=busy||!ready;$('generate').querySelector('span').textContent=S.rendering?'正在渲染…':'合成并试听';$('generate').querySelector('svg').classList.toggle('busyspin',S.rendering);
 $('playResult').disabled=busy||!hasResult;$('exportResult').disabled=busy||!hasResult;$('saveSession').disabled=busy||(!hasSrc&&!S.legacyTake);
 $('exportLegacyTake').hidden=!S.legacyTake;$('exportLegacyTake').disabled=busy;
 $('resultDuration').textContent=fmt(hasResult?S.result.duration:0);$('resultFormat').textContent=hasResult?`16-bit PCM WAV · ${(S.result.sampleRate/1000).toFixed(1)} kHz · MONO`:'16-bit PCM WAV · 单声道';
 const rs=$('resultState');rs.className='resultstate';
 if(S.rendering)rs.textContent='正在本机处理音频…';
 else if(hasResult){rs.classList.add('success');rs.textContent=`${S.segments.length} 段已反向还原并按台词顺序合成。试听与导出使用同一份结果。`+(S.resultInfo?.peak<.001?' 此结果接近无声。':'');}
 else if(!ready)rs.textContent=S.segments.length?`已录 ${recordedSegments().length} / ${S.segments.length} 段，全部录好后可合成。`:'建立片段，点击片段录音。短句也可以直接作为 1 段。';
 else{rs.classList.add('warning');rs.textContent='录音已就绪。点击合成；修改录音或音效后需要重新合成。';}
 syncSegments();updateSliders();updatePlayButtons();syncCueRecordButton();
 document.body.classList.toggle('recbusy',!!S.mic);$('sourceCard').classList.toggle('record-card',S.mic?.target==='source');
}
function updateSliders(){
 const rate=Number($('outputRate').value)/100,shift=12*Math.log2(rate);
 $('rateValue').textContent=rate.toFixed(2)+'×';$('pitchNote').textContent='速度与音高联动 · 音高变化 '+(shift>=0?'+':'')+shift.toFixed(1)+' 半音';
 $('reverbValue').textContent=$('reverb').value+'%';document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===S.lastPreset));
}
function params(){return{rate:Number($('outputRate').value)/100,wet:Number($('reverb').value)/100,normalize:$('normalize').checked,trim:$('trimTake').checked};}
function preset(name){if(locked())return;const p={clean:{rate:100,wet:0},subtle:{rate:97,wet:8},dream:{rate:88,wet:23}}[name];if(!p)return;$('outputRate').value=p.rate;$('reverb').value=p.wet;S.lastPreset=name;invalidate();}

// Waveforms: cached peaks, drawing only. Selections also have number-field equivalents.
class WaveView {
 constructor(id,key,onRange=null){this.el=$(id);this.key=key;this.buffer=null;this.range=null;this.progress=null;this.peaks=[];this.w=0;this.h=0;this.anchor=null;this.onRange=onRange;new ResizeObserver(()=>this.resize()).observe(this.el);
  if(onRange){this.el.addEventListener('pointerdown',e=>{if(!this.buffer||locked())return;stopPlayback();this.anchor=this.timeAt(e);this.anchorX=e.clientX;this.el.setPointerCapture(e.pointerId);});
   this.el.addEventListener('pointermove',e=>{if(this.anchor===null)return;const t=this.timeAt(e);this.range=[Math.min(this.anchor,t),Math.max(this.anchor,t)];this.draw();});
   this.el.addEventListener('pointerup',e=>{if(this.anchor===null)return;const t=this.timeAt(e),a=this.anchor,click=Math.abs(e.clientX-this.anchorX)<5;this.anchor=null;if(this.key==='source'&&click){const seg=hitSegment(t);if(seg)selectSegment(seg.id);else this.setSelection(S.sourceRange);return;}const r=click?[0,this.buffer.duration]:validRange(Math.min(t,a),Math.max(t,a),this.buffer.duration);onRange(r);});
   this.el.addEventListener('pointercancel',()=>{this.anchor=null;this.draw();});}
 }
 timeAt(e){const b=this.el.getBoundingClientRect();return clamp((e.clientX-b.left)/b.width,0,1)*this.buffer.duration;}
 setBuffer(b){this.buffer=b;this.range=null;this.progress=null;this.calcPeaks();this.draw();}
 setSelection(r){this.range=r;this.draw();}
 resize(){const r=this.el.getBoundingClientRect();if(!r.width||!r.height)return;const d=window.devicePixelRatio||1;this.w=r.width;this.h=r.height;this.el.width=Math.round(this.w*d);this.el.height=Math.round(this.h*d);this.el.getContext('2d').setTransform(d,0,0,d,0,0);this.calcPeaks();this.draw();}
 calcPeaks(){this.peaks=[];if(!this.buffer||!this.w)return;const x=this.buffer.getChannelData(0),cols=Math.ceil(this.w/2);let max=.15;for(let c=0;c<cols;c++){const a=Math.floor(c*x.length/cols),b=Math.max(a+1,Math.floor((c+1)*x.length/cols));let lo=0,hi=0;for(let j=a;j<Math.min(x.length,b);j++){lo=Math.min(lo,x[j]);hi=Math.max(hi,x[j]);}this.peaks.push([lo,hi]);max=Math.max(max,Math.abs(lo),hi);}this.scale=.35/max;}
 draw(){if(!this.w||!this.h)return;const c=this.el.getContext('2d'),w=this.w,h=this.h;c.clearRect(0,0,w,h);
  c.strokeStyle='#ffffff07';c.lineWidth=1;for(let x=0;x<w;x+=50){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}c.strokeStyle='#6f404746';c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();
  if(!this.buffer)return;
  if(this.range){const a=this.range[0]/this.buffer.duration*w,b=this.range[1]/this.buffer.duration*w;c.fillStyle='#b344551a';c.fillRect(a,0,b-a,h);c.fillStyle='#00000044';c.fillRect(0,0,a,h);c.fillRect(b,0,w-b,h);c.fillStyle='#d47a88';c.fillRect(a,0,1,h);c.fillRect(Math.min(w-1,b),0,1,h);}
  drawSegmentMarkers(this,c,w,h);
  c.strokeStyle=this.key==='result'?'#d8ba8a':'#d58a95';c.lineWidth=1.3;c.beginPath();const cols=this.peaks.length;for(let i=0;i<cols;i++){const [lo,hi]=this.peaks[i],x=i*w/cols;c.moveTo(x,h*.48-lo*this.scale*h);c.lineTo(x,h*.48-hi*this.scale*h);}c.stroke();
  c.fillStyle='#a38188';c.font='9px ui-monospace,Consolas,monospace';c.fillText('0:00',7,h-6);const stamp=fmt(this.buffer.duration);c.fillText(stamp,w-c.measureText(stamp).width-7,h-6);
  if(this.progress!==null){const p=clamp(this.progress/this.buffer.duration,0,1)*w;c.fillStyle='#f8e7c4';c.fillRect(p,0,1.5,h);c.beginPath();c.moveTo(p-3,0);c.lineTo(p+4,0);c.lineTo(p+1,5);c.fill();}
 }
}
const views={
 source:new WaveView('sourceWave','source',r=>{S.sourceRange=r;S.sessionDirty=true;sync();}),
 result:new WaveView('resultWave','result')
};
const segmentViews={model:new WaveView('segmentModelWave','segmentModel'),take:new WaveView('segmentTakeWave','segmentTake',changeSegmentTakeRange)};
function updatePlayButtons(){for(const k of Object.keys(playIds)){const b=$(playIds[k]);const span=b.querySelector('span');const text=S.play?.key===k?'■ 停止':playLabels[k];if(span)span.textContent=text;else b.textContent=text;}updateSegmentPlaybackButtons();}
function stopPlayback(){S.playTicket++;const p=S.play;S.play=null;if(p){cancelAnimationFrame(p.raf);p.source.onended=null;try{p.source.stop();}catch(_){}try{p.source.disconnect();}catch(_){}const view=playingView(p.key);if(view){view.progress=null;view.draw();}}updatePlayButtons();}
async function playBuffer(key,buffer,range=[0,buffer.duration],rate=1,loop=false){
 if(S.mic)return;if(S.play?.key===key){stopPlayback();return;}stopPlayback();const ticket=S.playTicket;const ctx=audioContext();await ctx.resume();if(ticket!==S.playTicket||S.mic)return;
 const src=ctx.createBufferSource();src.buffer=buffer;src.playbackRate.value=rate;src.connect(S.gain);src.loop=loop;if(loop){src.loopStart=range[0];src.loopEnd=range[1];}
 let viewOffset=0;if(key.startsWith('seg:take:')){const seg=segmentById(key.slice(9));if(seg){viewOffset=seg.takeRange[0];if($('trimTake').checked)viewOffset+=silenceBounds(copySlice(seg.take,...seg.takeRange))[0];}}const p={key,source:src,started:ctx.currentTime,range,rate,loop,raf:null,viewOffset};S.play=p;
 src.onended=()=>{if(S.play===p){S.play=null;src.disconnect();cancelAnimationFrame(p.raf);const view=playingView(key);if(view){view.progress=null;view.draw();}updatePlayButtons();}};
 if(loop)src.start(0,range[0]);else src.start(0,range[0],Math.max(.001,range[1]-range[0]));
 function tick(){if(S.play!==p)return;const length=range[1]-range[0],elapsed=(ctx.currentTime-p.started)*rate,time=range[0]+(loop?elapsed%length:Math.min(elapsed,length));const view=playingView(key);if(view){view.progress=time+p.viewOffset;view.draw();}const timeline=key==='result'?S.resultInfo?.timeline:['segmentPreview','allTakes'].includes(key)?S.previewTimeline:null;if(timeline)markSegmentPlaying(timeline.find(t=>time>=t.start&&time<t.end)?.id||null);p.raf=requestAnimationFrame(tick);}tick();updatePlayButtons();
}
async function playKey(key){if(locked())return;const buf=key==='source'?S.source:S.result;if(!buf)return;await playBuffer(key,buf,key==='source'?S.sourceRange:[0,buf.duration]);}

// Short-window reversal with overlap-add only around boundaries. No speech recognition.

function makeImpulse(ctx,seconds=1.6){const n=Math.ceil(ctx.sampleRate*seconds),b=ctx.createBuffer(1,n,ctx.sampleRate),x=b.getChannelData(0);let seed=76193;for(let i=0;i<n;i++){seed=(1664525*seed+1013904223)>>>0;const rnd=(seed/4294967296)*2-1,attack=Math.min(1,i/(ctx.sampleRate*.012));x[i]=rnd*Math.exp(-7*i/n)*attack;}return b;}
async function renderEffect(buf,p){
 const OC=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!OC)throw new Error('浏览器缺少 OfflineAudioContext，无法渲染成品。');
 const tail=p.wet>0?1.6:0,length=Math.ceil(buf.length/p.rate+tail*buf.sampleRate),ctx=new OC(1,Math.max(1,length),buf.sampleRate);
 const src=ctx.createBufferSource();src.buffer=buf;src.playbackRate.value=p.rate;
 const dry=ctx.createGain();dry.gain.value=1-p.wet*.35;src.connect(dry);dry.connect(ctx.destination);
 if(p.wet>0){const cv=ctx.createConvolver();cv.buffer=makeImpulse(ctx);const wet=ctx.createGain();wet.gain.value=p.wet*1.35;src.connect(cv);cv.connect(wet);wet.connect(ctx.destination);}
 src.start();const rendered=await ctx.startRendering(),x=rendered.getChannelData(0);
 let peak=peakOf(rendered),gain=1;if(p.normalize&&peak>.0005)gain=Math.min(Math.pow(10,12/20),.9/peak);else if(peak>.98)gain=.98/peak;
 const edge=Math.min(Math.round(buf.sampleRate*.003),Math.floor(x.length/2));
 for(let i=0;i<x.length;i++){let f=1;if(i<edge)f=.5-.5*Math.cos(Math.PI*i/edge);else if(i>=x.length-edge)f=.5-.5*Math.cos(Math.PI*(x.length-1-i)/edge);x[i]*=gain*f;}
 return rendered;
}
async function generate(autoplay=true){
 if(locked()||!segmentReady())return;stopPlayback();S.rendering=true;const revision=S.revision,p=params();sync();
 try{await audioContext().resume();await nextFrame();const joined=joinSegmentTakes(sortedSegments(),{reverse:true,trim:p.trim,gapMs:Number($('segmentGap').value),fade:$('segmentFade').checked});
  const result=await renderEffect(joined.buffer,p);if(revision!==S.revision)return;
  S.result=result;S.resultInfo={params:p,peak:peakOf(result),timeline:joined.timeline.map(t=>({...t,start:t.start/p.rate,end:t.end/p.rate}))};views.result.setBuffer(result);
 }finally{S.rendering=false;sync();}
 if(autoplay&&S.result)await playKey('result');
}
async function importAudio(file){
 if(!file||locked()||!confirmSourceReplacement())return;
 if(file.size>MAX_BYTES)throw new Error('文件超过 30 MB，请先裁成更短的语音。');if(!file.size)throw new Error('这是一个空文件。');
 S.loading=true;stopPlayback();sync();try{const b=await decodeBytes(await file.arrayBuffer());setSource(b,file.name);notice('正常台词已导入。框选建立片段，或直接将全段作为 1 段。','success');checkLevel(b);}finally{S.loading=false;sync();}
}
function base64Bytes(s){const bin=atob(s),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a;}
async function demo(){
 if(locked()||!confirmSourceReplacement())return;S.loading=true;stopPlayback();sync();
 try{const b=await decodeBytes(base64Bytes(DEMO_WAV).buffer);setSource(b,'内置合成示例 · Fire walk with me');notice('已载入 Fire walk with me。示例是内嵌合成语音，不是剧中采样。点击「听原声」试听，再划段或全段练习。','success');}finally{S.loading=false;sync();}
}

