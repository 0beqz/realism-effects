import { Effect, NormalPass } from "postprocessing"
import { Color, Uniform } from "three"
import { PoissionDenoisePass } from "../poissionDenoise/PoissionDenoisePass"
// eslint-disable-next-line camelcase
import ao_compose from "./shader/ao_compose.frag"
import { TRAAEffect } from "../traa/TRAAEffect"

const defaultAOOptions = {
	resolutionScale: 1,
	spp: 8,
	distance: 3,
	distancePower: 1,
	power: 2,
	bias: 300,
	thickness: 0.075,
	color: new Color("black"),
	useNormalPass: false,
	velocityDepthNormalPass: null,
	normalTexture: null,
	...PoissionDenoisePass.DefaultOptions
}

class AOEffect extends Effect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, camera, scene, aoPass, options = defaultAOOptions) {
		super("AOEffect", ao_compose, {
			type: "FinalAOMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)],
				["power", new Uniform(0)],
				["color", new Uniform(new Color("black"))]
			])
		})

		this.composer = composer
		this.aoPass = aoPass
		options = { ...defaultAOOptions, ...options }

		// set up depth texture
		if (!composer.depthTexture) composer.createDepthTexture()

		this.aoPass.fullscreenMaterial.uniforms.depthTexture.value = composer.depthTexture
		this.uniforms.get("depthTexture").value = composer.depthTexture

		// set up optional normal texture
		if (options.useNormalPass || options.normalTexture) {
			if (options.useNormalPass) this.normalPass = new NormalPass(scene, camera)

			const normalTexture = options.normalTexture ?? this.normalPass.texture

			this.aoPass.fullscreenMaterial.uniforms.normalTexture.value = normalTexture
			this.aoPass.fullscreenMaterial.defines.useNormalTexture = ""
		}

		this.poissionDenoisePass = new PoissionDenoisePass(camera, this.aoPass.texture, composer.depthTexture)

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					if (value === null || value === undefined) return

					options[key] = value

					switch (key) {
						case "spp":
							this.aoPass.fullscreenMaterial.defines.spp = value.toFixed(0)

							this.aoPass.fullscreenMaterial.needsUpdate = true
							break

						case "distance":
							this.aoPass.fullscreenMaterial.uniforms.aoDistance.value = value
							break

						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							break

						case "power":
							this.uniforms.get("power").value = value
							break

						case "color":
							this.uniforms.get("color").value.copy(value)
							break

						// denoiser
						case "iterations":
							this.poissionDenoisePass.iterations = value
							break

						case "radius":
							this.poissionDenoisePass.radius = value
							break

						case "depthPhi":
						case "normalPhi":
							this.poissionDenoisePass.fullscreenMaterial.uniforms[key].value = Math.max(value, 0.0001)
							break

						default:
							if (key in this.aoPass.fullscreenMaterial.uniforms) {
								this.aoPass.fullscreenMaterial.uniforms[key].value = value
							}
					}
				},
				configurable: true
			})

			// apply all uniforms and defines
			this[key] = options[key]
		}
	}

	setSize(width, height) {
		if (width === undefined || height === undefined) return
		if (
			width === this.lastSize.width &&
			height === this.lastSize.height &&
			this.resolutionScale === this.lastSize.resolutionScale
		) {
			return
		}

		this.normalPass?.setSize(width, height)
		this.aoPass.setSize(width * this.resolutionScale, height * this.resolutionScale)

		this.poissionDenoisePass.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	update(renderer) {
		// check if TRAA is being used so we can animate the noise
		const hasTRAA = this.composer.passes.some(pass => {
			return pass.enabled && !pass.skipRendering && pass.effects?.some(effect => effect instanceof TRAAEffect)
		})

		// set animated noise depending on TRAA
		if (hasTRAA && !("animatedNoise" in this.aoPass.fullscreenMaterial.defines)) {
			this.aoPass.fullscreenMaterial.defines.animatedNoise = ""
			this.aoPass.fullscreenMaterial.needsUpdate = true
		} else if (!hasTRAA && "animatedNoise" in this.aoPass.fullscreenMaterial.defines) {
			delete this.aoPass.fullscreenMaterial.defines.animatedNoise
			this.aoPass.fullscreenMaterial.needsUpdate = true
		}

		// set input texture
		if (this.iterations > 0) {
			this.uniforms.get("inputTexture").value = this.poissionDenoisePass.texture
		} else {
			this.uniforms.get("inputTexture").value = this.aoPass.renderTarget.texture
		}

		this.normalPass?.render(renderer)
		this.aoPass.render(renderer)

		this.poissionDenoisePass.render(renderer)
	}
}

AOEffect.DefaultOptions = defaultAOOptions

export { AOEffect }
