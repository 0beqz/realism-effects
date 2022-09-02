import { Effect, Selection, BoxBlurPass } from "postprocessing"
import {
	CubeCamera,
	HalfFloatType,
	LinearFilter,
	PMREMGenerator,
	ShaderChunk,
	sRGBEncoding,
	Texture,
	Uniform,
	Vector3,
	WebGLCubeRenderTarget,
	WebGLRenderTarget
} from "three"
import compose from "./shader/compose.frag"
import utils from "./shader/utils.frag"
import trCompose from "./shader/trCompose.frag"
import { SSGIPass } from "./pass/SSGIPass.js"
import { defaultSSGIOptions } from "./SSGIOptions"
import { TemporalResolvePass } from "./temporal-resolve/TemporalResolvePass.js"
import { useBoxProjectedEnvMap } from "./utils/useBoxProjectedEnvMap"
import { getMaxMipLevel, setupEnvMap } from "./utils/Utils"

const finalFragmentShader = compose.replace("#include <utils>", utils)

const defaultCubeRenderTarget = new WebGLCubeRenderTarget(1)
let pmremGenerator

export class SSGIEffect extends Effect {
	selection = new Selection()
	lastSize
	cubeCamera = new CubeCamera(0.001, 1000, defaultCubeRenderTarget)
	usingBoxProjectedEnvMap = false

	/**
	 * @param {THREE.Scene} scene The scene of the SSGI effect
	 * @param {THREE.Camera} camera The camera with which SSGI is being rendered
	 * @param {SSGIOptions} [options] The optional options for the SSGI effect
	 */
	constructor(scene, camera, options = defaultSSGIOptions) {
		super("SSGIEffect", finalFragmentShader, {
			type: "FinalSSGIMaterial",
			uniforms: new Map([
				["diffuseTexture", new Uniform(null)],
				["ssgiTexture", new Uniform(null)],
				["boxBlurTexture", new Uniform(null)],
				["intensity", new Uniform(1)],
				["power", new Uniform(1)],
				["blur", new Uniform(0)]
			]),
			defines: new Map([["RENDER_MODE", "0"]])
		})

		this._scene = scene
		this._camera = camera

		const trOptions = {
			boxBlur: true,
			dilation: false,
			renderVelocity: false,
			neighborhoodClamping: true,
			logTransform: false,
			generateMipmaps: true,
			...options
		}

		options = { ...defaultSSGIOptions, ...options, ...trOptions }

		// set up passes

		// temporal resolve pass
		this.temporalResolvePass = new TemporalResolvePass(scene, camera, trCompose, options)
		this.temporalResolvePass.haltonIndex = ~~(this.temporalResolvePass.haltonSequence.length / 2)

		this.uniforms.get("ssgiTexture").value = this.temporalResolvePass.renderTarget.texture

		this.qualityScale = options.qualityScale

		// ssgi pass
		this.SSGIPass = new SSGIPass(this)
		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.SSGIPass.renderTarget.texture

		this.boxBlurPass = new BoxBlurPass({
			kernelSize: 3,
			iterations: 1,
			bilateral: true
		})

		this.boxBlurPass.renderTargetA.texture.type = HalfFloatType
		this.boxBlurPass.renderTargetB.texture.type = HalfFloatType

		this.boxBlurRenderTarget = new WebGLRenderTarget(1, 1, {
			type: HalfFloatType
		})

		this.uniforms.get("boxBlurTexture").value = this.boxBlurRenderTarget.texture

		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale,
			qualityScale: options.qualityScale
		}

		this.setSize(options.width, options.height)

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		let needsUpdate = false

		const ssgiPassFullscreenMaterialUniforms = this.SSGIPass.fullscreenMaterial.uniforms
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

						case "intensity":
						case "power":
						case "blur":
							this.uniforms.get(key).value = value
							break

						// defines
						case "steps":
						case "refineSteps":
						case "spp":
							this.SSGIPass.fullscreenMaterial.defines[key] = parseInt(value)
							this.SSGIPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "missedRays":
							if (value) {
								this.SSGIPass.fullscreenMaterial.defines.missedRays = ""
							} else {
								delete this.SSGIPass.fullscreenMaterial.defines.missedRays
							}

							this.SSGIPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "correctionRadius":
							this.temporalResolvePass.fullscreenMaterial.defines.correctionRadius = Math.round(value)

							this.temporalResolvePass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "blend":
						case "correction":
						case "exponent":
							this.temporalResolvePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "distance":
							ssgiPassFullscreenMaterialUniforms.rayDistance.value = value
							break

						case "mip":
							const maxMipLevel = getMaxMipLevel(this.temporalResolvePass.width, this.temporalResolvePass.height)
							const mip = value * maxMipLevel

							console.log(ssgiPassFullscreenMaterialUniforms)

							ssgiPassFullscreenMaterialUniforms[key].value = mip

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
		this.SSGIPass.setSize(width, height)
		this.boxBlurPass.setSize(width, height)
		this.boxBlurRenderTarget.setSize(width, height)

		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale,
			qualityScale: this.qualityScale
		}
	}

	generateBoxProjectedEnvMapFallback(renderer, position = new Vector3(), size = new Vector3(), envMapSize = 512) {
		this.cubeCamera.renderTarget.dispose()

		this.cubeCamera.renderTarget = new WebGLCubeRenderTarget(envMapSize, {
			encoding: sRGBEncoding,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			generateMipmaps: false
		})

		this.cubeCamera.position.copy(position)
		this.cubeCamera.updateMatrixWorld()
		this.cubeCamera.update(renderer, this._scene)

		if (!pmremGenerator) {
			pmremGenerator = new PMREMGenerator(renderer)
			pmremGenerator.compileCubemapShader()
		}

		const envMap = pmremGenerator.fromCubemap(this.cubeCamera.renderTarget.texture).texture
		envMap.minFilter = LinearFilter
		envMap.magFilter = LinearFilter
		envMap.generateMipmaps = false

		const ssgiMaterial = this.SSGIPass.fullscreenMaterial

		useBoxProjectedEnvMap(ssgiMaterial, position, size)
		ssgiMaterial.fragmentShader = ssgiMaterial.fragmentShader
			.replace("vec3 worldPos = ", "worldPos = ")
			.replace("varying vec3 vWorldPosition;", "vec3 worldPos;")

		ssgiMaterial.uniforms.envMapPosition.value.copy(position)
		ssgiMaterial.uniforms.envMapSize.value.copy(size)

		setupEnvMap(ssgiMaterial, envMap, envMapSize)

		this.usingBoxProjectedEnvMap = true

		return envMap
	}

	deleteBoxProjectedEnvMapFallback() {
		const ssgiMaterial = this.SSGIPass.fullscreenMaterial
		ssgiMaterial.uniforms.envMap.value = null
		ssgiMaterial.fragmentShader = ssgiMaterial.fragmentShader.replace("worldPos = ", "vec3 worldPos = ")
		delete ssgiMaterial.defines.BOX_PROJECTED_ENV_MAP

		ssgiMaterial.needsUpdate = true

		this.usingBoxProjectedEnvMap = false
	}

	dispose() {
		super.dispose()

		this.SSGIPass.dispose()
		this.temporalResolvePass.dispose()
	}

	update(renderer, inputBuffer) {
		if (!this.usingBoxProjectedEnvMap && this._scene.environment) {
			const ssgiMaterial = this.SSGIPass.fullscreenMaterial

			let envMap = null

			// not sure if there is a cleaner way to find the internal texture of a CubeTexture (when used as scene environment)
			this._scene.traverse(c => {
				if (!envMap && c.material && !c.material.envMap) {
					const properties = renderer.properties.get(c.material)

					if ("envMap" in properties && properties.envMap instanceof Texture) envMap = properties.envMap
				}
			})

			if (envMap) {
				const envMapCubeUVHeight = this._scene.environment.image.height
				setupEnvMap(ssgiMaterial, envMap, envMapCubeUVHeight)
			}
		}

		if (this.qualityScale < 1) this.temporalResolvePass.unjitter()

		if (!this.temporalResolvePass.checkCanUseSharedVelocityTexture())
			this.temporalResolvePass.velocityPass.render(renderer)

		if (this.qualityScale < 1) this.temporalResolvePass.jitter()

		// render ssgi of current frame
		this.SSGIPass.render(renderer, inputBuffer)

		if (this.SSGIPass.useDiffuse) this.uniforms.get("diffuseTexture").value = this.SSGIPass.diffuseTexture

		// compose ssgi of last and current frame into one ssgi
		this.temporalResolvePass.render(renderer)

		if (this.blur > 0)
			this.boxBlurPass.render(renderer, this.temporalResolvePass.renderTarget, this.boxBlurRenderTarget)

		if (this.qualityScale < 1) this.temporalResolvePass.unjitter()
	}

	static patchDirectEnvIntensity(envMapIntensity = 0) {
		if (envMapIntensity === 0) {
			ShaderChunk.envmap_physical_pars_fragment = ShaderChunk.envmap_physical_pars_fragment.replace(
				"vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {",
				"vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) { return vec3(0.0);"
			)
		} else {
			ShaderChunk.envmap_physical_pars_fragment = ShaderChunk.envmap_physical_pars_fragment.replace(
				"vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );",
				"vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness ) * " + envMapIntensity.toFixed(5) + ";"
			)
		}
	}
}
