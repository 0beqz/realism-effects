import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalReprojectPass } from "./pass/SVGFTemporalReprojectPass.js"

const requiredTexturesSvgf = ["inputTexture", "depthTexture", "normalTexture", "velocityTexture"]
const requiredTexturesDenoiser = [
	"diffuseLightingTexture",
	"specularLightingTexture",
	"diffuseTexture",
	"depthTexture",
	"normalTexture",
	"momentTexture"
]

export class SVGF {
	constructor(scene, camera, velocityPass, denoiseComposeShader, denoiseComposeFunctions, options = {}) {
		this.svgfTemporalReprojectPass = new SVGFTemporalReprojectPass(scene, camera, velocityPass, options)

		// options for the denoise pass
		options.diffuse = !options.specularOnly
		options.specular = !options.diffuseOnly

		this.denoisePass = new DenoisePass(camera, denoiseComposeShader, denoiseComposeFunctions, options)

		this.denoisePass.fullscreenMaterial.uniforms.momentTexture.value = this.svgfTemporalReprojectPass.momentTexture

		this.denoisePass.fullscreenMaterial.uniforms.diffuseLightingTexture.value =
			this.svgfTemporalReprojectPass.accumulatedTexture

		this.denoisePass.fullscreenMaterial.uniforms.specularLightingTexture.value =
			this.svgfTemporalReprojectPass.specularTexture

		this.options = options
	}

	// the denoised texture
	get texture() {
		return this.denoisePass.texture
	}

	setInputTexture(texture) {
		this.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.inputTexture.value = texture
	}

	setSpecularTexture(texture) {
		this.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.specularTexture.value = texture
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

	ensureAllTexturesSet() {
		for (const bufferName of requiredTexturesSvgf) {
			if (!this.svgfTemporalReprojectPass.fullscreenMaterial.uniforms[bufferName].value?.isTexture) {
				console.error("SVGF has no non-jittered " + bufferName)
			}
		}

		for (const bufferName of requiredTexturesDenoiser) {
			if (!this.options.diffuse && bufferName === "diffuseLightingTexture") continue
			if (!this.options.specular && bufferName === "specularLightingTexture") continue

			if (!this.denoisePass.fullscreenMaterial.uniforms[bufferName].value?.isTexture) {
				console.error("SVGF has no non-jittered " + bufferName)
			}
		}
	}

	render(renderer) {
		this.ensureAllTexturesSet()

		this.svgfTemporalReprojectPass.render(renderer)
		this.denoisePass.render(renderer)
	}
}
