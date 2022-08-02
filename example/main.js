import * as POSTPROCESSING from "postprocessing"
import Stats from "stats.js"
import * as THREE from "three"
import { BoxBufferGeometry, Color, MeshBasicMaterial, PlaneBufferGeometry, RepeatWrapping, TextureLoader } from "three"
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
	depth: false,
	stencil: false,
	antialias: true,
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
	correction: 1
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

// const sphere = new THREE.Mesh(
// 	new THREE.SphereBufferGeometry(64, 64, 64),
// 	new THREE.MeshBasicMaterial({
// 		color: "green",
// 		side: THREE.BackSide,
// 		map: new TextureLoader().load("chess.jpg") // source: https://www.vecteezy.com/vector-art/639981-checker-pattern-black-white
// 	})
// )

// sphere.material.map.repeat.setScalar(4)
// sphere.material.map.wrapS = RepeatWrapping
// sphere.material.map.wrapT = RepeatWrapping

const chessTexture = new TextureLoader().load("chess.jpg")

const transparentMesh = new THREE.Mesh(
	new BoxBufferGeometry(4, 4),
	new MeshBasicMaterial({
		map: chessTexture,
		alphaMap: chessTexture,
		transparent: true
	})
)

transparentMesh.position.set(-3, 3, 0)
transparentMesh.updateMatrixWorld()

// scene.add(transparentMesh)

// scene.add(sphere)

const gltflLoader = new GLTFLoader()

const url = "xeno.glb"

gltflLoader.load(url, asset => {
	scene.add(asset.scene)
	scene.updateMatrixWorld()

	window.mesh = asset.scene

	asset.scene.traverse(c => {
		if (c.isMesh) {
			// c.material.wireframe = true
		}
	})

	const plane = scene.getObjectByName("Plane")
	if (plane) {
		plane.material = new MeshBasicMaterial({
			map: plane.material.map,
			transparent: true,
			blending: 4,
			depthWrite: false,
			color: new Color().setScalar(3)
		})

		plane.position.y += 0.001
		plane.updateMatrixWorld()
		plane.visible = false
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
	const dt = clock.getDelta()

	if (stats) stats.begin()

	controls.update()

	composer.render()

	if (skinMesh) {
		mixer.update(dt)
		skinMesh.updateMatrixWorld()
		// skinMesh = null
	}

	// mesh.rotation.y += 0.01
	// mesh.updateMatrixWorld()

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

	if (ev.code === "KeyP") {
		const data = renderer.domElement.toDataURL()

		const a = document.createElement("a") // Create <a>
		a.href = data
		a.download = "screenshot-" + uuidv4() + ".png" // File name Here
		a.click() // Downloaded file
	}
})
