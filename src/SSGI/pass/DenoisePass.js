import { Pass } from "postprocessing"
import { HalfFloatType, LinearFilter, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"
import fragmentShader from "../shader/denoise.frag"
import { isWebGL2Available } from "../utils/Utils"

// https://research.nvidia.com/sites/default/files/pubs/2017-07_Spatiotemporal-Variance-Guided-Filtering%3A//svgf_preprint.pdf
// https://diharaw.github.io/post/adventures_in_hybrid_rendering/
// https://github.com/NVIDIAGameWorks/Falcor/tree/master/Source/RenderPasses/SVGFPass

const isWebGL2 = isWebGL2Available()

export class DenoisePass extends Pass {
	iterations = 1

	constructor(inputTexture) {
		super("DenoisePass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(inputTexture),
				depthTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				momentsTexture: new Uniform(null),
				invTexSize: new Uniform(new Vector2()),
				horizontal: new Uniform(true),
				denoiseKernel: new Uniform(1),
				lumaPhi: new Uniform(1),
				depthPhi: new Uniform(1),
				normalPhi: new Uniform(1),
				roughnessPhi: new Uniform(1),
				stepSize: new Uniform(1)
			}
		})

		const options = {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLRenderTarget(1, 1, options)
		this.renderTargetB = new WebGLRenderTarget(1, 1, options)

		if (isWebGL2) this.fullscreenMaterial.defines.USE_MOMENT = ""
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)
	}

	dispose() {
		this.renderTargetA.dispose()
		this.renderTargetB.dispose()
	}

	render(renderer) {
		const inputTexture = this.fullscreenMaterial.uniforms.inputTexture.value

		let stepSize = 1
		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0
			if (horizontal) stepSize = 2 ** (i / 2)

			this.fullscreenMaterial.uniforms.horizontal.value = horizontal
			this.fullscreenMaterial.uniforms.stepSize.value = stepSize
			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			this.fullscreenMaterial.uniforms.inputTexture.value = horizontal
				? i === 0
					? inputTexture
					: this.renderTargetB.texture
				: this.renderTargetA.texture

			renderer.setRenderTarget(renderTarget)
			renderer.render(this.scene, this.camera)
		}

		this.fullscreenMaterial.uniforms.inputTexture.value = inputTexture
	}

	get texture() {
		return this.renderTargetB.texture
	}
}
