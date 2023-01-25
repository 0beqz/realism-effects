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

// from: https://news.ycombinator.com/item?id=17876741
// reference: http://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/

const g = 1.32471795724474602596090885447809
const a1 = 1.0 / g
const a2 = 1.0 / (g * g)

export const generateR2 = count => {
	const points = []

	for (let n = 0; n < count; n++) {
		points.push([(0.5 + a1 * n) % 1, (0.5 + a2 * n) % 1])
	}

	return points
}
