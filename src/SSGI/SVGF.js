import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalResolvePass } from "./pass/SVGFTemporalResolvePass.js"

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
	constructor(scene, camera, denoiseComposeShader, denoiseComposeFunctions, options = {}) {
		this.svgfTemporalResolvePass = new SVGFTemporalResolvePass(scene, camera, options)

		// options for the denoise pass
		options.diffuse = !options.specularOnly
		options.specular = !options.diffuseOnly

		this.denoisePass = new DenoisePass(camera, denoiseComposeShader, denoiseComposeFunctions, options)

		this.denoisePass.fullscreenMaterial.uniforms.momentTexture.value = this.svgfTemporalResolvePass.momentTexture

		this.denoisePass.fullscreenMaterial.uniforms.diffuseLightingTexture.value =
			this.svgfTemporalResolvePass.accumulatedTexture

		this.denoisePass.fullscreenMaterial.uniforms.specularLightingTexture.value =
			this.svgfTemporalResolvePass.specularTexture

		this.options = options
	}

	// the denoised texture
	get texture() {
		return this.denoisePass.texture
	}

	setInputTexture(texture) {
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = texture
	}

	setSpecularTexture(texture) {
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.specularTexture.value = texture
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
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.depthTexture.value = depthTexture
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.normalTexture.value = normalTexture
	}

	setVelocityTexture(texture) {
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.velocityTexture.value = texture
	}

	setDiffuseTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.diffuseTexture.value = texture
	}

	setSize(width, height) {
		this.denoisePass.setSize(width, height)

		this.svgfTemporalResolvePass.setSize(width, height)
	}

	dispose() {
		this.denoisePass.dispose()
		this.svgfTemporalResolvePass.dispose()
	}

	ensureAllTexturesSet() {
		for (const bufferName of requiredTexturesSvgf) {
			if (!this.svgfTemporalResolvePass.fullscreenMaterial.uniforms[bufferName].value?.isTexture) {
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

		this.svgfTemporalResolvePass.render(renderer)
		this.denoisePass.render(renderer)
	}
}
