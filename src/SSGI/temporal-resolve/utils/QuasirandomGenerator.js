// from: https://news.ycombinator.com/item?id=17876741
// reference: http://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/

const g = 1.32471795724474602596090885447809 // Plastic number
const a1 = 1.0 / g
const a2 = 1.0 / (g * g)

export const generateR2 = count => {
	const points = []

	for (let n = 0; n < count; n++) {
		points.push([(0.5 + a1 * n) % 1, (0.5 + a2 * n) % 1])
	}

	return points
}

export const getR2Index = n => {
	return [(0.5 + a1 * n) % 1, (0.5 + a2 * n) % 1]
}

export const getR3Index = n => {
	const g = 1.2207440846057596
	const a1 = 1.0 / g
	const a2 = 1.0 / (g * g)
	const a3 = 1.0 / (g * g * g)

	return [(0.5 + a1 * n) % 1, (0.5 + a2 * n) % 1, (0.5 + a3 * n) % 1]
}
