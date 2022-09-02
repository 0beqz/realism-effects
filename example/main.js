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
	HalfFloatType,
	LinearMipMapLinearFilter,
	Vector3
} from "three"
import { WebGLRenderTarget } from "three/build/three.module"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { GroundProjectedEnv } from "three/examples/jsm/objects/GroundProjectedEnv"
import { SSREffect } from "../src/SSR/index"
import { TRAAEffect } from "../src/TRAAEffect"
import { SSRDebugGUI } from "./SSRDebugGUI"
import "./style.css"
import { TRAADebugGUI } from "./TRAADebugGUI"

let traaEffect
let traaPass
let smaaPass
let fxaaPass
let ssrEffect
let ssrPass
let gui
let envMesh
const guiParams = {
	Method: "TRAA",
	Background: false
}

const scene = new THREE.Scene()
window.scene = scene
const ambientLight = new THREE.AmbientLight(new Color().setScalar(0))
scene.add(ambientLight)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 250)

scene.add(camera)
scene.autoUpdate = false
window.camera = camera

const canvas = document.querySelector(".webgl")

let rendererCanvas = canvas

// use an offscreen canvas if available
if (window.OffscreenCanvas) {
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
	preserveDrawingBuffer: true
})

renderer.autoClear = false
renderer.autoClearColor = false
renderer.autoClearDepth = false
renderer.autoClearStencil = false

renderer.toneMapping = ACESFilmicToneMapping
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

camera.position.set(0, 10, 24)
controls.target.set(0, 8, 0)
controls.maxPolarAngle = Math.PI / 2
// controls.maxDistance = 30
window.controls = controls

const composer = new POSTPROCESSING.EffectComposer(renderer)
window.composer = composer
const renderPass = new POSTPROCESSING.RenderPass(scene, camera)
composer.addPass(renderPass)

composer.inputBuffer = new WebGLRenderTarget(window.innerWidth, window.innerHeight, {
	...composer.inputBuffer,
	minFilter: LinearMipMapLinearFilter,
	magFilter: LinearMipMapLinearFilter,
	generateMipmaps: true,
	type: HalfFloatType
})

const light = new DirectionalLight(0xffffff, 5)
light.position.set(217, 43, 76)
light.updateMatrixWorld()
light.castShadow = true
scene.add(light)
window.light = light

renderer.shadowMap.enabled = true
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true

// Set up shadow properties for the light
light.shadow.mapSize.width = 8192 // default
light.shadow.mapSize.height = 8192 // default
light.shadow.camera.near = 50 // default
light.shadow.camera.far = 500 // default
light.shadow.bias = -0.000001

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

new RGBELoader().load("hdr/dry_cracked_lake_4k.hdr", envMap => {
	envMap.mapping = THREE.EquirectangularReflectionMapping

	scene.environment = envMap
	scene.background = envMap

	envMesh = new GroundProjectedEnv(envMap)
	envMesh.radius = 440
	envMesh.height = 20
	envMesh.scale.setScalar(100)
	envMesh.updateMatrixWorld()

	console.log(envMesh)
	scene.add(envMesh)
})

const gltflLoader = new GLTFLoader()

const url = "astronaut-low.glb"

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

const lightParams = {
	yaw: 51,
	pitch: 34,
	distance: 100
}

const toRad = Math.PI / 180

const refreshLighting = () => {
	light.position.x = Math.sin(lightParams.yaw * toRad) * lightParams.distance
	light.position.y = Math.sin(lightParams.pitch * toRad) * lightParams.distance
	light.position.z = Math.cos(lightParams.yaw * toRad) * lightParams.distance
	light.updateMatrixWorld()

	if (ssrEffect) {
		ssrEffect.temporalResolvePass.samples = 1

		ssrEffect.setSize(window.innerWidth, window.innerHeight, true)
	}
	if (traaEffect) traaEffect.temporalResolvePass.samples = 1
	renderer.shadowMap.needsUpdate = true
}

const clock = new THREE.Clock()

const initScene = () => {
	const options = {
		intensity: 11.96,
		power: 1.3250000000000006,
		exponent: 1.475,
		distance: 6.000000000000002,
		fade: 0,
		roughnessFade: 0,
		thickness: 7.609999999999998,
		ior: 2.04,
		mip: 1,
		maxRoughness: 1,
		maxDepthDifference: 260.9,
		blend: 1,
		correction: 0,
		correctionRadius: 1,
		blur: 0,
		jitter: 0,
		jitterRoughness: 0.07999999999999999,
		steps: 22,
		refineSteps: 5,
		spp: 4,
		missedRays: false,
		useMap: true,
		useNormalMap: true,
		useRoughnessMap: true,
		resolutionScale: 0.5,
		qualityScale: 0.5
	}

	traaEffect = new TRAAEffect(scene, camera, params)

	window.traaEffect = traaEffect

	gui = new TRAADebugGUI(traaEffect, params)

	const aaFolder = gui.pane.addFolder({ title: "Anti-aliasing" })

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

	const sceneFolder = gui.pane.addFolder({ title: "Scene", expanded: false })

	sceneFolder.addInput(lightParams, "yaw", { min: 0, max: 360, step: 1 }).on("change", refreshLighting)

	sceneFolder.addInput(lightParams, "pitch", { min: -90, max: 90, step: 1 }).on("change", refreshLighting)

	sceneFolder.addInput(lightParams, "distance", { min: 0, max: 200, step: 1 }).on("change", refreshLighting)

	sceneFolder.addInput(light, "intensity", { min: 0, max: 10, step: 0.1 }).on("change", refreshLighting)

	const bloomEffect = new POSTPROCESSING.BloomEffect({
		intensity: 1,
		mipmapBlur: true,
		luminanceSmoothing: 0.5,
		luminanceThreshold: 0.25,
		kernelSize: POSTPROCESSING.KernelSize.HUGE
	})

	const vignetteEffect = new POSTPROCESSING.VignetteEffect({
		darkness: 0.6
	})

	ssrEffect = new SSREffect(scene, camera, options)

	scene.traverse(c => {
		if (c.isMesh && c.material.isMeshStandardMaterial) {
			c.material.side = DoubleSide
			ssrEffect.selection.add(c)
		}
	})

	const gui2 = new SSRDebugGUI(ssrEffect, options)
	gui2.pane.containerElem_.style.left = "8px"

	// gui.pane.element.style.display = "none"
	// gui2.pane.element.style.display = "none"

	new POSTPROCESSING.LUT3dlLoader().load("room.3dl", lutTexture => {
		// const lutEffect = new POSTPROCESSING.LUTEffect(lutTexture)

		ssrPass = new POSTPROCESSING.EffectPass(camera, ssrEffect)

		traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)
		// composer.addPass(traaPass)

		composer.addPass(ssrPass)
		composer.addPass(new POSTPROCESSING.EffectPass(camera, bloomEffect, vignetteEffect))

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()

		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)

		loop()
	})
}

const loop = () => {
	if (stats) stats.begin()

	const dt = clock.getDelta()
	if (mixer) {
		mixer.update(dt)
		lastScene.updateMatrixWorld()
		refreshLighting()
	}

	controls.update()

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
	const value = aaOptions[ev.key]

	if (value) setAA(value)

	if (ev.code === "Space" || ev.code === "Enter" || ev.code === "NumpadEnter") {
		setAA(guiParams.Method === "TRAA" ? "Disabled" : "TRAA")
	}

	if (ev.code === "KeyQ") {
		ssrPass.enabled = !ssrPass.enabled

		scene.traverse(c => {
			if (c.material) {
				c.material.envMapIntensity = ssrPass.enabled ? 0 : 1
			}
		})

		refreshLighting()
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
			c.material.envMapIntensity = 0
			c.castShadow = c.receiveShadow = true
			c.material.depthWrite = true
		}

		c.frustumCulled = false
	})

	const bb = new Box3()
	bb.setFromObject(asset.scene)

	const height = bb.max.y - bb.min.y
	const targetHeight = 15

	const scale = targetHeight / height

	asset.scene.scale.multiplyScalar(scale)

	asset.scene.updateMatrixWorld()

	bb.setFromObject(asset.scene)

	const center = new Vector3()
	bb.getCenter(center)

	center.y = bb.min.y
	asset.scene.position.sub(center)

	scene.updateMatrixWorld()

	lastScene = asset.scene

	refreshLighting()
}

window.gltflLoader = gltflLoader
