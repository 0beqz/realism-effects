import { Pass } from "postprocessing"
import { GLSL3, HalfFloatType, ShaderMaterial, Uniform, Vector2, WebGLMultipleRenderTargets } from "three"
import basicVertexShader from "../../utils/shader/basic.vert"
import fragmentShader from "../shader/denoise.frag"

// https://research.nvidia.com/sites/default/files/pubs/2017-07_Spatiotemporal-Variance-Guided-Filtering%3A//svgf_preprint.pdf
// https://diharaw.github.io/post/adventures_in_hybrid_rendering/
// https://github.com/NVIDIAGameWorks/Falcor/tree/master/Source/RenderPasses/SVGFPass

const defaultDenoisePassOptions = {
	moment: true,
	depth: true,
	normal: true,
	roughness: true,
	diffuse: true,
	specular: true
}

const useEdgeStoppingTypes = [
	["depth", "depthPhi", "useDepth"],
	["normal", "normalPhi", "useNormal"],
	["roughness", "roughnessPhi", "useRoughness"]
]

export class DenoisePass extends Pass {
	iterations = 1

	constructor(
		camera,
		customComposeShader = "",
		customComposeShaderFunctions = "",
		options = defaultDenoisePassOptions
	) {
		super("DenoisePass")

		const finalFragmentShader = fragmentShader
			.replace("#include <customComposeShaderFunctions>", customComposeShaderFunctions)
			.replace("#include <customComposeShader>", customComposeShader)

		options = { ...defaultDenoisePassOptions, ...options }

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: finalFragmentShader,
			vertexShader: basicVertexShader,
			uniforms: {
				diffuseLightingTexture: new Uniform(null),
				specularLightingTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				momentTexture: new Uniform(null),
				invTexSize: new Uniform(new Vector2()),
				horizontal: new Uniform(true),
				blurHorizontal: new Uniform(true),
				denoiseKernel: new Uniform(1),
				denoiseDiffuse: new Uniform(1),
				denoiseSpecular: new Uniform(1),
				depthPhi: new Uniform(1),
				normalPhi: new Uniform(1),
				roughnessPhi: new Uniform(1),
				stepSize: new Uniform(1),
				isFirstIteration: new Uniform(false),
				isLastIteration: new Uniform(false),
				viewMatrix: new Uniform(camera.matrixWorldInverse),
				projectionMatrix: new Uniform(camera.projectionMatrix),
				cameraMatrixWorld: new Uniform(camera.matrixWorld),
				projectionMatrixInverse: new Uniform(camera.projectionMatrixInverse)
			},
			glslVersion: GLSL3
		})

		if (options.diffuse) this.fullscreenMaterial.defines.DENOISE_DIFFUSE = ""
		if (options.specular) this.fullscreenMaterial.defines.DENOISE_SPECULAR = ""

		const renderTargetOptions = {
			type: HalfFloatType,
			depthBuffer: false
		}

		const bufferCount = this.isUsingDiffuse() && this.isUsingSpecular() ? 2 : 1

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, bufferCount, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, bufferCount, renderTargetOptions)

		for (const texture of [...this.renderTargetA.texture, ...this.renderTargetB.texture]) {
			texture.type = HalfFloatType
			texture.needsUpdate = true
		}

		this.options = options
	}

	isUsingDiffuse() {
		return "DENOISE_DIFFUSE" in this.fullscreenMaterial.defines
	}

	isUsingSpecular() {
		return "DENOISE_SPECULAR" in this.fullscreenMaterial.defines
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
		for (const [name, phi, define] of useEdgeStoppingTypes) {
			const useEdgeStoppingType = this.options[name] && this.fullscreenMaterial.uniforms[phi].value > 0.001

			if (useEdgeStoppingType !== define in this.fullscreenMaterial.defines) {
				useEdgeStoppingType
					? (this.fullscreenMaterial.defines[define] = "")
					: delete this.fullscreenMaterial.defines[define]

				this.fullscreenMaterial.needsUpdate = true
			}
		}

		const diffuseLightingTexture = this.fullscreenMaterial.uniforms.diffuseLightingTexture.value
		const specularLightingTexture = this.fullscreenMaterial.uniforms.specularLightingTexture.value

		const denoiseKernel = this.fullscreenMaterial.uniforms.denoiseKernel.value

		const isUsingDiffuse = this.isUsingDiffuse()
		const isUsingSpecular = this.isUsingSpecular()

		const specularOffset = isUsingDiffuse ? 1 : 0

		if (this.iterations > 0) {
			for (let i = 0; i < 2 * this.iterations; i++) {
				const horizontal = i % 2 === 0
				const stepSize = 2 ** ~~(i / 2)

				const n = parseInt(Math.log2(stepSize))
				const blurHorizontal = n % 2 == 0

				this.fullscreenMaterial.uniforms.horizontal.value = horizontal
				this.fullscreenMaterial.uniforms.blurHorizontal.value = blurHorizontal

				this.fullscreenMaterial.uniforms.stepSize.value = stepSize
				this.fullscreenMaterial.uniforms.isFirstIteration.value = i === 0
				this.fullscreenMaterial.uniforms.isLastIteration.value = i === 2 * this.iterations - 1

				const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

				// diffuse
				if (isUsingDiffuse) {
					this.fullscreenMaterial.uniforms.diffuseLightingTexture.value = horizontal
						? i === 0
							? diffuseLightingTexture
							: this.renderTargetB.texture[0]
						: this.renderTargetA.texture[0]
				}

				// specular
				if (isUsingSpecular) {
					this.fullscreenMaterial.uniforms.specularLightingTexture.value = horizontal
						? i === 0
							? specularLightingTexture
							: this.renderTargetB.texture[specularOffset]
						: this.renderTargetA.texture[specularOffset]
				}

				renderer.setRenderTarget(renderTarget)
				renderer.render(this.scene, this.camera)
			}
		} else {
			this.fullscreenMaterial.uniforms.denoiseKernel.value = 0

			renderer.setRenderTarget(this.renderTargetB)
			renderer.render(this.scene, this.camera)

			this.fullscreenMaterial.uniforms.denoiseKernel.value = denoiseKernel
		}

		this.fullscreenMaterial.uniforms.diffuseLightingTexture.value = diffuseLightingTexture
		this.fullscreenMaterial.uniforms.specularLightingTexture.value = specularLightingTexture
	}

	// final composition will be written to buffer 0
	get texture() {
		return this.renderTargetB.texture[0]
	}
}
