import { Pane } from "tweakpane"
import { defaultTRAAOptions } from "../src/TRAAEffect"

export class TRAADebugGUI {
	constructor(traaEffect, params = defaultTRAAOptions) {
		const pane = new Pane()
		this.pane = pane
		pane.containerElem_.style.userSelect = "none"
		pane.containerElem_.style.width = "380px"

		params = { ...defaultTRAAOptions, ...params }

		pane.on("change", ev => {
			const { presetKey } = ev

			traaEffect[presetKey] = ev.value
		})

		const temporalResolveFolder = pane.addFolder({ title: "Temporal Resolve" })

		temporalResolveFolder.addInput(params, "blend", { min: 0, max: 1, step: 0.001 })
		temporalResolveFolder.addInput(params, "qualityScale", { min: 0.01, max: 1, step: 0.125 })
		temporalResolveFolder.addInput(params, "dilation")

		// const outputFolder = pane.addFolder({ title: "Output", expanded: false })

		// const outputOptions = {
		// 	"Render Mode": 0
		// }

		// outputFolder
		// 	.addInput(outputOptions, "Render Mode", {
		// 		options: {
		// 			Default: 0,
		// 			Depth: 1,
		// 			Velocity: 2,
		// 			Alpha: 3,
		// 			Disocclusion: 4
		// 		}
		// 	})
		// 	.on("change", ev => {
		// 		traaEffect.temporalResolvePass.fullscreenMaterial.defines.RENDER_MODE = ev.value
		// 		traaEffect.temporalResolvePass.fullscreenMaterial.needsUpdate = true
		// 	})
	}
}
