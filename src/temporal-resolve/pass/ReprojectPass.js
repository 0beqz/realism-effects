import { Pass } from "postprocessing"
import { Color, FloatType, HalfFloatType, NearestFilter, UnsignedByteType, WebGLMultipleRenderTargets } from "three"
import {
	getVisibleChildren,
	keepMaterialMapUpdated,
	saveBoneTexture,
	updateReprojectMaterialAfterRender,
	updateReprojectMaterialBeforeRender
} from "../../ssgi/utils/Utils"
import { ReprojectMaterial } from "../material/ReprojectMaterial.js"

const backgroundColor = new Color(0)

export class ReprojectPass extends Pass {
	cachedMaterials = new WeakMap()
	visibleMeshes = []

	constructor(scene, camera, renderDepthNormal = true) {
		super("VelocityPass")

		this._scene = scene
		this._camera = camera

		const bufferCount = renderDepthNormal ? 3 : 1

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, bufferCount, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType
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

	setReprojectMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, reprojectMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				reprojectMaterial = new ReprojectMaterial()
				reprojectMaterial.normalScale = originalMaterial.normalScale
				reprojectMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				c.material = reprojectMaterial

				if (c.skeleton?.boneTexture) saveBoneTexture(c)

				this.cachedMaterials.set(c, [originalMaterial, reprojectMaterial])
			}

			c.material = reprojectMaterial

			c.visible =
				originalMaterial.visible &&
				originalMaterial.depthWrite &&
				originalMaterial.depthTest &&
				c.constructor.name !== "GroundProjectedEnv"

			if (this.renderDepthNormal) reprojectMaterial.defines.renderDepthNormal = ""

			keepMaterialMapUpdated(reprojectMaterial, originalMaterial, "normalMap", "USE_NORMALMAP", true)

			const map =
				originalMaterial.map ||
				originalMaterial.normalMap ||
				originalMaterial.roughnessMap ||
				originalMaterial.metalnessMap

			if (map) reprojectMaterial.uniforms.uvTransform.value = map.matrix
			reprojectMaterial.side = originalMaterial.side

			updateReprojectMaterialBeforeRender(c, this._camera)
		}
	}

	unsetReprojectMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = true

			updateReprojectMaterialAfterRender(c, this._camera)

			c.material = this.cachedMaterials.get(c)[0]
		}
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	dispose() {
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

		this.setReprojectMaterialInScene()

		const { background } = this._scene

		this._scene.background = backgroundColor

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this._scene, this._camera)

		this._scene.background = background

		this.unsetReprojectMaterialInScene()

		if (this._camera.view) this._camera.view.enabled = true
		this._camera.updateProjectionMatrix()
	}
}
