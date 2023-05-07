import { Pass } from "postprocessing"
import { HalfFloatType, Matrix4, ShaderMaterial, Vector2, WebGLRenderTarget } from "three"
import vertexShader from "../utils/shader/basic.vert"
import fragmentShader from "./shader/poissionDenoise.frag"
import { generatePoissonDiskConstant, generatePoissonSamples } from "./utils/PoissonUtils"

const defaultPoissonBlurOptions = {
	iterations: 1,
	radius: 8,
	depthPhi: 2.5,
	normalPhi: 7.5,
	rings: 11,
	samples: 16
}

export class PoissionDenoisePass extends Pass {
	iterations = defaultPoissonBlurOptions.iterations

	constructor(camera, inputTexture, depthTexture, options = defaultPoissonBlurOptions) {
		super("PoissionBlurPass")

		options = { ...defaultPoissonBlurOptions, ...options }

		this.inputTexture = inputTexture

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader,
			vertexShader,
			uniforms: {
				depthTexture: { value: null },
				inputTexture: { value: null },
				projectionMatrixInverse: { value: new Matrix4() },
				cameraMatrixWorld: { value: new Matrix4() },
				depthPhi: { value: 5.0 },
				normalPhi: { value: 5.0 }
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

	setSize(width, height) {
		this.renderTargetA.setSize(width, height)
		this.renderTargetB.setSize(width, height)

		const poissonDisk = generatePoissonSamples(
			this.samples,
			this.rings,
			this.radius,
			new Vector2(1 / width, 1 / height)
		)
		const poissonDiskConstant = generatePoissonDiskConstant(poissonDisk)

		this.fullscreenMaterial.fragmentShader = poissonDiskConstant + "\n" + fragmentShader
		this.fullscreenMaterial.needsUpdate = true
	}

	get texture() {
		return this.renderTargetB.texture
	}

	render(renderer) {
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
