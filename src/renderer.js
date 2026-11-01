'use strict';
const $ = id => document.getElementById(id);
let files = [], folder = null, busy = false;
const results = new Map();
const format = $('format');
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){ $('count').textContent=files.length.toLocaleString('ko-KR'); $('clear').disabled=!files.length||busy; $('convert').disabled=!files.length||!folder||busy; $('fileList').innerHTML=files.length?files.map(f=>`<div class="file-row"><div class="thumb">${esc((f.name.split('.').pop()||'IMG').slice(0,3).toUpperCase())}</div><div class="filename" title="${esc(f.name)}">${esc(f.name)}<div class="result" id="r-${f.id}"></div></div><div class="filesize">${size(f.bytes)}</div><button class="remove" data-remove="${f.id}" ${busy?'disabled':''}>×</button></div>`).join(''):'<div class="empty">추가한 사진이 여기에 표시됩니다</div>'; }
function size(n){return n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;}
$('addFiles').onclick=async()=>{const picked=await window.forma.chooseFiles();const seen=new Set(files.map(x=>x.path));for(const f of picked)if(!seen.has(f.path)){files.push(f);seen.add(f.path)}render();$('status').textContent=`${files.length.toLocaleString('ko-KR')}장 준비됨`;};
$('clear').onclick=()=>{files=[];render();};
$('fileList').onclick=e=>{const b=e.target.closest('[data-remove]');if(b){files=files.filter(x=>x.id!==b.dataset.remove);render();}};
$('dropzone').onclick=e=>{if(e.target.closest('button'))return;$('addFiles').click();};
const dz=$('dropzone');
for(const type of ['dragenter','dragover'])dz.addEventListener(type,e=>{e.preventDefault();dz.classList.add('dragging');});
for(const type of ['dragleave','drop'])dz.addEventListener(type,e=>{e.preventDefault();dz.classList.remove('dragging');});
dz.addEventListener('drop',async e=>{const picked=await window.forma.registerDroppedFiles(Array.from(e.dataTransfer.files));const seen=new Set(files.map(x=>x.path));for(const f of picked)if(!seen.has(f.path)){files.push(f);seen.add(f.path)}render();$('status').textContent=`${files.length.toLocaleString('ko-KR')}장 준비됨`;});
$('chooseFolder').onclick=async()=>{folder=await window.forma.chooseFolder();if(folder){$('folderName').textContent=folder.split(/[\\/]/).pop()||folder;$('folderName').title=folder;}render();};
$('quality').oninput=()=>{$('qualityVal').textContent=$('quality').value;};
const lossy=new Set(['jpeg','webp','avif','tiff','heif']);format.onchange=()=>{$('quality').disabled=!lossy.has(format.value);};
window.forma.onResult(({id,ok,output,error})=>{const el=$(`r-${id}`);if(el){el.textContent=ok?`✓ ${output}`:`! ${error}`;el.style.color=ok?'#548360':'#ac5b48';}});
window.forma.onProgress(({completed,total,percent})=>{$('progressWrap').hidden=false;$('progressBar').value=percent;$('progressPercent').textContent=`${percent}%`;$('progressText').textContent=`${completed.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}장`;});
window.forma.onDone(()=>{busy=false;render();$('progressWrap').hidden=false;$('progressBar').value=100;$('progressPercent').textContent='100%';$('progressText').textContent='변환 완료';const done=[...document.querySelectorAll('.result')];const ok=done.filter(x=>x.textContent.startsWith('✓')).length;$('status').textContent=`완료 · ${ok.toLocaleString('ko-KR')}장 변환됨`;});
$('convert').onclick=async()=>{if(busy||!files.length||!folder)return;busy=true;render();$('progressWrap').hidden=false;$('progressBar').value=0;$('progressPercent').textContent='0%';$('progressText').textContent=`0 / ${files.length.toLocaleString('ko-KR')}장`;$('status').textContent=`${files.length.toLocaleString('ko-KR')}장 변환 중 · 앱을 종료하지 마세요`;try{await window.forma.convert({items:files.map(({id,path,name})=>({id,path,name})),format:format.value,quality:Number($('quality').value),width:Number($('width').value)||null,height:Number($('height').value)||null,background:'#ffffff'});}catch(e){busy=false;render();$('status').textContent='변환을 시작하지 못했습니다';}};
(async()=>{const info=await window.forma.getFormats();const inFormats=Object.entries(info.input).filter(([,v])=>v.input?.file).map(([k])=>k.toUpperCase());$('codecNote').textContent=`입력 형식: ${inFormats.join(', ')} · HEIC/HEIF 입력은 로컬 WebAssembly 코덱으로 처리합니다.`;})();
