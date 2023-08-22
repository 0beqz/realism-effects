import { Pass } from "postprocessing"
import { Color, DepthTexture, FloatType, NearestFilter, Quaternion, Texture, Vector3, WebGLRenderTarget } from "three"
import { didCameraMove, isChildMaterialRenderable } from "../utils/SceneUtils.js"
import { GBufferMaterial } from "./material/GBufferMaterial.js"
import { copyNecessaryProps, getVisibleChildren, keepMaterialMapUpdated } from "./utils/GBufferUtils.js"

const backgroundColor = new Color(0)

export class GBufferPass extends Pass {
	frame = 21483
	cachedMaterials = new WeakMap()
	visibleMeshes = []
	lastCameraPosition = new Vector3()
	lastCameraQuaternion = new Quaternion()

	constructor(scene, camera) {
		super("GBufferPass")

		this._scene = scene
		this._camera = camera

		this.initMRTRenderTarget()
	}

	get texture() {
		return this.gBufferRenderTarget.texture
	}

	get depthTexture() {
		return this.gBufferRenderTarget.depthTexture
	}

	initMRTRenderTarget() {
		this.gBufferRenderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: FloatType
		})

		this.gBufferRenderTarget.depthTexture = new DepthTexture(1, 1)
		this.gBufferRenderTarget.depthTexture.type = FloatType
	}

	setSize(width, height) {
		this.gBufferRenderTarget.setSize(width, height)
	}

	dispose() {
		super.dispose()
		this.gBufferRenderTarget.dispose()
	}

	setMRTMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		const cameraMoved = didCameraMove(this._camera, this.lastCameraPosition, this.lastCameraQuaternion)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, mrtMaterial] = this.cachedMaterials.get(c) || []

			// init a new material if the original material changed or if the cached material is missing
			if (originalMaterial !== cachedOriginalMaterial) {
				if (mrtMaterial) mrtMaterial.dispose()

				mrtMaterial = new GBufferMaterial()

				copyNecessaryProps(originalMaterial, mrtMaterial)

				mrtMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				if (c.skeleton?.boneTexture) {
					mrtMaterial.defines.USE_SKINNING = ""
					mrtMaterial.defines.BONE_TEXTURE = ""

					mrtMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture

					mrtMaterial.needsUpdate = true
				}

				const textureKey = Object.keys(originalMaterial).find(key => {
					const value = originalMaterial[key]
					return value instanceof Texture && value.matrix
				})

				if (textureKey) mrtMaterial.uniforms.uvTransform.value = originalMaterial[textureKey].matrix

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
			}

			if (originalMaterial.emissive) mrtMaterial.uniforms.emissive.value = originalMaterial.emissive
			if (originalMaterial.color) mrtMaterial.uniforms.color.value = originalMaterial.color

			// update the child's MRT material
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMALMAP_TANGENTSPACE", true) // todo: object space normals support
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESSMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "metalnessMap", "USE_	METALNESSMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "map", "USE_MAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "emissiveMap", "USE_EMISSIVEMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "alphaMap", "USE_ALPHAMAP", originalMaterial.transparent)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "lightMap", "USE_LIGHTMAP", true)

			mrtMaterial.uniforms.resolution.value.set(this.gBufferRenderTarget.width, this.gBufferRenderTarget.height)
			mrtMaterial.uniforms.frame.value = this.frame
			mrtMaterial.uniforms.cameraMoved.value = cameraMoved

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			// todo: implement selection

			mrtMaterial.uniforms.metalness.value = c.material.metalness ?? 0
			mrtMaterial.uniforms.emissiveIntensity.value = c.material.emissiveIntensity ?? 0
			mrtMaterial.uniforms.opacity.value = originalMaterial.opacity

			c.material = mrtMaterial
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.material = originalMaterial
		}
	}

	render(renderer) {
		this.frame = (this.frame + 1) % 65536

		const { background } = this._scene

		this._scene.background = backgroundColor

		this.setMRTMaterialInScene()

		renderer.setRenderTarget(this.gBufferRenderTarget)
		renderer.render(this._scene, this._camera)

		this.unsetMRTMaterialInScene()

		// reset state
		this.lastCameraPosition.copy(this._camera.position)
		this.lastCameraQuaternion.copy(this._camera.quaternion)

		this._scene.background = background
	}
}
