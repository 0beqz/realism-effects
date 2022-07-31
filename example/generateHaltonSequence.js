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

let data = []

let i = ~~(Math.random() * 10e5)
const end = i + 64

for (; i < end; i++) {
	data.push([halton(i, 2), halton(i, 3)])
}

data = data.map(entry => "vec2(" + entry.join(", ") + ")")

const output = "vec2 halton[64] = vec2[](" + data.join(", ") + ");"

console.log(output)
