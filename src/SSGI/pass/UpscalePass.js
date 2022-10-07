import { Pass } from "postprocessing"
import { HalfFloatType, NearestFilter, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"
import fragmentShader from "../shader/upscale.frag"

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
				blurKernel: new Uniform(2),
				blurPower: new Uniform(8),
				blurSharpness: new Uniform(1),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0)
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
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)
	}

	render(renderer) {
		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0

			this.fullscreenMaterial.uniforms.horizontal.value = horizontal
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
