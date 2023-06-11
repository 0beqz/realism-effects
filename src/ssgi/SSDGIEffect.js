import { SSGIEffect } from "./SSGIEffect"
import { defaultSSGIOptions } from "./SSGIOptions"

export class SSDGIEffect extends SSGIEffect {
	constructor(composer, scene, camera, velocityDepthNormalPass, options) {
		options = { ...defaultSSGIOptions, ...options }
		options.diffuseOnly = true

		super(composer, scene, camera, velocityDepthNormalPass, options)
	}
}
