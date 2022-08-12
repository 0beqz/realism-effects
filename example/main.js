import * as POSTPROCESSING from "postprocessing"
import Stats from "stats.js"
import * as THREE from "three"
import { Color, MeshBasicMaterial, Vector2 } from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { GroundProjectedEnv } from "three/examples/jsm/objects/GroundProjectedEnv"
import { TRAAEffect } from "../src/TRAAEffect"
import "./style.css"
import { TRAADebugGUI } from "./TRAADebugGUI"
import { defaultSSROptions, SSREffect } from "./SSR"
import { SSRDebugGUI } from "./SSRDebugGUI"
import { Vector3 } from "three"

SSREffect.patchDirectEnvIntensity()

let traaEffect
let traaPass
let smaaPass
let fxaaPass
let ssrEffect
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
scene.add(new THREE.AmbientLight(new Color().setScalar(1)))

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
camera.position.set(-6, 2.46102 + 2, 0)
controls.target.set(0, 2.46102, 0)
controls.maxPolarAngle = Math.PI / 2
controls.maxDistance = 30

const composer = new POSTPROCESSING.EffectComposer(renderer)
const renderPass = new POSTPROCESSING.RenderPass(scene, camera)
composer.addPass(renderPass)

const params = {
	blend: 0.9,
	scale: 1,
	dilation: true
}

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

const url = "time-machine.glb"

gltflLoader.load(url, asset => {
	scene.add(asset.scene)
	scene.updateMatrixWorld()

	window.mesh = asset.scene

	asset.scene.traverse(c => {
		if (c.isMesh) {
			// c.material.wireframe = true
			c.material.envMapIntensity = 1
			c.material.roughness = 0.1
		}
	})

	const plane = scene.getObjectByName("Plane")
	if (plane) {
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

	sphere = scene.getObjectByName("Sphere")
	if (sphere) {
		sphere.material.envMapIntensity = 0.25
	}

	const velCatcher = new THREE.Mesh(new THREE.PlaneBufferGeometry(512, 512))
	velCatcher.material.colorWrite = false
	velCatcher.material.depthWrite = false
	velCatcher.rotation.x = -Math.PI / 2
	velCatcher.updateMatrixWorld()
	scene.add(velCatcher)

	const options = {
		...defaultSSROptions,
		...{
			blur: 0.61,
			blurKernel: 3,
			blurSharpness: 40,
			clampRadius: 3,
			distance: 8.7,
			maxDepthDifference: 100,
			blend: 0.85,
			correction: 1,
			jitter: 0.24,
			jitterRoughness: 2.87,
			exponent: 3,
			ior: 2,
			correctionRadius: 3,
			correction: 1,
			blend: 0.925,
			refineSteps: 3,
			maxDepthDifference: 1000
		}
	}

	ssrEffect = new SSREffect(scene, camera, options)

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
	stats = new Stats()
	stats.showPanel(0)
	document.body.appendChild(stats.dom)

	// composer.addPass(
	// 	new POSTPROCESSING.EffectPass(
	// 		camera,
	// 		new POSTPROCESSING.BloomEffect({
	// 			intensity: 1.2,
	// 			mipmapBlur: true,
	// 			luminanceSmoothing: 0.3,
	// 			luminanceThreshold: 0.4,
	// 			kernelSize: POSTPROCESSING.KernelSize.HUGE
	// 		})
	// 	)
	// )

	// ssrEffect = new SSREffect(scene, camera, {
	// 	blurMix: 0,
	// 	blurKernelSize: 3,
	// 	maxDepthDifference: 100,
	// 	temporalResolveMix: 0.975,
	// 	temporalResolveCorrection: 0.4,
	// 	jitter: 0.13,
	// 	jitterRough: 0.33,
	// 	jitterSpread: 1.2,
	// 	colorExponent: 3,
	// 	ior: 2
	// })

	// scene.environment = ssrEffect.generateBoxProjectedEnvMapFallback(
	// 	renderer,
	// 	new Vector3(0, 1, 0),
	// 	new Vector3(22.3966 * 2, 32, 12.619 * 2)
	// )

	scene.traverse(c => {
		if (c.isMesh && c.material.isMeshStandardMaterial) {
			ssrEffect.selection.add(c)
		}
	})

	const gui2 = new SSRDebugGUI(ssrEffect, options)
	gui2.pane.containerElem_.style.left = "8px"

	new POSTPROCESSING.LUT3dlLoader().load("test.3dl", lutTexture => {
		const lutEffect = new POSTPROCESSING.LUTEffect(lutTexture)

		const ssrPass = new POSTPROCESSING.EffectPass(camera, ssrEffect, lutEffect)

		if (scene.getObjectByName("Court_Lines_Glow")) {
			scene.getObjectByName("Court_Lines_Glow").material.color.setScalar(0)
			scene.getObjectByName("Court_Lines_Glow").material.emissiveIntensity = 10
			scene.getObjectByName("Court_Lines_Glow").material.emissive.setRGB(1, 0, 0)

			scene.getObjectByName("Circle005").material.color.setScalar(0)
			scene.getObjectByName("Circle005").material.emissiveIntensity = 10
			scene.getObjectByName("Circle005").material.emissive.setRGB(0, 0.05, 0.5)
		}

		composer.addPass(ssrPass)

		traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)
		composer.addPass(traaPass)

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()

		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)

		new RGBELoader().load("lago_disola_2k.hdr", envMap => {
			envMap.mapping = THREE.EquirectangularReflectionMapping

			scene.environment = envMap

			envMesh = new GroundProjectedEnv(envMap)
			envMesh.radius = 440
			envMesh.height = 20
			envMesh.scale.setScalar(100)
			envMesh.updateMatrixWorld()
			scene.add(envMesh)
			envMesh.visible = false
		})

		loop()
	})
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

let skinMesh
let mixer

gltflLoader.load("skin.glb", asset => {
	skinMesh = asset.scene
	skinMesh.scale.multiplyScalar(2.1)
	skinMesh.position.set(2.5, 0, 0)
	skinMesh.rotation.y += Math.PI / 2
	skinMesh.updateMatrixWorld()
	skinMesh.traverse(c => {
		if (c.material) {
			c.material.roughness = 0
			c.material.metalness = 1
		}
	})
	// scene.add(asset.scene)
	mixer = new THREE.AnimationMixer(skinMesh)
	const clips = asset.animations

	const action = mixer.clipAction(clips[0])
	action.play()
})

const clock = new THREE.Clock()

const loop = () => {
	if (stats) stats.begin()

	const dt = clock.getDelta()
	if (skinMesh) {
		mixer.update(dt)
		skinMesh.updateMatrixWorld()
		// skinMesh = null
	}

	// mesh.rotation.y += 5 * dt

	controls.update()

	if (guiParams.Method === "three.js AA") {
		renderer.render(scene, camera)
	} else {
		composer.render()
	}

	if (stats) stats.end()
	window.requestAnimationFrame(loop)
}

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
