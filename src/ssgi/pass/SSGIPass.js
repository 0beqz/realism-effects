import { Pass } from "postprocessing"
import { FloatType, NearestFilter, WebGLRenderTarget } from "three"
import { GBufferPass } from "../../gbuffer/GBufferPass.js"
import { SSGIMaterial } from "../material/SSGIMaterial.js"

export class SSGIPass extends Pass {
	needsSwap = false
	defaultFragmentShader = ""
	frame = 21483

	constructor(ssgiEffect, options) {
		super("SSGIPass")

		this.ssgiEffect = ssgiEffect
		this._scene = ssgiEffect._scene
		this._camera = ssgiEffect._camera

		this.fullscreenMaterial = new SSGIMaterial()
		this.defaultFragmentShader = this.fullscreenMaterial.fragmentShader

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			type: FloatType,
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			depthBuffer: false
		})

		// set up basic uniforms that we don't have to update
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
		this.fullscreenMaterial.uniforms.viewMatrix.value = this._camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms.projectionMatrixInverse.value = this._camera.projectionMatrixInverse

		if (ssgiEffect._camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""

		if (options.diffuseOnly) this.fullscreenMaterial.defines.diffuseOnly = ""
		if (options.specularOnly) this.fullscreenMaterial.defines.specularOnly = ""

		this.gBufferPass = new GBufferPass(this._scene, this._camera)

		this.fullscreenMaterial.uniforms.gBufferTexture.value = this.gBufferPass.texture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.gBufferPass.depthTexture
	}

	get texture() {
		return this.renderTarget.texture
	}

	get specularTexture() {
		const index = "specularOnly" in this.fullscreenMaterial.defines ? 0 : 1
		return this.renderTarget.texture[index]
	}

	setSize(width, height) {
		this.renderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		this.gBufferPass.setSize(width, height)

		this.fullscreenMaterial.uniforms.resolution.value.set(this.renderTarget.width, this.renderTarget.height)
	}

	dispose() {
		super.dispose()

		this.renderTarget.dispose()
		this.renderTarget.dispose()

		this.fullscreenMaterial.dispose()
	}

	render(renderer) {
		this.frame = (this.frame + this.ssgiEffect.spp) % 4096

		// render G-Buffers
		this.gBufferPass.render(renderer)

		// update uniforms
		this.fullscreenMaterial.uniforms.frame.value = this.frame
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far
		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssgiEffect.denoiser.texture

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
