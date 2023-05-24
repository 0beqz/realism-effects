import { PoissionDenoisePass } from "../poissionDenoise/PoissionDenoisePass.js"
import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass.js"
import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalReprojectPass } from "./pass/SVGFTemporalReprojectPass.js"

export class SVGF {
	constructor(scene, camera, velocityDepthNormalPass, textureCount = 1, options = {}) {
		this.svgfTemporalReprojectPass = new TemporalReprojectPass(scene, camera, velocityDepthNormalPass, textureCount, {
			...options,
			fullAccumulate: false
		})

		const textures = this.svgfTemporalReprojectPass.renderTarget.texture.slice(0, textureCount)

		// this.denoisePass = new DenoisePass(camera, textures, options)
		// this.denoisePass.setMomentTexture(this.svgfTemporalReprojectPass.momentTexture)

		this.denoisePass = new PoissionDenoisePass(camera, textures[0], window.depthTexture, options)
		this.denoisePass.inputTexture2 = textures[1]

		this.setNonJitteredDepthTexture(velocityDepthNormalPass.depthTexture)
	}

	// the denoised texture
	get texture() {
		return this.denoisePass.texture
	}

	setGBuffers(depthTexture, normalTexture) {
		this.setJitteredGBuffers(depthTexture, normalTexture)
		this.setNonJitteredGBuffers(depthTexture, normalTexture)
	}

	setJitteredGBuffers(depthTexture, normalTexture, { useRoughnessInAlphaChannel = false } = {}) {
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
