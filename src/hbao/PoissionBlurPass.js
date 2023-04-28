import { Pass } from "postprocessing"
import {
	HalfFloatType,
	LinearEncoding,
	NearestFilter,
	RepeatWrapping,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	WebGLRenderTarget
} from "three"
import { PoissionBlur } from "./PoissionBlur"
import blueNoiseImage from "../utils/blue_noise_64_rgba.png"

const defaultPoissonBlurOptions = {
	depthPhi: 10,
	normalPhi: 20
}

export class PoissionBlurPass extends Pass {
	iterations = 1
	denoiseRadius = 12

	constructor(camera, inputTexture, depthTexture, options = defaultPoissonBlurOptions) {
		super("PoissionBlurPass")

		options = { ...defaultPoissonBlurOptions, ...options }

		this._camera = camera
		this.inputTexture = inputTexture
		this.depthTexture = depthTexture

		this.fullscreenMaterial = new ShaderMaterial({ ...PoissionBlur })

		const renderTargetOptions = {
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLRenderTarget(1, 1, renderTargetOptions)
		this.renderTargetB = new WebGLRenderTarget(1, 1, renderTargetOptions)

		const { uniforms } = this.fullscreenMaterial

		uniforms["tDiffuse"].value = this.inputTexture
		uniforms["sceneDepth"].value = this.depthTexture
		uniforms["projMat"].value = camera.projectionMatrix
		uniforms["viewMat"].value = camera.matrixWorldInverse
		uniforms["projectionMatrixInv"].value = camera.projectionMatrixInverse
		uniforms["viewMatrixInv"].value = camera.matrixWorld
		uniforms["cameraPos"].value = camera.position
		uniforms["depthPhi"].value = options.depthPhi
		uniforms["normalPhi"].value = options.normalPhi
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)

		new TextureLoader().load(blueNoiseImage, blueNoiseTexture => {
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.fullscreenMaterial.uniforms.blueNoise.value = blueNoiseTexture
		})
	}

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		this.fullscreenMaterial.uniforms.texSize.value.set(this.renderTargetA.width, this.renderTargetA.height)
	}

	dispose() {
		super.dispose()

		this.renderTargetA.dispose()
		this.renderTargetB.dispose()
	}

	get texture() {
		return this.renderTargetB.texture
	}

	render(renderer) {
		const { uniforms } = this.fullscreenMaterial

		const clientWidth = window.innerWidth * 0.99
		const clientHeight = window.innerHeight * 0.98

		uniforms["radius"].value = denoiseRadius

		uniforms["resolution"].value = new Vector2(clientWidth, clientHeight)
		uniforms["time"].value = performance.now() / 1000

		const noiseTexture = this.fullscreenMaterial.uniforms.blueNoise.value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.fullscreenMaterial.uniforms.blueNoiseRepeat.value.set(
				this.renderTarget.width / width,
				this.renderTarget.height / height
			)
		}

		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0

			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			this.fullscreenMaterial.uniforms["tDiffuse"].value = horizontal
				? i === 0
					? this.inputTexture
					: this.renderTargetB.texture
				: this.renderTargetA.texture

			renderer.setRenderTarget(renderTarget)
			renderer.render(this.scene, this.camera)
		}
	}
}
