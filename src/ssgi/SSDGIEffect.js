import { defaultSSGIOptions, SSGIEffect } from "./SSGI"

export class SSDGIEffect extends SSGIEffect {
	constructor(scene, camera, options = defaultSSGIOptions) {
		options = { ...defaultSSGIOptions, ...options }
		options.diffuseOnly = true

		super(scene, camera, options)
	}
}
