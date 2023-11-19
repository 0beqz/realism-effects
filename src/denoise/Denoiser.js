import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass"
import { VelocityDepthNormalPass } from "../temporal-reproject/pass/VelocityDepthNormalPass"
import { DenoiserComposePass } from "./pass/DenoiserComposePass"
import { PoissionDenoisePass } from "./pass/PoissionDenoisePass"

const defaultDenosierOptions = {
	denoiseMode: "full", // can be "full" | "full_temporal" | "denoised" | "temporal"
	inputType: "diffuseSpecular", // can be "diffuseSpecular" | "diffuse" | "specular"
	gBufferPass: null,
	velocityDepthNormalPass: null
}

// a spatio-temporal denoiser
// temporal: temporal reprojection to reproject previous frames
// spatial: poisson denoiser to denoise the current frame recurrently
export default class Denoiser {
	constructor(scene, camera, texture, options = defaultDenosierOptions) {
		options = { ...defaultDenosierOptions, ...options }
		this.options = options

		this.velocityDepthNormalPass = options.velocityDepthNormalPass ?? new VelocityDepthNormalPass(scene, camera)
		this.isOwnVelocityDepthNormalPass = !options.velocityDepthNormalPass

		const textureCount = options.inputType === "diffuseSpecular" ? 2 : 1

		this.temporalReprojectPass = new TemporalReprojectPass(
			scene,
			camera,
			this.velocityDepthNormalPass,
			texture,
			textureCount,
			{
				fullAccumulate: true,

				logTransform: true,
				copyTextures: !options.denoise,
				reprojectSpecular: [false, true],
				neighborhoodClamp: [false, false],
				neighborhoodClampRadius: 2,
				neighborhoodClampIntensity: 0.25,
				...options
			}
		)

		const textures = this.temporalReprojectPass.renderTarget.texture.slice(0, textureCount)

		if (this.options.denoiseMode === "full" || this.options.denoiseMode === "denoised") {
			this.denoisePass = new PoissionDenoisePass(camera, textures, options)
			this.denoisePass.setGBufferPass(options.gBufferPass ?? this.velocityDepthNormalPass)

			this.temporalReprojectPass.overrideAccumulatedTextures = this.denoisePass.renderTargetB.texture
		}

		const composerInputTextures = this.denoisePass?.texture ?? textures

		if (options.denoiseMode.startsWith("full")) {
			this.denoiserComposePass = new DenoiserComposePass(
				camera,
				composerInputTextures,
				options.gBufferPass.texture,
				options.gBufferPass.renderTarget.depthTexture,
				options
			)
		}
	}

	get texture() {
		switch (this.options.denoiseMode) {
			case "full":
			case "full_temporal":
				return this.denoiserComposePass.texture
			case "denoised":
				return this.denoisePass.texture
			case "temporal":
				return this.temporalReprojectPass.texture
		}
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

	render(renderer, inputBuffer = null) {
		if (this.isOwnVelocityDepthNormalPass) this.velocityDepthNormalPass.render(renderer)
		this.temporalReprojectPass.render(renderer)

		if (this.options.inputType !== "diffuseSpecular") {
			this.denoiserComposePass?.setSceneTexture(inputBuffer.texture)
		}

		this.denoisePass?.render(renderer)
		this.denoiserComposePass?.render(renderer)
	}
}
