import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalResolvePass } from "./pass/SVGFTemporalResolvePass.js"
import { defaultTemporalResolvePassOptions } from "./temporal-resolve/TemporalResolvePass.js"

const requiredTextures = ["inputTexture", "depthTexture", "normalTexture", "velocityTexture"]

const defaultSVGFOptions = {
	...defaultTemporalResolvePassOptions
}

export class SVGF {
	constructor(scene, camera, denoiseComposeShader, denoiseComposeFunctions, options = defaultSVGFOptions) {
		options = { ...defaultSVGFOptions, ...options }

		this.svgfTemporalResolvePass = new SVGFTemporalResolvePass(scene, camera, options)

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

	setDepthTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.depthTexture.value = texture
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.depthTexture.value = texture
	}

	setNormalTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.normalTexture.value = texture
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.normalTexture.value = texture
	}

	setDiffuseTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.diffuseTexture.value = texture
	}

	setVelocityTexture(texture) {
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.velocityTexture.value = texture
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
		requiredTextures.forEach(bufferName => {
			if (!this.svgfTemporalResolvePass.fullscreenMaterial.uniforms[bufferName].value?.isTexture) {
				const functionName = "set" + bufferName[0].toUpperCase() + bufferName.slice(1)
				console.error("SVGF has no " + bufferName + ". Set a " + bufferName + " through " + functionName + "().")
			}
		})
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
