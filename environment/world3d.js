/* DevilPet environment: 3-D renderer/camera/lighting only.
 * Contains NO neuron, synapse, reinforcement, sensation or pet intelligence.
 * Ambient props are assembled independently by the game. */
(function(root){
  'use strict';
  function create({THREE,viewport}){
    if(!THREE||!viewport)throw new TypeError('Three.js and viewport required');
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x0b0918);
    scene.fog=new THREE.FogExp2(0x130e20,0.012);
    const camera=new THREE.PerspectiveCamera(46,1,0.1,180);
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(root.devicePixelRatio||1,2));
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    viewport.appendChild(renderer.domElement);
    const hemiLight=new THREE.HemisphereLight(0x9c9edc,0x1c1724,0.87);
    scene.add(hemiLight);
    const keyLight=new THREE.DirectionalLight(0xb8b5ed,1.15);
    keyLight.position.set(14,26,13);
    keyLight.castShadow=true;
    keyLight.shadow.mapSize.width=1024;
    keyLight.shadow.mapSize.height=1024;
    keyLight.shadow.camera.near=2;
    keyLight.shadow.camera.far=65;
    keyLight.shadow.camera.left=-19;
    keyLight.shadow.camera.right=19;
    keyLight.shadow.camera.top=19;
    keyLight.shadow.camera.bottom=-19;
    scene.add(keyLight);
    const rimLight=new THREE.PointLight(0x9c75e8,1.2,32);
    rimLight.position.set(-9,7,-8);
    scene.add(rimLight);
    function updateCamera({mode,yaw,pitch,distance,fly}){
      if(mode==='orbit'||mode==='far'){
        const cx=Math.cos(yaw)*Math.cos(pitch)*distance;
        const cy=Math.sin(pitch)*distance;
        const cz=Math.sin(yaw)*Math.cos(pitch)*distance;
        camera.position.lerp(new THREE.Vector3(cx,cy,cz),0.14);
        camera.lookAt(0,0.35,0);
      }else if(mode==='top'){
        camera.position.lerp(new THREE.Vector3(0,Math.max(22,distance),0.1),0.12);
        camera.lookAt(0,0,0);
      }else{
        const tx=fly.x-Math.cos(fly.angle)*5.4;
        const tz=fly.z-Math.sin(fly.angle)*5.4;
        camera.position.lerp(new THREE.Vector3(tx,fly.y+2.8,tz),0.1);
        camera.lookAt(fly.x,fly.y+0.5,fly.z);
      }
    }
    function resize(){
      const w=viewport.clientWidth;
      const h=viewport.clientHeight;
      camera.aspect=w/Math.max(1,h);
      camera.updateProjectionMatrix();
      renderer.setSize(w,h);
    }
    function render(){renderer.render(scene,camera);}
    function dispose(){renderer.dispose();}
    return Object.freeze({
      scene,camera,renderer,hemiLight,keyLight,rimLight,
      updateCamera,resize,render,dispose
    });
  }
  const api=Object.freeze({create});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DevilPetWorld3D=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
