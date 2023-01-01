import dragDrop from "drag-drop"
import * as POSTPROCESSING from "postprocessing"
import Stats from "stats.js"
import * as THREE from "three"
import {
	ACESFilmicToneMapping,
	Box3,
	Color,
	DirectionalLight,
	DoubleSide,
	MeshNormalMaterial,
	NoToneMapping,
	Vector3
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { GroundProjectedEnv } from "three/examples/jsm/objects/GroundProjectedEnv"
import { MotionBlurEffect } from "../src/motionBlur/MotionBlurEffect"
import { SSGIEffect } from "../src/SSGI/index"
import { TRAAEffect } from "../src/TRAAEffect"
import { SSGIDebugGUI } from "./SSGIDebugGUI"
import "./style.css"
import { TRAADebugGUI } from "./TRAADebugGUI"

let traaEffect
let traaPass
let smaaPass
let fxaaPass
let ssgiEffect
let ssgiPass
let gui
let gui2
let envMesh
const guiParams = {
	Method: "TRAA",
	Background: false
}

const scene = new THREE.Scene()
window.scene = scene

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 250)

scene.add(camera)
scene.matrixWorldAutoUpdate = false
window.camera = camera

const canvas = document.querySelector(".webgl")

let rendererCanvas = canvas

// use an offscreen canvas if available
if (window.OffscreenCanvas && !navigator.userAgent.toLowerCase().includes("firefox")) {
	rendererCanvas = canvas.transferControlToOffscreen()
	rendererCanvas.style = canvas.style
	rendererCanvas.toDataURL = canvas.toDataURL.bind(canvas)
}

// Renderer
const renderer = new THREE.WebGLRenderer({
	canvas: rendererCanvas,
	powerPreference: "high-performance",
	premultipliedAlpha: false,
	stencil: false,
	antialias: true,
	alpha: false,
	preserveDrawingBuffer: true
})

window.renderer = renderer

renderer.autoClear = false
// renderer.autoClearColor = false
// renderer.autoClearDepth = false
// renderer.autoClearStencil = false

renderer.toneMapping = NoToneMapping
renderer.toneMappingExposure = 1.5
renderer.outputEncoding = THREE.sRGBEncoding
const dpr = window.devicePixelRatio || 1
renderer.setPixelRatio(dpr)
renderer.setSize(window.innerWidth * dpr, window.innerHeight * dpr)
renderer.setViewport(0, 0, window.innerWidth * dpr, window.innerHeight * dpr)

const setAA = value => {
	composer.multisampling = 0
	composer.removePass(smaaPass)
	composer.removePass(traaPass)
	composer.removePass(fxaaPass)

	switch (value) {
		case "TRAA":
			composer.addPass(traaPass)
			break

		case "MSAA":
			composer.multisampling = 8
			break

		case "FXAA":
			composer.addPass(fxaaPass)
			break

		case "SMAA":
			composer.addPass(smaaPass)
			break
	}

	guiParams.Method = value
	gui.pane.refresh()
}

// since using "rendererCanvas" doesn't work when using an offscreen canvas
const controls = new OrbitControls(camera, document.querySelector("#orbitControlsDomElem"))
controls.enableDamping = true
controls.dampingFactor = 0.075

camera.position.fromArray([0, 8.75, 25.4251889687681])
controls.target.set(0, 8.75, 0)
controls.maxPolarAngle = Math.PI / 2
controls.minDistance = 7.5
window.controls = controls

const composer = new POSTPROCESSING.EffectComposer(renderer)
window.composer = composer
const renderPass = new POSTPROCESSING.RenderPass(scene, camera)
composer.addPass(renderPass)

const lightParams = {
	yaw: 55,
	pitch: 27,
	intensity: 0
}

const light = new DirectionalLight(0xffffff, lightParams.intensity)
light.position.set(217, 43, 76)
light.updateMatrixWorld()
light.castShadow = true
scene.add(light)
window.light = light

// const spotLight = new SpotLight(0xff3300, 2)
// spotLight.position.set(-20, 20, 5)
// spotLight.updateMatrixWorld()
// scene.add(spotLight)

renderer.shadowMap.enabled = true
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true

light.shadow.mapSize.width = 8192
light.shadow.mapSize.height = 8192
light.shadow.camera.near = 50
light.shadow.camera.far = 500
light.shadow.bias = -0.0001

const s = 100

light.shadow.camera.left = -s
light.shadow.camera.bottom = -s
light.shadow.camera.right = s
light.shadow.camera.top = s

const stats = new Stats()
stats.showPanel(0)
document.body.appendChild(stats.dom)

const params = {}

const pmremGenerator = new THREE.PMREMGenerator(renderer)
pmremGenerator.compileEquirectangularShader()

new RGBELoader().load("monbachtal_riverbank_2k.hdr", envMap => {
	envMap.mapping = THREE.EquirectangularReflectionMapping

	scene.environment = envMap

	envMesh = new GroundProjectedEnv(envMap)
	envMesh.radius = 440
	envMesh.height = 20
	envMesh.scale.setScalar(100)
	envMesh.updateMatrixWorld()
	scene.add(envMesh)

	scene.background = new Color(0x4c7fe5)
})

const gltflLoader = new GLTFLoader()

const url = "squid_game__pinksoldier.glb"

let lastScene

gltflLoader.load(url, asset => {
	setupAsset(asset)
	initScene()
})

const loadingEl = document.querySelector("#loading")

let loadedCount = 0
const loadFiles = 3
THREE.DefaultLoadingManager.onProgress = () => {
	loadedCount++

	if (loadedCount === loadFiles) {
		setTimeout(() => {
			if (loadingEl) loadingEl.remove()
		}, 150)
	}

	const progress = Math.round((loadedCount / loadFiles) * 100)
	if (loadingEl) loadingEl.textContent = progress + "%"
}

let mixer

const toRad = Math.PI / 180

// let rAF

const refreshLighting = () => {
	light.position.x = Math.sin(lightParams.yaw * toRad) * Math.cos(lightParams.pitch * toRad)
	light.position.y = Math.sin(lightParams.pitch * toRad)
	light.position.z = Math.cos(lightParams.yaw * toRad) * Math.cos(lightParams.pitch * toRad)

	light.position.normalize().multiplyScalar(75)
	light.updateMatrixWorld()
	renderer.shadowMap.needsUpdate = true
}

const initScene = () => {
	const options = {
		distance: 5.98000000000001,
		thickness: 8.039999999999997,
		maxRoughness: 1,
		blend: 0.95,
		denoiseIterations: 3,
		denoiseKernel: 3,
		lumaPhiDiffuse: 2.73,
		lumaPhiSpecular: 6.53,
		depthPhi: 8.150000000000002,
		normalPhi: 43.48000000000002,
		roughnessPhi: 19.019999999999996,
		curvaturePhi: 0,
		jitter: 3.469446951953614e-18,
		jitterRoughness: 1,
		steps: 20,
		refineSteps: 4,
		spp: 1,
		resolutionScale: 1,
		missedRays: false
	}

	traaEffect = new TRAAEffect(scene, camera, params)

	window.traaEffect = traaEffect

	gui = new TRAADebugGUI(traaEffect, params)

	const aaFolder = gui.pane.addFolder({ title: "Anti-aliasing", expanded: false })

	aaFolder
		.addInput(guiParams, "Method", {
			options: {
				"TRAA": "TRAA",
				"three.js AA": "three.js AA",
				"MSAA": "MSAA",
				"FXAA": "FXAA",
				"SMAA": "SMAA",
				"Disabled": "Disabled"
			}
		})
		.on("change", ev => {
			setAA(ev.value)
		})

	const sceneFolder = gui.pane.addFolder({ title: "Scene" })

	sceneFolder.addInput(lightParams, "yaw", { min: 0, max: 360, step: 1 }).on("change", refreshLighting)

	sceneFolder.addInput(lightParams, "pitch", { min: -90, max: 90, step: 1 }).on("change", refreshLighting)

	sceneFolder.addInput(light, "intensity", { min: 0, max: 10, step: 0.1 }).on("change", refreshLighting)

	const bloomEffect = new POSTPROCESSING.BloomEffect({
		intensity: 1,
		mipmapBlur: true,
		luminanceSmoothing: 0.75,
		luminanceThreshold: 0.75,
		kernelSize: POSTPROCESSING.KernelSize.HUGE
	})

	const vignetteEffect = new POSTPROCESSING.VignetteEffect({
		darkness: 0.8,
		offset: 0.3
	})

	ssgiEffect = new SSGIEffect(scene, camera, options)
	window.ssgiEffect = ssgiEffect

	gui2 = new SSGIDebugGUI(ssgiEffect, options)
	gui2.pane.containerElem_.style.left = "8px"

	ssgiPass = new POSTPROCESSING.EffectPass(camera, ssgiEffect)

	new POSTPROCESSING.LUTCubeLoader().load("lut.cube").then(lutTexture => {
		const lutEffect = new POSTPROCESSING.LUT3DEffect(lutTexture)

		const { depthTexture, normalTexture, velocityTexture } = traaEffect.temporalResolvePass.fullscreenMaterial.uniforms

		const motionBlurEffect = new MotionBlurEffect(velocityTexture.value, {
			jitter: 1
		})

		ssgiEffect.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.velocityTexture.value = velocityTexture.value
		ssgiEffect.ssgiPass.fullscreenMaterial.uniforms.velocityTexture.value = velocityTexture.value
		ssgiEffect.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.normalTexture.value = normalTexture.value
		ssgiEffect.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.depthTexture.value = depthTexture.value
		traaEffect.temporalResolvePass.velocityPass.renderToScreen = false
		traaEffect.temporalResolvePass.velocityPass.needsSwap = false
		composer.addPass(traaEffect.temporalResolvePass.velocityPass)

		composer.addPass(ssgiPass)
		composer.addPass(new POSTPROCESSING.EffectPass(camera, bloomEffect, motionBlurEffect, vignetteEffect))

		traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)
		composer.addPass(traaPass)

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()

		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)
		// composer.addPass(fxaaPass)

		loop()

		const display = gui2.pane.element.style.display === "none" ? "block" : "none"

		gui.pane.element.style.display = display
		gui2.pane.element.style.display = display
		// stats.dom.style.display = display
	})
}

let mX = 0

document.body.addEventListener("mousemove", ev => {
	mX = (window.innerHeight - ev.clientY) / window.innerHeight
})

const loop = () => {
	if (stats) stats.begin()

	if (mixer) {
		for (const ac of mixer._actions) {
			ac.time = maxAnimDuration * mX
		}
		mixer.update(0)
		lastScene.updateMatrixWorld()
		refreshLighting()
	}

	controls.update()
	camera.updateMatrixWorld()

	if (guiParams.Method === "three.js AA") {
		renderer.render(scene, camera)
	} else {
		composer.render()
	}

	if (stats) stats.end()
	window.requestAnimationFrame(loop)
}

// controls.autoRotate = true

// event handlers
window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight
	camera.updateProjectionMatrix()

	renderer.setSize(window.innerWidth, window.innerHeight)
	if (traaEffect) traaEffect.setSize(window.innerWidth, window.innerHeight)
	if (ssgiEffect) ssgiEffect.setSize(window.innerWidth, window.innerHeight)
})

// source: https://stackoverflow.com/a/2117523/7626841
function uuidv4() {
	return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
		(c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
	)
}

const aaOptions = {
	1: "TRAA",
	2: "three.js AA",
	3: "MSAA",
	4: "FXAA",
	5: "SMAA",
	6: "Disabled"
}

const aaValues = Object.values(aaOptions)

document.addEventListener("keydown", ev => {
	if (document.activeElement.tagName !== "INPUT") {
		const value = aaOptions[ev.key]

		if (value) setAA(value)

		if (ev.code === "Space" || ev.code === "Enter" || ev.code === "NumpadEnter") {
			setAA(guiParams.Method === "TRAA" ? "Disabled" : "TRAA")
		}
	}

	if (ev.code === "KeyQ") {
		ssgiPass.enabled = !ssgiPass.enabled

		scene.traverse(c => {
			if (c.material) {
				c.material.envMapIntensity = ssgiPass.enabled ? 0 : 1
			}
		})

		refreshLighting()
	}

	if (ev.code === "Tab") {
		ev.preventDefault()

		const display = gui2.pane.element.style.display === "none" ? "block" : "none"

		gui.pane.element.style.display = display
		gui2.pane.element.style.display = display
		stats.dom.style.display = display
	}

	if (ev.code === "ArrowLeft") {
		let index = aaValues.indexOf(guiParams.Method)
		index--

		if (index === -1) index = aaValues.length - 1

		setAA(aaOptions[index + 1])
	}

	if (ev.code === "ArrowRight") {
		let index = aaValues.indexOf(guiParams.Method)
		index++

		if (index === aaValues.length) index = 0

		setAA(aaOptions[index + 1])
	}

	if (ev.code === "KeyP") {
		const data = renderer.domElement.toDataURL()

		const a = document.createElement("a") // Create <a>
		a.href = data
		a.download = "screenshot-" + uuidv4() + ".png" // File name Here
		a.click() // Downloaded file
	}
})

dragDrop("body", files => {
	const file = files[0]

	const reader = new FileReader()
	reader.addEventListener("load", e => {
		// e.target.result is an ArrayBuffer
		const arr = new Uint8Array(e.target.result)
		const { buffer } = arr

		gltflLoader.parse(buffer, "", asset => {
			if (lastScene) {
				lastScene.removeFromParent()
				lastScene.traverse(c => {
					if (c.isMesh) {
						c.geometry.dispose()
						c.material.dispose()
					}
				})

				mixer = null
			}

			setupAsset(asset)
		})
	})

	reader.readAsArrayBuffer(file)
})

let maxAnimDuration = 0

const setupAsset = asset => {
	scene.add(asset.scene)
	asset.scene.scale.setScalar(1)

	const material = new THREE.ShaderMaterial({
		vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
		   vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
		`,

		fragmentShader: /* glsl */ `
		varying vec2 vUv;
	  	void main() {
			
			float dist = distance(vUv, vec2(0., 1.));
			dist = mod(dist, 0.05);
			dist = step(dist, 0.025);
				
			vec3 color = vec3(dist);

			gl_FragColor = vec4(color, 1.0);
	  	}
		`,
		side: DoubleSide,
		toneMapped: false
	})

	asset.scene.traverse(c => {
		if (c.isMesh) {
			c.castShadow = c.receiveShadow = true
			c.material.depthWrite = true

			if (c.name === "shader") c.material = material

			if (c.name === "Cube") c.material = new MeshNormalMaterial()
		}

		if (c.name === "subpixel") {
			const material = new THREE.LineBasicMaterial({
				color: 0x0000ff
			})

			for (let i = 0; i < 10; i++) {
				const points = []
				points.push(new THREE.Vector3(0, 8 - i * 0.35, 0))
				points.push(new THREE.Vector3(8, 8 + i * 0.275, 0))

				const geometry = new THREE.BufferGeometry().setFromPoints(points)

				const line = new THREE.Line(geometry, material)
				scene.add(line)

				line.position.set(6, 6, 0)
			}

			const points = []

			for (let i = 0; i < 100; i++) {
				const y = Math.abs(Math.cos(i * Math.PI * 0.1)) * 2
				points.push(new THREE.Vector3((i / 100) * 8, y, 0))
			}

			const geometry = new THREE.BufferGeometry().setFromPoints(points)

			const line = new THREE.Line(geometry, material)
			scene.add(line)

			line.position.set(6, 8, 0)

			// let points = []

			// let geometry = new THREE.BufferGeometry().setFromPoints(points)
			// let line = new THREE.Line(geometry, material)

			// for (let i = 0; i < 1000; i++) {
			// 	const y = Math.abs(Math.cos(i * Math.PI * 0.01)) * 2
			// 	points.push(new THREE.Vector3((i / 1000) * 8, y, 0))

			// 	if (i % 2 === 0) {
			// 		scene.add(line)
			// 		geometry = new THREE.BufferGeometry().setFromPoints(points)
			// 		line = new THREE.Line(geometry, material)
			// 		line.position.set(6, 8, 0)

			// 		points = []
			// 	}
			// }
		}

		c.frustumCulled = false
	})

	const clips = asset.animations

	if (clips.length) {
		mixer = new THREE.AnimationMixer(asset.scene)

		for (const clip of clips) {
			maxAnimDuration = Math.max(clip.duration)
			const action = mixer.clipAction(clip)

			if (action) action.play()
		}
	}

	const bb = new Box3()
	bb.setFromObject(asset.scene)

	const height = bb.max.y - bb.min.y
	const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
	const targetHeight = 15
	const targetWidth = 45 * 2

	const scaleWidth = targetWidth / width
	const scaleHeight = targetHeight / height

	asset.scene.scale.multiplyScalar(Math.min(scaleWidth, scaleHeight))

	asset.scene.updateMatrixWorld()

	bb.setFromObject(asset.scene)

	const center = new Vector3()
	bb.getCenter(center)

	center.y = bb.min.y
	asset.scene.position.sub(center)

	scene.updateMatrixWorld()

	lastScene = asset.scene

	requestAnimationFrame(refreshLighting)
}

window.gltflLoader = gltflLoader
