import { Vector2 } from "three"

export function generateDenoiseSamples(numSamples, numRings, r, texelSize) {
	r = 1
	const angleStep = (2 * Math.PI * numRings) / numSamples
	const samples = []
	let angle = 0

	for (let i = 0; i < numSamples; i++) {
		const v = new Vector2(Math.cos(angle), Math.sin(angle)).multiply(texelSize).multiplyScalar(r)

		samples.push(v)
		angle += angleStep
	}

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
