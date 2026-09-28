'use strict';
// Session microphone: keep one live MediaStream; silence it between takes.
// Permission is requested only after a user action and only if no live stream exists.
// No graph is connected to speakers, no idle audio is recorded or persisted.
function liveSessionMic(){return !!S.sharedMic?.getAudioTracks().some(t=>t.readyState==='live');}
function updateMicStatus(){
 const live=liveSessionMic(),rec=S.mic?.state==='recording',pending=!!S.micPending||S.micSetup;
 $('micSession').className='mic-session'+(live?' ready':'')+(rec?' recording':'');
 $('micStatusText').textContent=rec?'正在录音':S.mic?.state==='countdown'?'准备录音':pending?'等待麦克风授权':live?'麦克风待命 · 未录音':'麦克风未启用';
 $('enableMic').hidden=live;$('enableMic').disabled=locked()||pending;
 $('releaseMicButton').hidden=!live&&!pending;$('releaseMicButton').disabled=false;
 $('micSession').title='本页复用已授权的连接；非录音时音轨静音。浏览器可能仍显示权限指示。点击释放可关闭连接。';
 $('dialogMicState').textContent=rec?'正在录音':live?'已连接 · 复用授权':pending?'等待授权':'首次录音需要授权';
}
async function acquireSessionMic(){
 if(liveSessionMic())return S.sharedMic;
 if(S.micPending)return S.micPending;
 if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前页面无法访问麦克风。请保存 HTML 后本地打开，或使用 localhost / HTTPS；也可导入录音。');
 const epoch=S.micEpoch;
 let pending;
 pending=navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false}).then(stream=>{
  if(epoch!==S.micEpoch){stream.getTracks().forEach(t=>t.stop());throw new DOMException('已取消麦克风请求。','AbortError');}
  S.sharedMic=stream;
  for(const track of stream.getAudioTracks()){
   track.enabled=false;
   track.addEventListener('ended',()=>{
    if(S.sharedMic!==stream)return;
    S.sharedMic=null;
    if(S.mic?.stream===stream){stopRecording(true);notice('麦克风连接已中断，本次未完成的录音已取消，旧录音保留。再次点击录音可重新连接。','error');}
    else notice('麦克风已断开。下次点击录音时会重新连接。');
    updateMicStatus();
   },{once:true});
  }
  return stream;
 }).finally(()=>{if(S.micPending===pending)S.micPending=null;updateMicStatus();});
 S.micPending=pending;updateMicStatus();return pending;
}
function silenceSessionMic(){if(S.sharedMic)S.sharedMic.getAudioTracks().forEach(t=>{t.enabled=false;});updateMicStatus();}
function releaseSessionMic(silent=false){
 // Explicit release cancels a pending take (keeping old audio) before stopping tracks.
 if(S.mic){stopRecording(true);}
 S.micEpoch++;S.micSetup=false;
 const stream=S.sharedMic;S.sharedMic=null;
 if(stream)stream.getTracks().forEach(t=>t.stop());
 updateMicStatus();
 if(!silent)notice('麦克风已释放。已保存录音不受影响；下次启用时浏览器可能再次请求权限。');
}
async function enableMicrophone(){
 if(locked())return;S.micSetup=true;sync();
 try{await acquireSessionMic();silenceSessionMic();notice('麦克风已就绪。本页切换片段或重录会复用连接；未录音时静音，练习结束可点击「释放」。','success');}
 catch(e){if(e.name!=='AbortError')throw micError(e);}
 finally{S.micSetup=false;sync();}
}
function releaseMic(m){
 // Dispose this take's graph and timers, not the shared device track.
 if(!m||m.cleaned)return;m.cleaned=true;
 clearTimeout(m.timeout);clearInterval(m.interval);cancelAnimationFrame(m.raf);
 if(m.input)try{m.input.disconnect();}catch(_){}
 if(m.analyser)try{m.analyser.disconnect();}catch(_){}
 if(!S.mic||S.mic===m)silenceSessionMic();
}
function micError(e){const names={NotAllowedError:'未获得麦克风权限。请在浏览器地址栏及系统隐私设置中允许麦克风；也可导入音频。',NotFoundError:'没有找到可用麦克风，请连接设备或导入音频。',NotReadableError:'麦克风不可读，可能被其他应用独占或系统禁止访问。请关闭占用程序后重试。',SecurityError:'当前页面不允许录音，请本地打开 HTML 或使用 localhost / HTTPS。',AbortError:'麦克风请求已取消。'};return new Error(names[e.name]||('录音失败：'+(e.message||e.name)));}
async function startRecording(target){
 if(locked())return;if(target==='source'&&!confirmSourceReplacement())return;if(target.startsWith('segment:')&&!segmentById(target.slice(8)))return;
 if(!window.MediaRecorder)throw new Error('浏览器不支持 MediaRecorder，请更换浏览器或导入录音。');
 stopPlayback();
 const token=++S.micTicket,m={target,token,state:'requesting',stream:null,recorder:null,chunks:[],cancelled:false,started:0,cleaned:false};S.mic=m;
 if($('segmentDialog').open)$('dialogRecordDock').append($('recordBar'));else document.body.append($('recordBar'));
 $('recordBar').hidden=false;$('recordLabel').textContent=liveSessionMic()?'正在复用麦克风…':'正在请求麦克风…';$('recordClock').textContent='--:--';$('stopRecording').textContent='取消';$('micLevel').style.width='0%';sync();
 try{
  const ctx=audioContext();await ctx.resume();if(S.mic!==m)return;
  const stream=await acquireSessionMic();
  if(S.mic!==m||m.cancelled)return;
  m.stream=stream;
  const preferred=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  m.recorder=preferred?new MediaRecorder(stream,{mimeType:preferred}):new MediaRecorder(stream);
  m.input=ctx.createMediaStreamSource(stream);m.analyser=ctx.createAnalyser();m.analyser.fftSize=1024;m.input.connect(m.analyser);
  const frame=new Float32Array(m.analyser.fftSize);
  function meter(){if(S.mic!==m||m.cleaned)return;m.analyser.getFloatTimeDomainData(frame);let sum=0;for(const v of frame)sum+=v*v;$('micLevel').style.width=clamp(Math.sqrt(sum/frame.length)*500,0,100)+'%';m.raf=requestAnimationFrame(meter);}
  m.recorder.ondataavailable=e=>{if(e.data.size>0)m.chunks.push(e.data);};
  m.recorder.onerror=e=>{
   m.cancelled=true;releaseMic(m);
   if(S.mic===m){S.mic=null;$('recordBar').hidden=true;sync();report(micError(e.error||e));}
  };
  m.recorder.onstop=async()=>{
   releaseMic(m);const current=S.mic===m;
   if(current){S.mic=null;$('recordBar').hidden=true;}
   if(m.cancelled){if(current)sync();return;}
   if(!current)return;
   S.loading=true;sync();
   try{
    const blob=new Blob(m.chunks,{type:m.recorder.mimeType||preferred||'audio/webm'});
    if(!blob.size)throw new Error('没有录到有效音频。请录制至少一秒再停止。');
    const b=await decodeBytes(await blob.arrayBuffer());
    // The target ID belongs to this recorder, never to whichever segment is selected later.
    acceptRecordedBuffer(target,b,'麦克风 · '+recordTargetLabel(target));
    notice(target==='source'?'正常台词已录好。拖选波形建立分段，再点击片段练习。':'本段已保存。可以听还原、重录，或切换下一段。','success');checkLevel(b);
   }catch(e){report(e);}finally{S.loading=false;sync();}
  };
  const begin=()=>{
   if(S.mic!==m||m.cancelled)return;
   try{
    if(!liveSessionMic())throw new Error('麦克风已断开，请重新连接。');
    // Enable only as actual recording starts. Countdown / standby stays silent.
    stream.getAudioTracks().forEach(t=>{t.enabled=true;});
    m.recorder.start(250);m.state='recording';m.started=performance.now();
    $('recordClock').textContent='00:00';$('recordLabel').textContent='正在录 '+recordTargetLabel(target);$('stopRecording').textContent='停止并保存';
    meter();updateMicStatus();syncCueRecordButton();
    m.interval=setInterval(()=>{$('recordClock').textContent=fmt((performance.now()-m.started)/1000).slice(0,5);},150);
    m.timeout=setTimeout(()=>stopRecording(false),MAX_SECONDS*1000);
   }catch(e){releaseMic(m);S.mic=null;$('recordBar').hidden=true;sync();report(micError(e));}
  };
  let count=Number($('countdownSeconds').value);
  if(![0,1,3].includes(count))count=1;
  if(count===0){begin();return;}
  m.state='countdown';$('recordLabel').textContent='准备录 '+recordTargetLabel(target);$('recordClock').textContent=String(count);$('stopRecording').textContent='取消';updateMicStatus();
  m.interval=setInterval(()=>{if(S.mic!==m){clearInterval(m.interval);return;}count--;if(count>0){$('recordClock').textContent=String(count);return;}clearInterval(m.interval);m.interval=null;begin();},1000);
 }catch(e){
  releaseMic(m);if(S.mic===m){S.mic=null;$('recordBar').hidden=true;sync();if(e.name!=='AbortError')throw micError(e);}
 }
}
function stopRecording(discard=false){
 const m=S.mic;if(!m||m.state==='stopping')return;
 m.cancelled=discard||m.state!=='recording';clearInterval(m.interval);clearTimeout(m.timeout);
 if(m.recorder?.state==='recording'){
  m.state='stopping';$('recordLabel').textContent=m.cancelled?'正在取消…':'正在保存录音…';
  // Stop the recorder first; disabling its input is not the same as ending the device track.
  m.recorder.stop();releaseMic(m);$('stopRecording').disabled=true;
  // re-enable on the next microtask so the next take's controls are never stranded
  queueMicrotask(()=>{$('stopRecording').disabled=false;});
 }else{
  if(m.state==='requesting'&&!liveSessionMic())S.micEpoch++; // stop late-granted tracks
  releaseMic(m);S.mic=null;S.micTicket++;$('recordBar').hidden=true;sync();
 }
}

// 16-bit mono PCM WAV. Export always uses the already-rendered buffer.
function wavBytes(buf){const x=buf.getChannelData(0),bytes=new ArrayBuffer(44+x.length*2),v=new DataView(bytes);function text(o,s){for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}text(0,'RIFF');v.setUint32(4,36+x.length*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,buf.sampleRate,true);v.setUint32(28,buf.sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,x.length*2,true);for(let i=0;i<x.length;i++){const s=clamp(x[i],-1,1);v.setInt16(44+i*2,Math.round(s<0?s*32768:s*32767),true);}return new Uint8Array(bytes);}
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function exportWav(buf,name){if(!buf||locked())return;saveBlob(new Blob([wavBytes(buf)],{type:'audio/wav'}),name);}
function bytesBase64(bytes){let s='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)s+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(s);}
