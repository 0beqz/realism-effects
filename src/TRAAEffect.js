import { DepthPass, Effect, Selection } from "postprocessing"
import { LinearFilter, Quaternion, Uniform, Vector2, Vector3 } from "three"
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
	samples = 0
	counter = 0
	haltonSequence = generateHaltonPoints(1024)
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
				["depthTexture", new Uniform(null)],
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
		this.temporalResolvePass.fullscreenMaterial.uniforms.samples = new Uniform(0)
		this.temporalResolvePass.fullscreenMaterial.uniforms.maxSamples = new Uniform(0)
		this.temporalResolvePass.fullscreenMaterial.uniforms.jitter = new Uniform(new Vector2())
		this.temporalResolvePass.fullscreenMaterial.defines.FLOAT_EPSILON = 0.00001
		if (options.dilation) this.temporalResolvePass.fullscreenMaterial.defines.DILATION = ""

		this.uniforms.get("accumulatedTexture").value = this.temporalResolvePass.renderTarget.texture

		this.#lastSize = { width: options.width, height: options.height, resolutionScale: options.resolutionScale }
		this.#lastCameraTransform.position.copy(camera.position)
		this.#lastCameraTransform.quaternion.copy(camera.quaternion)

		this.setSize(options.width, options.height)

		if (options.dilation) {
			this.depthPass = new DepthPass(this._scene, this._camera)
			this.depthPass.renderTarget.minFilter = LinearFilter
			this.depthPass.renderTarget.magFilter = LinearFilter

			this.temporalResolvePass.fullscreenMaterial.uniforms.depthTexture.value = this.depthPass.renderTarget.texture
		}

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
						case "temporalResolve":
							const composeShader = TRComposeShader
							let fragmentShader = temporalResolve

							// if we are not using temporal reprojection, then cut out the part that's doing the reprojection
							if (!value) {
								const removePart = fragmentShader.slice(
									fragmentShader.indexOf("// REPROJECT_START"),
									fragmentShader.indexOf("// REPROJECT_END") + "// REPROJECT_END".length
								)
								fragmentShader = temporalResolve.replace(removePart, "")
							}

							fragmentShader = fragmentShader.replace("#include <custom_compose_shader>", composeShader)

							fragmentShader =
								/* glsl */ `
							uniform float samples;
							uniform float maxSamples;
							uniform float blend;
							` + fragmentShader

							this.temporalResolvePass.fullscreenMaterial.fragmentShader = fragmentShader
							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true

							this.blend = value ? 0.9 : 0
							break

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

		if (this.depthPass) this.depthPass.setSize(width, height)

		this.#lastSize = { width, height, resolutionScale: this.resolutionScale }
	}

	checkNeedsResample() {
		const moveDist = this.#lastCameraTransform.position.distanceToSquared(this._camera.position)
		const rotateDist = 8 * (1 - this.#lastCameraTransform.quaternion.dot(this._camera.quaternion))

		if (moveDist > 0.000001 || rotateDist > 0.000001) {
			this.samples = 0

			this.#lastCameraTransform.position.copy(this._camera.position)
			this.#lastCameraTransform.quaternion.copy(this._camera.quaternion)
		}
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
		if (this.depthPass) this.depthPass.renderPass.render(renderer, this.depthPass.renderTarget)

		this.checkNeedsResample()

		this.samples++

		this._camera.clearViewOffset()
		this._camera.updateProjectionMatrix()

		this.temporalResolvePass.velocityPass.render(renderer)

		const { width, height } = this.#lastSize

		this.counter = (this.counter + 1) % this.haltonSequence.length

		let [x, y] = this.haltonSequence[this.counter]
		x *= this.scale
		y *= this.scale

		if (this._camera.setViewOffset) {
			this._camera.setViewOffset(width, height, x, y, width, height)
		}

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.temporalResolvePass.fullscreenMaterial.uniforms.samples.value = this.samples
		this.temporalResolvePass.fullscreenMaterial.uniforms.jitter.value.set(-x / width, y / height)

		// compose reflection of last and current frame into one reflection
		this.temporalResolvePass.render(renderer)
	}
}
