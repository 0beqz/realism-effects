import { SSGIEffect } from "./SSGIEffect"
import { defaultSSGIOptions } from "./SSGIOptions"

export class SSREffect extends SSGIEffect {
	constructor(composer, scene, camera, velocityDepthNormalPass, options) {
		options = { ...defaultSSGIOptions, ...options }
		options.specularOnly = true

		super(composer, scene, camera, velocityDepthNormalPass, options)
	}
}
