import { BoxBlurPass, Effect, Selection } from "postprocessing"
import { EquirectangularReflectionMapping, HalfFloatType, Uniform, WebGLRenderTarget } from "three"
import { SSGIPass } from "./pass/SSGIPass.js"
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
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["blur", new Uniform(0)]
			]),
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
		uniform sampler2D boxBlurTexture;
		uniform sampler2D diffuseTexture;
		uniform sampler2D directLightTexture;
		uniform float blur;
		` +
			this.temporalResolvePass.fullscreenMaterial.fragmentShader.replace(
				"vec3 inputColor",
				applyDiffuse + "vec3 inputColor"
			)

		this.temporalResolvePass.fullscreenMaterial.uniforms = {
			...this.temporalResolvePass.fullscreenMaterial.uniforms,
			...{
				boxBlurTexture: new Uniform(null),
				diffuseTexture: new Uniform(null),
				directLightTexture: new Uniform(null),
				blur: new Uniform(0)
			}
		}

		this.uniforms.get("inputTexture").value = this.temporalResolvePass.renderTarget.texture

		this.qualityScale = options.qualityScale

		// ssgi pass
		this.ssgiPass = new SSGIPass(this)
		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.ssgiPass.renderTarget.texture

		this.boxBlurPass = new BoxBlurPass({
			kernelSize: 3,
			iterations: 3,
			bilateral: true
		})

		this.boxBlurPass.blurMaterial.copyCameraSettings(camera)

		this.boxBlurPass.renderTargetA.texture.type = HalfFloatType
		this.boxBlurPass.renderTargetB.texture.type = HalfFloatType

		this.boxBlurRenderTarget = new WebGLRenderTarget(1, 1, {
			type: HalfFloatType
		})

		this.temporalResolvePass.fullscreenMaterial.uniforms.boxBlurTexture.value = this.boxBlurRenderTarget.texture

		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale,
			qualityScale: options.qualityScale
		}

		this.setSize(options.width, options.height)

		this.makeOptionsReactive(options)

		this.temporalResolvePass.depthTexture = this.ssgiPass.depthTexture

		window.ssgiEffect = this
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

						case "qualityScale":
							this.temporalResolvePass.qualityScale = value
							this.setSize(this.lastSize.width, this.lastSize.height, true)
							break

						case "blur":
							this.temporalResolvePass.fullscreenMaterial.uniforms.blur.value = value
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
			this.resolutionScale === this.lastSize.resolutionScale &&
			this.qualityScale === this.lastSize.qualityScale
		)
			return

		this.temporalResolvePass.setSize(width, height)
		this.ssgiPass.setSize(width, height)
		this.boxBlurPass.setSize(width, height)
		this.boxBlurRenderTarget.setSize(width * this.resolutionScale, height * this.resolutionScale)
		this.boxBlurPass.renderTargetA.setSize(width * this.resolutionScale, height * this.resolutionScale)
		this.boxBlurPass.renderTargetB.setSize(width * this.resolutionScale, height * this.resolutionScale)
		this.boxBlurPass.blurMaterial.setSize(width * this.resolutionScale, height * this.resolutionScale)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale,
			qualityScale: this.qualityScale
		}
	}

	dispose() {
		super.dispose()

		this.ssgiPass.dispose()
		this.temporalResolvePass.dispose()
		this.boxBlurRenderTarget.dispose()
		this.boxBlurPass.dispose()
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

		this.temporalResolvePass.fullscreenMaterial.uniforms.velocityTexture.value =
			this.ssgiPass.gBuffersRenderTarget.texture[0]

		if (this.antialias) this.temporalResolvePass.jitter()

		// render ssgi of current frame
		this.ssgiPass.render(renderer, inputBuffer)

		if (this.blur > 0) this.boxBlurPass.render(renderer, this.ssgiPass.renderTarget, this.boxBlurRenderTarget)

		this.temporalResolvePass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture

		// compose ssgi of last and current frame into one ssgi
		this.temporalResolvePass.render(renderer)

		// if (!this.antialias) {
		// 	this.temporalResolvePass.unjitter()
		// }
	}
}
