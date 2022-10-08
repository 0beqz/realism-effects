import { Pass } from "postprocessing"
import {
	FramebufferTexture,
	HalfFloatType,
	LinearFilter,
	NearestFilter,
	Quaternion,
	RGBAFormat,
	Vector2,
	Vector3,
	WebGLRenderTarget
} from "three"
import { TemporalResolveMaterial } from "./material/TemporalResolveMaterial"
import { VelocityPass } from "./pass/VelocityPass"
import { generateHalton23Points } from "./utils/generateHalton23Points"

const zeroVec2 = new Vector2()

const defaultOptions = {
	blend: 0.9,
	renderVelocity: true,
	dilation: false,
	neighborhoodClamping: false,
	logTransform: false,
	customComposeShader: null,
	traa: false,
	velocityPass: null
}

export class TemporalResolvePass extends Pass {
	haltonSequence = []
	haltonIndex = 0
	samples = 1
	lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}

	constructor(scene, camera, options = defaultOptions) {
		super("TemporalResolvePass")

		this._scene = scene
		this._camera = camera
		options = { ...defaultOptions, ...options }

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		this.renderVelocity = options.renderVelocity
		this.velocityPass = options.velocityPass || new VelocityPass(scene, camera, { renderDepth: true })
		this.usingOwnVelocityPass = options.velocityPass !== this.velocityPass

		this.fullscreenMaterial = new TemporalResolveMaterial()
		if (typeof options.customComposeShader === "string") {
			this.fullscreenMaterial.defines.useCustomComposeShader = ""

			this.fullscreenMaterial.fragmentShader = this.fullscreenMaterial.fragmentShader.replace(
				"customComposeShader",
				options.customComposeShader
			)
		}

		if (options.dilation) this.fullscreenMaterial.defines.dilation = ""
		if (options.neighborhoodClamping) this.fullscreenMaterial.defines.neighborhoodClamping = ""
		if (options.logTransform) this.fullscreenMaterial.defines.logTransform = ""

		this.traa = options.traa

		this.fullscreenMaterial.uniforms.velocityTexture.value = this.velocityPass.texture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.velocityPass.depthTexture

		this.setupFramebuffers(1, 1)
	}

	dispose() {
		this.renderTarget.dispose()
		this.accumulatedTexture.dispose()
		this.lastDepthTexture.dispose()
		this.fullscreenMaterial.dispose()

		if (this.usingOwnVelocityPass) this.velocityPass.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
		if (this.usingOwnVelocityPass) this.velocityPass.setSize(width, height)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)
		this.setupFramebuffers(width, height)
	}

	setupFramebuffers(width, height) {
		if (this.accumulatedTexture) this.accumulatedTexture.dispose()

		this.accumulatedTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.accumulatedTexture.minFilter = LinearFilter // we need to use LinearFilter here otherwise we get distortions when reprojecting
		this.accumulatedTexture.magFilter = LinearFilter
		this.accumulatedTexture.type = HalfFloatType

		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.accumulatedTexture

		this.lastDepthTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.lastDepthTexture.minFilter = NearestFilter
		this.lastDepthTexture.magFilter = NearestFilter
	}

	checkNeedsResample() {
		const moveDist = this.lastCameraTransform.position.distanceToSquared(this._camera.position)
		const rotateDist = 8 * (1 - this.lastCameraTransform.quaternion.dot(this._camera.quaternion))

		if (moveDist > 0.000001 || rotateDist > 0.000001) {
			this.samples = 1

			this.lastCameraTransform.position.copy(this._camera.position)
			this.lastCameraTransform.quaternion.copy(this._camera.quaternion)
		}
	}

	render(renderer) {
		this.samples++
		this.checkNeedsResample()
		this.fullscreenMaterial.uniforms.samples.value = this.samples

		if (this.traa) this.unjitter()

		if (this.renderVelocity && this.usingOwnVelocityPass) this.velocityPass.render(renderer)

		if (this.traa) this.jitter()

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		// save the render target's texture for use in next frame
		renderer.copyFramebufferToTexture(zeroVec2, this.accumulatedTexture)

		renderer.setRenderTarget(this.velocityPass.depthRenderTarget)
		renderer.copyFramebufferToTexture(zeroVec2, this.lastDepthTexture)
		this.fullscreenMaterial.uniforms.lastDepthTexture.value = this.lastDepthTexture
	}

	jitter(jitterScale = 1) {
		this.unjitter()

		if (this.haltonSequence.length === 0) this.haltonSequence = generateHalton23Points(16)

		// cheap trick to get rid of aliasing on the final buffer (technique known from TAA)
		this.haltonIndex = (this.haltonIndex + 1) % this.haltonSequence.length

		const [x, y] = this.haltonSequence[this.haltonIndex]

		const { width, height } = this.renderTarget

		if (this._camera.setViewOffset)
			this._camera.setViewOffset(width, height, x * jitterScale, y * jitterScale, width, height)
	}

	unjitter() {
		if (this._camera.clearViewOffset) this._camera.clearViewOffset()
	}
}
