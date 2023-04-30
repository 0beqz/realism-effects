import { Effect, NormalPass } from "postprocessing"
import { Color, Uniform } from "three"
import { HBAOPass } from "./HBAOPass"
// eslint-disable-next-line camelcase
import hbao_compose from "./shader/hbao_compose.frag"
import { PoissionDenoisePass } from "../poissionDenoise/PoissionDenoisePass"

const defaultHBAOOptions = {
	resolutionScale: 1,
	spp: 8,
	distance: 2.5,
	distancePower: 3,
	bias: 128,
	power: 4,
	thickness: 0.075,
	color: new Color("black"),
	bentNormals: true,
	useNormalPass: false,
	velocityDepthNormalPass: null,
	normalTexture: null,
	...PoissionDenoisePass.DefaultOptions
}

class HBAOEffect extends Effect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, camera, scene, options = defaultHBAOOptions) {
		super("HBAOEffect", hbao_compose, {
			type: "FinalHBAOMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)],
				["power", new Uniform(0)],
				["color", new Uniform(new Color("black"))]
			])
		})

		options = { ...defaultHBAOOptions, ...options }

		this._camera = camera
		this._scene = scene

		this.hbaoPass = new HBAOPass(this._camera, this._scene)

		// set up depth texture
		if (!composer.depthTexture) composer.createDepthTexture()

		this.hbaoPass.fullscreenMaterial.uniforms.depthTexture.value = composer.depthTexture
		this.uniforms.get("depthTexture").value = composer.depthTexture

		// set up optional normal texture
		if (options.useNormalPass || options.normalTexture) {
			if (options.useNormalPass) this.normalPass = new NormalPass(scene, camera)

			const normalTexture = options.normalTexture ?? this.normalPass.texture

			this.hbaoPass.fullscreenMaterial.uniforms.normalTexture.value = normalTexture
			this.hbaoPass.fullscreenMaterial.defines.useNormalTexture = ""
		}

		this.poissionDenoisePass = new PoissionDenoisePass(camera, this.hbaoPass.texture, composer.depthTexture)

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
							this.hbaoPass.fullscreenMaterial.defines.spp = value.toFixed(0)

							this.hbaoPass.fullscreenMaterial.needsUpdate = true
							break

						case "bentNormals":
							if (value) {
								this.hbaoPass.fullscreenMaterial.defines.bentNormals = ""
							} else {
								delete this.hbaoPass.fullscreenMaterial.defines.bentNormals
							}

							this.hbaoPass.fullscreenMaterial.needsUpdate = true
							break

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

						case "distance":
							this.hbaoPass.fullscreenMaterial.uniforms.aoDistance.value = value
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

						default:
							if (key in this.hbaoPass.fullscreenMaterial.uniforms) {
								this.hbaoPass.fullscreenMaterial.uniforms[key].value = value
							}
					}
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
		if (width === undefined || height === undefined) return
		if (
			width === this.lastSize.width &&
			height === this.lastSize.height &&
			this.resolutionScale === this.lastSize.resolutionScale
		) {
			return
		}

		this.normalPass?.setSize(width, height)
		this.hbaoPass.setSize(width * this.resolutionScale, height * this.resolutionScale)

		this.poissionDenoisePass.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	update(renderer) {
		if (this.iterations > 0) {
			this.uniforms.get("inputTexture").value = this.poissionDenoisePass.texture
		} else {
			this.uniforms.get("inputTexture").value = this.hbaoPass.renderTarget.texture
		}

		this.normalPass?.render(renderer)
		this.hbaoPass.render(renderer)

		this.poissionDenoisePass.render(renderer)
	}
}

HBAOEffect.DefaultOptions = defaultHBAOOptions

export { HBAOEffect }
