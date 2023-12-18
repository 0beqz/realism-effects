import { HBAOPass } from "./HBAOPass"
// eslint-disable-next-line camelcase
import { AOEffect } from "../ao/AOEffect"

class HBAOEffect extends AOEffect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, camera, scene, depthTexture, options = AOEffect.DefaultOptions) {
		const hbaoPass = new HBAOPass(camera, scene, depthTexture)

		options = {
			...AOEffect.DefaultOptions,
			...HBAOEffect.DefaultOptions,
			...options
		}

		super(composer, depthTexture, hbaoPass, options)

		options = { ...AOEffect.DefaultOptions, ...options }
	}
}

export { HBAOEffect }
