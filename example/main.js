import dragDrop from "drag-drop"
import * as POSTPROCESSING from "postprocessing"
import Stats from "stats.js"
import * as THREE from "three"
import { ACESFilmicToneMapping, Box3, DirectionalLight, DoubleSide, Vector3 } from "three"
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

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 250)

scene.add(camera)
scene.autoUpdate = false
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

// renderer.autoClear = false
// renderer.autoClearColor = false
// renderer.autoClearDepth = false
// renderer.autoClearStencil = false

renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 1.4
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

	delete scene.userData.velocityTexture
	delete scene.userData.lastVelocityTexture

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
	pitch: 49,
	intensity: 2.5
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

new RGBELoader().load("quarry_02_4k.hdr", envMap => {
	envMap.mapping = THREE.EquirectangularReflectionMapping

	scene.environment = envMap

	envMesh = new GroundProjectedEnv(envMap)
	envMesh.radius = 440
	envMesh.height = 20
	envMesh.scale.setScalar(100)
	envMesh.updateMatrixWorld()
	scene.add(envMesh)
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

const clock = new THREE.Clock()

const initScene = () => {
	const options = {
		intensity: 0.999999999999999,
		power: 1,
		distance: 2.600000000000006,
		roughnessFade: 0,
		thickness: 1.6799999999999973,
		ior: 2.33,
		maxRoughness: 1,
		blend: 0.8,
		correction: 1,
		correctionRadius: 1,
		denoiseIterations: 3,
		denoiseKernel: 2,
		lumaPhi: 10.87,
		depthPhi: 4.3,
		normalPhi: 44.839999999999996,
		jitter: 5.551115123125783e-17,
		jitterRoughness: 1,
		steps: 20,
		refineSteps: 2,
		spp: 1,
		missedRays: false,
		useMap: true,
		useNormalMap: true,
		useRoughnessMap: true,
		resolutionScale: 1,
		antialias: true,
		reflectionsOnly: false
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
		intensity: 2,
		mipmapBlur: true,
		luminanceSmoothing: 0.5,
		luminanceThreshold: 0.5,
		kernelSize: POSTPROCESSING.KernelSize.HUGE
	})

	const vignetteEffect = new POSTPROCESSING.VignetteEffect({
		darkness: 0.8,
		offset: 0.3
	})

	ssgiEffect = new SSGIEffect(scene, camera, options)
	window.ssgiEffect = ssgiEffect

	scene.traverse(c => {
		if (c.isMesh && c.material.isMeshStandardMaterial) {
			c.material.side = DoubleSide
		}
	})

	gui2 = new SSGIDebugGUI(ssgiEffect, options)
	gui2.pane.containerElem_.style.left = "8px"

	ssgiPass = new POSTPROCESSING.EffectPass(camera, ssgiEffect)

	traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)
	// composer.addPass(traaPass)

	new POSTPROCESSING.LUTCubeLoader().load("lut.cube").then(lutTexture => {
		const lutEffect = new POSTPROCESSING.LUT3DEffect(lutTexture)

		const motionBlurEffect = new MotionBlurEffect(ssgiEffect.svgf.svgfTemporalResolvePass.velocityPass.texture, {
			jitter: 5
		})

		composer.addPass(ssgiPass)
		composer.addPass(new POSTPROCESSING.EffectPass(camera, motionBlurEffect, bloomEffect, vignetteEffect, lutEffect))

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()

		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)

		loop()

		const display = gui2.pane.element.style.display === "none" ? "block" : "none"

		gui.pane.element.style.display = display
		gui2.pane.element.style.display = display
		// stats.dom.style.display = display
	})
}

const loop = () => {
	if (stats) stats.begin()

	// if (ssgiEffect.svgf.svgfTemporalResolvePass.samples === 8) return

	const dt = clock.getDelta()
	if (mixer) {
		mixer.update(dt)
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

			const clips = asset.animations

			if (clips.length) {
				mixer = new THREE.AnimationMixer(asset.scene)

				const action = mixer.clipAction(clips[0])

				if (action) action.play()
			}
		})
	})

	reader.readAsArrayBuffer(file)
})

const setupAsset = asset => {
	scene.add(asset.scene)
	asset.scene.scale.setScalar(1)

	asset.scene.traverse(c => {
		if (c.isMesh) {
			c.castShadow = c.receiveShadow = true
			c.material.depthWrite = true
		}

		c.frustumCulled = false
	})

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
