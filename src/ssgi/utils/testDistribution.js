// this node.js script plots points on an image to test the distribution of the points

import { createCanvas } from "canvas"
import { writeFileSync } from "fs"
import { execSync } from "child_process"

const generateVogelDistribution = (numSamples, scale = 1) => {
	const samples = []
	const goldenAngle = Math.PI * (3 - Math.sqrt(5))

	for (let i = 0; i < numSamples; i++) {
		const t = i / numSamples
		const r = Math.sqrt(t)
		const theta = i * goldenAngle

		const x = r * Math.cos(theta)
		const y = r * Math.sin(theta)

		samples.push({ x, y })
	}

	return samples
}

const numSamples = 8
const samples = generateVogelDistribution(numSamples)

const canvas = createCanvas(1000, 1000)
const ctx = canvas.getContext("2d")

ctx.fillStyle = "black"
ctx.fillRect(0, 0, canvas.width, canvas.height)

ctx.fillStyle = "white"
ctx.strokeStyle = "white"

for (let i = 0; i < numSamples; i++) {
	const sample = samples[i]
	const x = sample.x * 500 + 500
	const y = sample.y * 500 + 500

	ctx.beginPath()
	ctx.arc(x, y, 2, 0, Math.PI * 2)
	ctx.fill()
	ctx.stroke()
}

// create a glsl constant array from the samples
const glslArray = samples.map(sample => `vec2(${sample.x}, ${sample.y})`).join(",\n")
const glslVar = `const vec2 VOGEL[${numSamples}] = vec2[${numSamples}](${glslArray});`

// save to file
writeFileSync("vogel.glsl", glslVar)

writeFileSync("vogel.png", canvas.toBuffer())
