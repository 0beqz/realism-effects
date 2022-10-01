﻿import { Pass } from "postprocessing"
import {
	FramebufferTexture,
	HalfFloatType,
	LinearFilter,
	Matrix4,
	NearestFilter,
	Quaternion,
	RGBAFormat,
	sRGBEncoding,
	Vector2,
	Vector3,
	WebGLRenderTarget
} from "three"
import { CopyDepthPass } from "../pass/CopyDepthPass"
import { TemporalResolveMaterial } from "./material/TemporalResolveMaterial"
import { VelocityPass } from "./pass/VelocityPass"
import { generateHalton23Points } from "./utils/generateHalton23Points"

const zeroVec2 = new Vector2()

export class TemporalResolvePass extends Pass {
	haltonSequence = []
	haltonIndex = 0
	samples = 1
	unjitterCameraProjectionMatrix = new Matrix4()
	lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}

	constructor(
		scene,
		camera,
		options = {
			renderVelocity: true,
			dilation: false,
			maxNeighborDepthDifference: 1,
			logTransform: false,
			neighborhoodClamping: true,
			customComposeShader: null
		}
	) {
		super("TemporalResolvePass")

		this._scene = scene
		this._camera = camera

		this.unjitterCameraProjectionMatrix.copy(this._camera.projectionMatrix)

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			encoding: sRGBEncoding,
			depthBuffer: false
		})

		if (options.renderVelocity !== undefined) this.renderVelocity = options.renderVelocity
		this.velocityPass = new VelocityPass(scene, camera)

		this.fullscreenMaterial = new TemporalResolveMaterial()
		if (typeof options.customComposeShader === "string") {
			this.fullscreenMaterial.defines.useCustomComposeShader = ""

			this.fullscreenMaterial.fragmentShader = this.fullscreenMaterial.fragmentShader.replace(
				"customComposeShader",
				options.customComposeShader
			)
		}

		this.fullscreenMaterial.defines.correctionRadius =
			options.correctionRadius === undefined ? 1 : options.correctionRadius

		if (options.dilation) this.fullscreenMaterial.defines.dilation = ""
		if (options.logTransform) this.fullscreenMaterial.defines.logTransform = ""
		if (options.neighborhoodClamping) this.fullscreenMaterial.defines.neighborhoodClamping = ""

		if (options.maxNeighborDepthDifference !== undefined)
			this.fullscreenMaterial.defines.maxNeighborDepthDifference = options.maxNeighborDepthDifference.toFixed(5)

		let qualityScale = options.qualityScale === undefined ? 1 : options.qualityScale

		Object.defineProperty(this, "qualityScale", {
			get() {
				return qualityScale
			},
			set(value) {
				qualityScale = value

				this.setSize(this.renderTarget.width, this.renderTarget.height)
			}
		})

		this.setupFramebuffers(1, 1)

		this.copyDepthPass = new CopyDepthPass()
	}

	dispose() {
		if (this._scene.userData.velocityTexture === this.velocityPass.renderTarget.texture) {
			delete this._scene.userData.velocityTexture
			delete this._scene.userData.lastVelocityTexture
		}

		this.renderTarget.dispose()
		this.accumulatedTexture.dispose()
		this.fullscreenMaterial.dispose()
		this.velocityPass.dispose()
		this.copyDepthPass.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
		this.velocityPass.setSize(width * this.qualityScale, height * this.qualityScale)
		this.copyDepthPass.setSize(width * this.qualityScale, height * this.qualityScale)
		this.velocityPass.renderTarget.texture.needsUpdate = true

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)
		this.setupFramebuffers(width, height)
	}

	setupFramebuffers(width, height) {
		if (this.accumulatedTexture) this.accumulatedTexture.dispose()
		if (this.lastVelocityTexture) this.lastVelocityTexture.dispose()

		this.accumulatedTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.accumulatedTexture.minFilter = LinearFilter
		this.accumulatedTexture.magFilter = LinearFilter
		this.accumulatedTexture.type = HalfFloatType

		this.lastVelocityTexture = new FramebufferTexture(width * this.qualityScale, height * this.qualityScale, RGBAFormat)
		this.lastVelocityTexture.minFilter = NearestFilter
		this.lastVelocityTexture.magFilter = NearestFilter

		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.accumulatedTexture
		this.fullscreenMaterial.uniforms.lastVelocityTexture.value = this.lastVelocityTexture

		this.fullscreenMaterial.needsUpdate = true
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

	saveLastVelocityTexture(renderer, renderTarget) {
		renderer.setRenderTarget(renderTarget)
		renderer.copyFramebufferToTexture(zeroVec2, this.lastVelocityTexture)
	}

	render(renderer) {
		this.samples++
		this.checkNeedsResample()
		this.fullscreenMaterial.uniforms.samples.value = this.samples

		this.velocityPass.render(renderer)

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		// save the render target's texture for use in next frame
		renderer.copyFramebufferToTexture(zeroVec2, this.accumulatedTexture)

		if (this.renderVelocity) this.saveLastVelocityTexture(renderer, this.velocityPass.renderTarget)

		this.copyDepthPass.fullscreenMaterial.uniforms.copyTexture.value = window.ssgiEffect.ssgiPass.depthTexture

		this.copyDepthPass.render(renderer)

		this.fullscreenMaterial.uniforms.depthTexture.value = window.ssgiEffect.ssgiPass.depthTexture
		this.fullscreenMaterial.uniforms.lastDepthTexture.value = this.copyDepthPass.renderTarget.texture
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
		this.unjitterCameraProjectionMatrix.copy(this._camera.projectionMatrix)
	}
}