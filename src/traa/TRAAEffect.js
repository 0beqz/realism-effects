import { Effect } from "postprocessing"
import { Uniform } from "three"
import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass.js"
// eslint-disable-next-line camelcase
import traa_compose from "./shader/traa_compose.frag"
import { getVisibleChildren } from "../utils/SceneUtils.js"
import { isGroundProjectedEnv } from "../utils/SceneUtils.js"

const defaultTRAAOptions = {
	blend: 0.8,
	dilation: true,
	logTransform: true,
	neighborhoodClampRadius: 2,
	neighborhoodClamp: true
}

export class TRAAEffect extends Effect {
	constructor(scene, camera, velocityDepthNormalPass, options = defaultTRAAOptions) {
		super("TRAAEffect", traa_compose, {
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
