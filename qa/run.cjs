'use strict';
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

(async () => {
  const root = process.env.PPFC_QA_ROOT || syncFs.readFileSync('/private/tmp/ppfc-qa108-path','utf8');
  const req = createRequire(path.join(root,'src/main.cjs'));
  const sharp = req('sharp');
  const work = await fs.mkdtemp('/private/tmp/ppfc-qa-results-');
  const output = path.join(work,'output'); await fs.mkdir(output);
  const handlers = new Map(), events = [], checks = [];
  let window, dialogResult, protocolHandler;
  class BrowserWindow {
    constructor(options) {
      this.options=options; window=this;
      this.webContents={mainFrame:{url:'ppfc://app/index.html'},session:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}},on(){},setWindowOpenHandler(){},send:(channel,data)=>events.push({channel,data})};
    }
    loadURL(){} isDestroyed(){return false;} static getAllWindows(){return [window];}
  }
  const electron={utilityProcess:{fork(modulePath){const child=require('node:child_process').fork(path.join(__dirname,'worker-node.cjs'),[modulePath],{stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'});child.postMessage=data=>child.send(data);return child;}},app:{whenReady:()=>Promise.resolve(),on(){}}, BrowserWindow,
    protocol:{registerSchemesAsPrivileged(){},handle:(_scheme,fn)=>protocolHandler=fn},
    session:{defaultSession:{webRequest:{onBeforeRequest(){}}}},
    dialog:{showOpenDialog:async()=>dialogResult},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)}};
  const Module=require('node:module'), originalLoad=Module._load;
  Module._load=function(name,...args){return name==='electron'?electron:originalLoad.call(this,name,...args);};
  vm.runInNewContext(await fs.readFile(path.join(root,'src/main.cjs'),'utf8'),{
    require:name=>name==='electron'?electron:req(name),__dirname:path.join(root,'src'),process,Buffer,URL,Response,console,setTimeout,Uint8ClampedArray
  });
  await new Promise(resolve=>setImmediate(resolve));
  const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
  const call=(key,...args)=>handlers.get(key)(event,...args);
  const check=async(name,fn)=>{try{await fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL',error:e.message});}};
  const approve=async paths=>{dialogResult={canceled:false,filePaths:paths};return call('files:choose');};
  const convert=async(items,format,options={})=>{events.length=0;await call('convert:batch',{items,format,...options});return events.filter(e=>e.channel==='convert:result').map(e=>e.data);};
  dialogResult={canceled:false,filePaths:[output]};await call('folder:choose');
  const formats=['jpeg','png','webp','avif','tiff','gif'];
  const fixtures=[];
  for(const f of formats){const p=path.join(work,'input.'+f);await sharp({create:{width:32,height:24,channels:4,background:'#5381ad80'}}).toFormat(f).toFile(p);fixtures.push(p);}
  fixtures.push('/private/tmp/ppfc-fixture.heic');
  const svg=path.join(work,'한글 이름.svg');await fs.writeFile(svg,'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="red"/></svg>');fixtures.push(svg);
  for(const input of fixtures){
    const items=await approve([input]);
    for(const format of formats)await check(`${path.extname(input)} -> ${format}`,async()=>{
      const [r]=await convert(items,format);assert.equal(r.ok,true,r.error);
      if(format==='avif') {
        // App deliberately blocks the native HEIF loader globally. Use an
        // independent process to validate AVIF output without that block.
        execFileSync(process.execPath,['-e',"require(process.argv[1])(process.argv[2]).raw().toBuffer().then(b=>{if(!b.length)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})",req.resolve('sharp'),path.join(output,r.output)]);
      } else {
        const data=await sharp(await fs.readFile(path.join(output,r.output))).raw().toBuffer({resolveWithObject:true});assert(data.data.length>0);assert(data.info.width>0);
      }
    });
  }
  const item=(await approve([fixtures[1]]))[0];
  await check('1000 distinct files and monotonic progress',async()=>{
    const paths=[];
    for(let i=0;i<1000;i++){const p=path.join(work,`batch-${i}.png`);await fs.copyFile(fixtures[1],p);paths.push(p);}
    const batch=await approve(paths);assert.equal(batch.length,1000);
    const rs=await convert(batch,'jpeg');assert.equal(rs.filter(r=>r.ok).length,1000);
    const ps=events.filter(e=>e.channel==='convert:progress').map(e=>e.data);assert.equal(ps.length,1000);assert.equal(ps.at(-1).percent,100);assert(ps.every((v,i)=>!i||v.percent>=ps[i-1].percent));
  });
  await check('existing output not overwritten',async()=>{
    const before=await fs.readFile(path.join(output,'input.jpg'));const [r]=await convert([item],'jpeg');assert(r.ok);assert.notEqual(r.output,'input.jpg');assert.deepEqual(before,await fs.readFile(path.join(output,'input.jpg')));
  });
  await check('resize 32x24 to 16x12',async()=>{const [r]=await convert([item],'png',{width:16,height:12});assert(r.ok,r.error);const m=await sharp(path.join(output,r.output)).metadata();assert.equal(m.width,16);assert.equal(m.height,12);});
  await check('reject invalid dimensions and clean temp',async()=>{const [r]=await convert([item],'png',{width:-1});assert.equal(r.ok,false);assert(!(await fs.readdir(output)).some(n=>n.startsWith('.ppfc-')));});
  await check('reject unapproved file',async()=>{const [r]=await convert([{id:'forged',path:fixtures[0]}],'jpeg');assert.equal(r.ok,false);});
  await check('reject untrusted IPC sender',async()=>{assert.throws(()=>handlers.get('formats:get')({sender:{},senderFrame:{}}));});
  await check('reject modified approved input',async()=>{const p=path.join(work,'modified.png');await fs.copyFile(fixtures[1],p);const items=await approve([p]);await fs.appendFile(p,'changed');const [r]=await convert(items,'jpeg');assert.equal(r.ok,false);});
  await check('reject revoked approval',async()=>{await call('files:revoke',[item.id]);const [r]=await convert([item],'jpeg');assert.equal(r.ok,false);});
  await check('corrupt input fails but next file succeeds',async()=>{const p=path.join(work,'broken.jpg');await fs.writeFile(p,'broken');const rs=await convert(await approve([p,fixtures[1]]),'jpeg');assert.equal(rs[0].ok,false);assert.equal(rs[1].ok,true);});
  await check('unsupported HEIF output excluded and rejected',async()=>{const info=await call('formats:get');assert(!info.formats.includes('heif'));await assert.rejects(()=>convert([item],'heif'));});
  await check('disguised AVIF rejected and worker recovers',async()=>{const p=path.join(work,'disguised.avif');await fs.copyFile(fixtures[1],p);const rs=await convert(await approve([p,fixtures[3]]),'jpeg');assert.equal(rs[0].ok,false);assert.equal(rs[1].ok,true);});
  await check('eight concurrent HEIC batch requests',async()=>{const items=await approve(['/private/tmp/ppfc-fixture.heic']);events.length=0;await Promise.all(Array.from({length:8},()=>call('convert:batch',{items,format:'jpeg'})));assert.equal(events.filter(e=>e.channel==='convert:result'&&e.data.ok).length,8);});
  await check('protocol rejects unexpected origin/path',async()=>{for(const url of ['ppfc://app/package.json','ppfc://evil/index.html','ppfc://app/index.html?x=1'])assert.equal((await protocolHandler({url,method:'GET'})).status,404);assert.equal((await protocolHandler({url:'ppfc://app/index.html',method:'GET'})).status,200);});
  const report={version:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,source:process.env.PPFC_QA_ROOT?'Workspace source; real codecs/filesystem; Electron transport mocked; AVIF worker runs in real Node child process':'Extracted installed /Applications/PPFC.app app.asar; real bundled codecs; mocked Electron window/dialog/IPC transport',work,checks,pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length};
  await fs.writeFile(process.env.PPFC_QA_REPORT || 'qa/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(report.fail)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
