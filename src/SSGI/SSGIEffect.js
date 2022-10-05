import { Effect, Selection } from "postprocessing"
import { EquirectangularReflectionMapping, Uniform } from "three"
import { SSGIPass } from "./pass/SSGIPass.js"
import { upscaleFXAA } from "./pass/UpscalePass.js"
import applyDiffuse from "./shader/applyDiffuse.frag"
import compose from "./shader/compose.frag"
import utils from "./shader/utils.frag"
import { defaultSSGIOptions } from "./SSGIOptions"
import { TemporalResolvePass } from "./temporal-resolve/TemporalResolvePass.js"

const finalFragmentShader = compose.replace("#include <utils>", utils)

export class SSGIEffect extends Effect {
	selection = new Selection()

	/**
	 * @param {THREE.Scene} scene The scene of the SSGI effect
	 * @param {THREE.Camera} camera The camera with which SSGI is being rendered
	 * @param {SSGIOptions} [options] The optional options for the SSGI effect
	 */
	constructor(scene, camera, options = defaultSSGIOptions) {
		super("SSGIEffect", finalFragmentShader, {
			type: "FinalSSGIMaterial",
			uniforms: new Map([["inputTexture", new Uniform(null)]]),
			defines: new Map([["RENDER_MODE", "0"]])
		})

		this._scene = scene
		this._camera = camera

		const trOptions = {
			dilation: false,
			renderVelocity: false,
			neighborhoodClamping: false,
			logTransform: false,
			...options
		}

		options = { ...defaultSSGIOptions, ...options, ...trOptions }

		// set up passes

		// temporal resolve pass
		this.temporalResolvePass = new TemporalResolvePass(scene, camera, options)

		this.temporalResolvePass.fullscreenMaterial.fragmentShader =
			/* glsl */ `
		uniform sampler2D diffuseTexture;
		uniform sampler2D directLightTexture;
		` +
			this.temporalResolvePass.fullscreenMaterial.fragmentShader
				.replace("void main()", upscaleFXAA + "void main()")
				.replace("vec3 inputColor", applyDiffuse + "vec3 inputColor")

		this.temporalResolvePass.fullscreenMaterial.uniforms = {
			...this.temporalResolvePass.fullscreenMaterial.uniforms,
			...{
				diffuseTexture: new Uniform(null),
				directLightTexture: new Uniform(null)
			}
		}

		this.uniforms.get("inputTexture").value = this.temporalResolvePass.renderTarget.texture

		// ssgi pass
		this.ssgiPass = new SSGIPass(this)

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.ssgiPass.renderTarget.texture

		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale
		}

		this.setSize(options.width, options.height)

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		let needsUpdate = false

		if (options.reflectionsOnly) {
			this.temporalResolvePass.fullscreenMaterial.defines.reflectionsOnly = ""
		}

		const ssgiPassFullscreenMaterialUniforms = this.ssgiPass.fullscreenMaterial.uniforms
		const ssgiPassFullscreenMaterialUniformsKeys = Object.keys(ssgiPassFullscreenMaterialUniforms)

		const noResetSamplesProperties = [...this.uniforms.keys()]

		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					if (options[key] === value && needsUpdate) return

					options[key] = value

					if (!noResetSamplesProperties.includes(key)) {
						this.setSize(this.lastSize.width, this.lastSize.height, true)
					}

					switch (key) {
						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							break

						case "blur":
							this.temporalResolvePass.fullscreenMaterial.uniforms.blur.value = value
							break

						case "blurKernel":
							this.ssgiPass.upscalePass.fullscreenMaterial.uniforms.blurKernel.value = value
							this.ssgiPass.upscalePass2.fullscreenMaterial.uniforms.blurKernel.value = value
							break

						case "sharpness":
							this.ssgiPass.upscalePass.fullscreenMaterial.uniforms.sharpness.value = value
							this.ssgiPass.upscalePass2.fullscreenMaterial.uniforms.sharpness.value = value
							break

						// defines
						case "steps":
						case "refineSteps":
						case "spp":
							this.ssgiPass.fullscreenMaterial.defines[key] = parseInt(value)
							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "missedRays":
							if (value) {
								this.ssgiPass.fullscreenMaterial.defines.missedRays = ""
							} else {
								delete this.ssgiPass.fullscreenMaterial.defines.missedRays
							}

							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "correctionRadius":
							this.temporalResolvePass.fullscreenMaterial.defines.correctionRadius = Math.round(value)

							this.temporalResolvePass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "blend":
						case "correction":
							this.temporalResolvePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "distance":
							ssgiPassFullscreenMaterialUniforms.rayDistance.value = value
							break

						case "jitter":
						case "jitterRoughness":
							ssgiPassFullscreenMaterialUniforms[key].value = value

							this.ssgiPass.upscalePass.fullscreenMaterial.uniforms[key].value = value
							this.ssgiPass.upscalePass2.fullscreenMaterial.uniforms[key].value = value
							break

						// must be a uniform
						default:
							if (ssgiPassFullscreenMaterialUniformsKeys.includes(key)) {
								ssgiPassFullscreenMaterialUniforms[key].value = value
							}
					}
				}
			})

			// apply all uniforms and defines
			this[key] = options[key]
		}

		needsUpdate = true
	}

	setSize(width, height, force = false) {
		if (
			!force &&
			width === this.lastSize.width &&
			height === this.lastSize.height &&
			this.resolutionScale === this.lastSize.resolutionScale
		)
			return

		this.temporalResolvePass.setSize(width, height)
		this.ssgiPass.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	dispose() {
		super.dispose()

		this.ssgiPass.dispose()
		this.temporalResolvePass.dispose()
	}

	keepEnvMapUpdated() {
		const ssgiMaterial = this.ssgiPass.fullscreenMaterial

		if (ssgiMaterial.uniforms.envMap.value !== this._scene.environment) {
			if (this._scene.environment?.mapping === EquirectangularReflectionMapping) {
				ssgiMaterial.uniforms.envMap.value = this._scene.environment
				ssgiMaterial.defines.USE_ENVMAP = ""
			} else {
				ssgiMaterial.uniforms.envMap.value = null
				delete ssgiMaterial.defines.USE_ENVMAP
			}

			ssgiMaterial.needsUpdate = true
		}
	}

	update(renderer, inputBuffer) {
		this.keepEnvMapUpdated()

		if (this.antialias) this.temporalResolvePass.unjitter()

		this.temporalResolvePass.velocityPass.render(renderer)

		if (this.antialias) this.temporalResolvePass.jitter()

		this.ssgiPass.render(renderer, inputBuffer)

		this.temporalResolvePass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture
		this.ssgiPass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture

		this.temporalResolvePass.render(renderer)
	}
}
