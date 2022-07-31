const fs = require("fs")

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

let i = ~~(Math.random() * 10e7) + 10e5
const end = i + 512

for (; i < end; i++) {
	data.push([halton(i, 2), halton(i, 3)])
}

data = data.map(entry => "{ x: " + entry[0] + ", y: " + entry[1] + "}")

const output = "const halton = [" + data.join(", ") + "]"

fs.writeFile("./halton.js", output, err => {
	if (err) {
		console.error(err)
	}

	console.log("Successfuly wrote Halton sequence to file")
})
