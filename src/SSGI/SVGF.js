import { CopyPass } from "./pass/CopyPass.js"
import { DenoisePass } from "./pass/DenoisePass.js"
import { SVGFTemporalResolvePass } from "./pass/SVGFTemporalResolvePass.js"
import { defaultTemporalResolvePassOptions } from "./temporal-resolve/TemporalResolvePass.js"
import { isWebGL2Available } from "./utils/Utils"

const isWebGL2 = isWebGL2Available()
const requiredTextures = ["inputTexture", "depthTexture", "normalTexture"]

export class SVGF {
	constructor(scene, camera, options = defaultTemporalResolvePassOptions) {
		options = { ...defaultTemporalResolvePassOptions, ...options }

		this.svgfTemporalResolvePass = new SVGFTemporalResolvePass(scene, camera, options)

		this.denoisePass = new DenoisePass()

		this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.denoisePass.texture

		if (isWebGL2) {
			this.copyPass = new CopyPass()
			this.copyPass.fullscreenMaterial.uniforms.inputTexture.value = this.svgfTemporalResolvePass.momentsTexture
			this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.momentsTexture.value = this.copyPass.renderTarget.texture

			this.denoisePass.fullscreenMaterial.uniforms.momentsTexture.value = this.svgfTemporalResolvePass.momentsTexture
		}
	}

	// the denoised texture
	get texture() {
		return this.svgfTemporalResolvePass.texture
	}

	setInputTexture(texture) {
		const { uniforms } = this.svgfTemporalResolvePass.fullscreenMaterial
		if ("rawInputTexture" in uniforms) uniforms.rawInputTexture.value = texture

		this.denoisePass.fullscreenMaterial.uniforms.inputTexture.value = texture
	}

	setDepthTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.depthTexture.value = texture
	}

	setNormalTexture(texture) {
		this.denoisePass.fullscreenMaterial.uniforms.normalTexture.value = texture
	}

	setSize(width, height) {
		this.denoisePass.setSize(width, height)
		this.denoisePass.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)

		this.svgfTemporalResolvePass.setSize(width, height)
		this.copyPass?.setSize(width, height)
	}

	dispose() {
		this.denoisePass.dispose()
		this.svgfTemporalResolvePass.dispose()
		this.copyPass?.dispose()
	}

	render(renderer) {
		requiredTextures.forEach(bufferName => {
			if (!this.denoisePass.fullscreenMaterial.uniforms[bufferName].value?.isTexture) {
				const functionName = "set" + bufferName[0].toUpperCase() + bufferName.slice(1)
				console.warn("SVGF has no " + bufferName + ". Set a " + bufferName + " through " + functionName + "().")
			}
		})

		if (this.denoisePass.iterations > 0) {
			this.denoisePass.render(renderer)
			this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.denoisePass.texture
		} else {
			this.svgfTemporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value =
				this.denoisePass.fullscreenMaterial.uniforms.inputTexture.value
		}

		this.svgfTemporalResolvePass.render(renderer)

		this.copyPass?.render(renderer)
	}
}
