import { Pass } from "postprocessing"
import { HalfFloatType, LinearFilter, NearestFilter, Quaternion, Vector3, WebGLMultipleRenderTargets } from "three"
import { CopyPass } from "../ssgi/pass/CopyPass"
import { TemporalReprojectMaterial } from "./material/TemporalReprojectMaterial"
import { generateR2 } from "./utils/QuasirandomGenerator"

export const defaultTemporalReprojectPassOptions = {
	blend: 0.9,
	dilation: false,
	constantBlend: false,
	fullAccumulate: false,
	catmullRomSampling: true,
	neighborhoodClamping: false,
	logTransform: false,
	depthDistance: 0.1,
	normalDistance: 5,
	worldDistance: 0.25,
	reprojectSpecular: false,
	customComposeShader: null,
	renderTarget: null
}

export class TemporalReprojectPass extends Pass {
	r2Sequence = []
	pointsIndex = 0
	lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}

	constructor(scene, camera, velocityPass, textureCount = 1, options = defaultTemporalReprojectPassOptions) {
		super("TemporalReprojectPass")

		this._scene = scene
		this._camera = camera
		this.textureCount = textureCount
		options = { ...defaultTemporalReprojectPassOptions, ...options }

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, textureCount, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		this.fullscreenMaterial = new TemporalReprojectMaterial(textureCount, options.customComposeShader)
		this.fullscreenMaterial.defines.textureCount = textureCount

		if (options.dilation) this.fullscreenMaterial.defines.dilation = ""
		if (options.neighborhoodClamping) this.fullscreenMaterial.defines.neighborhoodClamping = ""
		if (options.logTransform) this.fullscreenMaterial.defines.logTransform = ""

		this.fullscreenMaterial.defines.depthDistance = options.depthDistance.toPrecision(5)
		this.fullscreenMaterial.defines.normalDistance = options.normalDistance.toPrecision(5)
		this.fullscreenMaterial.defines.worldDistance = options.worldDistance.toPrecision(5)

		this.fullscreenMaterial.uniforms.blend.value = options.blend
		this.fullscreenMaterial.uniforms.constantBlend.value = options.constantBlend
		this.fullscreenMaterial.uniforms.fullAccumulate.value = options.fullAccumulate

		this.fullscreenMaterial.uniforms.projectionMatrix.value = camera.projectionMatrix
		this.fullscreenMaterial.uniforms.projectionMatrixInverse.value = camera.projectionMatrixInverse
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = camera.matrixWorld
		this.fullscreenMaterial.uniforms.viewMatrix.value = camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.cameraPos.value = camera.position
		this.fullscreenMaterial.uniforms.prevViewMatrix.value = camera.matrixWorldInverse.clone()
		this.fullscreenMaterial.uniforms.prevCameraMatrixWorld.value = camera.matrixWorld.clone()

		// init copy pass to save the accumulated textures and the textures from the last frame
		this.copyPass = new CopyPass(2 + textureCount)

		for (let i = 0; i < textureCount; i++) {
			const accumulatedTexture = this.copyPass.renderTarget.texture[2 + i]
			accumulatedTexture.type = HalfFloatType
			accumulatedTexture.minFilter = LinearFilter
			accumulatedTexture.magFilter = LinearFilter
			accumulatedTexture.needsUpdate = true
		}

		const lastDepthTexture = this.copyPass.renderTarget.texture[0]
		lastDepthTexture.minFilter = NearestFilter
		lastDepthTexture.magFilter = NearestFilter
		lastDepthTexture.needsUpdate = true
		this.fullscreenMaterial.uniforms.lastDepthTexture.value = lastDepthTexture

		const lastNormalTexture = this.copyPass.renderTarget.texture[1]
		lastNormalTexture.type = HalfFloatType
		lastNormalTexture.minFilter = NearestFilter
		lastNormalTexture.magFilter = NearestFilter
		lastNormalTexture.needsUpdate = true
		this.fullscreenMaterial.uniforms.lastNormalTexture.value = lastNormalTexture

		this.fullscreenMaterial.uniforms.velocityTexture.value = velocityPass.texture
		this.fullscreenMaterial.uniforms.depthTexture.value = velocityPass.depthTexture
		this.fullscreenMaterial.uniforms.normalTexture.value = velocityPass.normalTexture

		if (typeof options.reprojectSpecular === "boolean") {
			options.reprojectSpecular = Array(textureCount).fill(options.reprojectSpecular)
		}

		this.fullscreenMaterial.defines.reprojectSpecular = /* glsl */ `bool[](${options.reprojectSpecular.join(", ")})`

		if (typeof options.catmullRomSampling === "boolean") {
			options.catmullRomSampling = Array(textureCount).fill(options.catmullRomSampling)
		}

		this.fullscreenMaterial.defines.catmullRomSampling = /* glsl */ `bool[](${options.catmullRomSampling.join(", ")})`

		this.options = options
	}

	dispose() {
		this.renderTarget.dispose()
		this.copyPass.dispose()
		this.fullscreenMaterial.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
		this.copyPass.setSize(width, height)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)
	}

	get texture() {
		return this.renderTarget.texture[0]
	}

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		// save the last depth and normal buffers
		this.copyPass.fullscreenMaterial.uniforms.inputTexture0.value = this.fullscreenMaterial.uniforms.depthTexture.value
		this.copyPass.fullscreenMaterial.uniforms.inputTexture1.value = this.fullscreenMaterial.uniforms.normalTexture.value

		for (let i = 0; i < this.textureCount; i++) {
			this.copyPass.fullscreenMaterial.uniforms["inputTexture" + (2 + i)].value = this.renderTarget.texture[i]
			this.fullscreenMaterial.uniforms["accumulatedTexture" + i].value = this.copyPass.renderTarget.texture[2 + i]
		}

		this.copyPass.render(renderer)

		// save last transformations
		this.fullscreenMaterial.uniforms.prevCameraMatrixWorld.value.copy(this._camera.matrixWorld)
		this.fullscreenMaterial.uniforms.prevViewMatrix.value.copy(this._camera.matrixWorldInverse)
	}

	jitter(jitterScale = 1) {
		this.unjitter()

		if (this.r2Sequence.length === 0) this.r2Sequence = generateR2(256).map(([a, b]) => [a - 0.5, b - 0.5])

		this.pointsIndex = (this.pointsIndex + 1) % this.r2Sequence.length

		const [x, y] = this.r2Sequence[this.pointsIndex]

		const { width, height } = this.renderTarget

		if (this._camera.setViewOffset)
			this._camera.setViewOffset(width, height, x * jitterScale, y * jitterScale, width, height)
	}

	unjitter() {
		if (this._camera.clearViewOffset) this._camera.clearViewOffset()
	}
}
