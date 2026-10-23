/*
 * Cutaway / assembled / X-ray handling for a fixed structure (housings, blocks, covers).
 *
 * Section view: the registered "static" materials get the clipping planes (intersection =
 * only the region inside all planes is removed), and each housing gets a back-face twin in a
 * flat red material so the cut surface reads as solid metal instead of a hollow shell.
 */
import * as THREE from 'three';

export type SectionMode = 'cut' | 'solid' | 'xray';

export class SectionView {
  readonly planes: THREE.Plane[];
  readonly backMaterial: THREE.MeshStandardMaterial;
  private statics: THREE.Material[] = [];
  private backs: THREE.Object3D[] = [];

  constructor(planes: THREE.Plane[], color = 0x8a1c15) {
    this.planes = planes;
    this.backMaterial = new THREE.MeshStandardMaterial({
      color,
      metalness: 0,
      roughness: 0.85,
      envMapIntensity: 0.25,
      side: THREE.BackSide,
      clippingPlanes: planes,
      clipIntersection: true,
    });
  }

  /** Registers a material of the fixed structure: it is clipped in section mode and fades in X-ray. */
  material<M extends THREE.Material>(m: M): M {
    m.clipIntersection = true;
    this.statics.push(m);
    return m;
  }

  /** Adds a red back-face twin that shows the cut surface. */
  addBack(parent: THREE.Object3D, mesh: THREE.Mesh) {
    const r = new THREE.Mesh(mesh.geometry, this.backMaterial);
    r.position.copy(mesh.position);
    r.rotation.copy(mesh.rotation);
    parent.add(r);
    this.backs.push(r);
    return r;
  }

  /** Static housing mesh, optionally with its section back face. */
  housing(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    cut = true,
  ) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    if (cut) this.addBack(parent, m);
    return m;
  }

  apply(mode: SectionMode, xrayOpacity = 0.12) {
    for (const mat of this.statics) {
      mat.clippingPlanes = mode === 'cut' ? this.planes : null;
      const x = mode === 'xray';
      mat.transparent = x;
      mat.opacity = x ? xrayOpacity : 1;
      mat.depthWrite = !x;
      mat.needsUpdate = true;
    }
    for (const b of this.backs) b.visible = mode === 'cut';
  }
}
