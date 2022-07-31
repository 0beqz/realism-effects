import * as POSTPROCESSING from "postprocessing"
import Stats from "stats.js"
import * as THREE from "three"
import { Color, FrontSide } from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { GroundProjectedEnv } from "three/examples/jsm/objects/GroundProjectedEnv"
import { TRAAEffect } from "../src/TRAAEffect"
import "./style.css"
import { TRAADebugGUI } from "./TRAADebugGUI"

let traaEffect
let traaPass
let stats
let gui
let envMesh
const guiParams = {
	Method: "TRAA",
	Background: true
}

const scene = new THREE.Scene()
window.scene = scene
scene.add(new THREE.AmbientLight())

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000)

scene.add(camera)
scene.autoUpdate = false
window.camera = camera

const canvas = document.querySelector(".webgl")

let rendererCanvas

// use an offscreen canvas if available
if (window.OffscreenCanvas) {
	rendererCanvas = canvas.transferControlToOffscreen()
	rendererCanvas.style = canvas.style
} else {
	rendererCanvas = canvas
}

// Renderer
const renderer = new THREE.WebGLRenderer({
	canvas: rendererCanvas,
	powerPreference: "high-performance",
	premultipliedAlpha: false,
	depth: false,
	stencil: false,
	antialias: false,
	preserveDrawingBuffer: true
})
window.renderer = renderer

renderer.outputEncoding = THREE.sRGBEncoding
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.4
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)

const setAA = value => {
	composer.multisampling = 0
	composer.removePass(window.smaaPass)
	composer.removePass(traaPass)

	switch (value) {
		case "TRAA":
			composer.addPass(traaPass)
			break

		case "MSAA":
			composer.multisampling = 8

			break
		case "SMAA":
			composer.addPass(window.smaaPass)
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
controls.enableDamping = true

const composer = new POSTPROCESSING.EffectComposer(renderer)
const renderPass = new POSTPROCESSING.RenderPass(scene, camera)
composer.addPass(renderPass)

const params = {
	blend: 0.95,
	scale: 1,
	correction: 0.5
}

const pmremGenerator = new THREE.PMREMGenerator(renderer)
pmremGenerator.compileEquirectangularShader()

new RGBELoader().load("lago_disola_2k.hdr", envMap => {
	envMap.mapping = THREE.EquirectangularReflectionMapping

	scene.environment = envMap

	envMesh = new GroundProjectedEnv(envMap)
	envMesh.radius = 440
	envMesh.height = 20
	envMesh.scale.setScalar(100)
	scene.add(envMesh)
})

const gltflLoader = new GLTFLoader()

const url = "xeno.glb"

gltflLoader.load(url, asset => {
	scene.add(asset.scene)
	scene.updateMatrixWorld()

	asset.scene.traverse(c => {
		if (c.isMesh) {
			// c.material.wireframe = true
		}
	})

	const plane = scene.getObjectByName("Plane")
	if (plane) {
		plane.material.setValues({
			alphaMap: plane.material.map,
			aoMap: plane.material.map,
			transparent: true,
			envMapIntensity: 0,
			blending: 4,
			depthWrite: false,
			color: new Color().setScalar(7)
		})

		plane.position.y += 0.001
		plane.updateMatrixWorld()
	}

	traaEffect = new TRAAEffect(scene, camera, params)
	window.traaEffect = traaEffect

	gui = new TRAADebugGUI(traaEffect, params)

	const aaFolder = gui.pane.addFolder({ title: "Anti-aliasing" })

	aaFolder
		.addInput(guiParams, "Method", {
			options: {
				TRAA: "TRAA",
				MSAA: "MSAA",
				SMAA: "SMAA",
				"No AA": "No AA"
			}
		})
		.on("change", ev => {
			setAA(ev.value)
		})

	const sceneFolder = gui.pane.addFolder({ title: "Scene" })
	sceneFolder.addInput(guiParams, "Background").on("change", ev => {
		envMesh.visible = ev.value
	})
	stats = new Stats()
	stats.showPanel(0)
	document.body.appendChild(stats.dom)

	// adding one effect pass fixes the depth issue with the imported mesh
	composer.addPass(new POSTPROCESSING.EffectPass(camera))

	traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)
	composer.addPass(traaPass)

	const smaaEffect = new POSTPROCESSING.SMAAEffect()

	window.smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

	loop()
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

const loop = () => {
	if (stats) stats.begin()

	controls.update()

	composer.render()

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

document.addEventListener("keydown", ev => {
	const value = {
		1: "TRAA",
		2: "MSAA",
		3: "SMAA",
		4: "No AA"
	}[ev.key]

	if (value) setAA(value)

	if (ev.code === "Space" || ev.code === "Enter" || ev.code === "NumpadEnter") {
		setAA(guiParams.Method === "TRAA" ? "No AA" : "TRAA")
	}
})
