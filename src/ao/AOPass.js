import { Pass } from "postprocessing"
import {
	HalfFloatType,
	LinearEncoding,
	Matrix4,
	NearestFilter,
	NoBlending,
	RepeatWrapping,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	WebGLRenderTarget
} from "three"
import blueNoiseImage from "../utils/LDR_RGBA_0.png"
import vertexShader from "../utils/shader/basic.vert"
import sampleBlueNoise from "../utils/shader/sampleBlueNoise.glsl"

// a general AO pass that can be used for any AO algorithm
class AOPass extends Pass {
	constructor(camera, scene, fragmentShader) {
		super()
		this._camera = camera
		this._scene = scene

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			type: HalfFloatType,
			depthBuffer: false
		})

		const finalFragmentShader = fragmentShader.replace("#include <sampleBlueNoise>", sampleBlueNoise)

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: finalFragmentShader,
			vertexShader,

			uniforms: {
				depthTexture: { value: null },
				normalTexture: { value: null },
				cameraNear: { value: 0 },
				cameraFar: { value: 0 },
				viewMatrix: { value: this._camera.matrixWorldInverse },
				projectionViewMatrix: { value: new Matrix4() },
				projectionMatrixInverse: { value: this._camera.projectionMatrixInverse },
				cameraMatrixWorld: { value: this._camera.matrixWorld },
				texSize: { value: new Vector2() },
				blueNoiseTexture: { value: null },
				blueNoiseRepeat: { value: new Vector2() },
				aoDistance: { value: 0 },
				distancePower: { value: 0 },
				bias: { value: 0 },
				thickness: { value: 0 },
				power: { value: 0 },
				frame: { value: 0 }
			},

			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})

		new TextureLoader().load(blueNoiseImage, blueNoiseTexture => {
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.fullscreenMaterial.uniforms.blueNoiseTexture.value = blueNoiseTexture
		})
	}

	get texture() {
		return this.renderTarget.texture
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)

		this.fullscreenMaterial.uniforms.texSize.value.set(this.renderTarget.width, this.renderTarget.height)
	}

	render(renderer) {
		const spp = +this.fullscreenMaterial.defines.spp

		this.fullscreenMaterial.uniforms.frame.value = (this.fullscreenMaterial.uniforms.frame.value + spp) % 65536

		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		this.fullscreenMaterial.uniforms.projectionViewMatrix.value.multiplyMatrices(
			this._camera.projectionMatrix,
			this._camera.matrixWorldInverse
		)

		const noiseTexture = this.fullscreenMaterial.uniforms.blueNoiseTexture.value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.fullscreenMaterial.uniforms.blueNoiseRepeat.value.set(
				this.renderTarget.width / width,
				this.renderTarget.height / height
			)
		}

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}

export { AOPass }
