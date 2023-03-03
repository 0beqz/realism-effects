import { Pass } from "postprocessing"
import { Color, FloatType, HalfFloatType, NearestFilter, UnsignedByteType, WebGLMultipleRenderTargets } from "three"
import {
	getVisibleChildren,
	isChildMaterialRenderable,
	keepMaterialMapUpdated,
	saveBoneTexture,
	updateVelocityDepthNormalMaterialAfterRender,
	updateVelocityDepthNormalMaterialBeforeRender
} from "../../ssgi/utils/Utils"
import { VelocityDepthNormalMaterial } from "../material/VelocityDepthNormalMaterial.js"

const backgroundColor = new Color(0)

export class VelocityDepthNormalPass extends Pass {
	cachedMaterials = new WeakMap()
	visibleMeshes = []

	constructor(scene, camera, renderDepthNormal = true) {
		super("VelocityPass")

		this._scene = scene
		this._camera = camera

		const bufferCount = renderDepthNormal ? 3 : 1

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, bufferCount, {
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})

		this.renderTarget.texture[0].type = FloatType
		this.renderTarget.texture[0].needsUpdate = true

		if (renderDepthNormal) {
			this.renderTarget.texture[1].type = UnsignedByteType
			this.renderTarget.texture[1].needsUpdate = true

			this.renderTarget.texture[2].type = HalfFloatType
			this.renderTarget.texture[2].needsUpdate = true
		}

		this.renderDepthNormal = renderDepthNormal
	}

	setVelocityDepthNormalMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, velocityDepthNormalMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				velocityDepthNormalMaterial = new VelocityDepthNormalMaterial()
				velocityDepthNormalMaterial.normalScale = originalMaterial.normalScale
				velocityDepthNormalMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				c.material = velocityDepthNormalMaterial

				if (c.skeleton?.boneTexture) saveBoneTexture(c)

				this.cachedMaterials.set(c, [originalMaterial, velocityDepthNormalMaterial])
			}

			c.material = velocityDepthNormalMaterial

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			if (this.renderDepthNormal) velocityDepthNormalMaterial.defines.renderDepthNormal = ""

			keepMaterialMapUpdated(velocityDepthNormalMaterial, originalMaterial, "normalMap", "USE_NORMALMAP", true)

			const map =
				originalMaterial.map ||
				originalMaterial.normalMap ||
				originalMaterial.roughnessMap ||
				originalMaterial.metalnessMap

			if (map) velocityDepthNormalMaterial.uniforms.uvTransform.value = map.matrix
			velocityDepthNormalMaterial.side = originalMaterial.side

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
	}

	dispose() {
		super.dispose()

		this.renderTarget.dispose()
	}

	get texture() {
		return Array.isArray(this.renderTarget.texture) ? this.renderTarget.texture[0] : this.renderTarget.texture
	}

	get depthTexture() {
		return this.renderTarget.texture[1]
	}

	get normalTexture() {
		return this.renderTarget.texture[2]
	}

	render(renderer) {
		this._camera.clearViewOffset()

		this.setVelocityDepthNormalMaterialInScene()

		const { background } = this._scene

		this._scene.background = backgroundColor

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this._scene, this._camera)

		this._scene.background = background

		this.unsetVelocityDepthNormalMaterialInScene()

		if (this._camera.view) this._camera.view.enabled = true
		this._camera.updateProjectionMatrix()
	}
}
