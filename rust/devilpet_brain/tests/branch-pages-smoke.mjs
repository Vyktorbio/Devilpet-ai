// Regression: the GitHub Pages "Deploy from branch" source must remain usable
// even without _site generated WASM assets. A missing optional Rust binary
// must NEVER prevent the 3D fly from loading, running, learning or saving.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
const executablePath=process.env.CHROME_PATH ||
  execFileSync('bash',['-lc','command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim();
const browser=await chromium.launch({
  headless:true,executablePath,
  args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader',
        '--use-gl=angle','--use-angle=swiftshader']
});
try{
  const page=await browser.newPage({
    viewport:{width:390,height:844},deviceScaleFactor:2,
    isMobile:true,hasTouch:true
  });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const missing=[];
  page.on('response',r=>{
    if(r.status()===404)missing.push(r.url());
  });
  const r=await page.goto('http://127.0.0.1:8138/?v=branch-independent',{
    waitUntil:'domcontentloaded',timeout:30000
  });
  assert.equal(r.status(),200);
  await page.waitForFunction(()=>window.DevilPetRuntime && window.DevilPetSensors,{
    timeout:20000
  });
  // Three.js should be shipped in the repository, not only _site artifacts.
  assert.equal(await page.evaluate(()=>typeof THREE),'object');
  const status=await page.evaluate(()=>window.DevilPetRustBoot);
  assert.equal(status,false,'optional WASM is intentionally absent on branch source');
  await page.waitForFunction(()=>window.DevilPetRuntime.getBrain().tick>120,{
    timeout:25000
  });
  const state=await page.evaluate(()=>({
    tick:window.DevilPetRuntime.getBrain().tick,
    threeCanvas:document.querySelector('#viewport canvas')!==null,
    mode:window.DevilPetRustStatus().mode,
    sensors:document.getElementById('fly-sensors-values')?.textContent
  }));
  assert.equal(state.threeCanvas,true,'the 3D fly must have an actual canvas');
  assert.equal(state.mode,'javascript');
  assert.ok(state.sensors?.includes('Antenas:'),'independent fly sensors must update');
  assert.ok(!errors.length,'uncaught JS error: '+errors.join(' | '));
  assert.ok(missing.every(url=>url.includes('/rust/devilpet_brain/pkg/')),
    'required assets missing: '+missing.join(', '));
  console.log('PASS: mobile-sized browser, branch Pages source, independent 3D fly and optional WASM fallback.');
}finally{
  await browser.close();
}
