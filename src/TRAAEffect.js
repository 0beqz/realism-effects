import { DepthPass, Effect, Selection } from "postprocessing"
import { NearestFilter, Quaternion, Uniform, Vector3 } from "three"
import customTRComposeShader from "./material/shader/customTRComposeShader.frag"
import finalTRAAShader from "./material/shader/finalTRAAShader.frag"
import helperFunctions from "./material/shader/helperFunctions.frag"
import { TemporalResolvePass } from "./temporal-resolve/pass/TemporalResolvePass.js"
import temporalResolve from "./temporal-resolve/shader/temporalResolve.frag"

const finalFragmentShader = finalTRAAShader.replace("#include <helperFunctions>", helperFunctions)

const defaultTRAAOptions = {
	temporalResolve: true,
	temporalResolveMix: 0.9,
	temporalResolveCorrectionMix: 1
}

export class TRAAEffect extends Effect {
	samples = 0
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
		this.temporalResolvePass.fullscreenMaterial.defines.FLOAT_EPSILON = 0.00001
		this.temporalResolvePass.fullscreenMaterial.defines.DILATION = ""

		this.uniforms.get("accumulatedTexture").value = this.temporalResolvePass.renderTarget.texture

		this.#lastSize = { width: options.width, height: options.height, resolutionScale: options.resolutionScale }
		this.#lastCameraTransform.position.copy(camera.position)
		this.#lastCameraTransform.quaternion.copy(camera.quaternion)

		this.setSize(options.width, options.height)

		this.depthPass = new DepthPass(this._scene, this._camera)
		this.depthPass.renderTarget.minFilter = NearestFilter
		this.depthPass.renderTarget.magFilter = NearestFilter

		this.temporalResolvePass.fullscreenMaterial.uniforms.depthTexture.value = this.depthPass.renderTarget.texture

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
							const composeShader = customTRComposeShader
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
							uniform float temporalResolveMix;
							` + fragmentShader

							this.temporalResolvePass.fullscreenMaterial.fragmentShader = fragmentShader
							this.temporalResolvePass.fullscreenMaterial.needsUpdate = true

							this.temporalResolveMix = value ? 0.9 : 0
							break

						case "temporalResolveMix":
							this.temporalResolvePass.fullscreenMaterial.uniforms.temporalResolveMix.value = value
							break

						case "temporalResolveCorrectionMix":
							this.temporalResolvePass.fullscreenMaterial.uniforms.temporalResolveCorrectionMix.value = value
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
		this.depthPass.setSize(width, height)

		this.#lastSize = { width, height, resolutionScale: this.resolutionScale }
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

	// source: https://observablehq.com/@jrus/halton
	halton(index, base) {
		let fraction = 1
		let result = 0
		while (index > 0) {
			fraction /= base
			result += fraction * (index % base)
			index = ~~(index / base) // floor division
		}
		return result
	}

	update(renderer, inputBuffer) {
		this.samples++
		this.checkNeedsResample()

		this.depthPass.renderPass.render(renderer, this.depthPass.renderTarget)

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.temporalResolvePass.fullscreenMaterial.uniforms.samples.value = this.samples

		this._camera.updateProjectionMatrix()

		const x = this.halton(this.samples, 2) * 2 - 1
		const y = this.halton(this.samples, 3) * 2 - 1

		const { width, height } = this.#lastSize

		if (this.temporalResolveMix > 0) {
			this._camera.setViewOffset(width, height, x, y, width, height)
		}

		// compose reflection of last and current frame into one reflection
		this.temporalResolvePass.render(renderer)
	}
}
