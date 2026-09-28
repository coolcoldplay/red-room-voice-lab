
'use strict';
// Audio is processed locally. All static assets are served by this site; no audio uploads or analytics.

const $ = id => document.getElementById(id);
const MAX_SECONDS = 90, MAX_BYTES = 30 * 1024 * 1024;
const S = {
 segments:[], activeSegmentId:null, previewTimeline:null, sessionDirty:false, source:null, sourceName:'', sourceRange:[0,0], 
 legacyTake:null, result:null, resultInfo:null, revision:0, loading:false, rendering:false,
 mic:null, micTicket:0, sharedMic:null, micPending:null, micEpoch:0, micSetup:false, play:null, playTicket:0, ctx:null, gain:null, lastPreset:'clean'
};
const playLabels = {source:'听原声',result:'播放成品'};
const playIds = {source:'playSource',result:'playResult'};
const fmt = sec => { const cs=Math.max(0,Math.floor((Number(sec)||0)*100));return String(Math.floor(cs/6000)).padStart(2,'0')+':'+String(Math.floor(cs/100)%60).padStart(2,'0')+'.'+String(cs%100).padStart(2,'0'); };
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
const nextFrame = () => new Promise(resolve=>setTimeout(resolve,0));
const locked = () => !!(S.loading || S.rendering || S.mic || S.micSetup);
function notice(msg,type='info') { $('statusBox').hidden=false;$('statusBox').className='statusbox '+type;$('statusText').textContent=msg; if($('segmentDialog').open){$('modalNotice').hidden=false;$('modalNotice').className='modal-notice '+type;$('modalNotice').textContent=msg;} }
function report(err) { console.error(err);notice(err && err.message ? err.message : String(err),'error'); }
function wire(id,event,fn){$(id).addEventListener(event,e=>Promise.resolve().then(()=>fn(e)).catch(report));}
// Independent segments are anchored to the ORIGINAL source timeline, never to
// the current reversed view. Final output = R(take_1) + R(take_2) + ... in
// original-script order. Reversing the concatenation would invert sentence order.
const MAX_SEGMENTS=60, MAX_JOIN_SECONDS=300, MAX_STORED_TAKE_SECONDS=600;
let segmentSerial=0, segmentModelCache=null, segmentImportTarget=null, lastPlayingSegment=null;
function sortedSegments(){return [...S.segments].sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id));}
function activeSegment(){return S.segments.find(s=>s.id===S.activeSegmentId)||null;}
function segmentById(id){return S.segments.find(s=>s.id===id)||null;}
function segmentLabel(seg){const i=sortedSegments().findIndex(x=>x.id===seg?.id);return i<0?'片段':`第 ${i+1} 段`;}

function segmentReady(){return S.segments.length>0&&S.segments.every(s=>!!s.take);}
function recordedSegments(){return sortedSegments().filter(s=>s.take);}

function clearSegmentState(){closeSegmentDialog(true);S.segments=[];S.activeSegmentId=null;segmentModelCache=null;segmentImportTarget=null;lastPlayingSegment=null;}
function confirmSourceReplacement(){return !S.segments.length||confirm('更换正常台词将清空与旧台词绑定的分段和分段录音。未保存的内容会丢失。请先保存工程；现在继续更换吗？');}

function newSegment(a,b){const r=validRange(a,b,S.source.duration);return{id:'seg-'+(++segmentSerial),start:r[0],end:r[1],name:'',take:null,takeName:'',takeRange:[0,0],previous:null,takeCount:0};}
function addSegment(a,b){
 if(locked()||!S.source)return;
 const r=validRange(a,b,S.source.duration),duplicate=S.segments.find(s=>Math.abs(s.start-r[0])<.005&&Math.abs(s.end-r[1])<.005);
 if(duplicate){selectSegment(duplicate.id);notice('这个选区已经存在，已打开对应片段。现有录音没有改动。');return;}
 if(S.segments.length>=MAX_SEGMENTS)throw new Error(`最多保存 ${MAX_SEGMENTS} 个片段。请删除不用的片段，或另存工程分批制作。`);
 stopPlayback();const seg=newSegment(...r);S.segments.push(seg);S.activeSegmentId=seg.id;invalidate();
 notice(`已添加${segmentLabel(seg)}，时长 ${(seg.end-seg.start).toFixed(2)} 秒。点击时间轴上的片段即可练习；也可继续划分下一段。`,'success');
}

let dialogReturnFocus=null;
function selectSegment(id){
 if(locked()||!segmentById(id))return;stopPlayback();S.activeSegmentId=id;sync();
 const dialog=$('segmentDialog');if(!dialog.open){dialogReturnFocus=document.activeElement;dialog.showModal();document.body.classList.add('dialog-open');}
 $('modalNotice').hidden=true;$('dialogRecordDock').append($('recordBar'));
 requestAnimationFrame(()=>{segmentViews.model.resize();segmentViews.take.resize();$('playSegmentModel').focus({preventScroll:true});});
}
function closeSegmentDialog(force=false){
 const d=$('segmentDialog');if(!d||!d.open)return;
 if(!force&&locked()){notice('请先停止或取消当前录音，处理完成后再关闭练习窗口。');return;}
 stopPlayback();d.close();document.body.classList.remove('dialog-open');document.body.append($('recordBar'));
 const target=$('segmentList').querySelector(`[data-id="${S.activeSegmentId}"]`)||dialogReturnFocus;
 if(target?.isConnected)target.focus({preventScroll:true});
}
function adjacentSegment(delta){if(locked())return;const segs=sortedSegments(),i=segs.findIndex(s=>s.id===S.activeSegmentId),s=segs[i+delta];if(s)selectSegment(s.id);}

function selectNextUnrecorded(){
 if(locked())return;const segs=sortedSegments(),i=segs.findIndex(s=>s.id===S.activeSegmentId);const next=[...segs.slice(i+1),...segs.slice(0,i+1)].find(s=>!s.take);
 if(next)selectSegment(next.id);else notice('所有片段都已录好，点击完成返回主界面合成。','success');
}
function removeSegment(id){if(locked())return;const seg=segmentById(id);if(!seg)return;if(seg.take&&!confirm(`删除${segmentLabel(seg)}及其录音？其他片段不受影响。`))return;stopPlayback();closeSegmentDialog();S.segments=S.segments.filter(s=>s.id!==id);if(S.activeSegmentId===id)S.activeSegmentId=sortedSegments()[0]?.id||null;invalidate();}
function clearSegments(){if(locked()||!S.segments.length)return;if(!confirm('清空所有分段和分段录音？正常台词仍保留。'))return;stopPlayback();clearSegmentState();invalidate();}
function autoSplit(){
 if(locked()||!S.source)return;const sec=Number($('splitSeconds').value),[a,b]=S.sourceRange,n=Math.ceil((b-a)/sec);
 if(n>MAX_SEGMENTS)throw new Error(`会生成 ${n} 段，超过 ${MAX_SEGMENTS} 段上限。请选择更长的分段时长。`);
 if(S.segments.length&&!confirm('自动拆分将替换现有分段并清除分段录音。请先保存工程。继续吗？'))return;
 stopPlayback();clearSegmentState();for(let start=a;start<b-.001;start+=sec){let end=Math.min(b,start+sec);if(b-end<.08)end=b;S.segments.push(newSegment(start,end));if(end===b)break;}
 S.activeSegmentId=S.segments[0]?.id||null;invalidate();notice(`已按约 ${sec} 秒拆为 ${S.segments.length} 段。固定时长可能切在字音中间；可删除不合适的段，再手动框选添加。`,'success');
}
function getSegmentModel(seg){
 if(!seg||!S.source)return null;
 if(segmentModelCache?.source===S.source&&segmentModelCache.id===seg.id&&segmentModelCache.start===seg.start&&segmentModelCache.end===seg.end)return segmentModelCache.buffer;
 const buffer=reverseBuffer(copySlice(S.source,seg.start,seg.end));segmentModelCache={source:S.source,id:seg.id,start:seg.start,end:seg.end,buffer};return buffer;
}
function segmentTakeSlice(seg,trim=$('trimTake').checked){if(!seg?.take)return null;const b=copySlice(seg.take,...seg.takeRange);return trim?trimSilence(b):b;}
function storedTakeDuration(segments=S.segments){return segments.reduce((n,s)=>n+(s.take?.duration||0)+(s.previous?.take?.duration||0),0);}
function setSegmentTake(id,buf,name){
 const seg=segmentById(id);if(!seg)throw new Error('录音所属片段已不存在，未覆盖其他片段。');
 const prospective=storedTakeDuration()- (seg.previous?.take?.duration||0)+buf.duration;
 if(prospective>MAX_STORED_TAKE_SECONDS)throw new Error('分段及上一版录音总时长超过 10 分钟。请先保存工程、删除不用的片段，或使用更短的录音。旧录音未被替换。');
 stopPlayback();if(seg.take)seg.previous={take:seg.take,takeName:seg.takeName,takeRange:[...seg.takeRange]};
 seg.take=buf;seg.takeName=String(name||'分段模仿录音');seg.takeRange=[0,buf.duration];seg.takeCount++;S.activeSegmentId=id;invalidate();checkLevel(buf);
}
function undoSegment(){const seg=activeSegment();if(locked()||!seg?.previous)return;stopPlayback();const prev=seg.previous;seg.previous={take:seg.take,takeName:seg.takeName,takeRange:[...seg.takeRange]};seg.take=prev.take;seg.takeName=prev.takeName;seg.takeRange=[...prev.takeRange];invalidate();notice('已换回上一版录音。再次点击可在这两个版本间切换。','success');}
function changeSegmentTakeRange(range){const seg=activeSegment();if(locked()||!seg?.take)return;stopPlayback();seg.takeRange=validRange(...range,seg.take.duration);invalidate();}
function recordTargetLabel(target){return target==='source'?'正常台词':segmentLabel(segmentById(target.slice(8)))+' · 模仿反话';}
function acceptRecordedBuffer(target,buf,name){if(target==='source')setSource(buf,name);else if(target.startsWith('segment:'))setSegmentTake(target.slice(8),buf,name);else throw new Error('未知录音目标。');}
async function recordSegmentById(id){if(locked()||!segmentById(id))return;S.activeSegmentId=id;sync();await startRecording('segment:'+id);}
async function importSegmentAudio(file){
 const id=segmentImportTarget;segmentImportTarget=null;if(!file||locked()||!segmentById(id))return;
 if(file.size>MAX_BYTES)throw new Error('文件超过 30 MB。请先裁成更短的分段模仿。');if(!file.size)throw new Error('这是一个空文件。');
 S.loading=true;stopPlayback();sync();try{const b=await decodeBytes(await file.arrayBuffer());setSegmentTake(id,b,file.name);notice(`${segmentLabel(segmentById(id))}的反话录音已导入。其他片段不受影响。`,'success');checkLevel(b);}finally{S.loading=false;sync();}
}
async function playSegment(id,kind){
 if(locked())return;const seg=segmentById(id);if(!seg)return;const key=`seg:${kind}:${id}`;
 if(S.play?.key===key){stopPlayback();return;}S.activeSegmentId=id;sync();let buf,rate=1,loop=false;
 if(kind==='original'){buf=copySlice(S.source,seg.start,seg.end);}else if(kind==='model'){buf=getSegmentModel(seg);rate=Number($('dialogLessonRate').value);loop=$('dialogLessonLoop').checked;}
 else{buf=segmentTakeSlice(seg);if(!buf)return;if(kind==='restored')buf=reverseBuffer(buf);}
 await playBuffer(key,buf,[0,buf.duration],rate,loop);
}

function markSegmentPlaying(id){
 if(lastPlayingSegment===id)return;lastPlayingSegment=id;
 for(const el of $('segmentList').children)el.classList.toggle('is-playing',el.dataset.id===id);
 $('segmentPlaying').hidden=!id;if(id)$('segmentPlaying').textContent=`正在播放${segmentLabel(segmentById(id))}`;
 views.source.draw();
}
function playingView(key){if(key?.startsWith('seg:model:'))return S.activeSegmentId===key.slice(10)?segmentViews.model:null;if(key?.startsWith('seg:take:'))return S.activeSegmentId===key.slice(9)?segmentViews.take:null;return views[key]||null;}
function updateSegmentPlaybackButtons(){
 const id=S.activeSegmentId;
 for(const [btn,kind,label] of [['playSegmentModel','model','听本段倒放'],['playSegmentOriginal','original','听本段原声'],['playSegmentTake','take','听模仿原声'],['playSegmentRestored','restored','听本段还原']])$(btn).textContent=S.play?.key===`seg:${kind}:${id}`?'■ 停止':label;
 $('previewSegments').textContent=S.play?.key==='segmentPreview'?'■ 停止试听':'试听已录部分';$('playAllTakes').textContent=S.play?.key==='allTakes'?'■ 停止连听':'连听模仿原声';
 if(!S.play)markSegmentPlaying(null);else if(S.play.key.startsWith('seg:'))markSegmentPlaying(S.play.key.split(':')[2]);
}
function drawSegmentMarkers(view,c,w,h){
 if(!S.segments.length||!view.buffer||view.key!=='source')return;
 sortedSegments().forEach((seg,i)=>{
  const left=clamp(seg.start/view.buffer.duration,0,1)*w,right=clamp(seg.end/view.buffer.duration,0,1)*w;
  const active=$('segmentDialog').open&&seg.id===S.activeSegmentId,playing=seg.id===lastPlayingSegment;
  c.fillStyle=playing?'#dfb97224':active?'#e1b28520':seg.take?'#71a48719':'#b35f8415';c.fillRect(left,0,right-left,h);
  c.fillStyle=playing?'#dfc391':seg.take?'#8aaa97':'#b7697e';c.fillRect(left,0,Math.max(1,right-left-1),3);
  c.fillStyle=seg.take?'#bbdac8':'#e6abb7';c.font='10px ui-monospace,Consolas,monospace';
  if(right-left>16)c.fillText(String(i+1).padStart(2,'0')+(seg.take&&right-left>40?' ✓':''),left+5,18);
  c.fillStyle='#b87b8d44';c.fillRect(left,3,1,h-3);
 });
}
function hitSegment(time){return sortedSegments().filter(s=>time>=s.start&&time<=s.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]||null;}
function syncSegments(){
 const busy=locked(),segs=sortedSegments(),done=segs.filter(s=>s.take).length,active=activeSegment();
 $('autoSplit').disabled=busy||!S.source;$('splitSeconds').disabled=busy||!S.source;$('clearSegments').disabled=busy||!segs.length;
 $('timelineInstruction').textContent='拖选建立分段；点击片段打开练习。';
 $('fullDuration').textContent=fmt(S.source?.duration||0);
 $('segmentCount').textContent=`${done} / ${segs.length} 段已录`;$('segmentCount').className='chip'+(done&&done===segs.length?' ready':'');$('segmentEmpty').hidden=!!segs.length;
 $('outputProgress').textContent=`${done} / ${segs.length} 段已录`;
 const list=$('segmentList');for(const row of [...list.children])if(!segmentById(row.dataset.id))row.remove();
 // Compact time-aligned buttons. Overlapping ranges occupy separate lanes;
 // no per-segment record/play/delete controls exist on the main page.
 const laneEnds=[];
 segs.forEach((seg,i)=>{
  let row=[...list.children].find(el=>el.dataset.id===seg.id);
  if(!row){row=document.createElement('button');row.type='button';row.dataset.id=seg.id;row.dataset.action='select';row.innerHTML='<span class="pill-number"></span><span class="pill-name"></span><span class="pill-state"></span>';}
  if(list.children[i]!==row)list.insertBefore(row,list.children[i]||null);
  const total=S.source?.duration||1,minWidth=26/Math.max(160,list.clientWidth||800);
  const visualStart=Math.min(seg.start/total,1-minWidth),visualEnd=Math.min(1,Math.max(seg.end/total,visualStart+minWidth));
  let lane=laneEnds.findIndex(end=>end<=visualStart+.00001);if(lane<0)lane=laneEnds.length;laneEnds[lane]=visualEnd;
  row.style.left=`${visualStart*100}%`;row.style.width=`calc(${(visualEnd-visualStart)*100}% - 2px)`;row.style.top=`${lane*39}px`;
  row.className='segment-pill'+(seg.take?' done':'')+(seg.id===lastPlayingSegment?' is-playing':'');
  row.querySelector('.pill-number').textContent=String(i+1).padStart(2,'0');
  row.querySelector('.pill-name').textContent=(seg.end-seg.start)/total>.13?(seg.name||'片段 '+(i+1)):'';
  row.querySelector('.pill-state').textContent=seg.take?'✓':'';
  row.disabled=busy;row.title=`第 ${i+1} 段 · ${fmt(seg.start)}–${fmt(seg.end)} · ${seg.take?'已录音':'待录音'}${seg.name?' · '+seg.name:''} · 点击练习`;
  row.setAttribute('aria-label',row.title);row.setAttribute('aria-haspopup','dialog');
 });
 list.style.height=segs.length?`${laneEnds.length*39-7}px`:'0px';
 const coverage=$('segmentCoverage');let overlap=0,gap=0,end=0;
 for(const s of segs){if(s.start<end-.01)overlap++;else if(s.start>end+.01)gap+=s.start-end;end=Math.max(end,s.end);}if(S.source)gap+=Math.max(0,S.source.duration-end);
 coverage.hidden=!segs.length||(!overlap&&gap<.03);coverage.classList.toggle('warning',!!overlap);
 coverage.textContent=(overlap?`${overlap} 处重叠将各播放一次，可能重复台词。 `:'')+(gap>.02?`未选入约 ${gap.toFixed(2)} 秒（可能包含静音），合成时不自动补入。`:'');
 $('segmentEditor').hidden=!active;$('segmentTakeEditor').hidden=!active?.take;$('segmentTakeEmpty').hidden=!!active?.take;
 for(const id of ['segmentName','recordSegment','playSegmentModel','playSegmentOriginal','importSegment','deleteActiveSegment'])$(id).disabled=busy||!active;
 for(const id of ['segmentTakeStart','segmentTakeEnd','resetSegmentTrim','playSegmentTake','playSegmentRestored','exportSegment'])$(id).disabled=busy||!active?.take;
 $('undoSegment').disabled=busy||!active?.previous;$('nextUnrecorded').disabled=busy||done===segs.length;
 const index=segs.findIndex(s=>s.id===active?.id);$('prevSegment').disabled=busy||index<=0;$('nextSegment').disabled=busy||index<0||index===segs.length-1;
 for(const id of ['closeSegmentDialog','finishSegment','countdownSeconds','dialogLessonLoop','dialogLessonRate'])$(id).disabled=busy;
 if(active){
  $('activeSegmentHeading').textContent=`第 ${index+1} 段 / 共 ${segs.length} 段`;
  $('dialogSubtitle').textContent=`原台词 ${fmt(active.start)}–${fmt(active.end)} · ${(active.end-active.start).toFixed(2)} 秒${active.take?' · 已有录音，可随时重录':''}`;
  if(document.activeElement!==$('segmentName'))$('segmentName').value=active.name;
  const model=getSegmentModel(active);if(segmentViews.model.buffer!==model)segmentViews.model.setBuffer(model);
  $('segmentModelMeta').textContent='倒放范本 · 模仿声音，不是倒着念文字';$('segmentModelDuration').textContent=fmt(model.duration);
  $('recordSegment').querySelector('span:last-child').textContent=active.take?'重新录本段':'录下本段模仿';
  if(segmentViews.take.buffer!==active.take)segmentViews.take.setBuffer(active.take);
  if(active.take){segmentViews.take.setSelection(active.takeRange);$('segmentTakeStart').value=active.takeRange[0].toFixed(2);$('segmentTakeEnd').value=active.takeRange[1].toFixed(2);$('segmentTakeStart').max=active.take.duration;$('segmentTakeEnd').max=active.take.duration;$('segmentTakeDuration').textContent=fmt(active.takeRange[1]-active.takeRange[0]);$('segmentTakeStatus').textContent=`已保存 ${active.takeCount} 次${active.previous?' · 可换回上一版':' · 此段可随时重录'}`;}
 }
 $('previewSegments').disabled=busy||!done;$('playAllTakes').disabled=busy||!done;
 $('segmentGap').disabled=busy;$('segmentFade').disabled=busy;$('segmentGapValue').textContent=$('segmentGap').value+' ms';
 views.source.draw();updateSegmentPlaybackButtons();updateMicStatus();
}

function resampleForJoin(buf,sr){
 if(buf.sampleRate===sr)return buf;const n=Math.max(1,Math.round(buf.duration*sr)),out=makeBuffer(n,sr),x=buf.getChannelData(0),y=out.getChannelData(0);for(let i=0;i<n;i++){const t=i*buf.sampleRate/sr,a=Math.min(x.length-1,Math.floor(t)),b=Math.min(x.length-1,a+1),f=t-a;y[i]=x[a]*(1-f)+x[b]*f;}return out;
}
function joinSegmentTakes(segs,{reverse=true,trim=true,gapMs=0,fade=true}={}){
 if(!segs.length)throw new Error('尚无可合成的分段录音。');
 const ordered=[...segs].sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id)),sr=audioContext().sampleRate,parts=[];
 for(const seg of ordered){if(!seg.take)throw new Error(`${segmentLabel(seg)}尚未录音。`);let b=segmentTakeSlice(seg,trim);if(reverse)b=reverseBuffer(b);parts.push({seg,buffer:resampleForJoin(b,sr)});}
 const gap=Math.round(clamp(Number(gapMs)||0,0,800)*sr/1000),length=parts.reduce((n,p)=>n+p.buffer.length,0)+gap*(parts.length-1);
 if(length/sr>MAX_JOIN_SECONDS)throw new Error('合成后超过 5 分钟，请缩短录音或减少片段。');
 const out=makeBuffer(length,sr),y=out.getChannelData(0),timeline=[];let offset=0;
 for(const {seg,buffer} of parts){const x=buffer.getChannelData(0);y.set(x,offset);const edge=fade?Math.min(Math.round(sr*.003),Math.floor(x.length/2)):0;for(let i=0;i<edge;i++){const f=.5-.5*Math.cos(Math.PI*i/edge);y[offset+i]*=f;y[offset+x.length-1-i]*=f;}timeline.push({id:seg.id,start:offset/sr,end:(offset+x.length)/sr});offset+=x.length+gap;}
 return{buffer:out,timeline};
}
async function previewSegmentTakes(raw=false){
 if(locked())return;const key=raw?'allTakes':'segmentPreview';if(S.play?.key===key){stopPlayback();return;}const segs=recordedSegments();if(!segs.length)return;
 stopPlayback();S.rendering=true;sync();let buffer,timeline;try{await audioContext().resume();await nextFrame();const p=params(),joined=joinSegmentTakes(segs,{reverse:!raw,trim:p.trim,gapMs:Number($('segmentGap').value),fade:$('segmentFade').checked});buffer=raw?joined.buffer:await renderEffect(joined.buffer,p);timeline=joined.timeline.map(t=>({...t,start:t.start/(raw?1:p.rate),end:t.end/(raw?1:p.rate)}));}finally{S.rendering=false;sync();}
 S.previewTimeline=timeline;await playBuffer(key,buffer);notice(raw?'正在按原台词的片段顺序连听模仿原声（未反向还原，不是最终成品）。':`正在试听 ${segs.length} 个已录片段${segs.length<S.segments.length?'，未录段已跳过；这不是完整成品':''}。此试听不会覆盖已生成的成品。`);
}

