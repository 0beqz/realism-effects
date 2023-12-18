// eslint-disable-next-line camelcase
import { AOEffect } from "../ao/AOEffect"
import { GTAOPass } from "./GTAOPass"

class GTAOEffect extends AOEffect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, camera, scene, depthTexture, options = AOEffect.DefaultOptions) {
		const gtaoPass = new GTAOPass(camera, scene, depthTexture)

		options = {
			...AOEffect.DefaultOptions,
			...options
		}

		super(composer, depthTexture, gtaoPass, options)

		options = { ...AOEffect.DefaultOptions, ...options }
	}
}

export { GTAOEffect }
