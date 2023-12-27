import { SSGIEffect } from "./SSGIEffect"

export class SSREffect extends SSGIEffect {
	constructor(composer, scene, camera, options = {}) {
		options.mode = "ssr"

		super(composer, scene, camera, options)
	}
}
