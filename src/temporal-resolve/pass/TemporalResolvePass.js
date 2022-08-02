import { Pass } from "postprocessing"
import {
	FramebufferTexture,
	HalfFloatType,
	LinearFilter,
	RGBAFormat,
	ShaderMaterial,
	Uniform,
	Vector2,
	WebGLRenderTarget
} from "three"
import vertexShader from "../../material/shader/basicVertexShader.vert"
import temporalResolve from "../shader/temporalResolve.frag"
import { VelocityPass } from "./VelocityPass"

const zeroVec2 = new Vector2()

export class TemporalResolvePass extends Pass {
	constructor(
		scene,
		camera,
		customComposeShader,
		{
			width = typeof window !== "undefined" ? window.innerWidth : 2000,
			height = typeof window !== "undefined" ? window.innerHeight : 1000,
			velocityTexture = null,
			lastVelocityTexture = null,
			useLastVelocity = true
		} = {}
	) {
		super("TemporalResolvePass")

		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(width, height, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		if (velocityTexture === null) {
			this.velocityPass = new VelocityPass(scene, camera)

			velocityTexture = this.velocityPass.renderTarget.texture
		}

		this.resolutionScale = 0.5

		this.useLastVelocity = !lastVelocityTexture && useLastVelocity

		const fragmentShader = temporalResolve.replace("#include <custom_compose_shader>", customComposeShader)

		this.fullscreenMaterial = new ShaderMaterial({
			type: "TemporalResolveMaterial",
			uniforms: {
				inputTexture: new Uniform(null),
				accumulatedTexture: new Uniform(null),
				velocityTexture: new Uniform(velocityTexture),
				lastVelocityTexture: new Uniform(lastVelocityTexture),
				blend: new Uniform(0)
			},
			depthTest: false,
			depthWrite: false,
			vertexShader,
			fragmentShader
		})

		this.setupAccumulatedTexture(width, height)
	}

	dispose() {
		this.renderTarget.dispose()
		this.accumulatedTexture.dispose()
		this.fullscreenMaterial.dispose()

		if (this.velocityPass) this.velocityPass.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
		if (this.velocityPass) this.velocityPass.setSize(width * this.resolutionScale, height * this.resolutionScale)

		this.setupAccumulatedTexture(width, height)
	}

	setupAccumulatedTexture(width, height) {
		if (this.accumulatedTexture) this.accumulatedTexture.dispose()

		this.accumulatedTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.accumulatedTexture.minFilter = LinearFilter
		this.accumulatedTexture.magFilter = LinearFilter
		this.accumulatedTexture.type = HalfFloatType
		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.accumulatedTexture

		if (this.useLastVelocity) {
			this.lastVelocityTexture = new FramebufferTexture(
				width * this.resolutionScale,
				height * this.resolutionScale,
				RGBAFormat
			)
			this.lastVelocityTexture.minFilter = LinearFilter
			this.lastVelocityTexture.magFilter = LinearFilter
			this.lastVelocityTexture.type = HalfFloatType

			this.fullscreenMaterial.uniforms.lastVelocityTexture.value = this.lastVelocityTexture
		}

		this.fullscreenMaterial.needsUpdate = true
	}

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		// save the render target's texture for use in next frame
		renderer.copyFramebufferToTexture(zeroVec2, this.accumulatedTexture)

		if (this.useLastVelocity) {
			renderer.setRenderTarget(this.velocityPass.renderTarget)
			renderer.copyFramebufferToTexture(zeroVec2, this.lastVelocityTexture)
		}
	}
}
