import { HalfFloatType, LinearFilter, NearestFilter } from "three"
import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalResolvePass } from "./pass/SVGFTemporalResolvePass.js"
import { defaultTemporalResolvePassOptions } from "./temporal-resolve/TemporalResolvePass.js"

const requiredTextures = ["inputTexture", "depthTexture", "normalTexture", "velocityTexture"]

const defaultSVGFOptions = {
	...defaultTemporalResolvePassOptions
}

export class SVGF {
	constructor(scene, camera, options = defaultSVGFOptions) {
		options = { ...defaultSVGFOptions, ...options }

		this.svgfTemporalResolvePass = new SVGFTemporalResolvePass(scene, camera, options)

		this.denoisePass = new DenoisePass(camera, null, options)

		this.denoisePass.fullscreenMaterial.uniforms.momentTexture.value = this.svgfTemporalResolvePass.momentTexture
		this.svgfTemporalResolvePass.copyPass.fullscreenMaterial.uniforms.inputTexture4.value =
			this.svgfTemporalResolvePass.momentTexture
		this.svgfTemporalResolvePass.copyPass.fullscreenMaterial.uniforms.inputTexture5.value =
			this.svgfTemporalResolvePass.specularTexture

		const lastMomentTexture = this.svgfTemporalResolvePass.copyPass.renderTarget.texture[0].clone()
		lastMomentTexture.isRenderTargetTexture = true
		this.svgfTemporalResolvePass.copyPass.renderTarget.texture.push(lastMomentTexture)
		this.svgfTemporalResolvePass.copyPass.fullscreenMaterial.defines.textureCount++

		lastMomentTexture.type = HalfFloatType
		lastMomentTexture.minFilter = NearestFilter
		lastMomentTexture.magFilter = NearestFilter
		lastMomentTexture.needsUpdate = true

		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.lastMomentTexture.value = lastMomentTexture

		const lastSpecularTexture = this.svgfTemporalResolvePass.copyPass.renderTarget.texture[0].clone()
		lastSpecularTexture.isRenderTargetTexture = true
		this.svgfTemporalResolvePass.copyPass.renderTarget.texture.push(lastSpecularTexture)
		this.svgfTemporalResolvePass.copyPass.fullscreenMaterial.defines.textureCount++

		lastSpecularTexture.type = HalfFloatType
		lastMomentTexture.minFilter = LinearFilter
		lastMomentTexture.magFilter = LinearFilter
		lastSpecularTexture.needsUpdate = true

		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.lastSpecularTexture.value = lastSpecularTexture
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

		this.denoisePass.fullscreenMaterial.uniforms.diffuseLightingTexture.value =
			this.svgfTemporalResolvePass.accumulatedTexture

		this.denoisePass.fullscreenMaterial.uniforms.specularLightingTexture.value =
			this.svgfTemporalResolvePass.specularTexture
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

		this.svgfTemporalResolvePass.render(renderer)
		this.denoisePass.render(renderer)
	}
}
