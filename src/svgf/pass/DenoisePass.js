﻿import { Pass } from "postprocessing"
import {
	BasicDepthPacking,
	GLSL3,
	HalfFloatType,
	NoBlending,
	RGBADepthPacking,
	ShaderMaterial,
	Uniform,
	UnsignedByteType,
	Vector2,
	WebGLMultipleRenderTargets
} from "three"
import { unrollLoops } from "../../ssgi/utils/Utils"
// eslint-disable-next-line camelcase
import gbuffer_packing from "../../utils/shader/gbuffer_packing.glsl"
import basicVertexShader from "../../utils/shader/basic.vert"
import fragmentShader from "../shader/denoise.frag"

// https://research.nvidia.com/sites/default/files/pubs/2017-07_Spatiotemporal-Variance-Guided-Filtering%3A//svgf_preprint.pdf
// https://diharaw.github.io/post/adventures_in_hybrid_rendering/
// https://github.com/NVIDIAGameWorks/Falcor/tree/master/Source/RenderPasses/SVGFPass

const defaultDenoisePassOptions = {
	moment: false,
	depth: false,
	normal: false,
	roughness: false,
	diffuse: true,
	roughnessDependent: false,
	basicVariance: 0.00025,
	denoiseCustomComposeShader: "",
	denoiseCustomComposeShaderFunctions: ""
}

const useEdgeStoppingTypes = [
	["moment", "", "useMoment"],
	["depth", "depthPhi", "useDepth"],
	["normal", "normalPhi", "useNormal"],
	["roughness", "roughnessPhi", "useRoughness"]
]

export class DenoisePass extends Pass {
	iterations = 1

	constructor(camera, textures = [], options = defaultDenoisePassOptions) {
		super("DenoisePass")

		if (!Array.isArray(textures)) textures = [textures]

		options = { ...defaultDenoisePassOptions, ...options }
		this.options = options

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: "",
			vertexShader: basicVertexShader,
			uniforms: {
				depthTexture: new Uniform(null),
				gBuffersTexture: new Uniform(null),
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
				diffusePhi: new Uniform(1),
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

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, textures.length, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, textures.length, renderTargetOptions)

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

		// register the texture uniforms
		this.setTextures(textures)
	}

	setTextures(textures) {
		if (!Array.isArray(textures)) textures = [textures]

		this.textures = textures

		let definitions = ""
		let outputShader = ""

		for (let i = 0; i < this.textures.length; i++) {
			definitions += /* glsl */ `layout(location = ${i}) out vec4 gTexture${i};\n`
			definitions += /* glsl */ `uniform sampler2D inputTexture${i};\n`

			outputShader += /* glsl */ `gTexture${i} = vec4(denoisedColor[${i}], sumVariance[${i}]);\n`
		}

		let finalFragmentShader =
			definitions +
			fragmentShader
				.replace("#include <denoiseCustomComposeShaderFunctions>", this.options.denoiseCustomComposeShaderFunctions)
				.replace("#include <denoiseCustomComposeShader>", this.options.denoiseCustomComposeShader)
				.replace("#include <outputShader>", outputShader)
				.replace("#include <gbuffer_packing>", gbuffer_packing)
				.replaceAll("textureCount", this.textures.length)
				.replaceAll("momentTextureCount", Math.min(this.textures.length, 2))

		finalFragmentShader = unrollLoops(finalFragmentShader)

		const matches = finalFragmentShader.matchAll(/inputTexture\[\s*[0-9]+\s*]/g)

		for (const [key] of matches) {
			const number = key.replace(/[^0-9]/g, "")
			finalFragmentShader = finalFragmentShader.replace(key, "inputTexture" + number)
		}

		delete this.fullscreenMaterial.defines.useTemporalReprojectTextures

		for (let i = 0; i < textures.length; i++) {
			const texture = textures[i]
			this.fullscreenMaterial.uniforms["inputTexture" + i] = new Uniform(texture)

			if (texture.name.includes("TemporalReprojectPass.accumulatedTexture")) {
				this.fullscreenMaterial.defines.useTemporalReprojectTextures = ""
			}
		}

		this.fullscreenMaterial.fragmentShader = finalFragmentShader
		this.fullscreenMaterial.needsUpdate = true
	}

	setDepthTexture(depthTexture) {
		this.fullscreenMaterial.uniforms.depthTexture.value = depthTexture

		const packing = depthTexture.type === UnsignedByteType ? RGBADepthPacking : BasicDepthPacking

		if (packing === RGBADepthPacking) {
			this.fullscreenMaterial.defines.RGBA_DEPTH_PACKING = ""
		} else {
			delete this.fullscreenMaterial.defines.RGBA_DEPTH_PACKING
		}

		this.options.depth = true
	}

	setGBuffersTexture(gBuffersTexture) {
		this.fullscreenMaterial.uniforms.gBuffersTexture.value = gBuffersTexture

		this.options.normal = true
		this.options.roughness = true
	}

	setNormalTexture(normalTexture, { useRoughnessInAlphaChannel = false } = {}) {
		this.fullscreenMaterial.uniforms.normalTexture.value = normalTexture

		this.options.normal = true
		this.options.roughness = useRoughnessInAlphaChannel
	}

	setMomentTexture(momentTexture) {
		this.fullscreenMaterial.uniforms.momentTexture.value = momentTexture

		this.options.moment = true
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

				const n = Math.log2(stepSize)
				const blurHorizontal = n % 2 == 0

				this.fullscreenMaterial.uniforms.horizontal.value = horizontal
				this.fullscreenMaterial.uniforms.blurHorizontal.value = blurHorizontal

				this.fullscreenMaterial.uniforms.stepSize.value = stepSize
				this.fullscreenMaterial.uniforms.isFirstIteration.value = i === 0
				this.fullscreenMaterial.uniforms.isLastIteration.value = i === 2 * this.iterations - 1

				const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

				for (let j = 0; j < this.textures.length; j++) {
					this.fullscreenMaterial.uniforms["inputTexture" + j].value = horizontal
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

		// reset the input textures
		for (let i = 0; i < this.textures.length; i++) {
			this.fullscreenMaterial.uniforms["inputTexture" + i].value = this.textures[i]
		}
	}

	// final composition will be written to buffer 0
	get texture() {
		return this.renderTargetB.texture[0]
	}
}
