// source: https://observablehq.com/@jrus/halton
const halton = (index, base) => {
	let fraction = 1
	let result = 0
	while (index > 0) {
		fraction /= base
		result += fraction * (index % base)
		index = ~~(index / base) // floor division
	}
	return result
}

// generates Halton tuples in the range [0:1]
export const generateHalton23Points = count => {
	const data = []

	let i = 1
	const end = i + count

	for (; i < end; i++) {
		data.push([halton(i, 2), halton(i, 3)])
	}

	return data
}
