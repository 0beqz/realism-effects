import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass"
import { PoissionDenoisePass } from "./PoissionDenoisePass"

// todo: implement this
export default class RecurrentRaytracingDenoiser {
	constructor(scene, camera, velocityDepthNormalPass) {
		this.temporalReprojectPass = new TemporalReprojectPass(scene, camera, velocityDepthNormalPass, 2, {
			fullAccumulate: true,
			logTransform: true,
			copyTextures: false
		})

		const textures = this.temporalReprojectPass.renderTarget.texture.slice(0, 2)

		this.denoisePass = new PoissionDenoisePass(camera, textures[0], window.depthTexture)
		this.denoisePass.inputTexture2 = textures[1]

		this.temporalReprojectPass.overrideAccumulatedTextures = this.denoisePass.renderTargetB.texture

		this.setNonJitteredDepthTexture(velocityDepthNormalPass.depthTexture)
	}
}
