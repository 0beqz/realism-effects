import { Pass } from "postprocessing"
import {
	Color,
	DepthTexture,
	FloatType,
	HalfFloatType,
	NearestFilter,
	Quaternion,
	UnsignedByteType,
	Vector3,
	WebGLRenderTarget
} from "three"
import { didCameraMove, getVisibleChildren, isChildMaterialRenderable } from "../utils/SceneUtils.js"
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

		this.initGBufferRenderTarget()
	}

	get texture() {
		return this.renderTarget.texture
	}

	get depthTexture() {
		return this.renderTarget.depthTexture
	}

	initGBufferRenderTarget() {
		this.renderTarget = new WebGLRenderTarget(1, 1, {
			type: FloatType,
			minFilter: NearestFilter,
			magFilter: NearestFilter
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

	setGBufferMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		const cameraMoved = didCameraMove(this._camera, this.lastCameraPosition, this.lastCameraQuaternion)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, gBufferMaterial] = this.cachedMaterials.get(c) || []

			// init a new material if the original material changed or if the cached material is missing
			if (originalMaterial !== cachedOriginalMaterial) {
				if (gBufferMaterial) gBufferMaterial.dispose()

				gBufferMaterial = createGBufferMaterial(originalMaterial)

				this.cachedMaterials.set(c, [originalMaterial, gBufferMaterial])
			}

			// gBufferMaterial.uniforms.resolution.value.set(this.renderTarget.width, this.renderTarget.height)
			// gBufferMaterial.uniforms.frame.value = this.frame

			if (gBufferMaterial.uniforms) {
				gBufferMaterial.uniforms.cameraNotMovedFrames.value = cameraMoved
					? 0
					: (gBufferMaterial.uniforms.cameraNotMovedFrames.value + 1) % 0xffff
			}

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			copyPropsToGBufferMaterial(originalMaterial, gBufferMaterial)

			c.material = gBufferMaterial
		}
	}

	unsetGBufferMaterialInScene() {
		for (const c of this.visibleMeshes) {
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.material = originalMaterial
		}
	}

	render(renderer) {
		this.frame = (this.frame + 1) % 4096

		const { background } = this._scene

		this._scene.background = backgroundColor

		this.setGBufferMaterialInScene()

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this._scene, this._camera)

		this.unsetGBufferMaterialInScene()

		// reset state
		this.lastCameraPosition.copy(this._camera.position)
		this.lastCameraQuaternion.copy(this._camera.quaternion)

		this._scene.background = background
	}
}
