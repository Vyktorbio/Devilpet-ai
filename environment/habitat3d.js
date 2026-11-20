/* Static 3D habitat geometry, separated from the fly, neurons and sensors.
 * Coordinates and meshes stay identical to the old monolithic scene.
 */
(function(root){
  'use strict';
  function create({THREE,scene,ARENA_RADIUS,makeFloorTexture}){
const floorTex = makeFloorTexture();
floorTex.repeat.set(1.5,1.5);
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(ARENA_RADIUS * 2, 0.7, ARENA_RADIUS * 2),
  new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.88, metalness: 0.06 })
);
floor.position.y = -0.35;
floor.receiveShadow = true;
scene.add(floor);
const boundaryMaterial = new THREE.MeshStandardMaterial({ color: 0x3b3545, roughness: 0.88 });
for (const sign of [-1,1]) {
  const xWall = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.8, ARENA_RADIUS * 2), boundaryMaterial);
  xWall.position.set(sign * ARENA_RADIUS, 0.15, 0); xWall.castShadow = true; scene.add(xWall);
  const zWall = new THREE.Mesh(new THREE.BoxGeometry(ARENA_RADIUS * 2, 0.8, 0.44), boundaryMaterial);
  zWall.position.set(0, 0.15, sign * ARENA_RADIUS); zWall.castShadow = true; scene.add(zWall);
}
// Naturalistic undergrowth: inexpensive instanced vegetation around the rim.
const groundCover = new THREE.Group();
scene.add(groundCover);
const sprigMat = new THREE.MeshStandardMaterial({color:0x4b8b4a,roughness:0.95,side:THREE.DoubleSide});
const sprigGeo = new THREE.ConeGeometry(0.16,0.75,4);
for(let i=0;i<110;i++){
  const a=i*2.399963229728653;
  const radius=10.4+5.2*Math.sqrt((i+0.5)/110);
  const x=Math.cos(a)*radius,z=Math.sin(a)*radius;
  const sprig=new THREE.Mesh(sprigGeo,sprigMat);
  sprig.position.set(x,0.30,z);
  sprig.rotation.z=Math.sin(i*3.7)*0.23;
  sprig.scale.setScalar(0.55+(i%7)*0.095);
  groundCover.add(sprig);
}
const soilRing=new THREE.Mesh(new THREE.PlaneGeometry(34,34),
  new THREE.MeshBasicMaterial({color:0x527e39,transparent:true,opacity:0.14,side:THREE.DoubleSide}));
soilRing.rotation.x=-Math.PI/2;soilRing.position.y=0.025;scene.add(soilRing);

// Three gothic chapel pinnacles replace the botanical perches.
// Keep the same perch coordinates, heights and radii, so the neural and
// locomotion behavior can be compared without changing the sensory model.
const PERCHES = [
  { id: 'leaf1', label: 'Pináculo da Capela Baixa', x: -9.8, y: 2.3, z: 5.8, radius: 1.55 },
  { id: 'leaf2', label: 'Pináculo da Capela Média', x: 10.2, y: 3.6, z: 5.0, radius: 1.55 },
  { id: 'leaf3', label: 'Pináculo da Capela Alta', x: -1.8, y: 5.2, z: -9.6, radius: 1.50 }
];
const chapelStone = new THREE.MeshStandardMaterial({color:0x55505e,roughness:.92});
const chapelTrim = new THREE.MeshStandardMaterial({color:0x777081,roughness:.86});
const chapelShadow = new THREE.MeshStandardMaterial({color:0x211e2b,roughness:.99});
function addChapelPinnacle(p){
  const g=new THREE.Group();g.position.set(p.x,0,p.z);
  // Tower reaches the old leaf's landing height; the tip rises beside it.
  const tower=new THREE.Mesh(new THREE.BoxGeometry(1.6,p.y-.12,1.6),chapelStone);
  tower.position.y=(p.y-.12)/2;tower.castShadow=true;tower.receiveShadow=true;g.add(tower);
  const footing=new THREE.Mesh(new THREE.BoxGeometry(2.0,.24,2.0),chapelTrim);
  footing.position.y=.12;g.add(footing);
  const landing=new THREE.Mesh(new THREE.BoxGeometry(2.12,.18,2.12),chapelTrim);
  landing.position.y=p.y-.09;landing.receiveShadow=true;g.add(landing);
  // Narrow gargoyle-like gothic spire at the rear, leaving an open place to land.
  const backing=new THREE.Mesh(new THREE.BoxGeometry(.55,.9,.5),chapelStone);
  backing.position.set(0,p.y+.37,-.68);backing.castShadow=true;g.add(backing);
  const point=new THREE.Mesh(new THREE.ConeGeometry(.46,1.22,4),chapelTrim);
  point.rotation.y=Math.PI/4;point.position.set(0,p.y+1.40,-.68);
  point.castShadow=true;g.add(point);
  for(const side of [-1,1]){
    const finial=new THREE.Mesh(new THREE.ConeGeometry(.17,.48,4),chapelTrim);
    finial.rotation.y=Math.PI/4;finial.position.set(side*.85,p.y+.21,-.82);g.add(finial);
  }
  // Arched dark opening and a carved cross on the facade.
  const arch=new THREE.Mesh(new THREE.BoxGeometry(.36,.65,.025),chapelShadow);
  arch.position.set(0,p.y*.58,.817);g.add(arch);
  const archPoint=new THREE.Mesh(new THREE.ConeGeometry(.25,.27,3),chapelShadow);
  archPoint.rotation.z=Math.PI;archPoint.position.set(0,p.y*.58+.44,.83);g.add(archPoint);
  const upright=new THREE.Mesh(new THREE.BoxGeometry(.09,.52,.055),chapelTrim);
  upright.position.set(0,p.y*.36,.85);g.add(upright);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(.32,.08,.055),chapelTrim);
  arm.position.set(0,p.y*.36+.08,.85);g.add(arm);
  scene.add(g);
}
PERCHES.forEach(addChapelPinnacle);

// Old graveyard: decorative only, never added to collision or sensory systems.
// Rows are outside the original central experiment and do not change the brain.
const graveyard = new THREE.Group();
scene.add(graveyard);
const graveStoneMats = [
  new THREE.MeshStandardMaterial({color:0x65636b,roughness:0.96}),
  new THREE.MeshStandardMaterial({color:0x4d5059,roughness:0.98}),
  new THREE.MeshStandardMaterial({color:0x77717a,roughness:0.93})
];
const graveBaseGeo = new THREE.BoxGeometry(1.35,0.20,0.78);
const graveBodyGeo = new THREE.BoxGeometry(1.03,1.28,0.29);
const graveCrownGeo = new THREE.SphereGeometry(0.52,10,6,0,Math.PI,0,Math.PI/2);
const graveCrossStemGeo = new THREE.BoxGeometry(0.18,1.60,0.21);
const graveCrossArmGeo = new THREE.BoxGeometry(0.76,0.17,0.21);
const burialPositions = [];
for (const flank of [-1,1]) {
  for (let row=0;row<3;row++) {
    for (let col=0;col<7;col++) {
      const x=flank*(13.1+row*3.4);
      const z=-18.4+col*6.0+(row%2)*0.65;
      if (Math.abs(z)<3.5 && row===0) continue;
      burialPositions.push([x,z]);
    }
  }
}
burialPositions.forEach(([x,z],i)=>{
  const m=graveStoneMats[i%graveStoneMats.length];
  const g=new THREE.Group();
  const size=0.79+(i%5)*0.085;
  g.position.set(x,0,z);
  g.rotation.y=((i%7)-3)*0.045;
  g.rotation.z=((i%9)-4)*0.018;
  g.scale.setScalar(size);
  const base=new THREE.Mesh(graveBaseGeo,m);
  base.position.y=0.10;base.receiveShadow=true;g.add(base);
  if(i%6===0){
    const stem=new THREE.Mesh(graveCrossStemGeo,m);
    stem.position.y=0.95;stem.castShadow=true;g.add(stem);
    const arm=new THREE.Mesh(graveCrossArmGeo,m);
    arm.position.y=1.28;arm.castShadow=true;g.add(arm);
  }else{
    const body=new THREE.Mesh(graveBodyGeo,m);
    body.position.y=0.79;body.castShadow=true;body.receiveShadow=true;g.add(body);
    const crown=new THREE.Mesh(graveCrownGeo,m);
    crown.position.y=1.42;crown.scale.z=0.31;crown.castShadow=true;g.add(crown);
    if(i%4===0) {
      const inset=new THREE.Mesh(new THREE.BoxGeometry(0.50,0.035,0.035),
        new THREE.MeshStandardMaterial({color:0x24232a,roughness:1}));
      inset.position.set(0,0.95,0.165);g.add(inset);
    }
  }
  graveyard.add(g);
});


// 3D Translucent Acrylic Maze Walls (walk around corridors OR fly over y > 2.6!)
const mazeGroup = new THREE.Group();
scene.add(mazeGroup);

const MAZE_WALLS = [
  // Central T-divider creating left/right choice corridors
  { x:  0.0, z: -3.2, w: 0.45, d: 6.4, h: 2.5 },
  // Front corridor gates flanking the Red zone
  { x: -4.8, z:  3.2, w: 5.2,  d: 0.45, h: 2.5 },
  { x:  4.8, z:  3.2, w: 5.2,  d: 0.45, h: 2.5 },
  // Outer baffles around Cyan & Amber chambers
  { x:  7.8, z: -2.2, w: 0.45, d: 5.2, h: 2.5 },
  { x: -7.8, z: -2.2, w: 0.45, d: 5.2, h: 2.5 },
  // North chicane bar
  { x:  0.0, z: -8.2, w: 6.8,  d: 0.45, h: 2.5 }
];

const mazeMat = new THREE.MeshPhysicalMaterial({
  color: 0x60a5fa, emissive: 0x1e3a8a, emissiveIntensity: 0.18,
  transparent: true, opacity: 0.34, roughness: 0.15, metalness: 0.1
});
const mazeTopMat = new THREE.MeshStandardMaterial({ color: 0x93c5fd, emissive: 0x3b82f6, emissiveIntensity: 0.35, roughness: 0.3 });

for (const w of MAZE_WALLS) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), mazeMat);
  wall.position.set(w.x, w.h / 2, w.z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  mazeGroup.add(wall);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.04, 0.08, w.d + 0.04), mazeTopMat);
  cap.position.set(w.x, w.h + 0.04, w.z);
  mazeGroup.add(cap);
}

// Decorative Terrarium Moss Rocks around perimeter
const rockMat = new THREE.MeshStandardMaterial({ color: 0x2c3633, roughness: 0.92 });
const mossMat = new THREE.MeshStandardMaterial({ color: 0x2a523c, roughness: 0.95 });
const rockPositions = [
  [-12.8, 0.4, 7.2, 1.4], [12.4, 0.35, 8.1, 1.2], [-11.8, 0.38, -8.8, 1.25], [12.5, 0.32, -7.8, 1.1]
];
for (const [rx, ry, rz, sc] of rockPositions) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 1), rockMat);
  rock.scale.set(1.2, 0.65, 1.0);
  rock.position.set(rx, ry, rz);
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);

  const moss = new THREE.Mesh(new THREE.SphereGeometry(sc * 0.55, 10, 8), mossMat);
  moss.scale.set(1.3, 0.45, 1.1);
  moss.position.set(rx + 0.2, ry + sc * 0.32, rz);
  scene.add(moss);
}

// Floating Ambient Dust Motes
const dustCount = 90;
const dustGeo = new THREE.BufferGeometry();
const dustCoords = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * 9.8;
  dustCoords[i * 3] = Math.cos(a) * r;
  dustCoords[i * 3 + 1] = 0.6 + Math.random() * 4.5;
  dustCoords[i * 3 + 2] = Math.sin(a) * r;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustCoords, 3));
const dustPoints = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({ color: 0xcbe4ff, size: 0.08, transparent: true, opacity: 0.35 })
);
scene.add(dustPoints);

// Habitat sensory adapter: physical food patches and the existing high chapel.
// The neural engine remains unchanged: its five input slots are mapped to world cues.
// No colored training rings or hidden targets are rendered.
const ZONES = [
  {id:'cyan',label:'Carne da entrada',x:-7.2,y:0,z:-4.7,radius:1.55,aerial:false,cueIdx:0},
  {id:'amber',label:'Carne da ala oeste',x:7.4,y:0,z:-5.8,radius:1.55,aerial:false,cueIdx:1},
  {id:'red',label:'Carne da ala leste',x:5.6,y:0,z:8.2,radius:1.55,aerial:false,cueIdx:2},
  {id:'sky',label:'Mausoléu alto',x:-1.8,y:5.2,z:-9.6,radius:1.50,aerial:true,cueIdx:4}
];


    return Object.freeze({PERCHES,mazeGroup,MAZE_WALLS,ZONES});
  }
  const api=Object.freeze({create});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DevilPetHabitat3D=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
