/* DevilPet — selectable 3D training scenery. No neural weights, rewards, or motor commands here. */
(function (root) {
  'use strict';

  class DevilPetScenarioWorld {
    constructor(THREE, scene) {
      this.THREE = THREE;
      this.scene = scene;
      this.mode = 'cemetery';
      this.ballCounts = [0, 0, 0];
      this.airCounts = [0, 0, 0, 0];
      this.ballArmed = [true, true, true];
      this.airArmed = [true, true, true, true];

      this.groundArches = [-8, 0, 8].map((z, i) => ({
        x: 0, y: 1.65, z, width: 1.72, index: i,
        id: ['cyan', 'amber', 'red'][i],
        label: 'Arco ' + (i + 1), radius: 1.65, aerial: false, cueIdx: i
      }));
      this.airHoops = [
        { x: -7.5, y: 2.0, z: -5.0, horizontal: false },
        { x: 0, y: 3.2, z: 0, horizontal: false },
        { x: 7.5, y: 4.5, z: 5.0, horizontal: false },
        { x: 0, y: 3.5, z: -10.0, horizontal: true }
      ].map((h, i) => ({
        ...h, index: i, id: ['cyan', 'amber', 'red', 'sky'][i],
        label: 'Aro ' + (i + 1), radius: 1.65, aerial: true,
        cueIdx: [0, 1, 2, 4][i]
      }));

      this.groundGroup = new THREE.Group();
      this.airGroup = new THREE.Group();
      scene.add(this.groundGroup, this.airGroup);

      const archMaterial = new THREE.MeshStandardMaterial({
        color: 0x61bcf0, metalness: 0.44, roughness: 0.3,
        emissive: 0x18354f, emissiveIntensity: 0.28
      });
      const archMarkerMaterial = new THREE.MeshBasicMaterial({
        color: 0x3d6c91, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false
      });
      for (const arch of this.groundArches) {
        // Freestanding semicircular gates. The ball can roll under them.
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-2.05, 0, arch.z),
          new THREE.Vector3(-2.04, 0.9, arch.z),
          new THREE.Vector3(-1.68, 2.30, arch.z),
          new THREE.Vector3(-0.9, 3.08, arch.z),
          new THREE.Vector3(0, 3.32, arch.z),
          new THREE.Vector3(0.9, 3.08, arch.z),
          new THREE.Vector3(1.68, 2.30, arch.z),
          new THREE.Vector3(2.04, 0.9, arch.z),
          new THREE.Vector3(2.05, 0, arch.z)
        ], false, 'centripetal');
        const archMesh = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 48, 0.17, 10, false),
          archMaterial
        );
        archMesh.castShadow = true;
        this.groundGroup.add(archMesh);
        const marker = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), archMarkerMaterial);
        marker.rotation.x = -Math.PI / 2;
        marker.scale.y = 0.15;
        marker.position.set(0, 0.025, arch.z);
        this.groundGroup.add(marker);
      }

      const hoopMaterials = [0x6bd5f6, 0xf8a5dc, 0x9b91fa, 0xf5ce86].map(color =>
        new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.25,
          emissive: color, emissiveIntensity: 0.16 })
      );
      for (const hoop of this.airHoops) {
        const mesh = new THREE.Mesh(
          new THREE.TorusGeometry(2.0, 0.14, 12, 64),
          hoopMaterials[hoop.index]
        );
        if (hoop.horizontal) mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(hoop.x, hoop.y, hoop.z);
        mesh.castShadow = true;
        this.airGroup.add(mesh);
      }
      this.setMode('cemetery');
    }

    setMode(mode) {
      if (!['cemetery', 'maze', 'ground', 'air', 'clean'].includes(mode)) mode = 'cemetery';
      this.mode = mode;
      this.groundGroup.visible = mode === 'ground';
      this.airGroup.visible = mode === 'air';
      this.ballArmed.fill(true);
      this.airArmed.fill(true);
      return mode;
    }

    getTargets() {
      return this.mode === 'ground' ? this.groundArches
        : this.mode === 'air' ? this.airHoops : [];
    }

    // Solid footings: the rolling ball cannot clip through an arch's uprights.
    collideBall(ball, radius) {
      if (this.mode !== 'ground') return false;
      let hit = false;
      for (const arch of this.groundArches) {
        for (const side of [-1, 1]) {
          const x = side * 2.05, z = arch.z;
          const dx = ball.x - x, dz = ball.z - z;
          const dist = Math.hypot(dx, dz);
          const minDist = radius + 0.20;
          if (dist >= minDist) continue;
          const nx = dist > 1e-7 ? dx / dist : side;
          const nz = dist > 1e-7 ? dz / dist : 0;
          ball.x = x + nx * minDist;
          ball.z = z + nz * minDist;
          const speedTowardPost = ball.vx * nx + ball.vz * nz;
          if (speedTowardPost < 0) {
            ball.vx -= 1.7 * speedTowardPost * nx;
            ball.vz -= 1.7 * speedTowardPost * nz;
          }
          hit = true;
        }
      }
      return hit;
    }

    // Geometry checks only: no automatic neural reinforcement or waypoint seeking.
    observeBall(previous, current, onPass) {
      if (this.mode !== 'ground') return;
      for (const arch of this.groundArches) {
        const i = arch.index;
        const d0 = previous.z - arch.z, d1 = current.z - arch.z;
        if (Math.abs(d1) > 1.15) this.ballArmed[i] = true;
        if (!this.ballArmed[i] || d0 * d1 >= 0 || Math.abs(d0 - d1) < 1e-8) continue;
        const t = -d0 / (d1 - d0);
        const x = previous.x + (current.x - previous.x) * t;
        if (Math.abs(x - arch.x) <= arch.width - 0.54) {
          this.ballArmed[i] = false;
          this.ballCounts[i]++;
          if (typeof onPass === 'function') onPass(arch, this.ballCounts[i]);
        }
      }
    }

    observeFlight(previous, current, onPass) {
      if (this.mode !== 'air') return;
      for (const hoop of this.airHoops) {
        const i = hoop.index;
        const axis = hoop.horizontal ? 'y' : 'z';
        const plane = hoop[axis];
        const d0 = previous[axis] - plane;
        const d1 = current[axis] - plane;
        if (Math.abs(d1) > 1.0) this.airArmed[i] = true;
        if (!this.airArmed[i] || d0 * d1 >= 0 || Math.abs(d0 - d1) < 1e-8) continue;
        const t = -d0 / (d1 - d0);
        const x = previous.x + (current.x - previous.x) * t;
        const y = previous.y + (current.y - previous.y) * t;
        const z = previous.z + (current.z - previous.z) * t;
        const radialDistance = hoop.horizontal
          ? Math.hypot(x - hoop.x, z - hoop.z)
          : Math.hypot(x - hoop.x, y - hoop.y);
        if (radialDistance < hoop.radius) {
          this.airArmed[i] = false;
          this.airCounts[i]++;
          if (typeof onPass === 'function') onPass(hoop, this.airCounts[i]);
        }
      }
    }

    snapshot() {
      return {ballCounts: this.ballCounts.slice(), airCounts: this.airCounts.slice()};
    }

    restore(data) {
      if (!data || typeof data !== 'object') return;
      for (const [key, count] of [['ballCounts', 3], ['airCounts', 4]]) {
        if (Array.isArray(data[key]) && data[key].length === count) {
          this[key] = data[key].map(v => Number.isSafeInteger(v) && v >= 0 ? v : 0);
        }
      }
    }

    summary() {
      if (this.mode === 'ground') return 'Arcos atravessados pela bolinha: ' + this.ballCounts.join(' / ');
      if (this.mode === 'air') return 'Aros atravessados em voo: ' + this.airCounts.join(' / ');
      if (this.mode === 'clean') return 'Arena vazia: somente a mosca e seus sensores, sem alvos físicos.';
      return 'Treino livre; nenhuma passagem recompensa automaticamente a mosca.';
    }
  }

  root.DevilPetScenarioWorld = DevilPetScenarioWorld;
})(window);
