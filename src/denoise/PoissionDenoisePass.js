/* eslint-disable camelcase */
import { Pass } from "postprocessing"
import { HalfFloatType, GLSL3, Matrix4, ShaderMaterial, Vector2, WebGLMultipleRenderTargets } from "three"
// eslint-disable-next-line camelcase

import vertexShader from "../utils/shader/basic.vert"
import gbuffer_packing from "../utils/shader/gbuffer_packing.glsl"

import { useBlueNoise } from "../utils/BlueNoiseUtils"
import fragmentShader from "./shader/poission_denoise.frag"
import { generateDenoiseSamples, generatePoissonDiskConstant } from "./utils/PoissonUtils"

const finalFragmentShader = fragmentShader.replace("#include <gbuffer_packing>", gbuffer_packing)

const defaultPoissonBlurOptions = {
	iterations: 1,
	radius: 3,
	rings: 3,
	phi: 0.5,
	lumaPhi: 5,
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
				inputTexture: { value: null },
				inputTexture2: { value: null },
				gBufferTexture: { value: null },
				projectionMatrixInverse: { value: new Matrix4() },
				cameraMatrixWorld: { value: new Matrix4() },
				viewMatrix: { value: new Matrix4() },
				radius: { value: defaultPoissonBlurOptions.radius },
				phi: { value: defaultPoissonBlurOptions.phi },
				lumaPhi: { value: defaultPoissonBlurOptions.lumaPhi },
				depthPhi: { value: defaultPoissonBlurOptions.depthPhi },
				normalPhi: { value: defaultPoissonBlurOptions.normalPhi },
				roughnessPhi: { value: defaultPoissonBlurOptions.roughnessPhi },
				resolution: { value: new Vector2() }
			},
			glslVersion: GLSL3
		})

		useBlueNoise(this.fullscreenMaterial)

		const renderTargetOptions = {
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTargetA = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)
		this.renderTargetB = new WebGLMultipleRenderTargets(1, 1, 2, renderTargetOptions)

		const { uniforms } = this.fullscreenMaterial

		uniforms["inputTexture"].value = this.inputTexture
		uniforms["depthTexture"].value = depthTexture
		uniforms["projectionMatrixInverse"].value = camera.projectionMatrixInverse
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
	}

	#updatePoissionDiskSamples(width, height) {
		const poissonDisk = generateDenoiseSamples(this.samples, this.rings, new Vector2(1 / width, 1 / height))

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
		return this.renderTargetB.texture
	}

	setGBufferTexture(texture) {
		this.fullscreenMaterial.uniforms.gBufferTexture.value = texture
	}

	setDepthTexture(texture) {
		this.fullscreenMaterial.uniforms.depthTexture.value = texture
	}

	render(renderer) {
		for (let i = 0; i < 2 * this.iterations; i++) {
			const horizontal = i % 2 === 0
			const inputRenderTarget = horizontal ? this.renderTargetB : this.renderTargetA

			this.fullscreenMaterial.uniforms["inputTexture"].value =
				i === 0 ? this.inputTexture : inputRenderTarget.texture[0]
			this.fullscreenMaterial.uniforms["inputTexture2"].value =
				i === 0 ? this.inputTexture2 : inputRenderTarget.texture[1]

			const renderTarget = horizontal ? this.renderTargetA : this.renderTargetB

			renderer.setRenderTarget(renderTarget)
			renderer.render(this.scene, this.camera)
		}
	}
}

PoissionDenoisePass.DefaultOptions = defaultPoissonBlurOptions
