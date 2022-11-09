import { CopyPass } from "./pass/CopyPass.js"
import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalResolvePass } from "./pass/SVGFTemporalResolvePass.js"
import { defaultTemporalResolvePassOptions } from "./temporal-resolve/TemporalResolvePass.js"

const requiredTextures = ["inputTexture", "depthTexture", "normalTexture"]

const defaultSVGFOptions = {
	...defaultTemporalResolvePassOptions,
	moments: true
}

export class SVGF {
	constructor(scene, camera, options = defaultSVGFOptions) {
		options = { ...defaultSVGFOptions, ...options }

		this.svgfTemporalResolvePass = new SVGFTemporalResolvePass(scene, camera, options)

		this.denoisePass = new DenoisePass(camera, null, options)

		// this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.denoisePass.texture

		if (options.moments) {
			this.copyPass = new CopyPass()
			this.copyPass.fullscreenMaterial.uniforms.inputTexture.value = this.svgfTemporalResolvePass.momentsTexture
			this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.momentsTexture.value = this.copyPass.renderTarget.texture

			this.denoisePass.fullscreenMaterial.uniforms.momentsTexture.value = this.svgfTemporalResolvePass.momentsTexture
		}

		this.denoisePass.fullscreenMaterial.uniforms.inputTexture.value = this.svgfTemporalResolvePass.texture
	}

	// the denoised texture
	get texture() {
		return this.denoisePass.texture
	}

	setInputTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.inputTexture.value = this.svgfTemporalResolvePass.texture
	}

	setDepthTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.depthTexture.value = texture
	}

	setNormalTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.normalTexture.value = texture
	}

	setSize(width, height) {
		this.denoisePass.setSize(width, height)

		this.svgfTemporalResolvePass.setSize(width, height)
		this.copyPass?.setSize(width, height)
	}

	dispose() {
		this.denoisePass.dispose()
		this.svgfTemporalResolvePass.dispose()
		this.copyPass?.dispose()
	}

	ensureAllTexturesSet() {
		requiredTextures.forEach(bufferName => {
			if (!this.denoisePass.fullscreenMaterial.uniforms[bufferName].value?.isTexture) {
				const functionName = "set" + bufferName[0].toUpperCase() + bufferName.slice(1)
				console.error("SVGF has no " + bufferName + ". Set a " + bufferName + " through " + functionName + "().")
			}
		})
	}

	render(renderer) {
		this.ensureAllTexturesSet()

		if (this.denoisePass.iterations > 0) {
			this.denoisePass.render(renderer)
			// this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.denoisePass.texture
		} else {
			this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value =
				this.denoisePass.fullscreenMaterial.uniforms.inputTexture.value
		}

		this.denoisePass.fullscreenMaterial.uniforms.depthTexture.value =
			this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.depthTexture.value

		// this.denoisePass.fullscreenMaterial.uniforms.normalTexture.value =
		// 	this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.worldNormalTexture.value

		this.svgfTemporalResolvePass.render(renderer)

		this.copyPass?.render(renderer)
	}
}
