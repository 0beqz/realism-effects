import { HBAOPass } from "./HBAOPass"
// eslint-disable-next-line camelcase
import { AOEffect } from "../ao/AOEffect"

const defaultHBAOOptions = {
	bentNormals: true
}

class HBAOEffect extends AOEffect {
	lastSize = { width: 0, height: 0, resolutionScale: 0 }

	constructor(composer, camera, scene, options = AOEffect.DefaultOptions) {
		const hbaoPass = new HBAOPass(camera, scene)

		super(composer, camera, scene, hbaoPass, (options = AOEffect.DefaultOptions))

		options = { ...AOEffect.DefaultOptions, ...options }

		for (const key of ["bentNormals"]) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					if (value === null || value === undefined) return

					options[key] = value

					switch (key) {
						case "bentNormals":
							if (value) {
								this.hbaoPass.fullscreenMaterial.defines.bentNormals = ""
							} else {
								delete this.hbaoPass.fullscreenMaterial.defines.bentNormals
							}

							this.hbaoPass.fullscreenMaterial.needsUpdate = true
							break
					}
				}
			})

			// apply all uniforms and defines
			this[key] = options[key]
		}
	}
}

HBAOEffect.DefaultOptions = { ...AOEffect.DefaultOptions, ...defaultHBAOOptions }

export { HBAOEffect }
