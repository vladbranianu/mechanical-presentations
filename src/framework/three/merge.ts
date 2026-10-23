/*
 * Draw-call reduction: collapses the static meshes under a group into one mesh per
 * (material, part id). Run once after building, before the first render.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ATTRS = ['position', 'normal', 'uv'] as const;

/**
 * Children for which `skip(o)` is true (moving sub-assemblies, toggled helpers) are left alone
 * together with their whole subtree. `pickables` is updated in place.
 */
export function mergeStatic(group: THREE.Object3D, pickables: THREE.Object3D[], skip: (o: THREE.Object3D) => boolean) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; part?: string; meshes: THREE.Mesh[] }>();
  const collect = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (skip(c) || !c.visible) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && !c.children.length) {
        const g = m.geometry;
        if (ATTRS.every((a) => g.getAttribute(a))) {
          const key = m.material.uuid + '|' + (c.userData.part ?? '') + '|' + c.renderOrder;
          let b = buckets.get(key);
          if (!b) buckets.set(key, (b = { mat: m.material, part: c.userData.part, meshes: [] }));
          b.meshes.push(m);
          continue;
        }
      }
      collect(c);
    }
  };
  collect(group);

  const rel = new THREE.Matrix4();
  const dropped = new Set<THREE.Object3D>();
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const geos = b.meshes.map((m) => {
      rel.multiplyMatrices(inv, m.matrixWorld);
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!(ATTRS as readonly string[]).includes(name)) g.deleteAttribute(name);
      g.morphAttributes = {};
      g = g.applyMatrix4(rel);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.meshes.some((m) => m.castShadow);
    mesh.receiveShadow = b.meshes.some((m) => m.receiveShadow);
    mesh.renderOrder = b.meshes[0].renderOrder;
    if (b.part) mesh.userData.part = b.part;
    group.add(mesh);
    b.meshes.forEach((m) => {
      m.removeFromParent();
      dropped.add(m);
    });
    if (b.part) pickables.push(mesh);
  }
  if (dropped.size) {
    const keep = pickables.filter((p) => !dropped.has(p));
    pickables.length = 0;
    pickables.push(...keep);
  }
}
