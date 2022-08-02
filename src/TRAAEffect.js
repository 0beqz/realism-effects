import { Effect, Selection } from "postprocessing"
import { Quaternion, Uniform, Vector2, Vector3 } from "three"
import finalTRAAShader from "./material/shader/finalTRAAShader.frag"
import helperFunctions from "./material/shader/helperFunctions.frag"
import TRComposeShader from "./material/shader/TRComposeShader.frag"
import { TemporalResolvePass } from "./temporal-resolve/pass/TemporalResolvePass.js"
import temporalResolve from "./temporal-resolve/shader/temporalResolve.frag"
import { generateHaltonPoints } from "./utils/Halton"

const finalFragmentShader = finalTRAAShader.replace("#include <helperFunctions>", helperFunctions)

const defaultTRAAOptions = {
	temporalResolve: true,
	blend: 0.9,
	correction: 1,
	dilation: true
}

export class TRAAEffect extends Effect {
	haltonSequence = generateHaltonPoints(1024)
	haltonIndex = 0
	selection = new Selection()
	#lastSize
	#lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}

	constructor(scene, camera, options = defaultTRAAOptions) {
		super("TRAAEffect", finalFragmentShader, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["accumulatedTexture", new Uniform(null)],
				["samples", new Uniform(0)]
			]),
			defines: new Map([["RENDER_MODE", "0"]])
		})

		this._scene = scene
		this._camera = camera

		options = { ...defaultTRAAOptions, ...options }

		// set up passes

		// temporal resolve pass
		this.temporalResolvePass = new TemporalResolvePass(scene, camera, "", options)
		this.temporalResolvePass.fullscreenMaterial.uniforms.jitter = new Uniform(new Vector2())
		this.temporalResolvePass.fullscreenMaterial.defines.FLOAT_EPSILON = 0.00001
		if (options.dilation) this.temporalResolvePass.fullscreenMaterial.defines.DILATION = ""

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

					switch (key) {
						case "blend":
							this.temporalResolvePass.fullscreenMaterial.uniforms.blend.value = value
							break

						case "correction":
							this.temporalResolvePass.fullscreenMaterial.uniforms.correction.value = value
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

		this._camera.clearViewOffset()

		this.temporalResolvePass.velocityPass.render(renderer)

		const { width, height } = this.#lastSize

		this.haltonIndex = (this.haltonIndex + 1) % this.haltonSequence.length

		let [x, y] = this.haltonSequence[this.haltonIndex]
		x *= this.scale
		y *= this.scale

		if (this._camera.setViewOffset) {
			this._camera.setViewOffset(width, height, x, y, width, height)
		}

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.temporalResolvePass.fullscreenMaterial.uniforms.jitter.value.set(x / width, y / height)

		// compose reflection of last and current frame into one reflection
		this.temporalResolvePass.render(renderer)

		this._scene.autoUpdate = autoUpdate
	}
}
