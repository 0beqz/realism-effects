/* eslint-disable camelcase */
import { Pass } from "postprocessing"
import { GLSL3, HalfFloatType, ShaderMaterial, Vector2, WebGLMultipleRenderTargets } from "three"
// eslint-disable-next-line camelcase

import gbuffer_packing from "../../gbuffer/shader/gbuffer_packing.glsl"
import vertexShader from "../../utils/shader/basic.vert"

import { GBufferPass } from "../../gbuffer/GBufferPass"
import { unrollLoops } from "../../ssgi/utils/Utils"
import { useBlueNoise } from "../../utils/BlueNoiseUtils"
import fragmentShader from "../shader/poisson_denoise.frag"

const finalFragmentShader = fragmentShader.replace("#include <gbuffer_packing>", gbuffer_packing)

const defaultPoissonBlurOptions = {
	iterations: 1,
	radius: 3,
	phi: 0.5,
	lumaPhi: 5,
	depthPhi: 2,
	normalPhi: 3.25,
	inputType: "diffuseSpecular" // can be "diffuseSpecular", "diffuse" or "specular"
}

export class PoissonDenoisePass extends Pass {
	iterations = defaultPoissonBlurOptions.iterations
	index = 0

	constructor(camera, textures, options = defaultPoissonBlurOptions) {
		super("PoissonBlurPass")

		options = { ...defaultPoissonBlurOptions, ...options }

		this.textures = textures

		let isTextureSpecular = [false, true]
		if (options.inputType === "diffuse") isTextureSpecular = [false, false]
		if (options.inputType === "specular") isTextureSpecular = [true, true]

		const textureCount = options.inputType === "diffuseSpecular" ? 2 : 1

		const fragmentShader = unrollLoops(finalFragmentShader.replaceAll("textureCount", textureCount))

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader,
			vertexShader,
			uniforms: {
				depthTexture: { value: null },
				inputTexture: { value: textures[0] },
				inputTexture2: { value: textures[1] },
				gBufferTexture: { value: null },
				normalTexture: { value: null },
				projectionMatrix: { value: camera.projectionMatrix },
				projectionMatrixInverse: { value: camera.projectionMatrixInverse },
				cameraMatrixWorld: { value: camera.matrixWorld },
				viewMatrix: { value: camera.matrixWorldInverse },
				radius: { value: defaultPoissonBlurOptions.radius },
				phi: { value: defaultPoissonBlurOptions.phi },
				lumaPhi: { value: defaultPoissonBlurOptions.lumaPhi },
				depthPhi: { value: defaultPoissonBlurOptions.depthPhi },
				normalPhi: { value: defaultPoissonBlurOptions.normalPhi },
				roughnessPhi: { value: defaultPoissonBlurOptions.roughnessPhi },
				specularPhi: { value: defaultPoissonBlurOptions.specularPhi },
				resolution: { value: new Vector2() }
			},
			defines: {
				isTextureSpecular: "bool[2](" + isTextureSpecular.join(",") + ")"
			},
			glslVersion: GLSL3
		})

		useBlueNoise(this.fullscreenMaterial)

		const renderTargetOptions = {
			type: HalfFloatType, // using HalfFloatType as FloatType with bilinear filtering isn't supported on some Apple devices
			depthBuffer: false
		}

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, textureCount, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, textureCount, renderTargetOptions)

		// give the textures of renderTargetA and renderTargetB names
		this.renderTargetB.texture[0].name = "PoissonDenoisePass." + (isTextureSpecular[0] ? "specular" : "diffuse")

		if (textureCount > 1) {
			this.renderTargetB.texture[1].name = "PoissonDenoisePass." + (isTextureSpecular[1] ? "specular" : "diffuse")
		}

		const { uniforms } = this.fullscreenMaterial

		uniforms["depthPhi"].value = options.depthPhi
		uniforms["normalPhi"].value = options.normalPhi
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.resolution.value.set(width, height)
	}

	get texture() {
		return this.renderTargetB.texture
	}

	// can either be a GBufferPass or a VelocityDepthNormalPass
	setGBufferPass(gBufferPass) {
		if (gBufferPass instanceof GBufferPass) {
			this.fullscreenMaterial.uniforms.gBufferTexture.value = gBufferPass.texture
			this.fullscreenMaterial.defines.GBUFFER_TEXTURE = ""
		} else {
			this.fullscreenMaterial.uniforms.normalTexture.value = gBufferPass.texture
		}

		this.fullscreenMaterial.uniforms.depthTexture.value = gBufferPass.renderTarget.depthTexture
	}

	setnNormalTexture(texture) {
		this.fullscreenMaterial.uniforms.normalTexture.value = texture
	}

	setDepthTexture(texture) {
		this.fullscreenMaterial.uniforms.depthTexture.value = texture
	}

	dispose() {
		super.dispose()

		this.renderTargetA.dispose()
		this.renderTargetB.dispose()
		this.fullscreenMaterial.dispose()
	}

	render(renderer) {
		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0
			const inputRenderTarget = horizontal ? this.renderTargetB : this.renderTargetA

			this.fullscreenMaterial.uniforms["inputTexture"].value = i === 0 ? this.textures[0] : inputRenderTarget.texture[0]
			this.fullscreenMaterial.uniforms["inputTexture2"].value =
				i === 0 ? this.textures[1] : inputRenderTarget.texture[1]

			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			renderer.setRenderTarget(renderTarget)
			renderer.render(this.scene, this.camera)
		}
	}
}

PoissonDenoisePass.DefaultOptions = defaultPoissonBlurOptions
