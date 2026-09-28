'use strict';
// V4 EVENTS: only one recording workflow.
wire('addSourceSegment','click',()=>{if(S.source)addSegment(...S.sourceRange);});wire('wholeAsSegment','click',wholeAsSegment);
wire('autoSplit','click',autoSplit);wire('clearSegments','click',clearSegments);wire('nextUnrecorded','click',selectNextUnrecorded);
wire('segmentName','input',()=>{const seg=activeSegment();if(!seg||locked())return;seg.name=$('segmentName').value.slice(0,80);S.sessionDirty=true;syncSegments();});
wire('recordSegment','click',()=>recordSegmentById(S.activeSegmentId));
wire('playSegmentModel','click',()=>playSegment(S.activeSegmentId,'model'));wire('playSegmentOriginal','click',()=>playSegment(S.activeSegmentId,'original'));wire('playSegmentTake','click',()=>playSegment(S.activeSegmentId,'take'));wire('playSegmentRestored','click',()=>playSegment(S.activeSegmentId,'restored'));
wire('importSegment','click',()=>{segmentImportTarget=S.activeSegmentId;$('segmentFile').value='';$('segmentFile').click();});wire('segmentFile','change',e=>importSegmentAudio(e.target.files[0]));
wire('undoSegment','click',undoSegment);wire('resetSegmentTrim','click',()=>{const seg=activeSegment();if(seg?.take)changeSegmentTakeRange([0,seg.take.duration]);});
for(const id of ['segmentTakeStart','segmentTakeEnd'])wire(id,'change',()=>changeSegmentTakeRange([Number($('segmentTakeStart').value),Number($('segmentTakeEnd').value)]));
wire('exportSegment','click',()=>{const seg=activeSegment();if(seg?.take)exportWav(reverseBuffer(segmentTakeSlice(seg)),`redroom-segment-${sortedSegments().indexOf(seg)+1}-restored.wav`);});
wire('exportLegacyTake','click',()=>{if(S.legacyTake)exportWav(S.legacyTake.buffer,'redroom-legacy-recording.wav');});
for(const id of ['segmentGap','segmentFade'])wire(id,'input',()=>{if(!locked())invalidate();});
wire('previewSegments','click',()=>previewSegmentTakes(false));wire('playAllTakes','click',()=>previewSegmentTakes(true));
wire('segmentList','click',e=>{const b=e.target.closest('button[data-id]');if(b&&!locked())selectSegment(b.dataset.id);});
wire('dismissStatus','click',()=>{$('statusBox').hidden=true;});
wire('importSource','click',()=>{$('sourceFile').value='';$('sourceFile').click();});wire('sourceFile','change',e=>importAudio(e.target.files[0]));wire('loadDemo','click',demo);
wire('recordSource','click',()=>startRecording('source'));wire('stopRecording','click',()=>stopRecording(false));wire('discardRecording','click',()=>stopRecording(true));
for(const k of Object.keys(playIds))wire(playIds[k],'click',()=>playKey(k));
for(const id of ['dialogLessonRate','dialogLessonLoop'])wire(id,'change',()=>{S.sessionDirty=true;if(S.play?.key.startsWith('seg:model:')){const id=S.play.key.slice(10);stopPlayback();return playSegment(id,'model');}});
for(const id of ['sourceStart','sourceEnd'])wire(id,'change',()=>{if(!S.source||locked())return;stopPlayback();S.sourceRange=validRange(Number($('sourceStart').value),Number($('sourceEnd').value),S.source.duration);S.sessionDirty=true;sync();});
wire('sourceTrim','click',()=>{if(S.source&&!locked()){stopPlayback();S.sourceRange=silenceBounds(S.source);S.sessionDirty=true;sync();}});wire('sourceReset','click',()=>{if(S.source&&!locked()){stopPlayback();S.sourceRange=[0,S.source.duration];S.sessionDirty=true;sync();}});
for(const id of ['outputRate','reverb','normalize','trimTake'])wire(id,'input',()=>{if(locked())return;S.lastPreset='';invalidate();});
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>preset(b.dataset.preset)));
wire('volume','input',()=>{$('volumeValue').textContent=$('volume').value+'%';if(S.gain)S.gain.gain.setTargetAtTime(Number($('volume').value)/100,S.ctx.currentTime,.015);});
wire('generate','click',()=>generate(true));wire('exportSource','click',()=>exportWav(copySlice(S.source,...S.sourceRange),'redroom-normal.wav'));wire('exportResult','click',()=>exportWav(S.result,'redroom-performance.wav'));
wire('saveSession','click',saveSession);wire('loadSession','click',()=>{$('sessionFile').value='';$('sessionFile').click();});wire('sessionFile','change',e=>loadSession(e.target.files[0]));wire('clearAll','click',clearAll);
const drop=$('sourceDrop');drop.addEventListener('dragover',e=>{e.preventDefault();if(!locked())drop.classList.add('dragover');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');const f=e.dataTransfer?.files[0];if(f)importAudio(f).catch(report);});
wire('enableMic','click',enableMicrophone);wire('releaseMicButton','click',()=>releaseSessionMic(false));
wire('closeSegmentDialog','click',()=>closeSegmentDialog());wire('finishSegment','click',()=>closeSegmentDialog());
wire('prevSegment','click',()=>adjacentSegment(-1));wire('nextSegment','click',()=>adjacentSegment(1));wire('deleteActiveSegment','click',()=>removeSegment(S.activeSegmentId));
wire('countdownSeconds','change',()=>{S.sessionDirty=true;});
$('segmentDialog').addEventListener('keydown',e=>{
 if(e.key!=='Tab')return;
 const d=$('segmentDialog'),els=[...d.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
 if(!els.length){e.preventDefault();return;}const first=els[0],last=els[els.length-1];
 if(e.shiftKey&&(document.activeElement===first||!d.contains(document.activeElement))){e.preventDefault();last.focus();}
 else if(!e.shiftKey&&(document.activeElement===last||!d.contains(document.activeElement))){e.preventDefault();first.focus();}
});
let lastTimelineWidth=0;new ResizeObserver(()=>{const width=$('segmentList').clientWidth;if(width&&Math.abs(width-lastTimelineWidth)>1){lastTimelineWidth=width;syncSegments();}}).observe($('segmentList'));
$('segmentDialog').addEventListener('cancel',e=>{e.preventDefault();if(S.mic){stopRecording(true);notice('已取消本次录音，上一版没有改动。');}else closeSegmentDialog();});
$('segmentDialog').addEventListener('click',e=>{if(e.target!==$('segmentDialog'))return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeSegmentDialog();});
$('segmentDialog').addEventListener('close',()=>{document.body.classList.remove('dialog-open');if(!S.mic)document.body.append($('recordBar'));views.source.draw();});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!$('segmentDialog').open){if(!$('cueBoard').hidden){closeCueBoard();return;}stopPlayback();if(S.mic)stopRecording(true);}
 if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA','BUTTON','SUMMARY','A'].includes(e.target.tagName)&&!e.target.isContentEditable){e.preventDefault();if(S.play)stopPlayback();else if(!locked()){if($('segmentDialog').open)playSegment(S.activeSegmentId,'model').catch(report);else playKey(S.result?'result':'source').catch(report);}}
});
window.addEventListener('beforeunload',e=>{if(S.mic||(S.sessionDirty&&(S.source||S.legacyTake||S.segments.length||cueTextDraft))){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{if(S.mic){S.mic.cancelled=true;stopRecording(true);}releaseSessionMic(true);stopPlayback();});
// Local diagnostics, never transmitted; keeps browser regression testing deterministic.
window.RedRoomLab={reverseBuffer,renderEffect,wavBytes,silenceBounds,copySlice,makeBuffer,peakOf,generate,joinSegmentTakes,addSegment,setSegmentTake,selectSegment,sortedSegments,segmentTakeSlice,getSegmentModel,undoSegment,changeSegmentTakeRange,getState:()=>S,closeSegmentDialog,startRecording,stopRecording,enableMicrophone,releaseSessionMic,wholeAsSegment,loadSession,saveSession,setSource,getCueSettings};
sync();
if(!window.isSecureContext)notice('当前页面麦克风可能不可用。导入音频仍可使用；录音请使用本地文件、localhost 或 HTTPS。');
