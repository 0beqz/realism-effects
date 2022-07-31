// source: https://observablehq.com/@jrus/halton
const halton = function halton(index, base) {
	let fraction = 1
	let result = 0
	while (index > 0) {
		fraction /= base
		result += fraction * (index % base)
		index = ~~(index / base) // floor division
	}
	return result
}
// generates a Halton tuple in the range [-0.5:0.5]
export const generateHaltonPoints = count => {
	const data = []

	let i = ~~(Math.random() * 10e7) + 10e5
	const end = i + count

	for (; i < end; i++) {
		data.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5])
	}

	return data
}
