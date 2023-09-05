import { Vector2 } from "three"

export function generateDenoiseSamples(texelSize) {
	const sqr2 = 2 ** 0.5

	// by Nvidia ReBLUR, for distribution see: https://www.desmos.com/calculator/abaqyvswem
	let samples = [
		new Vector2(-1, 0),
		new Vector2(0, -1),
		new Vector2(1, 0),
		new Vector2(0, 1),
		new Vector2(-0.25 * sqr2, -0.25 * sqr2),
		new Vector2(0.25 * sqr2, -0.25 * sqr2),
		new Vector2(0.25 * sqr2, 0.25 * sqr2),
		new Vector2(-0.25 * sqr2, 0.25 * sqr2)
	]

	samples = samples.map(sample => sample.multiply(texelSize))

	return samples
}

export function generatePoissonDiskConstant(poissonDisk) {
	const samples = poissonDisk.length

	let glslCode = "vec2[" + samples + "]("

	for (let i = 0; i < samples; i++) {
		const sample = poissonDisk[i]
		glslCode += `vec2(${sample.x}, ${sample.y})`

		if (i < samples - 1) {
			glslCode += ","
		}
	}

	glslCode += ")"

	return glslCode
}
