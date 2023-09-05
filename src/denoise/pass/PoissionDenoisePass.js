/* eslint-disable camelcase */
import { Pass } from "postprocessing"
import { FloatType, GLSL3, ShaderMaterial, Vector2, WebGLMultipleRenderTargets } from "three"
// eslint-disable-next-line camelcase

import vertexShader from "../../utils/shader/basic.vert"
import gbuffer_packing from "../../gbuffer/shader/gbuffer_packing.glsl"

import { useBlueNoise } from "../../utils/BlueNoiseUtils"
import fragmentShader from "../shader/poission_denoise.frag"
import { generateDenoiseSamples, generatePoissonDiskConstant } from "../utils/PoissonUtils"
import { GBufferPass } from "../../gbuffer/GBufferPass"

const finalFragmentShader = fragmentShader.replace("#include <gbuffer_packing>", gbuffer_packing)

const defaultPoissonBlurOptions = {
	iterations: 1,
	radius: 3,
	phi: 0.5,
	lumaPhi: 5,
	depthPhi: 2,
	normalPhi: 3.25
}

export class PoissionDenoisePass extends Pass {
	iterations = defaultPoissonBlurOptions.iterations
	index = 0

	constructor(camera, textures, options = defaultPoissonBlurOptions) {
		super("PoissionBlurPass")

		options = { ...defaultPoissonBlurOptions, ...options }

		this.textures = textures

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: finalFragmentShader,
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
				resolution: { value: new Vector2() }
			},
			glslVersion: GLSL3
		})

		useBlueNoise(this.fullscreenMaterial)

		const renderTargetOptions = {
			type: FloatType, // using HalfFloatType causes the texture to become darker over time
			depthBuffer: false
		}

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)

		// give the textures of renderTargetA and renderTargetB names
		this.renderTargetA.texture[0].name = "PoissionDenoisePass.diffuse"
		this.renderTargetA.texture[1].name = "PoissionDenoisePass.specular"

		this.renderTargetB.texture[0].name = "PoissionDenoisePass.diffuse"
		this.renderTargetB.texture[1].name = "PoissionDenoisePass.specular"

		const { uniforms } = this.fullscreenMaterial

		uniforms["depthPhi"].value = options.depthPhi
		uniforms["normalPhi"].value = options.normalPhi
	}

	updatePoissionDiskSamples(width, height) {
		const poissonDisk = generateDenoiseSamples(new Vector2(1 / width, 1 / height))

		const poissonDiskConstant = generatePoissonDiskConstant(poissonDisk)
		this.fullscreenMaterial.defines.POISSON_DISK_SAMPLES = poissonDiskConstant
		this.fullscreenMaterial.needsUpdate = true
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.resolution.value.set(width, height)

		this.updatePoissionDiskSamples(width, height)
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

	setnormalTexture(texture) {
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

PoissionDenoisePass.DefaultOptions = defaultPoissonBlurOptions
