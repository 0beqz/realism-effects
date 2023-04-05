import { Effect } from "postprocessing"
import { Color, Uniform } from "three"
import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass"
import { HBAOPass } from "./HBAOPass"
import compose from "./shader/compose.frag"
import { DenoisePass } from "../svgf/pass/DenoisePass"

const defaultHBAOOptions = {
	blend: 0.95,
	denoise: 2,
	denoiseIterations: 3,
	denoiseKernel: 3,
	depthPhi: 20,
	spp: 8,
	distance: 2.5,
	distancePower: 3,
	bias: 20,
	power: 32,
	thickness: 0.075,
	color: new Color("black")
}

class HBAOEffect extends Effect {
	constructor(composer, camera, scene, velocityDepthNormalPass, options = defaultHBAOOptions) {
		super("HBAOEffect", compose, {
			type: "FinalHBAOMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)]
			])
		})

		this._camera = camera
		this._scene = scene

		this.hbaoPass = new HBAOPass(this._camera, this._scene)

		this.temporalReprojectPass = new TemporalReprojectPass(scene, camera, velocityDepthNormalPass, 1, {
			blend: options.blend
		})
		this.temporalReprojectPass.fullscreenMaterial.uniforms.inputTexture0.value = this.hbaoPass.renderTarget.texture

		this.denoisePass = new DenoisePass(camera, [this.temporalReprojectPass.renderTarget.texture[0]], "", "", {
			basicVariance: 0.05
		})

		// set up depth texture
		if (!composer.depthTexture) composer.createDepthTexture()

		this.hbaoPass.fullscreenMaterial.uniforms.depthTexture.value = composer.depthTexture
		this.denoisePass.setDepthTexture(composer.depthTexture)
		this.uniforms.get("depthTexture").value = composer.depthTexture

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					options[key] = value

					switch (key) {
						case "spp":
							this.hbaoPass.fullscreenMaterial.defines.spp = value.toFixed(0)
							this.hbaoPass.fullscreenMaterial.needsUpdate = true
							break

						case "blend":
							this.temporalReprojectPass.fullscreenMaterial.uniforms[key].value = value
							break

						case "denoise":
							this.denoisePass.fullscreenMaterial.uniforms.denoise.value[0] = value
							break

						case "denoiseIterations":
							this.denoisePass.iterations = value
							break

						case "denoiseKernel":
						case "depthPhi":
							this.denoisePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "distance":
							this.hbaoPass.fullscreenMaterial.uniforms.aoDistance.value = value
							break

						case "color":
							this.hbaoPass.fullscreenMaterial.uniforms.color.value.copy(value)
							break

						default:
							this.hbaoPass.fullscreenMaterial.uniforms[key].value = value
					}

					this.temporalReprojectPass.reset()
				}
			})

			// apply all uniforms and defines
			this[key] = options[key]
		}
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)
		this.hbaoPass.initialize(renderer, ...args)
	}

	setSize(width, height) {
		this.hbaoPass.setSize(width, height)
		this.temporalReprojectPass.setSize(width, height)
		this.denoisePass.setSize(width, height)
	}

	update(renderer) {
		this.hbaoPass.render(renderer)
		this.temporalReprojectPass.render(renderer)

		if (this.denoiseIterations > 0) {
			this.denoisePass.render(renderer)
			this.uniforms.get("inputTexture").value = this.denoisePass.texture
		} else {
			this.uniforms.get("inputTexture").value = this.temporalReprojectPass.renderTarget.texture[0]
		}
	}
}

HBAOEffect.DefaultOptions = defaultHBAOOptions

export { HBAOEffect }
