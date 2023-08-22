import { Vector2 } from "three"

export function generateDenoiseSamples(numSamples, numRings, texelSize) {
	const angleStep = (2 * Math.PI * numRings) / numSamples
	const samples = []
	let angle = 0

	for (let i = 0; i < numSamples; i++) {
		const v = new Vector2(Math.cos(angle), Math.sin(angle)).multiply(texelSize)

		samples.push(v)
		angle += angleStep
	}

	return samples
}

export function generateDenoiseSamples2(numSamples, numRings, texelSize) {
	const angleStep = (2 * Math.PI * numRings) / numSamples
	const samples = []
	let angle = 0

	for (let i = 0; i < numSamples; i++) {
		const radius = Math.sqrt(i / numSamples)
		const x = radius * Math.cos(angle)
		const y = radius * Math.sin(angle)
		samples.push(new Vector2(x, y).multiply(texelSize))
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
