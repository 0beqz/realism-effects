import { Pane } from "tweakpane"
import copy from "copy-to-clipboard"
import { SSAOEffect } from "../src/ssao/SSAOEffect"

export class SSAODebugGUI {
	constructor(ssaoEffect, params = SSAOEffect.DefaultOptions) {
		const pane = new Pane({ title: "SSAO" })
		this.pane = pane
		pane.containerElem_.style.userSelect = "none"
		pane.containerElem_.style.width = "380px"

		pane.on("change", ev => {
			const { presetKey } = ev

			ssaoEffect[presetKey] = ev.value
		})

		params = { ...SSAOEffect.DefaultOptions, ...params }

		const generalFolder = pane.addFolder({ title: "General" })
		generalFolder.addInput(params, "resolutionScale", { min: 0.25, max: 1, step: 0.25 })
		generalFolder.addInput(params, "spp", { min: 1, max: 64, step: 1 })
		generalFolder.addInput(params, "distance", {
			min: 0.1,
			max: 10,
			step: 0.1
		})
		generalFolder.addInput(params, "distancePower", {
			min: 0,
			max: 2,
			step: 0.125
		})
		generalFolder.addInput(params, "power", { min: 0.5, max: 32, step: 0.5 })

		generalFolder.addInput(params, "color", {
			color: { type: "float" }
		})

		const denoiseFolder = pane.addFolder({ title: "Denoise" })

		denoiseFolder.addInput(params, "iterations", { min: 0, max: 3, step: 1 })
		denoiseFolder.addInput(params, "radius", { min: 0, max: 32, step: 1 })
		denoiseFolder.addInput(params, "samples", { min: 0, max: 32, step: 1 })
		denoiseFolder.addInput(params, "rings", { min: 1, max: 32, step: 1 })
		denoiseFolder.addInput(params, "depthPhi", {
			min: 0,
			max: 20,
			step: 0.001
		})
		denoiseFolder.addInput(params, "normalPhi", {
			min: 0,
			max: 50,
			step: 0.001
		})

		pane
			.addButton({
				title: "Copy to Clipboard"
			})
			.on("click", () => {
				const json = {}

				for (const prop of Object.keys(SSAOEffect.DefaultOptions)) {
					json[prop] = ssaoEffect[prop]
				}

				const output = JSON.stringify(json, null, 2)
				copy(output)
			})
	}
}
