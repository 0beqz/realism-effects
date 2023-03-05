/* eslint-disable camelcase */
import { Effect, RenderPass, Selection } from "postprocessing"
import {
	EquirectangularReflectionMapping,
	LinearMipMapLinearFilter,
	NoToneMapping,
	sRGBEncoding,
	Uniform,
	WebGLRenderTarget
} from "three"
import { SVGF } from "../svgf/SVGF.js"
import { SSGIPass } from "./pass/SSGIPass.js"
import compose from "./shader/compose.frag"
import denoise_compose from "./shader/denoise_compose.frag"
import denoise_compose_functions from "./shader/denoise_compose_functions.frag"
import { defaultSSGIOptions } from "./SSGIOptions"
import {
	createGlobalDisableIblIradianceUniform,
	createGlobalDisableIblRadianceUniform,
	getMaxMipLevel,
	getVisibleChildren,
	isChildMaterialRenderable
} from "./utils/Utils.js"

const { render } = RenderPass.prototype

const globalIblIrradianceDisabledUniform = createGlobalDisableIblIradianceUniform()
const globalIblRadianceDisabledUniform = createGlobalDisableIblRadianceUniform()

export class SSGIEffect extends Effect {
	selection = new Selection()
	isUsingRenderPass = true

	/**
	 * @param {THREE.Scene} scene The scene of the SSGI effect
	 * @param {THREE.Camera} camera The camera with which SSGI is being rendered
	 * @param {velocityDepthNormalPass} velocityDepthNormalPass Required velocity pass
	 * @param {SSGIOptions} [options] The optional options for the SSGI effect
	 */
	constructor(scene, camera, velocityDepthNormalPass, options = defaultSSGIOptions) {
		options = { ...defaultSSGIOptions, ...options }

		super("SSGIEffect", compose, {
			type: "FinalSSGIMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["sceneTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)],
				["toneMapping", new Uniform(NoToneMapping)]
			])
		})

		this._scene = scene
		this._camera = camera

		let definesName

		if (options.diffuseOnly) {
			definesName = "ssdgi"
			options.reprojectSpecular = false
			options.roughnessDependent = false
			options.basicVariance = 0.00025
			options.neighborhoodClamping = false
		} else if (options.specularOnly) {
			definesName = "ssr"
			options.reprojectSpecular = true
			options.roughnessDependent = true
			options.basicVariance = 0.00025
			options.neighborhoodClamping = true
			options.neighborhoodClampingDisocclusionTest = false
		} else {
			definesName = "ssgi"
			options.reprojectSpecular = [false, true]
			options.neighborhoodClamping = [false, true]
			options.neighborhoodClampingDisocclusionTest = false
			options.roughnessDependent = [false, true]
			options.basicVariance = [0.00025, 0.00025]
		}

		const textureCount = options.diffuseOnly || options.specularOnly ? 1 : 2

		this.svgf = new SVGF(
			scene,
			camera,
			velocityDepthNormalPass,
			textureCount,
			denoise_compose,
			denoise_compose_functions,
			options
		)

		if (definesName === "ssgi") {
			this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader =
				this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader
					.replace(
						"accumulatedTexel[ 1 ].rgb = clampedColor;",
						`
						float roughness = inputTexel[ 0 ].a;
						accumulatedTexel[ 1 ].rgb = mix(accumulatedTexel[1].rgb, clampedColor, 1. - sqrt(roughness));
						`
					)
					.replace(
						"outputColor = mix(inputTexel[ 1 ].rgb, accumulatedTexel[ 1 ].rgb, temporalReprojectMix);",
						/* glsl */ `
				float roughness = inputTexel[0].a;
				float glossines = max(0., 0.025 - roughness) / 0.025;
				temporalReprojectMix *= 1. - glossines * glossines;
				
				outputColor = mix(inputTexel[ 1 ].rgb, accumulatedTexel[ 1 ].rgb, temporalReprojectMix);
				`
					)
		} else if (definesName === "ssr") {
			this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader =
				this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader.replace(
					"accumulatedTexel[ 0 ].rgb = clampedColor;",
					`
					accumulatedTexel[ 0 ].rgb = mix(accumulatedTexel[1].rgb, clampedColor, 0.75);
					`
				)
		}

		this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.needsUpdate = true

		// ssgi pass
		this.ssgiPass = new SSGIPass(this, options)

		if (options.diffuseOnly) {
			this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.inputTexture0.value = this.ssgiPass.texture
		} else if (options.specularOnly) {
			this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.inputTexture0.value =
				this.ssgiPass.specularTexture
		} else {
			this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.inputTexture0.value = this.ssgiPass.texture
			this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.inputTexture1.value =
				this.ssgiPass.specularTexture
		}

		// the denoiser always uses the same G-buffers as the SSGI pass
		const denoisePassUniforms = this.svgf.denoisePass.fullscreenMaterial.uniforms
		denoisePassUniforms.depthTexture.value = this.ssgiPass.depthTexture
		denoisePassUniforms.normalTexture.value = this.ssgiPass.normalTexture

		this.svgf.setJitteredGBuffers(this.ssgiPass.depthTexture, this.ssgiPass.normalTexture)

		// patch the denoise pass
		this.svgf.denoisePass.fullscreenMaterial.uniforms = {
			...this.svgf.denoisePass.fullscreenMaterial.uniforms,
			...{
				diffuseTexture: new Uniform(null),
				directLightTexture: new Uniform(null)
			}
		}

		this.svgf.denoisePass.fullscreenMaterial.defines[definesName] = ""

		this.ssgiPass.fullscreenMaterial.defines.directLightMultiplier = options.directLightMultiplier.toPrecision(5)

		this.svgf.denoisePass.fullscreenMaterial.uniforms.diffuseTexture.value = this.ssgiPass.diffuseTexture

		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale
		}

		this.sceneRenderTarget = new WebGLRenderTarget(1, 1, {
			encoding: sRGBEncoding
		})

		this.renderPass = new RenderPass(this._scene, this._camera)
		this.renderPass.renderToScreen = false

		this.setSize(options.width, options.height)

		const th = this
		const ssgiRenderPass = this.renderPass
		RenderPass.prototype.render = function (...args) {
			if (this !== ssgiRenderPass) {
				const wasUsingRenderPass = th.isUsingRenderPass
				th.isUsingRenderPass = true

				if (wasUsingRenderPass != th.isUsingRenderPass) th.updateUsingRenderPass()
			}

			render.call(this, ...args)
		}

		this.makeOptionsReactive(options)
	}

	updateUsingRenderPass() {
		if (this.isUsingRenderPass) {
			this.ssgiPass.fullscreenMaterial.defines.useDirectLight = ""
			this.svgf.denoisePass.fullscreenMaterial.defines.useDirectLight = ""
		} else {
			delete this.ssgiPass.fullscreenMaterial.defines.useDirectLight
			delete this.svgf.denoisePass.fullscreenMaterial.defines.useDirectLight
		}

		this.ssgiPass.fullscreenMaterial.needsUpdate = true
		this.svgf.denoisePass.fullscreenMaterial.needsUpdate = true
	}

	makeOptionsReactive(options) {
		let needsUpdate = false

		const ssgiPassFullscreenMaterialUniforms = this.ssgiPass.fullscreenMaterial.uniforms
		const ssgiPassFullscreenMaterialUniformsKeys = Object.keys(ssgiPassFullscreenMaterialUniforms)
		const temporalReprojectPass = this.svgf.svgfTemporalReprojectPass

		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					if (options[key] === value && needsUpdate) return

					options[key] = value

					switch (key) {
						// denoiser
						case "denoiseIterations":
							this.svgf.denoisePass.iterations = value
							break

						case "denoiseDiffuse":
							this.svgf.denoisePass.fullscreenMaterial.uniforms.denoise.value[0] = value
							break

						case "denoiseSpecular":
							this.svgf.denoisePass.fullscreenMaterial.uniforms.denoise.value[1] = value
							break

						case "denoiseKernel":
						case "depthPhi":
						case "normalPhi":
						case "roughnessPhi":
							this.svgf.denoisePass.fullscreenMaterial.uniforms[key].value = value
							break

						// SSGI
						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							temporalReprojectPass.reset()
							break

						// defines
						case "steps":
						case "refineSteps":
						case "spp":
							this.ssgiPass.fullscreenMaterial.defines[key] = parseInt(value)
							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate
							temporalReprojectPass.reset()

							break

						case "importanceSampling":
						case "missedRays":
						case "autoThickness":
							if (value) {
								this.ssgiPass.fullscreenMaterial.defines[key] = ""
							} else {
								delete this.ssgiPass.fullscreenMaterial.defines[key]
							}

							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate
							temporalReprojectPass.reset()

							break

						case "blend":
							this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.uniforms[key].value = value
							temporalReprojectPass.reset()
							break

						case "distance":
							ssgiPassFullscreenMaterialUniforms.rayDistance.value = value
							temporalReprojectPass.reset()

							break

						// must be a uniform
						default:
							if (ssgiPassFullscreenMaterialUniformsKeys.includes(key)) {
								ssgiPassFullscreenMaterialUniforms[key].value = value
								temporalReprojectPass.reset()
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

		this.ssgiPass.setSize(width, height)
		this.svgf.setSize(width, height)
		this.sceneRenderTarget.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	setvelocityDepthNormalPass(velocityDepthNormalPass) {
		this.ssgiPass.fullscreenMaterial.uniforms.velocityTexture.value = velocityDepthNormalPass.texture
		this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.uniforms.velocityTexture.value =
			velocityDepthNormalPass.texture

		this.svgf.setNonJitteredGBuffers(velocityDepthNormalPass.depthTexture, velocityDepthNormalPass.normalTexture)
	}

	dispose() {
		super.dispose()

		this.ssgiPass.dispose()
		this.svgf.dispose()

		RenderPass.prototype.render = render
	}

	keepEnvMapUpdated() {
		const ssgiMaterial = this.ssgiPass.fullscreenMaterial

		if (this._scene.environment && ssgiMaterial.uniforms.envMapInfo.value.mapUuid !== this._scene.environment.uuid) {
			if (this._scene.environment?.mapping === EquirectangularReflectionMapping) {
				if (!this._scene.environment.generateMipmaps) {
					this._scene.environment.generateMipmaps = true
					this._scene.environment.minFilter = LinearMipMapLinearFilter
					this._scene.environment.magFilter = LinearMipMapLinearFilter
					this._scene.environment.needsUpdate = true
				}

				const maxEnvMapMipLevel = getMaxMipLevel(this._scene.environment)
				ssgiMaterial.uniforms.maxEnvMapMipLevel.value = maxEnvMapMipLevel

				ssgiMaterial.uniforms.envMapInfo.value.map = this._scene.environment

				ssgiMaterial.defines.USE_ENVMAP = ""
				delete ssgiMaterial.defines.importanceSampling

				if (this.importanceSampling) {
					ssgiMaterial.uniforms.envMapInfo.value.updateFrom(this._scene.environment).then(() => {
						ssgiMaterial.defines.importanceSampling = ""
						ssgiMaterial.needsUpdate = true
					})
				} else {
					ssgiMaterial.uniforms.envMapInfo.value.map = this._scene.environment
				}
			} else {
				delete ssgiMaterial.defines.USE_ENVMAP
				delete ssgiMaterial.defines.importanceSampling
			}

			this.svgf.svgfTemporalReprojectPass.reset()

			ssgiMaterial.needsUpdate = true
		}
	}

	update(renderer, inputBuffer) {
		// ! todo: make SSGI's accumulation no longer FPS-dependent

		this.keepEnvMapUpdated()

		const sceneBuffer = this.isUsingRenderPass ? inputBuffer : this.sceneRenderTarget

		const hideMeshes = []

		if (!this.isUsingRenderPass) {
			const children = []

			for (const c of getVisibleChildren(this._scene)) {
				if (c.isScene) return

				c.visible = !isChildMaterialRenderable(c.material)

				c.visible ? hideMeshes.push(c) : children.push(c)
			}

			this.renderPass.render(renderer, this.sceneRenderTarget)

			for (const c of children) c.visible = true
			for (const c of hideMeshes) c.visible = false
		}

		this.ssgiPass.fullscreenMaterial.uniforms.directLightTexture.value = sceneBuffer.texture
		this.svgf.denoisePass.fullscreenMaterial.uniforms.directLightTexture.value = sceneBuffer.texture

		this.ssgiPass.render(renderer)
		this.svgf.render(renderer)

		this.uniforms.get("inputTexture").value = this.svgf.texture
		this.uniforms.get("sceneTexture").value = sceneBuffer.texture
		this.uniforms.get("depthTexture").value = this.ssgiPass.depthTexture
		this.uniforms.get("toneMapping").value = renderer.toneMapping

		for (const c of hideMeshes) c.visible = true

		const fullGi = !this.diffuseOnly && !this.specularOnly

		globalIblIrradianceDisabledUniform.value = fullGi || this.diffuseOnly === true
		globalIblRadianceDisabledUniform.value = fullGi || this.specularOnly == true

		cancelAnimationFrame(this.rAF2)
		cancelAnimationFrame(this.rAF)
		cancelAnimationFrame(this.usingRenderPassRAF)

		this.rAF = requestAnimationFrame(() => {
			this.rAF2 = requestAnimationFrame(() => {
				globalIblIrradianceDisabledUniform.value = false
				globalIblRadianceDisabledUniform.value = false
			})
		})
		this.usingRenderPassRAF = requestAnimationFrame(() => {
			const wasUsingRenderPass = this.isUsingRenderPass
			this.isUsingRenderPass = false

			if (wasUsingRenderPass != this.isUsingRenderPass) this.updateUsingRenderPass()
		})
	}
}

SSGIEffect.DefaultOptions = defaultSSGIOptions
