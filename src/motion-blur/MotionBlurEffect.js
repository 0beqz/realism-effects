﻿/* eslint-disable camelcase */

import { Effect } from "postprocessing"
import { NoColorSpace, NearestFilter, RepeatWrapping, TextureLoader, Uniform, Vector2 } from "three"
import motion_blur from "./shader/motion_blur.frag"

import blueNoiseImage from "./../utils/blue_noise_rgba.png"

// https://www.nvidia.com/docs/io/8230/gdc2003_openglshadertricks.pdf
// http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html
// reference code: https://github.com/gkjohnson/threejs-sandbox/blob/master/motionBlurPass/src/CompositeShader.js

const defaultOptions = { intensity: 1, jitter: 1, samples: 16 }

export class MotionBlurEffect extends Effect {
	pointsIndex = 0

	constructor(velocityPass, options = defaultOptions) {
		options = { ...defaultOptions, ...options }

		super("MotionBlurEffect", motion_blur, {
			type: "MotionBlurMaterial",
			uniforms: new Map([
				["inputTexture", new Uniform(null)],
				["velocityTexture", new Uniform(velocityPass.texture)],
				["blueNoiseTexture", new Uniform(null)],
				["blueNoiseSize", new Uniform(new Vector2())],
				["resolution", new Uniform(new Vector2())],
				["intensity", new Uniform(1)],
				["jitter", new Uniform(1)],
				["frame", new Uniform(0)],
				["deltaTime", new Uniform(0)]
			]),
			defines: new Map([
				["samples", options.samples.toFixed(0)],
				["samplesFloat", options.samples.toFixed(0) + ".0"]
			])
		})

		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},
				set(value) {
					options[key] = value

					switch (key) {
						case "intensity":
						case "jitter":
							this.uniforms.get(key).value = value
							break
					}
				}
			})

			this[key] = options[key]
		}
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)

		new TextureLoader().load(blueNoiseImage, blueNoiseTexture => {
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.colorSpace = NoColorSpace

			this.uniforms.get("blueNoiseTexture").value = blueNoiseTexture
		})
	}

	update(renderer, inputBuffer, deltaTime) {
		this.uniforms.get("inputTexture").value = inputBuffer.texture
		this.uniforms.get("deltaTime").value = Math.max(1 / 1000, deltaTime)

		const frame = renderer.info.render.frame % 65536
		this.uniforms.get("frame").value = frame

		this.uniforms.get("resolution").value.set(window.innerWidth, window.innerHeight)

		const noiseTexture = this.uniforms.get("blueNoiseTexture").value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.uniforms.get("blueNoiseSize").value.set(width, height)
		}
	}
}
