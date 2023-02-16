import { defaultSSGIOptions, SSGIEffect } from "./SSGI"

export class SSREffect extends SSGIEffect {
	constructor(scene, camera, options = defaultSSGIOptions) {
		options = { ...defaultSSGIOptions, ...options }
		options.specularOnly = true

		super(scene, camera, options)
	}
}
