import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalResolvePass } from "./pass/SVGFTemporalResolvePass.js"

const requiredTextures = ["inputTexture", "depthTexture", "normalTexture", "velocityTexture"]

export class SVGF {
	constructor(scene, camera, denoiseComposeShader, denoiseComposeFunctions, options = {}) {
		this.svgfTemporalResolvePass = new SVGFTemporalResolvePass(scene, camera, options)

		// options for the denoise pass
		options.diffuse = !options.specularOnly
		options.specular = !options.diffuseOnly

		this.denoisePass = new DenoisePass(camera, null, denoiseComposeShader, denoiseComposeFunctions, options)

		this.denoisePass.fullscreenMaterial.uniforms.momentTexture.value = this.svgfTemporalResolvePass.momentTexture
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
		for (const bufferName of requiredTextures) {
			if (!this.svgfTemporalResolvePass.fullscreenMaterial.uniforms[bufferName].value?.isTexture) {
				const functionName = "set" + bufferName[0].toUpperCase() + bufferName.slice(1)
				console.error("SVGF has no " + bufferName + ". Set a " + bufferName + " through " + functionName + "().")
			}
		}
	}

	render(renderer) {
		this.ensureAllTexturesSet()

		this.denoisePass.fullscreenMaterial.uniforms.diffuseLightingTexture.value =
			this.svgfTemporalResolvePass.accumulatedTexture

		this.denoisePass.fullscreenMaterial.uniforms.specularLightingTexture.value =
			this.svgfTemporalResolvePass.specularTexture

		this.svgfTemporalResolvePass.render(renderer)
		this.denoisePass.render(renderer)
	}
}
