import { Pass } from "postprocessing"
import {
	Color,
	DataTexture,
	DepthTexture,
	FloatType,
	FramebufferTexture,
	Matrix4,
	NearestFilter,
	RGBAFormat,
	Vector2,
	WebGLRenderTarget
} from "three"
import { VelocityDepthNormalMaterial } from "../material/VelocityDepthNormalMaterial.js"
import { copyNecessaryProps, keepMaterialMapUpdated } from "../../gbuffer/utils/GBufferUtils.js"
import { getVisibleChildren } from "../../utils/SceneUtils.js"
import { isChildMaterialRenderable } from "../../utils/SceneUtils.js"

const backgroundColor = new Color(0)
const zeroVec2 = new Vector2()
const tmpProjectionMatrix = new Matrix4()
const tmpProjectionMatrixInverse = new Matrix4()

const saveBoneTexture = object => {
	let boneTexture = object.material.uniforms.prevBoneTexture.value

	if (boneTexture && boneTexture.image.width === object.skeleton.boneTexture.width) {
		boneTexture = object.material.uniforms.prevBoneTexture.value
		boneTexture.image.data.set(object.skeleton.boneTexture.image.data)
	} else {
		boneTexture?.dispose()

		const boneMatrices = object.skeleton.boneTexture.image.data.slice()
		const size = object.skeleton.boneTexture.image.width

		boneTexture = new DataTexture(boneMatrices, size, size, RGBAFormat, FloatType)
		object.material.uniforms.prevBoneTexture.value = boneTexture

		boneTexture.needsUpdate = true
	}
}

const updateVelocityDepthNormalMaterialBeforeRender = (c, camera) => {
	if (c.skeleton?.boneTexture) {
		c.material.uniforms.boneTexture.value = c.skeleton.boneTexture

		if (!("USE_SKINNING" in c.material.defines)) {
			c.material.defines.USE_SKINNING = ""
			c.material.defines.BONE_TEXTURE = ""

			c.material.needsUpdate = true
		}
	}

	c.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, c.matrixWorld)

	c.material.uniforms.velocityMatrix.value.multiplyMatrices(camera.projectionMatrix, c.modelViewMatrix)
}

const updateVelocityDepthNormalMaterialAfterRender = (c, camera) => {
	c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices(camera.projectionMatrix, c.modelViewMatrix)

	if (c.skeleton?.boneTexture) saveBoneTexture(c)
}

export class VelocityDepthNormalPass extends Pass {
	cachedMaterials = new WeakMap()
	visibleMeshes = []
	needsSwap = false

	constructor(scene, camera) {
		super("VelocityDepthNormalPass")

		this._scene = scene
		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			type: FloatType,
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})

		this.renderTarget.texture.name = "VelocityDepthNormalPass.Texture"

		this.renderTarget.depthTexture = new DepthTexture(1, 1)
		this.renderTarget.depthTexture.type = FloatType
	}

	get texture() {
		return this.renderTarget.texture
	}

	setVelocityDepthNormalMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, velocityDepthNormalMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				velocityDepthNormalMaterial = new VelocityDepthNormalMaterial(this._camera)

				copyNecessaryProps(originalMaterial, velocityDepthNormalMaterial)

				c.material = velocityDepthNormalMaterial

				if (c.skeleton?.boneTexture) saveBoneTexture(c)

				this.cachedMaterials.set(c, [originalMaterial, velocityDepthNormalMaterial])
			}

			c.material = velocityDepthNormalMaterial

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			keepMaterialMapUpdated(
				velocityDepthNormalMaterial,
				originalMaterial,
				"normalMap",
				"USE_NORMALMAP_TANGENTSPACE",
				true
			)
			velocityDepthNormalMaterial.uniforms.normalMap.value = originalMaterial.normalMap

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

		this.lastVelocityTexture?.dispose()

		this.lastVelocityTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.lastVelocityTexture.type = FloatType
		this.lastVelocityTexture.minFilter = NearestFilter
		this.lastVelocityTexture.magFilter = NearestFilter
	}

	dispose() {
		super.dispose()

		this.renderTarget.dispose()
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
		renderer.copyFramebufferToTexture(zeroVec2, this.lastVelocityTexture)

		renderer.render(this._scene, this._camera)

		this._scene.background = background

		this.unsetVelocityDepthNormalMaterialInScene()

		if (this._camera.view) this._camera.view.enabled = true
		this._camera.projectionMatrix.copy(tmpProjectionMatrix)
		this._camera.projectionMatrixInverse.copy(tmpProjectionMatrixInverse)
	}
}
