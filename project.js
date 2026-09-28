'use strict';
async function saveSession(){
 if(locked()||(!S.source&&!S.legacyTake))return;S.loading=true;stopPlayback();sync();try{
  await nextFrame();const pack=(b,name,range)=>b?{name,wav:bytesBase64(wavBytes(b)),...(range?{range:[...range]}:{})}:null;
  const data={app:'redroom-lab',version:4,savedAt:new Date().toISOString(),source:pack(S.source,S.sourceName,S.sourceRange),params:params(),practiceRate:Number($('dialogLessonRate').value),practiceLoop:$('dialogLessonLoop').checked,countdownSeconds:Number($('countdownSeconds').value),
   segments:sortedSegments().map(s=>({id:s.id,start:s.start,end:s.end,name:s.name,take:pack(s.take,s.takeName,s.takeRange),previous:s.previous?pack(s.previous.take,s.previous.takeName,s.previous.takeRange):null,takeCount:s.takeCount})),activeSegmentId:S.activeSegmentId,segmentGap:Number($('segmentGap').value),segmentFade:$('segmentFade').checked,
   legacyTake:S.legacyTake?pack(S.legacyTake.buffer,S.legacyTake.name):null,cue:getCueSettings()};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});if(blob.size>160*1024*1024)throw new Error('工程超过 160 MB。请减少长录音或片段后再保存。当前素材仍保留。');
  saveBlob(blob,'redroom-session-v4.json');S.sessionDirty=false;notice('已导出工程：原声、全部片段、录音及上一版、备注、参数和提词偏好。关闭网页不会自动备份。','success');
 }finally{S.loading=false;sync();}
}
async function loadSession(file){
 if(!file||locked())return;if(file.size>160*1024*1024)throw new Error('工程文件最大 160 MB。');if((S.source||S.segments.length||S.legacyTake)&&!confirm('载入工程会替换当前素材、片段和参数。未保存的内容会丢失，继续吗？'))return;
 S.loading=true;stopPlayback();sync();try{
  let o;try{o=JSON.parse(await file.text());}catch(_){throw new Error('这不是有效的 JSON 工程文件。');}
  if(o?.app!=='redroom-lab'||![1,2,3,4].includes(o.version))throw new Error('请使用本工具导出的 v1–v4 工程。');
  async function unpack(item){if(!item)return null;if(typeof item.wav!=='string'||item.wav.length>MAX_BYTES*1.4)throw new Error('工程音频字段不正确。');return decodeBytes(base64Bytes(item.wav).buffer);}
  const rangeOf=(range,buf)=>buf?validRange(...(Array.isArray(range)&&range.length===2?range:[0,buf.duration]),buf.duration):[0,0];
  const safe=(v,def,min,max)=>Number.isFinite(v)?clamp(v,min,max):def;
  // Transactional restore: all audio and ranges must validate before replacement.
  let src=await unpack(o.source),srcName=String(o.source?.name||'工程正常台词').slice(0,500),sourceRange=rangeOf(o.source?.range,src);
  const oldTake=await unpack(o.take),archive=await unpack(o.legacyTake),p=o.params||{},segments=[];let activeId=null,migrated=false;
  if(o.version>=2&&o.segments!==undefined&&!Array.isArray(o.segments))throw new Error('工程片段列表格式不正确。');
  const rows=o.version>=2?(o.segments||[]):[];if(rows.length>MAX_SEGMENTS)throw new Error(`工程超过 ${MAX_SEGMENTS} 个片段。`);if(rows.length&&!src)throw new Error('分段工程缺少正常台词。');
  for(const row of rows){
   if(!row||!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.start<0||row.end>src.duration+.015||row.end-row.start<.015)throw new Error('工程有无效的片段范围；当前工程未替换。');
   const b=await unpack(row.take),prev=await unpack(row.previous);if(prev&&!b)throw new Error('分段录音历史格式不正确。');
   const r=rangeOf([row.start,row.end],src),seg={id:'seg-'+(++segmentSerial),start:r[0],end:r[1],name:String(row.name||'').slice(0,80),take:b,takeName:String(row.take?.name||'工程片段录音').slice(0,500),takeRange:rangeOf(row.take?.range,b),previous:prev?{take:prev,takeName:String(row.previous?.name||'上一版录音').slice(0,500),takeRange:rangeOf(row.previous?.range,prev)}:null,takeCount:Math.round(safe(row.takeCount,b?1:0,0,1000000))};
   segments.push(seg);if(row.id===o.activeSegmentId)activeId=seg.id;if(storedTakeDuration(segments)>MAX_STORED_TAKE_SECONDS+.1)throw new Error('分段及历史录音超过 10 分钟。');
  }
  let legacy=archive?{buffer:archive,name:String(o.legacyTake?.name||'旧工程附带录音').slice(0,500)}:null;
  if(oldTake&&!segments.length){
   if(!src){src=reverseBuffer(oldTake);srcName='旧录音反向还原参考（非原始台词）';sourceRange=[0,src.duration];}
   const r=sourceRange;segments.push({id:'seg-'+(++segmentSerial),start:r[0],end:r[1],name:'旧工程录音',take:oldTake,takeName:String(o.take?.name||'旧工程录音').slice(0,500),takeRange:[0,oldTake.duration],previous:null,takeCount:1});migrated=true;
  }else if(oldTake){
   if(legacy)throw new Error('工程包含两份旧录音备份，无法无损归并；当前工程未替换。');
   legacy={buffer:oldTake,name:String(o.take?.name||'旧工程附带录音').slice(0,500)};
  }
  clearSegmentState();S.source=src;S.sourceName=srcName;S.sourceRange=sourceRange;S.legacyTake=legacy;S.segments=segments;S.activeSegmentId=activeId||sortedSegments()[0]?.id||null;views.source.setBuffer(src);
  $('outputRate').value=Math.round(safe(p.rate,1,.75,1.25)*100);$('reverb').value=Math.round(safe(p.wet,0,0,.4)*100);$('normalize').checked=p.normalize!==false;$('trimTake').checked=p.trim!==false;
  $('dialogLessonRate').value=[.6,.8,1,1.15].includes(o.practiceRate)?String(o.practiceRate):'1';$('dialogLessonLoop').checked=o.practiceLoop===true;$('segmentGap').value=Math.round(safe(o.segmentGap,0,0,800));$('segmentFade').checked=o.segmentFade!==false;$('countdownSeconds').value=[0,1,3].includes(o.countdownSeconds)?String(o.countdownSeconds):'1';
  applyCueSettings(o.cue);S.lastPreset='';invalidate();S.sessionDirty=false;
  notice(`工程已恢复，共 ${segments.length} 个片段。`+(migrated?'旧整句录音已转为一个普通片段。':'')+(legacy?'另有旧录音备份，可在「音效与拼接设置」中导出。':'')+(o.mode==='quick'?'已保留原声，旧滤镜已移除；请划段录制模仿。':'')+'请重新合成成品。','success');
 }finally{S.loading=false;sync();}
}

function clearAll(){if(locked())return;if((S.source||S.segments.length||S.legacyTake)&&!confirm('清空本次原声、片段及录音？未导出的内容会丢失。'))return;stopPlayback();clearSegmentState();S.source=null;S.sourceName='';S.legacyTake=null;S.sourceRange=[0,0];views.source.setBuffer(null);invalidate();$('statusBox').hidden=true;sync();}

// One phrase or many: always the same segment pipeline.
function wholeAsSegment(){
 if(locked()||!S.source)return;
 const only=S.segments.length===1?S.segments[0]:null;
 if(only&&Math.abs(only.start)<.005&&Math.abs(only.end-S.source.duration)<.005){selectSegment(only.id);return;}
 if(S.segments.length&&!confirm('将全段作为唯一片段会替换现有分段及其录音。请先保存工程，继续吗？'))return;
 stopPlayback();clearSegmentState();const seg=newSegment(0,S.source.duration);S.segments=[seg];S.activeSegmentId=seg.id;S.sourceRange=[0,S.source.duration];invalidate();selectSegment(seg.id);
}
// Short verified excerpts: 22 quoted words from the TV transcript and 4 from the film.
// Fire walk with me is user-selected thematic copy, not attributed to this character.
const CUE_LINES=[
 {id:'fire',title:'主题试音 · Fire walk with me',text:'Fire walk with me.',translation:'与我同行，穿越火焰。',by:'主题试音句 · 非本角色专属台词',source:''},
 {id:'rock',title:'开始吧 · Let’s rock!',text:"Let's rock!",translation:'来吧，摇起来！',by:'The Man from Another Place · S1E3 / Episode 2',source:'https://en.wikiquote.org/wiki/Twin_Peaks'},
 {id:'news',title:'好消息',text:"I've got good news.",translation:'我有个好消息。',by:'The Man from Another Place · S1E3 / Episode 2',source:'https://en.wikiquote.org/wiki/Twin_Peaks'},
 {id:'secrets',title:'满身秘密',text:"She's filled with secrets.",translation:'她藏着满身秘密。',by:'The Man from Another Place · S1E3 / Episode 2',source:'https://en.wikiquote.org/wiki/Twin_Peaks'},
 {id:'gum',title:'你喜欢的口香糖',text:'That gum you like is going to come back in style.',translation:'你喜欢的那种口香糖，又要流行起来了。',by:'The Man from Another Place · S1E3 / Episode 2',source:'https://en.wikiquote.org/wiki/Twin_Peaks'},
 {id:'arm',title:'我是那条手臂',text:'I am the arm.',translation:'我就是那条手臂。',by:'The Man from Another Place · 电影 Fire Walk with Me',source:'https://en.wikipedia.org/wiki/Mike_(Twin_Peaks)#Prequel_film'}
];
let cueIndex=1,cueFont=28,cueTextDraft='',cueDragState=null,cueReturnFocus=null;
function getCueSettings(){return{id:cueIndex===CUE_LINES.length?'custom':CUE_LINES[cueIndex].id,font:cueFont,custom:cueTextDraft};}
function applyCueSettings(o){
 cueIndex=1;cueFont=28;cueTextDraft='';
 if(o&&typeof o==='object'){
  const i=CUE_LINES.findIndex(q=>q.id===o.id);cueIndex=o.id==='custom'?CUE_LINES.length:i<0?1:i;
  cueFont=Number.isFinite(o.font)?clamp(Math.round(o.font),20,42):28;cueTextDraft=String(o.custom||'').slice(0,1000);
 }
 renderCue();
}
function renderCue(){
 const custom=cueIndex===CUE_LINES.length,q=CUE_LINES[cueIndex];
 $('cueSelect').value=custom?'custom':q.id;$('cueCounter').textContent=custom?'自写':`${cueIndex+1} / ${CUE_LINES.length}`;
 $('cueClassic').hidden=custom;$('cueCustom').hidden=!custom;
 if(document.activeElement!==$('cueCustom'))$('cueCustom').value=cueTextDraft;
 if(!custom){$('cueText').textContent=q.text;$('cueTranslation').textContent=q.translation;}
 $('cueAttribution').textContent=custom?'自己的台词 · 不作为剧中引用':q.by;
 $('cueSource').hidden=custom||!q.source;if(!custom&&q.source)$('cueSource').href=q.source;else $('cueSource').removeAttribute('href');
 $('cueBoard').style.setProperty('--cue-font',cueFont+'px');$('cueFontDown').disabled=cueFont<=20;$('cueFontUp').disabled=cueFont>=42;
 syncCueRecordButton();requestAnimationFrame(clampCuePosition);
}
function syncCueRecordButton(){
 const m=S.mic,b=$('cueRecordSource');if(!b)return;
 const sourceRec=m?.target==='source',isRec=sourceRec&&m.state==='recording';
 b.disabled=sourceRec?m.state==='stopping':locked();b.classList.toggle('active',isRec);
 b.querySelector('span:last-child').textContent=isRec?'停止并保存原声':sourceRec?(m.state==='stopping'?'正在保存…':'取消本次准备'):'照着录原声';
 $('cueHint').textContent=isRec?'正在录音 · 可以看着念，结束后点击上方停止。':'正常念出这句；反向发音请听倒放后模仿。';
}
function clampCuePosition(){
 const b=$('cueBoard');if(b.hidden)return;const r=b.getBoundingClientRect(),margin=10;
 const x=clamp(r.left,margin,Math.max(margin,innerWidth-r.width-margin)),y=clamp(r.top,margin,Math.max(margin,innerHeight-r.height-margin));
 b.style.left=x+'px';b.style.top=y+'px';b.style.right='auto';b.style.bottom='auto';
}
function openCueBoard(){
 if($('segmentDialog').open)return;
 const b=$('cueBoard');if(!b.hidden){closeCueBoard();return;}
 cueReturnFocus=document.activeElement;b.hidden=false;$('openCueBoard').setAttribute('aria-expanded','true');
 if(!b.style.left){b.style.left=Math.max(10,innerWidth-b.offsetWidth-24)+'px';b.style.top=(innerWidth<650?Math.min(142,Math.max(10,innerHeight-b.offsetHeight-20)):128)+'px';}
 renderCue();clampCuePosition();$('cueSelect').focus({preventScroll:true});
}
function closeCueBoard(restoreFocus=true){$('cueBoard').hidden=true;$('openCueBoard').setAttribute('aria-expanded','false');if(restoreFocus&&cueReturnFocus?.isConnected)cueReturnFocus.focus({preventScroll:true});}
function moveCue(delta){cueIndex=(cueIndex+delta+CUE_LINES.length) % CUE_LINES.length;S.sessionDirty=true;renderCue();}
async function copyCue(){
 const text=cueIndex===CUE_LINES.length?cueTextDraft:CUE_LINES[cueIndex].text;if(!text.trim())return;
 let copied=false;try{if(navigator.clipboard){await navigator.clipboard.writeText(text);copied=true;}}catch(_){}
 if(!copied){const t=document.createElement('textarea');t.value=text;t.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(t);t.select();try{copied=document.execCommand('copy');}catch(_){}t.remove();}
 $('cueCopy').textContent=copied?'已复制':'请手动复制';setTimeout(()=>{$('cueCopy').textContent='复制';},1800);
}
for(const q of [...CUE_LINES,{id:'custom',title:'自己写一句…'}]){const o=document.createElement('option');o.value=q.id;o.textContent=q.title;$('cueSelect').append(o);}
wire('openCueBoard','click',openCueBoard);wire('cueClose','click',()=>closeCueBoard());
wire('cueFold','click',()=>{const hidden=!$('cueBody').hidden;$('cueBody').hidden=hidden;$('cueFold').textContent=hidden?'＋':'−';$('cueFold').setAttribute('aria-expanded',String(!hidden));$('cueFold').setAttribute('aria-label',hidden?'展开提词内容':'收起提词内容');requestAnimationFrame(clampCuePosition);});
wire('cueSelect','change',()=>{const id=$('cueSelect').value;cueIndex=id==='custom'?CUE_LINES.length:Math.max(0,CUE_LINES.findIndex(q=>q.id===id));S.sessionDirty=true;renderCue();});
wire('cuePrev','click',()=>moveCue(-1));wire('cueNext','click',()=>moveCue(1));
wire('cueFontDown','click',()=>{cueFont=clamp(cueFont-2,20,42);S.sessionDirty=true;renderCue();});wire('cueFontUp','click',()=>{cueFont=clamp(cueFont+2,20,42);S.sessionDirty=true;renderCue();});
wire('cueCustom','input',()=>{cueTextDraft=$('cueCustom').value.slice(0,1000);S.sessionDirty=true;});wire('cueCopy','click',copyCue);
wire('cueRecordSource','click',()=>{if(S.mic?.target==='source'){stopRecording(S.mic.state!=='recording');return;}if(!locked())return startRecording('source');});
$('cueDrag').addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const r=$('cueBoard').getBoundingClientRect();cueDragState={x:e.clientX,y:e.clientY,left:r.left,top:r.top};$('cueDrag').setPointerCapture(e.pointerId);e.preventDefault();});
$('cueDrag').addEventListener('pointermove',e=>{if(!cueDragState)return;const b=$('cueBoard');b.style.left=cueDragState.left+e.clientX-cueDragState.x+'px';b.style.top=cueDragState.top+e.clientY-cueDragState.y+'px';clampCuePosition();});
for(const event of ['pointerup','pointercancel'])$('cueDrag').addEventListener(event,()=>{cueDragState=null;});
$('cueBoard').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeCueBoard();}});
window.addEventListener('resize',clampCuePosition);
renderCue();

