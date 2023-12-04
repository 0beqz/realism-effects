import { Pass } from "postprocessing"
import {
	HalfFloatType,
	NoColorSpace,
	Matrix4,
	NearestFilter,
	RepeatWrapping,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	WebGLRenderTarget
} from "three"
import blueNoiseImage from "../utils/LDR_RGBA_0.png"
import vertexShader from "../utils/shader/basic.vert"
import sampleBlueNoise from "../utils/shader/sampleBlueNoise.glsl"
import fragmentShader from "./shader/poissionDenoise.frag"
import { generateDenoiseSamples, generatePoissonDiskConstant } from "./utils/PoissonUtils"

const finalFragmentShader = fragmentShader.replace("#include <sampleBlueNoise>", sampleBlueNoise)

const defaultPoissonBlurOptions = {
	iterations: 1,
	radius: 8,
	rings: 5.625,
	lumaPhi: 10,
	depthPhi: 2,
	normalPhi: 3.25,
	samples: 16,
	distance: 2,
	normalTexture: null
}

export class PoissionDenoisePass extends Pass {
	iterations = defaultPoissonBlurOptions.iterations
	index = 0

	constructor(camera, inputTexture, depthTexture, options = defaultPoissonBlurOptions) {
		super("PoissionBlurPass")

		options = { ...defaultPoissonBlurOptions, ...options }

		this.inputTexture = inputTexture

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: finalFragmentShader,
			vertexShader,
			uniforms: {
				depthTexture: { value: null },
				inputTexture: { value: null },
				projectionMatrixInverse: { value: new Matrix4() },
				cameraMatrixWorld: { value: new Matrix4() },
				lumaPhi: { value: 5.0 },
				depthPhi: { value: 5.0 },
				normalPhi: { value: 5.0 },
				distance: { value: 1.0 },
				resolution: { value: new Vector2() },
				blueNoiseTexture: { value: null },
				index: { value: 0 },
				blueNoiseRepeat: { value: new Vector2() }
			}
		})

		const renderTargetOptions = {
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLRenderTarget(1, 1, renderTargetOptions)
		this.renderTargetB = new WebGLRenderTarget(1, 1, renderTargetOptions)

		const { uniforms } = this.fullscreenMaterial

		uniforms["inputTexture"].value = this.inputTexture
		uniforms["depthTexture"].value = depthTexture
		uniforms["projectionMatrixInverse"].value = camera.projectionMatrixInverse
		uniforms["cameraMatrixWorld"].value = camera.matrixWorld
		uniforms["depthPhi"].value = options.depthPhi
		uniforms["normalPhi"].value = options.normalPhi
		uniforms["distance"].value = options.distance
		
		if (options.normalTexture) {
			uniforms["normalTexture"] = { value : options.normalTexture }
		} else {
			this.fullscreenMaterial.defines.NORMAL_IN_RGB = ""
		}

		// these properties need the shader to be recompiled
		for (const prop of ["radius", "rings", "samples"]) {
			Object.defineProperty(this, prop, {
				get: () => options[prop],
				set: value => {
					options[prop] = value

					this.setSize(this.renderTargetA.width, this.renderTargetA.height)
				}
			})
		}

		new TextureLoader().load(blueNoiseImage, blueNoiseTexture => {
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.colorSpace = NoColorSpace

			this.fullscreenMaterial.uniforms.blueNoiseTexture.value = blueNoiseTexture
		})
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.resolution.value.set(width, height)

		const poissonDisk = generateDenoiseSamples(
			this.samples,
			this.rings,
			this.radius,
			new Vector2(1 / width, 1 / height)
		)

		const sampleDefine = `const int samples = ${this.samples};\n`

		const poissonDiskConstant = generatePoissonDiskConstant(poissonDisk)

		this.fullscreenMaterial.fragmentShader = sampleDefine + poissonDiskConstant + "\n" + finalFragmentShader
		this.fullscreenMaterial.needsUpdate = true
	}

	get texture() {
		return this.renderTargetB.texture
	}

	render(renderer) {
		this.fullscreenMaterial.uniforms.index.value = 0

		const noiseTexture = this.fullscreenMaterial.uniforms.blueNoiseTexture.value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.fullscreenMaterial.uniforms.blueNoiseRepeat.value.set(
				this.renderTargetA.width / width,
				this.renderTargetA.height / height
			)
		}

		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0

			const inputRenderTarget = horizontal ? this.renderTargetB : this.renderTargetA
			this.fullscreenMaterial.uniforms["inputTexture"].value = i === 0 ? this.inputTexture : inputRenderTarget.texture

			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			renderer.setRenderTarget(renderTarget)
			renderer.render(this.scene, this.camera)

			this.fullscreenMaterial.uniforms.index.value = (this.fullscreenMaterial.uniforms.index.value + 1) % 4
		}
	}
}

PoissionDenoisePass.DefaultOptions = defaultPoissonBlurOptions
