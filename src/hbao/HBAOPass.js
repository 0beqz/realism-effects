import { Pass } from "postprocessing"
import {
	Color,
	LinearEncoding,
	Matrix4,
	NearestFilter,
	NoBlending,
	RepeatWrapping,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	WebGLRenderTarget,
	sRGBEncoding
} from "three"
import vertexShader from "../utils/shader/basic.vert"
import fragmentShader from "./shader/hbao.frag"
import sampleBlueNoise from "../utils/shader/sampleBlueNoise.glsl"
// eslint-disable-next-line camelcase
import hbao_utils from "./shader/hbao_utils.glsl"

import blueNoiseImage from "../utils/blue_noise_64_rgba.png"

const finalFragmentShader = fragmentShader
	.replace("#include <hbao_utils>", hbao_utils)
	.replace("#include <sampleBlueNoise>", sampleBlueNoise)

class HBAOPass extends Pass {
	frame = 0

	constructor(camera, scene) {
		super()
		this._camera = camera
		this._scene = scene

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			encoding: sRGBEncoding,
			depthBuffer: false
		})

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: finalFragmentShader,
			vertexShader,

			uniforms: {
				color: { value: new Color() },
				depthTexture: { value: null },
				normalTexture: { value: null },
				accumulatedTexture: { value: null },
				velocityTexture: { value: null },
				cameraNear: { value: 0 },
				cameraFar: { value: 0 },
				frame: { value: 0 },
				viewMatrix: { value: this._camera.matrixWorldInverse },
				projectionViewMatrix: { value: new Matrix4() },
				inverseProjectionMatrix: { value: this._camera.projectionMatrixInverse },
				cameraMatrixWorld: { value: this._camera.matrixWorld },
				texSize: { value: new Vector2() },
				blueNoiseTexture: { value: null },
				blueNoiseRepeat: { value: new Vector2() },
				aoDistance: { value: 0 },
				distancePower: { value: 0 },
				bias: { value: 0 },
				thickness: { value: 0 },
				power: { value: 0 }
			},

			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})

		this.fullscreenMaterial.uniforms.inverseProjectionMatrix.value = this._camera.projectionMatrixInverse
		this.fullscreenMaterial.uniforms.viewMatrix.value = this._camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
	}

	get texture() {
		return this.renderTarget.texture
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)

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
		this.renderTarget.setSize(width, height)

		this.fullscreenMaterial.uniforms.texSize.value.set(this.renderTarget.width, this.renderTarget.height)
	}

	render(renderer) {
		const spp = +this.fullscreenMaterial.defines.spp
		this.frame = (this.frame + spp) % 65536

		this.fullscreenMaterial.uniforms.frame.value = this.frame
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		this.fullscreenMaterial.uniforms.projectionViewMatrix.value.multiplyMatrices(
			this._camera.projectionMatrix,
			this._camera.matrixWorldInverse
		)

		const noiseTexture = this.fullscreenMaterial.uniforms.blueNoiseTexture.value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.fullscreenMaterial.uniforms.blueNoiseRepeat.value.set(
				this.renderTarget.width / width,
				this.renderTarget.height / height
			)
		}

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}

export { HBAOPass }
