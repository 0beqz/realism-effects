import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass"
import { VelocityDepthNormalPass } from "../temporal-reproject/pass/VelocityDepthNormalPass"
import { DenoiserComposePass } from "./pass/DenoiserComposePass"
import { PoissionDenoisePass } from "./pass/PoissionDenoisePass"

const defaultDenosierOptions = {
	denoiseMode: "full", // can be "full" | "full_temporal" | "denoised" | "temporal"
	gBufferPass: null,
	velocityDepthNormalPass: null
}

export default class Denoiser {
	constructor(scene, camera, texture, options = defaultDenosierOptions) {
		options = { ...defaultDenosierOptions, ...options }
		this.options = options

		this.velocityDepthNormalPass = options.velocityDepthNormalPass ?? new VelocityDepthNormalPass(scene, camera)
		this.isOwnVelocityDepthNormalPass = !options.velocityDepthNormalPass

		this.temporalReprojectPass = new TemporalReprojectPass(scene, camera, this.velocityDepthNormalPass, 2, {
			fullAccumulate: true,
			logTransform: true,
			copyTextures: !options.denoise,
			reprojectSpecular: [false, true],
			neighborhoodClamp: [false, false],
			neighborhoodClampRadius: 2,
			neighborhoodClampIntensity: 0.5,
			...options
		})

		this.temporalReprojectPass.setTextures(texture)
		const textures = this.temporalReprojectPass.renderTarget.texture.slice(0, 2)

		if (this.options.denoiseMode === "full" || this.options.denoiseMode === "denoised") {
			this.denoisePass = new PoissionDenoisePass(camera, textures)
			this.denoisePass.setGBufferPass(options.gBufferPass ?? this.velocityDepthNormalPass)

			this.temporalReprojectPass.overrideAccumulatedTextures = this.denoisePass.renderTargetB.texture
		}

		if (options.denoiseMode === "full" || options.denoiseMode === "full_temporal") {
			const composerInputTextures = options.denoiseMode === "full" ? this.denoisePass.texture : textures

			this.denoiserComposePass = new DenoiserComposePass(
				camera,
				composerInputTextures,
				options.gBufferPass.texture,
				options.gBufferPass.renderTarget.depthTexture
			)
		}
	}

	get texture() {
		if (this.options.denoiseMode === "full" || this.options.denoiseMode === "full_temporal") {
			return this.denoiserComposePass.texture
		} else if (this.options.denoiseMode === "denoised") {
			return this.denoisePass.texture
		}

		return this.temporalReprojectPass.texture
	}

	reset() {
		this.temporalReprojectPass.reset()
	}

	setSize(width, height) {
		this.velocityDepthNormalPass.setSize(width, height)
		this.temporalReprojectPass.setSize(width, height)
		this.denoisePass?.setSize(width, height)
		this.denoiserComposePass?.setSize(width, height)
	}

	dispose() {
		this.velocityDepthNormalPass.dispose()
		this.temporalReprojectPass.dispose()
		this.denoisePass?.dispose()
		this.denoiserComposePass?.dispose()
	}

	denoise(renderer) {
		if (this.isOwnVelocityDepthNormalPass) this.velocityDepthNormalPass.render(renderer)
		this.temporalReprojectPass.render(renderer)

		this.denoisePass?.render(renderer)
		this.denoiserComposePass?.render(renderer)
	}
}
