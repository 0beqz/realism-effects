import { Effect } from "postprocessing"
import { Uniform } from "three"
import { getVisibleChildren, isGroundProjectedEnv } from "../ssgi/utils/Utils"
import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass.js"
import compose from "./shader/compose.frag"

const defaultTRAAOptions = {
	blend: 0.8,
	constantBlend: true,
	dilation: true,
	logTransform: false, // ! todo: check if can use logTransform without artifacts
	depthDistance: 10,
	worldDistance: 5,
	neighborhoodClamp: true
}

export class TRAAEffect extends Effect {
	constructor(scene, camera, velocityDepthNormalPass, options = defaultTRAAOptions) {
		super("TRAAEffect", compose, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([["inputTexture", new Uniform(null)]])
		})

		this._scene = scene
		this._camera = camera

		options = { ...defaultTRAAOptions, ...options }

		this.temporalReprojectPass = new TemporalReprojectPass(scene, camera, velocityDepthNormalPass, 1, options)

		this.uniforms.get("inputTexture").value = this.temporalReprojectPass.texture

		this.setSize(options.width, options.height)
	}

	setSize(width, height) {
		this.temporalReprojectPass.setSize(width, height)
	}

	dispose() {
		super.dispose()

		this.temporalReprojectPass.dispose()
	}

	update(renderer, inputBuffer) {
		this.temporalReprojectPass.unjitter()
		this.unjitteredProjectionMatrix = this._camera.projectionMatrix.clone()

		this._camera.projectionMatrix.copy(this.unjitteredProjectionMatrix)

		const noJitterMeshes = getVisibleChildren(this._scene).filter(c => isGroundProjectedEnv(c))

		for (const mesh of noJitterMeshes) {
			const renderData = renderer.properties.get(mesh.material)

			if (!renderData?.programs) continue

			const uniforms = Array.from(renderData.programs.values())[0].getUniforms()

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

		this.temporalReprojectPass.fullscreenMaterial.uniforms.inputTexture0.value = inputBuffer.texture

		this.temporalReprojectPass.jitter()

		this.temporalReprojectPass.render(renderer)
	}
}

TRAAEffect.DefaultOptions = defaultTRAAOptions
