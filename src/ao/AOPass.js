import { Pass } from "postprocessing"
import { HalfFloatType, Matrix4, NoBlending, SRGBColorSpace, ShaderMaterial, Vector2, WebGLRenderTarget } from "three"
import { useBlueNoise } from "../utils/BlueNoiseUtils"
import vertexShader from "../utils/shader/basic.vert"

// a general AO pass that can be used for any AO algorithm
class AOPass extends Pass {
	constructor(camera, scene, depthTexture, fragmentShader) {
		super()
		this._camera = camera
		this._scene = scene

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			colorSpace: SRGBColorSpace,
			depthBuffer: false
		})

		console.log(depthTexture)

		const finalFragmentShader = fragmentShader

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: finalFragmentShader,
			vertexShader,

			uniforms: {
				depthTexture: { value: depthTexture },
				normalTexture: { value: null },
				cameraNear: { value: 0 },
				cameraFar: { value: 0 },
				viewMatrix: { value: this._camera.matrixWorldInverse },
				projectionViewMatrix: { value: new Matrix4() },
				projectionMatrix: { value: this._camera.projectionMatrix },
				projectionMatrixInverse: { value: this._camera.projectionMatrixInverse },
				cameraMatrixWorld: { value: this._camera.matrixWorld },
				resolution: { value: new Vector2() },
				blueNoiseTexture: { value: null },
				blueNoiseRepeat: { value: new Vector2() },
				aoDistance: { value: 0 },
				distancePower: { value: 0 },
				bias: { value: 0 },
				thickness: { value: 0 },
				power: { value: 0 }
			},

			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})

		useBlueNoise(this.fullscreenMaterial)
	}

	get texture() {
		return this.renderTarget.texture
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)

		this.fullscreenMaterial.uniforms.resolution.value.set(this.renderTarget.width, this.renderTarget.height)
	}

	render(renderer) {
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		this.fullscreenMaterial.uniforms.projectionViewMatrix.value.multiplyMatrices(
			this._camera.projectionMatrix,
			this._camera.matrixWorldInverse
		)

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}

export { AOPass }
