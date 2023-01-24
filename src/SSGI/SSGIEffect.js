import { Effect, Selection } from "postprocessing"
import {
	EquirectangularReflectionMapping,
	LinearMipMapLinearFilter,
	NoToneMapping,
	sRGBEncoding,
	Uniform,
	WebGLRenderTarget
} from "three"
import { SSGIPass } from "./pass/SSGIPass.js"
import compose from "./shader/compose.frag"
import denoiseCompose from "./shader/denoiseCompose.frag"
import denoiseComposeFunctions from "./shader/denoiseComposeFunctions.frag"
import utils from "./shader/utils.frag"
import { defaultSSGIOptions } from "./SSGIOptions"
import { SVGF } from "./SVGF.js"
import { getMaxMipLevel } from "./utils/Utils.js"

const finalFragmentShader = compose.replace("#include <utils>", utils)

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
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["sceneTexture", new Uniform(null)],
				["depthTexture", new Uniform(null)],
				["toneMapping", new Uniform(NoToneMapping)]
			])
		})

		this._scene = scene
		this._camera = camera

		const lightOptions = {
			// specularOnly: true
		}

		this.svgf = new SVGF(scene, camera, denoiseCompose, denoiseComposeFunctions, lightOptions)

		// ssgi pass
		this.ssgiPass = new SSGIPass(this, lightOptions)
		this.svgf.setInputTexture(this.ssgiPass.texture)
		this.svgf.setSpecularTexture(this.ssgiPass.specularTexture)

		// the denoiser always uses the same G-buffers as the SSGI pass
		const denoisePassUniforms = this.svgf.denoisePass.fullscreenMaterial.uniforms
		denoisePassUniforms.depthTexture.value = this.ssgiPass.depthTexture
		denoisePassUniforms.normalTexture.value = this.ssgiPass.normalTexture

		// unless overridden, SVGF's temporal resolve pass also uses the same G-buffers as the SSGI pass
		// when TRAA is being used, the temporal resolve pass needs to use different G-buffers without jittering
		this.svgf.setNonJitteredGBuffers(this.ssgiPass.depthTexture, this.ssgiPass.normalTexture)
		this.svgf.setDiffuseTexture(this.ssgiPass.diffuseTexture)

		// modify the temporal resolve pass of SVGF denoiser for the SSGI effect
		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.fragmentShader =
			/* glsl */ `
		uniform sampler2D directLightTexture;

		` + this.svgf.svgfTemporalResolvePass.fullscreenMaterial.fragmentShader

		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms = {
			...this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms,
			...{
				directLightTexture: new Uniform(null)
			}
		}

		// patch the denoise pass

		this.svgf.denoisePass.fullscreenMaterial.fragmentShader =
			/* glsl */ `
		uniform sampler2D directLightTexture;
		uniform float jitter;
		uniform float jitterRoughness;
		` +
			this.svgf.denoisePass.fullscreenMaterial.fragmentShader
				.replace(
					"float roughness = normalTexel.a;",
					"float roughness = min(1., jitter + jitterRoughness * normalTexel.a);"
				)
				.replace(
					"float neighborRoughness = neighborNormalTexel.a;",
					"float neighborRoughness = min(1., jitter + jitterRoughness * neighborNormalTexel.a);"
				)
		// .replace(
		// 	"sumVarianceDiffuse = 1.;",
		// 	/* glsl */ `
		// 	// apply diffuse líghting
		// 	vec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;
		// 	diffuseLightingColor += directLight;

		// 	sumVarianceDiffuse = 1.;
		// 	`
		// )

		this.svgf.denoisePass.fullscreenMaterial.uniforms = {
			...this.svgf.denoisePass.fullscreenMaterial.uniforms,
			...{
				directLightTexture: new Uniform(null),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0)
			}
		}

		// temporal resolve pass
		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.fragmentShader =
			/* glsl */ `
	uniform float jitter;
	uniform float jitterRoughness;
	` +
			this.svgf.svgfTemporalResolvePass.fullscreenMaterial.fragmentShader.replace(
				"float roughness = inputTexel.a;",
				"float roughness = min(1., jitter + jitterRoughness * inputTexel.a);"
			)

		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms = {
			...this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms,
			...{
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0)
			}
		}

		this.svgf.denoisePass.fullscreenMaterial.uniforms.diffuseTexture.value = this.ssgiPass.diffuseTexture

		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale
		}

		this.sceneRenderTarget = new WebGLRenderTarget(1, 1, {
			encoding: sRGBEncoding
		})

		this.setSize(options.width, options.height)

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		let needsUpdate = false

		if (options.reflectionsOnly) this.svgf.svgfTemporalResolvePass.fullscreenMaterial.defines.reflectionsOnly = ""

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
						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							break

						case "denoiseIterations":
							this.svgf.denoisePass.iterations = value
							break

						case "denoiseKernel":
						case "denoiseDiffuse":
						case "denoiseSpecular":
						case "depthPhi":
						case "normalPhi":
						case "roughnessPhi":
							this.svgf.denoisePass.fullscreenMaterial.uniforms[key].value = value
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
							this.svgf.svgfTemporalResolvePass.fullscreenMaterial.defines.correctionRadius = Math.round(value)

							this.svgf.svgfTemporalResolvePass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "blend":
						case "correction":
							this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "distance":
							ssgiPassFullscreenMaterialUniforms.rayDistance.value = value
							break

						case "jitter":
						case "jitterRoughness":
							ssgiPassFullscreenMaterialUniforms[key].value = value

							this.svgf.denoisePass.fullscreenMaterial.uniforms[key].value = value
							this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms[key].value = value
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

		this.ssgiPass.setSize(width, height)
		this.svgf.setSize(width, height)
		this.sceneRenderTarget.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale
		}
	}

	setVelocityPass(velocityPass) {
		this.ssgiPass.fullscreenMaterial.uniforms.velocityTexture.value = velocityPass.texture
		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.velocityTexture.value = velocityPass.texture

		this.svgf.setNonJitteredGBuffers(velocityPass.depthTexture, velocityPass.normalTexture)
	}

	dispose() {
		super.dispose()

		this.ssgiPass.dispose()
		this.svgf.dispose()
	}

	keepEnvMapUpdated() {
		const ssgiMaterial = this.ssgiPass.fullscreenMaterial

		if (ssgiMaterial.uniforms.envMap.value !== this._scene.environment) {
			if (this._scene.environment?.mapping === EquirectangularReflectionMapping) {
				ssgiMaterial.uniforms.envMap.value = this._scene.environment

				if (!this._scene.environment.generateMipmaps) {
					this._scene.environment.generateMipmaps = true
					this._scene.environment.minFilter = LinearMipMapLinearFilter
					this._scene.environment.magFilter = LinearMipMapLinearFilter
					this._scene.environment.needsUpdate = true
				}

				const maxEnvMapMipLevel = getMaxMipLevel(this._scene.environment)
				ssgiMaterial.uniforms.maxEnvMapMipLevel.value = maxEnvMapMipLevel

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

		renderer.setRenderTarget(this.sceneRenderTarget)

		const children = []

		this._scene.traverseVisible(c => {
			if (c.isScene) return

			c._wasVisible = true

			c.visible = c.constructor.name === "GroundProjectedEnv" || this.selection.has(c)

			if (!c.visible) children.push(c)
		})

		renderer.render(this._scene, this._camera)

		for (const c of children) {
			c.visible = true
			delete c._wasVisible
		}

		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.directLightTexture.value =
			this.sceneRenderTarget.texture
		this.ssgiPass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture
		this.svgf.denoisePass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture

		this.ssgiPass.render(renderer)
		this.svgf.render(renderer)

		this.uniforms.get("inputTexture").value = this.svgf.texture
		this.uniforms.get("sceneTexture").value = this.sceneRenderTarget.texture
		this.uniforms.get("depthTexture").value = this.ssgiPass.depthTexture
		this.uniforms.get("toneMapping").value = renderer.toneMapping
	}
}
