import { Pass } from "postprocessing"
import {
	GLSL3,
	HalfFloatType,
	Matrix4,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	WebGLMultipleRenderTargets
} from "three"
// eslint-disable-next-line camelcase
import gbuffer_packing from "../ssgi/shader/gbuffer_packing.glsl"
import blueNoiseImage from "../utils/LDR_RGBA_0.png"
import vertexShader from "../utils/shader/basic.vert"
import sampleBlueNoise from "../utils/shader/sampleBlueNoise.glsl"
import fragmentShader from "./shader/poissionDenoise.frag"
import { generateDenoiseSamples, generatePoissonDiskConstant } from "./utils/PoissonUtils"

const finalFragmentShader = fragmentShader
	.replace("#include <sampleBlueNoise>", sampleBlueNoise)
	.replace("#include <gbuffer_packing>", gbuffer_packing)

const defaultPoissonBlurOptions = {
	iterations: 1,
	radius: 3,
	rings: 3,
	lumaPhi: 10,
	depthPhi: 2,
	normalPhi: 3.25,
	samples: 8
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
				directLightTexture: { value: null },
				inputTexture: { value: null },
				inputTexture2: { value: null },
				gBuffersTexture: { value: null },
				projectionMatrixInverse: { value: new Matrix4() },
				projectionMatrix: { value: new Matrix4() },
				cameraMatrixWorld: { value: new Matrix4() },
				viewMatrix: { value: new Matrix4() },
				radius: { value: defaultPoissonBlurOptions.radius },
				lumaPhi: { value: defaultPoissonBlurOptions.lumaPhi },
				depthPhi: { value: defaultPoissonBlurOptions.depthPhi },
				normalPhi: { value: defaultPoissonBlurOptions.normalPhi },
				roughnessPhi: { value: defaultPoissonBlurOptions.roughnessPhi },
				diffusePhi: { value: defaultPoissonBlurOptions.diffusePhi },
				resolution: { value: new Vector2() },
				blueNoiseTexture: { value: null },
				index: { value: 0 },
				isFirstIteration: { value: false },
				isLastIteration: { value: false },
				blueNoiseRepeat: { value: new Vector2() }
			},
			glslVersion: GLSL3
		})

		const renderTargetOptions = {
			type: HalfFloatType,
			colorSpace: SRGBColorSpace,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)

		const { uniforms } = this.fullscreenMaterial

		uniforms["inputTexture"].value = this.inputTexture
		uniforms["depthTexture"].value = depthTexture
		uniforms["projectionMatrixInverse"].value = camera.projectionMatrixInverse
		uniforms["projectionMatrix"].value = camera.projectionMatrix
		uniforms["cameraMatrixWorld"].value = camera.matrixWorld
		uniforms["viewMatrix"].value = camera.matrixWorldInverse
		uniforms["depthPhi"].value = options.depthPhi
		uniforms["normalPhi"].value = options.normalPhi

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

	#updatePoissionDiskSamples(width, height) {
		const poissonDisk = generateDenoiseSamples(
			this.samples,
			this.rings,
			this.radius,
			new Vector2(1 / width, 1 / height)
		)

		this.fullscreenMaterial.defines.samples = this.samples

		const poissonDiskConstant = generatePoissonDiskConstant(poissonDisk)
		this.fullscreenMaterial.defines.POISSON_DISK_SAMPLES = poissonDiskConstant
		this.fullscreenMaterial.needsUpdate = true
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.resolution.value.set(width, height)

		this.#updatePoissionDiskSamples(width, height)
	}

	get texture() {
		return this.renderTargetB.texture[0]
	}

	setGBuffersTexture(texture) {
		this.fullscreenMaterial.uniforms.gBuffersTexture.value = texture
	}

	render(renderer) {
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
			this.fullscreenMaterial.uniforms.isFirstIteration.value = i === 0
			this.fullscreenMaterial.uniforms.isLastIteration.value = i === 2 * this.iterations - 1

			const inputRenderTarget = horizontal ? this.renderTargetB : this.renderTargetA

			this.fullscreenMaterial.uniforms["inputTexture"].value =
				i === 0 ? this.inputTexture : inputRenderTarget.texture[0]
			this.fullscreenMaterial.uniforms["inputTexture2"].value =
				i === 0 ? this.inputTexture2 : inputRenderTarget.texture[1]

			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			renderer.setRenderTarget(renderTarget)
			renderer.render(this.scene, this.camera)

			this.fullscreenMaterial.uniforms.index.value++
			this.fullscreenMaterial.uniforms.index.value %= 65536
		}
	}
}

PoissionDenoisePass.DefaultOptions = defaultPoissonBlurOptions
