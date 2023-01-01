import { Pass, RenderPass } from "postprocessing"
import { GLSL3, HalfFloatType, LinearFilter, ShaderMaterial, Uniform, Vector2, WebGLMultipleRenderTargets } from "three"
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
				diffuseLightingTexture: new Uniform(inputTexture),
				specularLightingTexture: new Uniform(inputTexture),
				diffuseTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				momentsTexture: new Uniform(null),
				invTexSize: new Uniform(new Vector2()),
				horizontal: new Uniform(true),
				denoiseKernel: new Uniform(1),
				lumaPhiDiffuse: new Uniform(1),
				lumaPhiSpecular: new Uniform(1),
				depthPhi: new Uniform(1),
				normalPhi: new Uniform(1),
				roughnessPhi: new Uniform(1),
				glossinesPhi: new Uniform(1),
				stepSize: new Uniform(1),
				isLastIteration: new Uniform(false),
				_viewMatrix: new Uniform(camera.matrixWorldInverse),
				projectionMatrix: new Uniform(camera.projectionMatrix),
				cameraMatrixWorld: new Uniform(camera.matrixWorld),
				_projectionMatrixInverse: new Uniform(camera.projectionMatrixInverse)
			},
			toneMapped: false,
			glslVersion: GLSL3
		})

		const renderTargetOptions = {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)

		this.renderTargetA.texture[0].type = HalfFloatType
		this.renderTargetA.texture[1].type = HalfFloatType
		this.renderTargetB.texture[0].type = HalfFloatType
		this.renderTargetB.texture[1].type = HalfFloatType

		this.renderTargetA.texture[0].needsUpdate = true
		this.renderTargetA.texture[1].needsUpdate = true
		this.renderTargetB.texture[0].needsUpdate = true
		this.renderTargetB.texture[1].needsUpdate = true

		this.renderPass = new RenderPass(this.scene, this.camera)

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
		const diffuseLightingTexture = this.fullscreenMaterial.uniforms.diffuseLightingTexture.value
		const specularLightingTexture = this.fullscreenMaterial.uniforms.specularLightingTexture.value

		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0
			const stepSize = 2 ** ~~(i / 2)

			this.fullscreenMaterial.uniforms.horizontal.value = horizontal
			this.fullscreenMaterial.uniforms.stepSize.value = stepSize
			this.fullscreenMaterial.uniforms.isLastIteration.value = i === 2 * this.iterations - 1

			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			this.fullscreenMaterial.uniforms.diffuseLightingTexture.value = horizontal
				? i === 0
					? diffuseLightingTexture
					: this.renderTargetB.texture[0]
				: this.renderTargetA.texture[0]

			// specular

			this.fullscreenMaterial.uniforms.specularLightingTexture.value = horizontal
				? i === 0
					? specularLightingTexture
					: this.renderTargetB.texture[1]
				: this.renderTargetA.texture[1]

			this.renderPass.render(renderer, renderTarget)
		}

		this.fullscreenMaterial.uniforms.diffuseLightingTexture.value = diffuseLightingTexture
		this.fullscreenMaterial.uniforms.specularLightingTexture.value = specularLightingTexture
	}

	get texture() {
		return this.renderTargetB.texture[0]
	}
}
