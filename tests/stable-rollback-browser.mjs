// Real-browser regression for the last pre-connectome DevilPet release.
// This is intentionally an integration test of the ORIGINAL monolithic 3D
// simulation; it may not import any CNS, Rust or Python bridge.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';

const chrome=process.env.CHROME_PATH || execFileSync('bash',
  ['-lc','command -v google-chrome || command -v chromium || command -v google-chrome-stable'],{
    encoding:'utf8'
  }).trim();
const browser=await chromium.launch({headless:true,executablePath:chrome,args:[
  '--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader',
  '--use-gl=angle','--use-angle=swiftshader'
]});
try {
  const page=await browser.newPage({
    viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true
  });
  const errors=[],failedRequired=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{
    if(r.status()>=400&&!r.url().endsWith('/favicon.ico')) failedRequired.push(r.status()+' '+r.url());
  });
  const response=await page.goto('http://127.0.0.1:8137/?rollback-test=1',{
    waitUntil:'load',timeout:30000
  });
  assert.equal(response.status(),200,'DevilPet page must load');
  await page.waitForFunction(()=>typeof brain!=='undefined' &&
    brain.tick>=150 && typeof stepSimulation==='function',null,{timeout:30000});
  const inspect=()=>page.evaluate(()=>({
    tick:brain.tick,running,sleeping,model:brain.tierKey,
    x:flyPos.x,y:flyPos.y,z:flyPos.z,
    canvas:!!document.querySelector('#viewport canvas'),
    renderer:renderer.info.render.calls,
    hasCns:!!document.getElementById('cns-bridge-details'),
    localMemoryKey:'drosophila_3d_trainer_v1'
  }));
  const first=await inspect();
  assert.equal(first.canvas,true);
  assert.equal(first.running,true);
  assert.equal(first.hasCns,false);
  assert.equal(first.model,'drosophila');
  assert.ok(Number.isFinite(first.x)&&Number.isFinite(first.y)&&Number.isFinite(first.z));
  // The reported regression was spontaneous pausing. Keep the actual 3D
  // animation alive for multiple successive wall-time intervals.
  await page.waitForTimeout(3000);
  const second=await inspect();
  await page.waitForTimeout(3000);
  const third=await inspect();
  assert.ok(second.tick>first.tick,
    'neural simulation must advance continuously in interval 1');
  assert.ok(third.tick>second.tick,
    'neural simulation must advance continuously in interval 2');
  assert.equal(second.running,true,'simulation must not pause itself');
  assert.equal(third.running,true,'simulation must still run after 6 seconds');
  assert.ok(Number.isFinite(third.x)&&Number.isFinite(third.y)&&Number.isFinite(third.z));

  // Manual pause/resume must remain correct.
  await page.locator('#btn-play').click();
  assert.equal(await page.evaluate(()=>running),false,'manual pause');
  const paused=await page.evaluate(()=>brain.tick);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>brain.tick),paused,'manual pause stops brain');
  await page.locator('#btn-play').click();
  assert.equal(await page.evaluate(()=>running),true,'manual resume');
  await page.waitForFunction(prev=>brain.tick>prev,paused,{timeout:12000});

  // Preserve original localStorage checkpoints and reload a pet safely.
  // A neutral fly has no water preference. Physical contact creates the association.
  const weights = await page.evaluate(() => {
    pet.hydration = 0.4;
    pondState = {active:true,x:flyPos.x,z:flyPos.z};
    flyPos.y = 0;
    lastMetabolismStamp = performance.now() - 50;
    stepSimulation();
    return Array.from(resourceMemory.weights);
  });
  assert.ok(weights[3] > 0 && weights[2] === 0, 'drinking teaches hydration');
  await page.locator('#btn-data').click();
  await page.locator('#btn-save').click();
  const stored=await page.evaluate(()=>{
    const raw=localStorage.getItem('drosophila_3d_trainer_v1');
    return raw?JSON.parse(raw):null;
  });
  assert.ok(stored.resourceWeights[3] >= weights[3]);
  assert.ok(stored?.tick>0,'pet saved with neural time');
  assert.ok(stored?.shortW?.length>0&&stored?.longW?.length>0,
    'learned weights preserved');
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>brain.tick>0,null,{timeout:20000});
  const reloaded=await page.evaluate(()=>({
    tick:brain.tick,tier:brain.tierKey,running,
    saved:!!localStorage.getItem('drosophila_3d_trainer_v1')
  }));
  assert.equal(reloaded.running,true,'pet continues after reload');
  assert.equal(reloaded.tier,stored.tierKey);
  assert.equal(reloaded.saved,true);
  assert.ok(reloaded.tick>=stored.tick,'saved neural time restored');
  assert.deepEqual(errors,[],'no uncaught browser exceptions');
  assert.deepEqual(failedRequired,[],'no missing required site assets');
  console.log('PASS: original pre-CNS fly 3D, continuous flight (6s), pause/resume, weights, save and reload.');
} finally {
  await browser.close();
}
