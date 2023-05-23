﻿import { Pass } from "postprocessing"
import {
	Color,
	DepthTexture,
	FloatType,
	FramebufferTexture,
	Matrix4,
	NearestFilter,
	PerspectiveCamera,
	RGBAFormat,
	Vector2,
	WebGLRenderTarget
} from "three"
import {
	copyNecessaryProps,
	getVisibleChildren,
	isChildMaterialRenderable,
	saveBoneTexture,
	updateVelocityDepthNormalMaterialAfterRender,
	updateVelocityDepthNormalMaterialBeforeRender
} from "../../ssgi/utils/Utils"
import { VelocityDepthNormalMaterial } from "../material/VelocityDepthNormalMaterial.js"

const backgroundColor = new Color(0)
const zeroVec2 = new Vector2()
const tmpProjectionMatrix = new Matrix4()
const tmpProjectionMatrixInverse = new Matrix4()

export class VelocityDepthNormalPass extends Pass {
	cachedMaterials = new WeakMap()
	visibleMeshes = []
	needsSwap = false

	constructor(scene, camera, renderDepth = true) {
		super("velocityDepthNormalPass")

		if (!(camera instanceof PerspectiveCamera)) {
			throw new Error(
				this.constructor.name +
					" doesn't support cameras of type '" +
					camera.constructor.name +
					"' yet. Only cameras of type 'PerspectiveCamera' are supported."
			)
		}

		this._scene = scene
		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			type: FloatType,
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})

		this.renderTarget.depthTexture = new DepthTexture(1, 1)
		this.renderTarget.depthTexture.type = FloatType

		this.renderDepth = renderDepth
	}

	setVelocityDepthNormalMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, velocityDepthNormalMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				velocityDepthNormalMaterial = new VelocityDepthNormalMaterial()

				copyNecessaryProps(originalMaterial, velocityDepthNormalMaterial)

				c.material = velocityDepthNormalMaterial

				if (c.skeleton?.boneTexture) saveBoneTexture(c)

				this.cachedMaterials.set(c, [originalMaterial, velocityDepthNormalMaterial])
			}

			c.material = velocityDepthNormalMaterial

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			if (this.renderDepth) velocityDepthNormalMaterial.defines.renderDepth = ""

			const map =
				originalMaterial.map ||
				originalMaterial.normalMap ||
				originalMaterial.roughnessMap ||
				originalMaterial.metalnessMap

			if (map) velocityDepthNormalMaterial.uniforms.uvTransform.value = map.matrix

			updateVelocityDepthNormalMaterialBeforeRender(c, this._camera)
		}
	}

	unsetVelocityDepthNormalMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = true

			updateVelocityDepthNormalMaterialAfterRender(c, this._camera)

			c.material = this.cachedMaterials.get(c)[0]
		}
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)

		this.lastDepthTexture?.dispose()

		this.lastDepthTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.lastDepthTexture.type = FloatType
		this.lastDepthTexture.minFilter = NearestFilter
		this.lastDepthTexture.magFilter = NearestFilter
	}

	dispose() {
		super.dispose()

		this.renderTarget.dispose()
	}

	get texture() {
		return Array.isArray(this.renderTarget.texture) ? this.renderTarget.texture[1] : this.renderTarget.texture
	}

	get depthTexture() {
		return this.renderTarget.texture[0]
	}

	render(renderer) {
		tmpProjectionMatrix.copy(this._camera.projectionMatrix)
		tmpProjectionMatrixInverse.copy(this._camera.projectionMatrixInverse)

		if (this._camera.view) this._camera.view.enabled = false
		this._camera.updateProjectionMatrix()

		// in case a RenderPass is not being used, so we need to update the camera's world matrix manually
		this._camera.updateMatrixWorld()

		this.setVelocityDepthNormalMaterialInScene()

		const { background } = this._scene

		this._scene.background = backgroundColor

		renderer.setRenderTarget(this.renderTarget)
		renderer.copyFramebufferToTexture(zeroVec2, this.lastDepthTexture)

		renderer.render(this._scene, this._camera)

		this._scene.background = background

		this.unsetVelocityDepthNormalMaterialInScene()

		if (this._camera.view) this._camera.view.enabled = true
		this._camera.projectionMatrix.copy(tmpProjectionMatrix)
		this._camera.projectionMatrixInverse.copy(tmpProjectionMatrixInverse)
	}
}
