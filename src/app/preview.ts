// three.js preview of a design: board in the XY plane, tiles rising towards +Z,
// hung on a wall so the shadows read like the real thing.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Design, tileMesh, sectionWeb } from '../core/index';

export type View = 'iso' | 'front' | 'side' | 'room';
export type ShowMode = 'board' | 'backplate';

export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private board = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private wall: THREE.Mesh;
  private size = 500;
  private showSeams = true;
  private design?: Design;
  private highlighted = -1;
  private needsRender = true;
  private mode: ShowMode = 'board';
  private webCache = new Map<string, THREE.BufferGeometry>();

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#c9c6bf');
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 50000);
    this.camera.up.set(0, 1, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.needsRender = true));

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a8578', 0.9));
    this.sun = new THREE.DirectionalLight('#fff6e8', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.wall = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: '#d9d5cd', roughness: 0.95 }),
    );
    this.wall.receiveShadow = true;
    this.wall.position.z = -0.5;
    this.scene.add(this.wall, this.board);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.setLight(0.35);
    const loop = () => {
      this.controls.update();
      if (this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Light direction: 0 = from the left, 1 = from the right; always somewhat from above. */
  setLight(t: number) {
    const a = (-0.85 + 1.7 * t) * (Math.PI / 2);
    const d = this.size * 2;
    this.sun.position.set(Math.sin(a) * d, d * 0.9, Math.cos(a) * d * 0.8 + d * 0.2);
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    const s = this.size * 0.85;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 1;
    cam.far = d * 4;
    cam.updateProjectionMatrix();
    this.needsRender = true;
  }

  setSeams(on: boolean) {
    this.showSeams = on;
    if (this.design) this.update(this.design, false);
  }

  setView(v: View) {
    const s = this.size;
    const pos: Record<View, [number, number, number]> = {
      iso: [s * 0.95, s * 0.55, s * 1.95],
      front: [0, 0, s * 2.1],
      side: [s * 1.9, 0, s * 0.55],
      room: [s * 0.4, -s * 0.15, s * 3.2],
    };
    this.camera.position.set(...pos[v]);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.needsRender = true;
  }

  setMode(m: ShowMode) {
    this.mode = m;
    if (this.design) this.update(this.design, false);
  }

  /** Honeycomb (or solid) backplate section as an extruded mesh, cached per section. */
  private webGeometry(d: Design, sid: number): THREE.BufferGeometry {
    const p = d.params;
    const s = d.sections[sid];
    const key = JSON.stringify([s.poly, s.pins, s.keys, p.backplate, p.mount.type, p.mount.pinDiameter, p.mount.type === 'glue' ? s.tiles.map((id) => d.tiles[id].center) : 0]);
    const hit = this.webCache.get(key);
    if (hit) return hit;
    const shapes = sectionWeb(d, s).map((poly) => {
      const shape = new THREE.Shape(poly[0].map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of poly.slice(1)) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return shape;
    });
    const g = new THREE.ExtrudeGeometry(shapes, { depth: p.backplate.thickness, bevelEnabled: false, curveSegments: 1 });
    if (this.webCache.size > 400) this.webCache.clear();
    this.webCache.set(key, g);
    return g;
  }

  /** Highlight one colour (index) or none (-1). */
  highlight(color: number) {
    this.highlighted = color;
    if (this.design) this.update(this.design, false);
  }

  update(d: Design, refit = true) {
    this.design = d;
    for (const child of [...this.board.children]) {
      this.board.remove(child);
      child.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g && ![...this.webCache.values()].includes(g)) g.dispose();
      });
    }
    const p = d.params;
    const newSize = Math.max(p.width, p.height);
    const sizeChanged = Math.abs(newSize - this.size) > 1;
    this.size = newSize;
    this.wall.scale.set(newSize * 6, newSize * 6, 1);

    // Backplate sections. With tiles on top only the outline shows, so the
    // honeycomb is built only when the backplate is shown on its own.
    const onlyPlate = this.mode === 'backplate';
    // On its own the backplate gets a darker, cooler tone so the open cells read against the wall.
    const plateMat = new THREE.MeshStandardMaterial({ color: onlyPlate ? '#5f7f84' : '#e4e0d8', roughness: 0.8 });
    for (const s of d.sections) {
      let g: THREE.BufferGeometry;
      if (onlyPlate) {
        g = this.webGeometry(d, s.id);
      } else {
        const shape = new THREE.Shape(s.poly.map(([x, y]) => new THREE.Vector2(x, y)));
        g = new THREE.ExtrudeGeometry(shape, { depth: p.backplate.thickness, bevelEnabled: false });
      }
      const m = new THREE.Mesh(g, plateMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.board.add(m);
      if (this.showSeams && !onlyPlate) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(g, 30),
          new THREE.LineBasicMaterial({ color: '#8d877c' }),
        );
        this.board.add(edges);
      }
    }

    const z0 = p.backplate.thickness;
    if (onlyPlate) {
      // Seams as thin gaps are visible already; add the pins.
      if (p.mount.type === 'pressfit') {
        const pins = d.sections.flatMap((s) => s.pins);
        if (pins.length) {
          const pin = new THREE.CylinderGeometry(p.mount.pinDiameter / 2 - 0.25, p.mount.pinDiameter / 2, p.mount.pinHeight, 16);
          pin.rotateX(Math.PI / 2);
          pin.translate(0, 0, z0 + p.mount.pinHeight / 2);
          const inst = new THREE.InstancedMesh(pin, plateMat, pins.length);
          const mtx = new THREE.Matrix4();
          pins.forEach(([x, y], i) => inst.setMatrixAt(i, mtx.makeTranslation(x, y, 0)));
          inst.castShadow = true;
          this.board.add(inst);
        }
      }
      if (sizeChanged || refit) this.setLight(this.lightT);
      if (sizeChanged) this.setView('iso');
      this.needsRender = true;
      return;
    }

    // Tiles: one merged mesh per colour.
    const wall = p.tiles.wall;
    d.palette.forEach((hex, c) => {
      const pos: number[] = [];
      for (const t of d.tiles) {
        if (t.color !== c) continue;
        const { positions, faces } = tileMesh(t, wall);
        const [cx, cy] = t.center;
        // The mesh uses OpenSCAD winding (clockwise from outside); flip for three.js.
        for (const [a, b, e] of faces) {
          for (const k of [a, e, b]) {
            const q = positions[k];
            pos.push(q[0] + cx, q[1] + cy, q[2] + z0);
          }
        }
      }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const dim = this.highlighted >= 0 && this.highlighted !== c;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex),
        roughness: 0.55,
        metalness: 0,
        flatShading: true,
        transparent: dim,
        opacity: dim ? 0.18 : 1,
      });
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !dim;
      m.receiveShadow = true;
      this.board.add(m);
    });

    if (sizeChanged || refit) {
      this.setLight(this.lightT);
    }
    if (sizeChanged) this.setView('iso');
    this.needsRender = true;
  }

  private lightT = 0.35;
  setLightT(t: number) {
    this.lightT = t;
    this.setLight(t);
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
