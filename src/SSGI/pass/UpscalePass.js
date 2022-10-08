import { Pass } from "postprocessing"
import { HalfFloatType, NearestFilter, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"
import fragmentShader from "../shader/upscale.frag"
import { gaussian_kernel } from "../utils/Utils"

// https://diharaw.github.io/post/adventures_in_hybrid_rendering/

export class UpscalePass extends Pass {
	iterations = 1

	constructor(inputTexture) {
		super("UpscalePass")

		this.inputTexture = inputTexture

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				invTexSize: new Uniform(new Vector2()),
				horizontal: new Uniform(true),
				denoiseKernel: new Uniform(2),
				denoisePower: new Uniform(8),
				denoiseSharpness: new Uniform(40),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0),
				stepSize: new Uniform(1),
				kernelCoefficients: new Uniform(new Float32Array())
			},
			defines: {
				KERNEL_SIZE: 3
			}
		})

		this.renderTargetA = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		this.renderTargetB = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		this.setKernel(this.fullscreenMaterial.defines.KERNEL_SIZE)
	}

	setKernel(kernelSize, standardDeviation = 5) {
		this.fullscreenMaterial.uniforms.kernelCoefficients.value = new Float32Array(
			gaussian_kernel(kernelSize * 2 + 1, standardDeviation)
		)

		this.fullscreenMaterial.defines.KERNEL_SIZE = parseInt(kernelSize)

		this.fullscreenMaterial.needsUpdate = true
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)
	}

	render(renderer) {
		let stepSize = 1
		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0
			if (horizontal) stepSize = 2 ** (i / 2)

			this.fullscreenMaterial.uniforms.horizontal.value = horizontal
			this.fullscreenMaterial.uniforms.stepSize.value = stepSize
			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			this.fullscreenMaterial.uniforms.inputTexture.value = horizontal
				? i === 0
					? this.inputTexture
					: this.renderTargetB.texture
				: this.renderTargetA.texture

			renderer.setRenderTarget(renderTarget)
			renderer.render(this.scene, this.camera)
		}
	}

	get texture() {
		return this.renderTargetB.texture
	}
}
