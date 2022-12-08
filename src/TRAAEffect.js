import { Effect } from "postprocessing"
import { Uniform } from "three"
import compose from "./shader/compose.frag"
import utils from "./SSGI/shader/utils.frag"
import { TemporalResolvePass } from "./SSGI/temporal-resolve/TemporalResolvePass.js"
import { getVisibleChildren } from "./SSGI/utils/Utils"

const finalFragmentShader = compose.replace("#include <utils>", utils)

export const defaultTRAAOptions = {
	blend: 0.9,
	dilation: true,
	catmullRomSampling: true,
	constantBlend: true,
	logTransform: true,
	neighborhoodClamping: true
}

export class TRAAEffect extends Effect {
	#lastSize

	constructor(scene, camera, options = defaultTRAAOptions) {
		super("TRAAEffect", finalFragmentShader, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([["accumulatedTexture", new Uniform(null)]])
		})

		this._scene = scene
		this._camera = camera

		options = { ...defaultTRAAOptions, ...options }

		this.#lastSize = { width: options.width, height: options.height, resolutionScale: options.resolutionScale }

		this.temporalResolvePass = new TemporalResolvePass(scene, camera, options)

		this.uniforms.get("accumulatedTexture").value = this.temporalResolvePass.texture

		this.setSize(options.width, options.height)

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		let needsUpdate = false

		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					if (options[key] === value && needsUpdate) return

					options[key] = value

					switch (key) {
						case "blend":
						case "correction":
							this.temporalResolvePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "logTransform":
						case "neighborhoodClamping":
							if (value) {
								this.temporalResolvePass.fullscreenMaterial.defines[key] = ""
							} else {
								delete this.temporalResolvePass.fullscreenMaterial.defines[key]
							}

							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true
							break
					}
				}
			})

			// apply all uniforms and defines
			this[key] = options[key]
		}

		needsUpdate = true
	}

	setSize(width, height) {
		if (
			width === this.#lastSize.width &&
			height === this.#lastSize.height &&
			this.resolutionScale === this.#lastSize.resolutionScale
		)
			return

		this.temporalResolvePass.setSize(width, height)

		this.#lastSize = { width, height, resolutionScale: this.resolutionScale }
	}

	dispose() {
		super.dispose()

		this.temporalResolvePass.dispose()
	}

	update(renderer, inputBuffer) {
		// TODO: FIX RIGGED MESHES ISSUE

		this.temporalResolvePass.jitter()
		this.jitteredProjectionMatrix = this._camera.projectionMatrix.clone()
		this.temporalResolvePass.unjitter()

		const visibleMeshes = getVisibleChildren(this._scene)
		for (const mesh of visibleMeshes) {
			if (mesh.constructor.name === "GroundProjectedEnv") continue

			const uniforms = Array.from(renderer.properties.get(mesh.material).programs.values())[0].getUniforms()

			if (!uniforms._patchedProjectionMatrix) {
				const oldSetValue = uniforms.setValue.bind(uniforms)
				uniforms._oldSetValue = oldSetValue
				uniforms.setValue = (gl, name, value, ...args) => {
					if (name === "projectionMatrix") {
						value = this.jitteredProjectionMatrix
					}

					oldSetValue(gl, name, value, ...args)
				}

				uniforms._patchedProjectionMatrix = true
			}

			cancelAnimationFrame(uniforms._destroyPatchRAF)
			cancelAnimationFrame(uniforms._destroyPatchRAF2)

			uniforms._destroyPatchRAF = requestAnimationFrame(() => {
				uniforms._destroyPatchRAF2 = requestAnimationFrame(() => {
					uniforms.setValue = uniforms._oldSetValue
					delete uniforms._oldSetValue
					delete uniforms._patchedProjectionMatrix
				})
			})
		}

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture

		this.temporalResolvePass.render(renderer)
	}
}
