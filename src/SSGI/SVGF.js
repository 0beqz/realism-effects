import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalResolvePass } from "./pass/SVGFTemporalResolvePass.js"
import { defaultTemporalResolvePassOptions } from "./temporal-resolve/TemporalResolvePass.js"

const requiredTextures = ["inputTexture", "depthTexture", "normalTexture", "velocityTexture"]

const defaultSVGFOptions = {
	...defaultTemporalResolvePassOptions,
	moments: true
}

export class SVGF {
	constructor(scene, camera, options = defaultSVGFOptions) {
		options = { ...defaultSVGFOptions, ...options }

		this.svgfTemporalResolvePass = new SVGFTemporalResolvePass(scene, camera, options)

		this.denoisePass = new DenoisePass(camera, null, options)

		if (options.moments) {
			this.denoisePass.fullscreenMaterial.uniforms.momentsTexture.value = this.svgfTemporalResolvePass.momentsTexture
			this.svgfTemporalResolvePass.copyPass.fullscreenMaterial.uniforms.inputTexture3.value =
				this.svgfTemporalResolvePass.momentsTexture

			const lastMomentsTexture = this.svgfTemporalResolvePass.copyPass.renderTarget.texture[0].clone()
			lastMomentsTexture.isRenderTargetTexture = true
			this.svgfTemporalResolvePass.copyPass.renderTarget.texture.push(lastMomentsTexture)
			this.svgfTemporalResolvePass.copyPass.fullscreenMaterial.defines.textureCount++

			this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.lastMomentsTexture.value = lastMomentsTexture
		}
	}

	// the denoised texture
	get texture() {
		return this.denoisePass.iterations > 0 ? this.denoisePass.texture : this.svgfTemporalResolvePass.texture
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

	setVelocityTexture(texture) {
		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.velocityTexture.value = texture
	}

	setSize(width, height) {
		this.denoisePass.setSize(width, height)

		this.svgfTemporalResolvePass.setSize(width, height)

		this.denoisePass.fullscreenMaterial.uniforms.inputTexture.value = this.svgfTemporalResolvePass.accumulatedTexture
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

		if (this.denoisePass.iterations > 0) {
			this.denoisePass.render(renderer)
		} else {
			// this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value =
			// 	this.denoisePass.fullscreenMaterial.uniforms.inputTexture.value
		}

		this.svgfTemporalResolvePass.render(renderer)
	}
}
