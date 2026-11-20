/* Run with: node --test tests/scenario-world.test.js
 * Deliberately uses a tiny Three.js mock; tests the physics and event adapter
 * without a GPU, DOM, or altering the neural engine.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Node {
  constructor() {
    this.children = [];
    this.visible = true;
    this.position = { x: 0, y: 0, z: 0, set(x,y,z) { this.x=x; this.y=y; this.z=z; } };
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { x: 1, y: 1, z: 1 };
  }
  add(...nodes) { this.children.push(...nodes); }
}
class Mesh extends Node { constructor(geometry, material) { super(); this.geometry=geometry; this.material=material; } }
class Vector3 { constructor(x,y,z) { Object.assign(this,{x,y,z}); } }
class Geometry { constructor(...args) { this.args=args; } }
const THREE = {
  Group: Node, Mesh, Vector3, DoubleSide: 2,
  MeshStandardMaterial: Geometry, MeshBasicMaterial: Geometry,
  CatmullRomCurve3: Geometry, TubeGeometry: Geometry,
  CircleGeometry: Geometry, TorusGeometry: Geometry
};
const ctx = { window: {} };
const file = path.join(__dirname, '..', 'scenario-world.js');
vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { filename:file });
function build() { return new ctx.window.DevilPetScenarioWorld(THREE, new Node()); }

test('cemetery is default, and scenery is exclusive', () => {
  const s = build();
  assert.equal(s.mode, 'cemetery');
  assert.equal(s.groundGroup.visible, false);
  assert.equal(s.airGroup.visible, false);
  s.setMode('ground');
  assert.equal(s.getTargets().length, 3);
  assert.equal(s.groundGroup.visible, true);
  assert.equal(s.airGroup.visible, false);
  s.setMode('air');
  assert.equal(s.getTargets().length, 4);
  assert.equal(s.airGroup.visible, true);
  assert.equal(s.groundGroup.visible, false);
  s.setMode('clean');
  assert.equal(s.getTargets().length, 0);
  assert.equal(s.airGroup.visible, false);
});

test('rolling ball crosses gate opening, but not its sides', () => {
  const s = build(); s.setMode('ground');
  let events = 0;
  s.observeBall({x:0,z:-9},{x:0,z:-7},()=>events++);
  assert.equal(s.ballCounts[0], 1);
  s.observeBall({x:4,z:-9},{x:4,z:-7},()=>events++);
  assert.equal(events, 1);
  s.observeBall({x:0,z:-7},{x:0,z:-9},()=>events++);
  assert.equal(events, 1); // hysteresis prevents flicker double-counting
  s.observeBall({x:0,z:-9},{x:0,z:-10},()=>{});
  s.observeBall({x:0,z:-10},{x:0,z:-7},()=>events++);
  assert.equal(events, 2);
});

test('ground arch uprights collide with ball', () => {
  const s = build(); s.setMode('ground');
  const b={x:2.04,z:-8,vx:-.15,vz:0};
  assert.equal(s.collideBall(b,.54), true);
  assert.ok(Number.isFinite(b.vx)&&Number.isFinite(b.vz));
  assert.ok(Math.hypot(b.x-2.05,b.z+8)>=.74-1e-5);
});

test('aerial passes require crossing the hoop plane within its opening', () => {
  const s = build(); s.setMode('air');
  s.observeFlight({x:-7.5,y:2,z:-6},{x:-7.5,y:2,z:-4});
  assert.equal(s.airCounts[0],1);
  s.observeFlight({x:8,y:2,z:-6},{x:8,y:2,z:-4});
  assert.equal(s.airCounts[0],1);
  s.observeFlight({x:0,y:2,z:-10},{x:0,y:4,z:-10});
  assert.equal(s.airCounts[3],1); // the horizontal hoop
});

test('clean arena has no invisible collisions or targets', () => {
  const s=build(); s.setMode('clean');
  assert.equal(s.collideBall({x:2,z:-8,vx:0,vz:0},.54),false);
  assert.deepEqual(Array.from(s.getTargets()),[]);
});

test('crossing counts persist independently of the neural engine', () => {
  const a=build(); a.setMode('ground');
  a.observeBall({x:0,z:-9},{x:0,z:-7});
  a.setMode('air');
  a.observeFlight({x:0,y:2,z:-10},{x:0,y:4,z:-10});
  const b=build();b.restore(a.snapshot());
  assert.equal(b.ballCounts[0],1);
  assert.equal(b.airCounts[3],1);
});

test('main inline game script remains syntactically valid', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const js=html.split('<script>').slice(1).map(t=>t.split('</script>')[0]);
  assert.ok(js.length>0);
  for(const code of js) assert.doesNotThrow(()=>new Function(code));
  assert.match(html,/scenarioStats:scenarioWorld\.snapshot\(\)/);
  assert.match(html,/activeTargets\(\)/);
});
