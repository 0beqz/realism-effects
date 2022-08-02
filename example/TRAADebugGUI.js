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

		temporalResolveFolder.addInput(params, "blend", { min: 0, max: 1, step: 0.001 })
		temporalResolveFolder.addInput(params, "scale", { min: 0, max: 2.5, step: 0.5 })
		temporalResolveFolder.addInput(params, "correction", { min: 0, max: 1, step: 0.0001 })
		temporalResolveFolder.addInput(params, "dilation")
	}
}
