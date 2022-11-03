import { Pass, RenderPass } from "postprocessing"
import {
	Color,
	DataTexture,
	FloatType,
	NearestFilter,
	Quaternion,
	RGBAFormat,
	Vector3,
	WebGLMultipleRenderTargets
} from "three"
import { getVisibleChildren, keepMaterialMapUpdated } from "../../utils/Utils.js"
import { VelocityMaterial } from "../material/VelocityMaterial.js"

const backgroundColor = new Color(0)
const updateProperties = ["visible", "wireframe", "side"]

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

				if (c.skeleton?.boneTexture) this.saveBoneTexture(c)

				this.cachedMaterials.set(c, [originalMaterial, velocityMaterial])
			}

			c.material = velocityMaterial

			if (this.renderDepth) velocityMaterial.defines.renderDepth = ""

			keepMaterialMapUpdated(velocityMaterial, originalMaterial, "normalMap", "USE_NORMALMAP", true)

			const map =
				originalMaterial.map ||
				originalMaterial.normalMap ||
				originalMaterial.roughnessMap ||
				originalMaterial.metalnessMap

			if (map) velocityMaterial.uniforms.uvTransform.value = map.matrix

			this.updateVelocityMaterialBeforeRender(c, originalMaterial)
		}
	}

	updateVelocityMaterialBeforeRender(c, originalMaterial) {
		for (const prop of updateProperties) c.material[prop] = originalMaterial[prop]

		if (c.skeleton?.boneTexture) {
			c.material.defines.USE_SKINNING = ""
			c.material.defines.BONE_TEXTURE = ""

			c.material.uniforms.boneTexture.value = c.skeleton.boneTexture
		}

		c.material.uniforms.velocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)
	}

	updateVelocityMaterialAfterRender(c) {
		c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)

		if (c.skeleton?.boneTexture) this.saveBoneTexture(c)
	}

	saveBoneTexture(object) {
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

	unsetVelocityMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = true

			this.updateVelocityMaterialAfterRender(c)

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

	get worldNormalTexture() {
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
