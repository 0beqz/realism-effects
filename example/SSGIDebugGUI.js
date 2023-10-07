import copy from "copy-to-clipboard"
import { SSGIEffect } from "realism-effects"
import { Pane } from "tweakpane"

export class SSGIDebugGUI {
	constructor(ssgiEffect, params = SSGIEffect.DefaultOptions) {
		const pane = new Pane()
		this.pane = pane
		pane.containerElem_.style.userSelect = "none"
		pane.containerElem_.style.width = "380px"

		pane.on("change", ev => {
			const { presetKey } = ev

			ssgiEffect[presetKey] = ev.value
		})

		params = { ...SSGIEffect.DefaultOptions, ...params }

		const generalFolder = pane.addFolder({ title: "General" })
		generalFolder.addInput(params, "distance", { min: 0.001, max: 50, step: 0.01 })
		generalFolder.addInput(params, "thickness", {
			min: 0,
			max: 10,
			step: 0.01
		})

		generalFolder.addInput(params, "envBlur", { min: 0, max: 1, step: 0.01 })
		generalFolder.addInput(params, "importanceSampling")

		const denoiseFolder = pane.addFolder({ title: "Denoise" })
		denoiseFolder.addInput(params, "denoiseIterations", { min: 0, max: 5, step: 1 })
		denoiseFolder.addInput(params, "radius", { min: 0, max: 32, step: 1 })

		denoiseFolder.addInput(params, "phi", {
			min: 0,
			max: 1,
			step: 0.001
		})

		denoiseFolder.addInput(params, "depthPhi", {
			min: 0,
			max: 50,
			step: 0.001
		})

		denoiseFolder.addInput(params, "normalPhi", {
			min: 0,
			max: 100,
			step: 0.001
		})

		denoiseFolder.addInput(params, "roughnessPhi", {
			min: 0,
			max: 100,
			step: 0.001
		})

		denoiseFolder.addInput(params, "lumaPhi", {
			min: 0,
			max: 50,
			step: 0.001
		})

		denoiseFolder.addInput(params, "specularPhi", {
			min: 0,
			max: 5,
			step: 0.001
		})

		const definesFolder = pane.addFolder({ title: "Tracing" })

		definesFolder.addInput(params, "steps", { min: 0, max: 256, step: 1 })
		definesFolder.addInput(params, "refineSteps", { min: 0, max: 16, step: 1 })
		definesFolder.addInput(params, "spp", { min: 1, max: 32, step: 1 })
		definesFolder.addInput(params, "missedRays")

		const resolutionFolder = pane.addFolder({ title: "Resolution", expanded: false })
		resolutionFolder.addInput(params, "resolutionScale", { min: 0.25, max: 1, step: 0.25 })

		let textures = [
			ssgiEffect.ssgiPass.renderTarget.texture,
			ssgiEffect.ssgiPass.gBufferPass.renderTarget.depthTexture,
			ssgiEffect.denoiser.velocityDepthNormalPass.renderTarget.texture
		]

		if (ssgiEffect.denoiser.denoiserComposePass?.texture) {
			textures.unshift(ssgiEffect.denoiser.denoiserComposePass.texture)
		}

		if (ssgiEffect.denoiser.denoisePass) {
			textures.push(
				ssgiEffect.denoiser.denoisePass.renderTargetB.texture[0],
				ssgiEffect.denoiser.denoisePass.renderTargetB.texture[1]
			)
		}

		textures.push(ssgiEffect.ssgiPass.gBufferPass.texture)

		// turn textures into an object with names
		const textureObject = {}
		textures = textures.filter(tex => !!tex)
		textures.forEach(tex => (textureObject[tex.name] = tex.name))

		const modes = ["diffuse", "alpha", "normal", "roughness", "metalness", "emissive"]
		modes.forEach(name => (textureObject[name] = name))

		const textureDebugParams = { Texture: "DenoiserComposePass.Texture" }

		const debugFolder = pane.addFolder({ title: "Debug", expanded: false })
		debugFolder
			.addInput(textureDebugParams, "Texture", {
				options: textureObject
			})
			.on("change", ev => {
				ssgiEffect.outputTexture = textures.find(tex => tex.name === ev.value) ?? ev.value
			})

		pane
			.addButton({
				title: "Copy to Clipboard"
			})
			.on("click", () => {
				const json = {}

				for (const prop of Object.keys(SSGIEffect.DefaultOptions)) {
					if (prop === "outputTexture" || prop === "mode") continue
					json[prop] = ssgiEffect[prop]
				}

				const output = JSON.stringify(json, null, 2)
				copy(output)
			})
	}
}
