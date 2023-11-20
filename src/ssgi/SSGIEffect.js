import { Effect, RenderPass, Selection } from "postprocessing"
import {
	Color,
	LinearFilter,
	LinearMipMapLinearFilter,
	SRGBColorSpace,
	ShaderChunk,
	Uniform,
	WebGLRenderTarget
} from "three"
import { CubeToEquirectEnvPass } from "./pass/CubeToEquirectEnvPass.js"
import { SSGIPass } from "./pass/SSGIPass.js"
/* eslint-disable camelcase */
import Denoiser from "../denoise/Denoiser.js"
import { GBufferDebugPass } from "../gbuffer/debug/GBufferDebugPass.js"
import { getVisibleChildren } from "../gbuffer/utils/GBufferUtils.js"
import { isChildMaterialRenderable } from "../utils/SceneUtils.js"
import { defaultSSGIOptions } from "./SSGIOptions"
import ssgi_compose from "./shader/ssgi_compose.frag"
import { createGlobalDisableIblRadianceUniform, getMaxMipLevel } from "./utils/Utils.js"

const { render } = RenderPass.prototype

const globalIblRadianceDisabledUniform = createGlobalDisableIblRadianceUniform()

export class SSGIEffect extends Effect {
	selection = new Selection()
	isUsingRenderPass = true

	constructor(composer, scene, camera, options) {
		options = { ...defaultSSGIOptions, ...options }

		let fragmentShader = ssgi_compose.replace(
			"#include <fog_pars_fragment>",
			ShaderChunk.fog_pars_fragment.replace("varying", "")
		)

		// delete the line starting with gl_FragColor using a regex
		fragmentShader = fragmentShader.replace(
			"#include <fog_fragment>",
			ShaderChunk.fog_fragment.replace(/.*gl_FragColor.*/g, "")
		)

		const defines = new Map()
		if (scene.fog) defines.set("USE_FOG", "")
		if (scene.fog?.isFogExp2) defines.set("FOG_EXP2", "")

		super("SSGIEffect", fragmentShader, {
			type: "FinalSSGIMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["sceneTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)],
				["isDebug", new Uniform(false)],
				["fogColor", new Uniform(new Color())],
				["fogNear", new Uniform(0)],
				["fogFar", new Uniform(0)],
				["fogDensity", new Uniform(0)],
				["cameraNear", new Uniform(0)],
				["cameraFar", new Uniform(0)]
			]),
			defines: new Map([["PERSPECTIVE_CAMERA", camera.isPerspectiveCamera ? "1" : "0"], ...defines])
		})

		this._scene = scene
		this._camera = camera
		this.composer = composer

		if (options.mode === "ssr") {
			options.reprojectSpecular = true
			options.neighborhoodClamp = true
			options.inputType = "specular"
		} else if (options.mode === "ssgi") {
			options.reprojectSpecular = [false, true]
			options.neighborhoodClamp = [false, true]
		}

		this.ssgiPass = new SSGIPass(this, options)
		this.denoiser = new Denoiser(scene, camera, this.ssgiPass.texture, {
			gBufferPass: this.ssgiPass.gBufferPass,
			velocityDepthNormalPass: options.velocityDepthNormalPass,
			...options
		})

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

		this.makeOptionsReactive(options)

		this.outputTexture = this.denoiser.texture
	}

	updateUsingRenderPass() {
		if (this.isUsingRenderPass) {
			this.ssgiPass.fullscreenMaterial.defines.useDirectLight = ""
		} else {
			delete this.ssgiPass.fullscreenMaterial.defines.useDirectLight
		}

		this.ssgiPass.fullscreenMaterial.needsUpdate = true
	}

	reset() {
		this.denoiser.reset()
	}

	makeOptionsReactive(options) {
		let needsUpdate = false

		const ssgiPassFullscreenMaterialUniforms = this.ssgiPass.fullscreenMaterial.uniforms
		const ssgiPassFullscreenMaterialUniformsKeys = Object.keys(ssgiPassFullscreenMaterialUniforms)

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
							if (this.denoiser.denoisePass) this.denoiser.denoisePass.iterations = value
							break

						case "radius":
						case "phi":
						case "lumaPhi":
						case "depthPhi":
						case "normalPhi":
						case "roughnessPhi":
						case "specularPhi":
							if (this.denoiser.denoisePass?.fullscreenMaterial.uniforms[key]) {
								this.denoiser.denoisePass.fullscreenMaterial.uniforms[key].value = value
								this.reset()
							}
							break

						case "denoiseIterations":
						case "radius":
							if (this.denoiser.denoisePass) this.denoiser.denoisePass[key] = value
							break

						// SSGI
						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							this.reset()
							break

						case "steps":
						case "refineSteps":
							this.ssgiPass.fullscreenMaterial.defines[key] = parseInt(value)
							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate
							this.reset()

							break

						case "importanceSampling":
						case "missedRays":
							if (value) {
								this.ssgiPass.fullscreenMaterial.defines[key] = ""
							} else {
								delete this.ssgiPass.fullscreenMaterial.defines[key]
							}

							this.ssgiPass.fullscreenMaterial.needsUpdate = needsUpdate
							this.reset()
							break

						case "distance":
							ssgiPassFullscreenMaterialUniforms.rayDistance.value = value
							this.reset()
							break

						case "outputTexture":
							if (!this.outputTexture) {
								return
							}

							if (typeof value === "string") {
								if (this.gBufferDebugPass === undefined) {
									this.gBufferDebugPass = new GBufferDebugPass(this.ssgiPass.gBufferPass.texture)
									this.gBufferDebugPass.setSize(this.lastSize.width, this.lastSize.height)
								}

								const modes = ["diffuse", "alpha", "normal", "roughness", "metalness", "emissive"]
								const mode = modes.indexOf(value)
								this.gBufferDebugPass.fullscreenMaterial.uniforms.mode.value = mode

								this.outputTexture = this.gBufferDebugPass.texture
							} else if (this.gBufferDebugPass !== undefined && this.outputTexture !== this.gBufferDebugPass.texture) {
								this.gBufferDebugPass.dispose()
								delete this.gBufferDebugPass
							}

							this.uniforms.get("isDebug").value = this.outputTexture !== this.denoiser.texture

							break

						// must be a uniform
						default:
							if (ssgiPassFullscreenMaterialUniformsKeys.includes(key)) {
								ssgiPassFullscreenMaterialUniforms[key].value = value
								this.reset()
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
		this.denoiser.setSize(width, height)
		this.gBufferDebugPass?.setSize(width, height)
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
		this.denoiser.dispose()
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

				this.reset()

				ssgiMaterial.needsUpdate = true
			}
		} else if ("USE_ENVMAP" in ssgiMaterial.defines) {
			delete ssgiMaterial.defines.USE_ENVMAP
			delete ssgiMaterial.defines.importanceSampling

			ssgiMaterial.needsUpdate = true
		}
	}

	get depthTexture() {
		return this.ssgiPass.gBufferPass.depthTexture
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

		this.ssgiPass.render(renderer)
		this.gBufferDebugPass?.render(renderer)
		this.denoiser.render(renderer, inputBuffer)

		this.uniforms.get("inputTexture").value = this.outputTexture[0] ?? this.outputTexture
		this.uniforms.get("sceneTexture").value = sceneBuffer.texture
		this.uniforms.get("depthTexture").value = this.ssgiPass.gBufferPass.depthTexture

		// update the fog uniforms
		if (this._scene.fog) {
			this.uniforms.get("fogColor").value = this._scene.fog.color
			this.uniforms.get("fogNear").value = this._scene.fog.near
			this.uniforms.get("fogFar").value = this._scene.fog.far
			this.uniforms.get("fogDensity").value = this._scene.fog.density

			this.uniforms.get("cameraNear").value = this._camera.near
			this.uniforms.get("cameraFar").value = this._camera.far
		}

		for (const c of hideMeshes) c.visible = true

		globalIblRadianceDisabledUniform.value = true

		cancelAnimationFrame(this.rAF2)
		cancelAnimationFrame(this.rAF)
		cancelAnimationFrame(this.usingRenderPassRAF)

		this.rAF = requestAnimationFrame(() => {
			this.rAF2 = requestAnimationFrame(() => {
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
