import { getGPUTier } from "detect-gpu"
import dragDrop from "drag-drop"
import * as POSTPROCESSING from "postprocessing"
import { MotionBlurEffect, SSGIEffect, SSREffect, TRAAEffect } from "realism-effects"
import Stats from "stats-gl"
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
import { GroundProjectedSkybox } from "three/examples/jsm/objects/GroundProjectedSkybox"
import { Pane } from "tweakpane"
import { SharpnessEffect } from "../src/sharpness/SharpnessEffect"
import { TAAPass } from "../src/taa/TAAPass"
import { VelocityDepthNormalPass } from "../src/temporal-reproject/pass/VelocityDepthNormalPass"
import { SSGIDebugGUI } from "./SSGIDebugGUI"
import "./style.css"
import { GradualBackgroundEffect } from "../src/gradual-background/GradualBackgroundEffect"
import { SparkleEffect } from "../src/sparkle/SparkleEffect"

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
let taaPass
const guiParams = {
	Method: "TRAA",
	Background: false
}

// if the URL contains "ao" then the AO demo will be loaded
const isAoDemo = window.location.search.includes("ao")

// extract if the paramaterer "traa_test" is set to true in the URL
const traaTest = new URLSearchParams(window.location.search).get("traa_test") === "true"

const scene = new THREE.Scene()
scene.matrixWorldAutoUpdate = false
window.scene = scene

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 250)
// const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 250)

window.camera = camera

// const w = window.innerWidth
// const h = window.innerHeight
// const camera = new THREE.OrthographicCamera(w / -2 / 100, w / 2 / 100, h / 2 / 100, h / -2 / 100, 0.01, 250)
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

const rendererCanvas = canvas

// use an offscreen canvas if available
// if (window.OffscreenCanvas && !navigator.userAgent.toLowerCase().includes("firefox")) {
// 	rendererCanvas = canvas.transferControlToOffscreen()
// 	rendererCanvas.style = canvas.style
// 	rendererCanvas.toDataURL = canvas.toDataURL.bind(canvas)
// }

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
controls.minDistance = 5
window.controls = controls
window.camera = camera

if (isAoDemo) {
	camera.position.fromArray([4, 3, 0])
	controls.target.set(0, 3, 0)
}

const composer = new POSTPROCESSING.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })

const lightParams = {
	yaw: 55,
	pitch: 27,
	intensity: 2.5
}

const light = new DirectionalLight(0xffffff, lightParams.intensity)
light.updateMatrixWorld()
light.castShadow = true
// scene.add(light)

// const fog = new THREE.FogExp2(0xffffff, 0.025)
// const fog = new THREE.Fog(0xffffff, 10, 10.0001)
// scene.fog = fog

const useRenderPass = false

if (useRenderPass || scene.getObjectByProperty("isDirectionalLight", true)) {
	const renderPass = new POSTPROCESSING.RenderPass(scene, camera)
	composer.addPass(renderPass)
}

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

const stats = new Stats({
	logsPerSecond: 100,
	samplesLog: 100,
	samplesGraph: 10,
	precision: 2
})

stats.init(renderer.domElement)

// append the stats container to the body of the document
document.body.appendChild(stats.container)

const rgbeLoader = new RGBELoader().setDataType(FloatType)

const initEnvMap = async envMap => {
	scene.environment?.dispose()
	envMap.mapping = EquirectangularReflectionMapping
	scene.environment = envMap
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

		envMesh = new GroundProjectedSkybox(envMap)
		envMesh.radius = 100
		envMesh.height = 20
		envMesh.scale.setScalar(100)
		envMesh.updateMatrixWorld()
		// scene.add(envMesh)

		const skyBlueColor = new Color(0x90b4f5)
		scene.background = skyBlueColor

		if (taaPass) taaPass.needsUpdate = true
	}
}

const environments = [
	"blue_grotto",
	"cave_wall",
	"chinese_garden",
	"future_parking",
	"quarry_02",
	"snowy_field",
	"studio_small_08",
	"vintage_measuring_lab",
	"# cube map test"
]

rgbeLoader.load("hdr/spree_bank_1k.hdr", initEnvMap)

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
	if (isAoDemo) {
		url = "sponza_no_textures.optimized.glb"
		loadFiles = 4
	} else {
		url = "squid_game.optimized.glb"
		loadFiles = 9
	}
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

	if (loadedCount >= loadFiles) {
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

// when the mouse moves, update the light yaw and pitch based on the mouse position
document.addEventListener("mousemove", ev => {
	// check if control is pressed
	if (!ev.ctrlKey) return

	lightParams.yaw = (ev.clientX / window.innerWidth) * 360
	lightParams.pitch = (1 - ev.clientY / window.innerHeight) * 180

	refreshLighting()
	if (ssgiEffect) ssgiEffect.reset()
	if (taaPass) taaPass.needsUpdate = true
})

const initScene = async () => {
	const gpuTier = await getGPUTier()
	fps = gpuTier.fps

	const options = {
		distance: 5.980000000000011,
		thickness: 2.829999999999997,
		denoiseIterations: 1,
		denoiseKernel: 3,
		denoiseDiffuse: 25,
		denoiseSpecular: 25.54,
		radius: 16,
		phi: 0.1,
		lumaPhi: 25.543,
		depthPhi: 6.522000000000001,
		normalPhi: 40.217,
		roughnessPhi: 28.261,
		specularPhi: 2.771999999999999,
		envBlur: 0,
		importanceSampling: true,
		steps: 20,
		refineSteps: 4,
		spp: 1,
		resolutionScale: 1,
		missedRays: false
	}

	const velocityDepthNormalPass = new VelocityDepthNormalPass(scene, camera)
	composer.addPass(velocityDepthNormalPass)
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.5

	traaEffect = new TRAAEffect(scene, camera, velocityDepthNormalPass)

	pane = new Pane()
	pane.containerElem_.style.userSelect = "none"
	pane.containerElem_.style.width = "380px"

	const aaFolder = pane.addFolder({ title: "Anti-aliasing", expanded: false })

	aaFolder
		.addBinding(guiParams, "Method", {
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
		"squid_game",
		"amg",
		"chevrolet",
		"clay_bust_study",
		"cyberpunk_bike",
		"cyber_samurai",
		"darth_vader",
		"flashbang_grenade",
		"motorbike",
		"statue",
		"swordsman"
	]

	const sceneParams = { Environment: "vintage_measuring_lab", Model: "sg_bake" }

	const envObject = {}
	const modelObject = {}

	environments.forEach(value => (envObject[value] = value))
	modelNames.forEach(value => (modelObject[value] = value))

	const assetsFolder = pane.addFolder({ title: "Assets" })
	assetsFolder
		.addBinding(sceneParams, "Environment", {
			options: envObject
		})
		.on("change", ev => {
			if (ev.value === "# cube map test") {
				cubeMapTest()
				return
			}

			// rgbeLoader.load("hdr/8k/" + ev.value + "_8k.hdr", initEnvMap)
			rgbeLoader.load("hdr/" + ev.value + "_1k.hdr", initEnvMap)
		})

	let curModel = modelNames[0]

	assetsFolder
		.addBinding(sceneParams, "Model", {
			options: modelObject
		})
		.on("change", ev => {
			if (ev.value === curModel) return
			curModel = ev.value

			gltflLoader.load(ev.value + ".optimized.glb", setupAsset)
		})

	const bloomEffect = new POSTPROCESSING.BloomEffect({
		intensity: 1,
		mipmapBlur: true,
		luminanceSmoothing: 11.25,
		luminanceThreshold: 0.75,
		kernelSize: POSTPROCESSING.KernelSize.MEDIUM
	})

	const vignetteEffect = new POSTPROCESSING.VignetteEffect({
		darkness: 0.8,
		offset: 0.3
	})

	ssgiEffect = new SSGIEffect(composer, scene, camera, { ...options, velocityDepthNormalPass })
	// ssgiEffect = new SSREffect(composer, scene, camera, {
	// 	denoiseMode: "full_temporal",
	// 	velocityDepthNormalPass
	// })
	window.ssgiEffect = ssgiEffect

	// scene.traverse(c => {
	// 	if (c.name === "Object_2") ssgiEffect.selection.add(c)
	// })

	gui2 = new SSGIDebugGUI(ssgiEffect, options)
	gui2.pane.containerElem_.style.left = "8px"
	gui2.pane.containerElem_.style.top = "56px"
	if (traaTest) gui2.pane.element.style.visibility = "hidden"

	gui2.pane.on("change", ev => (taaPass.needsUpdate = true))

	new POSTPROCESSING.LUT3dlLoader().load("lut.3dl").then(lutTexture => {
		const lutEffect = new POSTPROCESSING.LUT3DEffect(lutTexture)

		const toneMappingEffect = new POSTPROCESSING.ToneMappingEffect()
		toneMappingEffect.mode = POSTPROCESSING.ToneMappingMode.ACES_FILMIC

		if (!traaTest) {
			if (fps >= 256) {
				const sharpnessEffect = new SharpnessEffect({ sharpness: 0.75 })

				// const depthTexture = ssgiEffect.depthTexture
				const gBufferPass = ssgiEffect.ssgiPass.gBufferPass
				// const bgColor = new Color(0xffffff)

				// const gradualBackgroundEffect = new GradualBackgroundEffect(camera, depthTexture, bgColor, 51)
				const sparkleEffect = new SparkleEffect(camera, gBufferPass)
				// composer.addPass(new POSTPROCESSING.EffectPass(camera, ssgiEffect, toneMappingEffect))

				// add a render pass
				composer.addPass(new POSTPROCESSING.RenderPass(scene, camera))

				traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)

				taaPass = new TAAPass(camera)
				composer.addPass(traaPass)

				// const motionBlurEffect = new MotionBlurEffect(velocityDepthNormalPass, {
				// 	intensity: 1
				// })

				composer.addPass(new POSTPROCESSING.EffectPass(camera, sharpnessEffect, sparkleEffect))
				composer.addPass(new POSTPROCESSING.EffectPass(camera, bloomEffect))
			} else {
				composer.addPass(
					new POSTPROCESSING.EffectPass(camera, ssgiEffect, toneMappingEffect, vignetteEffect, lutEffect)
				)
				loadFiles--
			}
		}

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()
		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)

		if (!isAoDemo) {
			if (fps >= 256) {
				// setAA("SMAA")
				resize()
			} else {
				setAA("FXAA")
				controls.enableDamping = false

				resize()
			}
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
	stats.begin()

	const dt = clock.getDelta()

	if (mixer) {
		mixer.update(dt)
		lastScene.updateMatrixWorld()
		refreshLighting()
	}

	// light.color.setHSL(Math.sin(performance.now() / 5000), 1, 0.6)
	// lightParams.yaw = (lightParams.yaw + 40 * dt) % 360

	// refreshLighting()

	if (controls.enableDamping) controls.dampingFactor = 0.075 * 120 * Math.max(1 / 1000, dt)

	controls.update()
	camera.updateMatrixWorld()

	if (postprocessingEnabled) {
		composer.render()
	} else {
		renderer.clear()
		renderer.render(scene, camera)
	}

	stats.end()
	window.requestAnimationFrame(loop)
}

const resize = () => {
	camera.aspect = window.innerWidth / window.innerHeight
	camera.updateProjectionMatrix()

	const dpr = window.devicePixelRatio
	renderer.setPixelRatio(fps < 256 ? Math.max(1, dpr * 0.5) : dpr)

	renderer.setSize(window.innerWidth, window.innerHeight)
	composer.setSize(window.innerWidth, window.innerHeight)

	const w = window.innerWidth
	const h = window.innerHeight

	if (camera.isOrthographicCamera) {
		camera.left = w / -2 / 100
		camera.right = w / 2 / 100
		camera.top = h / 2 / 100
		camera.bottom = h / -2 / 100

		camera.updateProjectionMatrix()
	}
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

	taaPass.needsUpdate = true
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

	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry(100, 100),
		new THREE.MeshStandardMaterial({
			metalness: 0,
			roughness: 0
		})
	)

	ground.rotation.x = -Math.PI / 2
	ground.receiveShadow = true
	ground.updateMatrixWorld()
	// scene.add(ground)

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
	if (ssgiEffect) ssgiEffect.reset()

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

			if (traaTest && c.name === "shader") c.material = planeShaderMaterial

			if (traaTest && c.name === "Cube") c.material = new MeshNormalMaterial()

			if (traaTest && c.name === "Cylinder") c.material = cylinderShaderMaterial

			if (traaTest && c.name === "Plane") {
				c.material.map.minFilter = NearestFilter
				c.material.map.magFilter = NearestFilter
			}

			// c.material.transparent = true
			// c.material.opacity = 0.25
			// const lm = c.material.emissiveMap
			// c.material.emissiveMap = null
			// c.material.emissive = new Color(0x000000)
			// c.material.emissiveIntensity = 0.0
			// c.material.lightMap = lm
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

	if (taaPass) taaPass.needsUpdate = true

	requestAnimationFrame(refreshLighting)
}
