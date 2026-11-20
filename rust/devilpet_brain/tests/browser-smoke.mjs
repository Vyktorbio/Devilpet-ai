// Browser end-to-end smoke test. The static site must behave on a real
// browser (render, adopt JS safely, activate WASM and continue animating).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';

const executablePath=process.env.CHROME_PATH||execFileSync('bash',['-lc',
  'command -v google-chrome || command -v google-chrome-stable || command -v chromium'],{
  encoding:'utf8'
}).trim();
const browser=await chromium.launch({headless:true,executablePath,args:[
  '--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader',
  '--use-gl=angle','--use-angle=swiftshader'
]});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  const consoleErrors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',entry=>{ if(['error','warning'].includes(entry.type())) consoleErrors.push(entry.text()); });
  const response=await page.goto('http://127.0.0.1:8137/',{
    waitUntil:'domcontentloaded',timeout:25000});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>!!window.DevilPetRuntime&&!!window.DevilPetRustBoot,{timeout:20000});
  // Loading must never wait for Rust.
  const ready=await page.evaluate(()=>window.DevilPetRustBoot);
  assert.equal(ready,true,'WASM and engine self-test must initialize');
  await page.waitForFunction(()=>document.getElementById('fly-sensors-values')?.textContent.includes('Antenas:'),
    {timeout:16000});
  assert.equal(await page.evaluate(()=>typeof window.DevilPetSensors?.sample),'function');
  assert.equal(await page.evaluate(()=>window.DevilPetFly!==undefined),true);
  assert.equal(await page.evaluate(()=>window.DevilPetWorld3D!==undefined),true);
  assert.equal(await page.evaluate(()=>window.DevilPetConnectomeBridge!==undefined),true);
  await page.waitForFunction(()=>window.DevilPetRuntime.getBrain().tick>60,
    {timeout:20000});
  assert.equal(await page.evaluate(()=>window.DevilPetRustStatus().mode),'javascript');
  assert.ok(!errors.length,'JS error while opening: '+errors.join(' | '));
  await page.locator('#brain-advanced summary').click();
  await page.locator('#brain-runtime-toggle').click();
  await page.waitForFunction(()=>window.DevilPetRustStatus().mode==='rust',{timeout:10000});
  const before=await page.evaluate(()=>window.DevilPetRuntime.getBrain().tick);
  await page.waitForFunction(expected=>window.DevilPetRuntime.getBrain().tick>expected,
    before,{timeout:15000});
  const diagnostics=await page.evaluate(()=>({
    runtime:window.DevilPetRustStatus?.(),
    indicator:document.getElementById('brain-runtime')?.textContent,
    rustBrain:window.DevilPetRuntime.getBrain().isRust,
    rustOdor:window.DevilPetRuntime.getOdor().isRust,
    brainTick:window.DevilPetRuntime.getBrain().tick
  }));
  if(!diagnostics.rustBrain || diagnostics.runtime?.mode!=='rust'){
    console.error('BROWSER DIAGNOSTICS',JSON.stringify({diagnostics,errors,consoleErrors}));
  }
  assert.equal(diagnostics.rustBrain,true);
  assert.equal(await page.evaluate(()=>typeof window.DevilPetRuntime.getBrain().rng.next),'function');
  await page.locator('#brain-runtime-toggle').click();
  await page.waitForFunction(()=>window.DevilPetRustStatus().mode==='javascript',{timeout:10000});
  assert.equal(await page.evaluate(()=>!!window.DevilPetRuntime.getBrain().isRust),false);
  assert.ok(!errors.length,'Browser runtime error: '+errors.join(' | '));
  // Browser-only mock verifies the transport/control contract. It does not
  // constitute real connectome data or anatomical validation.
  let cnsRequests=0;
  await page.route('http://127.0.0.1:8326/**',async route=>{
    const uri=route.request().url();
    const headers={
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Content-Type':'application/json'
    };
    if(route.request().method()==='OPTIONS'){
      await route.fulfill({status:204,headers});return;
    }
    if(uri.endsWith('/health')){
      await route.fulfill({status:200,headers,body:JSON.stringify({
        schema:'devilpet-cns-server-v1',
        status:'graph_loaded_ports_reviewed',
        dataset_id:'male-cns-v1.0-2026',dataset_version:'v1.0',
        dataset_source:'https://male-cns.janelia.org/download/',
        node_count:166691,edge_count:152000000,
        available_motors:['forward','turn_left','turn_right','lift']
      })});return;
    }
    if(uri.endsWith('/step')){
      const data=route.request().postDataJSON();
      cnsRequests++;
      await route.fulfill({status:200,headers,body:JSON.stringify({
        schema:'devilpet-cns-output-v1',
        sample_id:data.sample_id,
        dataset_id:'male-cns-v1.0-2026',dataset_version:'v1.0',
        motor:{forward:.8,turn:.12,lift:.32,activity:1.4}
      })});return;
    }
    await route.fulfill({status:404,headers,body:'{}'});
  });
  await page.locator('#cns-bridge-details summary').click();
  await page.locator('#cns-connect').click();
  await page.waitForFunction(()=>document.getElementById('cns-bridge-status')?.textContent.includes('male-cns-v1.0-2026'),
    {timeout:12000});
  await page.waitForFunction(()=>!document.getElementById('cns-activate').disabled,
    {timeout:14000});
  await page.locator('#cns-activate').click();
  await page.waitForFunction(()=>document.getElementById('cns-bridge-status')?.textContent.includes('Controle CNS experimental ativo'),
    {timeout:10000});
  const cnsTick=await page.evaluate(()=>window.DevilPetRuntime.getBrain().tick);
  await page.waitForTimeout(750);
  const frozen=await page.evaluate(()=>window.DevilPetRuntime.getBrain().tick);
  assert.equal(frozen,cnsTick,'reduced brain must not learn while CNS mode controls body');
  assert.ok(cnsRequests>0,'sensor vector must be sent to native bridge protocol');
  await page.locator('#cns-disconnect').click();
  await page.waitForFunction(()=>document.getElementById('cns-bridge-status')?.textContent.includes('Desconectado'),
    {timeout:10000});
  const afterDisconnect=await page.evaluate(()=>window.DevilPetRuntime.getBrain().tick);
  await page.waitForFunction(previous=>window.DevilPetRuntime.getBrain().tick>previous,
    afterDisconnect,{timeout:16000});
  await page.unrouteAll({behavior:'wait'});
  console.log('PASS: mock transport only; independent sensors, opt-in CNS control and reduced-brain fallback.');
  const catalogResponse=await page.goto('http://127.0.0.1:8137/connectomes/',{
    waitUntil:'domcontentloaded',timeout:15000
  });
  assert.equal(catalogResponse.status(),200,'research page must be published');
  await page.waitForFunction(()=>document.querySelectorAll('#datasets article').length>=6,
    {timeout:10000});
  const research=await page.evaluate(()=>({
    sources:document.querySelectorAll('#datasets article').length,
    female:document.body.textContent.includes('banc-female-2026-v888'),
    male:document.body.textContent.includes('male-cns-v1.0-2026')
  }));
  assert.ok(research.female&&research.male,'published catalogue must contain both 2026 whole CNS datasets');
  console.log('PASS: 3D pet, JS/Rust switch and scientific connectome catalogue all work.');

}finally {
  await browser.close();
}
