import { Pass } from "postprocessing"
import { Color, DepthTexture, FloatType, NearestFilter, Quaternion, Vector3, WebGLRenderTarget } from "three"
import { getVisibleChildren, isChildMaterialRenderable } from "../utils/SceneUtils.js"
import { copyPropsToGBufferMaterial, createGBufferMaterial } from "./material/GBufferMaterial.js"

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
		return this.renderTarget.texture
	}

	get depthTexture() {
		return this.renderTarget.depthTexture
	}

	initMRTRenderTarget() {
		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: FloatType
		})

		this.renderTarget.texture.name = "GBufferPass.Texture"

		this.renderTarget.depthTexture = new DepthTexture(1, 1)
		this.renderTarget.depthTexture.type = FloatType
		this.renderTarget.depthTexture.name = "GBufferPass.DepthTexture"
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	dispose() {
		super.dispose()
		this.renderTarget.dispose()
	}

	setMRTMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		// const cameraMoved = didCameraMove(this._camera, this.lastCameraPosition, this.lastCameraQuaternion)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, mrtMaterial] = this.cachedMaterials.get(c) || []

			// init a new material if the original material changed or if the cached material is missing
			if (originalMaterial !== cachedOriginalMaterial) {
				if (mrtMaterial) mrtMaterial.dispose()

				mrtMaterial = createGBufferMaterial(originalMaterial)

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
			}

			// mrtMaterial.uniforms.resolution.value.set(this.renderTarget.width, this.renderTarget.height)
			// mrtMaterial.uniforms.frame.value = this.frame
			// mrtMaterial.uniforms.cameraMoved.value = cameraMoved

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			copyPropsToGBufferMaterial(originalMaterial, mrtMaterial)

			// todo: implement selection

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

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this._scene, this._camera)

		this.unsetMRTMaterialInScene()

		// reset state
		this.lastCameraPosition.copy(this._camera.position)
		this.lastCameraQuaternion.copy(this._camera.quaternion)

		this._scene.background = background
	}
}
