import { Pass } from "postprocessing"
import {
	Clock,
	FramebufferTexture,
	LinearFilter,
	Matrix4,
	NearestFilter,
	Quaternion,
	Vector2,
	Vector3,
	WebGLMultipleRenderTargets
} from "three"
import { jitter } from "../taa/TAAUtils"
import { TemporalReprojectMaterial } from "./material/TemporalReprojectMaterial"
import { didCameraMove } from "../utils/SceneUtils"

export const defaultTemporalReprojectPassOptions = {
	dilation: false,
	fullAccumulate: false,
	neighborhoodClamp: false,
	neighborhoodClampRadius: 1,
	neighborhoodClampIntensity: 1,
	maxBlend: 1,
	logTransform: false,
	depthDistance: 2,
	worldDistance: 4,
	reprojectSpecular: false,
	renderTarget: null,
	copyTextures: true,
	confidencePower: 1,
	inputType: "diffuse"
}

const tmpProjectionMatrix = new Matrix4()
const tmpProjectionMatrixInverse = new Matrix4()
const tmpVec2 = new Vector2()

export class TemporalReprojectPass extends Pass {
	needsSwap = false

	overrideAccumulatedTextures = []
	clock = new Clock()
	r2Sequence = []
	frame = 0
	lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}

	constructor(
		scene,
		camera,
		velocityDepthNormalPass,
		texture,
		textureCount,
		options = defaultTemporalReprojectPassOptions
	) {
		super("TemporalReprojectPass")

		this._scene = scene
		this._camera = camera
		this.textureCount = textureCount
		options = { ...defaultTemporalReprojectPassOptions, ...options }

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, textureCount, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: texture.type,
			depthBuffer: false
		})

		this.renderTarget.texture.forEach(
			(texture, index) => (texture.name = "TemporalReprojectPass.accumulatedTexture" + index)
		)

		this.fullscreenMaterial = new TemporalReprojectMaterial(textureCount)
		this.fullscreenMaterial.defines.textureCount = textureCount

		if (options.dilation) this.fullscreenMaterial.defines.dilation = ""
		if (options.neighborhoodClamp) this.fullscreenMaterial.defines.neighborhoodClamp = ""
		if (options.logTransform) this.fullscreenMaterial.defines.logTransform = ""
		if (camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""
		this.fullscreenMaterial.defines.neighborhoodClampRadius = parseInt(options.neighborhoodClampRadius)

		this.fullscreenMaterial.defines.depthDistance = options.depthDistance.toPrecision(5)
		this.fullscreenMaterial.defines.worldDistance = options.worldDistance.toPrecision(5)

		this.fullscreenMaterial.uniforms.fullAccumulate.value = options.fullAccumulate
		this.fullscreenMaterial.uniforms.neighborhoodClampIntensity.value = options.neighborhoodClampIntensity
		this.fullscreenMaterial.uniforms.maxBlend.value = options.maxBlend

		this.fullscreenMaterial.uniforms.projectionMatrix.value = camera.projectionMatrix.clone()
		this.fullscreenMaterial.uniforms.projectionMatrixInverse.value = camera.projectionMatrixInverse.clone()
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = camera.matrixWorld
		this.fullscreenMaterial.uniforms.viewMatrix.value = camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.cameraPos.value = camera.position

		this.fullscreenMaterial.uniforms.prevViewMatrix.value = camera.matrixWorldInverse.clone()
		this.fullscreenMaterial.uniforms.prevCameraMatrixWorld.value = camera.matrixWorld.clone()
		this.fullscreenMaterial.uniforms.prevProjectionMatrix.value = camera.projectionMatrix.clone()
		this.fullscreenMaterial.uniforms.prevProjectionMatrixInverse.value = camera.projectionMatrixInverse.clone()

		this.fullscreenMaterial.uniforms.velocityTexture.value = velocityDepthNormalPass.renderTarget.texture
		this.fullscreenMaterial.uniforms.depthTexture.value = velocityDepthNormalPass.depthTexture

		this.fullscreenMaterial.defines.inputType =
			["diffuseSpecular", "diffuse", "specular"].indexOf(options.inputType) ?? 1

		for (const opt of ["reprojectSpecular", "neighborhoodClamp"]) {
			let value = options[opt]

			if (typeof value !== "array") value = Array(textureCount).fill(value)

			this.fullscreenMaterial.defines[opt] = /* glsl */ `bool[](${value.join(", ")})`
		}

		this.fullscreenMaterial.defines.confidencePower = options.confidencePower.toPrecision(5)

		this.options = options
		this.velocityDepthNormalPass = velocityDepthNormalPass

		this.fullscreenMaterial.uniforms.inputTexture.value = texture
	}

	dispose() {
		super.dispose()

		this.renderTarget.dispose()
		this.fullscreenMaterial.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)

		this.framebufferTexture?.dispose()

		const inputTexture = this.fullscreenMaterial.uniforms.inputTexture.value

		this.framebufferTexture = new FramebufferTexture(width, height, inputTexture.format)
		this.framebufferTexture.type = inputTexture.type
		this.framebufferTexture.minFilter = LinearFilter
		this.framebufferTexture.magFilter = LinearFilter

		this.framebufferTexture.needsUpdate = true

		for (let i = 0; i < this.textureCount; i++) {
			const accumulatedTexture = this.overrideAccumulatedTextures[i] ?? this.framebufferTexture
			this.fullscreenMaterial.uniforms["accumulatedTexture" + i].value = accumulatedTexture
		}
	}

	get texture() {
		return this.renderTarget.texture[0]
	}

	reset() {
		this.fullscreenMaterial.uniforms.keepData.value = 0
	}

	render(renderer) {
		this.frame = (this.frame + 1) % 4096

		const delta = Math.min(1 / 10, this.clock.getDelta())
		this.fullscreenMaterial.uniforms.delta.value = delta

		tmpProjectionMatrix.copy(this._camera.projectionMatrix)
		tmpProjectionMatrixInverse.copy(this._camera.projectionMatrixInverse)

		if (this._camera.view) this._camera.view.enabled = false
		this._camera.updateProjectionMatrix()

		this.fullscreenMaterial.uniforms.projectionMatrix.value.copy(this._camera.projectionMatrix)
		this.fullscreenMaterial.uniforms.projectionMatrixInverse.value.copy(this._camera.projectionMatrixInverse)
		this.fullscreenMaterial.uniforms.lastVelocityTexture.value = this.velocityDepthNormalPass.lastVelocityTexture

		this.fullscreenMaterial.uniforms.fullAccumulate.value =
			this.options.fullAccumulate &&
			!didCameraMove(this._camera, this.lastCameraTransform.position, this.lastCameraTransform.quaternion)

		this.lastCameraTransform.position.copy(this._camera.position)
		this.lastCameraTransform.quaternion.copy(this._camera.quaternion)

		if (this._camera.view) this._camera.view.enabled = true
		this._camera.projectionMatrix.copy(tmpProjectionMatrix)
		this._camera.projectionMatrixInverse.copy(tmpProjectionMatrixInverse)

		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		this.fullscreenMaterial.uniforms.keepData.value = 1

		if (this.overrideAccumulatedTextures.length === 0) {
			this.framebufferTexture.needsUpdate = true
			renderer.copyFramebufferToTexture(tmpVec2, this.framebufferTexture)
		}

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

		jitter(this.renderTarget.width, this.renderTarget.height, this._camera, this.frame, jitterScale)
	}

	unjitter() {
		if (this._camera.clearViewOffset) this._camera.clearViewOffset()
	}
}
