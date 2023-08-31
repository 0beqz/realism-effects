import { Pass } from "postprocessing"
import { Color, DepthTexture, FloatType, NearestFilter, Quaternion, Vector3, WebGLRenderTarget } from "three"
import { didCameraMove, isChildMaterialRenderable } from "../utils/SceneUtils.js"
import { copyPropsToGBufferMaterial, createGBufferMaterial } from "./material/GBufferMaterial.js"
import { getVisibleChildren } from "../utils/SceneUtils.js"

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

				mrtMaterial = createGBufferMaterial(originalMaterial)

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
			}

			// mrtMaterial.uniforms.resolution.value.set(this.gBufferRenderTarget.width, this.gBufferRenderTarget.height)
			// mrtMaterial.uniforms.frame.value = this.frame
			// mrtMaterial.uniforms.cameraMoved.value = cameraMoved

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			copyPropsToGBufferMaterial(originalMaterial, mrtMaterial)

			// todo: implement selection

			// mrtMaterial.uniforms.metalness.value = c.material.metalness ?? 0
			// mrtMaterial.uniforms.roughness.value = c.material.roughness ?? 0
			// mrtMaterial.uniforms.emissiveIntensity.value = c.material.emissiveIntensity ?? 0
			// mrtMaterial.uniforms.opacity.value = originalMaterial.opacity

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
		this.frame = (this.frame + 1) % 4096

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
