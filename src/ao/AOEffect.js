import { Effect } from "postprocessing"
import { Color, Uniform } from "three"
// eslint-disable-next-line camelcase
import { TRAAEffect } from "../traa/TRAAEffect"
import ao_compose from "./shader/ao_compose.frag"

const defaultAOOptions = {
	resolutionScale: 1,
	spp: 8,
	distance: 2,
	distancePower: 1,
	power: 2,
	bias: 40,
	thickness: 0.075,
	color: new Color("black"),
	velocityDepthNormalPass: null,
	normalTexture: null
}

class AOEffect extends Effect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, depthTexture, aoPass, options = defaultAOOptions) {
		super("AOEffect", ao_compose, {
			type: "FinalAOMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["depthTexture", new Uniform(depthTexture)],
				["power", new Uniform(0)],
				["color", new Uniform(new Color("black"))]
			])
		})

		this.composer = composer
		this.aoPass = aoPass
		options = { ...defaultAOOptions, ...options }

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
							this.uniforms.get("color").value.copy(new Color(value))
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

		this.aoPass.setSize(width * this.resolutionScale, height * this.resolutionScale)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	get texture() {
		if (this.iterations > 0) {
			return this.PoissonDenoisePass.texture
		}

		return this.aoPass.texture
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

		this.uniforms.get("inputTexture").value = this.texture

		this.aoPass.render(renderer)
	}
}

AOEffect.DefaultOptions = defaultAOOptions

export { AOEffect }
