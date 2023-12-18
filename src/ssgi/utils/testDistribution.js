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

// this function creates a poisson disk distribution of numSamples points
// the points are distributed in a circle of radius 1
function generatePoissonDiskSamples(numSamples) {
	const radius = 1 // You can adjust this value as needed
	const centerX = 0
	const centerY = 0

	const samples = []

	for (let i = 0; i < numSamples; i++) {
		const angle = Math.random() * 2 * Math.PI
		const distance = Math.sqrt(Math.random()) * radius

		const x = centerX + distance * Math.cos(angle)
		const y = centerY + distance * Math.sin(angle)

		samples.push({ x, y })
	}

	return samples
}

const numSamples = 8
const samples = generateVogelDistribution(numSamples)
const samples2 = generatePoissonDiskSamples(numSamples)

const canvas = createCanvas(1000, 1000)
const ctx = canvas.getContext("2d")

ctx.fillStyle = "black"
ctx.fillRect(0, 0, canvas.width, canvas.height)

for (let i = 0; i < numSamples; i++) {
	const sample = samples[i]
	const sample2 = samples2[i]

	const x = sample.x * 500 + 500
	const y = sample.y * 500 + 500

	const x2 = sample2.x * 500 + 500
	const y2 = sample2.y * 500 + 500

	ctx.fillStyle = "white"
	ctx.strokeStyle = "white"

	ctx.beginPath()
	ctx.arc(x, y, 2, 0, Math.PI * 2)
	ctx.fill()
	ctx.stroke()

	ctx.fillStyle = "#0000ff"
	ctx.strokeStyle = "#0000ff"

	ctx.beginPath()
	ctx.arc(x2, y2, 2, 0, Math.PI * 2)
	ctx.fill()
	ctx.stroke()
}

// shuffle samples
for (let i = samples.length - 1; i > 0; i--) {
	const j = Math.floor(Math.random() * (i + 1))
	;[samples[i], samples[j]] = [samples[j], samples[i]]
}

// create a glsl constant array from the samples
const glslArray = samples.map(sample => `vec2(${sample.x}, ${sample.y})`).join(",\n")
const glslVar = `const vec2 VOGEL[${numSamples}] = vec2[${numSamples}](${glslArray});`

// save to file
writeFileSync("vogel.glsl", glslVar)

writeFileSync("vogel.png", canvas.toBuffer())

console.log("done")
