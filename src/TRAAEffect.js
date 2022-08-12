import { Effect } from "postprocessing"
import { Quaternion, Uniform, Vector3 } from "three"
import finalTRAAShader from "./material/shader/finalTRAAShader.frag"
import helperFunctions from "./material/shader/helperFunctions.frag"
import TRComposeShader from "./material/shader/TRComposeShader.frag"
import { TemporalResolvePass } from "./temporal-resolve/pass/TemporalResolvePass.js"
import temporalResolve from "./temporal-resolve/shader/temporalResolve.frag"
import { generateHalton23Points } from "./utils/generateHalton23Points"

const finalFragmentShader = finalTRAAShader.replace("#include <helperFunctions>", helperFunctions)

export const defaultTRAAOptions = {
	blend: 0.9,
	clampRadius: 1,
	velocityResolutionScale: 1,
	useVelocity: true,
	useLastVelocity: true,
	dilation: true
}

export class TRAAEffect extends Effect {
	haltonSequence = generateHalton23Points(1024)
	haltonIndex = 0
	samples = 0
	#lastSize
	#lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}

	constructor(scene, camera, options = defaultTRAAOptions) {
		super("TRAAEffect", finalFragmentShader, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([["accumulatedTexture", new Uniform(null)]])
		})

		this._scene = scene
		this._camera = camera

		options = { ...defaultTRAAOptions, ...options }

		// set up passes

		// temporal resolve pass
		this.temporalResolvePass = new TemporalResolvePass(scene, camera, "", options)
		this.temporalResolvePass.fullscreenMaterial.defines.FLOAT_EPSILON = 0.00001

		this.uniforms.get("accumulatedTexture").value = this.temporalResolvePass.renderTarget.texture

		this.#lastSize = { width: options.width, height: options.height, resolutionScale: options.resolutionScale }
		this.#lastCameraTransform.position.copy(camera.position)
		this.#lastCameraTransform.quaternion.copy(camera.quaternion)

		const composeShader = TRComposeShader
		let fragmentShader = temporalResolve

		fragmentShader = fragmentShader.replace("#include <custom_compose_shader>", composeShader)

		fragmentShader =
			/* glsl */ `
		uniform float samples;
		uniform float maxSamples;
		uniform float blend;
		` + fragmentShader

		this.temporalResolvePass.fullscreenMaterial.fragmentShader = fragmentShader
		this.temporalResolvePass.fullscreenMaterial.needsUpdate = true

		this.setSize(options.width, options.height)

		this.#makeOptionsReactive(options)
	}

	#makeOptionsReactive(options) {
		let needsUpdate = false

		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					if (options[key] === value && needsUpdate) return

					options[key] = value

					const { width, height } = this.temporalResolvePass.renderTarget

					switch (key) {
						case "blend":
							this.temporalResolvePass.fullscreenMaterial.uniforms.blend.value = value
							break

						case "clampRadius":
							this.temporalResolvePass.fullscreenMaterial.defines.CLAMP_RADIUS = Math.round(value)
							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true
							break

						case "velocityResolutionScale":
							this.temporalResolvePass.velocityResolutionScale = value
							this.samples = 0
							break

						case "dilation":
							if (value) {
								this.temporalResolvePass.fullscreenMaterial.defines.DILATION = ""
							} else {
								delete this.temporalResolvePass.fullscreenMaterial.defines.DILATION
							}

							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true
							break

						case "useVelocity":
							if (value) {
								this.temporalResolvePass.fullscreenMaterial.defines.USE_VELOCITY = ""
							} else {
								delete this.temporalResolvePass.fullscreenMaterial.defines.USE_VELOCITY
							}

							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true

							this.temporalResolvePass.useVelocity = value
							this.temporalResolvePass.useLastVelocity = value

							this.temporalResolvePass.setSize(width, height)
							this.samples = 0
							break

						case "useLastVelocity":
							if (value) {
								this.temporalResolvePass.fullscreenMaterial.defines.USE_LAST_VELOCITY = ""
							} else {
								delete this.temporalResolvePass.fullscreenMaterial.defines.USE_LAST_VELOCITY
							}

							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true

							this.temporalResolvePass.useLastVelocity = value

							this.temporalResolvePass.setSize(width, height)
							this.samples = 0
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
		this.samples = 0

		this.#lastSize = { width, height, resolutionScale: this.resolutionScale }
	}

	dispose() {
		super.dispose()

		this.temporalResolvePass.dispose()
	}

	checkNeedsResample() {
		const moveDist = this.#lastCameraTransform.position.distanceToSquared(this._camera.position)
		const rotateDist = 8 * (1 - this.#lastCameraTransform.quaternion.dot(this._camera.quaternion))

		if (moveDist > 0.000001 || rotateDist > 0.000001) {
			this.samples = 1

			this.#lastCameraTransform.position.copy(this._camera.position)
			this.#lastCameraTransform.quaternion.copy(this._camera.quaternion)
		}
	}

	update(renderer, inputBuffer) {
		this.samples++
		this.checkNeedsResample()

		const { autoUpdate } = this._scene
		this._scene.autoUpdate = false

		this._camera.clearViewOffset()

		if (this.temporalResolvePass.useVelocity) this.temporalResolvePass.velocityPass.render(renderer)

		const { width, height } = this.#lastSize

		this.haltonIndex = (this.haltonIndex + 1) % this.haltonSequence.length

		const [x, y] = this.haltonSequence[this.haltonIndex]

		if (this._camera.setViewOffset) {
			this._camera.setViewOffset(width, height, x, y, width, height)
		}

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.temporalResolvePass.fullscreenMaterial.uniforms.samples.value = this.samples

		// compose reflection of last and current frame into one reflection
		this.temporalResolvePass.render(renderer)

		this._scene.autoUpdate = autoUpdate
	}
}
