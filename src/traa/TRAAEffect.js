import { Effect } from "postprocessing"
import { Uniform } from "three"
import {
	TemporalReprojectPass,
	defaultTemporalReprojectPassOptions
} from "../temporal-reproject/TemporalReprojectPass.js"
// eslint-disable-next-line camelcase
import traa_compose from "./shader/traa_compose.frag"
import { getVisibleChildren } from "../utils/SceneUtils.js"
import { isGroundProjectedEnv } from "../utils/SceneUtils.js"

export class TRAAEffect extends Effect {
	constructor(scene, camera, velocityDepthNormalPass, options = defaultTemporalReprojectPassOptions) {
		super("TRAAEffect", traa_compose, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([["inputTexture", new Uniform(null)]])
		})

		this._scene = scene
		this._camera = camera
		this.velocityDepthNormalPass = velocityDepthNormalPass

		options = {
			...options,
			...{
				maxBlend: 0.9,
				neighborhoodClamp: true,
				neighborhoodClampIntensity: 1,
				neighborhoodClampRadius: 1,
				logTransform: true,
				confidencePower: 0.125
			}
		}

		this.options = { ...defaultTemporalReprojectPassOptions, ...options }

		this.setSize(options.width, options.height)
	}

	setSize(width, height) {
		this.temporalReprojectPass?.setSize(width, height)
	}

	dispose() {
		super.dispose()

		this.temporalReprojectPass.dispose()
	}

	update(renderer, inputBuffer) {
		if (!this.temporalReprojectPass) {
			this.temporalReprojectPass = new TemporalReprojectPass(
				scene,
				camera,
				this.velocityDepthNormalPass,
				inputBuffer.texture,
				1,
				this.options
			)
			this.temporalReprojectPass.setSize(inputBuffer.width, inputBuffer.height)

			this.uniforms.get("inputTexture").value = this.temporalReprojectPass.texture
		}

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

		this.temporalReprojectPass.setInputTexture(inputBuffer.texture)

		this.temporalReprojectPass.jitter()

		this.temporalReprojectPass.render(renderer)
	}
}

TRAAEffect.DefaultOptions = defaultTemporalReprojectPassOptions
