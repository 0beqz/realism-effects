import { Effect } from "postprocessing"
import { Uniform } from "three"
import compose from "./shader/compose.frag"
import utils from "./SSGI/shader/utils.frag"
import { TemporalResolvePass } from "./SSGI/temporal-resolve/TemporalResolvePass.js"

const finalFragmentShader = compose.replace("#include <utils>", utils)

export const defaultTRAAOptions = {
	blend: 0.9,
	constantBlend: true,
	blendStatic: false,
	dilation: true,
	catmullRomSampling: true,
	logTransform: true,
	neighborhoodClamping: true,
	renderVelocity: false
}

export class TRAAEffect extends Effect {
	#lastSize

	constructor(scene, camera, options = defaultTRAAOptions) {
		super("TRAAEffect", finalFragmentShader, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([["inputTexture", new Uniform(null)]])
		})

		this._scene = scene
		this._camera = camera

		options = { ...defaultTRAAOptions, ...options }

		this.#lastSize = { width: options.width, height: options.height, resolutionScale: options.resolutionScale }

		this.temporalResolvePass = new TemporalResolvePass(scene, camera, options)

		this.uniforms.get("inputTexture").value = this.temporalResolvePass.texture

		this.setSize(options.width, options.height)
	}

	setSize(width, height) {
		if (
			width === this.#lastSize.width &&
			height === this.#lastSize.height &&
			this.resolutionScale === this.#lastSize.resolutionScale
		)
			return

		this.temporalResolvePass.setSize(width, height)

		this.#lastSize = { width, height, resolutionScale: this.resolutionScale }
	}

	dispose() {
		super.dispose()

		this.temporalResolvePass.dispose()
	}

	update(renderer, inputBuffer) {
		// TODO: FIX RIGGED MESHES ISSUE

		this.temporalResolvePass.unjitter()
		this.jitteredProjectionMatrix = this._camera.projectionMatrix.clone()

		// this._camera.projectionMatrix.copy(this.jitteredProjectionMatrix)

		// const visibleMeshes = getVisibleChildren(this._scene)
		// for (const mesh of visibleMeshes) {
		// 	if (mesh.constructor.name === "GroundProjectedEnv") continue

		// 	const uniforms = Array.from(renderer.properties.get(mesh.material).programs.values())[0].getUniforms()

		// 	if (!uniforms._patchedProjectionMatrix) {
		// 		const oldSetValue = uniforms.setValue.bind(uniforms)
		// 		uniforms._oldSetValue = oldSetValue
		// 		uniforms.setValue = (gl, name, value, ...args) => {
		// 			if (name === "projectionMatrix") {
		// 				value = this.jitteredProjectionMatrix
		// 			}

		// 			oldSetValue(gl, name, value, ...args)
		// 		}

		// 		uniforms._patchedProjectionMatrix = true
		// 	}

		// 	cancelAnimationFrame(uniforms._destroyPatchRAF)
		// 	cancelAnimationFrame(uniforms._destroyPatchRAF2)

		// 	uniforms._destroyPatchRAF = requestAnimationFrame(() => {
		// 		uniforms._destroyPatchRAF2 = requestAnimationFrame(() => {
		// 			uniforms.setValue = uniforms._oldSetValue
		// 			delete uniforms._oldSetValue
		// 			delete uniforms._patchedProjectionMatrix
		// 		})
		// 	})
		// }

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture

		this.temporalResolvePass.render(renderer)

		this.temporalResolvePass.jitter()
	}
}
