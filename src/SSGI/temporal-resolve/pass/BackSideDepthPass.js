import { Pass } from "postprocessing"
import { BackSide, Color, MeshDepthMaterial, NearestFilter, RGBADepthPacking, WebGLRenderTarget } from "three"

const backgroundColor = new Color(0)
const overrideMaterial = new MeshDepthMaterial({
	depthPacking: RGBADepthPacking,
	side: BackSide
})

export class BackSideDepthPass extends Pass {
	cachedMaterials = new WeakMap()
	visibleMeshes = []

	constructor(scene, camera) {
		super("VelocityPass")

		this._scene = scene
		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	dispose() {
		this.renderTarget.dispose()
	}

	render(renderer) {
		const { background } = this._scene

		this._scene.background = backgroundColor
		this._scene.overrideMaterial = overrideMaterial

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this._scene, this._camera)

		this._scene.background = background
		this._scene.overrideMaterial = null
	}
}
