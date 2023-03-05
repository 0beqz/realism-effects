/* eslint-disable no-undef */
// get a list of all the gltf files in the directory
import fs from "fs"
import { exec } from "child_process"

// this function runs a command
function execCommand(command) {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				reject(error)
				return
			}
			resolve({ stdout, stderr })
		})
	})
}

const gltfFiles = fs
	.readdirSync("./")
	.filter(f => f.endsWith(".glb"))
	.filter(f => !f.endsWith(".optimized.glb"))

// create a new array from gltfFiles array with the .glb extension
// replaced with .optimized.glb
const optimizedFiles = gltfFiles.map(f => f.replace(".glb", ""))
console.log(optimizedFiles)

// run a command for each file in the gltfFiles array
gltfFiles.forEach(f => {
	const cmds = [
		`gltf-transform webp ${f} ${f.replace(".glb", "")}.optimized.glb`,
		`gltf-transform resize --width 1024 --height 1024 ${f.replace(".glb", "")}.optimized.glb ${f.replace(
			".glb",
			""
		)}.optimized.glb`,
		`gltf-transform merge ${f.replace(".glb", "")}.optimized.glb ${f.replace(".glb", "")}.optimized.glb`,
		`gltf-transform prune ${f.replace(".glb", "")}.optimized.glb ${f.replace(".glb", "")}.optimized.glb`,
		`gltf-transform draco ${f.replace(".glb", "")}.optimized.glb ${f.replace(".glb", "")}.optimized.glb`
	]

	// run multiple command for each file in the gltfFiles array in sequence
	const run = async cmds => {
		for (const cmd of cmds) {
			try {
				const { stdout } = await execCommand(cmd)
				console.log(cmd, stdout)
			} catch (error) {
				console.error(error)
			}
		}
	}

	run(cmds)
})
