import { defaultSSGIOptions } from "../src/SSGI/SSGIOptions"
import { Pane } from "tweakpane"
import copy from "copy-to-clipboard"

export class SSGIDebugGUI {
	constructor(ssgiEffect, params = defaultSSGIOptions) {
		const pane = new Pane()
		this.pane = pane
		pane.containerElem_.style.userSelect = "none"
		pane.containerElem_.style.width = "380px"

		pane.on("change", ev => {
			const { presetKey } = ev

			ssgiEffect[presetKey] = ev.value
		})

		params = { ...defaultSSGIOptions, ...params }

		const generalFolder = pane.addFolder({ title: "General" })
		generalFolder.addInput(params, "intensity", { min: 0, max: 3, step: 0.01 })
		generalFolder.addInput(params, "power", { min: 0.025, max: 3, step: 0.01 })
		generalFolder.addInput(params, "distance", { min: 0.001, max: 20, step: 0.01 })
		generalFolder.addInput(params, "roughnessFade", {
			min: 0,
			max: 1,
			step: 0.01
		})
		generalFolder.addInput(params, "thickness", {
			min: 0,
			max: 5,
			step: 0.01
		})

		generalFolder.addInput(params, "ior", {
			min: 1,
			max: 2.33,
			step: 0.01
		})

		generalFolder.addInput(params, "maxRoughness", { min: 0, max: 1, step: 0.01 })

		const temporalResolveFolder = pane.addFolder({ title: "Temporal Resolve" })

		temporalResolveFolder.addInput(params, "blend", { min: 0, max: 1, step: 0.001 })
		// temporalResolveFolder.addInput(params, "correction", { min: 0, max: 1, step: 0.0001 })
		// temporalResolveFolder.addInput(params, "correctionRadius", { min: 1, max: 4, step: 1 })

		const blurKernelFolder = pane.addFolder({ title: "blurKernel" })
		blurKernelFolder.addInput(params, "blurKernel", { min: 1, max: 5, step: 1 })
		blurKernelFolder.addInput(params, "sharpness", {
			min: 1,
			max: 100,
			step: 1
		})

		const jitterFolder = pane.addFolder({ title: "Jitter" })

		jitterFolder.addInput(params, "jitter", { min: 0, max: 1, step: 0.01 })
		jitterFolder.addInput(params, "jitterRoughness", { min: 0, max: 1, step: 0.01 })

		const definesFolder = pane.addFolder({ title: "Tracing" })

		definesFolder.addInput(params, "steps", { min: 0, max: 256, step: 1 })
		definesFolder.addInput(params, "refineSteps", { min: 0, max: 16, step: 1 })
		definesFolder.addInput(params, "spp", { min: 1, max: 32, step: 1 })
		definesFolder.addInput(params, "missedRays")

		const resolutionFolder = pane.addFolder({ title: "Resolution", expanded: false })
		resolutionFolder.addInput(params, "resolutionScale", { min: 0.5, max: 1, step: 0.5 })

		pane
			.addButton({
				title: "Copy to Clipboard"
			})
			.on("click", () => {
				const json = {}

				for (const prop of Object.keys(defaultSSGIOptions)) {
					json[prop] = ssgiEffect[prop]
				}

				const output = JSON.stringify(json, null, 2)
				copy(output)
			})
	}
}
