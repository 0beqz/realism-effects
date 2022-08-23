import { Effect, Selection } from "postprocessing"
import {
	CubeCamera,
	LinearFilter,
	PMREMGenerator,
	ShaderChunk,
	sRGBEncoding,
	Texture,
	Uniform,
	Vector3,
	WebGLCubeRenderTarget
} from "three"
import finalSSRShader from "./material/shader/finalSSRShader.frag"
import helperFunctions from "./material/shader/helperFunctions.frag"
import trCompose from "./material/shader/trCompose.frag"
import { ReflectionsPass } from "./pass/ReflectionsPass.js"
import { defaultSSROptions } from "./SSROptions"
import { TemporalResolvePass } from "./temporal-resolve/TemporalResolvePass.js"
import { useBoxProjectedEnvMap } from "./utils/useBoxProjectedEnvMap"
import { setupEnvMap } from "./utils/Utils"

const finalFragmentShader = finalSSRShader.replace("#include <helperFunctions>", helperFunctions)

const defaultCubeRenderTarget = new WebGLCubeRenderTarget(1)
let pmremGenerator

export class SSREffect extends Effect {
	selection = new Selection()
	lastSize
	cubeCamera = new CubeCamera(0.001, 1000, defaultCubeRenderTarget)
	usingBoxProjectedEnvMap = false

	/**
	 * @param {THREE.Scene} scene The scene of the SSR effect
	 * @param {THREE.Camera} camera The camera with which SSR is being rendered
	 * @param {SSROptions} [options] The optional options for the SSR effect
	 */
	constructor(scene, camera, options = defaultSSROptions) {
		super("SSREffect", finalFragmentShader, {
			type: "FinalSSRMaterial",
			uniforms: new Map([
				["diffuseTexture", new Uniform(null)],
				["reflectionsTexture", new Uniform(null)],
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
			dilation: true,
			renderVelocity: false,
			neighborhoodClamping: false,
			logTransform: true,
			generateMipmaps: true
		}

		options = { ...defaultSSROptions, ...options, ...trOptions }

		// set up passes

		// temporal resolve pass
		this.temporalResolvePass = new TemporalResolvePass(scene, camera, trCompose, options)

		this.uniforms.get("reflectionsTexture").value = this.temporalResolvePass.renderTarget.texture

		// reflections pass
		this.reflectionsPass = new ReflectionsPass(this)
		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.reflectionsPass.renderTarget.texture

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

		const reflectionPassFullscreenMaterialUniforms = this.reflectionsPass.fullscreenMaterial.uniforms
		const reflectionPassFullscreenMaterialUniformsKeys = Object.keys(reflectionPassFullscreenMaterialUniforms)

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
						case "intensity":
							this.uniforms.get("intensity").value = value
							break

						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							break

						case "qualityScale":
							this.temporalResolvePass.qualityScale = value
							this.setSize(this.lastSize.width, this.lastSize.height, true)
							break

						case "blur":
							this.uniforms.get("blur").value = value
							break

						// defines
						case "steps":
							this.reflectionsPass.fullscreenMaterial.defines.steps = parseInt(value)
							this.reflectionsPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "refineSteps":
							this.reflectionsPass.fullscreenMaterial.defines.refineSteps = parseInt(value)
							this.reflectionsPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "spp":
							this.reflectionsPass.fullscreenMaterial.defines.spp = parseInt(value)
							this.reflectionsPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "missedRays":
							if (value) {
								this.reflectionsPass.fullscreenMaterial.defines.missedRays = ""
							} else {
								delete this.reflectionsPass.fullscreenMaterial.defines.missedRays
							}

							this.reflectionsPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "correctionRadius":
							this.temporalResolvePass.fullscreenMaterial.defines.correctionRadius = Math.round(value)

							this.temporalResolvePass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "blend":
							this.temporalResolvePass.fullscreenMaterial.uniforms.blend.value = value
							break

						case "correction":
							this.temporalResolvePass.fullscreenMaterial.uniforms.correction.value = value
							break

						case "distance":
							reflectionPassFullscreenMaterialUniforms.rayDistance.value = value

						case "exponent":
							this.temporalResolvePass.fullscreenMaterial.uniforms.exponent.value = value
							break

						case "power":
							this.uniforms.get("power").value = value
							break

						// must be a uniform
						default:
							if (reflectionPassFullscreenMaterialUniformsKeys.includes(key)) {
								reflectionPassFullscreenMaterialUniforms[key].value = value
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
		this.reflectionsPass.setSize(width, height)

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

		const reflectionsMaterial = this.reflectionsPass.fullscreenMaterial

		useBoxProjectedEnvMap(reflectionsMaterial, position, size)
		reflectionsMaterial.fragmentShader = reflectionsMaterial.fragmentShader
			.replace("vec3 worldPos = ", "worldPos = ")
			.replace("varying vec3 vWorldPosition;", "vec3 worldPos;")

		reflectionsMaterial.uniforms.envMapPosition.value.copy(position)
		reflectionsMaterial.uniforms.envMapSize.value.copy(size)

		setupEnvMap(reflectionsMaterial, envMap, envMapSize)

		this.usingBoxProjectedEnvMap = true

		return envMap
	}

	deleteBoxProjectedEnvMapFallback() {
		const reflectionsMaterial = this.reflectionsPass.fullscreenMaterial
		reflectionsMaterial.uniforms.envMap.value = null
		reflectionsMaterial.fragmentShader = reflectionsMaterial.fragmentShader.replace("worldPos = ", "vec3 worldPos = ")
		delete reflectionsMaterial.defines.BOX_PROJECTED_ENV_MAP

		reflectionsMaterial.needsUpdate = true

		this.usingBoxProjectedEnvMap = false
	}

	dispose() {
		super.dispose()

		this.reflectionsPass.dispose()
		this.temporalResolvePass.dispose()
	}

	update(renderer, inputBuffer) {
		if (!this.usingBoxProjectedEnvMap && this._scene.environment) {
			const reflectionsMaterial = this.reflectionsPass.fullscreenMaterial

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
				setupEnvMap(reflectionsMaterial, envMap, envMapCubeUVHeight)
			}
		}

		this.temporalResolvePass.unjitter()

		this.temporalResolvePass.velocityPass.render(renderer)

		this.temporalResolvePass.jitter()

		// render reflections of current frame
		this.reflectionsPass.render(renderer, inputBuffer)

		this.uniforms.get("diffuseTexture").value = this.reflectionsPass.gBuffersRenderTarget.texture[2]

		// compose reflection of last and current frame into one reflection
		this.temporalResolvePass.render(renderer)

		this.temporalResolvePass.unjitter()
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
