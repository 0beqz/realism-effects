import { Pass } from "postprocessing"
import { GLSL3, HalfFloatType, NoBlending, ShaderMaterial, Uniform, Vector2, WebGLMultipleRenderTargets } from "three"
import { unrollLoops } from "../../ssgi/utils/Utils"
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
	roughnessDependent: false,
	basicVariance: 0.0005
}

const useEdgeStoppingTypes = [
	["moment", "", "useMoment"],
	["depth", "depthPhi", "useDepth"],
	["normal", "normalPhi", "useNormal"],
	["roughness", "roughnessPhi", "useRoughness"]
]

export class DenoisePass extends Pass {
	iterations = 1

	constructor(
		camera,
		textures = [],
		customComposeShader = "",
		customComposeShaderFunctions = "",
		options = defaultDenoisePassOptions
	) {
		super("DenoisePass")
		options = { ...defaultDenoisePassOptions, ...options }

		let definitions = ""
		const finalOutputShader = ""
		let outputShader = ""

		this.textures = textures

		for (let i = 0; i < this.textures.length; i++) {
			definitions += /* glsl */ `layout(location = ${i}) out vec4 gTexture${i};\n`
			definitions += /* glsl */ `uniform sampler2D texture${i};\n`

			outputShader += /* glsl */ `gTexture${i} = vec4(denoisedColor[${i}], sumVariance[${i}]);\n`
		}

		let finalFragmentShader =
			definitions +
			fragmentShader
				.replace("#include <customComposeShaderFunctions>", customComposeShaderFunctions)
				.replace("#include <customComposeShader>", customComposeShader)
				.replace("#include <finalOutputShader>", finalOutputShader)
				.replace("#include <outputShader>", outputShader)
				.replaceAll("textureCount", this.textures.length)
				.replaceAll("momentTextureCount", Math.min(this.textures.length, 2))

		finalFragmentShader = unrollLoops(finalFragmentShader)

		const matches = finalFragmentShader.matchAll(/texture\[\s*[0-9]+\s*]/g)

		for (const [key] of matches) {
			const number = key.replace(/[^0-9]/g, "")
			finalFragmentShader = finalFragmentShader.replace(key, "texture" + number)
		}

		options = { ...defaultDenoisePassOptions, ...options }

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: finalFragmentShader,
			vertexShader: basicVertexShader,
			uniforms: {
				depthTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				momentTexture: new Uniform(null),
				invTexSize: new Uniform(new Vector2()),
				horizontal: new Uniform(true),
				blurHorizontal: new Uniform(true),
				denoiseKernel: new Uniform(1),
				denoiseDiffuse: new Uniform(1),
				denoise: new Uniform([0]),
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
			glslVersion: GLSL3,
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})

		const renderTargetOptions = {
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, this.textures.length, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, this.textures.length, renderTargetOptions)

		// register the texture uniforms
		for (let i = 0; i < this.textures.length; i++) {
			this.fullscreenMaterial.uniforms["texture" + i] = new Uniform(textures[i])
		}

		if (typeof options.roughnessDependent === "boolean") {
			options.roughnessDependent = Array(textures.length).fill(options.roughnessDependent)
		}

		this.fullscreenMaterial.defines.roughnessDependent = /* glsl */ `bool[](${options.roughnessDependent.join(", ")})`

		if (typeof options.basicVariance === "number") {
			options.basicVariance = Array(textures.length).fill(options.basicVariance)
		}

		this.fullscreenMaterial.defines.basicVariance = /* glsl */ `float[](${options.basicVariance
			.map(n => n.toPrecision(5))
			.join(", ")})`

		this.options = options
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)
	}

	dispose() {
		super.dispose()

		this.renderTargetA.dispose()
		this.renderTargetB.dispose()
	}

	keepEdgeStoppingDefinesUpdated() {
		for (const [name, phi, define] of useEdgeStoppingTypes) {
			const useEdgeStoppingType =
				this.options[name] && (phi === "" || this.fullscreenMaterial.uniforms[phi]?.value > 0.001)

			if (useEdgeStoppingType !== define in this.fullscreenMaterial.defines) {
				useEdgeStoppingType
					? (this.fullscreenMaterial.defines[define] = "")
					: delete this.fullscreenMaterial.defines[define]

				this.fullscreenMaterial.needsUpdate = true
			}
		}
	}

	render(renderer) {
		this.keepEdgeStoppingDefinesUpdated()

		const denoiseKernel = this.fullscreenMaterial.uniforms.denoiseKernel.value

		if (this.iterations > 0) {
			if (!("doDenoise" in this.fullscreenMaterial.defines)) {
				this.fullscreenMaterial.defines.doDenoise = ""
				this.fullscreenMaterial.needsUpdate = true
			}

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

				for (let j = 0; j < this.textures.length; j++) {
					this.fullscreenMaterial.uniforms["texture" + j].value = horizontal
						? i === 0
							? this.textures[j]
							: this.renderTargetB.texture[j]
						: this.renderTargetA.texture[j]
				}

				renderer.setRenderTarget(renderTarget)
				renderer.render(this.scene, this.camera)
			}
		} else {
			if ("doDenoise" in this.fullscreenMaterial.defines) {
				delete this.fullscreenMaterial.defines.doDenoise
				this.fullscreenMaterial.needsUpdate = true
			}

			renderer.setRenderTarget(this.renderTargetB)
			renderer.render(this.scene, this.camera)

			this.fullscreenMaterial.uniforms.denoiseKernel.value = denoiseKernel
		}

		for (let i = 0; i < this.textures.length; i++) {
			this.fullscreenMaterial.uniforms["texture" + i].value = this.textures[i]
		}
	}

	// final composition will be written to buffer 0
	get texture() {
		return this.renderTargetB.texture[0]
	}
}
