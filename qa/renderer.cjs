'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
  constructor(){this.children=[];this.style={};this.dataset={};this.value='';this.hidden=false;this.classList={add(){},remove(){}};}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
  setAttribute(){} addEventListener(){}
}
const ids=['format','count','clear','convert','fileList','addFiles','status','dropzone','chooseFolder','folderName','quality','qualityVal','progressWrap','progressBar','progressPercent','progressText','width','height','codecNote'];
const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));nodes.format.value='jpeg';nodes.quality.value=90;
const flatten=n=>[n,...n.children.flatMap(flatten)];
const document={getElementById:id=>nodes[id]||flatten(nodes.fileList).find(n=>n.id===id),createElement:()=>new Element(),createTextNode:text=>Object.assign(new Element(),{textContent:text})};
let onResult,onDone,onProgress,run=0;
const input=[{id:'a',path:'/qa/a.png',name:'a.png',bytes:1},{id:'b',path:'/qa/b.png',name:'b.png',bytes:1}];
const forma={chooseFiles:async()=>input,chooseFolder:async()=>'/qa/output',revokeFiles:async()=>true,getFormats:async()=>({input:{png:{input:{file:true}}}}),onResult:fn=>onResult=fn,onDone:fn=>onDone=fn,onProgress:fn=>onProgress=fn,convert:async()=>{
  run++;onResult({id:'a',ok:true,output:'a.jpg'});onResult({id:'b',ok:run>1,output:'b.jpg',error:'bad image'});onProgress({completed:2,total:2,percent:100});onDone();
}};
vm.runInNewContext(fs.readFileSync(process.env.PPFC_RENDERER||'src/renderer.js','utf8'),{document,window:{forma},console});
(async()=>{
await nodes.addFiles.onclick();await nodes.chooseFolder.onclick();await nodes.convert.onclick();
assert.equal(nodes.status.textContent,'완료 · 1장 변환됨 · 1장 실패');
assert.equal(document.getElementById('r-a').textContent,'✓ a.jpg');assert.equal(document.getElementById('r-b').textContent,'! bad image');
await nodes.chooseFolder.onclick();assert.equal(document.getElementById('r-a').textContent,'✓ a.jpg');
await nodes.convert.onclick();assert.equal(nodes.status.textContent,'완료 · 2장 변환됨');
nodes.clear.onclick();assert.equal(nodes.progressWrap.hidden,true);assert.equal(nodes.count.textContent,'0');
console.log('PASS: mixed results, completion count, rerender persistence, retry replaces stale results, clear resets progress');
})().catch(e=>{console.error(e);process.exitCode=1;});
