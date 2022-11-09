import { Pass } from "postprocessing"
import { HalfFloatType, LinearFilter, ShaderMaterial, sRGBEncoding, Uniform, Vector2, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"
import fragmentShader from "../shader/denoise.frag"

// https://research.nvidia.com/sites/default/files/pubs/2017-07_Spatiotemporal-Variance-Guided-Filtering%3A//svgf_preprint.pdf
// https://diharaw.github.io/post/adventures_in_hybrid_rendering/
// https://github.com/NVIDIAGameWorks/Falcor/tree/master/Source/RenderPasses/SVGFPass

const defaultDenoisePassOptions = {
	moments: true
}
export class DenoisePass extends Pass {
	iterations = 1

	constructor(camera, inputTexture, options = defaultDenoisePassOptions) {
		super("DenoisePass")

		options = { ...defaultDenoisePassOptions, ...options }

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(inputTexture),
				diffuseTexture: new Uniform(null),
				directLightTexture: new Uniform(null),
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
				stepSize: new Uniform(1),
				isLastIteration: new Uniform(false),
				_viewMatrix: new Uniform(camera.matrixWorldInverse),
				projectionMatrix: new Uniform(camera.projectionMatrix),
				_projectionMatrixInverse: new Uniform(camera.projectionMatrixInverse),
				cameraMatrixWorld: new Uniform(camera.matrixWorld)
			}
		})

		const renderTargetOptions = {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLRenderTarget(1, 1, renderTargetOptions)
		this.renderTargetB = new WebGLRenderTarget(1, 1, renderTargetOptions)

		if (options.moments) this.fullscreenMaterial.defines.USE_MOMENT = ""
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

		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0
			const stepSize = 2 ** ~~(i / 2)

			this.fullscreenMaterial.uniforms.horizontal.value = horizontal
			this.fullscreenMaterial.uniforms.stepSize.value = stepSize
			this.fullscreenMaterial.uniforms.isLastIteration.value = i === 2 * this.iterations - 1

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
