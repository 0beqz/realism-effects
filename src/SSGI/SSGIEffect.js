import { Effect, Selection } from "postprocessing"
import {
	EquirectangularReflectionMapping,
	GLSL3,
	HalfFloatType,
	LinearFilter,
	Uniform,
	WebGLMultipleRenderTargets
} from "three"
import { CopyPass } from "./pass/CopyPass.js"
import { SSGIPass } from "./pass/SSGIPass.js"
import applyDiffuse from "./shader/applyDiffuse.frag"
import compose from "./shader/compose.frag"
import customTemporalResolve from "./shader/customTemporalResolve.frag"
import utils from "./shader/utils.frag"
import { defaultSSGIOptions } from "./SSGIOptions"
import { TemporalResolvePass } from "./temporal-resolve/TemporalResolvePass.js"
import { isWebGL2Available } from "./utils/Utils.js"

const finalFragmentShader = compose.replace("#include <utils>", utils)

const isWebGL2 = isWebGL2Available()

export class SSGIEffect extends Effect {
	selection = new Selection()

	/**
	 * @param {THREE.Scene} scene The scene of the SSGI effect
	 * @param {THREE.Camera} camera The camera with which SSGI is being rendered
	 * @param {SSGIOptions} [options] The optional options for the SSGI effect
	 */
	constructor(scene, camera, options = defaultSSGIOptions) {
		options = { ...defaultSSGIOptions, ...options }

		super("SSGIEffect", finalFragmentShader, {
			type: "FinalSSGIMaterial",
			uniforms: new Map([["inputTexture", new Uniform(null)]])
		})

		this._scene = scene
		this._camera = camera

		const temporalResolvePassRenderTarget = isWebGL2
			? new WebGLMultipleRenderTargets(1, 1, 2, {
					minFilter: LinearFilter,
					magFilter: LinearFilter,
					type: HalfFloatType,
					depthBuffer: false
			  })
			: null

		// temporal resolve pass
		this.temporalResolvePass = new TemporalResolvePass(scene, camera, {
			renderVelocity: options.antialias,
			traa: options.antialias,
			customComposeShader: isWebGL2 ? customTemporalResolve : null,
			renderTarget: temporalResolvePassRenderTarget
		})

		const webGl2Buffers = isWebGL2
			? /* glsl */ `
		// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
		float czm_luminance(vec3 rgb) {
			// Algorithm from Chapter 10 of Graphics Shaders.
			const vec3 W = vec3(0.2125, 0.7154, 0.0721);
			return dot(rgb, W);
		}

		layout(location = 0) out vec4 gOutput;
		layout(location = 1) out vec4 gMoment;

		uniform sampler2D momentsTexture;
		uniform sampler2D rawInputTexture;
		`
			: ""

		const webgl2Uniforms = isWebGL2
			? {
					momentsTexture: new Uniform(null),
					rawInputTexture: new Uniform(null)
			  }
			: {}

		this.temporalResolvePass.fullscreenMaterial.fragmentShader =
			/* glsl */ `
		uniform sampler2D diffuseTexture;
		uniform sampler2D directLightTexture;

		${webGl2Buffers}
		` +
			this.temporalResolvePass.fullscreenMaterial.fragmentShader.replace(
				"vec3 inputColor",
				applyDiffuse + "vec3 inputColor"
			)

		this.temporalResolvePass.fullscreenMaterial.uniforms = {
			...this.temporalResolvePass.fullscreenMaterial.uniforms,
			...{
				diffuseTexture: new Uniform(null),
				directLightTexture: new Uniform(null)
			},
			...webgl2Uniforms
		}

		this.uniforms.get("inputTexture").value = this.temporalResolvePass.texture

		// ssgi pass
		this.ssgiPass = new SSGIPass(this)
		if (!isWebGL2) delete this.ssgiPass.denoisePass.fullscreenMaterial.defines.USE_MOMENT

		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale
		}

		this.copyPass = new CopyPass()

		if (isWebGL2) {
			this.copyPass.fullscreenMaterial.uniforms.inputTexture.value = this.temporalResolvePass.renderTarget.texture[1]
			this.temporalResolvePass.fullscreenMaterial.uniforms.momentsTexture.value = this.copyPass.renderTarget.texture
			this.temporalResolvePass.fullscreenMaterial.glslVersion = GLSL3
		}

		this.setSize(options.width, options.height)

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		let needsUpdate = false

		if (options.reflectionsOnly) this.temporalResolvePass.fullscreenMaterial.defines.reflectionsOnly = ""

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

						case "antialias":
							this.temporalResolvePass.traa = value
							break

						case "denoiseIterations":
							this.ssgiPass.denoisePass.iterations = value
							break

						case "denoiseKernel":
						case "lumaPhi":
						case "depthPhi":
						case "normalPhi":
						case "roughnessPhi":
							this.ssgiPass.denoisePass.fullscreenMaterial.uniforms[key].value = value
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

							this.ssgiPass.denoisePass.fullscreenMaterial.uniforms[key].value = value
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

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)
		this.ssgiPass.initialize(renderer, ...args)
	}

	setSize(width, height, force = false) {
		if (width === undefined && height === undefined) return
		if (
			!force &&
			width === this.lastSize.width &&
			height === this.lastSize.height &&
			this.resolutionScale === this.lastSize.resolutionScale
		)
			return

		this.temporalResolvePass.setSize(width, height)
		this.ssgiPass.setSize(width, height)
		this.copyPass.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	dispose() {
		super.dispose()

		this.ssgiPass.dispose()
		this.copyPass.dispose()
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

		this.temporalResolvePass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture
		this.ssgiPass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture

		this.ssgiPass.render(renderer, inputBuffer)

		this.temporalResolvePass.render(renderer)

		if (isWebGL2) this.copyPass.render(renderer)
	}
}
