import { SSGIEffect } from "./SSGIEffect"
import { defaultSSGIOptions } from "./SSGIOptions"

export class SSREffect extends SSGIEffect {
	constructor(scene, camera, options = defaultSSGIOptions) {
		options = { ...defaultSSGIOptions, ...options }
		options.specularOnly = true

		super(scene, camera, options)
	}
}
