import { getGPUTier } from "detect-gpu"
import dragDrop from "drag-drop"
import * as POSTPROCESSING from "postprocessing"
import { MotionBlurEffect, SSGIEffect, TRAAEffect } from "realism-effects"
import Stats from "stats.js"
import * as THREE from "three"
import {
	Box3,
	Clock,
	Color,
	CubeTextureLoader,
	DirectionalLight,
	DoubleSide,
	EquirectangularReflectionMapping,
	FloatType,
	MeshNormalMaterial,
	NearestFilter,
	Object3D,
	Vector3
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { GroundProjectedEnv } from "three/examples/jsm/objects/GroundProjectedEnv"
import { Pane } from "tweakpane"
import { VelocityDepthNormalPass } from "../src/temporal-reproject/pass/VelocityDepthNormalPass"
import { SSGIDebugGUI } from "./SSGIDebugGUI"
import "./style.css"

let traaEffect
let traaPass
let smaaPass
let fxaaPass
let ssgiEffect
let postprocessingEnabled = true
let pane
let gui2
let envMesh
let fps
const guiParams = {
	Method: "TRAA",
	Background: false
}

// extract if the paramaterer "traa_test" is set to true in the URL
const traaTest = new URLSearchParams(window.location.search).get("traa_test") === "true"

const scene = new THREE.Scene()
scene.matrixWorldAutoUpdate = false
window.scene = scene

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 250)
scene.add(camera)

const canvas = document.querySelector(".webgl")
const traaModelBtn = document.querySelector("#traaModelBtn")
const infoEl = document.querySelector("#info")
infoEl.style.display = "block"

const loadTRAATestModel = () => gltflLoader.load("time_machine.optimized.glb", setupAsset)

if (traaTest && !window.location.search.includes("traa_test_model=true")) {
	traaModelBtn.addEventListener("click", loadTRAATestModel)
} else {
	traaModelBtn.remove()
}

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
	antialias: false,
	alpha: false,
	preserveDrawingBuffer: true
})

renderer.autoClear = false

if (!traaTest) renderer.outputEncoding = THREE.sRGBEncoding

renderer.setSize(window.innerWidth, window.innerHeight)

const effectPass = new POSTPROCESSING.EffectPass(camera)

const setAA = value => {
	composer.multisampling = 0
	composer.removePass(smaaPass)
	composer.removePass(traaPass)
	composer.removePass(fxaaPass)
	composer.removePass(effectPass)

	if (traaTest) {
		infoEl.innerHTML = `Press the number buttons to change the AA method. 1 = TRAA, 2 = MSAA, 3 = FXAA, 4 = SMAA, 5 = Disabled.
			<br>Current method: <div id="aaMethod">${value}</div>`
	}

	switch (value) {
		case "TRAA":
			composer.addPass(traaPass)
			break

		case "MSAA":
			const ctx = renderer.getContext()
			composer.multisampling = Math.min(4, ctx.getParameter(ctx.MAX_SAMPLES))
			composer.addPass(effectPass)
			break

		case "FXAA":
			composer.addPass(fxaaPass)
			break

		case "SMAA":
			composer.addPass(smaaPass)
			break

		default:
			composer.addPass(effectPass)
	}

	guiParams.Method = value
	pane.refresh()
}

// since using "rendererCanvas" doesn't work when using an offscreen canvas
const controls = new OrbitControls(camera, document.querySelector("#orbitControlsDomElem"))
controls.enableDamping = true

const cameraY = traaTest ? 7 : 8.75
camera.position.fromArray([0, cameraY, 25])
controls.target.set(0, cameraY, 0)
controls.maxPolarAngle = Math.PI / 2
controls.minDistance = 7.5
window.controls = controls

const composer = new POSTPROCESSING.EffectComposer(renderer)
if (traaTest) {
	const renderPass = new POSTPROCESSING.RenderPass(scene, camera)
	composer.addPass(renderPass)
}

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
stats.showPanel(1)
stats.dom.style.top = "initial"
stats.dom.style.bottom = "0"
document.body.appendChild(stats.dom)

const rgbeLoader = new RGBELoader().setDataType(FloatType)

const initEnvMap = async envMap => {
	scene.environment?.dispose()

	envMap.mapping = EquirectangularReflectionMapping

	scene.environment = envMap
	scene.background = traaTest ? new Color(0x4c7fe5) : null

	setEnvMesh(envMap)
}

const cubeMapTest = () => {
	new CubeTextureLoader()
		.setPath("cubemap/yokohama_3/")
		.load(["posx.jpg", "negx.jpg", "posy.jpg", "negy.jpg", "posz.jpg", "negz.jpg"], envMesh => {
			scene.background = envMesh
			scene.environment = envMesh

			setEnvMesh(envMesh)
		})
}

const setEnvMesh = envMap => {
	if (!traaTest) {
		envMesh?.removeFromParent()
		envMesh?.material.dispose()
		envMesh?.geometry.dispose()

		envMesh = new GroundProjectedEnv(envMap)
		envMesh.radius = 100
		envMesh.height = 20
		envMesh.scale.setScalar(100)
		envMesh.updateMatrixWorld()
		scene.add(envMesh)
	}
}

const environments = [
	"blue_grotto",
	"cave_wall",
	"chinese_garden",
	"future_parking",
	"quarry_02",
	"snowy_field",
	"spruit_sunrise",
	"vintage_measuring_lab",
	"# cube map test"
]

rgbeLoader.load("hdr/chinese_garden_1k.hdr", initEnvMap)

const gltflLoader = new GLTFLoader()

const draco = new DRACOLoader()
draco.setDecoderConfig({ type: "js" })
draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
gltflLoader.setPath("gltf/")
gltflLoader.setDRACOLoader(draco)

let url
let loadFiles
if (traaTest) {
	if (window.location.search.includes("traa_test_model=true")) {
		url = "time_machine.optimized.glb"
		loadFiles = 5
	} else {
		url = "traa_demo_scene.optimized.glb"
		loadFiles = 15
	}
} else {
	url = "squid_game.optimized.glb"
	loadFiles = 8
}

let lastScene

gltflLoader.load(url, asset => {
	if (url === "time_machine.optimized.glb") asset.scene.rotation.y += Math.PI / 2
	setupAsset(asset)
	initScene()
})

const loadingEl = document.querySelector("#loading")

let loadedCount = 0
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

const refreshLighting = () => {
	light.position.x = Math.sin(lightParams.yaw * toRad) * Math.cos(lightParams.pitch * toRad)
	light.position.y = Math.sin(lightParams.pitch * toRad)
	light.position.z = Math.cos(lightParams.yaw * toRad) * Math.cos(lightParams.pitch * toRad)

	light.position.normalize().multiplyScalar(75)
	light.updateMatrixWorld()
	renderer.shadowMap.needsUpdate = true
}

const initScene = async () => {
	const gpuTier = await getGPUTier()
	fps = gpuTier.fps

	const options = {
		distance: 2.7200000000000104,
		thickness: 1.2999999999999972,
		autoThickness: false,
		maxRoughness: 1,
		blend: 0.95,
		denoiseIterations: 3,
		denoiseKernel: 3,
		denoiseDiffuse: 25,
		denoiseSpecular: 25.54,
		depthPhi: 5,
		normalPhi: 28,
		roughnessPhi: 18.75,
		envBlur: 0.5,
		importanceSampling: true,
		directLightMultiplier: 1,
		steps: 20,
		refineSteps: 4,
		spp: 1,
		resolutionScale: 1,
		missedRays: false
	}

	const velocityDepthNormalPass = new VelocityDepthNormalPass(scene, camera)
	composer.addPass(velocityDepthNormalPass)

	traaEffect = new TRAAEffect(scene, camera, velocityDepthNormalPass)

	pane = new Pane()
	pane.containerElem_.style.userSelect = "none"
	pane.containerElem_.style.width = "380px"

	const aaFolder = pane.addFolder({ title: "Anti-aliasing", expanded: false })

	aaFolder
		.addInput(guiParams, "Method", {
			options: {
				TRAA: "TRAA",

				MSAA: "MSAA",
				FXAA: "FXAA",
				SMAA: "SMAA",
				Disabled: "Disabled"
			}
		})
		.on("change", ev => {
			setAA(ev.value)
		})

	const modelNames = [
		"amg",
		"chevrolet",
		"clay_bust_study",
		"cyberpunk_bike",
		"cyber_samurai",
		"darth_vader",
		"flashbang_grenade",
		"motorbike",
		"statue",
		"squid_game",
		"swordsman"
	]

	const sceneParams = { Environment: "chinese_garden", Model: "squid_game" }

	const envObject = {}
	const modelObject = {}

	environments.forEach(value => (envObject[value] = value))
	modelNames.forEach(value => (modelObject[value] = value))

	const assetsFolder = pane.addFolder({ title: "Assets" })
	assetsFolder
		.addInput(sceneParams, "Environment", {
			options: envObject
		})
		.on("change", ev => {
			if (ev.value === "# cube map test") {
				cubeMapTest()
				return
			}

			rgbeLoader.load("hdr/" + ev.value + "_1k.hdr", initEnvMap)
		})

	assetsFolder
		.addInput(sceneParams, "Model", {
			options: modelObject
		})
		.on("change", ev => {
			gltflLoader.load(ev.value + ".optimized.glb", setupAsset)
		})

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

	ssgiEffect = new SSGIEffect(scene, camera, velocityDepthNormalPass, options)

	gui2 = new SSGIDebugGUI(ssgiEffect, options)
	gui2.pane.containerElem_.style.left = "8px"
	if (traaTest) gui2.pane.element.style.visibility = "hidden"

	new POSTPROCESSING.LUT3dlLoader().load("lut.3dl").then(lutTexture => {
		const lutEffect = new POSTPROCESSING.LUT3DEffect(lutTexture)

		if (!traaTest) {
			if (fps >= 256) {
				composer.addPass(new POSTPROCESSING.EffectPass(camera, ssgiEffect, bloomEffect, vignetteEffect, lutEffect))

				const motionBlurEffect = new MotionBlurEffect(velocityDepthNormalPass)

				composer.addPass(new POSTPROCESSING.EffectPass(camera, motionBlurEffect))
			} else {
				composer.addPass(new POSTPROCESSING.EffectPass(camera, ssgiEffect, vignetteEffect, lutEffect))
				loadFiles--
			}
		}

		traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()

		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)

		if (fps >= 256) {
			setAA("TRAA")

			resize()
		} else {
			setAA("FXAA")
			controls.enableDamping = false

			resize()
		}

		loop()

		const display = pane.element.style.display === "none" ? "block" : "none"

		pane.element.style.display = display
		gui2.pane.element.style.display = display
		infoEl.style.display = "block"
	})
}

const clock = new Clock()

let tappedTwice = false
let tapTimeout

const tapHandler = ev => {
	if (ev.touches.length !== 1) return
	if (!tappedTwice) {
		tappedTwice = true
		clearTimeout(tapTimeout)
		tapTimeout = setTimeout(() => {
			tappedTwice = false
		}, 300)
		return false
	}

	gui2.pane.element.style.visibility = "hidden"
	toggleMenu()
}

document.body.addEventListener("touchstart", tapHandler)

// source: https://stackoverflow.com/a/60207895
function onLongPress(element, callback) {
	let timer

	element.addEventListener("touchstart", ev => {
		if (ev.touches.length !== 1) {
			cancel()
			return
		}
		timer = setTimeout(() => {
			timer = null
			callback()
		}, 500)
	})

	function cancel() {
		clearTimeout(timer)
	}

	element.addEventListener("touchend", cancel)
	element.addEventListener("touchmove", cancel)
}

onLongPress(document.body, () => {
	document.fullscreenElement === null
		? document.body.requestFullscreen({ navigationUI: "hide" })
		: document.exitFullscreen()
})

const loop = () => {
	if (stats?.dom.style.display !== "none") stats.begin()

	const dt = clock.getDelta()

	if (mixer) {
		mixer.update(dt)
		lastScene.updateMatrixWorld()
		refreshLighting()
	}

	if (controls.enableDamping) controls.dampingFactor = 0.075 * 120 * Math.max(1 / 1000, dt)

	controls.update()
	camera.updateMatrixWorld()

	if (postprocessingEnabled) {
		composer.render()
	} else {
		renderer.clear()
		renderer.render(scene, camera)
	}

	if (stats?.dom.style.display !== "none") stats.end()
	window.requestAnimationFrame(loop)
}

const resize = () => {
	camera.aspect = window.innerWidth / window.innerHeight
	camera.updateProjectionMatrix()

	const dpr = window.devicePixelRatio
	renderer.setPixelRatio(fps < 256 ? Math.max(1, dpr * 0.5) : dpr)

	renderer.setSize(window.innerWidth, window.innerHeight)
	composer.setSize(window.innerWidth, window.innerHeight)
}

// event handlers
window.addEventListener("resize", resize)

// source: https://stackoverflow.com/a/2117523/7626841
function uuidv4() {
	return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
		(c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
	)
}

const aaOptions = {
	1: "TRAA",
	2: "MSAA",
	3: "FXAA",
	4: "SMAA",
	5: "Disabled"
}

const aaValues = Object.values(aaOptions)

const toggleMenu = () => {
	const display = gui2.pane.element.style.display === "none" ? "block" : "none"

	pane.element.style.display = display
	gui2.pane.element.style.display = display
	infoEl.style.display = display
}

document.addEventListener("keydown", ev => {
	if (document.activeElement.tagName !== "INPUT") {
		const value = aaOptions[ev.key]

		if (value) setAA(value)
	}

	if (ev.code === "KeyQ") {
		if (traaTest) return

		postprocessingEnabled = !postprocessingEnabled

		refreshLighting()
	}

	if (ev.code === "Tab") {
		ev.preventDefault()

		toggleMenu()
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

		gltflLoader.parse(buffer, "", setupAsset)
	})

	reader.readAsArrayBuffer(file)
})

const pointsObj = new Object3D()
scene.add(pointsObj)

const setupAsset = asset => {
	if (pointsObj.children.length > 0) {
		pointsObj.removeFromParent()
	}

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

	scene.add(asset.scene)
	asset.scene.scale.setScalar(1)

	let planeShaderMaterial
	let cylinderShaderMaterial

	if (traaTest) {
		planeShaderMaterial = new THREE.ShaderMaterial({
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

		cylinderShaderMaterial = new THREE.ShaderMaterial({
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
				float angle = atan(vUv.x * 2. - 1., vUv.y * 2. - 1.);

				float a = cos(16. * angle);
				a = step(a, 0.);

				vec3 color = vec3(a);
	
				gl_FragColor = vec4(color, 1.0);
			  }
			`,
			side: DoubleSide,
			toneMapped: false
		})
	}

	asset.scene.traverse(c => {
		if (c.isMesh) {
			c.castShadow = c.receiveShadow = true
			c.material.depthWrite = true

			if (c.material.transparent) c.material.alphaMap = c.material.roughnessMap

			if (traaTest && c.name === "shader") c.material = planeShaderMaterial

			if (traaTest && c.name === "Cube") c.material = new MeshNormalMaterial()

			if (traaTest && c.name === "Cylinder") c.material = cylinderShaderMaterial

			if (traaTest && c.name === "Plane") {
				c.material.map.minFilter = NearestFilter
				c.material.map.magFilter = NearestFilter
			}
		}

		c.frustumCulled = false
	})

	if (traaTest && !window.location.search.includes("traa_test_model=true")) {
		const material = new THREE.LineBasicMaterial({
			color: 0x0000ff
		})

		for (let i = 0; i < 10; i++) {
			const points = []
			points.push(new THREE.Vector3(0, 8 - i * 0.35, 0))
			points.push(new THREE.Vector3(8, 8 + i * 0.275, 0))

			const geometry = new THREE.BufferGeometry().setFromPoints(points)

			const line = new THREE.Line(geometry, material)
			pointsObj.add(line)

			line.position.set(6, 6, 0)
		}

		const points = []

		for (let i = 0; i < 100; i++) {
			const y = Math.abs(Math.cos(i * Math.PI * 0.1)) * 2
			points.push(new THREE.Vector3((i / 100) * 8, y, 0))
		}

		const geometry = new THREE.BufferGeometry().setFromPoints(points)

		const line = new THREE.Line(geometry, material)
		pointsObj.add(line)

		line.position.set(6, 8, 0)

		let points2 = []

		let geometry2 = new THREE.BufferGeometry().setFromPoints(points2)
		let line2 = new THREE.Line(geometry2, material)

		for (let i = 0; i < 1000; i++) {
			const y = Math.abs(Math.cos(i * Math.PI * 0.01)) * 2
			points2.push(new THREE.Vector3((i / 1000) * 8, y, 0))

			if (i % 2 === 0) {
				pointsObj.add(line2)
				geometry2 = new THREE.BufferGeometry().setFromPoints(points2)
				line2 = new THREE.Line(geometry2, material)
				line2.position.set(6, 8, 0)

				points2 = []
			}
		}
	}

	const clips = asset.animations

	if (clips.length) {
		mixer = new THREE.AnimationMixer(asset.scene)

		for (const clip of clips) {
			const action = mixer.clipAction(clip)

			if (action) action.play()
		}
	}

	const bb = new Box3()
	bb.setFromObject(asset.scene)

	const height = bb.max.y - bb.min.y
	const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
	const targetHeight = 15
	const targetWidth = 45

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
