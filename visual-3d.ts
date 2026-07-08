/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:organize-imports
// tslint:disable:ban-malformed-import-paths
// tslint:disable:no-new-decorators

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

import * as THREE from 'three';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {fs as backdropFS, vs as backdropVS} from './backdrop-shader';
import {vs as sphereVS} from './sphere-shader';

/**
 * 3D live audio visual.
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private camera!: THREE.PerspectiveCamera;
  private backdrop!: THREE.Mesh;
  private composer!: EffectComposer;
  private sphere!: THREE.Mesh;
  private freqGroup!: THREE.Group;
  private freqBars: THREE.Mesh[] = [];
  private prevTime = 0;
  private rotation = new THREE.Vector3(0, 0, 0);

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2(-999, -999);
  private isHovering = false;
  private clickIntensity = 0;
  private interactionSpeed = 0;
  private micPulseScale = 0;
  private micPulseVelocity = 0;

  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  @property({type: Boolean})
  thinking = false;

  @property({type: String})
  mood = 'neutral';

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  private canvas!: HTMLCanvasElement;

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
      image-rendering: pixelated;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
  }

  private init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    const backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: {value: new THREE.Vector2(1, 1)},
          rand: {value: 0},
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      }),
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);
    this.backdrop = backdrop;

    // Create a curved frequency visualizer layer behind the main orb
    const freqGroup = new THREE.Group();
    scene.add(freqGroup);
    this.freqGroup = freqGroup;

    const numBars = 32;
    this.freqBars = [];
    const barGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
    for (let i = 0; i < numBars; i++) {
      const barMat = new THREE.MeshStandardMaterial({
        color: 0x020210,
        emissive: 0x05051a,
        emissiveIntensity: 1.0,
        roughness: 0.1,
        metalness: 0.9,
      });
      const bar = new THREE.Mesh(barGeo, barMat);
      
      const pct = i / (numBars - 1);
      // Span across a gentle crescent arc behind the sphere
      const angle = (pct - 0.5) * Math.PI * 0.9;
      const radius = 2.2;
      
      const x = Math.sin(angle) * radius;
      const z = -Math.cos(angle) * radius; // Negative Z places it behind the sphere
      const y = -0.5; // Slightly lower offset
      
      bar.position.set(x, y, z);
      bar.rotation.y = angle;
      
      freqGroup.add(bar);
      this.freqBars.push(bar);
    }

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio / 1);

    const geometry = new THREE.IcosahedronGeometry(1, 10);

    new EXRLoader().load('piz_compressed.exr', (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
      sphereMaterial.envMap = exrCubeRenderTarget.texture;
      sphere.visible = true;
    });

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x000010,
      metalness: 0.5,
      roughness: 0.1,
      emissive: 0x000010,
      emissiveIntensity: 1.5,
    });

    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = {value: 0};
      shader.uniforms.inputData = {value: new THREE.Vector4()};
      shader.uniforms.outputData = {value: new THREE.Vector4()};
      shader.uniforms.interactiveDeform = {value: 0.0};

      sphereMaterial.userData.shader = shader;

      shader.vertexShader = sphereVS;
    };

    const sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);
    sphere.visible = false;

    this.sphere = sphere;

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      5,
      0.5,
      0,
    );

    const fxaaPass = new ShaderPass(FXAAShader);

    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    // composer.addPass(fxaaPass);
    composer.addPass(bloomPass);

    this.composer = composer;

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const dPR = renderer.getPixelRatio();
      const w = window.innerWidth;
      const h = window.innerHeight;
      backdrop.material.uniforms.resolution.value.set(w * dPR, h * dPR);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      fxaaPass.material.uniforms['resolution'].value.set(
        1 / (w * dPR),
        1 / (h * dPR),
      );
    }

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    this.animation();
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    if (!this.inputAnalyser || !this.outputAnalyser) return;

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    // Calculate normalized average amplitude of the microphone audio
    let inputAmp = 0;
    if (this.inputAnalyser.data && this.inputAnalyser.data.length > 0) {
      let sum = 0;
      for (let i = 0; i < this.inputAnalyser.data.length; i++) {
        sum += this.inputAnalyser.data[i];
      }
      inputAmp = sum / this.inputAnalyser.data.length / 255;
    }

    // Calculate normalized average amplitude of the model audio
    let outputAmp = 0;
    if (this.outputAnalyser.data && this.outputAnalyser.data.length > 0) {
      let sum = 0;
      for (let i = 0; i < this.outputAnalyser.data.length; i++) {
        sum += this.outputAnalyser.data[i];
      }
      outputAmp = sum / this.outputAnalyser.data.length / 255;
    }

    const t = performance.now();
    const dt = (t - this.prevTime) / (1000 / 60);
    this.prevTime = t;

    // Base states based on mood
    let baseEmissive = new THREE.Color(0x0a0a2c); // default calm neutral (deep indigo)
    let baseColor = new THREE.Color(0x020215);
    let moodGlowColor = new THREE.Color(0x6366f1); // indigo default
    let responseGlowFactor = 3.5;

    if (this.thinking) {
      // High thinking mode has its own majestic amber/golden colors
      baseEmissive = new THREE.Color(0xd97706);
      baseColor = new THREE.Color(0x1e1503);
      moodGlowColor = new THREE.Color(0xf59e0b);
    } else {
      switch (this.mood) {
        case 'excited':
          baseEmissive = new THREE.Color(0x300020); // deep wine/magenta
          baseColor = new THREE.Color(0x15000f);
          moodGlowColor = new THREE.Color(0xff007f); // vibrant pink/neon rose
          responseGlowFactor = 4.5; // more intense!
          break;
        case 'analytical':
          baseEmissive = new THREE.Color(0x1c1200); // dark warm bronze
          baseColor = new THREE.Color(0x100a00);
          moodGlowColor = new THREE.Color(0xd97706); // sparkling orange-amber
          responseGlowFactor = 3.8;
          break;
        case 'warm':
          baseEmissive = new THREE.Color(0x2c0c16); // rosy / warm violet
          baseColor = new THREE.Color(0x14040a);
          moodGlowColor = new THREE.Color(0xf43f5e); // soft rose / coral
          responseGlowFactor = 3.0; // soft and gentle
          break;
        case 'mysterious':
          baseEmissive = new THREE.Color(0x022c22); // deep cosmic green
          baseColor = new THREE.Color(0x01130e);
          moodGlowColor = new THREE.Color(0x10b981); // electric emerald
          responseGlowFactor = 4.0;
          break;
        case 'neutral':
        default:
          baseEmissive = new THREE.Color(0x0a0a2c); // deep indigo
          baseColor = new THREE.Color(0x020215);
          moodGlowColor = new THREE.Color(0x6366f1); // elegant indigo / blue
          responseGlowFactor = 3.5;
          break;
      }
    }

    // Decay interactive values
    if (this.clickIntensity > 0) {
      this.clickIntensity -= 0.04 * dt;
      if (this.clickIntensity < 0) this.clickIntensity = 0;
    }
    if (this.interactionSpeed > 0) {
      this.interactionSpeed -= 0.02 * dt;
      if (this.interactionSpeed < 0) this.interactionSpeed = 0;
    }

    // Perform Raycasting to check hover state
    let intersects = false;
    if (this.sphere && this.sphere.visible && this.camera && this.mouse.x !== -999) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersections = this.raycaster.intersectObject(this.sphere);
      intersects = intersections.length > 0;
    }

    if (intersects) {
      if (!this.isHovering) {
        this.isHovering = true;
        this.canvas.style.cursor = 'pointer';
      }
    } else {
      if (this.isHovering) {
        this.isHovering = false;
        this.canvas.style.cursor = 'default';
      }
    }

    const backdropMaterial = this.backdrop.material as THREE.RawShaderMaterial;
    const sphereMaterial = this.sphere.material as THREE.MeshStandardMaterial;

    backdropMaterial.uniforms.rand.value = Math.random() * 10000;

    if (sphereMaterial.userData.shader) {
      // Create an energetic, voice-reactive glow
      const reactiveGlow = new THREE.Color(0x000000);
      if (inputAmp > 0.005) {
        // User speaking into microphone -> Glowing cyan/teal bloom
        reactiveGlow.addScaledVector(new THREE.Color(0x06b6d4), inputAmp * 3.5);
      }
      if (outputAmp > 0.005) {
        // Model responding -> Glowing color based on detected mood
        reactiveGlow.addScaledVector(moodGlowColor, outputAmp * responseGlowFactor);
      }

      // Interactive hover/click visual feedback
      const interactiveGlow = new THREE.Color(0x000000);
      if (this.isHovering) {
        // High-contrast neon violet energy when hovered
        interactiveGlow.addScaledVector(new THREE.Color(0xa855f7), 0.6);
      }
      if (this.clickIntensity > 0) {
        // Vivid white/gold splash when clicked
        interactiveGlow.addScaledVector(new THREE.Color(0xfffbeb), this.clickIntensity * 2.5);
      }

      const targetEmissive = baseEmissive.clone().add(reactiveGlow).add(interactiveGlow);
      const targetIntensity = (this.thinking ? 2.5 : 1.5) + inputAmp * 6.0 + outputAmp * (responseGlowFactor + 1.5) + (this.isHovering ? 0.8 : 0) + this.clickIntensity * 4.0;

      sphereMaterial.emissive.lerp(targetEmissive, 0.15 * dt);
      sphereMaterial.color.lerp(baseColor, 0.15 * dt);
      sphereMaterial.emissiveIntensity += (targetIntensity - sphereMaterial.emissiveIntensity) * 0.15 * dt;

      // Physics-based spring solver for the mic pulse to specifically react snappily to the user's mic input level
      const clampedDt = Math.min(dt, 2.0);
      const targetMicPulse = inputAmp * 1.5; // High sensitivity multiplier for dramatic pulse
      const springK = 0.35; // stiffness of spring
      const damping = 0.25; // damping/friction coefficient
      const force = -springK * (this.micPulseScale - targetMicPulse) - damping * this.micPulseVelocity;
      this.micPulseVelocity += force * clampedDt;
      this.micPulseScale += this.micPulseVelocity * clampedDt;

      // Smoothly scale the orb with elastic responsiveness, natural breathing idle, and interactive scale increments
      const breathing = Math.sin(t * 0.0012) * 0.035;
      const hoverScale = this.isHovering ? 0.08 : 0.0;
      const clickScale = this.clickIntensity * 0.25;
      const baseScale = (this.thinking ? 1.15 : 1.0) + breathing + hoverScale + clickScale;
      const targetScale = baseScale + outputAmp * 0.5;
      const currentScale = this.sphere.scale.x;
      const nextScale = currentScale + (targetScale - currentScale) * 0.2 * dt;
      this.sphere.scale.setScalar(nextScale + this.micPulseScale);

      // Generous, majestic rotation that speeds up or vibrates when voices are active or interacted with
      const rotationSpeed = 1.0 + inputAmp * 4.0 + outputAmp * 3.0 + this.interactionSpeed * 6.0;
      const f = (this.thinking ? 0.0025 : 0.001) * rotationSpeed;
      const baseRotation = (0.0005 + (this.isHovering ? 0.0015 : 0)) * dt;
      
      this.rotation.x += baseRotation + (dt * f * 0.5 * this.outputAnalyser.data[1]) / 255;
      this.rotation.z += baseRotation + (dt * f * 0.5 * this.inputAnalyser.data[1]) / 255;
      this.rotation.y += baseRotation + (dt * f * 0.25 * this.inputAnalyser.data[2]) / 255;
      this.rotation.y += baseRotation + (dt * f * 0.25 * this.outputAnalyser.data[2]) / 255;

      const euler = new THREE.Euler(
        this.rotation.x,
        this.rotation.y,
        this.rotation.z,
      );
      const quaternion = new THREE.Quaternion().setFromEuler(euler);
      const vector = new THREE.Vector3(0, 0, 5);
      vector.applyQuaternion(quaternion);
      this.camera.position.copy(vector);
      this.camera.lookAt(this.sphere.position);

      // Wave frequency and wobble speed increase under active audio or interaction
      const wobbleSpeed = dt * (0.05 + inputAmp * 0.15 + outputAmp * 0.1 + (this.isHovering ? 0.05 : 0) + this.clickIntensity * 0.1);
      sphereMaterial.userData.shader.uniforms.time.value += wobbleSpeed;

      // Update interactiveDeform uniform in the shader
      sphereMaterial.userData.shader.uniforms.interactiveDeform.value = (this.isHovering ? 0.05 : 0) + this.clickIntensity * 0.75;

      // Vector displacement mapping in shaders:
      // x: intensity of deformation (enhanced by bouncy micPulseScale)
      // y: weight/factor of deformation (enhanced by bouncy micPulseScale)
      // z: wave density (higher frequency when talking, responsive to bouncy micPulseScale)
      sphereMaterial.userData.shader.uniforms.inputData.value.set(
        inputAmp + this.micPulseScale * 0.5,
        1.8 + this.micPulseScale * 0.8,
        5.0 + inputAmp * 15.0 + this.micPulseScale * 10.0,
        0,
      );
      sphereMaterial.userData.shader.uniforms.outputData.value.set(
        outputAmp,
        1.3,
        4.0 + outputAmp * 10.0,
        0,
      );
    }

    // Align frequency group with the camera's frame of reference
    if (this.freqGroup && this.camera) {
      this.freqGroup.position.copy(this.camera.position);
      this.freqGroup.quaternion.copy(this.camera.quaternion);
    }

    // Update frequency-based visualization layer
    if (this.freqBars && this.freqBars.length > 0) {
      const numBars = this.freqBars.length;
      for (let i = 0; i < numBars; i++) {
        const bar = this.freqBars[i];
        
        // Symmetrical layout: center bars map to low frequencies (bass), outer bars to highs
        const centerDist = Math.abs(i - (numBars - 1) / 2);
        const maxDist = (numBars - 1) / 2;
        // Sample indices from 0 to 60 of the frequency data
        const sampleIndex = Math.floor((centerDist / maxDist) * 60);
        
        let inputVal = 0;
        if (this.inputAnalyser && this.inputAnalyser.data) {
          inputVal = (this.inputAnalyser.data[sampleIndex] || 0) / 255;
        }
        let outputVal = 0;
        if (this.outputAnalyser && this.outputAnalyser.data) {
          outputVal = (this.outputAnalyser.data[sampleIndex] || 0) / 255;
        }
        
        // Blend input and output frequencies with strong responsive multipliers
        const val = inputVal * 1.6 + outputVal * 1.3;
        
        // Compute target height for this bar
        const targetHeight = 0.15 + val * 3.5;
        const currentY = bar.scale.y;
        
        // Elastic/spring-like snappy height rise and smooth dampening decay
        const lerpFactor = targetHeight > currentY ? 0.35 * dt : 0.12 * dt;
        const newY = currentY + (targetHeight - currentY) * Math.min(lerpFactor, 1.0);
        
        bar.scale.set(1.0, newY, 1.0);
        
        // Set local coordinates: crescent horizontal distribution curve
        const pct = i / (numBars - 1);
        const x = (pct - 0.5) * 5.6;
        // Curved backwards in local Z space relative to camera
        const z = -6.0 - Math.sin(pct * Math.PI) * 0.8;
        // Grow upwards from baseline y = -1.0
        const y = -1.0 + newY * 0.5;
        
        bar.position.set(x, y, z);
        
        // Dynamic voice-responsive emissive color blending matching active mood/vocal cues
        const barMat = bar.material as THREE.MeshStandardMaterial;
        const idleColor = new THREE.Color(0x05051a); // default deep space indigo
        const reactiveColor = new THREE.Color(0x000000);
        
        if (inputVal > 0.01) {
          // Glow cyan/teal for user speaking
          reactiveColor.addScaledVector(new THREE.Color(0x06b6d4), inputVal * 3.0);
        }
        if (outputVal > 0.01) {
          // Glow current model active mood color for model responding
          reactiveColor.addScaledVector(moodGlowColor, outputVal * 3.5);
        }
        
        const targetEmissive = idleColor.clone().add(reactiveColor);
        barMat.emissive.lerp(targetEmissive, 0.15 * dt);
        barMat.emissiveIntensity = 1.0 + inputVal * 5.0 + outputVal * 5.0;
      }
    }

    this.composer.render();
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onClick(e: MouseEvent) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    if (this.sphere && this.sphere.visible && this.camera) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.sphere);
      if (intersects.length > 0) {
        this.clickIntensity = 1.0;
        this.interactionSpeed = Math.min(this.interactionSpeed + 0.8, 2.5);
      }
    }
  }

  private onMouseLeave() {
    this.mouse.set(-999, -999);
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    this.init();

    // Attach event listeners for mouse interaction
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.canvas.addEventListener('mouseleave', () => this.onMouseLeave());
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}
