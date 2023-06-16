﻿import { Pass } from "postprocessing"
import {
	Clock,
	HalfFloatType,
	LinearFilter,
	Matrix4,
	Quaternion,
	Uniform,
	Vector3,
	WebGLMultipleRenderTargets
} from "three"
import { CopyPass } from "../ssgi/pass/CopyPass"
import { TemporalReprojectMaterial } from "./material/TemporalReprojectMaterial"
import { generateR2 } from "./utils/QuasirandomGenerator"

export const defaultTemporalReprojectPassOptions = {
	blend: 0.9,
	dilation: false,
	constantBlend: false,
	fullAccumulate: false,
	neighborhoodClamp: false,
	neighborhoodClampRadius: 1,
	neighborhoodClampIntensity: 1,
	logTransform: false,
	depthDistance: 2,
	worldDistance: 4,
	reprojectSpecular: false,
	temporalReprojectCustomComposeShader: null,
	renderTarget: null
}

const tmpProjectionMatrix = new Matrix4()
const tmpProjectionMatrixInverse = new Matrix4()

export class TemporalReprojectPass extends Pass {
	needsSwap = false

	overrideAccumulatedTextures = []
	clock = new Clock()
	r2Sequence = []
	pointsIndex = 0
	lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}

	constructor(scene, camera, velocityDepthNormalPass, textureCount = 1, options = defaultTemporalReprojectPassOptions) {
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

		this.renderTarget.texture.forEach(
			(texture, index) => (texture.name = "TemporalReprojectPass.accumulatedTexture" + index)
		)

		this.fullscreenMaterial = new TemporalReprojectMaterial(textureCount, options.temporalReprojectCustomComposeShader)
		this.fullscreenMaterial.defines.textureCount = textureCount

		if (options.dilation) this.fullscreenMaterial.defines.dilation = ""
		if (options.neighborhoodClamp) this.fullscreenMaterial.defines.neighborhoodClamp = ""
		if (options.logTransform) this.fullscreenMaterial.defines.logTransform = ""
		this.fullscreenMaterial.defines.neighborhoodClampRadius = parseInt(options.neighborhoodClampRadius)

		this.fullscreenMaterial.defines.depthDistance = options.depthDistance.toPrecision(5)
		this.fullscreenMaterial.defines.worldDistance = options.worldDistance.toPrecision(5)

		this.fullscreenMaterial.uniforms.blend.value = options.blend
		this.fullscreenMaterial.uniforms.constantBlend.value = options.constantBlend
		this.fullscreenMaterial.uniforms.fullAccumulate.value = options.fullAccumulate
		this.fullscreenMaterial.uniforms.neighborhoodClampIntensity.value = options.neighborhoodClampIntensity

		this.fullscreenMaterial.uniforms.projectionMatrix.value = camera.projectionMatrix.clone()
		this.fullscreenMaterial.uniforms.projectionMatrixInverse.value = camera.projectionMatrixInverse.clone()
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = camera.matrixWorld
		this.fullscreenMaterial.uniforms.viewMatrix.value = camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.cameraPos.value = camera.position

		this.fullscreenMaterial.uniforms.prevViewMatrix.value = camera.matrixWorldInverse.clone()
		this.fullscreenMaterial.uniforms.prevCameraMatrixWorld.value = camera.matrixWorld.clone()
		this.fullscreenMaterial.uniforms.prevProjectionMatrix.value = camera.projectionMatrix.clone()
		this.fullscreenMaterial.uniforms.prevProjectionMatrixInverse.value = camera.projectionMatrixInverse.clone()

		// init copy pass to save the accumulated textures and the textures from the last frame
		this.copyPass = new CopyPass(textureCount)

		for (let i = 0; i < textureCount; i++) {
			const accumulatedTexture = this.copyPass.renderTarget.texture[i]
			accumulatedTexture.type = HalfFloatType
			accumulatedTexture.minFilter = LinearFilter
			accumulatedTexture.magFilter = LinearFilter
			accumulatedTexture.needsUpdate = true
		}

		this.fullscreenMaterial.uniforms.velocityTexture.value = velocityDepthNormalPass.renderTarget.texture
		this.fullscreenMaterial.uniforms.depthTexture.value = velocityDepthNormalPass.depthTexture

		for (const opt of ["reprojectSpecular", "neighborhoodClamp"]) {
			let value = options[opt]

			if (typeof value !== "array") value = Array(textureCount).fill(value)

			this.fullscreenMaterial.defines[opt] = /* glsl */ `bool[](${value.join(", ")})`
		}

		this.options = options
		this.velocityDepthNormalPass = velocityDepthNormalPass
	}

	setTextures(textures) {
		if (!Array.isArray(textures)) textures = [textures]

		for (let i = 0; i < textures.length; i++) {
			const texture = textures[i]
			this.fullscreenMaterial.uniforms["inputTexture" + i] = new Uniform(texture)
		}
	}

	dispose() {
		super.dispose()

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

	reset() {
		this.fullscreenMaterial.uniforms.reset.value = true
	}

	render(renderer) {
		const delta = Math.min(1 / 10, this.clock.getDelta())
		this.fullscreenMaterial.uniforms.delta.value = delta

		tmpProjectionMatrix.copy(this._camera.projectionMatrix)
		tmpProjectionMatrixInverse.copy(this._camera.projectionMatrixInverse)

		if (this._camera.view) this._camera.view.enabled = false
		this._camera.updateProjectionMatrix()

		this.fullscreenMaterial.uniforms.projectionMatrix.value.copy(this._camera.projectionMatrix)
		this.fullscreenMaterial.uniforms.projectionMatrixInverse.value.copy(this._camera.projectionMatrixInverse)
		this.fullscreenMaterial.uniforms.lastVelocityTexture.value = this.velocityDepthNormalPass.lastVelocityTexture

		if (this._camera.view) this._camera.view.enabled = true
		this._camera.projectionMatrix.copy(tmpProjectionMatrix)
		this._camera.projectionMatrixInverse.copy(tmpProjectionMatrixInverse)

		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
		this.fullscreenMaterial.uniforms.reset.value = false

		for (let i = 0; i < this.textureCount; i++) {
			// this.copyPass.fullscreenMaterial.uniforms["inputTexture" + i].value = this.renderTarget.texture[i]

			const accumulatedTexture =
				this.overrideAccumulatedTextures.length === 0
					? this.copyPass.renderTarget.texture[i]
					: this.overrideAccumulatedTextures[i]
			this.fullscreenMaterial.uniforms["accumulatedTexture" + i].value = accumulatedTexture
		}

		// this.copyPass.render(renderer)

		// save last transformations
		this.fullscreenMaterial.uniforms.prevCameraMatrixWorld.value.copy(this._camera.matrixWorld)
		this.fullscreenMaterial.uniforms.prevViewMatrix.value.copy(this._camera.matrixWorldInverse)

		this.fullscreenMaterial.uniforms.prevProjectionMatrix.value.copy(
			this.fullscreenMaterial.uniforms.projectionMatrix.value
		)
		this.fullscreenMaterial.uniforms.prevProjectionMatrixInverse.value.copy(
			this.fullscreenMaterial.uniforms.projectionMatrixInverse.value
		)

		this.fullscreenMaterial.uniforms.prevCameraPos.value.copy(this._camera.position)
	}

	jitter(jitterScale = 1) {
		this.unjitter()

		if (this.r2Sequence.length === 0) this.r2Sequence = generateR2(256).map(([a, b]) => [a - 0.5, b - 0.5])

		this.pointsIndex = (this.pointsIndex + 1) % this.r2Sequence.length

		const [x, y] = this.r2Sequence[this.pointsIndex]

		const { width, height } = this.renderTarget

		if (this._camera.setViewOffset) {
			this._camera.setViewOffset(width, height, x * jitterScale, y * jitterScale, width, height)
		}
	}

	unjitter() {
		if (this._camera.clearViewOffset) this._camera.clearViewOffset()
	}
}
