'use strict';
const $ = id => document.getElementById(id);
let files = [], folder = null, busy = false;
const results = new Map();
const format = $('format');
function render(){
  $('addFiles').disabled=busy;
  $('chooseFolder').disabled=busy;
  $('count').textContent=files.length.toLocaleString('ko-KR');
  $('clear').disabled=!files.length||busy;
  $('convert').disabled=!files.length||!folder||busy;
  const list=$('fileList'); list.replaceChildren();
  if(!files.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='추가한 사진이 여기에 표시됩니다';list.append(empty);return;}
  for(const file of files){
    const row=document.createElement('div');row.className='file-row';
    const thumb=document.createElement('div');thumb.className='thumb';thumb.textContent=(file.name.split('.').pop()||'IMG').slice(0,3).toUpperCase();
    const name=document.createElement('div');name.className='filename';name.title=file.name;name.append(document.createTextNode(file.name));
    const result=document.createElement('div');result.className='result';result.id=`r-${file.id}`;name.append(result);
    if(results.has(file.id)) showResult(result,results.get(file.id));
    const fileSize=document.createElement('div');fileSize.className='filesize';fileSize.textContent=size(file.bytes);
    const remove=document.createElement('button');remove.className='remove';remove.dataset.remove=file.id;remove.disabled=busy;remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`${file.name} 제거`);
    row.append(thumb,name,fileSize,remove);list.append(row);
  }
}
function size(n){return n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;}
function showResult(el,{ok,output,error}){el.textContent=ok?`✓ ${output}`:`! ${error}`;el.style.color=ok?'#548360':'#ac5b48';}
$('addFiles').onclick=async()=>{if(busy)return;const picked=await window.forma.chooseFiles();const seen=new Set(files.map(x=>x.path));for(const f of picked)if(!seen.has(f.path)){files.push(f);seen.add(f.path)}render();$('status').textContent=`${files.length.toLocaleString('ko-KR')}장 준비됨`;};
$('clear').onclick=()=>{if(busy)return;const ids=files.map(x=>x.id);files=[];results.clear();void window.forma.revokeFiles(ids);$('progressWrap').hidden=true;render();};
$('fileList').onclick=e=>{const b=e.target.closest('[data-remove]');if(b){if(busy)return;const id=b.dataset.remove;results.delete(id);files=files.filter(x=>x.id!==id);void window.forma.revokeFiles([id]);render();}};
$('dropzone').onclick=e=>{if(e.target.closest('button'))return;$('addFiles').click();};
const dz=$('dropzone');
for(const type of ['dragenter','dragover'])dz.addEventListener(type,e=>{e.preventDefault();dz.classList.add('dragging');});
for(const type of ['dragleave','drop'])dz.addEventListener(type,e=>{e.preventDefault();dz.classList.remove('dragging');});
dz.addEventListener('drop',async e=>{if(busy)return;const picked=await window.forma.registerDroppedFiles(Array.from(e.dataTransfer.files));const seen=new Set(files.map(x=>x.path));for(const f of picked)if(!seen.has(f.path)){files.push(f);seen.add(f.path)}render();$('status').textContent=`${files.length.toLocaleString('ko-KR')}장 준비됨`;});
$('chooseFolder').onclick=async()=>{if(busy)return;folder=await window.forma.chooseFolder();if(folder){$('folderName').textContent=folder.split(/[\\/]/).pop()||folder;$('folderName').title=folder;}render();};
$('quality').oninput=()=>{$('qualityVal').textContent=$('quality').value;};
const lossy=new Set(['jpeg','webp','avif','tiff']);format.onchange=()=>{$('quality').disabled=!lossy.has(format.value);};
window.forma.onResult(result=>{results.set(result.id,result);const el=$(`r-${result.id}`);if(el)showResult(el,result);});
window.forma.onProgress(({completed,total,percent})=>{$('progressWrap').hidden=false;$('progressBar').value=percent;$('progressPercent').textContent=`${percent}%`;$('progressText').textContent=`${completed.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}장`;});
window.forma.onDone(()=>{busy=false;render();$('progressWrap').hidden=false;$('progressBar').value=100;$('progressPercent').textContent='100%';$('progressText').textContent='변환 완료';const ok=files.filter(x=>results.get(x.id)?.ok).length;const failed=files.filter(x=>results.get(x.id)?.ok===false).length;$('status').textContent=`완료 · ${ok.toLocaleString('ko-KR')}장 변환됨${failed?` · ${failed.toLocaleString('ko-KR')}장 실패`:''}`;});
$('convert').onclick=async()=>{if(busy||!files.length||!folder)return;results.clear();busy=true;render();$('progressWrap').hidden=false;$('progressBar').value=0;$('progressPercent').textContent='0%';$('progressText').textContent=`0 / ${files.length.toLocaleString('ko-KR')}장`;$('status').textContent=`${files.length.toLocaleString('ko-KR')}장 변환 중 · 앱을 종료하지 마세요`;try{await window.forma.convert({items:files.map(({id,path,name})=>({id,path,name})),format:format.value,quality:Number($('quality').value),width:Number($('width').value)||null,height:Number($('height').value)||null,background:'#ffffff'});}catch(e){busy=false;render();$('status').textContent='변환을 시작하지 못했습니다';}};
(async()=>{const info=await window.forma.getFormats();const inFormats=Object.entries(info.input).filter(([,v])=>v.input?.file).map(([k])=>k.toUpperCase());$('codecNote').textContent=`입력 형식: ${inFormats.join(', ')} · HEIC/HEIF 입력은 로컬 WebAssembly 코덱으로 처리합니다.`;})();
