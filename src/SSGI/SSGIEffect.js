import { Effect, Selection } from "postprocessing"
import { EquirectangularReflectionMapping, LinearMipMapLinearFilter, NoToneMapping, Uniform } from "three"
import { SSGIPass } from "./pass/SSGIPass.js"
import compose from "./shader/compose.frag"
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
				["toneMapping", new Uniform(NoToneMapping)]
			])
		})

		this._scene = scene
		this._camera = camera

		this.svgf = new SVGF(scene, camera)

		// ssgi pass
		this.ssgiPass = new SSGIPass(this)
		this.svgf.setInputTexture(this.ssgiPass.texture)
		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.specularTexture.value = this.ssgiPass.brdfTexture
		this.svgf.setNormalTexture(this.ssgiPass.normalTexture)
		this.svgf.setDepthTexture(this.ssgiPass.depthTexture)
		this.svgf.setDiffuseTexture(this.ssgiPass.diffuseTexture)
		this.svgf.setVelocityTexture(this.ssgiPass.velocityTexture)

		// modify the temporal resolve pass of SVGF denoiser for the SSGI effect
		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.fragmentShader =
			/* glsl */ `
		uniform sampler2D brdfTexture;
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
		uniform sampler2D brdfTexture;
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
				.replace(
					"gSpecular = vec4(specularLightingColor, sumVarianceSpecular);",
					/* glsl */ `
			if (isLastIteration) {
				float spread = roughness * roughness;

				// view-space position of the current texel
				vec3 viewPos = getViewPosition(depth);
    			vec3 viewDir = normalize(viewPos);

				vec3 T, B;

				vec3 n = viewNormal;  // view-space normal
    			vec3 v = viewDir;    // incoming vector

				// convert view dir and view normal to world-space
				vec3 V = (vec4(v, 1.) * _viewMatrix).xyz;  // invert view dir
    			vec3 N = (vec4(n, 1.) * _viewMatrix).xyz;  // invert view dir

				Onb(N, T, B);

				V = ToLocal(T, B, N, V);
				
				vec3 H = SampleGGXVNDF(V, spread, spread, 0.25, 0.25);
				if (H.z < 0.0) H = -H;

				vec3 l = normalize(reflect(-V, H));
				l = ToWorld(T, B, N, l);

				// convert reflected vector back to view-space
				l = (vec4(l, 1.) * cameraMatrixWorld).xyz;
				l = normalize(l);

				if (dot(viewNormal, l) < 0.) l = -l;

        		vec3 h = normalize(v + l);  // half vector
				float VoH = max(EPSILON, dot(v, h));

				VoH = pow(VoH, 0.875);

				// fresnel
				vec3 f0 = mix(vec3(0.04), diffuse, metalness);
				vec3 F = F_Schlick(f0, VoH);

				diffuseLightingColor = diffuse * (1. - metalness) * (1. - F) * color + specularLightingColor * F;

				// apply diffuse líghting
				vec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;
				diffuseLightingColor += directLight;
			}

		    gDiffuse = vec4(diffuseLightingColor, sumVarianceDiffuse);
    		gSpecular = vec4(specularLightingColor, sumVarianceSpecular);
			`
				)

		this.svgf.denoisePass.fullscreenMaterial.uniforms = {
			...this.svgf.denoisePass.fullscreenMaterial.uniforms,
			...{
				directLightTexture: new Uniform(null),
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
						case "specularPhi":
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

		if (!this.antialias) this.svgf.svgfTemporalResolvePass.customDepthRenderTarget = this.ssgiPass.gBuffersRenderTarget

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

		this.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture
		this.ssgiPass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture
		this.svgf.denoisePass.fullscreenMaterial.uniforms.directLightTexture.value = inputBuffer.texture

		this.ssgiPass.render(renderer, inputBuffer)

		this.svgf.render(renderer)

		this.uniforms.get("inputTexture").value = this.svgf.texture
		this.uniforms.get("toneMapping").value = renderer.toneMapping
	}
}
