import { Pass } from "postprocessing"
import {
	FramebufferTexture,
	HalfFloatType,
	Quaternion,
	RGBAFormat,
	ShaderMaterial,
	Vector3,
	WebGLRenderTarget
} from "three"
import vertexShader from "../utils/shader/basic.vert"
import { jitter } from "./TAAUtils"
import taa from "./shader/taa.frag"

export class TAAPass extends Pass {
	accumulatedTexture = null
	lastCameraPosition = new Vector3()
	lastCameraQuaternion = new Quaternion()
	lastCameraProjectionMatrix = null
	renderToScreen = true
	cameraNotMovedFrames = 0
	frame = 0
	needsUpdate = false

	renderTarget = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		depthBuffer: false
	})

	constructor(camera) {
		super("TAAPass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: taa,
			vertexShader,
			uniforms: {
				inputTexture: { value: null },
				acculumatedTexture: { value: null },
				cameraNotMovedFrames: { value: 0 }
			},
			toneMapped: false,
			depthWrite: false,
			depthTest: false
		})

		this._camera = camera
		this.lastCameraMatrixWorld = camera.matrixWorld.clone()
		this.lastCameraProjectionMatrix = camera.projectionMatrix.clone()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)

		this.framebufferTexture?.dispose()

		this.framebufferTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.framebufferTexture.needsUpdate = true

		this.fullscreenMaterial.uniforms.acculumatedTexture.value = this.framebufferTexture

		this.needsUpdate = true
	}

	render(renderer, inputBuffer) {
		this.frame = (this.frame + 1) % 65536

		this.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture

		// check if the camera has moved by comparing the camera's world matrix and projection matrix
		let cameraMoved = this.needsUpdate
		this.needsUpdate = false

		if (!cameraMoved) {
			for (let el = 0; el < 16; el++) {
				if (this._camera.position.distanceToSquared(this.lastCameraPosition) > 0.000001) {
					cameraMoved = true
					break
				}

				if (this._camera.quaternion.angleTo(this.lastCameraQuaternion) > 0.001) {
					cameraMoved = true
					break
				}
			}
		}

		const cameraNotMovedFrames = this.fullscreenMaterial.uniforms.cameraNotMovedFrames.value
		if (cameraNotMovedFrames > 0) {
			const { width, height } = this.framebufferTexture.image
			jitter(width, height, this._camera, this.frame)
		}

		this.fullscreenMaterial.uniforms.cameraNotMovedFrames.value = cameraMoved ? 0 : (cameraNotMovedFrames + 1) % 65536

		this.lastCameraPosition.copy(this._camera.position)
		this.lastCameraQuaternion.copy(this._camera.quaternion)

		renderer.setRenderTarget(null)
		renderer.render(this.scene, this.camera)

		renderer.copyFramebufferToTexture(this.renderTarget, this.framebufferTexture)
	}
}
