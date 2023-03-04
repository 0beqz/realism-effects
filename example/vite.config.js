import path from "path"
import glsl from "vite-plugin-glsl"
import { fileURLToPath } from "url"

const fileName = fileURLToPath(import.meta.url)
const dirName = path.dirname(fileName)

export default {
	plugins: [glsl.default()],
	resolve: {
		alias: [
			{ find: "three", replacement: dirName + "/node_modules/three" },
			{ find: "postprocessing", replacement: dirName + "/node_modules/postprocessing" }
		]
	},
	server: {
		fs: {
			allow: [".."]
		}
	}
}
