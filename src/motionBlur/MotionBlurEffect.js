import { Effect } from "postprocessing"
import { LinearEncoding, NearestFilter, RepeatWrapping, Uniform, Vector2 } from "three"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader"
import { generateHalton23Points } from "../SSGI/temporal-resolve/utils/generateHalton23Points"
import motionBlur from "./motionBlur.glsl"

// https://www.nvidia.com/docs/io/8230/gdc2003_openglshadertricks.pdf
// http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html
// reference code: https://github.com/gkjohnson/threejs-sandbox/blob/master/motionBlurPass/src/CompositeShader.js

const defaultOptions = { intensity: 1, jitter: 5, samples: 16 }
const points = generateHalton23Points(1024)

export class MotionBlurEffect extends Effect {
	haltonIndex = 0

	constructor(velocityTexture, options = defaultOptions) {
		options = { ...defaultOptions, ...options }

		super("MotionBlurEffect", motionBlur, {
			type: "MotionBlurMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["velocityTexture", new Uniform(velocityTexture)],
				["blueNoiseTexture", new Uniform(null)],
				["blueNoiseRepeat", new Uniform(new Vector2())],
				["blueNoiseOffset", new Uniform(new Vector2())],
				["intensity", new Uniform(1)],
				["jitter", new Uniform(1)],
				["seed", new Uniform(0)],
				["deltaTime", new Uniform(0)]
			]),
			defines: new Map([
				["samples", options.samples.toFixed(0)],
				["samplesFloat", options.samples.toFixed(0) + ".0"]
			])
		})

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					options[key] = value

					switch (key) {
						case "intensity":
						case "jitter":
							this.uniforms.get(key).value = value
							break
					}
				}
			})

			this[key] = options[key]
		}
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)

		// load blue noise texture
		const ktx2Loader = new KTX2Loader()
		ktx2Loader.setTranscoderPath("examples/js/libs/basis/")
		ktx2Loader.detectSupport(renderer)
		ktx2Loader.load("texture/blue_noise_rg.ktx2", blueNoiseTexture => {
			// generated using "toktx --target_type RG --t2 blue_noise_rg blue_noise_rg.png"
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.uniforms.get("blueNoiseTexture").value = blueNoiseTexture

			ktx2Loader.dispose()
		})
	}

	update(renderer, inputBuffer, deltaTime) {
		this.uniforms.get("inputTexture").value = inputBuffer.texture
		this.uniforms.get("deltaTime").value = Math.max(1 / 1000, deltaTime)

		this.haltonIndex = (this.haltonIndex + 1) % points.length
		this.uniforms.get("blueNoiseOffset").value.fromArray(points[this.haltonIndex])

		const noiseTexture = this.uniforms.get("blueNoiseTexture").value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.uniforms.get("blueNoiseRepeat").value.set(inputBuffer.width / width, inputBuffer.height / height)
		}
	}
}
