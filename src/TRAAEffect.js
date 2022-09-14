import { Effect } from "postprocessing"
import { Quaternion, Uniform, Vector3 } from "three"
import compose from "./shader/compose.frag"
import utils from "./SSGI/shader/utils.frag"
import { TemporalResolvePass } from "./SSGI/temporal-resolve/TemporalResolvePass.js"
import { generateHalton23Points } from "./utils/generateHalton23Points"

const finalFragmentShader = compose.replace("#include <utils>", utils)

export const defaultTRAAOptions = {
	blend: 0.9,
	correction: 1,
	correctionRadius: 1,
	logTransform: true,
	qualityScale: 1,
	neighborhoodClamping: false,
	dilation: true,
	renderVelocity: false
}

export class TRAAEffect extends Effect {
	haltonSequence = generateHalton23Points(1024)
	haltonIndex = 0
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

		this.temporalResolvePass = new TemporalResolvePass(scene, camera, options)

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

					switch (key) {
						case "blend":
						case "correction":
							this.temporalResolvePass.fullscreenMaterial.uniforms[key].value = value
							break

						case "correctionRadius":
							this.temporalResolvePass.fullscreenMaterial.defines.correctionRadius = Math.round(value)
							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true
							break

						case "qualityScale":
							this.temporalResolvePass.qualityScale = value
							break

						case "dilation":
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
		const { autoUpdate } = this._scene
		this._scene.autoUpdate = false

		this.temporalResolvePass.unjitter()

		if (!this.temporalResolvePass.checkCanUseSharedVelocityTexture())
			this.temporalResolvePass.velocityPass.render(renderer)

		this.temporalResolvePass.jitter()

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture

		this.temporalResolvePass.render(renderer)

		this._scene.autoUpdate = autoUpdate
	}
}
