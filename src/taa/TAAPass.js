import { Pass } from "postprocessing"
import {
	FloatType,
	FramebufferTexture,
	Quaternion,
	RGBAFormat,
	ShaderMaterial,
	Vector2,
	Vector3,
	WebGLRenderTarget
} from "three"
import { didCameraMove } from "../utils/SceneUtils"
import vertexShader from "../utils/shader/basic.vert"
import { jitter } from "./TAAUtils"
import taa from "./shader/taa.frag"

export class TAAPass extends Pass {
	accumulatedTexture = null
	lastCameraPosition = new Vector3()
	lastCameraQuaternion = new Quaternion()
	lastCameraProjectionMatrix = null
	cameraNotMovedFrames = 0
	frame = 0
	needsUpdate = false
	renderToScreen = true

	renderTarget = new WebGLRenderTarget(1, 1, {
		type: FloatType,
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
				cameraNotMovedFrames: { value: 0 },
				invTexSize: { value: new Vector2(1, 1) }
			},
			toneMapped: false,
			depthWrite: false,
			depthTest: false
		})

		this._camera = camera
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
		this.frame = (this.frame + 1) % 4096

		this.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / inputBuffer.width, 1 / inputBuffer.height)

		// check if the camera has moved by comparing the camera's world matrix and projection matrix
		const cameraMoved =
			this.needsUpdate || didCameraMove(this._camera, this.lastCameraPosition, this.lastCameraQuaternion)
		this.needsUpdate = false

		const cameraNotMovedFrames = this.fullscreenMaterial.uniforms.cameraNotMovedFrames.value
		if (cameraNotMovedFrames > 0) {
			const { width, height } = this.framebufferTexture.image
			jitter(width, height, this._camera, this.frame, 1)
		}

		this.fullscreenMaterial.uniforms.cameraNotMovedFrames.value = cameraMoved ? 0 : (cameraNotMovedFrames + 1) % 4096

		this.lastCameraPosition.copy(this._camera.position)
		this.lastCameraQuaternion.copy(this._camera.quaternion)

		renderer.setRenderTarget(null)
		renderer.render(this.scene, this.camera)

		renderer.copyFramebufferToTexture(this.renderTarget, this.framebufferTexture)
	}
}
