import { Effect, NormalPass } from "postprocessing"
import { Color, Uniform } from "three"
import { DenoisePass } from "../svgf/pass/DenoisePass"
import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass"
import { HBAOPass } from "./HBAOPass"
// eslint-disable-next-line camelcase
import hbao_compose from "./shader/hbao_compose.frag"

const defaultHBAOOptions = {
	resolutionScale: 1,
	blend: 0.95,
	neighborhoodClampIntensity: 0.5,
	denoise: 2,
	denoiseIterations: 3,
	denoiseKernel: 3,
	depthPhi: 35,
	normalPhi: 20,
	spp: 8,
	distance: 2.5,
	distancePower: 3,
	bias: 128,
	power: 4,
	thickness: 0.075,
	color: new Color("black"),
	bentNormals: true,
	useNormalPass: false,
	normalTexture: null,
	temporalReprojection: false
}

class HBAOEffect extends Effect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, camera, scene, velocityDepthNormalPass, options = defaultHBAOOptions) {
		super("HBAOEffect", hbao_compose, {
			type: "FinalHBAOMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)],
				["power", new Uniform(0)]
			])
		})

		options = { ...defaultHBAOOptions, ...options }

		this._camera = camera
		this._scene = scene

		this.hbaoPass = new HBAOPass(this._camera, this._scene)

		this.temporalReprojectPass = new TemporalReprojectPass(scene, camera, velocityDepthNormalPass, 1, {
			neighborhoodClamp: true,
			neighborhoodClampRadius: 1,

			...options
		})
		this.temporalReprojectPass.setTextures(this.hbaoPass.texture)

		if (!options.temporalReprojection) options.blend = 0

		this.denoisePass = new DenoisePass(camera, this.temporalReprojectPass.texture, {
			basicVariance: 0.1
		})

		this.hbaoPass.fullscreenMaterial.uniforms.accumulatedTexture.value = this.denoisePass.texture
		this.hbaoPass.fullscreenMaterial.uniforms.velocityTexture.value = velocityDepthNormalPass.velocityTexture

		// set up depth texture
		if (!composer.depthTexture) composer.createDepthTexture()

		this.hbaoPass.fullscreenMaterial.uniforms.depthTexture.value = composer.depthTexture
		this.denoisePass.setDepthTexture(composer.depthTexture)
		this.uniforms.get("depthTexture").value = composer.depthTexture

		// set up optional normal texture
		if (options.useNormalPass || options.normalTexture) {
			if (options.useNormalPass) this.normalPass = new NormalPass(scene, camera)

			const normalTexture = options.normalTexture ?? this.normalPass.texture

			this.hbaoPass.fullscreenMaterial.uniforms.normalTexture.value = normalTexture
			this.hbaoPass.fullscreenMaterial.defines.useNormalTexture = ""

			this.denoisePass.setNormalTexture(normalTexture)
		}

		this.bindBuffers()

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

						case "temporalReprojection":
							this.blend = defaultHBAOOptions.blend
							break

						case "blend":
						case "neighborhoodClampIntensity":
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
						case "normalPhi":
							this.denoisePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "distance":
							this.hbaoPass.fullscreenMaterial.uniforms.aoDistance.value = value
							break

						case "color":
							this.hbaoPass.fullscreenMaterial.uniforms.color.value.copy(value)
							break

						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							break

						case "power":
							this.uniforms.get("power").value = value

							break

						default:
							if (key in this.hbaoPass.fullscreenMaterial.uniforms)
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
		if (width === undefined || height === undefined) return
		if (
			width === this.lastSize.width &&
			height === this.lastSize.height &&
			this.resolutionScale === this.lastSize.resolutionScale
		)
			return

		this.normalPass?.setSize(width, height)
		this.hbaoPass.setSize(width * this.resolutionScale, height * this.resolutionScale)

		this.temporalReprojectPass.setSize(width, height)
		this.denoisePass.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	bindBuffers() {
		if (this.blend > 0) {
			if (this.denoisePass.textures[0] !== this.temporalReprojectPass.renderTarget.texture[0]) {
				this.denoisePass.setTextures(this.temporalReprojectPass.renderTarget.texture[0])

				this.hbaoPass.fullscreenMaterial.defines.animateNoise = ""
				this.hbaoPass.fullscreenMaterial.needsUpdate = true
			}
		} else {
			if (this.denoisePass.textures[0] !== this.hbaoPass.renderTarget.texture) {
				this.denoisePass.setTextures(this.hbaoPass.renderTarget.texture)

				delete this.hbaoPass.fullscreenMaterial.defines.animateNoise
				this.hbaoPass.fullscreenMaterial.needsUpdate = true
			}
		}

		if (this.denoiseIterations > 0) {
			this.uniforms.get("inputTexture").value = this.denoisePass.texture
		} else {
			this.uniforms.get("inputTexture").value = this.temporalReprojectPass.renderTarget.texture[0]
		}
	}

	update(renderer) {
		this.bindBuffers()

		this.normalPass?.render(renderer)
		this.hbaoPass.render(renderer)

		if (this.blend > 0) this.temporalReprojectPass.render(renderer)
		if (this.denoiseIterations > 0) this.denoisePass.render(renderer)
	}
}

HBAOEffect.DefaultOptions = defaultHBAOOptions

export { HBAOEffect }
