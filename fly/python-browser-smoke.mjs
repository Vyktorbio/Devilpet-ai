// End-to-end browser regression: Python-backed CNS, JavaScript offline pet.
// CNS data returned by this test are MOCKS, not a real biological graph.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';

const executablePath=process.env.CHROME_PATH||
  execFileSync('bash',['-lc','command -v google-chrome || command -v chromium'],{
    encoding:'utf8'
  }).trim();
const browser=await chromium.launch({headless:true,executablePath,args:[
  '--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader',
  '--use-gl=angle','--use-angle=swiftshader'
]});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto('http://127.0.0.1:8137/',{
    waitUntil:'domcontentloaded',timeout:30000
  });
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.DevilPetRuntime?.getBrain().tick>90,{
    timeout:25000
  });
  await page.waitForFunction(()=>document.getElementById('fly-sensors-values')?.textContent.includes('Antenas:'),{
    timeout:15000
  });
  assert.equal(await page.evaluate(()=>document.querySelector('#viewport canvas')!==null),true);
  assert.match(await page.locator('#brain-runtime').innerText(),/Python/);
  assert.equal(await page.evaluate(()=>!!window.DevilPetRustBoot),false,
    'Rust runtime must no longer be loaded by the page');
  assert.equal(await page.evaluate(()=>typeof window.DevilPetSensors?.sample),'function');
  assert.equal(await page.evaluate(()=>typeof window.DevilPetConnectomeBridge?.ConnectomeBridge),'function');
  assert.deepEqual(errors,[]);

  // Browser mock: transport compatibility only; NO real graph downloaded.
  let sent=0;
  await page.route('http://127.0.0.1:8326/**',async route=>{
    const url=route.request().url();
    const headers={
      'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Content-Type':'application/json'
    };
    if(route.request().method()==='OPTIONS'){
      await route.fulfill({status:200,headers,body:'{}'});return;
    }
    if(url.endsWith('/health')){
      await route.fulfill({status:200,headers,body:JSON.stringify({
        schema:'devilpet-cns-server-v1',
        status:'graph_loaded_ports_reviewed',
        backend:'python',
        dataset_id:'male-cns-v1.0-2026',dataset_version:'v1.0',
        dataset_source:'https://male-cns.janelia.org/download/',
        node_count:166691,edge_count:152000000,
        available_motors:['forward','turn_left','turn_right','lift']
      })});return;
    }
    if(url.endsWith('/step')){
      const data=route.request().postDataJSON();
      sent++;
      await route.fulfill({status:200,headers,body:JSON.stringify({
        schema:'devilpet-cns-output-v1',
        sample_id:data.sample_id,dataset_id:'male-cns-v1.0-2026',
        dataset_version:'v1.0',
        motor:{forward:.8,turn:.12,lift:.32,activity:1.4}
      })});return;
    }
    await route.fulfill({status:404,headers,body:'{}'});
  });
  await page.locator('#brain-advanced summary').click();
  await page.locator('#cns-bridge-details summary').click();
  await page.locator('#cns-connect').click();
  await page.waitForFunction(()=>document.getElementById('cns-bridge-status')?.textContent.includes('male-cns-v1.0-2026'),{
    timeout:15000
  });
  await page.waitForFunction(()=>!document.getElementById('cns-activate').disabled,{
    timeout:15000
  });
  await page.locator('#cns-activate').click();
  await page.waitForFunction(()=>document.getElementById('cns-bridge-status')?.textContent.includes('Controle CNS experimental ativo'),{
    timeout:12000
  });
  const frozen=await page.evaluate(()=>window.DevilPetRuntime.getBrain().tick);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.DevilPetRuntime.getBrain().tick),frozen,
    'local synaptic weights must be held during Python CNS motor control');
  assert.ok(sent>0);
  await page.locator('#cns-disconnect').click();
  const before=await page.evaluate(()=>window.DevilPetRuntime.getBrain().tick);
  await page.waitForFunction(old=>window.DevilPetRuntime.getBrain().tick>old,before,{
    timeout:15000
  });
  assert.deepEqual(errors,[]);
  console.log('PASS: 3D fly, sensors, no Rust WASM, Python CNS protocol and fallback (mock transport).');
}finally{await browser.close();}
