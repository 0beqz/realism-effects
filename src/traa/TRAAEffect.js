import { Effect } from "postprocessing"
import { Uniform } from "three"
import {
	TemporalReprojectPass,
	defaultTemporalReprojectPassOptions
} from "../temporal-reproject/TemporalReprojectPass.js"
// eslint-disable-next-line camelcase
import { getVisibleChildren, isGroundProjectedEnv } from "../utils/SceneUtils.js"
import traa_compose from "./shader/traa_compose.frag"

export class TRAAEffect extends Effect {
	constructor(scene, camera, velocityDepthNormalPass, options = defaultTemporalReprojectPassOptions) {
		super("TRAAEffect", traa_compose, {
			type: "FinalTRAAEffectMaterial",
			uniforms: new Map([["accumulatedTexture", new Uniform(null)]])
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
				logTransform: true
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

	reset() {
		this.temporalReprojectPass.reset()
	}

	update(renderer, inputBuffer) {
		if (!this.temporalReprojectPass) {
			this.temporalReprojectPass = new TemporalReprojectPass(
				this._scene,
				this._camera,
				this.velocityDepthNormalPass,
				inputBuffer.texture,
				1,
				this.options
			)
			this.temporalReprojectPass.setSize(inputBuffer.width, inputBuffer.height)

			this.uniforms.get("accumulatedTexture").value = this.temporalReprojectPass.texture
		}

		this.temporalReprojectPass.unjitter()
		this.unjitteredProjectionMatrix = this._camera.projectionMatrix.clone()

		this._camera.projectionMatrix.copy(this.unjitteredProjectionMatrix)

		this.temporalReprojectPass.jitter()

		this.temporalReprojectPass.render(renderer)
	}
}

TRAAEffect.DefaultOptions = defaultTemporalReprojectPassOptions
