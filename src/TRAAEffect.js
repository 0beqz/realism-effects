import { Effect } from "postprocessing"
import { Quaternion, Uniform, Vector3 } from "three"
import finalTRAAShader from "./material/shader/finalTRAAShader.frag"
import helperFunctions from "./material/shader/helperFunctions.frag"
import trCompose from "./material/shader/trCompose.frag"
import { TemporalResolvePass } from "../example/SSR/temporal-resolve/TemporalResolvePass.js"
import { generateHalton23Points } from "./utils/generateHalton23Points"

const finalFragmentShader = finalTRAAShader.replace("#include <helperFunctions>", helperFunctions)

export const defaultTRAAOptions = {
	blend: 0.9,
	correction: 1,
	correctionRadius: 1,
	exponent: 1,
	logTransform: true,
	qualityScale: 1,
	neighborhoodClamping: false,
	boxBlur: false,
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

		this.#lastSize = { width: options.width, height: options.height, resolutionScale: options.resolutionScale }
		this.#lastCameraTransform.position.copy(camera.position)
		this.#lastCameraTransform.quaternion.copy(camera.quaternion)

		this.temporalResolvePass = new TemporalResolvePass(scene, camera, trCompose, options)
		this.temporalResolvePass.jitterScale = 1

		this.temporalResolvePass.fullscreenMaterial.needsUpdate = true

		this.uniforms.get("accumulatedTexture").value = this.temporalResolvePass.renderTarget.texture

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
						case "exponent":
						case "correction":
							this.temporalResolvePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "correctionRadius":
							this.temporalResolvePass.fullscreenMaterial.defines.correctionRadius = Math.round(value)
							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true
							break

						case "qualityScale":
							this.temporalResolvePass.qualityScale = value
							this.samples = 0
							break

						case "dilation":
						case "boxBlur":
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

		this.temporalResolvePass.unjitter()

		if (!this.temporalResolvePass.checkCanUseSharedVelocityTexture())
			this.temporalResolvePass.velocityPass.render(renderer)

		this.temporalResolvePass.jitter()

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.temporalResolvePass.fullscreenMaterial.uniforms.samples.value = this.samples

		// compose reflection of last and current frame into one reflection
		this.temporalResolvePass.render(renderer)

		this._scene.autoUpdate = autoUpdate
	}
}
