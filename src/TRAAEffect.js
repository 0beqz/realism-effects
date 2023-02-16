import { Effect } from "postprocessing"
import { Uniform } from "three"
import compose from "./shader/compose.frag"
import utils from "./SSGI/shader/utils.frag"
import { TemporalResolvePass } from "./SSGI/temporal-resolve/TemporalResolvePass.js"
import { getVisibleChildren } from "./SSGI/utils/Utils"

const finalFragmentShader = compose.replace("#include <utils>", utils)

export const defaultTRAAOptions = {
	blend: 0.9,
	constantBlend: true,
	fullAccumulate: false,
	dilation: true,
	catmullRomSampling: true,
	logTransform: true,
	neighborhoodClamping: true,
	renderVelocity: false
}

export class TRAAEffect extends Effect {
	constructor(scene, camera, velocityPass, options = defaultTRAAOptions) {
		super("TRAAEffect", finalFragmentShader, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([["inputTexture", new Uniform(null)]])
		})

		this._scene = scene
		this._camera = camera

		options = { ...defaultTRAAOptions, ...options }

		this.temporalResolvePass = new TemporalResolvePass(scene, camera, velocityPass, options)

		this.uniforms.get("inputTexture").value = this.temporalResolvePass.texture

		this.setSize(options.width, options.height)
	}

	setSize(width, height) {
		this.temporalResolvePass.setSize(width, height)
	}

	dispose() {
		super.dispose()

		this.temporalResolvePass.dispose()
	}

	update(renderer, inputBuffer) {
		// TODO: FIX RIGGED MESHES ISSUE

		this.temporalResolvePass.unjitter()
		this.unjitteredProjectionMatrix = this._camera.projectionMatrix.clone()

		this._camera.projectionMatrix.copy(this.unjitteredProjectionMatrix)

		const visibleMeshes = getVisibleChildren(this._scene)
		for (const mesh of visibleMeshes) {
			if (mesh.constructor.name !== "GroundProjectedEnv") continue

			const uniforms = Array.from(renderer.properties.get(mesh.material).programs.values())[0].getUniforms()

			if (!uniforms._patchedProjectionMatrix) {
				const oldSetValue = uniforms.setValue.bind(uniforms)
				uniforms._oldSetValue = oldSetValue
				uniforms.setValue = (gl, name, value, ...args) => {
					if (name === "projectionMatrix") {
						value = this.unjitteredProjectionMatrix
					}

					oldSetValue(gl, name, value, ...args)
				}

				uniforms._patchedProjectionMatrix = true
			}

			cancelAnimationFrame(uniforms._destroyPatchRAF)
			cancelAnimationFrame(uniforms._destroyPatchRAF2)

			uniforms._destroyPatchRAF = requestAnimationFrame(() => {
				uniforms._destroyPatchRAF2 = requestAnimationFrame(() => {
					uniforms.setValue = uniforms._oldSetValue
					delete uniforms._oldSetValue
					delete uniforms._patchedProjectionMatrix
				})
			})
		}

		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture

		this.temporalResolvePass.render(renderer)

		this.temporalResolvePass.jitter()
	}
}
