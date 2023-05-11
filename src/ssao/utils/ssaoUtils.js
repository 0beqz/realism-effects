import { Vector3 } from "three"

export function getPointsOnSphere(n) {
	const points = []
	const inc = Math.PI * (3 - Math.sqrt(5))
	const off = 2 / n

	for (let k = 0; k < n; k++) {
		const y = k * off - 1 + off / 2
		const r = Math.sqrt(1 - y * y)
		const phi = k * inc
		points.push(new Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r))
	}

	return points
}
