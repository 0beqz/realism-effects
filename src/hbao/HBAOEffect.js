import { HBAOPass } from "./HBAOPass"
// eslint-disable-next-line camelcase
import { AOEffect } from "../ao/AOEffect"

class HBAOEffect extends AOEffect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, camera, scene, options = AOEffect.DefaultOptions) {
		const hbaoPass = new HBAOPass(camera, scene)

		HBAOEffect.DefaultOptions = {
			...AOEffect.DefaultOptions
		}

		options = {
			...HBAOEffect.DefaultOptions,
			...options
		}

		super(composer, camera, scene, hbaoPass, (options = AOEffect.DefaultOptions))

		options = { ...AOEffect.DefaultOptions, ...options }
	}
}

export { HBAOEffect }
