/* Shaped parts for the V8: crank webs, I-beam rods, lathe-turned pistons, cam lobes, springs. */
import * as THREE from 'three';
import { RAD, V3, canvasTex } from '../../framework/three/geometry';

/** Maps a 2D shape (X, Y) onto the y-z plane (X → y, Y → z) with the extrusion along x. */
const TO_YZ = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);

function extrudeYZ(sh: THREE.Shape, depth: number, bevel = 0.18, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(depth - 2 * bevel, 0.01),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return g.applyMatrix4(TO_YZ);
}

/**
 * Crank web: a counterweight sector opposite the pin, blended into a round boss around the
 * crankpin. `a` = pin angle in the y-z plane (from +y towards +z).
 */
export function webGeo(a: number, r: number, boss: number, cw: number, half: number, thick: number) {
  const sh = new THREE.Shape(),
    N = 30,
    cy = r * Math.cos(a),
    cz = r * Math.sin(a);
  for (let i = 0; i <= N; i++) {
    const t = a + Math.PI - half + (2 * half * i) / N,
      // slightly flattened ends read as a forged counterweight rather than a pie slice
      rr = cw * (1 - 0.06 * Math.pow(Math.abs((2 * i) / N - 1), 6));
    if (i) sh.lineTo(rr * Math.cos(t), rr * Math.sin(t));
    else sh.moveTo(rr * Math.cos(t), rr * Math.sin(t));
  }
  for (let i = 0; i <= N; i++) {
    const t = a - Math.PI / 2 + (Math.PI * i) / N;
    sh.lineTo(cy + boss * Math.cos(t), cz + boss * Math.sin(t));
  }
  sh.closePath();
  return extrudeYZ(sh, thick, 0.2);
}

/** Two-piece rod outline (big eye at -len/2, small eye at +len/2) along local y, thickness along x. */
export function rodGeo(len: number, big: number, small: number, pinR: number, gudR: number, thick: number) {
  const sh = new THREE.Shape(),
    N = 36,
    b0 = -len / 2,
    s0 = len / 2;
  // shape X = along the rod (→ y), shape Y = across (→ z)
  for (let i = 0; i <= N; i++) {
    const t = 0.36 * Math.PI + (1.28 * Math.PI * i) / N;
    const x = b0 + big * Math.cos(t),
      y = big * Math.sin(t);
    if (i) sh.lineTo(x, y);
    else sh.moveTo(x, y);
  }
  // waisted shank: a gentle curve into the small end
  sh.quadraticCurveTo(0, -1.0, s0 - small * 0.2, -small);
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / N;
    sh.lineTo(s0 + small * Math.cos(t), small * Math.sin(t));
  }
  sh.quadraticCurveTo(0, 1.0, b0 + big * Math.cos(0.36 * Math.PI), big * Math.sin(0.36 * Math.PI));
  const hole = (cx: number, r: number) => {
    const p = new THREE.Path();
    p.absarc(cx, 0, r, 0, Math.PI * 2, true);
    return p;
  };
  sh.holes.push(hole(b0, pinR), hole(s0, gudR));
  return extrudeYZ(sh, thick, 0.15, 16);
}

/** Piston body turned on a lathe around local z (crown at +crown, skirt down to -skirt). */
export function pistonGeo(r: number, crown: number, skirt: number) {
  const pts = [
    [0, crown + 0.05],
    [r * 0.55, crown + 0.02],
    [r * 0.88, crown - 0.08],
    [r - 0.05, crown - 0.22],
    [r, crown - 0.35],
    [r, -skirt * 0.2],
    [r - 0.06, -skirt],
    [r - 0.42, -skirt],
    [r - 0.42, crown - 1.2],
    [0, crown - 1.2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 48).rotateX(Math.PI / 2);
}

/** Cam lobe: base circle + flank, extruded along x, nose at angle 0. */
export function lobeGeo(base: number, liftAmt: number, width: number) {
  const sh = new THREE.Shape(),
    N = 96;
  for (let i = 0; i <= N; i++) {
    const psi = (i / N) * Math.PI * 2 - Math.PI,
      half = 57.5 * RAD,
      f = Math.abs(psi) < half ? Math.pow(Math.cos(((Math.PI / 2) * psi) / half), 1.6) : 0;
    const rr = base + liftAmt * f,
      x = rr * Math.cos(psi),
      y = rr * Math.sin(psi);
    if (i) sh.lineTo(x, y);
    else sh.moveTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, curveSegments: 4 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

export function springGeo(r: number, len: number, turns: number, wire: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120,
      a = t * Math.PI * 2 * turns;
    pts.push(V3(r * Math.cos(a), r * Math.sin(a), t * len));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, wire, 6);
}

/** Compressor wheel: hub + swept blades around +x (inducer facing -x). */
export function compressorWheel(r: number, mat: THREE.Material) {
  const g = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, r * 0.45, 1.4, 20).rotateZ(Math.PI / 2), mat);
  g.add(hub);
  const blade = new THREE.BoxGeometry(1.3, r - 0.35, 0.08).translate(0, (r - 0.35) / 2 + 0.3, 0);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(blade, mat);
    m.rotation.x = (i / 12) * Math.PI * 2;
    m.rotateY(0.45); // blade sweep
    g.add(m);
  }
  return g;
}

/** Carbon-fibre twill. */
export function carbonTex() {
  return canvasTex(
    128,
    128,
    (x, w) => {
      const n = 8,
        cs = w / n;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const hor = (i + j) % 4 < 2,
            g = hor
              ? x.createLinearGradient(0, j * cs, 0, j * cs + cs)
              : x.createLinearGradient(i * cs, 0, i * cs + cs, 0);
          g.addColorStop(0, '#141518');
          g.addColorStop(0.5, hor ? '#3a3d43' : '#2b2e33');
          g.addColorStop(1, '#141518');
          x.fillStyle = g;
          x.fillRect(i * cs, j * cs, cs, cs);
        }
    },
    [0.45, 0.45],
  );
}

/** Intercooler / radiator core: fine vertical fins with darker tube rows. */
export function finTex() {
  return canvasTex(
    128,
    128,
    (x, w, h) => {
      x.fillStyle = '#4a4f54';
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 3) {
        x.fillStyle = i % 6 ? '#8d9398' : '#6c7277';
        x.fillRect(i, 0, 1, h);
      }
      x.fillStyle = 'rgba(20,22,25,.85)';
      for (let j = 0; j < h; j += 16) x.fillRect(0, j, w, 4);
    },
    [3, 2],
  );
}

/** Perforated heat-shield look. */
export function perfTex() {
  return canvasTex(
    64,
    64,
    (x, w, h) => {
      x.fillStyle = '#c8ccd0';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#5b6064';
      for (let j = 0; j < h; j += 8)
        for (let i = (j / 8) % 2 ? 4 : 0; i < w; i += 8) {
          x.beginPath();
          x.arc(i + 2, j + 2, 1.6, 0, Math.PI * 2);
          x.fill();
        }
    },
    [4, 2],
  );
}
