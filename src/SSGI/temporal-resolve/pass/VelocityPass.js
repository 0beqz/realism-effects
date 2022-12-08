import { Pass, RenderPass } from "postprocessing"
import { Color, NearestFilter, Quaternion, Vector3, WebGLMultipleRenderTargets } from "three"
import {
	getVisibleChildren,
	keepMaterialMapUpdated,
	saveBoneTexture,
	updateVelocityMaterialAfterRender,
	updateVelocityMaterialBeforeRender
} from "../../utils/Utils.js"
import { VelocityMaterial } from "../material/VelocityMaterial.js"

const backgroundColor = new Color(0)

export class VelocityPass extends Pass {
	cachedMaterials = new WeakMap()
	lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}
	visibleMeshes = []

	constructor(scene, camera, { renderDepth = false } = {}) {
		super("VelocityPass")

		this._scene = scene
		this._camera = camera

		this.renderPass = new RenderPass(this._scene, this._camera)

		const bufferCount = renderDepth ? 3 : 1
		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, bufferCount, {
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})

		this.renderDepth = renderDepth
	}

	setVelocityMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, velocityMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				velocityMaterial = new VelocityMaterial()
				velocityMaterial.normalScale = originalMaterial.normalScale
				velocityMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				c.material = velocityMaterial

				if (c.skeleton?.boneTexture) saveBoneTexture(c)

				this.cachedMaterials.set(c, [originalMaterial, velocityMaterial])
			}

			c.material = velocityMaterial

			const visible = originalMaterial.visible
			c.visible = visible

			if (this.renderDepth) velocityMaterial.defines.renderDepth = ""

			keepMaterialMapUpdated(velocityMaterial, originalMaterial, "normalMap", "USE_NORMALMAP", true)

			const map =
				originalMaterial.map ||
				originalMaterial.normalMap ||
				originalMaterial.roughnessMap ||
				originalMaterial.metalnessMap

			if (map) velocityMaterial.uniforms.uvTransform.value = map.matrix

			updateVelocityMaterialBeforeRender(c, this._camera.projectionMatrix)
		}
	}

	unsetVelocityMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = true

			updateVelocityMaterialAfterRender(c, this._camera.projectionMatrix)

			c.material = this.cachedMaterials.get(c)[0]
		}
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
		if (this.webgl1DepthPass) this.webgl1DepthPass.setSize(width, height)
	}

	dispose() {
		this.renderTarget.dispose()
		if (this.webgl1DepthPass) this.webgl1DepthPass.dispose()
	}

	get texture() {
		return this.renderTarget.texture[1]
	}

	get depthTexture() {
		return this.renderTarget.texture[0]
	}

	get normalTexture() {
		return this.renderTarget.texture[2]
	}

	get depthRenderTarget() {
		return this.renderTarget
	}

	render(renderer) {
		this.setVelocityMaterialInScene()

		const { background } = this._scene

		this._scene.background = backgroundColor

		this.renderPass.render(renderer, this.renderTarget)

		this._scene.background = background

		this.unsetVelocityMaterialInScene()
	}
}
