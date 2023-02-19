import { SSGIEffect } from "./SSGIEffect"
import { defaultSSGIOptions } from "./SSGIOptions"

export class SSDGIEffect extends SSGIEffect {
	constructor(scene, camera, velocityPass, options = defaultSSGIOptions) {
		options = { ...defaultSSGIOptions, ...options }
		options.diffuseOnly = true

		super(scene, camera, velocityPass, options)
	}
}
