import { Vector2 } from "three"

export function generatePoissonSamples(samples, rings, radius, texelSize) {
	const poissonDisk = []

	const ANGLE_STEP = (2 * Math.PI * rings) / samples
	let angle = 0

	for (let i = 0; i < samples; i++) {
		const sample = new Vector2(Math.cos(angle), Math.sin(angle)).multiply(texelSize).multiplyScalar(radius)
		poissonDisk.push(sample)

		angle += ANGLE_STEP
	}

	return poissonDisk
}

export function generatePoissonDiskConstant(poissonDisk) {
	const samples = poissonDisk.length
	let glslCode = `const int samples = ${samples};\nconst vec2 poissonDisk[samples] = vec2[samples](\n`

	for (let i = 0; i < samples; i++) {
		const sample = poissonDisk[i]
		glslCode += `    vec2(${sample.x}, ${sample.y})`

		if (i < samples - 1) {
			glslCode += ","
		}

		glslCode += "\n"
	}

	glslCode += ");"

	return glslCode
}
