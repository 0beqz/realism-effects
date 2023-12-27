/* eslint-disable camelcase */
import { NearestFilter, NoColorSpace, RepeatWrapping, TextureLoader, Vector2 } from "three"
import blueNoiseImage from "./blue_noise_rgba.png"
import blue_noise from "../utils/shader/blue_noise.glsl"

const blueNoiseSize = 128
const highestSignedInt = 0x7fffffff

const blueNoiseTexture = new TextureLoader().load(blueNoiseImage, () => {
	blueNoiseTexture.minFilter = NearestFilter
	blueNoiseTexture.magFilter = NearestFilter
	blueNoiseTexture.wrapS = RepeatWrapping
	blueNoiseTexture.wrapT = RepeatWrapping
	blueNoiseTexture.colorSpace = NoColorSpace
})

export const setupBlueNoise = fragmentShader => {
	let blueNoiseIndex = 0
	const startIndex = Math.floor(Math.random() * highestSignedInt)

	const uniforms = {
		blueNoiseTexture: { value: blueNoiseTexture },
		blueNoiseSize: { value: new Vector2(blueNoiseSize, blueNoiseSize) },
		blueNoiseIndex: {
			get value() {
				blueNoiseIndex = (startIndex + blueNoiseIndex + 1) % highestSignedInt
				return blueNoiseIndex
			},
			set value(v) {
				blueNoiseIndex = v
			}
		}
	}

	fragmentShader = fragmentShader.replace("uniform vec2 resolution;", "uniform vec2 resolution;\n" + blue_noise)

	return { uniforms, fragmentShader }
}

export const useBlueNoise = material => {
	const { fragmentShader, uniforms } = setupBlueNoise(material.fragmentShader)
	material.fragmentShader = fragmentShader
	material.uniforms = { ...material.uniforms, ...uniforms }

	material.needsUpdate = true
}
