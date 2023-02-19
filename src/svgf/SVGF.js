import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalReprojectPass } from "./pass/SVGFTemporalReprojectPass.js"

export class SVGF {
	constructor(
		scene,
		camera,
		velocityPass,
		textureCount = 1,
		denoiseComposeShader = "",
		denoiseComposeFunctions = "",
		options = {}
	) {
		this.svgfTemporalReprojectPass = new SVGFTemporalReprojectPass(scene, camera, velocityPass, textureCount, options)

		const textures = this.svgfTemporalReprojectPass.renderTarget.texture.slice(0, textureCount)

		this.denoisePass = new DenoisePass(camera, textures, denoiseComposeShader, denoiseComposeFunctions, options)

		this.denoisePass.fullscreenMaterial.uniforms.momentTexture.value = this.svgfTemporalReprojectPass.momentTexture

		this.setNonJitteredGBuffers(velocityPass.depthTexture, velocityPass.normalTexture)
	}

	// the denoised texture
	get texture() {
		return this.denoisePass.texture
	}

	setGBuffers(depthTexture, normalTexture) {
		this.setJitteredGBuffers(depthTexture, normalTexture)
		this.setNonJitteredGBuffers(depthTexture, normalTexture)
	}

	setJitteredGBuffers(depthTexture, normalTexture) {
		this.denoisePass.fullscreenMaterial.uniforms.depthTexture.value = depthTexture
		this.denoisePass.fullscreenMaterial.uniforms.normalTexture.value = normalTexture
	}

	setNonJitteredGBuffers(depthTexture, normalTexture) {
		this.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.depthTexture.value = depthTexture
		this.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.normalTexture.value = normalTexture
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
