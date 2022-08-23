import * as POSTPROCESSING from "postprocessing"
import Stats from "stats.js"
import * as THREE from "three"
import { Color, DirectionalLight, HalfFloatType, LinearMipMapLinearFilter, MeshBasicMaterial, Vector3 } from "three"
import { WebGLRenderTarget } from "three/build/three.module"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { GroundProjectedEnv } from "three/examples/jsm/objects/GroundProjectedEnv"
import { TRAAEffect } from "../src/TRAAEffect"
import { defaultSSROptions, SSREffect } from "../src/SSR/index"
import { SSRDebugGUI } from "./SSRDebugGUI"
import "./style.css"
import { TRAADebugGUI } from "./TRAADebugGUI"

SSREffect.patchDirectEnvIntensity()

let traaEffect
let traaPass
let smaaPass
let fxaaPass
let ssrEffect
let ssrPass
let stats
let gui
let envMesh
let sphere
const guiParams = {
	Method: "TRAA",
	Background: false
}

const scene = new THREE.Scene()
window.scene = scene
const ambientLight = new THREE.AmbientLight(new Color().setScalar(0))
scene.add(ambientLight)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000)

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
	depth: true,
	stencil: false,
	antialias: true,
	preserveDrawingBuffer: false
})
window.renderer = renderer

renderer.outputEncoding = THREE.sRGBEncoding
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.4
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)

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
camera.position.fromArray([-55.48651952979117, 14.717377645401774, 2.3037376138234147])
controls.target.fromArray([-25.74478629167503, 14.14908331969509, -1.5829506361015864])

camera.position.set(0, 10, 24)
controls.target.set(0, 9.95, 0)
controls.maxPolarAngle = Math.PI / 2
controls.maxDistance = 30
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

const params = {}

const pmremGenerator = new THREE.PMREMGenerator(renderer)
pmremGenerator.compileEquirectangularShader()

// const chessTexture = new TextureLoader().load("chess.jpg")

// const transparentMesh = new THREE.Mesh(
// 	new BoxBufferGeometry(4, 4),
// 	new MeshBasicMaterial({
// 		map: chessTexture,
// 		alphaMap: chessTexture,
// 		transparent: true
// 	})
// )

// transparentMesh.position.set(-3, 3, 0)
// transparentMesh.updateMatrixWorld()

// scene.add(transparentMesh)

const gltflLoader = new GLTFLoader()

const url = "brandenburger_tor.glb"

gltflLoader.load(url, asset => {
	scene.add(asset.scene)
	asset.scene.scale.multiplyScalar(10)
	scene.updateMatrixWorld()

	window.mesh = asset.scene

	asset.scene.traverse(c => {
		if (c.isMesh) {
			// c.material.wireframe = true
			c.material.envMapIntensity = 0
			// c.material.roughness = 0.1
			c.material.normalScale.setScalar(0)
			c.castShadow = c.receiveShadow = true
		}
	})

	// scene.getObjectByName("Wall_Floor2_0").material.color.setRGB(0, 1, 1)

	const plane = scene.getObjectByName("Plane")
	if (plane && plane.material) {
		plane.material = new MeshBasicMaterial({
			map: plane.material.map,
			aoMap: plane.material.map,
			aoMapIntensity: 2,
			blending: 4,
			depthWrite: false,
			color: new Color().setScalar(10),
			transparent: true
		})

		plane.position.y += 0.001
		plane.updateMatrixWorld()

		plane.visible = false
	}

	const lightMesh = scene.getObjectByName("light")
	if (lightMesh && lightMesh.material)
		lightMesh.material = new MeshBasicMaterial({ color: new Color().setRGB(1, 0.5, 0.2) })

	sphere = scene.getObjectByName("Sphere")
	if (sphere) {
		sphere.material.envMapIntensity = 0.25
	}

	if (scene.getObjectByName("Cube") && scene.getObjectByName("Cube").material) {
		scene.getObjectByName("Cube").material = new MeshBasicMaterial({
			map: scene.getObjectByName("Cube").material.map,
			color: new Color().setScalar(10),
			fog: true
		})
		scene.getObjectByName("Cube").castShadow = false
		scene.getObjectByName("Cube").receiveShadow = true
	}

	if (scene.getObjectByName("Icosphere")) {
		scene.getObjectByName("Icosphere").material = new MeshBasicMaterial({
			color: scene.getObjectByName("Icosphere").material.color.clone().multiplyScalar(100)
		})
	}

	const light = new DirectionalLight(0xffffff, 4.6)
	light.position.set(-500, 207, 140)
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
	light.shadow.camera.far = 1000 // default
	light.shadow.bias = -0.000001

	const s = 100

	light.shadow.camera.left = -s
	light.shadow.camera.bottom = -s
	light.shadow.camera.right = s
	light.shadow.camera.top = s

	// const velCatcher = new THREE.Mesh(new THREE.PlaneBufferGeometry(512, 512))
	// velCatcher.material.colorWrite = false
	// velCatcher.material.depthWrite = false
	// velCatcher.rotation.x = -Math.PI / 2
	// velCatcher.updateMatrixWorld()
	// scene.add(velCatcher)

	const options = {
		...defaultSSROptions,
		...{
			maxDepthDifference: 20,
			exponent: 1,
			intensity: 3,
			power: 1.5,
			ior: 2.09,
			blur: 1,
			missedRays: false,
			correctionRadius: 1,
			resolutionScale: 0.5,
			qualityScale: 0.5,
			distance: 20,
			steps: 20,
			spp: 10,
			refineSteps: 7,
			blend: 0.975,
			jitter: 0.61,
			jitterRoughness: 0,
			correction: 0,
			thickness: 11.96,
			roughnessFade: 0
		}
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
	sceneFolder.addInput(guiParams, "Background").on("change", ev => {
		sphere.visible = !ev.value
		envMesh.visible = ev.value
	})
	sceneFolder.addInput(light.position, "x", { min: -500, max: 500, step: 1 }).on("change", ev => {
		ssrEffect.temporalResolvePass.samples = 1
		traaEffect.temporalResolvePass.samples = 1
		renderer.shadowMap.needsUpdate = true
		light.updateMatrixWorld()
		createEnvMap()
	})
	sceneFolder.addInput(light.position, "y", { min: -500, max: 500, step: 1 }).on("change", ev => {
		ssrEffect.temporalResolvePass.samples = 1
		traaEffect.temporalResolvePass.samples = 1
		renderer.shadowMap.needsUpdate = true
		light.updateMatrixWorld()
		createEnvMap()
	})
	sceneFolder.addInput(light.position, "z", { min: -500, max: 500, step: 1 }).on("change", ev => {
		ssrEffect.temporalResolvePass.samples = 1
		traaEffect.temporalResolvePass.samples = 1
		renderer.shadowMap.needsUpdate = true
		light.updateMatrixWorld()
		createEnvMap()
	})
	sceneFolder.addInput(light, "intensity", { min: 0, max: 10, step: 0.1 }).on("change", ev => {
		ssrEffect.temporalResolvePass.samples = 1
		traaEffect.temporalResolvePass.samples = 1
		renderer.shadowMap.needsUpdate = true
		createEnvMap()
	})
	stats = new Stats()
	stats.showPanel(0)
	document.body.appendChild(stats.dom)

	const bloomEffect = new POSTPROCESSING.BloomEffect({
		intensity: 1,
		mipmapBlur: true,
		luminanceSmoothing: 0.5,
		luminanceThreshold: 0.6,
		kernelSize: POSTPROCESSING.KernelSize.HUGE
	})

	const vignetteEffect = new POSTPROCESSING.VignetteEffect({
		darkness: 0.6
	})

	// scene.fog = new FogExp2(0xffaa44, 0.001)

	ssrEffect = new SSREffect(scene, camera, options)

	new RGBELoader().load("lago_disola_2k.hdr", envMap => {
		envMap.mapping = THREE.EquirectangularReflectionMapping

		scene.environment = envMap
		scene.background = envMap

		envMesh = new GroundProjectedEnv(envMap)
		envMesh.radius = 440
		envMesh.height = 20
		envMesh.scale.setScalar(100)
		envMesh.updateMatrixWorld()
		scene.add(envMesh)
		envMesh.visible = false

		createEnvMap()
	})

	scene.traverse(c => {
		if (c.isMesh && c.material.isMeshStandardMaterial) {
			ssrEffect.selection.add(c)
		}
	})

	const gui2 = new SSRDebugGUI(ssrEffect, options)
	gui2.pane.containerElem_.style.left = "8px"

	new POSTPROCESSING.LUT3dlLoader().load("room.3dl", lutTexture => {
		const lutEffect = new POSTPROCESSING.LUTEffect(lutTexture)

		ssrPass = new POSTPROCESSING.EffectPass(camera, ssrEffect, lutEffect)

		if (scene.getObjectByName("Court_Lines_Glow")) {
			scene.getObjectByName("Court_Lines_Glow").material.color.setScalar(0)
			scene.getObjectByName("Court_Lines_Glow").material.emissiveIntensity = 10
			scene.getObjectByName("Court_Lines_Glow").material.emissive.setRGB(1, 0, 0)

			scene.getObjectByName("Circle005").material.color.setScalar(0)
			scene.getObjectByName("Circle005").material.emissiveIntensity = 10
			scene.getObjectByName("Circle005").material.emissive.setRGB(0, 0.05, 0.5)
		}

		traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)
		composer.addPass(traaPass)

		composer.addPass(ssrPass)

		// composer.addPass(new POSTPROCESSING.EffectPass(camera, bloomEffect, vignetteEffect))

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()

		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)

		loop()
	})
})

const createEnvMap = () => {
	return
	if (scene.getObjectByName("Object_2")) scene.getObjectByName("Object_2").visible = false
	if (scene.getObjectByName("boxes")) scene.getObjectByName("boxes").visible = false

	// const env = ssrEffect.generateBoxProjectedEnvMapFallback(
	// 	renderer,
	// 	new Vector3(0, 5, 0),
	// 	new Vector3(64.6103 * 2, 150, 60.5753 * 2)
	// )

	const env = ssrEffect.generateBoxProjectedEnvMapFallback(
		renderer,
		new Vector3(0, 1, 0),
		new Vector3(9.9 * 2, 19.9, 9.9 * 2)
	)

	if (scene.getObjectByName("Object_2")) scene.getObjectByName("Object_2").visible = true
	if (scene.getObjectByName("boxes")) scene.getObjectByName("boxes").visible = true

	scene.environment = env
	ambientLight.intensity = 0
}

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

let skinMesh
let mixer

// gltflLoader.load("skin.glb", asset => {
// 	skinMesh = asset.scene
// 	skinMesh.scale.multiplyScalar(2.1 * 5)
// 	skinMesh.position.set(2.5, 0, 0)
// 	skinMesh.rotation.y += Math.PI / 2
// 	skinMesh.updateMatrixWorld()
// 	skinMesh.traverse(c => {
// 		if (c.material) {
// 			c.material.roughness = 0
// 			c.material.metalness = 1
// 		}
// 	})
// 	scene.add(asset.scene)
// 	mixer = new THREE.AnimationMixer(skinMesh)
// 	const clips = asset.animations

// 	const action = mixer.clipAction(clips[0])
// 	action.play()
// })

const clock = new THREE.Clock()

const loop = () => {
	if (stats) stats.begin()

	const dt = clock.getDelta()
	if (skinMesh) {
		mixer.update(dt)
		skinMesh.updateMatrixWorld()
		// skinMesh = null
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
