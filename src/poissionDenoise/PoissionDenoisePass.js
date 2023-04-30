import { Pass } from "postprocessing"
import {
	HalfFloatType,
	LinearEncoding,
	Matrix4,
	NearestFilter,
	RepeatWrapping,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	WebGLRenderTarget
} from "three"
import blueNoiseImage from "../utils/blue_noise_64_rgba.png"
import vertexShader from "../utils/shader/basic.vert"
import sampleBlueNoise from "../utils/shader/sampleBlueNoise.glsl"
import fragmentShader from "./shader/poissionDenoise.frag"

const finalFragmentShader = fragmentShader.replace("#include <sampleBlueNoise>", sampleBlueNoise)

const defaultPoissonBlurOptions = {
	iterations: 1,
	radius: 5,
	depthPhi: 2.5,
	normalPhi: 7.5
}

export class PoissionDenoisePass extends Pass {
	iterations = defaultPoissonBlurOptions.iterations
	radius = defaultPoissonBlurOptions.radius

	constructor(camera, inputTexture, depthTexture, options = defaultPoissonBlurOptions) {
		super("PoissionBlurPass")

		options = { ...defaultPoissonBlurOptions, ...options }

		this.inputTexture = inputTexture

		this.fullscreenMaterial = new ShaderMaterial({
			uniforms: {
				depthTexture: { value: null },
				inputTexture: { value: null },
				projectionMatrixInverse: { value: new Matrix4() },
				cameraMatrixWorld: { value: new Matrix4() },
				resolution: { value: new Vector2() },
				time: { value: 0.0 },
				depthPhi: { value: 5.0 },
				normalPhi: { value: 5.0 },
				blueNoiseTexture: { value: null },
				blueNoiseRepeat: { value: new Vector2() },
				radius: { value: 12.0 }
			},
			vertexShader,
			fragmentShader: finalFragmentShader
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

		new TextureLoader().load(blueNoiseImage, blueNoiseTexture => {
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.fullscreenMaterial.uniforms.blueNoiseTexture.value = blueNoiseTexture
		})
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.resolution.value.set(this.renderTargetA.width, this.renderTargetA.height)
	}

	get texture() {
		return this.renderTargetB.texture
	}

	render(renderer) {
		const { uniforms } = this.fullscreenMaterial

		uniforms["radius"].value = this.radius
		uniforms["time"].value = performance.now() / 1000

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
		}
	}
}

PoissionDenoisePass.DefaultOptions = defaultPoissonBlurOptions
