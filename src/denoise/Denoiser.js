import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass"
import { VelocityDepthNormalPass } from "../temporal-reproject/pass/VelocityDepthNormalPass"
import { DenoiserComposePass } from "./pass/DenoiserComposePass"
import { PoissionDenoisePass } from "./pass/PoissionDenoisePass"

const defaultDenosierOptions = {
	gBufferPass: null,
	velocityDepthNormalPass: null,
	mode: "full" // can be "full" or "denoise"
}

export default class Denoiser {
	constructor(scene, camera, texture, options = defaultDenosierOptions) {
		options = { ...defaultDenosierOptions, ...options }

		this.velocityDepthNormalPass = options.velocityDepthNormalPass ?? new VelocityDepthNormalPass(scene, camera)
		this.isOwnVelocityDepthNormalPass = !options.velocityDepthNormalPass

		this.temporalReprojectPass = new TemporalReprojectPass(scene, camera, this.velocityDepthNormalPass, 2, {
			fullAccumulate: true,
			logTransform: true,
			copyTextures: false,
			reprojectSpecular: [false, true],
			neighborhoodClamp: [false, true],
			neighborhoodClampRadius: 2,
			neighborhoodClampIntensity: 0.5
		})

		this.temporalReprojectPass.setTextures(texture)

		const textures = this.temporalReprojectPass.renderTarget.texture.slice(0, 2)

		this.denoisePass = new PoissionDenoisePass(camera, textures)
		this.denoisePass.setGBufferPass(options.gBufferPass || this.velocityDepthNormalPass)

		this.temporalReprojectPass.overrideAccumulatedTextures = this.denoisePass.renderTargetB.texture

		if (options.mode === "full") {
			this.denoiserComposePass = new DenoiserComposePass(
				camera,
				this.denoisePass.texture,
				options.gBufferPass.texture,
				options.gBufferPass.renderTarget.depthTexture
			)
		}
	}

	// the texture of the denoiseComposePass will be a single texture
	// the texture of the denoisePass will be 2 textures (diffuse & specular) lighting
	get texture() {
		return this.denoiserComposePass?.texture ?? this.denoisePass.texture[0]
	}

	reset() {
		this.temporalReprojectPass.reset()
	}

	setSize(width, height) {
		this.velocityDepthNormalPass.setSize(width, height)
		this.temporalReprojectPass.setSize(width, height)
		this.denoisePass.setSize(width, height)
		this.denoiserComposePass?.setSize(width, height)
	}

	dispose() {
		this.velocityDepthNormalPass.dispose()
		this.temporalReprojectPass.dispose()
		this.denoisePass.dispose()
		this.denoiserComposePass?.dispose()
	}

	denoise(renderer) {
		if (this.isOwnVelocityDepthNormalPass) this.velocityDepthNormalPass.render(renderer)
		this.temporalReprojectPass.render(renderer)
		this.denoisePass.render(renderer)
		this.denoiserComposePass?.render(renderer)
	}
}
