import { PoissionDenoisePass } from "../denoise/PoissionDenoisePass.js"
import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass.js"

export class SVGF {
	constructor(scene, camera, velocityDepthNormalPass, textureCount = 1, options = {}) {
		this.svgfTemporalReprojectPass = new TemporalReprojectPass(scene, camera, velocityDepthNormalPass, textureCount, {
			...options,
			fullAccumulate: true,
			logTransform: true,
			copyTextures: false
		})

		const textures = this.svgfTemporalReprojectPass.renderTarget.texture.slice(0, textureCount)

		// this.denoisePass = new DenoisePass(camera, textures, options)
		// this.denoisePass.setMomentTexture(this.svgfTemporalReprojectPass.momentTexture)

		this.denoisePass = new PoissionDenoisePass(camera, textures[0], null, options)
		this.denoisePass.inputTexture2 = textures[1]

		this.svgfTemporalReprojectPass.overrideAccumulatedTextures = this.denoisePass.renderTargetB.texture

		this.setNonJitteredDepthTexture(velocityDepthNormalPass.depthTexture)
	}

	// the denoised texture
	get texture() {
		return this.denoisePass.texture
	}

	setGBuffer(depthTexture, normalTexture) {
		this.setJitteredGBuffer(depthTexture, normalTexture)
		this.setNonJitteredGBuffer(depthTexture, normalTexture)
	}

	setJitteredGBuffer(depthTexture, normalTexture, { useRoughnessInAlphaChannel = false } = {}) {
		// this.denoisePass.setDepthTexture(depthTexture)
		// this.denoisePass.setNormalTexture(normalTexture, { useRoughnessInAlphaChannel })
	}

	setNonJitteredDepthTexture(depthTexture) {
		this.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.depthTexture.value = depthTexture
	}

	setVelocityTexture(texture) {
		this.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.velocityTexture.value = texture
	}

	setSize(width, height) {
		this.denoisePass.setSize(width, height)

		this.svgfTemporalReprojectPass.setSize(width, height)
	}

	dispose() {
		this.denoisePass.dispose()
		this.svgfTemporalReprojectPass.dispose()
	}

	render(renderer) {
		this.svgfTemporalReprojectPass.render(renderer)
		this.denoisePass.render(renderer)
	}
}
