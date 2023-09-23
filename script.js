console.clear();
import * as THREE from "https://cdn.skypack.dev/three@0.131";
import { OrbitControls } from "https://cdn.skypack.dev/three@0.131/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.131/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'https://cdn.skypack.dev/three@0.131/examples/jsm/math/MeshSurfaceSampler.js';

let model;
let scene = new THREE.Scene();
let camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(15, 15, 15);
camera.lookAt(scene.position);
let renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
renderer.setClearColor(0x600080, 0.5);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

let controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 15, 0);
controls.enablePan = false;
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed *= 0.5;
controls.maxDistance = 35;
controls.update();

var light = new THREE.DirectionalLight(0xffffff, 1);
light.position.setScalar(10);
scene.add(light);
scene.add(new THREE.DirectionalLight(0xffffff, 0.5));

let uniforms = {
  time: {value: 0},
  cameraPosition: {value: new THREE.Vector3()}
}

var loader = new GLTFLoader();
loader.load( "https://threejs.org/examples/models/gltf/Nefertiti/Nefertiti.glb", function ( gltf ) {

  model = gltf.scene.children[0];
  //console.log(model.geometry)
  //model.geometry.computeVertexNormals();
  
  let sampler = new MeshSurfaceSampler( model )
					.setWeightAttribute( null )
					.build();
  //console.log(sampler);
  let v = new THREE.Vector3();
  let n = new THREE.Vector3();
  let colors = [];
  let sizes = [];
  let normals = [];
  let pts = new Array(300000).fill(0).map(p => { 
    sizes.push(0.1);
    colors.push(0, 0.5, 1); 
    sampler.sample(v, n); 
    normals.push(n.x, n.y, n.z);
    return v.clone()
  });
  let pos = model.geometry.attributes.position;
  new Array(pos.count).fill(0).forEach((p, idx) => {
    sizes.push(0.15);
    colors.push(0.5, 1, 1);
    n.fromBufferAttribute(model.geometry.attributes.normal, idx);
    normals.push(n.x, n.y, n.z);
    pts.push(new THREE.Vector3().fromBufferAttribute(pos, idx));
  });
  //console.log(pts.length, sizes.length, colors.length / 3);
  let pg = new THREE.BufferGeometry().setFromPoints(pts);
  pg.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  pg.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  pg.setAttribute("sizes", new THREE.Float32BufferAttribute(sizes, 1));

  let points = new THREE.Points(
    pg, 
    new THREE.PointsMaterial({
      vertexColors: true,
      onBeforeCompile: shader => {
        shader.uniforms.time = uniforms.time;
        shader.uniforms.cameraPosition = uniforms.cameraPosition;
        shader.vertexShader = `
          uniform float time;
          attribute float sizes;
          varying vec3 vPos;
          varying vec3 vNor;
          varying float nShade;
          
          float hash(vec2 co){
            float t = 12.9898*co.x + 78.233*co.y; 
            return fract((t) * sin(t));
          }
          ${shader.vertexShader}
        `.replace(
          `gl_PointSize = size;`,
          `gl_PointSize = size * sizes;
            
            vec3 n1 = normalize(normalMatrix * normal);
            vec3 n2 = normalize(normalMatrix * normalize(position - cameraPosition));
            nShade = dot( n1, n2);
          `
        ).replace(
          `#include <begin_vertex>`,
          `#include <begin_vertex>
            
            vec3 initPhase = vec3(hash(position.xy), hash(position.xz), hash(position.yz)) * PI * 2.;
            float amp = hash(vec2(position.x, position.y + position.z)) * 0.15;
            vec3 tr = initPhase + time * 2.;
            transformed += vec3(cos(tr.x), sin(tr.y), cos(tr.z)) * amp;
            
            // glitch
            float gt = time * 0.1;
            vec3 glitchIdx = floor(transformed / vec3(2.)) + floor(gt);
            
            vec3 glitchDir = vec3(hash(glitchIdx.xy), hash(glitchIdx.xz) * 0.5, hash(glitchIdx.yz));
            glitchDir.xz -= 0.5;
            glitchDir *= 5.;
            float glitchShift = sin(gt * PI * 2. - PI * 0.5) * 0.5 + 0.5;
            glitchDir *=  smoothstep(0.55, 0.95, glitchShift);
            transformed += glitchDir;
            
                        
            vPos = transformed;
            vNor = normal;
          `
        );
        console.log(shader.vertexShader)
        shader.fragmentShader = `
          uniform float time;
          varying vec3 vPos;
          varying vec3 vNor;
          varying float nShade;
          ${shader.fragmentShader}
        `.replace(
          `#include <clipping_planes_fragment>`,
          `
          if(length(gl_PointCoord - 0.5) > 0.5) discard; // make'em round
          #include <clipping_planes_fragment>`
        ).replace(
          `#include <premultiplied_alpha_fragment>`,
          `#include <premultiplied_alpha_fragment>
                        
            float strokes = sin((vPos.y - time) * PI * PI) * 0.5 + 0.5;
            strokes = smoothstep(0.9, 1.0, strokes) * 0.5;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.875, 1, 1), strokes);
            
            vec3 light = vec3(0.1, 0.5, 0.7);
            float shade = dot(vNor, normalize(light));
            shade = clamp(shade, 0., 1.);
            shade = pow(shade, 6.);
            shade *= smoothstep(6., 3., distance(vPos.xy, vec2(0., 16.))); // emphasise the face
            
            bool isBack = nShade > 0.;
            
            gl_FragColor.rgb += vec3(shade) * 0.75 * (isBack ? 0. : 1.); // no light on back side of the face
            
            gl_FragColor *=  isBack ? 0.75 : 1.;
          `
        );
        //console.log(shader.fragmentShader);
      }
    })
  );
  scene.add(points);
} );

window.addEventListener("resize", onWindowResize);

let clock = new THREE.Clock();

renderer.setAnimationLoop(()=>{
  let t = clock.getElapsedTime();
  uniforms.time.value = t;
  uniforms.cameraPosition.value.copy(camera.position);
  controls.update();
  renderer.render(scene, camera);
});

function onWindowResize(event){
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}