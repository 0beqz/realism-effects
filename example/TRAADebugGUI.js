import { Pane } from "tweakpane"

export class TRAADebugGUI {
	constructor(traaEffect, params = {}) {
		const pane = new Pane()
		this.pane = pane
		pane.containerElem_.style.userSelect = "none"
		pane.containerElem_.style.width = "380px"

		pane.on("change", ev => {
			const { presetKey } = ev

			traaEffect[presetKey] = ev.value
		})

		const temporalResolveFolder = pane.addFolder({ title: "Temporal Resolve" })

		temporalResolveFolder.addInput(params, "temporalResolveMix", { min: 0, max: 1, step: 0.001 })
		temporalResolveFolder.addInput(params, "temporalResolveCorrectionMix", { min: 0, max: 1, step: 0.0001 })
	}
}
