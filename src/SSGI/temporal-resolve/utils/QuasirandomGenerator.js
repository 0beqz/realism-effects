// from: https://news.ycombinator.com/item?id=17876741
// reference: http://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/

const g = 1.32471795724474602596090885447809 // Plastic number
const a1 = 1.0 / g
const a2 = 1.0 / (g * g)
const base = 1.1127756842787055 // harmoniousNumber(7), yields better coverage compared to using 0.5

const harmoniousNumber = (n = 2, value = 0, depth = 100) => {
	if (depth === 0) return value

	return (1 + harmoniousNumber(n, value, depth - 1)) ** (1 / n)
}

export const generateR2 = count => {
	const points = []

	for (let n = 0; n < count; n++) {
		points.push([(base + a1 * n) % 1, (base + a2 * n) % 1])
	}

	return points
}

export const getR2Index = n => {
	return [(base + a1 * n) % 1, (base + a2 * n) % 1]
}

export const getR3Index = n => {
	const g = 1.2207440846057596
	const a1 = 1.0 / g
	const a2 = 1.0 / (g * g)
	const a3 = 1.0 / (g * g * g)

	return [(base + a1 * n) % 1, (base + a2 * n) % 1, (base + a3 * n) % 1]
}

export const generateR3 = count => {
	const g = 1.32471795724474602596090885447809 // Plastic number
	const a1 = 1.0 / g
	const a2 = 1.0 / (g * g)
	const a3 = 1.0 / (g * g * g)
	const base = 1.1127756842787055 // harmoniousNumber(7), yields better coverage compared to using 0.5

	const points = []

	for (let n = 0; n < count; n++) {
		points.push([(base + a1 * n) % 1, (base + a2 * n) % 1, (base + a3 * n) % 1])
	}

	return points
}
