/* eslint-disable camelcase */
import { NearestFilter, NoColorSpace, RepeatWrapping, TextureLoader, Vector2 } from "three"
import blueNoiseImage from "./blue_noise_rgba.png"
import blue_noise from "../utils/shader/blue_noise.glsl"

const blueNoiseSize = 128

const blueNoiseTexture = new TextureLoader().load(blueNoiseImage, () => {
	blueNoiseTexture.minFilter = NearestFilter
	blueNoiseTexture.magFilter = NearestFilter
	blueNoiseTexture.wrapS = RepeatWrapping
	blueNoiseTexture.wrapT = RepeatWrapping
	blueNoiseTexture.colorSpace = NoColorSpace
})

export const useBlueNoise = material => {
	material.uniforms.blueNoiseTexture = { value: blueNoiseTexture }
	material.uniforms.blueNoiseSize = { value: new Vector2(blueNoiseSize, blueNoiseSize) }

	let blueNoiseIndex = 0

	const highestSignedInt = 0x7fffffff

	const startIndex = Math.floor(Math.random() * highestSignedInt)

	material.uniforms.blueNoiseIndex = {
		get value() {
			blueNoiseIndex = (startIndex + blueNoiseIndex + 1) % highestSignedInt
			return blueNoiseIndex
		},
		set value(v) {
			blueNoiseIndex = v
		}
	}

	if (!material.fragmentShader.includes("uniform vec2 resolution;")) {
		throw new Error("Shader does not contain 'uniform vec2 resolution'")
	}

	material.fragmentShader = material.fragmentShader.replace(
		"uniform vec2 resolution;",
		"uniform vec2 resolution;\n" + blue_noise
	)

	material.needsUpdate = true
}
