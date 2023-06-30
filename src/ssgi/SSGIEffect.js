import { Effect, RenderPass, Selection } from "postprocessing"
import {
	LinearFilter,
	LinearMipMapLinearFilter,
	NoToneMapping,
	PerspectiveCamera,
	SRGBColorSpace,
	Uniform,
	WebGLRenderTarget
} from "three"
import { SVGF } from "../svgf/SVGF.js"
import { CubeToEquirectEnvPass } from "./pass/CubeToEquirectEnvPass.js"
import { SSGIPass } from "./pass/SSGIPass.js"
/* eslint-disable camelcase */
import { defaultSSGIOptions } from "./SSGIOptions"
import { SSGIComposePass } from "./pass/SSGIComposePass.js"
import ssgi_compose from "./shader/ssgi_compose.frag"
import {
	createGlobalDisableIblIradianceUniform,
	createGlobalDisableIblRadianceUniform,
	getMaxMipLevel,
	getVisibleChildren,
	isChildMaterialRenderable,
	unrollLoops
} from "./utils/Utils.js"

const { render } = RenderPass.prototype

const globalIblIrradianceDisabledUniform = createGlobalDisableIblIradianceUniform()
const globalIblRadianceDisabledUniform = createGlobalDisableIblRadianceUniform()

export class SSGIEffect extends Effect {
	selection = new Selection()
	isUsingRenderPass = true

	constructor(composer, scene, camera, velocityDepthNormalPass, options) {
		options = { ...defaultSSGIOptions, ...options }

		super("SSGIEffect", ssgi_compose, {
			type: "FinalSSGIMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["sceneTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)],
				["toneMapping", new Uniform(NoToneMapping)]
			])
		})

		if (!(camera instanceof PerspectiveCamera)) {
			throw new Error(
				this.constructor.name +
					" doesn't support cameras of type '" +
					camera.constructor.name +
					"' yet. Only cameras of type 'PerspectiveCamera' are supported."
			)
		}

		this._scene = scene
		this._camera = camera
		this.composer = composer

		if (!composer.depthTexture) composer.createDepthTexture()

		window.depthTexture = composer.depthTexture

		let definesName

		if (options.diffuseOnly) {
			definesName = "ssdgi"
			options.reprojectSpecular = false
			options.roughnessDependent = false
			options.neighborhoodClamp = false
		} else if (options.specularOnly) {
			definesName = "ssr"
			options.reprojectSpecular = true
			options.roughnessDependent = true
			options.neighborhoodClamp = true
		} else {
			definesName = "ssgi"
			options.reprojectSpecular = [false, true]
			options.neighborhoodClamp = [true, true]
			options.roughnessDependent = [false, true]
		}

		options.neighborhoodClampRadius = 2
		options.neighborhoodClampIntensity = 0.75

		const textureCount = options.diffuseOnly || options.specularOnly ? 1 : 2

		// options = {
		// 	...options,
		// 	...{
		// 		denoiseCustomComposeShader: denoise_compose,
		// 		denoiseCustomComposeShaderFunctions: denoise_compose_functions
		// 	}
		// }

		this.svgf = new SVGF(scene, camera, velocityDepthNormalPass, textureCount, options)

		// if (definesName === "ssgi") {
		// 	this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader =
		// 		this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader.replace(
		// 			"accumulatedTexel[ 1 ].rgb = clampedColor;",
		// 			`
		// 				float roughness = inputTexel[ 0 ].a;
		// 				accumulatedTexel[ 1 ].rgb = mix(accumulatedTexel[ 1 ].rgb, clampedColor, 1. - sqrt(roughness));
		// 				`
		// 		)
		// } else if (definesName === "ssr") {
		// 	this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader =
		// 		this.svgf.svgfTemporalReprojectPass.fullscreenMaterial.fragmentShader.replace(
		// 			"accumulatedTexel[ 0 ].rgb = clampedColor;",
		// 			`
		// 			accumulatedTexel[ 0 ].rgb = mix(accumulatedTexel[ 0 ].rgb, clampedColor, 0.5);
		// 			`
		// 		)
		// }

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

		this.svgf.setJitteredGBuffers(this.ssgiPass.depthTexture, this.ssgiPass.normalTexture, {
			useRoughnessInAlphaChannel: true
		})

		this.svgf.denoisePass.setGBuffersTexture(this.ssgiPass.gBuffersRenderTarget.texture)

		// patch the denoise pass
		this.svgf.denoisePass.fullscreenMaterial.uniforms = {
			...this.svgf.denoisePass.fullscreenMaterial.uniforms,
			...{
				diffuseTexture: new Uniform(null),
				directLightTexture: new Uniform(null)
			}
		}

		this.svgf.denoisePass.fullscreenMaterial.defines[definesName] = ""

		this.svgf.denoisePass.fullscreenMaterial.uniforms.diffuseTexture.value = this.ssgiPass.diffuseTexture

		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale
		}

		this.sceneRenderTarget = new WebGLRenderTarget(1, 1, {
			colorSpace: SRGBColorSpace
		})

		this.renderPass = new RenderPass(this._scene, this._camera)
		this.renderPass.renderToScreen = false

		this.setSize(options.width, options.height)

		const th = this
		const ssgiRenderPass = this.renderPass
		// eslint-disable-next-line space-before-function-paren
		RenderPass.prototype.render = function (...args) {
			if (this !== ssgiRenderPass) {
				const wasUsingRenderPass = th.isUsingRenderPass
				th.isUsingRenderPass = true

				if (wasUsingRenderPass != th.isUsingRenderPass) th.updateUsingRenderPass()
			}

			render.call(this, ...args)
		}

		this.ssgiComposePass = new SSGIComposePass(camera)

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

						case "radius":
						case "phi":
						case "lumaPhi":
						case "depthPhi":
						case "normalPhi":
						case "roughnessPhi":
						case "diffusePhi":
							if (this.svgf.denoisePass.fullscreenMaterial.uniforms[key]) {
								this.svgf.denoisePass.fullscreenMaterial.uniforms[key].value = value
								temporalReprojectPass.reset()
							}
							break

						case "iterations":
						case "radius":
						case "rings":
						case "samples":
							this.svgf.denoisePass[key] = value
							break

						// SSGI
						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							temporalReprojectPass.reset()
							break

						// defines
						case "spp":
							this.ssgiPass.fullscreenMaterial.fragmentShader = this.ssgiPass.defaultFragmentShader.replaceAll(
								"spp",
								value
							)

							if (value !== 1) {
								this.ssgiPass.fullscreenMaterial.fragmentShader = unrollLoops(
									this.ssgiPass.fullscreenMaterial.fragmentShader
										.replace("#pragma unroll_loop_start", "")
										.replace("#pragma unroll_loop_end", "")
								)
							}

							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate

							temporalReprojectPass.reset()
							break
						case "steps":
						case "refineSteps":
							this.ssgiPass.fullscreenMaterial.defines[key] = parseInt(value)
							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate
							temporalReprojectPass.reset()

							break

						case "importanceSampling":
						case "missedRays":
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
		) {
			return
		}

		this.ssgiPass.setSize(width, height)
		this.svgf.setSize(width, height)
		this.ssgiComposePass.setSize(width, height)
		this.sceneRenderTarget.setSize(width, height)
		this.cubeToEquirectEnvPass?.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	dispose() {
		super.dispose()

		this.ssgiPass.dispose()
		this.svgf.dispose()
		this.cubeToEquirectEnvPass?.dispose()

		RenderPass.prototype.render = render
	}

	keepEnvMapUpdated(renderer) {
		const ssgiMaterial = this.ssgiPass.fullscreenMaterial

		let environment = this._scene.environment

		if (environment) {
			if (ssgiMaterial.uniforms.envMapInfo.value.mapUuid !== environment.uuid) {
				// if the environment is a cube texture, convert it to an equirectangular texture so we can sample it in the SSGI pass and use MIS
				if (environment.isCubeTexture) {
					if (!this.cubeToEquirectEnvPass) this.cubeToEquirectEnvPass = new CubeToEquirectEnvPass()

					environment = this.cubeToEquirectEnvPass.generateEquirectEnvMap(renderer, environment)
					environment.uuid = this._scene.environment.uuid
				}

				if (!environment.generateMipmaps) {
					environment.generateMipmaps = true
					environment.minFilter = LinearMipMapLinearFilter
					environment.magFilter = LinearFilter
					environment.needsUpdate = true
				}

				ssgiMaterial.uniforms.envMapInfo.value.mapUuid = environment.uuid

				const maxEnvMapMipLevel = getMaxMipLevel(environment)
				ssgiMaterial.uniforms.maxEnvMapMipLevel.value = maxEnvMapMipLevel

				ssgiMaterial.uniforms.envMapInfo.value.map = environment

				ssgiMaterial.defines.USE_ENVMAP = ""
				delete ssgiMaterial.defines.importanceSampling

				if (this.importanceSampling) {
					ssgiMaterial.uniforms.envMapInfo.value.updateFrom(environment, renderer).then(() => {
						ssgiMaterial.defines.importanceSampling = ""
						ssgiMaterial.needsUpdate = true
					})
				} else {
					ssgiMaterial.uniforms.envMapInfo.value.map = environment
				}

				this.svgf.svgfTemporalReprojectPass.reset()

				ssgiMaterial.needsUpdate = true
			}
		} else if ("USE_ENVMAP" in ssgiMaterial.defines) {
			delete ssgiMaterial.defines.USE_ENVMAP
			delete ssgiMaterial.defines.importanceSampling

			ssgiMaterial.needsUpdate = true
		}
	}

	update(renderer, inputBuffer) {
		this.keepEnvMapUpdated(renderer)

		const sceneBuffer = this.isUsingRenderPass ? inputBuffer : this.sceneRenderTarget

		const hideMeshes = []

		if (!this.isUsingRenderPass) {
			const children = []

			for (const c of getVisibleChildren(this._scene)) {
				if (c.isScene) return

				c.visible = !isChildMaterialRenderable(c)

				c.visible ? hideMeshes.push(c) : children.push(c)
			}

			this.renderPass.render(renderer, this.sceneRenderTarget)

			for (const c of children) c.visible = true
			for (const c of hideMeshes) c.visible = false
		}

		this.ssgiPass.fullscreenMaterial.uniforms.directLightTexture.value = sceneBuffer.texture
		this.svgf.denoisePass.fullscreenMaterial.uniforms.directLightTexture.value = sceneBuffer.texture

		const ssgiComposePassUniforms = this.ssgiComposePass.fullscreenMaterial.uniforms
		ssgiComposePassUniforms.gBuffersTexture.value = this.ssgiPass.gBuffersRenderTarget.texture
		ssgiComposePassUniforms.depthTexture.value = this.ssgiPass.depthTexture
		ssgiComposePassUniforms.diffuseGiTexture.value = this.svgf.denoisePass.texture[0]
		ssgiComposePassUniforms.specularGiTexture.value = this.svgf.denoisePass.texture[1]

		this.ssgiPass.render(renderer)
		this.svgf.render(renderer)
		this.ssgiComposePass.render(renderer)

		this.uniforms.get("inputTexture").value = this.ssgiComposePass.renderTarget.texture
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
